#include "json.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>

namespace flix {

const Json& Json::nullValue() {
    static const Json kNull;
    return kNull;
}

void Json::erase(const std::string& key) {
    if (fields_.erase(key) == 0) return;
    for (auto it = order_.begin(); it != order_.end(); ++it) {
        if (*it == key) { order_.erase(it); break; }
    }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

std::string jsonEscape(const std::string& in) {
    std::string out;
    out.reserve(in.size() + 2);
    out += '"';
    for (const unsigned char c : in) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    // UTF-8 bytes pass through unescaped, which is valid JSON
                    // and keeps player names readable in the database file.
                    out += static_cast<char>(c);
                }
        }
    }
    out += '"';
    return out;
}

namespace {

/// Shortest representation that round-trips exactly, and never in exponent
/// form for values a game actually stores. Integers print without a ".0" tail
/// so an XP total reads as `12500`, matching what the JS writer produced.
std::string formatNumber(double v) {
    if (std::isnan(v) || std::isinf(v)) return "0";
    if (v == static_cast<double>(static_cast<std::int64_t>(v)) &&
        std::abs(v) < 9.2e18) {
        return std::to_string(static_cast<std::int64_t>(v));
    }
    char buf[40];
    // 17 significant digits always round-trips a double; trim back to the
    // shortest precision that still reads back identically.
    for (int precision = 6; precision <= 17; ++precision) {
        std::snprintf(buf, sizeof(buf), "%.*g", precision, v);
        if (std::strtod(buf, nullptr) == v) break;
    }
    return buf;
}

void writeIndent(std::string& out, int indent, int depth) {
    if (indent <= 0) return;
    out += '\n';
    out.append(static_cast<std::size_t>(indent * depth), ' ');
}

} // namespace

void Json::dumpTo(std::string& out, int indent, int depth) const {
    switch (type_) {
        case Type::Null: out += "null"; return;
        case Type::Bool: out += bool_ ? "true" : "false"; return;
        case Type::Number: out += formatNumber(number_); return;
        case Type::String: out += jsonEscape(string_); return;

        case Type::Array: {
            if (array_.empty()) { out += "[]"; return; }
            out += '[';
            for (std::size_t i = 0; i < array_.size(); ++i) {
                if (i) out += ',';
                writeIndent(out, indent, depth + 1);
                array_[i].dumpTo(out, indent, depth + 1);
            }
            writeIndent(out, indent, depth);
            out += ']';
            return;
        }

        case Type::Object: {
            if (order_.empty()) { out += "{}"; return; }
            out += '{';
            bool first = true;
            for (const std::string& key : order_) {
                auto it = fields_.find(key);
                if (it == fields_.end()) continue;
                if (!first) out += ',';
                first = false;
                writeIndent(out, indent, depth + 1);
                out += jsonEscape(key);
                out += ':';
                if (indent > 0) out += ' ';
                it->second.dumpTo(out, indent, depth + 1);
            }
            writeIndent(out, indent, depth);
            out += '}';
            return;
        }
    }
}

