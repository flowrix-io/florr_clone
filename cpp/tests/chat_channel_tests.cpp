#include "test.h"
#include "client/chat_channels.h"
using namespace flix;
TEST(chat_admin_tab_cycles_only_for_full_admins_and_uses_the_announce_command) {
    for (bool admin : {false,true}) {
        int current=kTabLocal,steps=0;
        do { current=(current+1)%kChatTabCount; if(chatTabSendable(current,admin))++steps; }
        while(current!=kTabLocal);
        CHECK_EQ(steps,admin?6:5);
    }
    CHECK(!chatTabSendable(kTabAdmin,false));CHECK(chatTabSendable(kTabAdmin,true));
    CHECK(!chatTabSendable(-1,true));CHECK(!chatTabSendable(kChatTabCount,true));
    CHECK_EQ(chatChannelCommand(kTabAdmin,""),std::string("/admin announce "));
    CHECK_EQ(chatChannelCommand(kTabWhisper,"bob"),std::string("/w bob "));
    CHECK_EQ(chatChannelCommand(kTabLocal,""),std::string("/l "));
}
