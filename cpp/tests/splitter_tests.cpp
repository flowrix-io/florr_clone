// The splitter petal, end to end on a real server.
//
// Four claims, and they are the whole feature:
//
//   * EQUIPPING it splits the flower, with no reload paid and no message sent
//     -- the split follows the loadout.
//   * The two halves are placed on either side of the petal's own cut line,
//     which its artwork draws vertically: one left, one right.
//   * CLICKING the loaded petal hands control to the other half and spends the
//     slot, so switching costs a reload and wearing it does not.
//   * The two halves are one person: they cannot hurt each other, they are
//     each other's squadmates, and no other squad will take them.
//
// Everything below the socket is the shipping path -- a real GameServer, a
// real NetClient, the real protocol.

#include "test.h"

#include <cmath>
#include <string>
#include <vector>

#include "client/net_client.h"
#include "server/game_server.h"
#include "server/loot_eligibility.h"
#include "server_harness.h"
#include "shared/game/config.h"

using namespace flix;

namespace {

using flix::testsupport::Harness;
using flix::testsupport::loginNew;

/// Every flower in the world belonging to `username`, however many bodies it
/// is steering. The test asks the WORLD rather than the session table because
/// "how many bodies does this account have" is exactly what is under test.
std::vector<Entity> bodiesNamed(World& world, const std::string& username) {
    std::vector<Entity> found;
    Query<PlayerTag, PlayerAccount> bodies{world};
    bodies.each([&](Entity e, PlayerTag&, PlayerAccount& account) {
        if (account.userId == username || account.username == username) found.push_back(e);
    });
    return found;
}

/// The one body a just-joined client owns.
Entity soleBody(World& world, const std::string& name) {
    const std::vector<Entity> found = bodiesNamed(world, name);
    return found.size() == 1 ? found.front() : NULL_ENTITY;
}

/// Equips a splitter the way a player does: a petal into the account's bag,
/// then a SetLoadout message.
///
/// Deliberately NOT a write into the live body's Loadout, which is the
/// shortcut the sponge and root tests take. A splitter's second body is built
/// from the ACCOUNT RECORD, so a petal that exists only on one body's
/// component is a splitter the clone does not wear -- and then switching to
/// the clone merges the flower straight back together. The real path is the
/// only one that tests the real thing.
bool equipSplitter(Harness& h, NetClient& client, const char* account, std::uint16_t splitter) {
    if (!h.server.grantAdmin(account)) return false;
    client.sendChat(std::string("/admin give ") + account + " " + kSplitterPetalId + " common 1");
    if (!h.stepUntil({&client}, [&] {
            return client.profile().stackCount(splitter, Rarity::Common) > 0;
        })) {
        return false;
    }
    client.setLoadoutSlot(0, splitter, Rarity::Common);
    return h.stepUntil({&client}, [&] {
        return !client.profile().loadout.empty() &&
               client.profile().loadout[0].petalIndex == splitter;
    });
}

} // namespace

