// What the world hands out, banked into accounts once a tick -- pickups, kills
// and their star bounties -- and the chat lines bosses and rare finds get.

#include "server/game_server.h"

#include <algorithm>
#include <vector>

#include "server/game_server_internal.h"
#include "server/loot_eligibility.h"
#include "server/text.h"
#include "server/systems/combat.h"
#include "server/systems/loot.h"
#include "server/systems/spawning.h"
#include "shared/game/config.h"
#include "shared/game/shop.h"

namespace flix {

namespace {

/// "@handle [Flower]" as chat credits a player with a deed: the account's
/// handle in green, then the flower's name -- not the account's -- in yellow
/// brackets. One rendering, so a boss kill and an apex pickup name the same
/// player the same way.
std::string creditedPlayerMarkup(const Session& session) {
    // Escaped: a nameplate is whatever printable text its player typed, and
    // these lines go to everyone. "<!--" cut the rest of the announcement off.
    const std::string& playerName = session.nameplate();
    return "<span style=\"color: #00ff00;\">@" + escapedMarkup(session.username) +
           "</span> [<span style=\"color: yellow;\">" + escapedMarkup(playerName) + "</span>]";
}

} // namespace

void GameServer::announceBossSpawns() {
    for (const SpawnSystem::BossSpawn& boss : spawning_->bossSpawns) {
        // The bots hear about it too, from the same event and in the same
        // breath. Every path that can put a boss in the world queues one of
        // these -- a band stocking itself in a corner nobody has visited, a
        // nest's escort, the arena, an operator's console -- so there is one
        // place a boss becomes news and no way to add a spawn path that
        // produces one the server says nothing about.
        // Not a wave's: no bot can reach the disc, and one it is told about
        // would hold a callout slot until the wave killed it.
        if (boss.realm != kWavesRealm) noteBossSighting(boss.entity, clockMillis_);
        // A sacrifice's mob was announced as summoned by the ritual that
        // brought it (announceSacrificeSummon), at any tier.
        const Replicated* replicated = world_.tryGet<Replicated>(boss.entity);
        if (replicated != nullptr && (replicated->spawnFlags & net::SpawnSacrificed) != 0) {
            continue;
        }

        // The mob's display name, never its id: ids are for commands only.
        const std::string& name = content().mob(boss.mobIndex).name;
        // Only meaningful for a boss on the overworld: `section` is that map's
        // 3x3 grid, and another map's coordinates read as a section number that
        // means nothing. See `here` below.
        const int section = sectionAt(boss.position);
        const std::string tier = rarityLabel(boss.rarity);
        // Wrapped in the tier's own colour, as the reference server wraps it.
        // The client parses the markup; sending the announcement bare left it
        // the one boss line in the game with no tier colour on it.
        const std::string opening = rarityBoldTag(boss.rarity);

        for (auto& entry : sessions_) {
            Session& session = entry.second;
            // Everyone signed in, flower or not: the title screen draws the same
            // chat box the game does, and a boss's defeat already reaches it.
            if (!session.authenticated()) continue;
            net::Connection* connection = listener_.find(session.connection);
            if (connection == nullptr) continue;
            // Personalised: a player standing in the boss's own section is told
            // it spawned, everyone else that it spawned "somewhere". A band on
            // ANY staged world map can fill with supers now -- difficulty is
            // what makes bosses -- so the boss's OWN realm has to match before
            // its position means anything: two maps are two coordinate spaces,
            // and (9000, 9000) on one is not near (9000, 9000) on the other.
            const Transform* transform =
                session.playing() ? world_.tryGet<Transform>(session.entity) : nullptr;
            // The waves disc is one place: a flower on it is where the boss is.
            const bool here = transform != nullptr && transform->realm == boss.realm &&
                              (boss.realm == kWavesRealm ||
                               (transform->realm == Realm::Overworld &&
                                sectionAt(transform->position) == section));
            sendChatTo(*connection, net::ChatChannel::System, "",
                       opening + "A " + tier +
                           " " + name + " has spawned" + (here ? "" : " somewhere") + "!</b>");
        }
    }
    spawning_->bossSpawns.clear();
}

void GameServer::bankPickups() {
    for (const LootSystem::Pickup& pickup : loot_->pickups()) {
        Session* session = sessionForEntity(pickup.player);
        if (!session || session->userId.empty()) continue;
        if (pickup.petalIndex >= content().petalCount()) continue;

        // Into the bag the body is playing with: an arena pickup is the run's,
        // not the account's, until the run ends.
        giveToInventory(liveRecord(*session), pickup.petalIndex, pickup.rarity, 1);
        if (session->eventKit) enforceHostedRules(*session);
        database_.markDirty();

        // Owed, not sent: see sendDueProfiles.
        noteDue(session->stacksDue, pickup.petalIndex, pickup.rarity);
        session->profileDue = true;
        announceRarePickup(*session, pickup.petalIndex, pickup.rarity);
    }
}

void GameServer::bankKills() {
    std::vector<Bounty::Share> ranked;
    std::vector<Entity> recipients;
    // Connections already credited for the corpse in hand; see the loop.
    std::vector<net::ConnectionId> paidAccounts;
    for (const CombatSystem::DeathRecord& death : combat_->deaths()) {
        if (death.wasPlayer) continue;
        const MobType* type = world_.tryGet<MobType>(death.entity);
        if (type == nullptr) continue;

        // A credited killing blow is the gate, exactly as it is in the
        // reference: a mob finished by another mob is nobody's kill and enters
        // nobody's gallery. A pet's kill belongs to the player who summoned it,
        // and combat has already resolved that attribution onto Dead::killer.
        // Chat still hears about a boss that went down that way, just with
        // nobody to credit.
        if (death.killer == NULL_ENTITY || !world_.isAlive(death.killer) ||
            !world_.has<PlayerTag>(death.killer)) {
            announceBossDefeat(death.entity, *type, {});
            continue;
        }

        // The gallery entry and the star bounty go to every player who earned
        // LOOT rights on the corpse, not to the finisher alone: five flowers
        // that bring down an apex are five apex kills and five lots of 250
        // stars. Same ledger and the same selectLootRecipients() the XP and
        // drop paths call -- squads, per-tier slot cap and 1% damage floor
        // included -- so the three cannot disagree about who was in on a kill.
        ranked.clear();
        if (const Bounty* bounty = world_.tryGet<Bounty>(death.entity)) {
            for (const Bounty::Share& share : bounty->contributors) {
                if (share.damage <= 0.0) continue;
                if (world_.isAlive(share.player) && !world_.has<PlayerTag>(share.player)) continue;
                ranked.push_back(share);
            }
        }
        // Stable, because the ledger is in first-hit order and the reference's
        // sort is specified stable: on an exact damage tie the slot at the cut
        // belongs to whoever landed their damage first.
        std::stable_sort(ranked.begin(), ranked.end(),
                         [](const Bounty::Share& a, const Bounty::Share& b) {
                             return a.damage > b.damage;
                         });
        const Health* health = world_.tryGet<Health>(death.entity);
        selectLootRecipients(ranked, lootSlotsForRarity(type->rarity), &squadIndex_, recipients,
                             lootDamageFloor(health != nullptr ? health->max : 0.0));

        const std::string mobId = content().mob(type->configIndex).id;
        const int stars = starsForKill(type->rarity);

        paidAccounts.clear();
        for (const Bounty::Share& share : ranked) {
            // Only a flower that landed damage enters the gallery: a squad's
            // passenger is paid its drops and XP, but it did not kill this.
            if (std::find(recipients.begin(), recipients.end(), share.player) ==
                recipients.end()) {
                continue;
            }
            // A contributor who has left still holds their slot -- nobody is
            // promoted into the gap -- but there is no account left to pay.
            // One between lives, on the title screen, has not left.
            Session* session = creditedSession(share.player);
            if (session == nullptr || session->userId.empty()) continue;
            // ONE PERSON, ONE KILL. A splitter puts two of somebody's flowers
            // on the same corpse, and both of them are in this ledger; paying
            // each would enter the kill in their gallery twice for the price
            // of wearing the petal. The slot is still spent -- the half that
            // ranked into it keeps it, and nobody is promoted into the gap --
            // which is the same rule loot_eligibility.h applies to drops.
            if (std::find(paidAccounts.begin(), paidAccounts.end(), session->connection) !=
                paidAccounts.end()) {
                continue;
            }
            paidAccounts.push_back(session->connection);

            PlayerRecord& record = session->eventKit ? *session->eventKit : database_.progress(session->userId);
            record.recordKill(mobId, type->rarity);

            // Stars are the mythic-and-above bounty. Awarded on the live entity
            // rather than the record so the HUD sees them this tick;
            // persistPlayer copies them back the same way it does XP.
            // Silently: the reference pays the bounty and updates the star
            // counter, and says nothing. A notice per mythic kill is a line
            // every few seconds in a mythic zone.
            if (stars > 0) {
                if (PlayerProgress* live = world_.tryGet<PlayerProgress>(share.player)) {
                    live->stars += stars;
                    record.stars = live->stars;
                } else {
                    record.stars += stars;
                }
            }
            database_.markDirty();

            // Owed, not sent: see sendDueProfiles. The stars ride in every
            // delta's header.
            noteDue(session->killsDue, type->configIndex, type->rarity);
            session->profileDue = true;
        }

        announceBossDefeat(death.entity, *type, ranked);
    }
}

void GameServer::announceBossDefeat(Entity mob, const MobType& type,
                                    const std::vector<Bounty::Share>& ranked) {
    // The tiers announced on the way out are exactly the tiers announced on the
    // way in -- ONE constant, so raising kAnnouncedRarity cannot leave chat
    // mourning a boss nobody was told about. An ultra dies as quietly as it
    // spawned.
    if (rarityIndex(type.rarity) < rarityIndex(kAnnouncedRarity)) return;
    // Nor does a prestige biome's super, whose spawn was never announced
    // either: there it is the bands' everyday stock (shared/game/prestige.h).
    // Nor a wave's, below unique, for the same reason (announceIfNotable).
    // Nor a super born on ground that grows them as everyday stock
    // (kQuietBossChance): its spawn was silent, so its defeat is.
    if (world_.has<QuietBoss>(mob)) return;
    if (const Transform* at = world_.tryGet<Transform>(mob)) {
        if (worldMaps_.isPrestige(at->realm)) return;
        if (at->realm == kWavesRealm && rarityIndex(type.rarity) < rarityIndex(Rarity::Unique)) {
            return;
        }
    }
    // The head's death is the animal's. A centipede's beads each carry their
    // own ledger and die one by one, and a line per bead would be ten more
    // deaths than the one spawn line chat was given.
    if (content().mob(type.configIndex).chainBody) return;
    // A flower's summon was never announced on the way in, and losing one is
    // not a boss falling -- it simply hatches again.
    if (world_.has<Pet>(mob)) return;
    const std::string& name = content().mob(type.configIndex).name;
    const std::string opening = rarityBoldTag(type.rarity) + "A " + rarityLabel(type.rarity) + " " +
                                name + " has been defeated";

    // Credited to the top damage dealer alone, whatever the kill was shared
    // with: `ranked` is already sorted by damage, so that is its first row.
    // No player to credit -- a mob's kill, or a top dealer who has left --
    // still gets the line, without the "by". One who died and has not spawned
    // again has not left: their rows move to their next body when it is made
    // (Session::lastBody), and until then creditedSession still finds them.
    const Session* session =
        ranked.empty() ? nullptr : creditedSession(ranked.front().player);
    if (session == nullptr || !session->authenticated()) {
        broadcastChat(net::ChatChannel::System, "", opening + "!</b>");
        return;
    }

    broadcastChat(net::ChatChannel::System, "",
                  opening + " by " + creditedPlayerMarkup(*session) + "</b>");
}

void GameServer::announceRarePickup(const Session& session, std::uint16_t petalIndex,
                                    Rarity rarity) {
    if (petalIndex >= content().petalCount()) return;
    // The crown has florr's own line (Chat/PetalFoundNamed/champion_crown),
    // at whatever tier it is picked up.
    if (petalLendsBasic(content().petal(petalIndex))) {
        // broadcastChat(net::ChatChannel::System, "",
        //               rarityBoldTag(rarity) + "The " +
        //                   content().petal(petalIndex).name + " has been taken by " +
        //                   creditedPlayerMarkup(session) + "!</b>");
        return;
    }
    if (rarityIndex(rarity) < rarityIndex(Rarity::Apex)) return;
    // "The Universal", as the forge says it: there is only ever one of each
    // petal at universal.
    const char* article = rarity == Rarity::Universal ? "The" : "An";
    broadcastChat(net::ChatChannel::System, "",
                  rarityBoldTag(rarity) + article + " " +
                      rarityLabel(rarity) + " " + content().petal(petalIndex).name +
                      " has been collected by " + creditedPlayerMarkup(session) + "!</b>");
}

} // namespace flix
