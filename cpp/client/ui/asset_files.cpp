#include "client/ui/asset_files.h"

#include <algorithm>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace flix::ui::assets {

namespace {

std::string lowered(std::string text) {
    for (char& c : text) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return text;
}

bool isDigit(char c) { return c >= '0' && c <= '9'; }
bool isAlpha(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
bool isSpace(char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\f'; }

/// Appends a run, folding it into the last one when that is the same colour
/// and ends where this one starts.
void push(std::vector<Span>& spans, std::size_t begin, std::size_t end, Token token) {
    if (end <= begin) return;
    if (!spans.empty() && spans.back().token == token && spans.back().end == begin) {
        spans.back().end = end;
        return;
    }
    spans.push_back({begin, end, token});
}

/// The end of the quoted run opening at `at`: just past its closing quote, or
/// the end of the line for one that does not close on it.
std::size_t scanString(const std::string& line, std::size_t at, char quote, bool escapes) {
    std::size_t i = at + 1;
    while (i < line.size()) {
        if (escapes && line[i] == '\\') {
            i += 2;
            continue;
        }
        if (line[i] == quote) return i + 1;
        ++i;
    }
    return line.size();
}

/// The end of a number starting at `at`: digits, a point, an exponent with its
/// sign, and the letters a hex literal or a BigInt suffix needs.
std::size_t scanNumber(const std::string& line, std::size_t at) {
    std::size_t i = at;
    if (line[i] == '-') ++i;
    while (i < line.size()) {
        const char c = line[i];
        const bool exponentSign = (c == '-' || c == '+') && i > at &&
                                  (line[i - 1] == 'e' || line[i - 1] == 'E') &&
                                  line.compare(at, 2, "0x") != 0;
        if (isDigit(c) || isAlpha(c) || c == '.' || c == '_' || exponentSign) {
            ++i;
            continue;
        }
        break;
    }
    return i;
}

std::size_t scanWord(const std::string& line, std::size_t at, const char* extra) {
    std::size_t i = at;
    while (i < line.size() &&
           (isAlpha(line[i]) || isDigit(line[i]) || std::strchr(extra, line[i]) != nullptr ||
            static_cast<unsigned char>(line[i]) >= 0x80)) {
        ++i;
    }
    return i;
}

bool isScriptKeyword(const std::string& word) {
    static const char* const kKeywords[] = {
        "async",    "await",  "break",      "case",   "catch",  "class",  "const",
        "continue", "default", "delete",    "do",     "else",   "export", "extends",
        "false",    "finally", "for",       "from",   "function", "if",   "import",
        "in",       "instanceof", "let",    "new",    "null",   "of",     "return",
        "static",   "super",  "switch",     "this",   "throw",  "true",   "try",
        "typeof",   "undefined", "var",     "void",   "while",  "yield",
    };
    for (const char* keyword : kKeywords) {
        if (word == keyword) return true;
    }
    return false;
}

void highlightJson(const std::string& line, std::vector<Span>& spans) {
    std::size_t i = 0;
    while (i < line.size()) {
        const char c = line[i];
        if (c == '"') {
            const std::size_t end = scanString(line, i, '"', true);
            // A string followed by a colon is a key.
            std::size_t next = end;
            while (next < line.size() && isSpace(line[next])) ++next;
            push(spans, i, end,
                 next < line.size() && line[next] == ':' ? Token::Attribute : Token::String);
            i = end;
        } else if (isDigit(c) || (c == '-' && i + 1 < line.size() && isDigit(line[i + 1]))) {
            const std::size_t end = scanNumber(line, i);
            push(spans, i, end, Token::Number);
            i = end;
        } else if (isAlpha(c)) {
            const std::size_t end = scanWord(line, i, "_");
            const std::string word = line.substr(i, end - i);
            push(spans, i, end,
                 word == "true" || word == "false" || word == "null" ? Token::Keyword
                                                                     : Token::Text);
            i = end;
        } else if (std::strchr("{}[],:", c) != nullptr && c != '\0') {
            push(spans, i, i + 1, Token::Punctuation);
            ++i;
        } else {
            push(spans, i, i + 1, Token::Text);
            ++i;
        }
    }
}

void highlightScript(const std::string& line, std::vector<Span>& spans) {
    std::size_t i = 0;
    while (i < line.size()) {
        const char c = line[i];
        const char next = i + 1 < line.size() ? line[i + 1] : '\0';
        if (c == '/' && next == '/') {
            push(spans, i, line.size(), Token::Comment);
            break;
        }
        if (c == '/' && next == '*') {
            const std::size_t close = line.find("*/", i + 2);
            const std::size_t end = close == std::string::npos ? line.size() : close + 2;
            push(spans, i, end, Token::Comment);
            i = end;
        } else if (c == '"' || c == '\'' || c == '`') {
            const std::size_t end = scanString(line, i, c, true);
            push(spans, i, end, Token::String);
            i = end;
        } else if (isDigit(c)) {
            const std::size_t end = scanNumber(line, i);
            push(spans, i, end, Token::Number);
            i = end;
        } else if (isAlpha(c) || c == '_' || c == '$') {
            const std::size_t end = scanWord(line, i, "_$");
            push(spans, i, end,
                 isScriptKeyword(line.substr(i, end - i)) ? Token::Keyword : Token::Text);
            i = end;
        } else if (std::strchr("{}[]()<>=+-*/%!&|^~?:;,.", c) != nullptr && c != '\0') {
            push(spans, i, i + 1, Token::Punctuation);
            ++i;
        } else {
            push(spans, i, i + 1, Token::Text);
            ++i;
        }
    }
}

void highlightMarkup(const std::string& line, std::vector<Span>& spans) {
    // A line that opens on an attribute is inside a tag begun above it: the
    // attribute list an SVG writes one to a line.
    std::size_t first = 0;
    while (first < line.size() && isSpace(line[first])) ++first;
    bool inTag = first < line.size() && line[first] != '<' &&
                 (isAlpha(line[first]) || line[first] == '_' || line[first] == ':') &&
                 (line.find("=\"") != std::string::npos || line.find("='") != std::string::npos);

    std::size_t i = 0;
    while (i < line.size()) {
        const char c = line[i];
        if (!inTag) {
            if (line.compare(i, 4, "<!--") == 0) {
                const std::size_t close = line.find("-->", i + 4);
                const std::size_t end = close == std::string::npos ? line.size() : close + 3;
                push(spans, i, end, Token::Comment);
                i = end;
            } else if (c == '<') {
                std::size_t end = i + 1;
                if (end < line.size() && (line[end] == '/' || line[end] == '?' || line[end] == '!')) {
                    ++end;
                }
                end = scanWord(line, end, "-_:.");
                push(spans, i, end, Token::Tag);
                i = end;
                inTag = true;
            } else {
                std::size_t end = line.find('<', i);
                if (end == std::string::npos) end = line.size();
                push(spans, i, end, Token::Text);
                i = end;
            }
            continue;
        }
        const char next = i + 1 < line.size() ? line[i + 1] : '\0';
        if (c == '>') {
            push(spans, i, i + 1, Token::Tag);
            ++i;
            inTag = false;
        } else if ((c == '/' || c == '?') && next == '>') {
            push(spans, i, i + 2, Token::Tag);
            i += 2;
            inTag = false;
        } else if (c == '"' || c == '\'') {
            const std::size_t end = scanString(line, i, c, false);
            push(spans, i, end, Token::String);
            i = end;
        } else if (isAlpha(c) || c == '_' || c == ':') {
            const std::size_t end = scanWord(line, i, "-_:.");
            push(spans, i, end, Token::Attribute);
            i = end;
        } else if (c == '=') {
            push(spans, i, i + 1, Token::Punctuation);
            ++i;
        } else {
            push(spans, i, i + 1, Token::Text);
            ++i;
        }
    }
}

} // namespace

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

bool listDirectory(const std::string& path, std::vector<Entry>& out, std::string& error) {
    out.clear();
    DIR* dir = ::opendir(path.empty() ? "." : path.c_str());
    if (dir == nullptr) {
        error = std::strerror(errno);
        return false;
    }
    while (const dirent* item = ::readdir(dir)) {
        Entry entry;
        entry.name = item->d_name;
        if (entry.name == "." || entry.name == "..") continue;
        struct stat info {};
        if (::stat(joinPath(path, entry.name).c_str(), &info) == 0) {
            entry.directory = S_ISDIR(info.st_mode);
            if (!entry.directory) entry.size = static_cast<std::uint64_t>(info.st_size);
        }
        out.push_back(std::move(entry));
    }
    ::closedir(dir);
    std::sort(out.begin(), out.end(), [](const Entry& a, const Entry& b) {
        if (a.directory != b.directory) return a.directory;
        const std::string la = lowered(a.name);
        const std::string lb = lowered(b.name);
        if (la != lb) return la < lb;
        return a.name < b.name;
    });
    return true;
}

bool isDirectory(const std::string& path) {
    struct stat info {};
    return ::stat(path.c_str(), &info) == 0 && S_ISDIR(info.st_mode);
}

bool exists(const std::string& path) {
    struct stat info {};
    return ::stat(path.c_str(), &info) == 0;
}

std::string joinPath(const std::string& dir, const std::string& name) {
    if (dir.empty() || dir == ".") return name;
    if (dir.back() == '/') return dir + name;
    return dir + "/" + name;
}

std::string parentPath(const std::string& path) {
    if (path.empty()) return ".";
    if (path == "." || path == "/") return path;
    std::string trimmed = path;
    while (trimmed.size() > 1 && trimmed.back() == '/') trimmed.pop_back();
    const std::size_t slash = trimmed.find_last_of('/');
    if (slash == std::string::npos) return ".";
    if (slash == 0) return "/";
    return trimmed.substr(0, slash);
}

std::string baseName(const std::string& path) {
    std::string trimmed = path;
    while (trimmed.size() > 1 && trimmed.back() == '/') trimmed.pop_back();
    const std::size_t slash = trimmed.find_last_of('/');
    return slash == std::string::npos || trimmed == "/" ? trimmed : trimmed.substr(slash + 1);
}

std::string extensionOf(const std::string& name) {
    const std::string base = baseName(name);
    const std::size_t dot = base.find_last_of('.');
    if (dot == std::string::npos || dot == 0) return {};
    return lowered(base.substr(dot + 1));
}

bool validFileName(const std::string& name) {
    if (name.empty() || name == "." || name == ".." || name.size() > 255) return false;
    for (const char c : name) {
        if (c == '/' || c == '\\' || c == '\0') return false;
    }
    return true;
}

bool readWhole(const std::string& path, std::string& out, std::size_t limit, std::string& error) {
    struct stat info {};
    if (::stat(path.c_str(), &info) != 0) {
        error = std::strerror(errno);
        return false;
    }
    if (S_ISDIR(info.st_mode)) {
        error = "it is a folder";
        return false;
    }
    if (static_cast<std::uint64_t>(info.st_size) > limit) {
        error = "too large to open here (" + formatSize(static_cast<std::uint64_t>(info.st_size)) +
                ")";
        return false;
    }
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        error = std::strerror(errno);
        return false;
    }
    std::ostringstream buffer;
    buffer << in.rdbuf();
    out = buffer.str();
    return true;
}

bool writeWhole(const std::string& path, const std::string& bytes, std::string& error) {
    // Truncated in place rather than written beside and renamed: a file in the
    // browser-storage mount is paired with its storage key by the file object
    // itself, and a rename would hand the key a file it has never heard of
    // (client/web/persist.cpp).
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) {
        error = std::strerror(errno);
        return false;
    }
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    out.flush();
    if (!out) {
        error = "the write did not complete";
        return false;
    }
    return true;
}

