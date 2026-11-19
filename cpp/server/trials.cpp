#include "server/game_server.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <string_view>
#include <vector>

#include "server/game_server_internal.h"
#include "server/systems/spawning.h"

namespace flix {
namespace {

constexpr std::int64_t kTrialSeasonMillis = 30ll * 24ll * 60ll * 60ll * 1000ll;

struct TrialProgressData {
    int season = 0;
    std::array<bool, kTrialFloorCount> cleared{};
    std::array<int, kTrialFloorCount> best{};
    /// 0: nothing claimed, 1: first-clear bundle, 2: 9-star bonus too.
    std::array<std::uint8_t, kTrialFloorCount> claimed{};
};

TrialProgressData readProgress(const PlayerRecord& record, int season) {
    TrialProgressData out;
    out.season = season;
    const Json& root = record.extra["trialGrounds"];
    if (!root.isObject()) return out;
    const int storedSeason = root["season"].asInt(-1);
    const Json& cleared = root["cleared"];
    const Json& best = root["bestStars"];
    const Json& claimed = root["claimedReward"];
    const Json& full = root["fullReward"];
    for (int i = 0; i < kTrialFloorCount; ++i) {
        const bool seasonal = i >= kTrialPermanentFloorCount;
        const bool keep = !seasonal || storedSeason == season;
        if (keep && cleared.isArray() && i < static_cast<int>(cleared.size())) {
            out.cleared[i] = cleared[static_cast<std::size_t>(i)].asBool();
        }
        if (keep && best.isArray() && i < static_cast<int>(best.size())) {
            out.best[i] = std::clamp(best[static_cast<std::size_t>(i)].asInt(), 0, 9);
        }
        if (keep && claimed.isArray() && i < static_cast<int>(claimed.size())) {
            out.claimed[i] = static_cast<std::uint8_t>(
                std::clamp(claimed[static_cast<std::size_t>(i)].asInt(), 0, 2));
        } else if (keep && out.cleared[i]) {
            // Version 91 paid rewards immediately. Treat an old clear as
            // claimed so this update cannot duplicate its economy.
            const bool fullPaid = full.isArray() && i < static_cast<int>(full.size()) &&
                                  full[static_cast<std::size_t>(i)].asBool();
            out.claimed[i] = fullPaid ? 2 : 1;
        }
    }
    return out;
}

void writeProgress(PlayerRecord& record, const TrialProgressData& data) {
    Json root = Json::object();
    root["season"] = data.season;
    Json cleared = Json::array();
    Json best = Json::array();
    Json claimed = Json::array();
    Json full = Json::array();
    for (int i = 0; i < kTrialFloorCount; ++i) {
        cleared.push(data.cleared[i]);
        best.push(data.best[i]);
        claimed.push(static_cast<int>(data.claimed[i]));
        full.push(data.claimed[i] >= 2);
    }
    root["cleared"] = std::move(cleared);
    root["bestStars"] = std::move(best);
    root["claimedReward"] = std::move(claimed);
    root["fullReward"] = std::move(full);
    record.extra["trialGrounds"] = std::move(root);
}

int unlockedFloor(const TrialProgressData& data) {
    int unlocked = 1;
    while (unlocked < kTrialFloorCount && data.cleared[unlocked - 1]) ++unlocked;
    return unlocked;
}

TrialBuffKind seasonBuff(int season) {
    return static_cast<TrialBuffKind>(season % static_cast<int>(TrialBuffKind::Count));
}

bool safeTrialMob(std::string_view id) {
    // Chains, nests and fixtures can create bodies that are not part of the
    // chamber's TrialMob set. Keep the trial roster to self-contained mobs so
    // a clear cannot leave minions behind or accidentally pay their drops.
    return id != "centipede" && id != "desert_centipede" &&
           id != "evil_centipede" && id != "leech" && id != "tomb";
}

const char* trialMobId(WaveBiome biome, int floor, int chamber, int wave, int season) {
    const std::vector<const char*> biomeMobs = waveMobIds(biome);
    std::vector<const char*> candidates;
    candidates.reserve(biomeMobs.size());
    for (const char* id : biomeMobs) {
        if (id != nullptr && safeTrialMob(id)) candidates.push_back(id);
    }
    if (candidates.empty()) return "bee";
    const int pick = trialRarityIndex(floor) + chamber + wave + season;
    return candidates[static_cast<std::size_t>(pick) % candidates.size()];
}

int chamberStars(int floor, int chamber, int deaths, double elapsedSeconds) {
    if (trialChallenge(floor, chamber) == TrialChallenge::Defeat) {
        return std::max(0, 3 - deaths);
    }
    if (elapsedSeconds <= trialThreeStarSeconds(floor, chamber)) return 3;
    if (elapsedSeconds <= trialTwoStarSeconds(floor, chamber)) return 2;
    if (elapsedSeconds <= trialOneStarSeconds(floor, chamber)) return 1;
    return 0;
}

} // namespace

int GameServer::unlockedTrialFloor(Session& session) {
    PlayerRecord& record = database_.progress(session.userId);
    const int season = static_cast<int>(database_.nowMillis() / kTrialSeasonMillis);
    const TrialProgressData progress = readProgress(record, season);
    return unlockedFloor(progress);
}

void GameServer::sendTrialProgress(Session& session, net::Connection* connection) {
    if (!session.authenticated()) return;
    if (connection == nullptr) connection = listener_.find(session.connection);
    if (connection == nullptr) return;
    PlayerRecord& record = database_.progress(session.userId);
    const std::int64_t now = database_.nowMillis();
    const int season = static_cast<int>(now / kTrialSeasonMillis);
    const TrialProgressData progress = readProgress(record, season);
    const auto remaining = static_cast<std::uint32_t>(
        std::max<std::int64_t>(0, ((season + 1ll) * kTrialSeasonMillis - now) / 1000ll));
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::TrialProgress));
    w.u32(static_cast<std::uint32_t>(season));
    w.u32(remaining);
    w.u8(static_cast<std::uint8_t>(unlockedFloor(progress)));
    w.u8(static_cast<std::uint8_t>(seasonBuff(season)));
    for (int i = 0; i < kTrialFloorCount; ++i) {
        w.u8(progress.cleared[i] ? 1 : 0);
        w.u8(static_cast<std::uint8_t>(progress.best[i]));
        const int earned = progress.cleared[i] ? (progress.best[i] == 9 ? 2 : 1) : 0;
        w.u8(progress.claimed[i] < earned ? 1 : 0);
    }
    connection->send(w);
}

