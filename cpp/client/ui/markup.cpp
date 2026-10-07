#include "client/ui/markup.h"

#include "shared/game/chat_images.h"
#include "shared/game/html_entities.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>

namespace flix::ui {

namespace {

char lower(char c) { return static_cast<char>(std::tolower(static_cast<unsigned char>(c))); }

bool nameChar(char c) {
    const unsigned char u = static_cast<unsigned char>(c);
    return std::isalnum(u) != 0 || c == '-' || c == '_' || c == ':';
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
        // A value is markup too -- "&amp;" in a query string is how a
        // well-formed line spells '&' -- and is decoded here, once, under
        // the attribute rule (html_entities.h).
        out.attributes.emplace_back(std::move(name), decodeCharacterReferences(value, true));
    }
    if (i >= s.size()) return false;   // unterminated: not a tag
    out.end = i + 1;
    return true;
}

enum class TagKind {
    Styling,    ///< push a style, pop it at the close
    Break,      ///< a hard line break, no content of its own
    Rich,       ///< <a>: styling in a web build, dropped in a native one
    Image,      ///< <img>: a span of its own carrying the src
    Dropped,    ///< dropped with its content, in every build
};

TagKind classify(const std::string& name) {
    if (name == "b" || name == "strong" || name == "i" || name == "em" || name == "u" ||
        name == "blink" || name == "span" || name == "font" || name == "color" ||
        name == "code" || name == "pre") {
        return TagKind::Styling;
    }
    if (name == "br" || name == "wbr") return TagKind::Break;
    if (name == "a") return TagKind::Rich;
    if (name == "img") return TagKind::Image;
    // script and iframe land here with everything else, and that is the point:
    // there is no branch anywhere in this file that runs a script or opens an
    // embed, so there is nothing for a chat line to reach.
    return TagKind::Dropped;
}

bool voidTag(const std::string& name) { return name == "br" || name == "wbr" || name == "img"; }

/// Whether `url` is one a page may fetch: http(s), and nothing a browser
/// would run or read off the disk.
bool fetchableUrl(const std::string& url) {
    std::string scheme;
    for (const char c : url.substr(0, 8)) scheme.push_back(lower(c));
    return scheme.rfind("http://", 0) == 0 || scheme.rfind("https://", 0) == 0;
}

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
            if (fetchableUrl(value)) style.href = value;
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

    // <code>/<pre> elements opened so far, which is what numbers the next.
    int codeElements = 0;
    // A <pre> is a block: whatever follows it starts a row of its own. The
    // break is held until something does follow, so a message that ENDS on a
    // block does not grow an empty row under it.
    bool breakOwed = false;

    const auto current = [&]() {
        MarkupSpan style = stack.empty() ? MarkupSpan{} : stack.back().style;
        style.text.clear();
        style.lineBreak = false;
        return style;
    };
    const auto pushBreak = [&]() {
        MarkupSpan span = current();
        span.lineBreak = true;
        spans.push_back(std::move(span));
    };
    const auto payOwedBreak = [&]() {
        if (!breakOwed) return;
        breakOwed = false;
        pushBreak();
    };
    // Whether the next thing emitted would start a row of its own anyway.
    const auto atRowStart = [&]() { return spans.empty() || spans.back().lineBreak; };

    std::string pending;
    const auto emitText = [&](std::string text) {
        if (text.empty()) return;
        payOwedBreak();
        MarkupSpan span = current();
        span.text = std::move(text);
        spans.push_back(std::move(span));
    };
    const auto flush = [&]() {
        if (pending.empty()) return;
        const bool pre = !stack.empty() && stack.back().style.preformatted;
        if (!pre) {
            emitText(pending);
        } else {
            // Inside a <pre> a newline is a line, not a space.
            std::size_t at = 0;
            while (true) {
                const std::size_t newline = pending.find('\n', at);
                std::string line = pending.substr(
                    at, newline == std::string::npos ? std::string::npos : newline - at);
                line.erase(std::remove(line.begin(), line.end(), '\r'), line.end());
                emitText(std::move(line));
                if (newline == std::string::npos) break;
                payOwedBreak();
                pushBreak();
                at = newline + 1;
            }
        }
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
                payOwedBreak();
                pushBreak();
                continue;
            }

            if (kind == TagKind::Image) {
                if (tag.closing) continue;
                // The first src wins, as it does in a browser -- and in the
                // server's own check, which must read the same one.
                std::string decoded;
                bool found = false;
                for (const auto& [name, value] : tag.attributes) {
                    if (name == "src" && !found) {
                        decoded = value;
                        found = true;
                    }
                }
                // Only the image hosts the server lets through. It strips the
                // rest before a line goes out; this is the backstop for one
                // that arrives anyway.
                if (!chatImageUrlAllowed(decoded)) continue;
                flush();
                payOwedBreak();
                MarkupSpan span = current();
                span.image = std::move(decoded);
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
                        if (tag.name == "pre") breakOwed = true;
                        break;
                    }
                }
                continue;
            }

            flush();
            if (tag.name == "pre" && !tag.selfClosing && !atRowStart()) breakOwed = true;
            Frame frame;
            frame.tag = tag.name;
            frame.style = current();
            if ((tag.name == "code" || tag.name == "pre") && frame.style.code == 0) {
                frame.style.code = ++codeElements;
            }
            if (tag.name == "pre") {
                frame.style.preformatted = true;
                // A browser ignores the newline straight after <pre>, so the
                // block can open on a line of its own in the source.
                if (source.compare(at, 2, "\r\n") == 0) at += 2;
                else if (at < source.size() && source[at] == '\n') ++at;
            }
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
            decodeCharacterReference(source, at, pending);
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
        else if (!span.image.empty()) out += "[image]";
        else out += span.text;
    }
    // A flat string has no row to keep "&nbsp;" from breaking across, and its
    // reader may not have the glyph: it goes back to being a space.
    for (std::size_t at = out.find(kNoBreakSpace); at != std::string::npos;
         at = out.find(kNoBreakSpace, at + 1)) {
        out.replace(at, 2, " ");
    }
    return out;
}

} // namespace flix::ui
