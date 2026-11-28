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

TEST(a_hidden_profile_is_shown_only_to_its_owner_and_admins) {
    Harness h("profile-hidden", [](const std::string& path) {
        seedUser(path, "asker", "password7");
        seedUser(path, "shy", "password7");
        seedUser(path, "staff", "password7", /*admin=*/true);
        seedUser(path, "later", "password7");
    }, dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }
    NetClient asker, shy, staff;
    CHECK(loginAs(h, asker, "asker", "password7"));
    CHECK(loginAs(h, shy, "shy", "password7"));
    CHECK(loginAs(h, staff, "staff", "password7"));
    asker.joinGame(1000, 800, {}, "Asker");
    shy.joinGame(1000, 800, {}, "Shy");
    staff.joinGame(1000, 800, {}, "Staff");
    CHECK(h.stepUntil({&asker, &shy, &staff}, [&] {
        return asker.status() == NetClient::Status::Playing &&
               shy.status() == NetClient::Status::Playing &&
               staff.status() == NetClient::Status::Playing;
    }));
    CHECK(!shy.profile().profileHidden);

    // The switch is answered with a Profile that says it is on.
    shy.requestSetProfileHidden(true);
    CHECK(h.stepUntil({&asker, &shy, &staff}, [&] { return shy.profile().profileHidden; }));

    // Another player is told it is private, and given no card -- whatever
    // capitalisation of the name they type.
    const std::uint64_t mark = asker.chatSequence();
    asker.sendChat("/profile SHY");
    CHECK(h.stepUntil({&asker, &shy, &staff}, [&] {
        return sawTextSince(asker, mark, "profile is private");
    }));
    CHECK(asker.playerProfileView().name.empty());
    CHECK(!asker.takePlayerProfileRequest());

    // The owner still sees their own, by name or without one.
    shy.sendChat("/profile shy");
    CHECK(h.stepUntil({&asker, &shy, &staff}, [&] { return shy.playerProfileView().name == "shy"; }));

    // So does an admin -- by the account's flag, not its name.
    staff.sendChat("/profile shy");
    CHECK(h.stepUntil({&asker, &shy, &staff}, [&] { return staff.playerProfileView().name == "shy"; }));

    // Off again, and the card is everyone's. A fresh asker, so the
    // one-a-second limit on the first is not what this waits on.
    shy.requestSetProfileHidden(false);
    CHECK(h.stepUntil({&asker, &shy, &staff}, [&] { return !shy.profile().profileHidden; }));
    NetClient later;
    CHECK(loginAs(h, later, "later", "password7"));
    later.joinGame(1000, 800, {}, "Later");
    CHECK(h.stepUntil({&later}, [&] { return later.status() == NetClient::Status::Playing; }));
    later.sendChat("/profile shy");
    CHECK(h.stepUntil({&later}, [&] { return later.playerProfileView().name == "shy"; }));
}
