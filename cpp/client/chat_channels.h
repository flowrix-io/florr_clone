#pragma once
#include <string>
namespace flix {
enum ChatTab : int {
    kTabLocal, kTabGlobal, kTabSquad, kTabGuild, kTabWhisper, kTabAdmin, kChatTabCount
};
constexpr bool chatTabSendable(int tab, bool fullAdmin) {
    return tab >= 0 && tab < kChatTabCount && (tab != kTabAdmin || fullAdmin);
}
inline std::string chatChannelCommand(int tab, const std::string& whisperPartner) {
    switch (tab) {
        case kTabLocal: return "/l ";
        case kTabSquad: return "/s ";
        case kTabGuild: return "/g ";
        case kTabWhisper: return "/w " + whisperPartner + " ";
        case kTabAdmin: return "/admin announce ";
        default: return {};
    }
}
}
