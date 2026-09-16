#include "client/chat_bubbles.h"

#include <algorithm>

namespace flix {

void ChatBubbles::add(std::uint32_t speakerNetId, std::string text) {
    if (speakerNetId == 0 || text.empty()) return;

    // Everything this speaker already had goes up a row, and anything pushed
    // past the top is gone. Only this speaker's stack moves: two flowers
    // talking at once do not shunt each other's lines around.
    for (ChatBubble& bubble : bubbles_) {
        if (bubble.speakerNetId == speakerNetId) ++bubble.row;
    }
    bubbles_.erase(std::remove_if(bubbles_.begin(), bubbles_.end(),
                                  [](const ChatBubble& b) { return b.row >= kRows; }),
                   bubbles_.end());

    ChatBubble fresh;
    fresh.speakerNetId = speakerNetId;
    fresh.text = std::move(text);
    bubbles_.push_back(std::move(fresh));
}

void ChatBubbles::update(double dtSeconds) {
    for (ChatBubble& bubble : bubbles_) bubble.ageSeconds += dtSeconds;
    bubbles_.erase(std::remove_if(bubbles_.begin(), bubbles_.end(),
                                  [](const ChatBubble& b) {
                                      return b.ageSeconds >= kLifetimeSeconds;
                                  }),
                   bubbles_.end());
}

double ChatBubbles::fade(const ChatBubble& bubble) {
    const double left = kLifetimeSeconds - bubble.ageSeconds;
    if (left >= kFadeSeconds) return 1.0;
    if (left <= 0.0) return 0.0;
    return left / kFadeSeconds;
}

} // namespace flix
