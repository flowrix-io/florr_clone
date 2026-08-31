#pragma once
// Little-endian binary read/write cursors.
//
// Nothing here writes type tags: both sides read the fields a message
// declares, in order. That costs a version check at connect time and buys back
// roughly a third of the bytes a self-describing format would spend.
//
// Reads are total. Running off the end sets a sticky failure flag and returns
// zeroes rather than throwing or reading out of bounds, so a handler checks
// ok() once at the end of a message instead of after every field.

#include <cstdint>
#include <cstring>
#include <string>
#include <type_traits>
#include <vector>

#include "shared/core/types.h"

namespace flr {

class ByteWriter {
public:
    ByteWriter() { bytes_.reserve(256); }
    explicit ByteWriter(std::size_t reserve) { bytes_.reserve(reserve); }

    void u8(std::uint8_t v) { bytes_.push_back(static_cast<std::byte>(v)); }
    void i8(std::int8_t v) { u8(static_cast<std::uint8_t>(v)); }
    void u16(std::uint16_t v) { raw(&v, sizeof v); }
    void i16(std::int16_t v) { raw(&v, sizeof v); }
    void u32(std::uint32_t v) { raw(&v, sizeof v); }
    void i32(std::int32_t v) { raw(&v, sizeof v); }
    void u64(std::uint64_t v) { raw(&v, sizeof v); }
    void i64(std::int64_t v) { raw(&v, sizeof v); }
    void f32(float v) { raw(&v, sizeof v); }
    void f64(double v) { raw(&v, sizeof v); }
    void boolean(bool v) { u8(v ? 1 : 0); }

    /// Length-prefixed UTF-8, capped at 64KB.
    void str(const std::string& v) {
        const std::uint16_t n = static_cast<std::uint16_t>(v.size() > 0xFFFF ? 0xFFFF : v.size());
        u16(n);
        raw(v.data(), n);
    }

    /// World position. f32 resolves to ~0.004 units at the far edge of a 60k
    /// world, well under a pixel once drawn, so positions never need eight
    /// bytes on the wire even though the simulation keeps them as doubles.
    void position(Vec2 p) { f32(static_cast<float>(p.x)); f32(static_cast<float>(p.y)); }

    /// Angle quantised to 1/65536 of a turn (~0.005 degrees).
    void angle(double radians) {
        const double turns = wrapAngle(radians) / kTau + 0.5;   // -> [0, 1)
        u16(static_cast<std::uint16_t>(clamp(turns, 0.0, 0.99998474) * 65536.0));
    }

    /// A 0..1 ratio in one byte, for health bars, cooldown fills and alphas
    /// where the reader only turns it back into a fraction of a pixel.
    void unitByte(double v) { u8(static_cast<std::uint8_t>(clamp(v, 0.0, 1.0) * 255.0 + 0.5)); }

    /// A 0..1 ratio in two bytes, where a byte's 1/255 steps would visibly
    /// stair-step -- a boss health bar spanning the screen.
    void unitShort(double v) { u16(static_cast<std::uint16_t>(clamp(v, 0.0, 1.0) * 65535.0 + 0.5)); }

    void raw(const void* data, std::size_t n) {
        if (n == 0) return;
        const std::size_t at = bytes_.size();
        bytes_.resize(at + n);
        std::memcpy(bytes_.data() + at, data, n);
    }

    /// Reserves a u16 for patchU16 to fill in later, so a snapshot can stream
    /// entities straight out without first gathering them to learn the count.
    std::size_t reserveU16() {
        const std::size_t at = bytes_.size();
        u16(0);
        return at;
    }

    void patchU16(std::size_t at, std::uint16_t v) {
        std::memcpy(bytes_.data() + at, &v, sizeof v);
    }

    const std::byte* data() const { return bytes_.data(); }
    std::size_t size() const { return bytes_.size(); }
    bool empty() const { return bytes_.empty(); }
    void clear() { bytes_.clear(); }
    std::vector<std::byte>& buffer() { return bytes_; }
    const std::vector<std::byte>& buffer() const { return bytes_; }

private:
    std::vector<std::byte> bytes_;
};

class ByteReader {
public:
    ByteReader(const std::byte* data, std::size_t size) : data_(data), size_(size) {}
    explicit ByteReader(const std::vector<std::byte>& bytes)
        : data_(bytes.data()), size_(bytes.size()) {}

    std::uint8_t u8() {
        if (!want(1)) return 0;
        return static_cast<std::uint8_t>(data_[pos_++]);
    }
    std::int8_t i8() { return static_cast<std::int8_t>(u8()); }
    std::uint16_t u16() { return read<std::uint16_t>(); }
    std::int16_t i16() { return read<std::int16_t>(); }
    std::uint32_t u32() { return read<std::uint32_t>(); }
    std::int32_t i32() { return read<std::int32_t>(); }
    std::uint64_t u64() { return read<std::uint64_t>(); }
    std::int64_t i64() { return read<std::int64_t>(); }
    float f32() { return read<float>(); }
    double f64() { return read<double>(); }
    bool boolean() { return u8() != 0; }

    std::string str() {
        const std::uint16_t n = u16();
        if (!want(n)) return {};
        std::string out(reinterpret_cast<const char*>(data_ + pos_), n);
        pos_ += n;
        return out;
    }

    Vec2 position() {
        const float x = f32();
        const float y = f32();
        return {x, y};
    }

    double angle() { return (static_cast<double>(u16()) / 65536.0 - 0.5) * kTau; }
    double unitByte() { return static_cast<double>(u8()) / 255.0; }
    double unitShort() { return static_cast<double>(u16()) / 65535.0; }

    void skip(std::size_t n) { if (want(n)) pos_ += n; }

    std::size_t remaining() const { return failed_ ? 0 : size_ - pos_; }
    std::size_t offset() const { return pos_; }

    /// False once any read has run past the end. A truncated or hostile frame
    /// yields a message full of zeroes that the caller discards, rather than a
    /// half-applied one.
    bool ok() const { return !failed_; }

private:
    bool want(std::size_t n) {
        if (failed_ || pos_ + n > size_) { failed_ = true; return false; }
        return true;
    }

    template <class T>
    T read() {
        static_assert(std::is_trivially_copyable_v<T>);
        if (!want(sizeof(T))) return T{};
        T v;
        std::memcpy(&v, data_ + pos_, sizeof(T));
        pos_ += sizeof(T);
        return v;
    }

    const std::byte* data_;
    std::size_t size_;
    std::size_t pos_ = 0;
    bool failed_ = false;
};

} // namespace flr
