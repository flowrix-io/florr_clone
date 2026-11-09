// The wave survival mode's server half: the rift that leads to it, the flowers
// in it and the mobs it spawns. The rules are in shared/game/waves.h.
//
// One game at a time, on one disc, because one rift is what an admin opens.

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdio>
#include <limits>
#include <map>

#include "server/game_server.h"
#include "server/systems/movement.h"
#include "server/systems/spawning.h"
#include "server/text.h"
#include "shared/game/config.h"

namespace flix {
namespace {

// A portal is a pad of the default size: florr draws a warp at radius 100.
constexpr double kRiftRadius = kTeleporterArtRadius;
// Opened in front of the admin rather than under them, or the one typing the
// command would be through it a second later.
constexpr double kRiftOffset = 450.0;
constexpr double kRiftOffsetJitter = 100.0;
constexpr double kWaveSurveyMillis = 200.0;
// player_dead_camera.go: how long a dead flower waits between targets.
constexpr double kWaveSpectateSwitchMillis = 500.0;
constexpr int kWaveMaxCatchUpSteps = 8;
// The wire's u16, which is also as far as startNextWave counts.
constexpr int kWaveMaxStartWave = std::numeric_limits<int>::max(); // nobody would ever get to max, giving 1b stars if you manage to do it :)
constexpr std::size_t kWaveMaxIconGroups = 64;

bool readWaveNumber(const std::string& word, int& out) {
    const auto parsed = std::from_chars(word.data(), word.data() + word.size(), out);
    return parsed.ec == std::errc{} && parsed.ptr == word.data() + word.size() && out >= 1 &&
           out <= kWaveMaxStartWave;
}

} // namespace

// ---------------------------------------------------------------------------
// The console
// ---------------------------------------------------------------------------

void GameServer::runStartWavesCommand(Session& admin, net::Connection& connection,
                                      const std::vector<std::string>& args) {
    const auto out = [&](const std::string& s) { sendSystem(connection, escapedMarkup(s)); };
    std::string biomes;
    for (const WaveBiomeInfo& info : kWaveBiomes) biomes += (biomes.empty() ? "" : "|") + std::string(info.id);
    const std::string usage = "Usage: start_waves [" + biomes + "] [starting wave]";
    if (args.size() > 2) { out(usage); return; }
    WaveBiome biome = WaveBiome::Garden;
    int startWave = 1;
    std::size_t next = 0;
    if (next < args.size() && waveBiomeNamed(lowerCase(args[next]), biome)) ++next;
    if (next < args.size() && !readWaveNumber(args[next++], startWave)) { out(usage); return; }
    if (next != args.size()) { out(usage); return; }

    if (waves_.phase == WavePhase::Open || waves_.phase == WavePhase::Playing) {
        out("A rift is already open. /admin stop_waves closes it.");
        return;
    }
    if (!admin.playing() || !world_.isAlive(admin.entity) || world_.has<Dead>(admin.entity)) {
        out("Join the world first: a rift opens in front of you.");
        return;
    }
    const Transform& at = world_.get<Transform>(admin.entity);
    // On an authored map, where a flower's way back is simply the map it came
    // from. The ring, the maze and a hosted game each run on an account of
    // their own, and what walking out mid-run means is theirs to say.
    if (!isWorldRealm(at.realm) || at.realm == kAdminArenaRealm) {
        out("A rift can only open on a map, not in the PVP arena, the maze or a hosted game.");
        return;
    }
    const Realm realm = at.realm;
    const Vec2 ahead{at.position.x + std::cos(at.angle) * kRiftOffset,
                     at.position.y + std::sin(at.angle) * kRiftOffset};
    const Vec2 riftAt = terrain_->findOpenSpawn(rng_, ahead, kRiftOffsetJitter, realm);

    waves_ = WaveRun{};
    waves_.phase = WavePhase::Open;
    waves_.biome = biome;
    waves_.startWave = startWave;
    waves_.wave = startWave;
    waves_.riftOpen = true;
    waves_.riftRealm = realm;
    waves_.riftPosition = riftAt;

    std::printf("[waves] %s opened a %s rift at wave %d\n", admin.username.c_str(),
                waveBiomeInfo(biome).id, startWave);
    broadcastRiftState();
    broadcastChat(net::ChatChannel::System, "", "<b style=\"color: #555555;\">A Mysterious rift has opened!</b>");
}

void GameServer::runStopWavesCommand(Session& admin, net::Connection& connection) {
    const auto out = [&](const std::string& s) { sendSystem(connection, escapedMarkup(s)); };
    if (waves_.phase == WavePhase::Idle) {
        out("No rift is open.");
        return;
    }
    std::printf("[waves] %s closed the rift at wave %d\n", admin.username.c_str(), waves_.wave);
    closeWaves();
    out("The rift is closed.");
}

// ---------------------------------------------------------------------------
// The rift
// ---------------------------------------------------------------------------

void GameServer::stepRiftPortal(double nowMillis, double dt) {
    if (!waves_.riftOpen) return;
    const double suction = kTeleporterSuctionRadius * kRiftRadius / kTeleporterArtRadius;
    const double reach = kTeleporterRadius * kRiftRadius / kTeleporterArtRadius;

    std::vector<net::ConnectionId> entering;
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        if (!session.playing() || session.realm != waves_.riftRealm) continue;
        const Entity body = session.entity;
        if (!world_.isAlive(body) || world_.has<Dead>(body)) continue;
        // ensure() can move the flower to another archetype, so it comes first.
        TeleporterState& state = world_.ensure<TeleporterState>(body);
        Transform* transform = world_.tryGet<Transform>(body);
        if (transform == nullptr || transform->realm != waves_.riftRealm) {
            state.chargingRift = false;
            session.riftChargeSinceMillis = 0;
            continue;
        }
        const Vec2 offset = transform->position - waves_.riftPosition;
        const double distance = offset.length();
        const bool onCooldown = nowMillis < state.cooldownUntilMillis;

        if (distance <= suction && !onCooldown && distance > 0.0) {
            // As a pad pulls. Through the wall resolver, though, where a pad's
            // pull is committed raw: a pad is authored on open ground, and a
            // rift is wherever the admin happened to be facing.
            const double pull = kTeleporterSuctionForce * (1.0 - distance / suction) * dt;
            const Body* shape = world_.tryGet<Body>(body);
            stepCollide(*terrain_, transform->realm, transform->position,
                        offset * (-pull / distance), shape ? shape->radius : kPlayerBaseRadius,
                        1.0, true, true);
        }
        if (distance > reach) {
            state.chargingRift = false;
            session.riftChargeSinceMillis = 0;
            continue;
        }
        state.chargingRift = true;
        if (session.riftChargeSinceMillis <= 0.0) session.riftChargeSinceMillis = nowMillis;
        if (!onCooldown && nowMillis - session.riftChargeSinceMillis >= kTeleporterDwellMillis) {
            entering.push_back(entry.first);
        }
    }
    for (const net::ConnectionId id : entering) {
        const auto found = sessions_.find(id);
        if (found != sessions_.end()) enterWaves(found->second, nowMillis);
    }
}