TEST(equipping_a_splitter_cuts_the_flower_along_the_petals_line) {
    Harness h("splitter-equip", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient alice;
    CHECK(loginNew(h, alice, "alice", "hunter2!"));
    alice.joinGame(1280, 720, {}, "alice");
    CHECK(h.stepUntil({&alice}, [&] { return alice.status() == NetClient::Status::Playing; }));

    World& world = h.server.world();
    const Entity original = soleBody(world, "alice");
    CHECK(original != NULL_ENTITY);
    if (original == NULL_ENTITY) return;

    const std::uint16_t splitter = content().petalIndex(kSplitterPetalId);
    CHECK(splitter != kInvalidIndex);
    if (splitter == kInvalidIndex) return;

    // No use, no chord, no reload: wearing it is what splits you. Budgeted at
    // a handful of ticks rather than the default four hundred, because "as
    // soon as it is equipped" is the claim -- a version that waited out the
    // petal's ten-second cooldown would pass an open-ended wait.
    CHECK(equipSplitter(h, alice, "alice", splitter));
    CHECK(h.stepUntil({&alice}, [&] { return bodiesNamed(world, "alice").size() == 2; }, 5));
    const std::vector<Entity> halves = bodiesNamed(world, "alice");
    CHECK_EQ(halves.size(), std::size_t{2});
    if (halves.size() != 2) return;

    // The petal's artwork is a flower clipped by a vertical line, so the cut
    // is vertical and the halves are a LEFT one and a RIGHT one: same row,
    // one body's width apart. Measured on the tick the split happened, before
    // the ordinary body separation has had anything to say about it.
    const Vec2 a = world.get<Transform>(halves[0]).position;
    const Vec2 b = world.get<Transform>(halves[1]).position;
    const double radius = world.get<Body>(halves[0]).radius;
    CHECK(std::fabs(a.y - b.y) < 1.0);
    CHECK(std::fabs(std::fabs(a.x - b.x) - radius * 2.0) < 1.0);

    // And it did not wait for a reload -- it split THROUGH one. Every slot
    // serves a full cooldown the moment its contents change, equipping
    // included (PetalSystem::reconcileSlots), so the flower coming apart while
    // that one is still running is the proof that wearing the petal is the
    // whole trigger. Switching halves is the part that has to wait for it.
    CHECK(world.get<Loadout>(original).slots[0].broken);
}

TEST(a_split_flowers_two_halves_are_one_persons) {
    Harness h("splitter-one-person", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient alice;
    CHECK(loginNew(h, alice, "alice", "hunter2!"));
    alice.joinGame(1280, 720, {}, "alice");
    CHECK(h.stepUntil({&alice}, [&] { return alice.status() == NetClient::Status::Playing; }));

    World& world = h.server.world();
    const Entity original = soleBody(world, "alice");
    CHECK(original != NULL_ENTITY);
    if (original == NULL_ENTITY) return;
    const std::uint16_t splitter = content().petalIndex(kSplitterPetalId);
    if (splitter == kInvalidIndex) { CHECK(false); return; }

    // Wounded going in: a split is a flower cut in two, not a second one
    // issued free, so the halves come out at the fraction it was standing at
    // rather than one of them at full.
    Health& pool = world.get<Health>(original);
    pool.current = pool.max * 0.5;
    CHECK(equipSplitter(h, alice, "alice", splitter));
    CHECK(h.stepUntil({&alice}, [&] { return bodiesNamed(world, "alice").size() == 2; }));

    const std::vector<Entity> halves = bodiesNamed(world, "alice");
    if (halves.size() != 2) { CHECK(false); return; }
    const double hurt = world.get<Health>(halves[0]).fraction();
    // Stated as "the same, and not full" rather than as an exact 0.5: the
    // equip takes a handful of ticks to come back and a flower's own passive
    // heal runs through them, so pinning the number would be pinning the
    // regeneration rate as well.
    CHECK(hurt < 0.9);
    CHECK(std::fabs(world.get<Health>(halves[1]).fraction() - hurt) < 0.02);

    // The same connection on both, which is what every "one person" rule below
    // keys off -- combat's friendly-fire exemption and the loot ranking's
    // one-share-per-person.
    const net::ConnectionId owner = world.get<PlayerAccount>(halves[0]).connection;
    CHECK(owner != 0);
    CHECK_EQ(world.get<PlayerAccount>(halves[1]).connection, owner);

    // BOTH ARE STREAMED to their owner's client. The parked half is one click
    // away from being the one you are steering, so it is never allowed to fall
    // out of the snapshot -- and its party bar is drawn from the body, so a
    // half that is not streamed is a bar with nothing in it.
    CHECK(h.stepUntil({&alice}, [&] {
        std::size_t flowers = 0;
        for (const auto& e : alice.view().entities()) {
            if (e.second.kind == net::EntityKind::Player) ++flowers;
        }
        return flowers == 2;
    }));

    // One squad, holding both bodies: the party HUD carries a bar for the half
    // the player is not looking through.
    CHECK(h.stepUntil({&alice}, [&] { return alice.squad().inSquad; }));
    CHECK_EQ(alice.squad().members.size(), std::size_t{2});
    CHECK(alice.squad().members[0].netId != 0);
    CHECK(alice.squad().members[1].netId != 0);
    CHECK(alice.squad().members[0].netId != alice.squad().members[1].netId);
}

TEST(one_persons_two_bodies_rank_and_are_paid_as_one) {
    // The loot ranking is a pure function over a damage tally, so the claim is
    // made here rather than through a socket: two bodies on one connection are
    // ONE contender scored on one person's damage, and they take one of the
    // corpse's slots between them.
    SquadEntityIndex index;
    const Entity left = static_cast<Entity>(101);
    const Entity right = static_cast<Entity>(102);
    index.groups.push_back({SquadBody{left, 7}, SquadBody{right, 7}});
    index.group[left] = 0;
    index.group[right] = 0;

    CHECK_EQ(contenderSize(index.groups[0]), 1);

    std::vector<Bounty::Share> shares;
    shares.push_back({left, 50.0});
    std::vector<Entity> paid;
    selectLootRecipients(shares, 4, &index, paid);
    // One slot spent, on the half that did the work.
    CHECK_EQ(paid.size(), std::size_t{1});
    if (!paid.empty()) CHECK_EQ(paid.front(), left);

    // And two real people in a squad still take two slots, so the rule above
    // did not just turn every squad into one payout.
    SquadEntityIndex pair;
    pair.groups.push_back({SquadBody{left, 7}, SquadBody{right, 8}});
    pair.group[left] = 0;
    pair.group[right] = 0;
    CHECK_EQ(contenderSize(pair.groups[0]), 2);
    selectLootRecipients(shares, 4, &pair, paid);
    CHECK_EQ(paid.size(), std::size_t{2});
}

TEST(clicking_the_loaded_splitter_swaps_halves_and_pays_a_reload) {
    Harness h("splitter-click", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient alice;
    CHECK(loginNew(h, alice, "alice", "hunter2!"));
    alice.joinGame(1280, 720, {}, "alice");
    CHECK(h.stepUntil({&alice}, [&] { return alice.status() == NetClient::Status::Playing; }));

    World& world = h.server.world();
    const Entity original = soleBody(world, "alice");
    if (original == NULL_ENTITY) { CHECK(false); return; }
    const std::uint16_t splitter = content().petalIndex(kSplitterPetalId);
    if (splitter == kInvalidIndex) { CHECK(false); return; }

    CHECK(equipSplitter(h, alice, "alice", splitter));
    CHECK(h.stepUntil({&alice}, [&] { return bodiesNamed(world, "alice").size() == 2; }, 5));

    // Which flower the client is looking through, before and after. The client
    // learns this from the self flag on a spawn record, which is what the
    // switch's view reset restates.
    const std::uint32_t steered = alice.view().self().netId;
    CHECK(steered != 0);

    // A click before the petal has loaded does nothing at all -- the equip
    // cooldown is a real one, and the tile is drawn with its wedge over it.
    alice.usePetal(0);
    h.step(10, {&alice});
    CHECK_EQ(alice.view().self().netId, steered);

    // Loaded, and now it swaps. Budgeted past the petal's own ten seconds, and
    // waiting on BOTH halves: they were born a tick apart, so their equip
    // cooldowns lapse a tick apart, and "loaded" has to mean the one the click
    // will land on as well as the one it is sent from.
    CHECK(h.stepUntil({&alice}, [&] {
        for (const Entity half : bodiesNamed(world, "alice")) {
            if (world.get<Loadout>(half).slots[0].broken) return false;
        }
        return true;
    }, 600));
    alice.usePetal(0);
    CHECK(h.stepUntil({&alice}, [&] { return alice.view().self().netId != steered; }));
    // Still two flowers: a switch does not merge them.
    CHECK_EQ(bodiesNamed(world, "alice").size(), std::size_t{2});
    // And the slot is reloading, on BOTH halves, so the bar reads the same
    // whichever body is being steered.
    for (const Entity half : bodiesNamed(world, "alice")) {
        CHECK(world.get<Loadout>(half).slots[0].broken);
    }
    CHECK(h.stepUntil({&alice}, [&] {
        return alice.view().self().slotReloadRemainingMillis[0] > 0.0;
    }));

    // A second click while it reloads does nothing: the switch is rationed by
    // the petal's own cooldown.
    const std::uint32_t nowSteering = alice.view().self().netId;
    alice.usePetal(0);
    h.step(10, {&alice});
    CHECK_EQ(alice.view().self().netId, nowSteering);
}

TEST(taking_the_splitter_off_puts_the_flower_back_together) {
    Harness h("splitter-merge", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient alice;
    CHECK(loginNew(h, alice, "alice", "hunter2!"));
    alice.joinGame(1280, 720, {}, "alice");
    CHECK(h.stepUntil({&alice}, [&] { return alice.status() == NetClient::Status::Playing; }));

    World& world = h.server.world();
    const Entity original = soleBody(world, "alice");
    if (original == NULL_ENTITY) { CHECK(false); return; }
    const std::uint16_t splitter = content().petalIndex(kSplitterPetalId);
    if (splitter == kInvalidIndex) { CHECK(false); return; }

    CHECK(equipSplitter(h, alice, "alice", splitter));
    CHECK(h.stepUntil({&alice}, [&] { return bodiesNamed(world, "alice").size() == 2; }));

    // Off the bar. One account, one loadout: the unequip reaches both bodies
    // through applyAccountToSession, which is what the merge then reads.
    alice.setLoadoutSlot(0, kNoPetal, Rarity::Common);
    CHECK(h.stepUntil({&alice}, [&] { return bodiesNamed(world, "alice").size() == 1; }));
    // The flower left standing is the one the player was steering, and its
    // client is still looking through it.
    const std::vector<Entity> left = bodiesNamed(world, "alice");
    CHECK_EQ(left.size(), std::size_t{1});
    if (left.empty()) return;
    CHECK(world.has<NetId>(left.front()));
    CHECK_EQ(alice.view().self().netId, world.get<NetId>(left.front()).value);
}

TEST(a_split_flower_may_not_join_a_squad) {
    Harness h("splitter-squad", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient alice;
    NetClient bob;
    CHECK(loginNew(h, alice, "alice", "hunter2!"));
    CHECK(loginNew(h, bob, "bob", "hunter2!"));
    alice.joinGame(1280, 720, {}, "alice");
    bob.joinGame(1280, 720, {}, "bob");
    CHECK(h.stepUntil({&alice, &bob}, [&] {
        return alice.status() == NetClient::Status::Playing &&
               bob.status() == NetClient::Status::Playing;
    }));

    World& world = h.server.world();
    const Entity original = soleBody(world, "alice");
    if (original == NULL_ENTITY) { CHECK(false); return; }
    const std::uint16_t splitter = content().petalIndex(kSplitterPetalId);
    if (splitter == kInvalidIndex) { CHECK(false); return; }

    CHECK(equipSplitter(h, alice, "alice", splitter));
    CHECK(h.stepUntil({&alice}, [&] { return bodiesNamed(world, "alice").size() == 2; }));

    // Bob opens a squad and invites the split flower. The invitation is
    // refused at the door rather than left pending, so nothing is waiting for
    // an answer when the splitter comes off.
    bob.sendChat("/squad create public");
    h.step(5, {&alice, &bob});
    bob.sendChat("/squad-invite alice");
    h.step(10, {&alice, &bob});

    // Alice is still in her OWN squad -- the one the split made -- and it holds
    // nobody but her two flowers.
    CHECK(alice.squad().inSquad);
    CHECK_EQ(alice.squad().members.size(), std::size_t{2});
    for (const auto& member : alice.squad().members) CHECK_EQ(member.account, std::string("alice"));
    // Bob's squad is still his alone: the invite did not quietly land.
    CHECK(bob.squad().inSquad);
    CHECK_EQ(bob.squad().members.size(), std::size_t{1});

    // And she cannot walk into a public one either.
    alice.sendChat("/squad-join " + std::string("squad_nonexistent"));
    h.step(5, {&alice, &bob});
    CHECK_EQ(alice.squad().members.size(), std::size_t{2});
}

TEST(losing_a_half_ends_the_split_and_the_splitter_reloads) {
    Harness h("splitter-death", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient alice;
    CHECK(loginNew(h, alice, "alice", "hunter2!"));
    alice.joinGame(1280, 720, {}, "alice");
    CHECK(h.stepUntil({&alice}, [&] { return alice.status() == NetClient::Status::Playing; }));

    World& world = h.server.world();
    const Entity original = soleBody(world, "alice");
    if (original == NULL_ENTITY) { CHECK(false); return; }
    const std::uint16_t splitter = content().petalIndex(kSplitterPetalId);
    if (splitter == kInvalidIndex) { CHECK(false); return; }

    CHECK(equipSplitter(h, alice, "alice", splitter));
    CHECK(h.stepUntil({&alice}, [&] { return bodiesNamed(world, "alice").size() == 2; }));

    // Kill the half the player is NOT steering. That is a lost flower, not a
    // death: no death card, and the player carries on in the one still up.
    const std::uint32_t steered = alice.view().self().netId;
    Entity parked = NULL_ENTITY;
    for (const Entity half : bodiesNamed(world, "alice")) {
        if (world.get<NetId>(half).value != steered) parked = half;
    }
    CHECK(parked != NULL_ENTITY);
    if (parked == NULL_ENTITY) return;
    world.get<Health>(parked).current = 0.0;

    CHECK(h.stepUntil({&alice}, [&] { return bodiesNamed(world, "alice").size() == 1; }));
    CHECK(!alice.dead());
    CHECK_EQ(alice.view().self().netId, steered);

    // And the splitter is reloading, which is what keeps the spare from being
    // replaced on the very next tick. When it lapses, the flower splits again
    // -- the petal is still on the bar and the bar is what splits you.
    const Entity survivor = bodiesNamed(world, "alice").front();
    CHECK(world.get<Loadout>(survivor).slots[0].broken);
    CHECK(h.stepUntil({&alice}, [&] { return bodiesNamed(world, "alice").size() == 2; }, 600));
}
