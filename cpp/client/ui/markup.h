#pragma once
// The chat line's markup: the small HTML subset the server actually sends.
//
// Chat content is not plain text on the wire. The server writes lines like
//
//     <b style="color: #2bffa4;">A super crab has spawned somewhere!</b>
//     <span style="color: #4fc3f7;">Public squads:<br/>...</span>
//
// and the browser build dropped that straight into an element, so the tags
// were styling rather than characters. This client draws its transcript with
// glyph outlines and has no element to drop anything into, so until the tags
// are parsed they render as literal angle brackets in the middle of every
// boss announcement. parseMarkup() is what turns them back into styling.
//
// What is honoured, and what is not:
//
//  * b, strong, i, em, u, blink, span, font, color -- styling, everywhere.
//    <br> is a hard break. These are the only tags the server emits.
//  * <a> is page furniture: a link needs somewhere to navigate, which a native
//    window does not have. It is honoured only in the emscripten build
//    (kWebMarkup), and dropped -- with its content, as an unknown tag is --
//    everywhere else. <img> is dropped in every build, because the transcript
//    is glyph outlines rather than elements and has nowhere to put a picture.
//  * script and iframe are dropped with their content in EVERY build. The
//    browser client used to offer a "click to run" button for one and a "click
//    to show embed" button for the other; nothing here reinstates that, and
//    nothing here executes or embeds anything a chat line asks it to.
//  * Any other tag is dropped with its content, which is what the browser's
//    sanitiser did with a tag outside its allowlist.

#include <cstdint>
#include <string>
#include <vector>

namespace flr::ui {

/// Whether this build may honour the tags that only mean something inside a
/// real page. Only the emscripten build can, and it defines FLIX_WEB_BUILD.
#if defined(FLIX_WEB_BUILD)
inline constexpr bool kWebMarkup = true;
#else
inline constexpr bool kWebMarkup = false;
#endif

/// One run of chat text that shares a single style, or a hard line break.
struct MarkupSpan {
    /// The run's characters, entities already decoded. Empty when `lineBreak`.
    std::string text;
    /// A <br>: end the row here rather than drawing anything.
    bool lineBreak = false;

    bool bold = false;
    bool italic = false;
    bool underline = false;
    bool blink = false;

    /// Whether `color` was set by the markup. A run without one inherits
    /// whatever colour the caller was already drawing in.
    bool hasColor = false;
    std::uint32_t color = 0;    ///< 0xRRGGBB

    /// The destination of the enclosing <a href>, http(s) only. Always empty
    /// unless kWebMarkup, because only a page can follow it.
    ///
    /// Parsed and carried, not yet navigable: the transcript marks a link by
    /// underlining it, but nothing opens one. Making it clickable means
    /// hit-testing the chat column, which overlaps the play area, and no
    /// server this client talks to sends <a> at all -- so the click is left
    /// for whoever needs it rather than put in the way of attacking.
    std::string href;
};

/// Splits `source` into styled runs. Never throws and never fails: markup it
/// cannot make sense of degrades to text, exactly as a browser's parser does.
std::vector<MarkupSpan> parseMarkup(const std::string& source);

/// The same content with every tag resolved away and every entity decoded,
/// for the surfaces that draw one flat string. <br> becomes '\n'.
std::string markupPlainText(const std::string& source);

} // namespace flr::ui
