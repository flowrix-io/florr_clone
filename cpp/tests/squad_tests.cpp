// The squad rules, and the reward ranking a squad changes.
//
// Both are held here rather than in chat_command_tests.cpp because neither
// needs a socket: SquadRoster is pure state, and selectLootRecipients is a pure
// function over a damage tally. The command surface over them is covered end to
// end there.

#include "test.h"

#include <string>
#include <vector>

#include "server/loot_eligibility.h"
#include "server/squads.h"

using namespace flix;

namespace {

SquadMemberId human(net::ConnectionId id) { return SquadMemberId::ofSession(id); }
SquadMemberId bot(Entity body) { return SquadMemberId::ofBot(body); }

/// A body id that is not a connection id, so a test cannot pass by confusing
/// the two.
Entity body(std::uint32_t n) { return static_cast<Entity>(1000 + n); }

} // namespace

TEST(a_squad_holds_one_leader_and_at_most_four) {
    Rng rng(1);
    SquadRoster roster;

    Squad* squad = roster.create(human(1), false, rng);
    CHECK(squad != nullptr);
    CHECK(squad->leader == human(1));
    CHECK(squad->members.size() == 1);
    CHECK(!squad->isPublic);
    CHECK(squad->id.rfind("squad_", 0) == 0);

    // Already in one: the reference answers this with "You are already in a
    // squad." and creates nothing.
    CHECK(roster.create(human(1), true, rng) == nullptr);

    for (net::ConnectionId id = 2; id <= 4; ++id) {
        CHECK(roster.invite(human(1), human(id), "one", 0).empty());
        std::string joined;
        CHECK(roster.accept(human(id), 0, joined).empty());
        CHECK(joined == squad->id);
    }
    CHECK(squad->members.size() == kMaxSquadSize);
    CHECK(roster.invite(human(1), human(5), "one", 0) == "Squad is full (max 4 players).");
}

TEST(only_the_leader_invites_and_only_once_per_target) {
    Rng rng(2);
    SquadRoster roster;
    Squad* squad = roster.create(human(1), false, rng);
    CHECK(squad != nullptr);

    CHECK(roster.invite(human(1), human(2), "one", 0).empty());
    std::string joined;
    CHECK(roster.accept(human(2), 0, joined).empty());

    CHECK(roster.invite(human(2), human(3), "two", 0) ==
          "Only the squad leader can invite players.");
    CHECK(roster.invite(human(9), human(3), "nine", 0) == "You are not in a squad.");
    CHECK(roster.invite(human(1), human(2), "one", 0) == "That player is already in a squad.");

    CHECK(roster.invite(human(1), human(3), "one", 0).empty());
    CHECK(roster.invite(human(1), human(3), "one", 0) == "That player already has a pending "
                                                         "invite.");
}

TEST(an_invitation_lapses_after_thirty_seconds) {
    Rng rng(3);
    SquadRoster roster;
    CHECK(roster.create(human(1), false, rng) != nullptr);
    CHECK(roster.invite(human(1), human(2), "one", 0).empty());

    std::string joined;
    CHECK(roster.accept(human(2), kSquadInviteMillis + 1, joined) == "Invite has expired.");
    // And it is gone, not merely refused once.
    CHECK(roster.accept(human(2), 0, joined) == "No pending invite.");

    // The sweep drops one nobody ever answered, so a target who disconnects
    // does not leave a claim on a seat behind them.
    CHECK(roster.invite(human(1), human(3), "one", 0).empty());
    roster.expire(kSquadInviteMillis + 1);
    CHECK(roster.accept(human(3), kSquadInviteMillis + 1, joined) == "No pending invite.");
}

TEST(the_leader_leaving_promotes_the_next_member) {
    Rng rng(4);
    SquadRoster roster;
    Squad* squad = roster.create(human(1), false, rng);
    const std::string id = squad->id;
    CHECK(roster.invite(human(1), human(2), "one", 0).empty());
    std::string joined;
    CHECK(roster.accept(human(2), 0, joined).empty());

    const SquadRoster::Departure left = roster.leave(human(1));
    CHECK(left.wasMember);
    CHECK(!left.disbanded);
    CHECK(left.promoted == human(2));
    CHECK(roster.find(id)->leader == human(2));

    // The last member out takes the squad with them.
    const SquadRoster::Departure last = roster.leave(human(2));
    CHECK(last.wasMember);
    CHECK(last.disbanded);
    CHECK(roster.find(id) == nullptr);
    CHECK(!roster.leave(human(2)).wasMember);
}

