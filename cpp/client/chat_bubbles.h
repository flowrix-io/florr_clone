#pragma once
// What a player said, floating over their flower.
//
// A bubble is purely a client-side object. The wire carries one extra field on
// a chat line -- the net id of the flower that said it -- and every client
// builds its own bubbles from that, which is why there is no bubble entity in
// the snapshot stream and no per-bubble position to replicate.
//
// The shape follows the reference (rysteria_gardn Server/Process/Chat.cc): a
// speaker's newest line sits just above their head and each older one is
// pushed a row further up, so a run of messages reads bottom-to-top with the
// most recent nearest the flower. Past kRows the oldest is dropped, and every
// bubble expires on its own timer whether or not anything pushed it.

#include <cstdint>
#include <string>
#include <vector>

namespace flix {

struct ChatBubble {
    /// The flower this bubble is anchored to. The bubble is drawn only while
    /// that entity is on screen; it keeps ageing either way, so a speaker who
    /// wanders off and comes back does not bring a stale line with them.
    std::uint32_t speakerNetId = 0;
    std::string text;
    double ageSeconds = 0;
    /// How many lines the same speaker has said since this one. Zero is the
    /// newest, and each step is one row higher above the flower.
    int row = 0;
};

class ChatBubbles {
public:
    /// How long a bubble stays up, and how many one speaker can stack before
    /// the oldest is pushed off the top. Both are the reference's: a ten
    /// second despawn (entity_set_despawn_tick(chat, 10 * TPS)) and CHAT_SIZE.
    static constexpr double kLifetimeSeconds = 10.0;
    static constexpr int kRows = 5;
    /// The shrink-and-fade the reference plays a bubble out with, taken off
    /// the tail of its life rather than from a separate death timer -- there
    /// is no server to tell this client the bubble is going.
    static constexpr double kFadeSeconds = 0.3;

    /// Records a line. Ignored when `speakerNetId` is zero: that is the server
    /// talking in its own voice, and it has no body to talk over.
    void add(std::uint32_t speakerNetId, std::string text);

    /// Ages every bubble and retires the expired ones. Call once per frame.
    void update(double dtSeconds);

    void clear() { bubbles_.clear(); }

    const std::vector<ChatBubble>& all() const { return bubbles_; }

    /// 1 for a bubble in the body of its life, easing to 0 over the last
    /// kFadeSeconds. Both the alpha and the scale are driven by it.
    static double fade(const ChatBubble& bubble);

private:
    std::vector<ChatBubble> bubbles_;
};

} // namespace flix
