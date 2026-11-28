// `/profile [name]`, end to end over loopback.
//
// The card is read from the saved row, so it has to work for an account that
// is not signed in, and it has to say who is on. What goes over the wire is
// checked by the client reading it back: a field written in the wrong order
// would show here as a name in the level.

#include "test.h"

#include <string>

#include "server_harness.h"
#include "test_data.h"

using namespace flix;
using namespace flix::testsupport;

namespace {

/// The stack of `petalKey` at `rarity` in a card's bag, or 0.
std::uint32_t stackOf(const PlayerProfileView& card, const char* petalKey, Rarity rarity) {
    const std::uint16_t index = petalIndexFromInventoryKey(petalKey);
    for (const Profile::Stack& stack : card.inventory) {
        if (stack.petalIndex == index && stack.rarity == rarity) return stack.count;
    }
    return 0;
}

} // namespace

TEST(profile_shows_an_offline_accounts_saved_card) {
    Harness h("profile-offline", [](const std::string& path) {
        seedUser(path, "asker", "password7");
        seedUser(path, "ghost", "password7");
        seedStack(path, "ghost", "petal_rose", Rarity::Legendary, 3);
        seedStack(path, "ghost", "petal_rose", Rarity::Common, 12);
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient asker;
    CHECK(loginAs(h, asker, "asker", "password7"));
    asker.joinGame(1000, 800, {}, "Asker");
    CHECK(h.stepUntil({&asker}, [&] { return asker.status() == NetClient::Status::Playing; }));

    // Any capitalisation of the name finds the account.
    asker.sendChat("/profile GHOST");
    CHECK(h.stepUntil({&asker}, [&] { return asker.playerProfileView().name == "ghost"; }));
    CHECK(asker.takePlayerProfileRequest());
    CHECK(!asker.takePlayerProfileRequest());   // once per answer

    const PlayerProfileView& card = asker.playerProfileView();
    CHECK(!card.online);
    CHECK(card.level == 1);
    CHECK(card.totalXp == 0.0);
    CHECK(card.loadout.size() == static_cast<std::size_t>(kLoadoutSlots));
    CHECK(stackOf(card, "petal_rose", Rarity::Legendary) == 3);
    CHECK(stackOf(card, "petal_rose", Rarity::Common) == 12);
    // Rarest first, which is the order the card lays the bag out in.
    CHECK(!card.inventory.empty());
    if (!card.inventory.empty()) {
        CHECK(rarityIndex(card.inventory.front().rarity) >= rarityIndex(card.inventory.back().rarity));
    }
}

TEST(profile_says_who_is_online_and_defaults_to_yourself) {
    Harness h("profile-online", [](const std::string& path) {
        seedUser(path, "asker", "password7");
        seedUser(path, "other", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient asker, other;
    CHECK(loginAs(h, asker, "asker", "password7"));
    CHECK(loginAs(h, other, "other", "password7"));
    asker.joinGame(1000, 800, {}, "Asker");
    other.joinGame(1000, 800, {}, "Other");
    CHECK(h.stepUntil({&asker, &other}, [&] {
        return asker.status() == NetClient::Status::Playing &&
               other.status() == NetClient::Status::Playing;
    }));

    asker.sendChat("/profile other");
    CHECK(h.stepUntil({&asker, &other}, [&] { return asker.playerProfileView().name == "other"; }));
    CHECK(asker.playerProfileView().online);

    // No name is the asker's own card. A second client, so the one-a-second
    // limit on the first is not what this waits on.
    other.sendChat("/profile");
    CHECK(h.stepUntil({&asker, &other}, [&] { return other.playerProfileView().name == "other"; }));
    CHECK(other.playerProfileView().online);
}

TEST(profile_of_a_name_that_is_no_account_is_answered_in_chat) {
    Harness h("profile-missing", [](const std::string& path) {
        seedUser(path, "asker", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient asker;
    CHECK(loginAs(h, asker, "asker", "password7"));
    asker.joinGame(1000, 800, {}, "Asker");
    CHECK(h.stepUntil({&asker}, [&] { return asker.status() == NetClient::Status::Playing; }));

    const std::uint64_t mark = asker.chatSequence();
    asker.sendChat("/profile nobody_by_this_name");
    CHECK(h.stepUntil({&asker}, [&] {
        return sawTextSince(asker, mark, "No player named");
    }));
    // Nothing to open: the card state is still empty.
    CHECK(asker.playerProfileView().name.empty());
    CHECK(!asker.takePlayerProfileRequest());
}
