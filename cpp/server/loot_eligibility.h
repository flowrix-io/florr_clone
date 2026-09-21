#pragma once
// Who earned rights to a mob's rewards.
//
// One rule, read by two systems: the loot system decides who a drop is
// reserved for, and the combat system decides who is paid its XP. They used to
// each rank the damage tally themselves, which was the same rule written
// twice; with squads in the world it would be the same rule written twice and
// only one of them squad-aware.
//
// The rule itself is src/server/shared/lootEligibility.ts, and what it gets
// right is worth restating: the cap is spent in PLAYERS but the ranking is by
// CONTENDER, and a squad is ONE contender. Ranking a squad's members
// separately lets a party of four fill every slot on an ordinary mob; capping
// contenders instead of players lets four squads of four take sixteen.
//
// A SQUAD SHARES. Once a squad is a contender at all, every member of it is
// paid -- that is what being in a party means here, and it is the whole
// reason to be in one. The price of that share is paid in the SCORE: a
// squad's damage credit is its total over its FULL MEMBERSHIP, so a member
// who stood and watched does not merely fail to add to the squad's ranking,
// they dilute it. Four flowers at twenty damage each rank exactly where one
// flower at twenty does; three of them idle while the fourth does eighty
// ranks the same again. A party cannot out-rank a solo player by being
// numerous, and cannot pad its average by leaving the passengers out of it.

#include <algorithm>
#include <cstddef>
#include <vector>

#include "server/squads.h"
#include "shared/core/entity.h"
#include "shared/core/types.h"
#include "shared/game/components.h"

namespace flix {

/// How many players may be paid for a mob of this tier.
///
/// Everything up to and including mythic shares the base count; the boss tiers
/// open up because they take a crowd to kill. Apex was not in the table these
/// numbers came from -- it sits above unique, so it inherits unique's count
/// rather than falling back to the base four.
inline int lootSlotsForRarity(Rarity rarity) {
    if (rarity == Rarity::Ultra) return 15;
    if (rarity == Rarity::Super) return 20;
    if (rarity == Rarity::Unique || rarity == Rarity::Apex) return 25;
    return 4;
}

/// Ranks `contributors` and fills `out` with the players who may be paid.
///
/// `contributors` is the corpse's damage tally, already filtered to positive
/// damage, in first-hit order -- every sort below is stable, so an exact
/// damage tie is settled by who hit first, which is the reference's rule.
/// `squads` may be null, which is the ordinary case: no squad on the corpse
/// means every contributor ranks as itself and this is a sort and a truncate.
inline void selectLootRecipients(const std::vector<Bounty::Share>& contributors, int slots,
                                 const SquadEntityIndex* squads, std::vector<Entity>& out) {
    out.clear();
    if (slots <= 0 || contributors.empty()) return;

    const auto damageOf = [&](Entity player) {
        for (const Bounty::Share& share : contributors) {
            if (share.player == player) return share.damage;
        }
        return 0.0;
    };

    // One contender per unsquadded player, plus one per squad that touched the
    // corpse. A squad's score is its AVERAGE damage per member, not its total:
    // a party would otherwise outrank a solo player who did more work than any
    // of them by simply having more members.
    struct Contender {
        std::size_t group = 0;        ///< index into squads->groups, when squadded
        Entity player = NULL_ENTITY;  ///< the member itself, when not
        double score = 0;
        /// What the score is divided by: 1 for a solo player, and the SQUAD'S
        /// FULL SIZE for a squad -- not the number of its members that landed
        /// a hit. Everyone in it gets paid, so everyone in it counts.
        int members = 0;
        bool squadded = false;
    };
    std::vector<Contender> ranked;
    ranked.reserve(contributors.size());

    for (const Bounty::Share& share : contributors) {
        const std::vector<SquadBody>* squad =
            squads != nullptr ? squads->membersOf(share.player) : nullptr;
        if (squad == nullptr) {
            ranked.push_back({0, share.player, share.damage, 1, false});
            continue;
        }
        const std::size_t group = squads->group.find(share.player)->second;
        auto existing = std::find_if(ranked.begin(), ranked.end(), [&](const Contender& c) {
            return c.squadded && c.group == group;
        });
        if (existing == ranked.end()) {
            // Divided by the WHOLE squad, not by the members who happened to
            // land a hit: everyone in it is about to be paid, so everyone in
            // it counts in what the payment was earned with. Dividing by the
            // hitters instead would make a four-flower squad with one idle
            // member rank higher than the same squad with that member
            // helping, which is the wrong way round.
            ranked.push_back({group, NULL_ENTITY, share.damage,
                              static_cast<int>(squad->size()), true});
        } else {
            existing->score += share.damage;
        }
    }
    for (Contender& contender : ranked) {
        if (contender.members > 1) contender.score /= contender.members;
    }
    std::stable_sort(ranked.begin(), ranked.end(),
                     [](const Contender& a, const Contender& b) { return a.score > b.score; });

    std::vector<Entity> members;
    for (const Contender& contender : ranked) {
        if (static_cast<int>(out.size()) >= slots) break;

        members.clear();
        if (!contender.squadded) {
            members.push_back(contender.player);
        } else {
            // EVERY member that can hold the share, whether they touched the
            // mob or not: the squad earned this as one contender, on a score
            // its whole membership was divided into, and it is paid as one.
            //
            // A BOT IS THE EXCEPTION, and only to the FREE share: it owns no
            // account, so a slot spent on one is an item nobody receives and
            // a player shut out. One that actually fought keeps its slot --
            // that is the same claim any contributor has, and it is what
            // leaves bot kills something to walk over and collect.
            //
            // Ordered by their own damage all the same, because the cap is
            // spent in players and can fall inside a squad -- four squadmates
            // do not fit in the three slots a common mob has left. When it
            // cuts, it cuts the passengers first.
            for (const SquadBody& member : squads->groups[contender.group]) {
                if (!member.banks() && damageOf(member.body) <= 0.0) continue;
                members.push_back(member.body);
            }
            std::stable_sort(members.begin(), members.end(), [&](Entity a, Entity b) {
                return damageOf(a) > damageOf(b);
            });
        }

        for (const Entity member : members) {
            if (static_cast<int>(out.size()) >= slots) break;
            if (std::find(out.begin(), out.end(), member) != out.end()) continue;
            out.push_back(member);
        }
    }
}

} // namespace flix