TEST(a_bot_led_squad_is_always_public) {
    Rng rng(5);
    SquadRoster roster;

    // A private bot-led squad is one nobody could ever join, so there is no
    // such thing: the flag is forced on creation and again on promotion.
    Squad* squad = roster.create(bot(body(1)), false, rng);
    CHECK(squad != nullptr);
    CHECK(squad->isPublic);

    SquadRoster human_led;
    Squad* mine = human_led.create(human(1), false, rng);
    CHECK(human_led.addBot(mine->id, bot(body(2))).empty());
    CHECK(!mine->isPublic);
    CHECK(human_led.leave(human(1)).promoted == bot(body(2)));
    CHECK(mine->isPublic);
}

TEST(a_public_squad_is_joinable_until_it_is_full) {
    Rng rng(6);
    SquadRoster roster;
    Squad* open = roster.create(human(1), true, rng);
    Squad* shut = roster.create(human(2), false, rng);
    CHECK(open->isPublic);

    CHECK(roster.joinPublic(shut->id, human(3)) == "That squad is private.");
    CHECK(roster.joinPublic("squad_nothing", human(3)) == "Squad not found.");
    CHECK(roster.joinPublic(open->id, human(3)).empty());
    CHECK(roster.joinPublic(open->id, human(3)) == "You are already in a squad.");

    const std::vector<const Squad*> listed = roster.publicSquads();
    CHECK(listed.size() == 1);
    CHECK(listed.front()->id == open->id);

    // Visibility is the leader's to change, and only the leader's.
    Squad* changed = nullptr;
    CHECK(roster.setVisibility(human(3), false, &changed) ==
          "Only the squad leader can change visibility.");
    CHECK(roster.setVisibility(human(1), false, &changed).empty());
    CHECK(roster.publicSquads().empty());
}

// ---------------------------------------------------------------------------
// The reward ranking
// ---------------------------------------------------------------------------

namespace {

/// A squad of `members`, as the loot rules read one. Every member is a signed
/// in player: the connection is derived from the body so each one is distinct
/// and non-zero, which is what tells a person from a bot in SquadBody.
SquadEntityIndex indexOf(const std::vector<std::vector<Entity>>& squads) {
    SquadEntityIndex index;
    for (const std::vector<Entity>& members : squads) {
        const std::size_t group = index.groups.size();
        std::vector<SquadBody> bodies;
        for (const Entity member : members) {
            index.group[member] = group;
            bodies.push_back(SquadBody{member, static_cast<net::ConnectionId>(member)});
        }
        index.groups.push_back(std::move(bodies));
    }
    return index;
}

/// The same, with the LAST member a bot: a body in the squad with no account
/// behind it.
SquadEntityIndex indexWithBot(const std::vector<Entity>& members) {
    SquadEntityIndex index;
    std::vector<SquadBody> bodies;
    for (std::size_t i = 0; i < members.size(); ++i) {
        index.group[members[i]] = 0;
        const bool bot = i + 1 == members.size();
        bodies.push_back(SquadBody{members[i],
                                   bot ? 0 : static_cast<net::ConnectionId>(members[i])});
    }
    index.groups.push_back(std::move(bodies));
    return index;
}

bool paid(const std::vector<Entity>& recipients, Entity who) {
    return std::find(recipients.begin(), recipients.end(), who) != recipients.end();
}

} // namespace

TEST(unsquadded_contributors_rank_by_damage_and_are_capped) {
    const std::vector<Bounty::Share> tally = {
        {body(1), 50}, {body(2), 40}, {body(3), 30}, {body(4), 20}, {body(5), 10},
    };
    std::vector<Entity> paidOut;
    selectLootRecipients(tally, lootSlotsForRarity(Rarity::Common), nullptr, paidOut);
    CHECK(paidOut.size() == 4);
    CHECK(paidOut[0] == body(1));
    CHECK(paidOut[3] == body(4));
    CHECK(!paid(paidOut, body(5)));

    // A boss opens up, because a boss takes a crowd to kill.
    selectLootRecipients(tally, lootSlotsForRarity(Rarity::Ultra), nullptr, paidOut);
    CHECK(paidOut.size() == 5);
}