void GameServer::stopChargingRift() {
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        session.riftChargeSinceMillis = 0;
        if (!session.playing()) continue;
        if (TeleporterState* state = world_.tryGet<TeleporterState>(session.entity)) {
            state->chargingRift = false;
        }
    }
}

void GameServer::enterWaves(Session& session, double nowMillis) {
    const Entity body = session.entity;
    const Transform before = world_.get<Transform>(body);
    session.wavesHasReturn = true;
    session.wavesReturnRealm = before.realm;
    session.wavesReturnPosition = before.position;
    session.riftChargeSinceMillis = 0;
    session.waveSpectating = NULL_ENTITY;
    if (TeleporterState* state = world_.tryGet<TeleporterState>(body)) state->chargingRift = false;
    persistPlayer(session);
    endControlOf(session, "went through a rift", false);
    endSplit(session, clockMillis_, false);

    // The first flower through starts the clock.
    if (waves_.phase == WavePhase::Open) {
        waves_.phase = WavePhase::Playing;
        waves_.wave = waves_.startWave;
        waves_.timer = 0.0;
        waves_.redTimer = 0.0;
        waves_.red = false;
        waves_.stepCarryMillis = 0.0;
        waves_.spawner.next(waves_.biome, waves_.wave, rng_);
        terrain_->wavesRadius = waveRadius(waves_.wave);
    }

    // Wave_pool Start: anywhere from halfway out to the edge.
    const double angle = rng_.unit() * kTau;
    const double reach = (0.5 * rng_.unit() + 0.5) * terrain_->wavesRadius;
    const Vec2 arrival =
        terrain_->clampInside({kWavesCentre.x + std::cos(angle) * reach,
                               kWavesCentre.y + std::sin(angle) * reach},
                              kPlayerBaseRadius, kWavesRealm);
    moveEntityToRealm(session.entity, kWavesRealm, arrival);
    // Mobs were spawned clear of the flowers already here, not of this one.
    if (Health* health = world_.tryGet<Health>(session.entity)) {
        health->invulnerableUntilMillis = nowMillis + kRespawnInvulnerabilitySeconds * 1000.0;
    }
    sendWaveState(session);
}

