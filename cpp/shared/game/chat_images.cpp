#include "shared/game/chat_images.h"

#include "shared/core/text.h"
#include "shared/game/html_entities.h"

#include <cctype>
#include <cstdlib>

namespace flix {

namespace {

/// Matched as a whole host or as its parent domain, never as a bare suffix:
/// "eviltenor.com" is not "tenor.com".
constexpr const char* kImageHosts[] = {
    "tenor.com",            // media.tenor.com, c.tenor.com
    "giphy.com",            // media.giphy.com, i.giphy.com
    "imgur.com",            // i.imgur.com
    "discordapp.com",       // cdn.discordapp.com
    "discordapp.net",       // media.discordapp.net
    "redd.it",              // i.redd.it, preview.redd.it
    "redditmedia.com",
    "githubusercontent.com",
    "wikimedia.org",        // upload.wikimedia.org
    "ibb.co",               // i.ibb.co
    "postimg.cc",           // i.postimg.cc
    "gyazo.com",            // i.gyazo.com
    "steamstatic.com",
    "steamusercontent.com",
    "florr.io",
};

bool hostListed(const std::string& host) {
    for (const char* entry : kImageHosts) {
        const std::string listed = entry;
        if (host == listed) return true;
        if (host.size() > listed.size() + 1 &&
            host.compare(host.size() - listed.size(), listed.size(), listed) == 0 &&
            host[host.size() - listed.size() - 1] == '.') {
            return true;
        }
    }
    return false;
}

bool nameChar(char c) {
    return std::isalnum(static_cast<unsigned char>(c)) != 0 || c == '-' || c == '_' || c == ':';
}

/// The src of the tag spanning [open, close), read the way the client's
/// readTag reads attributes. Empty when there is none.
std::string tagSource(const std::string& s, std::size_t open, std::size_t close) {
    std::size_t i = open + 4;   // past "<img"
    std::string src;
    while (i < close) {
        while (i < close && (std::isspace(static_cast<unsigned char>(s[i])) != 0 || s[i] == '/')) ++i;
        std::string name;
        while (i < close && nameChar(s[i])) name.push_back(lowerCase(s[i++]));
        if (name.empty()) {
            ++i;
            continue;
        }
        while (i < close && std::isspace(static_cast<unsigned char>(s[i])) != 0) ++i;
        std::string value;
        if (i < close && s[i] == '=') {
            ++i;
            while (i < close && std::isspace(static_cast<unsigned char>(s[i])) != 0) ++i;
            if (i < close && (s[i] == '"' || s[i] == '\'')) {
                const char quote = s[i++];
                while (i < close && s[i] != quote) value.push_back(s[i++]);
                if (i < close) ++i;
            } else {
                while (i < close && std::isspace(static_cast<unsigned char>(s[i])) == 0) {
                    value.push_back(s[i++]);
                }
            }
        }
        // The first src wins, as it does in a browser.
        if (name == "src" && src.empty()) src = value;
    }
    return decodeCharacterReferences(src, true);
}

} // namespace

bool chatImageUrlAllowed(const std::string& url) {
    for (const char c : url) {
        const unsigned char u = static_cast<unsigned char>(c);
        // A browser strips tabs and newlines out of a URL before it parses
        // one and reads '\' as '/', so a URL holding either can name a
        // different host to it than to this check.
        if (u <= 0x20 || u == 0x7F || c == '\\') return false;
    }
    static const std::string kScheme = "https://";
    if (url.size() <= kScheme.size()) return false;
    for (std::size_t i = 0; i < kScheme.size(); ++i) {
        if (lowerCase(url[i]) != kScheme[i]) return false;
    }

    const std::size_t end = url.find_first_of("/?#", kScheme.size());
    std::string host = url.substr(kScheme.size(), end == std::string::npos ? std::string::npos
                                                                         : end - kScheme.size());
    // user:password@ before the host is how a link shows one site's name and
    // goes to another's.
    if (host.find('@') != std::string::npos) return false;
    const std::size_t colon = host.find(':');
    if (colon != std::string::npos) {
        const std::string port = host.substr(colon + 1);
        if (port.empty() || port.size() > 5) return false;
        for (const char c : port) {
            if (std::isdigit(static_cast<unsigned char>(c)) == 0) return false;
        }
        if (std::strtoul(port.c_str(), nullptr, 10) > 65535) return false;
        host.erase(colon);
    }
    if (host.empty() || host.front() == '.' || host.back() == '.' ||
        host.find("..") != std::string::npos) {
        return false;
    }
    for (char& c : host) {
        c = lowerCase(c);
        if (std::isalnum(static_cast<unsigned char>(c)) == 0 && c != '.' && c != '-') return false;
    }
    return hostListed(host);
}

std::string chatImageHostSummary() {
    return "tenor.com, giphy.com, imgur.com, discordapp.com, ...";
}

ChatImageFilter filterChatImages(const std::string& text) {
    ChatImageFilter out;
    out.text.reserve(text.size());
    std::size_t at = 0;
    while (at < text.size()) {
        const bool opensImg = text[at] == '<' && at + 4 <= text.size() &&
                              lowerCase(text[at + 1]) == 'i' && lowerCase(text[at + 2]) == 'm' &&
                              lowerCase(text[at + 3]) == 'g' &&
                              (at + 4 == text.size() || !nameChar(text[at + 4]));
        if (!opensImg) {
            out.text.push_back(text[at++]);
            continue;
        }
        // The end of the tag is the first '>' outside a quoted value. One
        // that never ends is no tag to the client either: it prints as text.
        std::size_t close = at + 4;
        char quote = 0;
        for (; close < text.size(); ++close) {
            const char c = text[close];
            if (quote != 0) {
                if (c == quote) quote = 0;
            } else if (c == '"' || c == '\'') {
                quote = c;
            } else if (c == '>') {
                break;
            }
        }
        if (close >= text.size()) {
            out.text.append(text, at, std::string::npos);
            break;
        }
        if (chatImageUrlAllowed(tagSource(text, at, close))) {
            out.text.append(text, at, close + 1 - at);
        } else {
            ++out.removed;
        }
        at = close + 1;
    }
    return out;
}

} // namespace flix
