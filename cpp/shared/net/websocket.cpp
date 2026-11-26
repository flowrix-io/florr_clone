#include "shared/net/websocket.h"

#include <cctype>
#include <cstring>
#include <random>

namespace flix::net::ws {

namespace {

constexpr const char* kAcceptGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

std::uint32_t rotl(std::uint32_t v, int n) { return (v << n) | (v >> (32 - n)); }

std::mt19937& random() {
    // The mask and the key only have to be unpredictable to a proxy in the
    // middle, which is what RFC 6455 has them for; nothing secret rests on them.
    static std::mt19937 engine{std::random_device{}()};
    return engine;
}

std::string lower(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

std::string trim(const std::string& s) {
    std::size_t a = 0, b = s.size();
    while (a < b && (s[a] == ' ' || s[a] == '\t')) ++a;
    while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\r')) --b;
    return s.substr(a, b - a);
}

} // namespace

std::string sha1(const std::string& data) {
    std::uint32_t h[5] = {0x67452301u, 0xEFCDAB89u, 0x98BADCFEu, 0x10325476u, 0xC3D2E1F0u};
    std::string m = data;
    const std::uint64_t bits = static_cast<std::uint64_t>(data.size()) * 8u;
    m.push_back(static_cast<char>(0x80));
    while (m.size() % 64 != 56) m.push_back('\0');
    for (int i = 7; i >= 0; --i) m.push_back(static_cast<char>((bits >> (i * 8)) & 0xFFu));
    for (std::size_t chunk = 0; chunk < m.size(); chunk += 64) {
        std::uint32_t w[80];
        for (int i = 0; i < 16; ++i) {
            const auto* p = reinterpret_cast<const unsigned char*>(m.data() + chunk + i * 4);
            w[i] = (std::uint32_t{p[0]} << 24) | (std::uint32_t{p[1]} << 16) | (std::uint32_t{p[2]} << 8) | p[3];
        }
        for (int i = 16; i < 80; ++i) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        std::uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
        for (int i = 0; i < 80; ++i) {
            std::uint32_t f, k;
            if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999u; }
            else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1u; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDCu; }
            else { f = b ^ c ^ d; k = 0xCA62C1D6u; }
            const std::uint32_t t = rotl(a, 5) + f + e + k + w[i];
            e = d; d = c; c = rotl(b, 30); b = a; a = t;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
    }
    std::string out;
    for (std::uint32_t v : h) {
        for (int i = 3; i >= 0; --i) out.push_back(static_cast<char>((v >> (i * 8)) & 0xFFu));
    }
    return out;
}

std::string base64(const std::string& data) {
    static const char* table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    std::size_t i = 0;
    const auto byte = [&](std::size_t at) { return static_cast<unsigned char>(data[at]); };
    for (; i + 2 < data.size(); i += 3) {
        const std::uint32_t v = (std::uint32_t{byte(i)} << 16) | (std::uint32_t{byte(i + 1)} << 8) | byte(i + 2);
        out += table[(v >> 18) & 63];
        out += table[(v >> 12) & 63];
        out += table[(v >> 6) & 63];
        out += table[v & 63];
    }
    if (i + 1 == data.size()) {
        const std::uint32_t v = std::uint32_t{byte(i)} << 16;
        out += table[(v >> 18) & 63];
        out += table[(v >> 12) & 63];
        out += "==";
    } else if (i + 2 == data.size()) {
        const std::uint32_t v = (std::uint32_t{byte(i)} << 16) | (std::uint32_t{byte(i + 1)} << 8);
        out += table[(v >> 18) & 63];
        out += table[(v >> 12) & 63];
        out += table[(v >> 6) & 63];
        out += '=';
    }
    return out;
}

std::string acceptFor(const std::string& key) { return base64(sha1(key + kAcceptGuid)); }

std::string newKey() {
    std::string raw(16, '\0');
    for (char& c : raw) c = static_cast<char>(random()() & 0xFFu);
    return base64(raw);
}

std::size_t headEnd(const std::byte* data, std::size_t size) {
    for (std::size_t i = 3; i < size; ++i) {
        if (data[i - 3] == std::byte{'\r'} && data[i - 2] == std::byte{'\n'} && data[i - 1] == std::byte{'\r'} &&
            data[i] == std::byte{'\n'}) {
            return i + 1;
        }
    }
    return 0;
}

std::string Head::header(const std::string& lowercaseName) const {
    const auto at = headers.find(lowercaseName);
    return at == headers.end() ? std::string() : at->second;
}

bool parseHead(const std::string& text, Head& out) {
    out = Head{};
    std::size_t at = 0;
    bool first = true;
    while (at < text.size()) {
        std::size_t end = text.find("\r\n", at);
        if (end == std::string::npos) end = text.size();
        const std::string line = text.substr(at, end - at);
        at = end + 2;
        if (first) {
            out.first = line;
            first = false;
            continue;
        }
        if (line.empty()) break;
        const std::size_t colon = line.find(':');
        if (colon == std::string::npos) return false;
        out.headers.emplace(lower(trim(line.substr(0, colon))), trim(line.substr(colon + 1)));
    }
    return !out.first.empty();
}

std::string request(const std::string& host, const std::string& path, const std::string& key) {
    return "GET " + path + " HTTP/1.1\r\n"
           "Host: " + host + "\r\n"
           "Upgrade: websocket\r\n"
           "Connection: Upgrade\r\n"
           "Sec-WebSocket-Key: " + key + "\r\n"
           "Sec-WebSocket-Version: 13\r\n"
           "Sec-WebSocket-Protocol: binary\r\n\r\n";
}

std::string switching(const std::string& key) {
    return "HTTP/1.1 101 Switching Protocols\r\n"
           "Upgrade: websocket\r\n"
           "Connection: Upgrade\r\n"
           "Sec-WebSocket-Accept: " + acceptFor(key) + "\r\n"
           "Sec-WebSocket-Protocol: binary\r\n\r\n";
}

std::string badRequest() { return "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"; }

void encode(std::vector<std::byte>& out, std::uint8_t opcode, const std::byte* data, std::size_t size,
            bool mask) {
    out.push_back(static_cast<std::byte>(0x80u | (opcode & 0x0Fu)));
    const std::uint8_t maskBit = mask ? 0x80u : 0u;
    if (size < 126) {
        out.push_back(static_cast<std::byte>(maskBit | size));
    } else if (size < 65536) {
        out.push_back(static_cast<std::byte>(maskBit | 126u));
        out.push_back(static_cast<std::byte>((size >> 8) & 0xFFu));
        out.push_back(static_cast<std::byte>(size & 0xFFu));
    } else {
        out.push_back(static_cast<std::byte>(maskBit | 127u));
        for (int i = 7; i >= 0; --i) out.push_back(static_cast<std::byte>((static_cast<std::uint64_t>(size) >> (i * 8)) & 0xFFu));
    }
    std::byte key[4] = {};
    if (mask) {
        const std::uint32_t r = random()();
        for (int i = 0; i < 4; ++i) key[i] = static_cast<std::byte>((r >> (i * 8)) & 0xFFu);
        out.insert(out.end(), key, key + 4);
    }
    const std::size_t at = out.size();
    out.resize(at + size);
    if (size) std::memcpy(out.data() + at, data, size);
    if (mask) {
        for (std::size_t i = 0; i < size; ++i) out[at + i] ^= key[i & 3];
    }
}

Decoded decode(const std::byte* data, std::size_t size, bool fromClient, Frame& out, std::size_t& consumed,
               std::string& error) {
    if (size < 2) return Decoded::NeedMore;
    const auto b0 = static_cast<std::uint8_t>(data[0]);
    const auto b1 = static_cast<std::uint8_t>(data[1]);
    // No extension was negotiated, so a reserved bit is something this cannot read.
    if ((b0 & 0x70u) != 0) {
        error = "websocket reserved bits set";
        return Decoded::Error;
    }
    const bool masked = (b1 & 0x80u) != 0;
    if (masked != fromClient) {
        error = fromClient ? "websocket client frame is not masked" : "websocket server frame is masked";
        return Decoded::Error;
    }
    std::uint64_t length = b1 & 0x7Fu;
    std::size_t at = 2;
    if (length == 126) {
        if (size < 4) return Decoded::NeedMore;
        length = (std::uint64_t{static_cast<std::uint8_t>(data[2])} << 8) | static_cast<std::uint8_t>(data[3]);
        at = 4;
    } else if (length == 127) {
        if (size < 10) return Decoded::NeedMore;
        length = 0;
        for (int i = 0; i < 8; ++i) length = (length << 8) | static_cast<std::uint8_t>(data[2 + i]);
        at = 10;
    }
    const std::uint8_t opcode = b0 & 0x0Fu;
    const bool fin = (b0 & 0x80u) != 0;
    if (opcode >= 0x8 && (length > 125 || !fin)) {
        error = "websocket control frame is bad";
        return Decoded::Error;
    }
    if (length > kMaxFramePayload) {
        error = "websocket frame too large";
        return Decoded::Error;
    }
    std::byte key[4] = {};
    if (masked) {
        if (size < at + 4) return Decoded::NeedMore;
        std::memcpy(key, data + at, 4);
        at += 4;
    }
    if (size < at + length) return Decoded::NeedMore;
    out.opcode = opcode;
    out.fin = fin;
    out.payload.assign(data + at, data + at + length);
    if (masked) {
        for (std::size_t i = 0; i < out.payload.size(); ++i) out.payload[i] ^= key[i & 3];
    }
    consumed = at + static_cast<std::size_t>(length);
    return Decoded::Frame;
}

} // namespace flix::net::ws