void GameServer::leaveWaves(Session& session, double nowMillis) {
    if (!session.playing() || !world_.isAlive(session.entity)) return;
    standUpWaveFlower(session, nowMillis);
    const Realm home = session.wavesHasReturn ? session.wavesReturnRealm : spawnRealmFor(session);
    const Vec2 around =
        session.wavesHasReturn ? session.wavesReturnPosition : terrain_->spawnPoint(home);
    session.wavesHasReturn = false;
    session.waveSpectating = NULL_ENTITY;
    moveEntityToRealm(session.entity, home, terrain_->findOpenSpawn(rng_, around, 0.0, home));
}

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

void GameServer::standUpWaveFlower(Session& session, double nowMillis) {
    const Entity body = session.entity;
    if (!world_.has<Dead>(body)) return;
    if (Health* health = world_.tryGet<Health>(body)) {
        health->current = health->max;
        health->invulnerableUntilMillis = nowMillis + kRespawnInvulnerabilitySeconds * 1000.0;
    }
    // A bandage's lock on being raised is against a yggdrasil, not a new wave.
    if (world_.has<Unrevivable>(body)) world_.remove<Unrevivable>(body);
    world_.remove<Dead>(body);
    session.waveSpectating = NULL_ENTITY;
    session.waveSpectateSinceMillis = 0;
    onPlayerRevived(body, NULL_ENTITY);
}

void GameServer::reviveWaveFlowers(double nowMillis) {
    std::vector<Vec2> standing;
    std::vector<Session*> fallen;
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        if (!session.playing() || session.realm != kWavesRealm) continue;
        if (!world_.isAlive(session.entity)) continue;
        if (world_.has<Dead>(session.entity)) {
            fallen.push_back(&session);
        } else if (const Transform* at = world_.tryGet<Transform>(session.entity)) {
            standing.push_back(at->position);
        }
    }
    // RevivePlayer: nobody up is nobody to get up beside, and the survey is about
    // to call it game over.
    if (standing.empty()) return;
    for (Session* session : fallen) {
        standUpWaveFlower(*session, nowMillis);
        const Vec2 beside = standing[rng_.below(static_cast<std::uint32_t>(standing.size()))];
        const double angle = rng_.unit() * kTau;
        const double reach = (0.5 * rng_.unit() + 0.5) * kWaveReviveDistance;
        if (Transform* at = world_.tryGet<Transform>(session->entity)) {
            at->position = terrain_->clampInside({beside.x + std::cos(angle) * reach,
                                                  beside.y + std::sin(angle) * reach},
                                                 kPlayerBaseRadius, kWavesRealm);
        }
    }
}

