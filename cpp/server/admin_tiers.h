#pragma once
// Admin tiers: how much of the console an admin reaches.
//
// Tier 1 is everything an admin could do before tiers existed. Each tier below
// it loses one more power and keeps every loss of the tiers above it:
//
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
// A full admin may also ban an admin of a LOWER tier from every admin power,
// and lift it (`ban_admin`, `unban_admin`): never their own tier or a higher
// one, so tier 1 is banned by nobody and tier 4 bans nobody. The ban is on the
// account (Account::adminBanned) and leaves its tier and flag where they are.
//
// Everything else the console does -- announce, the database editor's key,
// grant_admin -- keeps its own rule on top of this one (chat_commands.cpp).
// And no tier changes an admin's password (Database::setPassword).

#include <string>

namespace flix {

inline constexpr int kTopAdminTier = 1;
inline constexpr int kBottomAdminTier = 4;

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

constexpr bool validAdminTier(int tier) {
    return tier >= kTopAdminTier && tier <= kBottomAdminTier;
}

/// Whether an admin of `tier` holds `power`. Anything that is not a tier holds
/// nothing, so a caller that passes "not an admin" (0) is refused too.
constexpr bool adminTierAllows(int tier, AdminPower power) {
    return validAdminTier(tier) && tier <= lowestTierWith(power);
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
