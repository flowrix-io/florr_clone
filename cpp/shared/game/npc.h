#pragma once
// NPCs: creatures that stand in the world without being mobs.
//
// An NPC is a general entity type of its own -- NpcTag on the server,
// net::EntityKind::Npc on the wire -- but it is built out of a MOB. Its
// artwork, its size ladder, its tier and its name are a mobs.json entry, and
// what makes that entry an NPC is its `npc` block: which side it stands on and
// what it offers. The same entry is still an ordinary mob to everything else:
// `spawn oracle rare` puts a hostile one in the world, with that entry's stats
// and AI, and it fights like any other mob.
//
// An NPC is placed by a map (an `npc` object on its `npcs` layer) or by an
// admin's `spawn_npc`. A map may only place a mob that HAS an `npc` block; the
// admin may place any mob at all, taking the side from its block when it has
// one, from the command when it names one, and the players' side otherwise --
// what an empty block means. It is not a MobTag entity, so no system that hunts,
// farms, homes on, drifts or recycles mobs ever sees it -- bots do not farm
// it, pets do not chase it, petals are not attracted to it and the
// unseen-despawn sweep does not recycle it.
//
// It carries its mob's Health, armour and afflictions, and its pool NEVER
// MOVES: that is the one rule the damage path adds (CombatSystem::applyDamage).
// Which hits reach it at all is its side's business --
//
//   * on the players' team (the oracle) it refuses every hit outright;
//   * on any other (the target dummy, on the hostiles') it takes every hit its
//     side's rules allow, flashes, is numbered and counted, and loses nothing
//     -- and its body hits back as its mob's does: a flower touching it is
//     bumped and bitten, and a petal striking it pays for the swing out of its
//     own health, so a ring on a dummy breaks and reloads as it would on the
//     real thing. That is what makes the dummy's DPS a number worth reading.
//
// The client draws the mob's plate over it with the bar in its invulnerable
// state, which is what says both of those at a glance.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>