bool createFile(const std::string& path, std::string& error) {
    const int fd = ::open(path.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0644);
    if (fd < 0) {
        error = errno == EEXIST ? "there is already a file of that name" : std::strerror(errno);
        return false;
    }
    ::close(fd);
    return true;
}

bool removeFile(const std::string& path, std::string& error) {
    if (::unlink(path.c_str()) != 0) {
        error = std::strerror(errno);
        return false;
    }
    return true;
}

bool looksLikeText(const std::string& bytes) {
    std::size_t i = 0;
    while (i < bytes.size()) {
        const auto lead = static_cast<unsigned char>(bytes[i]);
        if (lead < 0x80) {
            if (lead < 0x20 && lead != '\t' && lead != '\n' && lead != '\r' && lead != '\f') {
                return false;
            }
            if (lead == 0x7F) return false;
            ++i;
            continue;
        }
        // The length a lead byte promises, and the smallest code point a
        // sequence that long may spell -- anything under it is an overlong
        // encoding, which no text file holds.
        std::size_t length = 0;
        std::uint32_t point = 0;
        std::uint32_t smallest = 0;
        if ((lead & 0xE0) == 0xC0) { length = 2; point = lead & 0x1F; smallest = 0x80; }
        else if ((lead & 0xF0) == 0xE0) { length = 3; point = lead & 0x0F; smallest = 0x800; }
        else if ((lead & 0xF8) == 0xF0) { length = 4; point = lead & 0x07; smallest = 0x10000; }
        else return false;
        if (i + length > bytes.size()) return false;
        for (std::size_t k = 1; k < length; ++k) {
            const auto next = static_cast<unsigned char>(bytes[i + k]);
            if ((next & 0xC0) != 0x80) return false;
            point = (point << 6) | (next & 0x3F);
        }
        if (point < smallest || point > 0x10FFFF || (point >= 0xD800 && point <= 0xDFFF)) {
            return false;
        }
        i += length;
    }
    return true;
}

