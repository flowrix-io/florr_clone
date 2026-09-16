#include "test.h"

#include "client/chat_bubbles.h"

#include <string>

using flix::ChatBubble;
using flix::ChatBubbles;

// The stack of lines over a flower's head.
//
// Only the bookkeeping is exercised: the geometry lives in the renderer and
// needs a canvas and a typeface, neither of which a test binary has.

namespace {

/// How many rows the speaker currently has up, ignoring who else is talking.
int rowsFor(const ChatBubbles& bubbles, std::uint32_t speaker) {
    int count = 0;
    for (const ChatBubble& bubble : bubbles.all()) {
        if (bubble.speakerNetId == speaker) ++count;
    }
    return count;
}

/// The newest line a speaker has up, or an empty string.
std::string newestFor(const ChatBubbles& bubbles, std::uint32_t speaker) {
    for (const ChatBubble& bubble : bubbles.all()) {
        if (bubble.speakerNetId == speaker && bubble.row == 0) return bubble.text;
    }
    return {};
}

} // namespace

TEST(a_line_raises_one_bubble_over_its_speaker) {
    ChatBubbles bubbles;
    bubbles.add(7, "hello");
    CHECK_EQ(bubbles.all().size(), std::size_t{1});
    CHECK_EQ(bubbles.all()[0].speakerNetId, std::uint32_t{7});
    CHECK_EQ(bubbles.all()[0].row, 0);
    CHECK_EQ(newestFor(bubbles, 7), std::string("hello"));
}

TEST(the_server_talking_in_its_own_voice_raises_nothing) {
    // Notices, command answers and boss announcements all arrive with a zero
    // speaker: they belong in the transcript and over nobody's head.
    ChatBubbles bubbles;
    bubbles.add(0, "A super Hornet has spawned!");
    bubbles.add(7, "");
    CHECK_EQ(bubbles.all().size(), std::size_t{0});
}

TEST(a_newer_line_pushes_the_speakers_older_ones_up) {
    ChatBubbles bubbles;
    bubbles.add(7, "first");
    bubbles.add(7, "second");
    bubbles.add(7, "third");
    CHECK_EQ(rowsFor(bubbles, 7), 3);
    CHECK_EQ(newestFor(bubbles, 7), std::string("third"));
    // The oldest is the furthest from the flower.
    for (const ChatBubble& bubble : bubbles.all()) {
        if (bubble.text == "first") CHECK_EQ(bubble.row, 2);
        if (bubble.text == "second") CHECK_EQ(bubble.row, 1);
    }
}

TEST(one_speakers_stack_does_not_move_anothers) {
    ChatBubbles bubbles;
    bubbles.add(7, "mine");
    bubbles.add(9, "theirs");
    bubbles.add(9, "theirs again");
    CHECK_EQ(newestFor(bubbles, 7), std::string("mine"));
    CHECK_EQ(rowsFor(bubbles, 7), 1);
    for (const ChatBubble& bubble : bubbles.all()) {
        if (bubble.speakerNetId == 7) CHECK_EQ(bubble.row, 0);
    }
}

TEST(a_stack_never_grows_past_its_cap) {
    ChatBubbles bubbles;
    for (int i = 0; i < ChatBubbles::kRows + 3; ++i) {
        bubbles.add(7, "line " + std::to_string(i));
    }
    CHECK_EQ(rowsFor(bubbles, 7), ChatBubbles::kRows);
    // What survives is the tail, not the head: the oldest lines are the ones
    // pushed off the top.
    CHECK_EQ(newestFor(bubbles, 7),
             std::string("line " + std::to_string(ChatBubbles::kRows + 2)));
}

TEST(a_bubble_retires_on_its_own_timer) {
    ChatBubbles bubbles;
    bubbles.add(7, "hello");
    bubbles.update(ChatBubbles::kLifetimeSeconds - 0.01);
    CHECK_EQ(bubbles.all().size(), std::size_t{1});
    bubbles.update(0.02);
    CHECK_EQ(bubbles.all().size(), std::size_t{0});
}

TEST(a_bubble_fades_out_over_the_tail_of_its_life) {
    ChatBubbles bubbles;
    bubbles.add(7, "hello");
    CHECK_EQ(ChatBubbles::fade(bubbles.all()[0]), 1.0);
    // Mid-life is fully opaque; only the last moments fade.
    bubbles.update(ChatBubbles::kLifetimeSeconds - ChatBubbles::kFadeSeconds);
    CHECK_EQ(ChatBubbles::fade(bubbles.all()[0]), 1.0);
    bubbles.update(ChatBubbles::kFadeSeconds * 0.5);
    CHECK_NEAR(ChatBubbles::fade(bubbles.all()[0]), 0.5, 1e-9);
}

TEST(clearing_takes_every_bubble_with_it) {
    // Leaving a game, a realm change and a disconnect all clear the view, and
    // a bubble with no body under it has nowhere to be.
    ChatBubbles bubbles;
    bubbles.add(7, "hello");
    bubbles.add(9, "hi");
    bubbles.clear();
    CHECK_EQ(bubbles.all().size(), std::size_t{0});
}