void GameServer::startTrial(Session& session, int floor) {
    const int slot = trialRealmIndex(session.trialRealm);
    if (!session.playing() || floor < 1 || floor > kTrialFloorCount || slot < 0) {
        return;
    }
    TrialRun& trial = trials_[static_cast<std::size_t>(slot)];
    if (trial.phase != TrialPhase::Idle) return;
    const int season = static_cast<int>(database_.nowMillis() / kTrialSeasonMillis);
    trial = TrialRun{};
    trial.realm = session.trialRealm;
    trial.phase = TrialPhase::Active;
    trial.owner = session.connection;
    trial.floor = floor;
    trial.chamber = 1;
    trial.buff = seasonBuff(season);
    trial.biome = static_cast<WaveBiome>((season + floor) % static_cast<int>(WaveBiome::Count));
    world_.add<TrialBuff>(session.entity,
                          TrialBuff{static_cast<std::uint8_t>(trial.buff), clockMillis_});
    spawnTrialChamber(trial, clockMillis_);
    sendTrialState(session, trial);
}

void GameServer::spawnTrialChamber(TrialRun& trial, double nowMillis) {
    auto found = sessions_.find(trial.owner);
    if (found == sessions_.end() || !found->second.playing()) return;
    clearTrialMobs(trial);
    // A new room: every chamber after the first starts with the flower back
    // in the middle, behind the iris cued in stepTrial. The first chamber
    // starts where the floor was picked, so it needs neither.
    if (trial.chamber > 1) {
        if (!trial.teleportCued) sendTeleported(found->second.entity);
        teleportEntity(found->second.entity, kWavesCentre, false);
    }
    trial.teleportCued = false;
    trial.phase = TrialPhase::Active;
    trial.deaths = 0;
    trial.deathCounted = false;
    trial.awaitingWave = false;
    trial.wave = 0;
    trial.killed = 0;
    trial.waveCount = trialWaveCount(trial.floor, trial.chamber);
    trial.reviveAtMillis = 0.0;
    trial.nextWaveAtMillis = 0.0;
    trial.chamberStartedMillis = nowMillis;
    spawnTrialWave(trial, nowMillis);
}