void GameServer::spawnWaveMob(const WaveMob& mob, double nowMillis) {
    const std::uint16_t index = content().mobIndex(mob.id);
    if (index == kInvalidIndex) return;
    // GetRandomSafeCoordinate: a point clear of every living flower, and no mob
    // at all when a hundred tries find none. Clear of the mob's own body too,
    // which flooooio's mythics were small enough to leave out and a super is not.
    const double reach = content().mobStats(index, mob.rarity).radius;
    constexpr int kAttempts = 100;
    std::vector<std::pair<Vec2, double>> flowers;
    for (const auto& entry : sessions_) {
        const Session& session = entry.second;
        if (!session.playing() || session.realm != kWavesRealm) continue;
        if (!world_.isAlive(session.entity) || world_.has<Dead>(session.entity)) continue;
        const Transform* at = world_.tryGet<Transform>(session.entity);
        const Body* body = world_.tryGet<Body>(session.entity);
        if (at != nullptr) {
            flowers.push_back({at->position, body != nullptr ? body->radius : kPlayerBaseRadius});
        }
    }
    const double inside = std::max(0.0, terrain_->wavesRadius - kWaveSpawnSafety);
    for (int attempt = 0; attempt < kAttempts; ++attempt) {
        // Uniform in distance, not area, so they crowd in: around a flower
        // picked at random (kWaveSpawnReach), or the middle while nobody stands.
        const double heading = rng_.unit() * kTau;
        Vec2 from = kWavesCentre;
        double out = rng_.unit() * inside;
        if (!flowers.empty()) {
            const auto& flower = flowers[rng_.below(static_cast<std::uint32_t>(flowers.size()))];
            from = flower.first;
            out = kWaveSpawnSafety + flower.second + reach + rng_.unit() * kWaveSpawnReach;
        }
        const Vec2 spot{from.x + std::cos(heading) * out, from.y + std::sin(heading) * out};
        if (distanceSq(spot, kWavesCentre) > inside * inside) continue;
        const bool clear = std::none_of(flowers.begin(), flowers.end(), [&](const auto& flower) {
            const double gap = kWaveSpawnSafety + flower.second + reach;
            return distanceSq(spot, flower.first) < gap * gap;
        });
        if (!clear) continue;
        const Entity spawned = spawning_->spawnMob(world_, *terrain_, content(), index, mob.rarity,
                                                   spot, kWavesRealm, nowMillis, rng_);
        if (spawned != NULL_ENTITY) {
            // flooooio's hostile mobs notice a flower 2000 away, which on its
            // 1500 disc is all of it. The disc grows here, and a mob that only
            // looked as far as it does in the wild would wander the far side
            // for the rest of the wave. So it sees as far as any mob ever does.
            if (MobAi* ai = world_.tryGet<MobAi>(spawned); ai != nullptr && ai->kind == AiKind::Hostile) {
                ai->aggroRange = std::max(ai->aggroRange, kMobTargetRetainRadius);
            }
            ++waves_.mobs;
            waves_.bodyArea += kPi * reach * reach;
            waves_.spawnedSinceSurvey = true;
        }
        return;
    }
}

void GameServer::startNextWave(double nowMillis) {
    reviveWaveFlowers(nowMillis);
    waves_.red = false;
    waves_.redTimer = 0.0;
    waves_.timer = 0.0;
    waves_.wave = waves_.wave + 1;
    waves_.spawner.next(waves_.biome, waves_.wave, rng_);
    // Out from the middle, so whatever stood at the old edge stands where it
    // was; the client eases its own edge out after it.
    terrain_->wavesRadius = waveRadius(waves_.wave);
}

void GameServer::stepWaveClock(double nowMillis) {
    // A full disc holds the spawner where it is rather than dropping what it
    // would have placed: the wave's mobs are owed, and come once there is room.
    const bool full = waves_.bodyArea >= kWaveMaxBodyArea || waves_.mobs >= kWaveMaxMobs;
    if (!waves_.red && !full) {
        waves_.spawner.step(waves_.biome, waves_.wave, rng_, waves_.due);
        for (const WaveMob& mob : waves_.due) spawnWaveMob(mob, nowMillis);
    }
    // The count is only trusted once it has seen the last spawn: spawning adds
    // one to it, and a centipede is ten bodies.
    if (waves_.spawner.finished() && !waves_.spawnedSinceSurvey &&
        waves_.mobs <= kWaveClearedMobCount) {
        startNextWave(nowMillis);
        return;
    }
    const double step = 1.0 / kWaveStepsPerSecond;
    const double length = waveLength(waves_.wave);
    if (waves_.timer < length) {
        waves_.timer = std::min(length, waves_.timer + step);
        return;
    }
    if (waves_.redTimer < length && waves_.mobs > kWaveRedMobCount) {
        // Red spawns nothing, so the wave is what is on the disc now, and
        // clearing it ends the wave as clearing any other does.
        if (!waves_.red) waves_.spawner.forfeit();
        waves_.red = true;
        waves_.redTimer = std::min(length, waves_.redTimer + step);
        return;
    }
    startNextWave(nowMillis);
}

