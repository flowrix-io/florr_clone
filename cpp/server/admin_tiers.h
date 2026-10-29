#pragma once
// Admin tiers: how much of the console an admin reaches.
//
// Tier 1 is everything an admin could do before tiers existed. Each tier below
// it loses one more power and keeps every loss of the tiers above it:
//
//   owner   everything, and reaches tier 1 admins (below)
//   tier 1  everything
//   tier 2  cannot update the server
//   tier 3  cannot update the server or give petals
//   tier 4  cannot update the server, give petals or spawn mobs
//
// A database admin's tier is the account's `adminTier` (absent means 1, which
// is what every admin from before tiers is), written in the database file on
// the server's own machine. In game, only `promote_admin` and `demote_admin`
// move it: a full admin raises an admin of a lower tier, up to their own tier
// and no further, or lowers one, down to the bottom.
// The database editor refuses it, as it refuses the `admin` flag. A temporary
// grant carries a tier of its own, chosen by the admin who lends it, at their
// own tier or below.
//
// The SERVER OWNER is a rank above tier 1, kOwnerAdminTier: tier 1's powers,
// and the one rank that stands over tier 1 admins, so it bans, unbans, demotes
// and promotes them as every tier does the tiers below it. It is the account's
// `"owner": true`, set only in the database file -- never in game, where no
// command names it as a tier to grant or promote to, and never from the
// editor -- and it is NOT a number in `adminTier`, whose strict read turns a
// mistyped value into the bottom tier, never the top.
//
// A full admin may also ban an admin of a LOWER tier from every admin power,
// and lift it (`ban_admin`, `unban_admin`): never their own tier or a higher
// one, so the owner is banned by nobody and tier 4 bans nobody. The ban is on
// the account (Account::adminBanned) and leaves its tier and flag where they
// are.
//
// Everything else the console does -- announce, the database editor's key,
// grant_admin -- keeps its own rule on top of this one (chat_commands.cpp).
// And no tier changes an admin's password (Database::setPassword).

#include <string>

namespace flix {

/// The server owner's rank: above every tier, so it reaches tier 1.
inline constexpr int kOwnerAdminTier = 0;
inline constexpr int kTopAdminTier = 1;
inline constexpr int kBottomAdminTier = 4;
/// What GameServer::adminTier says of a session that holds no admin standing.
inline constexpr int kNotAnAdmin = -1;

enum class AdminPower {
    UpdateServer,   ///< `update`
    GivePetals,     ///< `give`, and the database editor, which can write any bag
    SpawnMobs,      ///< `spawn` and `spawn_npc`
};

/// The lowest tier (the largest number) that still holds `power`.
constexpr int lowestTierWith(AdminPower power) {
    switch (power) {
        case AdminPower::UpdateServer: return 1;
        case AdminPower::GivePetals: return 2;
        case AdminPower::SpawnMobs: return 3;
    }
    return kTopAdminTier;
}

/// A tier an admin can be given in game -- granted, promoted or demoted to:
/// 1 to 4. The owner's rank is not one of them.
constexpr bool validAdminTier(int tier) {
    return tier >= kTopAdminTier && tier <= kBottomAdminTier;
}

/// Whether an admin of `tier` holds `power`. Anything that is not a tier or
/// the owner's rank holds nothing, so "not an admin" is refused too.
constexpr bool adminTierAllows(int tier, AdminPower power) {
    return tier >= kOwnerAdminTier && tier <= kBottomAdminTier &&
           tier <= lowestTierWith(power);
}

/// "the server owner" or "tier 3", for "X is ..." and "(...)".
inline std::string adminTierLabel(int tier) {
    return tier == kOwnerAdminTier ? std::string("the server owner")
                                   : "tier " + std::to_string(tier);
}

/// "update the server", for a refusal's "Tier 3 admins cannot ...".
inline const char* adminPowerVerb(AdminPower power) {
    switch (power) {
        case AdminPower::UpdateServer: return "update the server";
        case AdminPower::GivePetals: return "give petals";
        case AdminPower::SpawnMobs: return "spawn mobs";
    }
    return "do that";
}

/// "Tier 3 admins cannot give petals (tiers 1-2 only)."
inline std::string adminTierRefusal(int tier, AdminPower power) {
    const int lowest = lowestTierWith(power);
    return "Tier " + std::to_string(tier) + " admins cannot " + adminPowerVerb(power) +
           (lowest == kTopAdminTier ? std::string(" (tier 1 only).")
                                    : " (tiers 1-" + std::to_string(lowest) + " only).");
}

} // namespace flix