TEST(a_squad_ranks_as_one_contender_and_cannot_fill_every_slot) {
    // Four squadmates chipping in against one solo player who out-damaged all
    // of them. Ranked separately they take every slot on an ordinary mob and
    // the solo player -- who did the most work of anyone -- gets nothing.
    const std::vector<Bounty::Share> tally = {
        {body(1), 20}, {body(2), 20}, {body(3), 20}, {body(4), 20}, {body(9), 60},
    };
    const SquadEntityIndex squads = indexOf({{body(1), body(2), body(3), body(4)}});

    std::vector<Entity> paidOut;
    selectLootRecipients(tally, lootSlotsForRarity(Rarity::Common), &squads, paidOut);
    CHECK(paidOut.size() == 4);
    // The squad's AVERAGE is 20 against the solo player's 60, so they lead.
    CHECK(paidOut.front() == body(9));
    CHECK(paid(paidOut, body(1)));
    CHECK(paid(paidOut, body(4)) || paid(paidOut, body(3)));
}

TEST(a_squad_is_paid_as_one_and_a_passenger_dilutes_it) {
    // The whole point of a party: body(3) never touched the mob and is paid
    // anyway, because its squad earned the slot as one contender.
    const std::vector<Bounty::Share> tally = {{body(1), 60}, {body(2), 30}, {body(9), 25}};
    const SquadEntityIndex squads = indexOf({{body(1), body(2), body(3)}});

    std::vector<Entity> paidOut;
    selectLootRecipients(tally, lootSlotsForRarity(Rarity::Common), &squads, paidOut);
    CHECK(paid(paidOut, body(3)));
    CHECK(paid(paidOut, body(1)));
    CHECK(paid(paidOut, body(2)));
    CHECK(paid(paidOut, body(9)));
    // Within the squad the biggest contributor is placed first, so that when
    // the cap cuts into a squad it cuts the passengers.
    CHECK(paidOut[0] == body(1));

    // And what the passenger costs: 90 damage over THREE members is 30, which
    // the solo player's 25 does not beat -- but drop the passenger from the
    // squad and the same 90 over two members is 45, ranking the squad higher.
    // Divide by the hitters instead of by the membership and the passenger
    // would have cost nothing at all, which is a free slot for standing still.
    const SquadEntityIndex pair = indexOf({{body(1), body(2)}});
    std::vector<Entity> pairPaid;
    selectLootRecipients(tally, lootSlotsForRarity(Rarity::Common), &pair, pairPaid);
    CHECK(paidOut.front() == body(1));
    CHECK(pairPaid.front() == body(1));
    // The squad of three ranks BELOW the solo player it would have beaten as
    // a squad of two: same damage, one more passenger.
    const std::vector<Bounty::Share> closer = {{body(1), 60}, {body(2), 30}, {body(9), 35}};
    std::vector<Entity> trio;
    selectLootRecipients(closer, lootSlotsForRarity(Rarity::Common), &squads, trio);
    CHECK(trio.front() == body(9));   // 35 beats 90/3
    std::vector<Entity> duo;
    selectLootRecipients(closer, lootSlotsForRarity(Rarity::Common), &pair, duo);
    CHECK(duo.front() == body(1));    // 90/2 beats 35
}

TEST(the_cap_is_spent_in_players_not_in_squads) {
    // Two full squads on an ordinary mob. Capping CONTENDERS and expanding
    // afterwards -- the bug this rule exists to have fixed -- pays all eight.
    std::vector<Bounty::Share> tally;
    for (std::uint32_t i = 1; i <= 8; ++i) tally.push_back({body(i), 10.0 + i});
    const SquadEntityIndex squads =
        indexOf({{body(1), body(2), body(3), body(4)}, {body(5), body(6), body(7), body(8)}});

    std::vector<Entity> paidOut;
    selectLootRecipients(tally, lootSlotsForRarity(Rarity::Common), &squads, paidOut);
    CHECK(paidOut.size() == 4);
}

TEST(a_bot_squadmate_pools_its_damage_but_is_paid_no_free_share) {
    // The party a quiet server actually has: one player and the bots they
    // invited. The bots do the killing, and the PLAYER is paid for it --
    // that is the whole reason to squad with them.
    const std::vector<Bounty::Share> tally = {{body(2), 50}, {body(3), 40}};
    const SquadEntityIndex squads = indexWithBot({body(1), body(2), body(3)});

    std::vector<Entity> paidOut;
    selectLootRecipients(tally, lootSlotsForRarity(Rarity::Common), &squads, paidOut);
    CHECK(paid(paidOut, body(1)));   // the player, who never touched it
    CHECK(paid(paidOut, body(2)));   // a squadmate that fought
    // body(3) is the bot. It fought, so it keeps the slot it earned -- that
    // is what leaves bot kills something to collect off the ground.
    CHECK(paid(paidOut, body(3)));

    // A bot that did NOTHING is handed nothing: an item given to one is an
    // item nobody receives, and the slot would be taken from a player.
    const std::vector<Bounty::Share> soloTally = {{body(1), 50}, {body(9), 10}};
    std::vector<Entity> idle;
    selectLootRecipients(soloTally, lootSlotsForRarity(Rarity::Common), &squads, idle);
    CHECK(paid(idle, body(1)));
    CHECK(paid(idle, body(2)));   // a human passenger still shares
    CHECK(!paid(idle, body(3)));  // the idle bot does not
    CHECK(paid(idle, body(9)));
}

