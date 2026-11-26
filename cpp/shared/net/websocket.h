#pragma once
// RFC 6455, the part the native transport needs: the link between two servers
// of a sharded game is always a WebSocket, at /link, whichever build either
// end is. The web backend has a WebSocket of its own (web_channel.cpp); this
// is the native one, for a socket that opens with an HTTP upgrade instead of
// the transport's own framing (net/transport.h).
//
// What crosses inside it is the transport's byte stream as it is: the
// [u32 length][payload] frames are found by their length prefix, never by
// WebSocket message boundaries, exactly as the web backend does it.

#include <cstddef>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace flix::net::ws {

/// The path a server of a sharded game dials another's game port at.
inline constexpr const char* kLinkPath = "/link";
/// Largest HTTP head either end reads before giving up on the handshake.
inline constexpr std::size_t kMaxHeadBytes = 8192;
/// Largest single WebSocket frame accepted. The transport sends at most
/// kReadChunk-sized ones; a peer claiming more is not speaking this.
inline constexpr std::size_t kMaxFramePayload = 1u << 24;

std::string sha1(const std::string& data);
std::string base64(const std::string& data);
/// Sec-WebSocket-Accept for a Sec-WebSocket-Key.
std::string acceptFor(const std::string& key);
/// A fresh Sec-WebSocket-Key: sixteen random bytes, in base64.
std::string newKey();

/// Where "\r\n\r\n" ends in `data`, or 0 when the head is not all there yet.
std::size_t headEnd(const std::byte* data, std::size_t size);

/// An HTTP request or response head. Header names lowercased; a repeated
/// header keeps its first value.
struct Head {
    std::string first;
    std::map<std::string, std::string> headers;
    std::string header(const std::string& lowercaseName) const;
};
bool parseHead(const std::string& text, Head& out);

/// The client's upgrade request for `path` on `host`, with `key`.
std::string request(const std::string& host, const std::string& path, const std::string& key);
/// The server's 101 for a request carrying `key`.
std::string switching(const std::string& key);
/// What a server answers a request it will not upgrade.
std::string badRequest();

/// Appends one whole frame (FIN set). A client end masks what it sends.
void encode(std::vector<std::byte>& out, std::uint8_t opcode, const std::byte* data, std::size_t size,
            bool mask);

struct Frame {
    std::uint8_t opcode = 0;
    bool fin = true;
    std::vector<std::byte> payload;
};
enum class Decoded { Frame, NeedMore, Error };
/// Takes the frame at the front of `data`, if all of it is there. A server
/// end takes only masked frames (`fromClient`), a client end only unmasked.
Decoded decode(const std::byte* data, std::size_t size, bool fromClient, Frame& out, std::size_t& consumed,
               std::string& error);

} // namespace flix::net::ws