std::string formatSize(std::uint64_t bytes) {
    char buffer[32];
    if (bytes < 1024) {
        std::snprintf(buffer, sizeof buffer, "%llu B", static_cast<unsigned long long>(bytes));
    } else if (bytes < 1024ull * 1024ull) {
        std::snprintf(buffer, sizeof buffer, "%.1f KB", static_cast<double>(bytes) / 1024.0);
    } else {
        std::snprintf(buffer, sizeof buffer, "%.1f MB",
                      static_cast<double>(bytes) / (1024.0 * 1024.0));
    }
    return buffer;
}

std::string hexRow(const std::string& bytes, std::size_t offset) {
    char buffer[16];
    std::snprintf(buffer, sizeof buffer, "%08zx", offset);
    std::string row = buffer;
    row += "  ";
    for (std::size_t i = 0; i < 16; ++i) {
        if (i == 8) row += ' ';
        if (offset + i < bytes.size()) {
            std::snprintf(buffer, sizeof buffer, "%02x ",
                          static_cast<unsigned>(static_cast<unsigned char>(bytes[offset + i])));
            row += buffer;
        } else {
            row += "   ";
        }
    }
    row += ' ';
    for (std::size_t i = 0; i < 16 && offset + i < bytes.size(); ++i) {
        const auto c = static_cast<unsigned char>(bytes[offset + i]);
        row += c >= 0x20 && c < 0x7F ? static_cast<char>(c) : '.';
    }
    return row;
}