std::string Json::dump(int indent) const {
    std::string out;
    dumpTo(out, indent, 0);
    return out;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

namespace {

class Parser {
public:
    Parser(const std::string& text) : s_(text) {}

    bool parse(Json& out, std::string& error) {
        skipWhitespace();
        if (!parseValue(out)) { error = error_; return false; }
        skipWhitespace();
        if (pos_ != s_.size()) {
            error = fail("trailing data after top-level value");
            return false;
        }
        return true;
    }

private:
    const std::string& s_;
    std::size_t pos_ = 0;
    std::string error_;
    // Bounds recursion so a hostile or corrupt file cannot blow the C stack.
    int depth_ = 0;
    static constexpr int kMaxDepth = 200;

    std::string fail(const std::string& what) {
        error_ = what + " at offset " + std::to_string(pos_);
        return error_;
    }

    void skipWhitespace() {
        while (pos_ < s_.size()) {
            const char c = s_[pos_];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') ++pos_;
            else break;
        }
    }

    bool literal(const char* text) {
        const std::size_t n = std::strlen(text);
        if (s_.compare(pos_, n, text) != 0) return false;
        pos_ += n;
        return true;
    }

    bool parseValue(Json& out) {
        if (depth_ >= kMaxDepth) { fail("nesting too deep"); return false; }
        if (pos_ >= s_.size()) { fail("unexpected end of input"); return false; }

        switch (s_[pos_]) {
            case 'n': if (literal("null")) { out = Json(); return true; } break;
            case 't': if (literal("true")) { out = Json(true); return true; } break;
            case 'f': if (literal("false")) { out = Json(false); return true; } break;
            case '"': { std::string str; if (!parseString(str)) return false; out = Json(std::move(str)); return true; }
            case '[': return parseArray(out);
            case '{': return parseObject(out);
            default: return parseNumber(out);
        }
        fail("invalid literal");
        return false;
    }

    bool parseNumber(Json& out) {
        const char* begin = s_.c_str() + pos_;
        char* end = nullptr;
        const double v = std::strtod(begin, &end);
        if (end == begin) { fail("expected a value"); return false; }
        pos_ += static_cast<std::size_t>(end - begin);
        out = Json(v);
        return true;
    }

    bool parseString(std::string& out) {
        if (s_[pos_] != '"') { fail("expected '\"'"); return false; }
        ++pos_;
        out.clear();
        while (true) {
            if (pos_ >= s_.size()) { fail("unterminated string"); return false; }
            const char c = s_[pos_++];
            if (c == '"') return true;
            if (c != '\\') { out += c; continue; }
            if (pos_ >= s_.size()) { fail("unterminated escape"); return false; }
            const char esc = s_[pos_++];
            switch (esc) {
                case '"': out += '"'; break;
                case '\\': out += '\\'; break;
                case '/': out += '/'; break;
                case 'b': out += '\b'; break;
                case 'f': out += '\f'; break;
                case 'n': out += '\n'; break;
                case 'r': out += '\r'; break;
                case 't': out += '\t'; break;
                case 'u': {
                    unsigned int cp = 0;
                    if (!parseHex4(cp)) return false;
                    // A high surrogate must be joined with the low one that
                    // follows, or the re-encoded UTF-8 is mojibake.
                    if (cp >= 0xD800 && cp <= 0xDBFF && s_.compare(pos_, 2, "\\u") == 0) {
                        const std::size_t save = pos_;
                        pos_ += 2;
                        unsigned int low = 0;
                        if (parseHex4(low) && low >= 0xDC00 && low <= 0xDFFF) {
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                        } else {
                            pos_ = save;
                        }
                    }
                    appendUtf8(out, cp);
                    break;
                }
                default: fail("invalid escape"); return false;
            }
        }
    }

    bool parseHex4(unsigned int& out) {
        if (pos_ + 4 > s_.size()) { fail("truncated \\u escape"); return false; }
        out = 0;
        for (int i = 0; i < 4; ++i) {
            const char c = s_[pos_++];
            out <<= 4;
            if (c >= '0' && c <= '9') out |= static_cast<unsigned>(c - '0');
            else if (c >= 'a' && c <= 'f') out |= static_cast<unsigned>(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') out |= static_cast<unsigned>(c - 'A' + 10);
            else { fail("invalid hex in \\u escape"); return false; }
        }
        return true;
    }

    static void appendUtf8(std::string& out, unsigned int cp) {
        if (cp < 0x80) {
            out += static_cast<char>(cp);
        } else if (cp < 0x800) {
            out += static_cast<char>(0xC0 | (cp >> 6));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        } else if (cp < 0x10000) {
            out += static_cast<char>(0xE0 | (cp >> 12));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        } else {
            out += static_cast<char>(0xF0 | (cp >> 18));
            out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        }
    }

    bool parseArray(Json& out) {
        ++pos_; // '['
        ++depth_;
        out = Json::array();
        skipWhitespace();
        if (pos_ < s_.size() && s_[pos_] == ']') { ++pos_; --depth_; return true; }
        while (true) {
            skipWhitespace();
            Json element;
            if (!parseValue(element)) return false;
            out.push(std::move(element));
            skipWhitespace();
            if (pos_ >= s_.size()) { fail("unterminated array"); return false; }
            if (s_[pos_] == ',') { ++pos_; continue; }
            if (s_[pos_] == ']') { ++pos_; --depth_; return true; }
            fail("expected ',' or ']'");
            return false;
        }
    }

    bool parseObject(Json& out) {
        ++pos_; // '{'
        ++depth_;
        out = Json::object();
        skipWhitespace();
        if (pos_ < s_.size() && s_[pos_] == '}') { ++pos_; --depth_; return true; }
        while (true) {
            skipWhitespace();
            std::string key;
            if (!parseString(key)) return false;
            skipWhitespace();
            if (pos_ >= s_.size() || s_[pos_] != ':') { fail("expected ':'"); return false; }
            ++pos_;
            skipWhitespace();
            Json value;
            if (!parseValue(value)) return false;
            out[key] = std::move(value);
            skipWhitespace();
            if (pos_ >= s_.size()) { fail("unterminated object"); return false; }
            if (s_[pos_] == ',') { ++pos_; continue; }
            if (s_[pos_] == '}') { ++pos_; --depth_; return true; }
            fail("expected ',' or '}'");
            return false;
        }
    }
};

} // namespace

bool Json::parse(const std::string& text, Json& out, std::string& error) {
    Parser parser(text);
    Json parsed;
    if (!parser.parse(parsed, error)) return false;
    out = std::move(parsed);
    return true;
}

Json Json::parseOrNull(const std::string& text) {
    Json out;
    std::string error;
    if (!parse(text, out, error)) return Json();
    return out;
}

bool Json::parseFile(const std::string& path, Json& out, std::string& error) {
    std::ifstream in(path, std::ios::binary);
    if (!in) { error = "cannot open " + path; return false; }
    std::ostringstream buffer;
    buffer << in.rdbuf();
    return parse(buffer.str(), out, error);
}

bool Json::writeFile(const std::string& path, int indent) const {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) return false;
    const std::string text = dump(indent);
    out.write(text.data(), static_cast<std::streamsize>(text.size()));
    return out.good();
}

} // namespace flix
