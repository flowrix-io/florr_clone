#pragma once
// Which pictures a chat line may show: only ones served by a well-known image
// host -- Tenor, Giphy, Imgur, Discord's CDN and the like.
//
// A chat <img> makes every reader's browser fetch the URL, so an arbitrary one
// is both a way to put anything at all on everyone's screen and a way to log
// every reader's address. The hosts listed here run their own upload
// moderation and are not anybody's private logger.
//
// Both halves read this one list. The server strips a picture from anywhere
// else before the line goes out, and tells the sender why
// (GameServer::screenChatImages); the client refuses to fetch one even if a
// line carrying it arrives anyway (client/ui/markup.cpp).

#include <string>

namespace flix {

/// Whether `url` -- entities already decoded -- is an https link to a host on
/// the list, or a subdomain of one ("media.tenor.com" is under "tenor.com").
/// Anything the browser might read differently from this check is refused
/// outright: credentials, backslashes, whitespace, a host outside [a-z0-9.-].
bool chatImageUrlAllowed(const std::string& url);

/// The first few hosts, for the line that tells a sender why a picture went.
std::string chatImageHostSummary();

/// `text` with every <img> whose src is not allowed cut out, and how many were.
struct ChatImageFilter {
    std::string text;
    int removed = 0;
};
ChatImageFilter filterChatImages(const std::string& text);

} // namespace flix