void GameServer::spawnTrialWave(TrialRun& trial, double nowMillis) {
    clearTrialMobs(trial);
    trial.awaitingWave = false;
    trial.nextWaveAtMillis = 0.0;
    ++trial.wave;
    const int season = static_cast<int>(database_.nowMillis() / kTrialSeasonMillis);
    std::uint16_t mob = content().mobIndex(
        trialMobId(trial.biome, trial.floor, trial.chamber, trial.wave, season));
    if (mob == kInvalidIndex) mob = content().mobIndex("bee");
    const int count = trialMobsInWave(trial.floor, trial.chamber, trial.wave);
    const Rarity rarity = trialRarity(trial.floor);
    const double mobRadius = mob == kInvalidIndex
                                 ? 0.0
                                 : content().mobStats(mob, rarity).radius *
                                       content().mob(mob).maxRandomSize();
    // Keep every mob outside the flower/loadout area, keep simultaneous mobs
    // apart on their ring, and size the chamber from those mobs.
    const double spawnRadius = trialSpawnRadius(mobRadius, count);
    const std::size_t realmSlot = static_cast<std::size_t>(trialRealmIndex(trial.realm));
    terrain_->trialRadii[realmSlot] = trialChamberRadius(mobRadius, count);
    double awayFromPlayer = 0.0;
    if (const auto owner = sessions_.find(trial.owner); owner != sessions_.end()) {
        if (const Transform* flower = world_.tryGet<Transform>(owner->second.entity)) {
            const Vec2 offset = flower->position - kWavesCentre;
            awayFromPlayer = std::atan2(offset.y, offset.x) + kPi;
        }
    }
    const double angularStep = count > 1
                                   ? 2.0 * std::asin(std::clamp(
                                         (mobRadius + 200.0) / spawnRadius, 0.0, 1.0))
                                   : 0.0;
    const double firstAngle = awayFromPlayer - angularStep * (count - 1) * 0.5;
    for (int i = 0; i < count && mob != kInvalidIndex; ++i) {
        // Lay the wave out on the half of the arena opposite the flower's
        // current position. Later waves remain safe even if the player left
        // the centre after the chamber began.
        const double angle = firstAngle + angularStep * i;
        const Vec2 at{kWavesCentre.x + std::cos(angle) * spawnRadius,
                      kWavesCentre.y + std::sin(angle) * spawnRadius};
        const Entity spawned = spawning_->spawnMob(world_, *terrain_, content(), mob,
                                                    rarity, at,
                                                    trial.realm, nowMillis, rng_);
        if (spawned == NULL_ENTITY) continue;
        world_.add<TrialMob>(spawned);
        // The Waves realm normally makes its roaming Eternal and Apex bosses
        // 10x/50x healthier. Trial floors already choose their own difficulty
        // through rarity, count and wave layout, so remove that unrelated
        // survival-mode multiplier here.
        const double realmScale = waveHealthScale(rarity);
        if (realmScale > 1.0) {
            if (Health* health = world_.tryGet<Health>(spawned)) {
                health->current /= realmScale;
                health->max /= realmScale;
            }
        }
        if (MobAi* ai = world_.tryGet<MobAi>(spawned)) ai->aggroRange = kMobTargetRetainRadius;
    }
}