void GameServer::spectateWaves(double nowMillis) {
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        if (!session.playing() || session.realm != kWavesRealm) continue;
        const Entity body = session.entity;
        if (!world_.isAlive(body) || !world_.has<Dead>(body)) continue;

        const auto targetGone = [&] {
            return session.waveSpectating == NULL_ENTITY ||
                   !world_.isAlive(session.waveSpectating) ||
                   world_.has<Dead>(session.waveSpectating) ||
                   world_.tryGet<Transform>(session.waveSpectating) == nullptr ||
                   world_.get<Transform>(session.waveSpectating).realm != kWavesRealm;
        };
        if (targetGone()) {
            if (session.waveSpectating != NULL_ENTITY || session.waveSpectateSinceMillis <= 0.0) {
                session.waveSpectating = NULL_ENTITY;
                session.waveSpectateSinceMillis = nowMillis;
                continue;
            }
            if (nowMillis - session.waveSpectateSinceMillis < kWaveSpectateSwitchMillis) continue;
            // The nearest enemy or flower still up: FindNearestEntity over
            // findCameraTargets. A plain walk, and only while looking for one.
            const Vec2 from = world_.get<Transform>(body).position;
            double best = std::numeric_limits<double>::infinity();
            Query<Transform, Body> everything{world_};
            everything.without<Dead, ProjectileTag>();
            everything.each([&](Entity e, Transform& at, Body&) {
                if (at.realm != kWavesRealm || e == body) return;
                const bool flower = world_.has<PlayerTag>(e);
                const bool enemy = world_.has<MobTag>(e) && !world_.has<Pet>(e);
                if (!flower && !enemy) return;
                const double d = distanceSq(at.position, from);
                if (d < best) {
                    best = d;
                    session.waveSpectating = e;
                }
            });
            session.waveSpectateSinceMillis = nowMillis;
            if (targetGone()) continue;
        }
        world_.get<Transform>(body).position =
            world_.get<Transform>(session.waveSpectating).position;
    }
}

void GameServer::surveyWaves(double nowMillis) {
    (void)nowMillis;
    // What is left on the disc: the red clock's question, and the HUD's icons.
    int mobs = 0;
    double area = 0.0;
    std::map<std::pair<std::uint16_t, std::uint8_t>, std::uint16_t> groups;
    Query<MobTag, Transform, MobType, Body> enemies{world_};
    enemies.without<Dead, Pet>();
    enemies.each([&](Entity, MobTag&, Transform& at, MobType& type, Body& body) {
        if (at.realm != kWavesRealm) return;
        ++mobs;
        area += kPi * body.radius * body.radius;
        // A chain is one animal on the HUD, and its head stands for it.
        if (content().mob(type.configIndex).chainBody) return;
        auto& count = groups[{type.configIndex, static_cast<std::uint8_t>(type.rarity)}];
    });
    waves_.mobs = mobs;
    waves_.bodyArea = area;
    waves_.spawnedSinceSurvey = false;
    waves_.groups.clear();
    for (const auto& group : groups) {
        if (waves_.groups.size() >= kWaveMaxIconGroups) break;
        waves_.groups.push_back({group.first.first, group.first.second, group.second});
    }

    int inside = 0;
    int standing = 0;
    for (const auto& entry : sessions_) {
        const Session& session = entry.second;
        if (!session.playing() || session.realm != kWavesRealm) continue;
        ++inside;
        if (world_.isAlive(session.entity) && !world_.has<Dead>(session.entity)) ++standing;
    }

    if (inside == 0) {
        if (waves_.phase == WavePhase::Playing) {
            // Everybody walked out. One flower leaving must not take an admin's
            // rift away from everyone still on their way to it, so it stays open
            // and the game starts over for whoever comes through next.
            clearWaveRealm();
            waves_.spawner = WaveSpawner{};
            waves_.phase = WavePhase::Open;
            waves_.wave = waves_.startWave;
            waves_.timer = 0.0;
            waves_.redTimer = 0.0;
            waves_.red = false;
        }
        return;
    }
    if (waves_.phase == WavePhase::Playing && standing == 0) {
        // Nobody standing: the game is over and the room closes, everyone back
        // where they went in. The disc is cleared and the rift goes with it.
        const int reached = waves_.wave;
        std::vector<net::ConnectionId> players;
        for (const auto& entry : sessions_) {
            if (entry.second.playing() && entry.second.realm == kWavesRealm) {
                players.push_back(entry.first);
            }
        }
        std::printf("[waves] game over at wave %d\n", reached);
        closeWaves();
        for (const net::ConnectionId id : players) {
            if (net::Connection* connection = listener_.find(id)) {
                sendSystem(*connection, "Game over! You reached wave " + std::to_string(reached) +
                                            ". The rift has closed.");
            }
        }
        return;
    }
    for (auto& entry : sessions_) {
        if (entry.second.playing() && entry.second.realm == kWavesRealm) {
            sendWaveState(entry.second);
        }
    }
}

