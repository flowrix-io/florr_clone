// The realms a body moves between: pads and realm changes, which biome a realm
// belongs to, where a session's next body goes, the arena run and the maze.

#include "server/game_server.h"

#include <cctype>
#include <cmath>
#include <cstdlib>

#include "server/game_server_internal.h"
#include "server/text.h"
#include "server/systems/mode_spawning.h"
#include "shared/game/config.h"
#include "shared/game/prestige.h"

namespace flix {

void GameServer::moveEntityToRealm(Entity entity, Realm realm, Vec2 position) {
    if (!world_.isAlive(entity)) return;
    Transform* transform = world_.tryGet<Transform>(entity);
    if (transform == nullptr) return;
    if (transform->realm == realm && distanceSq(transform->position, position) < 1.0) return;

    const Realm from = transform->realm;
    if (from == kAdminArenaRealm && realm != kAdminArenaRealm) {
        if (Session* owner = sessionForEntity(entity); owner && owner->eventKit) {
            endHostedKit(*owner); transform = world_.tryGet<Transform>(entity); if (!transform) return;
        }
    }
    const bool sameRealm = from == realm;
    transform->realm = realm;
    transform->position = position;
    // Velocity and knockback describe where the body WAS going, in a space it
    // is no longer in. A flower that arrives still carrying the impulse that
    // pushed it onto the pad arrives sliding.
    if (Motion* motion = world_.tryGet<Motion>(entity)) motion->velocity = {0, 0};
    if (Knockback* knockback = world_.tryGet<Knockback>(entity)) {
        knockback->impulse = {0, 0};
        knockback->carry = {0, 0};
    }
    // A pad the flower is standing on at the far end must not grab it back on
    // the very next tick, and its charge-up belongs to the map it was on.
    if (TeleporterState* pads = world_.tryGet<TeleporterState>(entity)) {
        pads->pad = -1;
        pads->enteredAtMillis = 0;
        pads->cooldownUntilMillis = clockMillis_ + kTeleporterCooldownMillis;
        pads->arriving = true;
    }
    // Ahead of the RealmChange below, so the client still has the frame from
    // before the jump to close the iris over.
    sendTeleported(entity);

    // A pad that leads somewhere on the SAME map is a jump, not a move
    // between worlds: the grid under the body has not changed, so there is
    // nothing to send and nothing to clear. The kit is re-placed around the
    // ring by its own system, and the client's snap-distance rule cuts the
    // interpolation on its own, exactly as it does for teleportEntity().
    if (sameRealm) return;

    // The kit comes too. A petal or a pet left behind in the old realm is not
    // merely invisible: it is in another coordinate space, so it never reaches
    // its owner's ring again, it is streamed to nobody, and it goes on
    // colliding with whatever it was left standing next to.
    //
    // One pass over the world rather than a per-owner index, because this runs
    // when somebody takes a teleporter and not per tick.
    Query<Transform> everything{world_};
    everything.each([&](Entity other, Transform& at) {
        if (other == entity) return;
        if (at.realm != from) return;
        // Except a loose petal: put down HERE it would land on the flower and
        // have to be shoved off it. The petal pass finds it in the old realm on
        // its next run and puts it down behind the flower instead
        // (PetalSystem::carryLoosePetalsAcrossRealms).
        if (world_.has<LoosePetal>(other)) return;
        Entity owner = NULL_ENTITY;
        if (const PetalInstance* petal = world_.tryGet<PetalInstance>(other)) owner = petal->owner;
        else if (const Pet* pet = world_.tryGet<Pet>(other)) owner = pet->owner;
        else if (const Projectile* shot = world_.tryGet<Projectile>(other)) owner = shot->creditTo;
        if (owner != entity) return;
        at.realm = realm;
        // Petals are re-placed around the ring by their own system on the next
        // tick; putting them on the flower now keeps them out of whatever the
        // destination has at their old coordinates in the meantime.
        at.position = position;
    });

    // The client has no map file: it has to be SENT the destination's grid, or
    // it draws the map it arrived from underneath a body standing somewhere
    // else entirely.
    Session* session = sessionForEntity(entity);
    if (session == nullptr) {
        // A bot: nothing to tell, but a bot in a squad has still just walked
        // out of the biome the rest of it is working.
        if (botForEntity(entity) != nullptr) enforceSquadBiome(SquadMemberId::ofBot(entity));
        return;
    }
    // The PARKED half of a split went through on its own. sessionForEntity
    // matches either half, but the client is looking through the steered one,
    // which has not moved: restating its view would load the far map under a
    // flower still standing on this one. The parked half simply waits over
    // there, and switching to it (switchSplitHalf) is what sends the client.
    if (entity != session->entity) return;
    session->realm = realm;
    sendRealmChange(*session, position);
    enforceSquadBiome(squadIdOf(*session));
}

void GameServer::sendRealmChange(Session& session, Vec2 position, bool preserveView) {
    if(!preserveView)views_[session.connection].reset();
    net::Connection* connection = listener_.find(session.connection);
    if (connection == nullptr) return;
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(preserveView ? net::ServerMessage::ArenaMapUpdate : net::ServerMessage::RealmChange));
    w.position(position);
    writeMapGrid(w, *terrain_, session.realm);
    connection->send(w);
}

