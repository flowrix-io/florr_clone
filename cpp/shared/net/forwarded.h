#pragma once
// What the HTTP request that opened a connection said about where it came
// from, verbatim.
//
// Only the WebSocket upgrade has such a request; a native TCP socket and a
// WebTransport session carry none, and leave every field empty. Nothing here is
// believed on its own: any client can write these headers. Which of them, if
// any, a proxy in front of the server vouches for is decided by
// clientAddress() (server/account_limits.h), from who the TCP peer is.

#include <string>

namespace flix::net {

struct ForwardedHeaders {
    /// `X-Forwarded-For`: the hop list each proxy appends to, nearest last.
    /// The upgrade handler keeps only its last few entries -- the ones a proxy
    /// wrote are always at the right-hand end.
    std::string forwardedFor;
    /// `X-Real-IP`: the one address nginx saw, when it is told to set it.
    std::string realIp;
    /// `CF-Connecting-IP`: the visitor's address, which Cloudflare sets on
    /// every request it proxies and overwrites if a client sent one.
    std::string cfConnectingIp;

    bool empty() const { return forwardedFor.empty() && realIp.empty() && cfConnectingIp.empty(); }
};

} // namespace flix::net