void GameServer::stepTrials(double nowMillis) {
    for (TrialRun& trial : trials_) {
        if (trial.phase != TrialPhase::Idle) stepTrial(trial, nowMillis);
    }
}

void GameServer::stepTrial(TrialRun& trial, double nowMillis) {
    auto found = sessions_.find(trial.owner);
    if (found == sessions_.end() || !found->second.playing()) {
        clearTrialMobs(trial);
        const int slot = trialRealmIndex(trial.realm);
        if (slot >= 0) terrain_->trialRadii[static_cast<std::size_t>(slot)] = kTrialArenaRadius;
        trial = TrialRun{};
        return;
    }
    Session& session = found->second;
    if (trial.phase == TrialPhase::Intermission) {
        if (!trial.teleportCued &&
            nowMillis >= trial.nextChamberAtMillis - kTrialTeleportLeadMillis) {
            trial.teleportCued = true;
            sendTeleported(session.entity);
        }
        if (nowMillis >= trial.nextChamberAtMillis) spawnTrialChamber(trial, nowMillis);
        if (nowMillis >= trial.nextStateMillis) {
            trial.nextStateMillis = nowMillis + 200.0;
            sendTrialState(session, trial);
        }
        return;
    }
    if (trial.phase != TrialPhase::Active) return;

    const bool dead = world_.has<Dead>(session.entity);
    if (dead && !trial.deathCounted) {
        trial.deathCounted = true;
        ++trial.deaths;
        trial.reviveAtMillis = nowMillis + kTrialReviveMillis;
        if (trialChallenge(trial.floor, trial.chamber) == TrialChallenge::Defeat &&
            trial.deaths >= 4) {
            finishTrial(trial, false, "Four deaths in one chamber.");
            return;
        }
    }
    if (dead && trial.reviveAtMillis > 0.0 && nowMillis >= trial.reviveAtMillis) {
        standUpWaveFlower(session, nowMillis);
        trial.deathCounted = false;
        trial.reviveAtMillis = 0.0;
        if (Transform* at = world_.tryGet<Transform>(session.entity)) at->position = kWavesCentre;
    }

    const double elapsed = (nowMillis - trial.chamberStartedMillis) / 1000.0;
    if (trialChallenge(trial.floor, trial.chamber) == TrialChallenge::Timed &&
        elapsed > trialFailureSeconds(trial.floor, trial.chamber)) {
        finishTrial(trial, false, "The final time limit expired.");
        return;
    }

    if (trial.awaitingWave) {
        if (nowMillis >= trial.nextWaveAtMillis) spawnTrialWave(trial, nowMillis);
        if (nowMillis >= trial.nextStateMillis) {
            trial.nextStateMillis = nowMillis + 200.0;
            sendTrialState(session, trial);
        }
        return;
    }

    int living = 0;
    Query<TrialMob> mobs{world_};
    mobs.each([&](Entity mob, TrialMob&) {
        const Transform* at = world_.tryGet<Transform>(mob);
        if (at != nullptr && at->realm == trial.realm && !world_.has<Dead>(mob)) ++living;
    });
    // One TrialMob per spawned mob (safeTrialMob keeps out the multi-body
    // ones), so the earlier waves plus this wave's missing are the kills.
    int before = 0;
    for (int wave = 1; wave < trial.wave; ++wave) {
        before += trialMobsInWave(trial.floor, trial.chamber, wave);
    }
    trial.killed = before + std::max(0, trialMobsInWave(trial.floor, trial.chamber, trial.wave) -
                                            living);
    if (living == 0) {
        if (trial.wave < trial.waveCount) {
            clearTrialMobs(trial);
            trial.awaitingWave = true;
            trial.nextWaveAtMillis = nowMillis + 1500.0;
            return;
        }
        trial.stars += chamberStars(trial.floor, trial.chamber, trial.deaths, elapsed);
        if (trial.chamber >= kTrialChambersPerFloor) {
            finishTrial(trial, true, "Floor cleared!");
            return;
        }
        ++trial.chamber;
        trial.phase = TrialPhase::Intermission;
        trial.nextChamberAtMillis = nowMillis + kTrialIntermissionMillis;
        standUpWaveFlower(session, nowMillis);
        trial.deathCounted = false;
    }
    if (nowMillis >= trial.nextStateMillis) {
        trial.nextStateMillis = nowMillis + 200.0;
        sendTrialState(session, trial);
    }
}