void GameServer::sendTeleported(Entity entity) {
    Session* session = sessionForEntity(entity);
    if (session == nullptr || entity != session->entity) return;
    net::Connection* connection = listener_.find(session->connection);
    if (connection == nullptr) return;
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Teleported));
    connection->send(w);
}

std::string GameServer::biomeOfRealm(Realm realm) const {
    // The two generated realms answer with the picker ids they are asked for
    // by name, so a ring party and a maze party are each one biome rather
    // than sharing the nameless bucket every unstaged realm would fall into.
    if (realm == kAdminArenaRealm) return kAdminArenaSpawnChoice;
    if (realm == Realm::Arena) return kArenaSpawnChoice;
    if (realm == Realm::Maze) return kMazeSpawnChoice;
    if (realm == kWavesRealm) return kWavesBiomeId;
    const MapData* map = worldMaps_.forRealm(realm);
    if (map == nullptr) return std::string();
    // A twin is a biome of its own: nobody in the garden can see a flower in
    // the prestige garden, so the two can no more share a squad than the
    // garden and the desert can.
    return map->prestige() ? kPrestigeMapPrefix + map->biome() : map->biome();
}

std::string GameServer::biomeLabel(const std::string& biome) const {
    if (biome.empty()) return biome;
    const std::string plain = stripPrestigePrefix(biome);
    if (plain != biome) return std::string(kPrestigeLabel) + " " + biomeLabel(plain);
    for (const SpawnChoice& choice : worldMaps_.spawnChoices()) {
        if (biomeOfRealm(choice.realm) == biome) return choice.label;
    }
    if (biome == kAdminArenaSpawnChoice) return "Admin Arena";
    if (biome == kArenaSpawnChoice) return "PVP Arena";
    if (biome == kMazeSpawnChoice) return "Maze";
    if (biome == kWavesBiomeId) return "Waves";
    return biome;
}

std::string GameServer::biomeOfEntity(Entity entity) const {
    if (entity == NULL_ENTITY || !world_.isAlive(entity)) return {};
    const Transform* transform = world_.tryGet<Transform>(entity);
    return transform != nullptr ? biomeOfRealm(transform->realm) : std::string();
}

const SpawnChoice* GameServer::chosenDoor(const Session& session) const {
    const SpawnChoice* door = worldMaps_.door(session.spawnChoice);
    if (door == nullptr) return nullptr;
    // Checked on every body, not only at the join: a lent console is lent
    // for one life, and a non-pickable door named on it is not kept past it.
    if (!door->pickable && !session.admin) return nullptr;
    return door;
}

Realm GameServer::spawnRealmFor(const Session& session) const {
    if (session.spawnChoice == kAdminArenaSpawnChoice && (effectiveAdmin(session) || session.adminArenaAdmitted))
        return kAdminArenaRealm;
    if (session.spawnChoice == kArenaSpawnChoice) return Realm::Arena;
    if (session.spawnChoice == kMazeSpawnChoice) return Realm::Maze;
    // A spawn point carries the map it is on, so choosing one is how a player
    // joins straight into a map other than the overworld.
    const SpawnChoice* choice = chosenDoor(session);
    const Realm plain = choice != nullptr ? choice->realm : Realm::Overworld;
    if (!session.prestige) return plain;
    // The same door on the map's prestige twin: the twin is the same file, so
    // the door's element index means the same rectangle on it.
    bool found = false;
    const Realm twin = worldMaps_.prestigeRealm(plain, found);
    return found ? twin : plain;
}

PlayerRecord& GameServer::liveRecord(Session& session) {
    if (session.eventKit) return *session.eventKit;
    if (session.arena) return *session.arena;
    return database_.progress(session.userId);
}

std::unique_ptr<PlayerRecord> GameServer::startArenaRun(const PlayerRecord& account) const {
    // The reference's enterPvpArena: five common basics and five empty slots,
    // nothing in the bag, and a fresh score. The level is the account's -- XP
    // keeps accruing in the ring -- and so are the cosmetics. No talents: the
    // ring switches every multiplier off, so the scratch tree stays empty.
    auto run = std::make_unique<PlayerRecord>();
    run->totalXp = account.totalXp;
    run->stars = account.stars;
    run->renderFlags = account.renderFlags;
    run->equippedSkinId = account.equippedSkinId;
    wearStarterKit(*run);
    return run;
}

void GameServer::endArenaRun(Session& session) {
    if (!session.arena) return;
    PlayerRecord& account = database_.progress(session.userId);
    // A quarter of every stack looted in the ring, rounded down, reaches the
    // account (exitPvpArena); the ring's own petals and whatever was equipped
    // out of its bag do not.
    //
    // The ring's own petal is left out at every tier. A starter basic taken
    // off the bar lands in this bag exactly as a looted one does, so a client
    // that joined, emptied the bar and left banked a quarter of the kit every
    // lap -- and one crafted up in the ring first came out a tier higher.
    const std::uint16_t starter = content().petalIndex("basic");
    forEachBagStack(session.arena->inventory, [&](Rarity rarity, const std::string& key, int count) {
        if (starter != kInvalidIndex && petalIndexFromInventoryKey(key) == starter) return;
        const int kept = static_cast<int>(std::floor(count * kArenaInventoryKeepRatio));
        if (kept > 0) account.addItem(rarity, key, kept);
    });
    session.arena.reset();
    database_.markDirty();
}

