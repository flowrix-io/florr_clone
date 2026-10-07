#include "test.h"

#include "shared/game/chat_images.h"

#include <string>

using flix::chatImageUrlAllowed;
using flix::filterChatImages;

// Chat pictures come from the listed image hosts and nowhere else. The cases
// below are the ways a URL can name one host to this check and another to
// the browser that fetches it.

TEST(chat_images_listed_hosts_and_their_subdomains_pass) {
    CHECK(chatImageUrlAllowed("https://media.tenor.com/abc/cat.gif"));
    CHECK(chatImageUrlAllowed("https://tenor.com/view/x.gif"));
    CHECK(chatImageUrlAllowed("https://i.imgur.com/abc.png"));
    CHECK(chatImageUrlAllowed("https://media.giphy.com/media/x/giphy.gif"));
    CHECK(chatImageUrlAllowed("https://cdn.discordapp.com/attachments/1/2/a.png?ex=1&is=2"));
    CHECK(chatImageUrlAllowed("HTTPS://MEDIA.TENOR.COM/a.gif"));
    CHECK(chatImageUrlAllowed("https://media.tenor.com:443/a.gif"));
    CHECK(chatImageUrlAllowed("https://i.imgur.com"));
}

TEST(chat_images_other_hosts_are_refused) {
    CHECK(!chatImageUrlAllowed("https://example.com/a.png"));
    CHECK(!chatImageUrlAllowed("https://eviltenor.com/a.gif"));
    CHECK(!chatImageUrlAllowed("https://tenor.com.evil.example/a.gif"));
    CHECK(!chatImageUrlAllowed("https://192.168.1.1/a.png"));
    CHECK(!chatImageUrlAllowed("https://localhost/a.png"));
}

TEST(chat_images_only_https) {
    CHECK(!chatImageUrlAllowed("http://media.tenor.com/a.gif"));
    CHECK(!chatImageUrlAllowed("//media.tenor.com/a.gif"));
    CHECK(!chatImageUrlAllowed("javascript:alert(1)//tenor.com"));
    CHECK(!chatImageUrlAllowed("data:image/png;base64,AAAA"));
    CHECK(!chatImageUrlAllowed("https://"));
    CHECK(!chatImageUrlAllowed(""));
}

TEST(chat_images_urls_a_browser_reads_differently_are_refused) {
    // Credentials: the host is what follows the '@'.
    CHECK(!chatImageUrlAllowed("https://tenor.com@evil.example/a.gif"));
    CHECK(!chatImageUrlAllowed("https://tenor.com:x@evil.example/a.gif"));
    // A browser reads '\' as '/', so this host is evil.example to it.
    CHECK(!chatImageUrlAllowed("https://evil.example\\.tenor.com/a.gif"));
    // Whitespace and control bytes are stripped by a browser before parsing.
    CHECK(!chatImageUrlAllowed("https://evil.example\t.tenor.com/a.gif"));
    CHECK(!chatImageUrlAllowed("https://media.tenor.com/a b.gif"));
    // Percent-encoded and non-ASCII hosts.
    CHECK(!chatImageUrlAllowed("https://evil%2eexample/.tenor.com"));
    CHECK(!chatImageUrlAllowed("https://t\xD0\xB5nor.com/a.gif"));
    CHECK(!chatImageUrlAllowed("https://media.tenor.com./a.gif"));
    CHECK(!chatImageUrlAllowed("https://media..tenor.com/a.gif"));
    CHECK(!chatImageUrlAllowed("https://media.tenor.com:99999/a.gif"));
}

TEST(chat_images_filter_keeps_listed_pictures_and_text) {
    const std::string line = "hi <img src=\"https://media.tenor.com/a.gif\"> there";
    const auto filtered = filterChatImages(line);
    CHECK_EQ(filtered.removed, 0);
    CHECK_EQ(filtered.text, line);
    // Image-free lines are untouched, angle brackets and all.
    CHECK_EQ(filterChatImages("2 < 3 <b>x</b> <imgur>").text, std::string("2 < 3 <b>x</b> <imgur>"));
}

TEST(chat_images_filter_cuts_unlisted_pictures) {
    const auto filtered = filterChatImages(
        "a<img src=\"https://evil.example/x.png\">b<IMG SRC='https://i.imgur.com/y.png'>c"
        "<img src=https://grabify.link/z.png alt=\"x > y\">d<img>e");
    CHECK_EQ(filtered.removed, 3);
    CHECK_EQ(filtered.text, std::string("ab<IMG SRC='https://i.imgur.com/y.png'>cde"));
}

TEST(chat_images_filter_reads_entities_in_src) {
    // "&#58;" is ':' -- the decoded URL is what the client would fetch.
    CHECK_EQ(filterChatImages("<img src=\"https&#58;//evil.example/a.png\">").removed, 1);
    CHECK_EQ(filterChatImages("<img src=\"https://media.tenor.com/a.gif?x=1&amp;y=2\">").removed, 0);
    // A '>' inside a quoted value does not end the tag early.
    CHECK_EQ(filterChatImages("<img alt=\">\" src=\"https://evil.example/a.png\">").text,
             std::string(""));
}