void GameServer::finishTrial(TrialRun& trial, bool success, const std::string& reason) {
    auto found = sessions_.find(trial.owner);
    if (found == sessions_.end()) {
        clearTrialMobs(trial);
        trial = TrialRun{};
        return;
    }
    Session& session = found->second;
    trial.phase = success ? TrialPhase::Complete : TrialPhase::Failed;
    sendTrialState(session, trial);
    const int floor = trial.floor;
    const int stars = trial.stars;
    if (session.playing()) {
        standUpWaveFlower(session, clockMillis_);
        persistPlayer(session);
        despawnPlayer(session, true);
    }

    if (success) {
        PlayerRecord& record = database_.progress(session.userId);
        const int season = static_cast<int>(database_.nowMillis() / kTrialSeasonMillis);
        TrialProgressData progress = readProgress(record, season);
        const int slot = floor - 1;
        progress.cleared[slot] = true;
        progress.best[slot] = std::max(progress.best[slot], stars);
        writeProgress(record, progress);
        database_.markDirty();
    }

    clearTrialMobs(trial);
    session.trialFloor = 0;
    session.trialRealm = Realm::Overworld;
    session.spawnChoice.clear();
    if (net::Connection* connection = listener_.find(session.connection)) {
        sendNotice(*connection, success ? net::NoticeSeverity::Good : net::NoticeSeverity::Bad,
                   reason + (success ? "  Stars: " + std::to_string(stars) + "/9" : ""));
        sendFullProfile(session, *connection);
        sendTrialProgress(session, connection);
        ByteWriter w;
        w.u8(static_cast<std::uint8_t>(net::ServerMessage::LeftWorld));
        connection->send(w);
    }
    const int slot = trialRealmIndex(trial.realm);
    if (slot >= 0) terrain_->trialRadii[static_cast<std::size_t>(slot)] = kTrialArenaRadius;
    trial = TrialRun{};
}

void GameServer::handleClaimTrialReward(Session& session, net::Connection& connection,
                                        ByteReader& reader) {
    const int floor = reader.u8();
    bool ok = false;
    std::uint32_t stars = 0;
    double xp = 0.0;
    std::string petal;
    std::uint32_t petals = 0;
    bool fullBonus = false;
    std::string reason;

    if (!reader.ok() || !session.authenticated() || floor < 1 || floor > kTrialFloorCount) {
        reason = "That Trial Grounds floor is not available.";
    } else {
        PlayerRecord& record = database_.progress(session.userId);
        const int season = static_cast<int>(database_.nowMillis() / kTrialSeasonMillis);
        TrialProgressData progress = readProgress(record, season);
        const int slot = floor - 1;
        const int earned = progress.cleared[slot] ? (progress.best[slot] == 9 ? 2 : 1) : 0;
        if (earned == 0) {
            reason = "Clear all three chambers before claiming this floor's rewards.";
        } else if (progress.claimed[slot] >= earned) {
            reason = earned == 2 ? "All rewards for this floor have already been claimed."
                                 : "The clear reward is claimed; earn all 9 stars for the bonus.";
        } else {
            petal = trialRewardPetal(floor, season);
            if (progress.claimed[slot] < 1) {
                stars += static_cast<std::uint32_t>(trialBaseRewardStars(floor));
                xp += trialBaseRewardXp(floor);
                petals += static_cast<std::uint32_t>(trialBaseRewardPetals(floor));
            }
            if (progress.claimed[slot] < 2 && earned >= 2) {
                stars += static_cast<std::uint32_t>(trialFullRewardStars(floor));
                xp += trialFullRewardXp(floor);
                petals += static_cast<std::uint32_t>(trialFullRewardPetals(floor));
                fullBonus = true;
            }
            record.stars += stars;
            record.totalXp += xp;
            record.addItem(trialRewardRarity(floor), std::string("petal_") + petal, petals);
            progress.claimed[slot] = static_cast<std::uint8_t>(earned);
            writeProgress(record, progress);
            database_.markDirty();
            ok = true;
        }
    }

    ByteWriter response;
    response.u8(static_cast<std::uint8_t>(net::ServerMessage::TrialRewardClaimed));
    response.u8(ok ? 1 : 0);
    response.u8(static_cast<std::uint8_t>(std::clamp(floor, 0, kTrialFloorCount)));
    response.u32(stars);
    response.f64(xp);
    response.str(petal);
    response.u32(petals);
    response.u8(fullBonus ? 1 : 0);
    response.str(reason);
    connection.send(response);
    if (ok) sendFullProfile(session, connection);
    sendTrialProgress(session, &connection);
}