void GameServer::settleArenaDeath(Session& victim, Entity killer) {
    if (!victim.arena) return;
    Session* winner = killer != NULL_ENTITY ? sessionForEntity(killer) : nullptr;
    // Only another flower IN THE RING inherits anything: a mob kill, a bot, or
    // a killer who has since left simply empties the run (playerState.ts:1352).
    if (winner != nullptr && winner != &victim && winner->arena && winner->playing()) {
        if (ArenaScore* mine = world_.tryGet<ArenaScore>(victim.entity)) {
            if (ArenaScore* theirs = world_.tryGet<ArenaScore>(winner->entity)) {
                theirs->score += mine->score;
            }
        }
        forEachBagStack(victim.arena->inventory,
                        [&](Rarity rarity, const std::string& key, int count) {
                            if (count > 0) winner->arena->addItem(rarity, key, count);
                        });
        sendProfile(*winner);
    }
    if (ArenaScore* mine = world_.tryGet<ArenaScore>(victim.entity)) mine->score = 0;
    victim.arena->inventory = Json::object();
    sendProfile(victim);
}

std::string GameServer::adminChangeMaze(const std::string& argument) {
    static const std::array<const char*, 3> kBiomeNames = {{"garden", "desert", "ocean"}};
    const auto biomeName = [](MazeBiome biome) {
        return kBiomeNames[static_cast<std::size_t>(biome)];
    };

    const std::int64_t currentDay = activeMaze().day();
    const std::string token = lowerCase(trimmed(argument));

    std::int64_t targetDay = 0;
    if (token.empty() || token == "next") {
        targetDay = currentDay + 1;
    } else if (token == "garden" || token == "desert" || token == "ocean") {
        // The three layouts are authored, not generated: the day number only
        // picks which one is active, so asking for a biome means asking for the
        // nearest day that lands on it.
        const auto want = static_cast<std::int64_t>(
            token == "garden" ? 0 : (token == "desert" ? 1 : 2));
        const std::int64_t current = ((currentDay % 3) + 3) % 3;
        const std::int64_t advance = ((want - current) + 3) % 3;
        if (advance == 0) return "Maze is already " + token + ".";
        targetDay = currentDay + advance;
    } else {
        int parsed = 0;
        bool numeric = !token.empty();
        std::size_t at = (token[0] == '-') ? 1 : 0;
        if (at >= token.size()) numeric = false;
        for (std::size_t i = at; numeric && i < token.size(); ++i) {
            if (!std::isdigit(static_cast<unsigned char>(token[i]))) numeric = false;
        }
        if (!numeric) {
            return std::string("Usage: change-maze [next|garden|desert|ocean|<dayNumber>] ")
                       .append("\xE2\x80\x94 current: day ") +
                   std::to_string(currentDay) + " (" + biomeName(activeMaze().biome()) + ")";
        }
        parsed = std::atoi(token.c_str());
        targetDay = parsed;
    }

    if (targetDay == currentDay) {
        return "Maze is already day " + std::to_string(currentDay) + " (" +
               biomeName(activeMaze().biome()) + ").";
    }

    mazeDayOffset_ = targetDay - currentMazeDay();
    setActiveMazeDay(targetDay);

    // Anyone standing in the old layout is standing in the new one's walls.
    // The reference moves them to the new entrance; so does this, and the
    // client cuts its interpolation on the jump by itself. Yesterday's mobs
    // would be inside the walls too, so they go (clearMazeEnemies), and every
    // client is told which maze to build now.
    const Vec2 entrance = activeMaze().spawn();
    Query<PlayerTag, Transform> flowers{world_};
    std::vector<Entity> inside;
    flowers.each([&](Entity entity, PlayerTag&, Transform& transform) {
        if (transform.realm == Realm::Maze) inside.push_back(entity);
    });
    for (const Entity entity : inside) teleportEntity(entity, entrance);
    modes_->clearMaze(world_, commands_);
    broadcastMazeInfo();

    return "Maze changed to day " + std::to_string(activeMaze().day()) + " (" +
           biomeName(activeMaze().biome()) + "). Offset from real day: " +
           (mazeDayOffset_ >= 0 ? "+" : "") + std::to_string(mazeDayOffset_) + ".";
}

void GameServer::sendMazeInfo(net::Connection& connection) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::MazeInfo));
    w.i64(activeMaze().day());
    connection.send(w);
}

void GameServer::broadcastMazeInfo() {
    for (auto& entry : sessions_) {
        if (!entry.second.authenticated()) continue;
        if (net::Connection* connection = listener_.find(entry.second.connection)) {
            sendMazeInfo(*connection);
        }
    }
}

} // namespace flix