namespace flix {

/// What an NPC does for a flower that walks up to it.
///
/// Appended to, never reordered: the value travels nowhere, but a mobs.json
/// `npc.service` string resolves to it and a test names them.
enum class NpcService : std::uint8_t {
    None = 0,
    /// Guaranteed crafts: a fixed number of one petal for one of the next
    /// tier, every time. See oracleCraftCost() in rarity.h.
    Oracle,
    /// One petal for one coin (kTraderCoinPetal) of the same tier, once a day.
    /// Any petal whose petals.json entry does not say `"tradable": false`.
    Trader,
    /// The universal forge: kTitanForgeCost apex petals of one kind for one
    /// universal of it. A universal forged here lasts until another player
    /// forges the same petal; see kTitanForgeRefund.
    Titan,
};

/// The service a mobs.json `npc.service` string names, or None for text this
/// build does not know. Case-sensitive, like every other id in that file.
inline NpcService parseNpcService(const std::string& name) {
    if (name == "oracle") return NpcService::Oracle;
    if (name == "trader") return NpcService::Trader;
    if (name == "titan") return NpcService::Titan;
    return NpcService::None;
}

/// How close a flower has to be to an NPC to use it: from the NPC's SKIN to the
/// flower's centre, so a big NPC is reached at its edge rather than its middle.
///
/// The CLIENT switches the crafting panel over at this distance; the server
/// allows kNpcServiceSlack on top of it, because what the client measured is
/// its own drawn position -- eased, and a snapshot old -- and a flower that
/// the panel said was close enough must not be refused at the server for
/// having drifted a few units on the way there.
inline constexpr double kNpcServiceReach = 250.0;
inline constexpr double kNpcServiceSlack = 150.0;

/// How long an account waits between two oracle crafts. One guaranteed
/// upgrade per half hour: the oracle is a thing to come back to, not a second
/// forge that never misses. Per account, so a relog does not reset it; held
/// in the server's memory only, so a restart does (GameServer::oracleReadyAt_).
inline constexpr double kOracleCooldownMillis = 30.0 * 60.0 * 1000.0;

/// "You'll be able to craft again in 27 minutes" -- the one sentence both ends
/// say it in: the server when it refuses, the panel where its line of text
/// goes. Rounded UP, so the last minute reads "1 minute" and never "0".
inline std::string oracleCooldownText(double remainingMillis) {
    const long minutes = std::max(1L, static_cast<long>(std::ceil(remainingMillis / 60000.0)));
    return "You'll be able to craft again in " + std::to_string(minutes) +
           (minutes == 1 ? " minute" : " minutes");
}

/// The petal every trade hands back, at the tier of the petal traded for it.
inline constexpr const char* kTraderCoinPetal = "coin";

/// How long an account waits between two trades: one a day. Kept exactly as
/// the oracle's wait is -- per account, in the server's memory only
/// (GameServer::traderReadyAt_) -- so a relog keeps it and a restart clears it.
inline constexpr double kTraderCooldownMillis = 24.0 * 60.0 * 60.0 * 1000.0;

/// "You'll be able to trade again in 23 hours" -- the reference's sentence,
/// which says 23 the moment a trade is made: whole hours rounded DOWN. Under
/// an hour there is no whole hour left to say, so the last one counts down in
/// minutes, rounded up as the oracle's are, and never reads "0".
inline std::string traderCooldownText(double remainingMillis) {
    const long hours = static_cast<long>(std::floor(remainingMillis / 3600000.0));
    if (hours >= 1) {
        return "You'll be able to trade again in " + std::to_string(hours) +
               (hours == 1 ? " hour" : " hours");
    }
    const long minutes = std::max(1L, static_cast<long>(std::ceil(remainingMillis / 60000.0)));
    return "You'll be able to trade again in " + std::to_string(minutes) +
           (minutes == 1 ? " minute" : " minutes");
}

/// What one forge at a titan takes: this many APEX petals of one kind, for
/// one universal of that kind. Never a roll -- the five always become one.
inline constexpr int kTitanForgeCost = 5;

/// What a universal's holder gets back when another player forges the same
/// petal: the apex petals it was forged from, less the one the forge keeps.
///
/// Per universal taken, and every universal of that petal another account
/// holds is taken -- bag and loadout alike, however it came by them -- so
/// after a forge its forger is the only account holding that petal at
/// universal.
inline constexpr int kTitanForgeRefund = kTitanForgeCost - 1;

/// The least time between two answers to one session's TitanHolder query --
/// each is a sweep of every account -- and how long the server trusts the
/// holder it found for a petal before sweeping again. A forge sets its
/// petal's answer outright, so only an operator's hand ages it at all.
inline constexpr double kTitanHolderQueryMillis = 100.0;
inline constexpr double kTitanHolderMemoMillis = 5000.0;

/// What the titan says about a petal it has forged before, for whoever holds
/// it now.
inline std::string titanMemoryText(const std::string& holder) {
    return "\"Ah, I remember forging that petal for a flower named " + holder + "...\"";
}

/// How far past exact overlap a flower's body and an NPC's still count as
/// touching, for the contact hit either lands on the other.
///
/// A flower cannot stand inside an NPC: movement puts it back out flush
/// against the body (MovementSystem::pushOutOfNpcs) before combat looks, and
/// flush IS the contact distance -- so a strict overlap test calls about half
/// of those touches a miss, on nothing but rounding. A unit is far above that
/// error and far below anything a player could see as a gap.
inline constexpr double kNpcTouchSlack = 1.0;

/// How far off an NPC notices a flower and turns to look at it. Past this it
/// glances about on its own.
inline constexpr double kNpcWatchRange = 900.0;

/// How long an idle NPC holds one glance before picking another, and the
/// spread on top: a fixed beat reads as a clock rather than as a creature.
inline constexpr double kNpcGlanceMillis = 2200.0;
inline constexpr double kNpcGlanceSpreadMillis = 2600.0;

} // namespace flix