void GameServer::abandonTrial(Session& session) {
    const int slot = trialRealmIndex(session.trialRealm);
    if (slot < 0) return;
    TrialRun& trial = trials_[static_cast<std::size_t>(slot)];
    if (trial.phase == TrialPhase::Idle || trial.owner != session.connection) return;
    clearTrialMobs(trial);
    trial = TrialRun{};
    session.trialFloor = 0;
    session.trialRealm = Realm::Overworld;
    terrain_->trialRadii[static_cast<std::size_t>(slot)] = kTrialArenaRadius;
}

void GameServer::clearTrialMobs(TrialRun& trial) {
    std::vector<Entity> remove;
    Query<TrialMob> mobs{world_};
    mobs.each([&](Entity entity, TrialMob&) {
        const Transform* at = world_.tryGet<Transform>(entity);
        if (at != nullptr && at->realm == trial.realm) remove.push_back(entity);
    });
    for (Entity entity : remove) destroyBody(entity);
}

void GameServer::sendTrialState(Session& session, const TrialRun& trial) {
    net::Connection* connection = listener_.find(session.connection);
    if (connection == nullptr) return;
    const double now = clockMillis_;
    const double elapsed = trial.chamberStartedMillis > 0.0
                               ? std::max(0.0, (now - trial.chamberStartedMillis) / 1000.0)
                               : 0.0;
    const double revive = trial.reviveAtMillis > now ? (trial.reviveAtMillis - now) / 1000.0 : 0.0;
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::TrialState));
    w.u8(static_cast<std::uint8_t>(trial.phase));
    w.u8(static_cast<std::uint8_t>(trial.floor));
    w.u8(static_cast<std::uint8_t>(trial.chamber));
    w.u8(static_cast<std::uint8_t>(trialChallenge(trial.floor, trial.chamber)));
    w.u8(static_cast<std::uint8_t>(trial.stars));
    w.u8(static_cast<std::uint8_t>(trial.deaths));
    w.u8(static_cast<std::uint8_t>(trial.biome));
    w.u8(static_cast<std::uint8_t>(trial.buff));
    w.f32(static_cast<float>(elapsed));
    w.f32(static_cast<float>(trialThreeStarSeconds(trial.floor, trial.chamber)));
    w.f32(static_cast<float>(trialFailureSeconds(trial.floor, trial.chamber)));
    w.f32(static_cast<float>(revive));
    const int slot = trialRealmIndex(trial.realm);
    const double radius = slot >= 0 ? terrain_->trialRadii[static_cast<std::size_t>(slot)]
                                    : kTrialArenaRadius;
    w.f32(static_cast<float>(radius));
    w.u8(static_cast<std::uint8_t>(std::clamp(trial.killed, 0, 255)));
    w.u8(static_cast<std::uint8_t>(
        std::clamp(trialMobCount(trial.floor, trial.chamber), 0, 255)));
    connection->send(w);
}

} // namespace flix