std::string scriptSummary(const std::string& source) {
    std::size_t i = 0;
    if (source.compare(0, 3, "\xEF\xBB\xBF") == 0) i = 3;
    if (source.compare(i, 2, "#!") == 0) {
        i = source.find('\n', i);
        if (i == std::string::npos) return {};
    }
    const auto skipBlank = [&] {
        while (i < source.size() && (isSpace(source[i]) || source[i] == '\n')) ++i;
    };
    const auto trim = [](std::string text) {
        std::size_t a = 0;
        while (a < text.size() && (isSpace(text[a]) || text[a] == '*')) ++a;
        std::size_t b = text.size();
        while (b > a && isSpace(text[b - 1])) --b;
        return text.substr(a, b - a);
    };
    skipBlank();
    if (source.compare(i, 2, "//") == 0) {
        // The first comment line that says anything: a header may open with a
        // bare "//" spacer.
        while (source.compare(i, 2, "//") == 0) {
            const std::size_t end = std::min(source.find('\n', i), source.size());
            const std::string text = trim(source.substr(i + 2, end - i - 2));
            if (!text.empty()) return text;
            i = end;
            skipBlank();
        }
        return {};
    }
    if (source.compare(i, 2, "/*") == 0) {
        const std::size_t close = source.find("*/", i + 2);
        const std::size_t stop = close == std::string::npos ? source.size() : close;
        i += 2;
        while (i < stop) {
            const std::size_t end = std::min(source.find('\n', i), stop);
            const std::string text = trim(source.substr(i, end - i));
            if (!text.empty()) return text;
            i = end + 1;
        }
    }
    return {};
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

std::vector<std::size_t> lineStarts(const std::string& text) {
    std::vector<std::size_t> starts;
    starts.reserve(static_cast<std::size_t>(std::count(text.begin(), text.end(), '\n')) + 1);
    starts.push_back(0);
    for (std::size_t i = 0; i < text.size(); ++i) {
        if (text[i] == '\n') starts.push_back(i + 1);
    }
    return starts;
}

std::size_t lineOf(const std::vector<std::size_t>& starts, std::size_t offset) {
    if (starts.empty()) return 0;
    const auto after = std::upper_bound(starts.begin(), starts.end(), offset);
    return static_cast<std::size_t>(after - starts.begin()) - 1;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

Syntax syntaxFor(const std::string& name) {
    const std::string ext = extensionOf(name);
    if (ext == "json" || ext == "tmj" || ext == "tsj") return Syntax::Json;
    if (ext == "js" || ext == "mjs" || ext == "cjs") return Syntax::Script;
    if (ext == "svg" || ext == "xml" || ext == "html" || ext == "htm") return Syntax::Markup;
    return Syntax::Plain;
}

std::vector<Span> highlightLine(const std::string& line, Syntax syntax) {
    std::vector<Span> spans;
    switch (syntax) {
        case Syntax::Json: highlightJson(line, spans); break;
        case Syntax::Script: highlightScript(line, spans); break;
        case Syntax::Markup: highlightMarkup(line, spans); break;
        case Syntax::Plain: push(spans, 0, line.size(), Token::Text); break;
    }
    return spans;
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

void EditHistory::reset(const std::string& text) {
    shadow_ = text;
    undo_.clear();
    redo_.clear();
    bytes_ = 0;
}

void EditHistory::record(const std::string& text, const TextSelection& before,
                         const TextSelection& after, double timeSeconds) {
    if (text == shadow_) return;

    // What changed is everything between the longest run the two share at the
    // front and the longest they share at the back.
    const std::size_t shorter = std::min(shadow_.size(), text.size());
    std::size_t prefix = 0;
    while (prefix < shorter && shadow_[prefix] == text[prefix]) ++prefix;
    std::size_t suffix = 0;
    while (suffix < shorter - prefix &&
           shadow_[shadow_.size() - 1 - suffix] == text[text.size() - 1 - suffix]) {
        ++suffix;
    }
    Edit edit;
    edit.offset = prefix;
    edit.removed = shadow_.substr(prefix, shadow_.size() - prefix - suffix);
    edit.inserted = text.substr(prefix, text.size() - prefix - suffix);
    edit.before = before;
    edit.after = after;
    edit.at = timeSeconds;
    shadow_ = text;

    for (const Edit& dropped : redo_) bytes_ -= dropped.removed.size() + dropped.inserted.size();
    redo_.clear();
    bytes_ += edit.removed.size() + edit.inserted.size();

    if (!undo_.empty()) {
        Edit& last = undo_.back();
        const bool burst = timeSeconds - last.at < kBurstSeconds;
        const bool newline = edit.inserted.find('\n') != std::string::npos ||
                             (!last.inserted.empty() && last.inserted.back() == '\n');
        const bool typing = burst && !newline && last.removed.empty() && edit.removed.empty() &&
                            edit.offset == last.offset + last.inserted.size();
        const bool backspacing = burst && last.inserted.empty() && edit.inserted.empty() &&
                                 edit.offset + edit.removed.size() == last.offset;
        const bool deleting = burst && last.inserted.empty() && edit.inserted.empty() &&
                              edit.offset == last.offset;
        if (typing || backspacing || deleting) {
            if (typing) last.inserted += edit.inserted;
            else if (backspacing) {
                last.removed = edit.removed + last.removed;
                last.offset = edit.offset;
            } else {
                last.removed += edit.removed;
            }
            last.after = after;
            last.at = timeSeconds;
            trim();
            return;
        }
    }
    undo_.push_back(std::move(edit));
    trim();
}

void EditHistory::trim() {
    while (bytes_ > kMaxBytes && undo_.size() > 1) {
        bytes_ -= undo_.front().removed.size() + undo_.front().inserted.size();
        undo_.erase(undo_.begin());
    }
}

bool EditHistory::undo(std::string& text, TextSelection& selection) {
    if (undo_.empty()) return false;
    Edit edit = std::move(undo_.back());
    undo_.pop_back();
    // A text changed behind the history's back cannot be unwound by offsets
    // into the one it remembers.
    if (edit.offset + edit.inserted.size() > text.size() ||
        text.compare(edit.offset, edit.inserted.size(), edit.inserted) != 0) {
        reset(text);
        return false;
    }
    text.replace(edit.offset, edit.inserted.size(), edit.removed);
    selection = edit.before;
    shadow_ = text;
    redo_.push_back(std::move(edit));
    return true;
}

bool EditHistory::redo(std::string& text, TextSelection& selection) {
    if (redo_.empty()) return false;
    Edit edit = std::move(redo_.back());
    redo_.pop_back();
    if (edit.offset + edit.removed.size() > text.size() ||
        text.compare(edit.offset, edit.removed.size(), edit.removed) != 0) {
        reset(text);
        return false;
    }
    text.replace(edit.offset, edit.removed.size(), edit.inserted);
    selection = edit.after;
    shadow_ = text;
    undo_.push_back(std::move(edit));
    return true;
}

} // namespace flix::ui::assets
