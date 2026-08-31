#pragma once
// A dependency-free JSON value, parser and writer.
//
// Object keys keep INSERTION ORDER rather than being sorted or hashed. The
// account database is a JSON file that humans read and that backups diff, so a
// load/save round trip must not reshuffle it.

#include <cstdint>
#include <initializer_list>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace flr {

class Json {
public:
    enum class Type { Null, Bool, Number, String, Array, Object };

    Json() = default;
    Json(std::nullptr_t) {}
    Json(bool v) : type_(Type::Bool), bool_(v) {}
    Json(double v) : type_(Type::Number), number_(v) {}
    Json(int v) : type_(Type::Number), number_(v) {}
    Json(long long v) : type_(Type::Number), number_(static_cast<double>(v)) {}
    Json(std::uint64_t v) : type_(Type::Number), number_(static_cast<double>(v)) {}
    Json(const char* v) : type_(Type::String), string_(v) {}
    Json(std::string v) : type_(Type::String), string_(std::move(v)) {}

    static Json array() { Json j; j.type_ = Type::Array; return j; }
    static Json object() { Json j; j.type_ = Type::Object; return j; }
    static Json array(std::initializer_list<Json> items) {
        Json j = array();
        j.array_ = items;
        return j;
    }

    Type type() const { return type_; }
    bool isNull() const { return type_ == Type::Null; }
    bool isBool() const { return type_ == Type::Bool; }
    bool isNumber() const { return type_ == Type::Number; }
    bool isString() const { return type_ == Type::String; }
    bool isArray() const { return type_ == Type::Array; }
    bool isObject() const { return type_ == Type::Object; }

    // -- scalar access; each returns `fallback` on a type mismatch, so reading
    // a hand-edited or older database never throws, it degrades to defaults.
    bool asBool(bool fallback = false) const { return type_ == Type::Bool ? bool_ : fallback; }
    double asDouble(double fallback = 0) const { return type_ == Type::Number ? number_ : fallback; }
    float asFloat(float fallback = 0) const { return static_cast<float>(asDouble(fallback)); }
    int asInt(int fallback = 0) const {
        return type_ == Type::Number ? static_cast<int>(number_) : fallback;
    }
    std::int64_t asInt64(std::int64_t fallback = 0) const {
        return type_ == Type::Number ? static_cast<std::int64_t>(number_) : fallback;
    }
    std::string asString(const std::string& fallback = {}) const {
        return type_ == Type::String ? string_ : fallback;
    }
    const std::string& stringRef() const { return string_; }

    // -- arrays
    std::size_t size() const {
        if (type_ == Type::Array) return array_.size();
        if (type_ == Type::Object) return order_.size();
        return 0;
    }
    Json& operator[](std::size_t i) { return array_[i]; }
    const Json& operator[](std::size_t i) const { return array_[i]; }
    void push(Json v) {
        if (type_ != Type::Array) { type_ = Type::Array; array_.clear(); }
        array_.push_back(std::move(v));
    }
    const std::vector<Json>& items() const { return array_; }
    std::vector<Json>& items() { return array_; }

    // -- objects
    bool contains(const std::string& key) const { return fields_.count(key) != 0; }

    /// Read-only lookup. Returns a shared null value when absent, so chained
    /// reads like `db["users"]["bob"]["admin"].asBool()` are safe on a partial
    /// document instead of needing a guard at every level.
    const Json& operator[](const std::string& key) const {
        auto it = fields_.find(key);
        return it == fields_.end() ? nullValue() : it->second;
    }

    /// Inserting lookup. Creates the key (as null) when absent.
    Json& operator[](const std::string& key) {
        if (type_ != Type::Object) { type_ = Type::Object; fields_.clear(); order_.clear(); }
        auto it = fields_.find(key);
        if (it == fields_.end()) {
            order_.push_back(key);
            it = fields_.emplace(key, Json{}).first;
        }
        return it->second;
    }

    void set(const std::string& key, Json value) { (*this)[key] = std::move(value); }
    void erase(const std::string& key);

    /// Object keys in insertion order.
    const std::vector<std::string>& keys() const { return order_; }

    // -- serialisation
    /// `indent` of 0 writes compact JSON with no whitespace.
    std::string dump(int indent = 0) const;

    /// Parses `text`. On failure returns false and fills `error`; `out` is
    /// left untouched, so a caller can keep whatever it already had.
    static bool parse(const std::string& text, Json& out, std::string& error);

    /// Convenience for callers with nothing to do about a parse failure.
    static Json parseOrNull(const std::string& text);

    static bool parseFile(const std::string& path, Json& out, std::string& error);
    bool writeFile(const std::string& path, int indent = 0) const;

private:
    static const Json& nullValue();
    void dumpTo(std::string& out, int indent, int depth) const;

    Type type_ = Type::Null;
    bool bool_ = false;
    double number_ = 0;
    std::string string_;
    std::vector<Json> array_;
    std::map<std::string, Json> fields_;
    std::vector<std::string> order_;
};

/// Escapes `in` as a JSON string body, including the surrounding quotes.
std::string jsonEscape(const std::string& in);

} // namespace flr