void GameServer::stepWaves(double nowMillis) {
    if (waves_.phase == WavePhase::Idle) return;
    const double elapsed = waves_.lastTickMillis >= 0.0
                               ? std::clamp(nowMillis - waves_.lastTickMillis, 0.0, 1000.0)
                               : 0.0;
    waves_.lastTickMillis = nowMillis;

    stepRiftPortal(nowMillis, elapsed / 1000.0);
    spectateWaves(nowMillis);
    if (waves_.phase == WavePhase::Playing) {
        waves_.stepCarryMillis += elapsed;
        int steps = 0;
        while (waves_.stepCarryMillis >= kWaveStepMillis && steps < kWaveMaxCatchUpSteps) {
            waves_.stepCarryMillis -= kWaveStepMillis;
            stepWaveClock(nowMillis);
            ++steps;
        }
        // Behind by more than the catch-up allows is lost, not owed.
        if (steps == kWaveMaxCatchUpSteps) waves_.stepCarryMillis = 0.0;
    }
    if (nowMillis >= waves_.nextSurveyMillis) {
        waves_.nextSurveyMillis = nowMillis + kWaveSurveyMillis;
        surveyWaves(nowMillis);
    }
}

void GameServer::clearWaveRealm() {
    std::vector<Entity> remove;
    Query<Transform> everything{world_};
    everything.each([&](Entity e, Transform& at) {
        if (at.realm != kWavesRealm || world_.has<PlayerTag>(e) || world_.has<Pet>(e) ||
            world_.has<PetalInstance>(e)) {
            return;
        }
        remove.push_back(e);
    });
    for (const Entity e : remove) destroyBody(e);
}

void GameServer::closeWaves() {
    const double now = clockMillis_;
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        if (session.playing() && session.realm == kWavesRealm) leaveWaves(session, now);
    }
    clearWaveRealm();
    stopChargingRift();
    waves_ = WaveRun{};
    terrain_->wavesRadius = kWavesStartRadius;
    broadcastRiftState();
}

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

void GameServer::sendRiftState(net::Connection& connection) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::RiftState));
    w.u8(waves_.riftOpen ? 1 : 0);
    w.u8(static_cast<std::uint8_t>(waves_.riftRealm));
    w.position(waves_.riftPosition);
    w.f32(static_cast<float>(kRiftRadius));
    connection.send(w);
}

void GameServer::broadcastRiftState() {
    listener_.each([&](net::Connection& connection) {
        const Session* session = sessionFor(connection.id());
        if (session != nullptr && session->authenticated()) sendRiftState(connection);
    });
}

void GameServer::sendWaveState(Session& session) {
    net::Connection* connection = listener_.find(session.connection);
    if (connection == nullptr) return;
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::WaveState));
    w.u8(static_cast<std::uint8_t>(waves_.phase));
    w.u8(static_cast<std::uint8_t>(waves_.biome));
    w.u16(static_cast<std::uint16_t>(waves_.wave));
    w.f32(static_cast<float>(waves_.timer));
    w.f32(static_cast<float>(waves_.redTimer));
    w.f32(static_cast<float>(terrain_->wavesRadius));
    w.u16(static_cast<std::uint16_t>(waves_.groups.size()));
    for (const WaveRun::Group& group : waves_.groups) {
        w.u16(group.mobIndex);
        w.u8(group.rarity);
        w.u16(group.count);
    }
    connection->send(w);
}

} // namespace flix