TEST(a_squads_passengers_are_cut_first_when_the_cap_falls_inside_it) {
    // The cap is spent in PLAYERS, so it can land in the middle of a squad.
    // Three solo players ahead of a squad of four leaves one slot for it, and
    // the member holding it is the one who did the work.
    const std::vector<Bounty::Share> tally = {
        {body(7), 90}, {body(8), 80}, {body(9), 70}, {body(1), 40}, {body(2), 10},
    };
    const SquadEntityIndex squads =
        indexOf({{body(1), body(2), body(3), body(4)}});

    std::vector<Entity> paidOut;
    selectLootRecipients(tally, lootSlotsForRarity(Rarity::Common), &squads, paidOut);
    CHECK(paidOut.size() == 4);
    CHECK(paidOut[3] == body(1));   // 40 damage: the squad's best
    CHECK(!paid(paidOut, body(3)));
    CHECK(!paid(paidOut, body(4)));

    // With room for the whole squad, every one of them is paid -- the two who
    // never touched it included.
    selectLootRecipients(tally, lootSlotsForRarity(Rarity::Ultra), &squads, paidOut);
    CHECK(paidOut.size() == 7);
    CHECK(paid(paidOut, body(3)));
    CHECK(paid(paidOut, body(4)));
}

TEST(a_contender_under_one_percent_of_the_mobs_health_is_paid_nothing) {
    // A 1000-health mob: the floor is 10 damage.
    const double floor = lootDamageFloor(1000.0);
    CHECK(floor == 10.0);

    // A stray hit on a mob somebody else killed earns nothing, even with
    // three of the common tier's four slots still empty.
    const std::vector<Bounty::Share> tally = {{body(1), 900}, {body(2), 10}, {body(3), 9.5}};
    std::vector<Entity> paidOut;
    selectLootRecipients(tally, lootSlotsForRarity(Rarity::Common), nullptr, paidOut, floor);
    CHECK(paidOut.size() == 2);
    CHECK(paid(paidOut, body(1)));
    CHECK(paid(paidOut, body(2)));   // exactly 1% is enough
    CHECK(!paid(paidOut, body(3)));

    // No floor, no refusal: the rule without one is the rule it always was.
    selectLootRecipients(tally, lootSlotsForRarity(Rarity::Common), nullptr, paidOut);
    CHECK(paid(paidOut, body(3)));

    // A mob with no health to measure against sets no floor at all.
    CHECK(lootDamageFloor(0.0) == 0.0);
}

TEST(a_squad_clears_the_floor_on_its_average_over_the_whole_membership) {
    const double floor = lootDamageFloor(1000.0);

    // 36 damage over a squad of three is 12 each: over the floor, so the
    // squad is paid as one -- body(2), on 4 alone, and body(3), who never
    // touched it, included.
    const std::vector<Bounty::Share> carried = {{body(9), 900}, {body(1), 32}, {body(2), 4}};
    const SquadEntityIndex squads = indexOf({{body(1), body(2), body(3)}});
    std::vector<Entity> paidOut;
    selectLootRecipients(carried, lootSlotsForRarity(Rarity::Common), &squads, paidOut, floor);
    CHECK(paidOut.size() == 4);
    CHECK(paid(paidOut, body(1)));
    CHECK(paid(paidOut, body(2)));
    CHECK(paid(paidOut, body(3)));

    // 27 over three is 9: under it, so NOBODY in the squad is paid -- not
    // even body(1), whose 24 would have cleared the floor on its own. The
    // average is the squad's score, and the passengers dilute it here too.
    const std::vector<Bounty::Share> diluted = {{body(9), 900}, {body(1), 24}, {body(2), 3}};
    selectLootRecipients(diluted, lootSlotsForRarity(Rarity::Common), &squads, paidOut, floor);
    CHECK(paidOut.size() == 1);
    CHECK(paid(paidOut, body(9)));
    CHECK(!paid(paidOut, body(1)));

    // Out of the squad, the same 24 clears the floor by itself.
    selectLootRecipients(diluted, lootSlotsForRarity(Rarity::Common), nullptr, paidOut, floor);
    CHECK(paid(paidOut, body(1)));
    CHECK(!paid(paidOut, body(2)));
}
