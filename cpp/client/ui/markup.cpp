#include "client/ui/markup.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>

namespace flr::ui {

namespace {

char lower(char c) { return static_cast<char>(std::tolower(static_cast<unsigned char>(c))); }

bool nameChar(char c) {
    const unsigned char u = static_cast<unsigned char>(c);
    return std::isalnum(u) != 0 || c == '-' || c == '_' || c == ':';
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/// Appends the UTF-8 encoding of `cp`. Chat is UTF-8 on the wire and the text
/// layer measures UTF-8, so a numeric entity has to arrive as bytes, not as a
/// code point somebody downstream has to widen.
void appendUtf8(std::string& out, std::uint32_t cp) {
    if (cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return;
    if (cp < 0x80) {
        out.push_back(static_cast<char>(cp));
    } else if (cp < 0x800) {
        out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp < 0x10000) {
        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
}

/// Decodes the entity starting at `at` (which indexes the '&'), appending to
/// `out` and advancing `at` past it. A run of characters that is not an entity
/// is left as the literal '&' it is -- "Tom & Jerry" must survive.
void decodeEntity(const std::string& s, std::size_t& at, std::string& out) {
    const std::size_t semicolon = s.find(';', at + 1);
    // Entity names are short; a ';' far away belongs to something else.
    if (semicolon == std::string::npos || semicolon - at > 10) {
        out.push_back(s[at++]);
        return;
    }
    const std::string body = s.substr(at + 1, semicolon - at - 1);
    if (body.empty()) {
        out.push_back(s[at++]);
        return;
    }

    if (body[0] == '#') {
        const bool hex = body.size() > 1 && (body[1] == 'x' || body[1] == 'X');
        const std::string digits = body.substr(hex ? 2 : 1);
        if (digits.empty()) {
            out.push_back(s[at++]);
            return;
        }
        for (const char c : digits) {
            const bool ok = hex ? std::isxdigit(static_cast<unsigned char>(c)) != 0
                                : std::isdigit(static_cast<unsigned char>(c)) != 0;
            if (!ok) {
                out.push_back(s[at++]);
                return;
            }
        }
        appendUtf8(out, static_cast<std::uint32_t>(std::strtoul(digits.c_str(), nullptr, hex ? 16 : 10)));
        at = semicolon + 1;
        return;
    }

    std::string name;
    for (const char c : body) name.push_back(lower(c));
    // The named entities the server and the command help text actually use.
    // Anything else stays literal rather than silently vanishing.
    const char* replacement = nullptr;
    if (name == "lt") replacement = "<";
    else if (name == "gt") replacement = ">";
    else if (name == "amp") replacement = "&";
    else if (name == "quot") replacement = "\"";
    else if (name == "apos") replacement = "'";
    else if (name == "nbsp") replacement = " ";
    if (replacement == nullptr) {
        out.push_back(s[at++]);
        return;
    }
    out += replacement;
    at = semicolon + 1;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

int hexDigit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

/// `#rgb`, `#rrggbb`, `rgb(r, g, b)` and the CSS colour keywords the server
/// spells out by name. Alpha is deliberately not carried: the transcript's
/// runs are drawn opaque over their own outline, and a translucent fill there
/// would thin the outline rather than fade the text.
bool parseCssColor(const std::string& in, std::uint32_t& out) {
    std::string s;
    for (const char c : in) {
        if (c != ' ' && c != '\t') s.push_back(lower(c));
    }
    if (s.empty()) return false;

    if (s[0] == '#') {
        const std::string body = s.substr(1);
        if (body.size() != 3 && body.size() != 6 && body.size() != 8) return false;
        int d[8];
        for (std::size_t i = 0; i < body.size(); ++i) {
            d[i] = hexDigit(body[i]);
            if (d[i] < 0) return false;
        }
        if (body.size() == 3) {
            out = static_cast<std::uint32_t>((d[0] * 17) << 16 | (d[1] * 17) << 8 | (d[2] * 17));
        } else {
            out = static_cast<std::uint32_t>((d[0] * 16 + d[1]) << 16 | (d[2] * 16 + d[3]) << 8 |
                                             (d[4] * 16 + d[5]));
        }
        return true;
    }

    if (s.rfind("rgb(", 0) == 0 || s.rfind("rgba(", 0) == 0) {
        const std::size_t open = s.find('(');
        const std::size_t close = s.find(')', open);
        if (close == std::string::npos) return false;
        int parts[3] = {0, 0, 0};
        int count = 0;
        std::size_t at = open + 1;
        while (at < close && count < 3) {
            const std::size_t comma = std::min(s.find(',', at), close);
            const std::string field = s.substr(at, comma - at);
            if (field.empty()) return false;
            const long v = std::strtol(field.c_str(), nullptr, 10);
            parts[count++] = static_cast<int>(std::clamp<long>(v, 0, 255));
            at = comma + 1;
        }
        if (count < 3) return false;
        out = static_cast<std::uint32_t>(parts[0] << 16 | parts[1] << 8 | parts[2]);
        return true;
    }

    struct Named { const char* name; std::uint32_t rgb; };
    static const Named kNamed[] = {
        {"black", 0x000000u},   {"white", 0xFFFFFFu},   {"red", 0xFF0000u},
        {"lime", 0x00FF00u},    {"green", 0x008000u},   {"blue", 0x0000FFu},
        {"yellow", 0xFFFF00u},  {"cyan", 0x00FFFFu},    {"aqua", 0x00FFFFu},
        {"magenta", 0xFF00FFu}, {"fuchsia", 0xFF00FFu}, {"orange", 0xFFA500u},
        {"gray", 0x808080u},    {"grey", 0x808080u},    {"silver", 0xC0C0C0u},
        {"purple", 0x800080u},  {"pink", 0xFFC0CBu},    {"gold", 0xFFD700u},
        {"navy", 0x000080u},    {"teal", 0x008080u},    {"olive", 0x808000u},
        {"maroon", 0x800000u},  {"cornflowerblue", 0x6495EDu},
    };
    for (const Named& named : kNamed) {
        if (s == named.name) {
            out = named.rgb;
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/// One parsed `<...>`.
struct Tag {
    std::string name;       ///< lower-cased, empty when this was not a tag
    bool closing = false;
    bool selfClosing = false;
    /// Only the attributes markup is allowed to carry meaning in, already
    /// lower-cased on the name side and raw on the value side.
    std::vector<std::pair<std::string, std::string>> attributes;
    std::size_t end = 0;    ///< index just past the '>'
};

/// Reads the tag starting at `at` (which indexes the '<'). Returns false when
/// what follows is not a tag at all, in which case the '<' is a literal
/// character -- browsers treat "a < b" as text and so does this.
bool readTag(const std::string& s, std::size_t at, Tag& out) {
    std::size_t i = at + 1;
    if (i >= s.size()) return false;
    if (s[i] == '/') {
        out.closing = true;
        ++i;
    }
    if (i >= s.size() || std::isalpha(static_cast<unsigned char>(s[i])) == 0) return false;
    while (i < s.size() && nameChar(s[i])) out.name.push_back(lower(s[i++]));

    while (i < s.size() && s[i] != '>') {
        while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) ++i;
        if (i < s.size() && s[i] == '/') {
            out.selfClosing = true;
            ++i;
            continue;
        }
        if (i >= s.size() || s[i] == '>') break;

        std::string name;
        while (i < s.size() && nameChar(s[i])) name.push_back(lower(s[i++]));
        if (name.empty()) {
            // Junk inside the tag. Skip the byte rather than spinning.
            ++i;
            continue;
        }
        while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) ++i;
        std::string value;
        if (i < s.size() && s[i] == '=') {
            ++i;
            while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) ++i;
            if (i < s.size() && (s[i] == '"' || s[i] == '\'')) {
                const char quote = s[i++];
                while (i < s.size() && s[i] != quote) value.push_back(s[i++]);
                if (i < s.size()) ++i;
            } else {
                while (i < s.size() && !std::isspace(static_cast<unsigned char>(s[i])) &&
                       s[i] != '>') {
                    value.push_back(s[i++]);
                }
            }
        }
        out.attributes.emplace_back(std::move(name), std::move(value));
    }
    if (i >= s.size()) return false;   // unterminated: not a tag
    out.end = i + 1;
    return true;
}

enum class TagKind {
    Styling,    ///< push a style, pop it at the close
    Break,      ///< a hard line break, no content of its own
    Rich,       ///< <a>/<img>: styling in a web build, dropped in a native one
    Dropped,    ///< dropped with its content, in every build
};

TagKind classify(const std::string& name) {
    if (name == "b" || name == "strong" || name == "i" || name == "em" || name == "u" ||
        name == "blink" || name == "span" || name == "font" || name == "color") {
        return TagKind::Styling;
    }
    if (name == "br" || name == "wbr") return TagKind::Break;
    if (name == "a") return TagKind::Rich;
    // <img> is dropped rather than rich even in a web build: the transcript is
    // drawn with glyph outlines, not elements, so there is nowhere to put a
    // picture. It is void, so dropping it costs no text.
    if (name == "img") return TagKind::Dropped;
    // script and iframe land here with everything else, and that is the point:
    // there is no branch anywhere in this file that runs a script or opens an
    // embed, so there is nothing for a chat line to reach.
    return TagKind::Dropped;
}

bool voidTag(const std::string& name) { return name == "br" || name == "wbr" || name == "img"; }

/// The style in force at one point in the walk.
struct Frame {
    std::string tag;
    MarkupSpan style;
};

/// Folds a tag's own attributes into the style it pushes.
void applyAttributes(const Tag& tag, MarkupSpan& style) {
    for (const auto& [name, value] : tag.attributes) {
        if (name == "color") {
            std::uint32_t rgb = 0;
            if (parseCssColor(value, rgb)) {
                style.color = rgb;
                style.hasColor = true;
            }
        } else if (name == "style") {
            // Only `color:` is read. The browser sanitiser also kept
            // `animation:`, but that was how it drove <blink>, which is a tag
            // here rather than a declaration.
            std::size_t at = 0;
            while (at < value.size()) {
                const std::size_t semicolon = value.find(';', at);
                const std::string declaration =
                    value.substr(at, semicolon == std::string::npos ? std::string::npos
                                                                    : semicolon - at);
                const std::size_t colon = declaration.find(':');
                if (colon != std::string::npos) {
                    std::string property;
                    for (const char c : declaration.substr(0, colon)) {
                        if (!std::isspace(static_cast<unsigned char>(c))) property.push_back(lower(c));
                    }
                    if (property == "color") {
                        std::uint32_t rgb = 0;
                        if (parseCssColor(declaration.substr(colon + 1), rgb)) {
                            style.color = rgb;
                            style.hasColor = true;
                        }
                    }
                }
                if (semicolon == std::string::npos) break;
                at = semicolon + 1;
            }
        } else if (name == "href" && kWebMarkup) {
            // Only a real scheme, and only in a build that has a page to open
            // it in. A `javascript:` href is exactly what this whole file
            // exists to refuse.
            std::string scheme;
            for (const char c : value.substr(0, 8)) scheme.push_back(lower(c));
            if (scheme.rfind("http://", 0) == 0 || scheme.rfind("https://", 0) == 0) {
                style.href = value;
            }
        }
    }
}

} // namespace

std::vector<MarkupSpan> parseMarkup(const std::string& source) {
    std::vector<MarkupSpan> spans;
    std::vector<Frame> stack;
    // Set while inside a dropped element, along with the tag that opened it so
    // a nested copy of the same tag closes the inner one first.
    std::string suppressed;
    int suppressDepth = 0;

    std::string pending;
    const auto flush = [&]() {
        if (pending.empty()) return;
        MarkupSpan span = stack.empty() ? MarkupSpan{} : stack.back().style;
        span.text = pending;
        span.lineBreak = false;
        spans.push_back(std::move(span));
        pending.clear();
    };

    std::size_t at = 0;
    while (at < source.size()) {
        const char c = source[at];

        if (c == '<') {
            // A comment is not a tag and readTag would refuse it; skip it
            // whole so its body never reaches the transcript.
            if (source.compare(at, 4, "<!--") == 0) {
                const std::size_t end = source.find("-->", at + 4);
                at = end == std::string::npos ? source.size() : end + 3;
                continue;
            }
            Tag tag;
            if (!readTag(source, at, tag)) {
                if (suppressDepth == 0) pending.push_back(c);
                ++at;
                continue;
            }
            at = tag.end;

            if (suppressDepth > 0) {
                // Inside dropped content: the only thing that matters is
                // finding the close that ends it.
                if (tag.name == suppressed && !voidTag(tag.name)) {
                    if (tag.closing) --suppressDepth;
                    else if (!tag.selfClosing) ++suppressDepth;
                }
                continue;
            }

            TagKind kind = classify(tag.name);
            if (kind == TagKind::Rich && !kWebMarkup) kind = TagKind::Dropped;

            if (kind == TagKind::Break) {
                flush();
                MarkupSpan span = stack.empty() ? MarkupSpan{} : stack.back().style;
                span.text.clear();
                span.lineBreak = true;
                spans.push_back(std::move(span));
                continue;
            }

            if (kind == TagKind::Dropped) {
                if (tag.closing || tag.selfClosing || voidTag(tag.name)) continue;
                flush();
                suppressed = tag.name;
                suppressDepth = 1;
                continue;
            }

            // Styling and (web-only) rich tags share one stack.
            if (tag.closing) {
                flush();
                // Pop to the matching open. An unbalanced close is ignored,
                // which is what a browser's parser does with one.
                for (std::size_t i = stack.size(); i-- > 0;) {
                    if (stack[i].tag == tag.name) {
                        stack.resize(i);
                        break;
                    }
                }
                continue;
            }

            flush();
            Frame frame;
            frame.tag = tag.name;
            frame.style = stack.empty() ? MarkupSpan{} : stack.back().style;
            frame.style.text.clear();
            frame.style.lineBreak = false;
            if (tag.name == "b" || tag.name == "strong") frame.style.bold = true;
            if (tag.name == "i" || tag.name == "em") frame.style.italic = true;
            if (tag.name == "u") frame.style.underline = true;
            if (tag.name == "blink") frame.style.blink = true;
            if (tag.name == "a") frame.style.underline = true;
            applyAttributes(tag, frame.style);
            if (tag.name == "a" && frame.style.href.empty()) {
                // A link with nothing safe to open is just its own label.
                frame.style.underline = false;
            }
            if (!tag.selfClosing && !voidTag(tag.name)) stack.push_back(std::move(frame));
            continue;
        }

        if (suppressDepth > 0) {
            ++at;
            continue;
        }

        if (c == '&') {
            decodeEntity(source, at, pending);
            continue;
        }

        pending.push_back(c);
        ++at;
    }
    flush();
    return spans;
}

std::string markupPlainText(const std::string& source) {
    std::string out;
    for (const MarkupSpan& span : parseMarkup(source)) {
        if (span.lineBreak) out.push_back('\n');
        else out += span.text;
    }
    return out;
}

} // namespace flr::ui
