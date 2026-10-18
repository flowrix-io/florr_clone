#include "client/ui/face_metrics.h"

#include <algorithm>
#include <cmath>

#include "font.h"

namespace flix::ui::face_metrics {
namespace {

// Written by the build (tools/font_table.cpp), in font units:
//   kFileHash, kFileSize   the source file's fingerprint and length
//   kUnitsPerEm            the em
//   kEmAscent, kEmDescent  the em box's split at the baseline
//   kNotdef                .notdef's advance, for what the face lacks
//   kAscii[128]            the advance of every ASCII codepoint
//   kAsciiMapped[2]        which of those the face maps, one bit each
//   kMapped, kMappedAdvance  every other codepoint it maps, ascending, and
//                          their advances
#include "face_metrics_table.inc"

/// What a plain-text run reads per character: the advance in the low 16
/// bits, and kUncovered when the character is printable and the face has no
/// glyph for it -- one load, for the loop that does nearly all the measuring.
constexpr std::uint32_t kUncovered = 1u << 31;
struct AsciiRows {
    std::uint32_t row[128];
};
constexpr AsciiRows asciiRows() {
    AsciiRows rows{};
    for (std::uint32_t c = 0; c < 128; ++c) {
        const bool mapped = (kAsciiMapped[c / 64] >> (c % 64)) & 1u;
        // Controls never reach a glyph that matters, as in Font::covers.
        rows.row[c] = kAscii[c] | (!mapped && c >= 0x20 ? kUncovered : 0u);
    }
    return rows;
}
constexpr AsciiRows kAsciiRows = asciiRows();

/// The advance of the glyph `codepoint` is set in, and whether the face maps
/// it at all. What it does not map is set in .notdef, as Font sets it.
std::uint16_t advance(std::uint32_t codepoint, bool& mapped) {
    if (codepoint < 128) {
        mapped = (kAsciiMapped[codepoint / 64] >> (codepoint % 64)) & 1u;
        return kAscii[codepoint];
    }
    const std::uint32_t* end = kMapped + kMappedCount;
    const std::uint32_t* at = std::lower_bound(kMapped, end, codepoint);
    mapped = at != end && *at == codepoint;
    return mapped ? kMappedAdvance[at - kMapped] : kNotdef;
}

/// The next codepoint, as Font reads one. ASCII inline, the rest through
/// Font's own decoder, so a malformed string decodes the same way here.
std::uint32_t next(const std::string& utf8, std::size_t& i) {
    const unsigned char c = static_cast<unsigned char>(utf8[i]);
    if (c < 0x80) {
        ++i;
        return c;
    }
    return Font::nextCodepoint(utf8, i);
}

/// Font's emBoxEdge, operation for operation: the em box rescaled to span one
/// em, snapped to 64ths of a pixel.
float emBoxEdge(int metric, float pixelSize) {
    const int span = kEmAscent - kEmDescent;
    if (span <= 0) return metric * pixelSize / kUnitsPerEm;
    return std::round(metric * pixelSize * 64.0f / span) / 64.0f;
}

} // namespace

bool describes(const std::uint8_t* data, std::size_t size) {
    return size == kFileSize && fingerprint(data, size) == kFileHash;
}

float measure(const std::string& utf8, float pixelSize, bool* covered) {
    // Font::measure sums the advances in float, a glyph at a time, and scales
    // once. Every advance is a whole number of font units and a float holds
    // every whole number below 2^24 exactly, so while the total stays under
    // that no partial sum ever rounds and the float sum IS the integer one, in
    // any order. Summing integers gives the same bits without a chain of
    // dependent float adds, which is most of what a run of plain text costs.
    std::uint64_t units = 0;
    std::uint32_t asciiFlags = 0;
    bool all = true;
    const char* data = utf8.data();
    const std::size_t size = utf8.size();
    std::size_t i = 0;
    while (i < size) {
        // The plain-ASCII stretch -- nearly every run is one, whole -- four
        // characters a step while four are left.
        while (i + 4 <= size) {
            const unsigned char c0 = static_cast<unsigned char>(data[i]);
            const unsigned char c1 = static_cast<unsigned char>(data[i + 1]);
            const unsigned char c2 = static_cast<unsigned char>(data[i + 2]);
            const unsigned char c3 = static_cast<unsigned char>(data[i + 3]);
            if ((c0 | c1 | c2 | c3) & 0x80) break;
            const std::uint32_t r0 = kAsciiRows.row[c0], r1 = kAsciiRows.row[c1];
            const std::uint32_t r2 = kAsciiRows.row[c2], r3 = kAsciiRows.row[c3];
            units += (r0 & 0xFFFFu) + (r1 & 0xFFFFu) + (r2 & 0xFFFFu) + (r3 & 0xFFFFu);
            asciiFlags |= r0 | r1 | r2 | r3;
            i += 4;
        }
        if (i >= size) break;
        const unsigned char c = static_cast<unsigned char>(data[i]);
        if (c < 0x80) {
            const std::uint32_t row = kAsciiRows.row[c];
            units += row & 0xFFFFu;
            asciiFlags |= row;
            ++i;
            continue;
        }
        const std::uint32_t codepoint = Font::nextCodepoint(utf8, i);
        bool mapped = false;
        units += advance(codepoint, mapped);
        // Controls never reach a glyph that matters, as in Font::covers.
        if (!mapped && codepoint >= 0x20) all = false;
    }
    if (covered) *covered = all && !(asciiFlags & kUncovered);
    if (pixelSize <= 0) return 0;

    float width = static_cast<float>(units);
    if (units >= (std::uint64_t{1} << 24)) {
        // Long enough for the float sum to have started rounding: make it the
        // way Font does, so it rounds where Font's does.
        width = 0;
        for (i = 0; i < size;) {
            bool mapped = false;
            width += advance(next(utf8, i), mapped);
        }
    }
    return width * (pixelSize / static_cast<float>(kUnitsPerEm));
}

bool covers(const std::string& utf8) {
    std::size_t i = 0;
    while (i < utf8.size()) {
        const std::uint32_t codepoint = next(utf8, i);
        bool mapped = false;
        advance(codepoint, mapped);
        if (!mapped && codepoint >= 0x20) return false;
    }
    return true;
}

float ascent(float pixelSize) { return emBoxEdge(kEmAscent, pixelSize); }
float descent(float pixelSize) { return emBoxEdge(kEmDescent, pixelSize); }

} // namespace flix::ui::face_metrics
