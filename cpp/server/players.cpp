// A player's flower: joining the world and leaving it, input, respawning, and
// the body itself -- built from the account, kept in step with it, saved back
// into it and taken out of the world.

#include "server/game_server.h"

#include <algorithm>
#include <cstdio>

#include "server/chat_moderation.h"
#include "server/game_server_internal.h"
#include "server/routine_log_policy.h"
#include "server/text.h"
#include "server/systems/petals.h"
#include "server/systems/spawning.h"
#include "shared/game/config.h"
#include "shared/game/skills.h"

namespace flix {

namespace {

/// Clamp on the viewport a client may claim, per axis, when nothing it wears
/// pulls the camera out. A client asking to see the whole map is asking for an
/// advantage, and for the server to build it a snapshot of the entire world.
constexpr double kMaxViewportAxis = 2600.0;

/// Headroom on a camera petal's ceiling for the client's own rounding: it
/// reports its window divided by its zoom, rounded, and a design-unit window
/// can come out a unit over 1920.
constexpr double kViewportCeilingSlack = 1.01;

} // namespace

/// The viewport a flower may claim: what its client reported, clamped to what
/// that flower can honestly be drawing.
///
/// The ceiling is not flat, because the camera petals legitimately show more
/// world. Unique antennae draws ten default screens' worth of width, and a flat
/// 2600 clamp streamed and woke barely a quarter of it: mobs were culled in
/// plain view, and the spawn bands stayed empty outside a box around the
/// flower. So it is the default screen divided by the zoom the body's OWN worn
/// loadout grants -- the rule the client draws by (petalCameraZoom) -- and
/// never below the flat allowance every flower has always had. A client still
/// cannot claim more than its loadout pays for.
Vec2 claimableViewport(World& world, Entity body, const ContentRegistry& content, double width,
                       double height) {
    double zoom = 1.0;
    if (const Loadout* loadout = world.tryGet<Loadout>(body)) {
        for (int i = 0; i < kLoadoutActiveSlots; ++i) {
            // Resolved, as the client resolves it: a mimic beside a third eye
            // pulls the camera out as one at the mimic's tier.
            const EquippedPetal slot = equippedPetal(content, *loadout, i);
            if (slot.empty()) continue;
            zoom = std::min(zoom, petalCameraZoom(content, slot.configIndex, slot.rarity));
        }
    }
    // Antennae bottoms out at 0.1; this only stops a bad figure dividing by
    // zero or by a negative.
    zoom = std::max(zoom, 0.05);
    const double ceilingX = std::max(kMaxViewportAxis, kViewportWidth / zoom * kViewportCeilingSlack);
    const double ceilingY = std::max(kMaxViewportAxis, kViewportHeight / zoom * kViewportCeilingSlack);
    return {clamp(width, 320.0, ceilingX), clamp(height, 240.0, ceilingY)};
}

void GameServer::handleJoin(Session& session, net::Connection& connection, ByteReader& reader) {
    const double width = reader.u16();
    const double height = reader.u16();
    const std::string where = reader.str();
    const std::string name = reader.str();
    const bool wantsPrestige = reader.u8() != 0;
    if (!reader.ok()) return;
    if (!session.authenticated()) return;
    if (session.playing()) return;

    // The nameplate, not the account. Kept on the session so a respawn keeps
    // the name the player typed rather than reverting to their login. Judged
    // as it will be drawn, so after sanitising, and refused as a chat line is.
    // A Bad notice is what takes the client's loading screen back down to the
    // lobby, where the player can change the name.
    const std::string nameplate = sanitizePlayerName(name);
    std::string refusedFor = blockedWordInName(nameplate);
    if (refusedFor.empty() && chatLineReversesText(escapedMarkup(nameplate))) {
        refusedFor = "reverses text";
    }
    if (!refusedFor.empty()) {
        std::printf("[names] refused the nameplate \"%s\" from %s (\"%s\")\n", nameplate.c_str(),
                    session.username.c_str(), refusedFor.c_str());
        sendNotice(connection, net::NoticeSeverity::Bad, "That name is not allowed. Pick another.");
        return;
    }
    session.displayName = nameplate;

    // Remembered on the session so a respawn returns to the spawn point the
    // player chose, rather than quietly sending them back to the beginner
    // ground. A choice no staged map defines is dropped here, once, with a
    // notice -- rather than silently every time they die.
    session.spawnChoice.clear();
    if (where == kAdminArenaSpawnChoice) {
        if (!effectiveAdmin(session)) {
            sendNotice(connection, net::NoticeSeverity::Bad, "Only admins may select the hosted arena. A host can bring you in.");
            return;
        }
        session.spawnChoice = where;
    } else if (where == kArenaSpawnChoice || where == kMazeSpawnChoice) {
        // The two destinations that are not on any map at all: each is a realm
        // of its own (realm.h), generated rather than authored, so there is no
        // spawn rectangle to look up.
        session.spawnChoice = where;
    } else if (!where.empty() && where != "default") {
        if (worldMaps_.choice(where) != nullptr) {
            session.spawnChoice = where;
        } else if (worldMaps_.door(where) != nullptr) {
            // A door that exists but is not offered: a map marks it
            // `pickable: false`, and it is reached through a pad rather than
            // from the picker. An admin may still name it -- that is how a
            // screenshot rig reaches one -- but anyone else starts where the
            // picker would have let them.
            if (session.admin) {
                session.spawnChoice = where;
            } else {
                sendNotice(connection, net::NoticeSeverity::Warning,
                           "That door is reached from its biome; starting at the default.");
            }
        } else {
            sendNotice(connection, net::NoticeSeverity::Warning,
                       "That spawn point is not on this server; starting at the default.");
        }
    }

    // The prestige twin of that door, for a tree that holds the talent. The
    // arena and the maze have no twin, so the flag means nothing there and is
    // dropped rather than refused: the picker hides both while it is set.
    session.prestige = false;
    if (wantsPrestige && session.spawnChoice != kAdminArenaSpawnChoice && session.spawnChoice != kArenaSpawnChoice &&
        session.spawnChoice != kMazeSpawnChoice) {
        if (database_.progress(session.userId).skills.prestigeUnlocked()) {
            session.prestige = true;
        } else {
            sendNotice(connection, net::NoticeSeverity::Warning,
                       "Prestige is a talent; starting in the ordinary biome.");
        }
    }

    const Entity entity = spawnPlayer(session);
    if (entity == NULL_ENTITY) {
        sendNotice(connection, net::NoticeSeverity::Bad, "Could not find a spawn point.");
        return;
    }

    const Vec2 viewport = claimableViewport(world_, entity, content(), width, height);
    world_.get<PlayerLocation>(entity).viewport = viewport;

    views_[session.connection].reset();

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::JoinAccepted));
    w.u32(world_.get<NetId>(entity).value);
    w.position(world_.get<Transform>(entity).position);
    w.u32(tick_);
    // Which maze the server is playing: the client builds the same walls from
    // the day number alone.
    w.i64(activeMaze().day());
    // The map the body was put in: which realm, how big it is, and its exact
    // grid. Encoded, so a large map does not sit on the socket's backpressure
    // ceiling; it is the same grid collision runs on and cannot drift from it.
    writeMapGrid(w, *terrain_, world_.get<Transform>(entity).realm);
    connection.send(w);
    sendRiftState(connection);
    // The client's profile is the account's, and a body in the ring plays on
    // the arena kit instead; the maze body is on its own track. Restated here
    // so the panels show what the flower actually has from the first frame.
    sendProfile(session, connection);
}

void GameServer::handleLeave(Session& session, net::Connection& connection) {
    if (!session.playing()) return;
    leaveWorld(session);
    sendProfile(session, connection);
}

void GameServer::leaveWorld(Session& session) {
    // On the body, not the stage: a re-auth is about to change whose session
    // this is, and a body left on it past that point would be credited with
    // whatever it picks up by the account that comes next. persistPlayer
    // saves only a Playing session's, so a body the stage had stopped
    // vouching for is taken out unsaved -- see spawnPlayer for why.
    if (session.entity == NULL_ENTITY) return;
    persistPlayer(session);
    // The body first, then the grant: a grantee steering somebody else's
    // flower lets go of it on the way out of the world, and taking the grant
    // first would move their view back onto a flower that is about to go.
    despawnPlayer(session, true);
    revokeTempAdmin(session.connection);
    session.adminArenaAdmitted = false;
    session.adminArenaHasReturn = false;
}

void GameServer::handleInput(Session& session, ByteReader& reader) {
    const net::InputFrame input = net::InputFrame::read(reader);
    if (!reader.ok() || !session.playing()) return;
    if (!spend(session.inputAllowance)) return;

    // A replayed or reordered input must not move the player twice. TCP gives
    // ordering, but a client is free to send its own duplicates.
    if (input.sequence <= session.lastInputSequence) return;
    session.lastInputSequence = input.sequence;

    // Which flower the movement, the aim and the two buttons steer. A flower
    // an admin has taken over ignores its own player entirely, whichever half
    // they are in; the admin steers it instead, through whatever half is
    // active NOW, so a splitter switch moves the control with it. Both ends
    // are back-references on the sessions, which keeps this to one lookup on
    // the hottest path the server has.
    Entity steered = session.entity;
    if (session.controlledBy != 0) {
        steered = NULL_ENTITY;
    } else if (session.controlling != 0) {
        const Session* target = sessionFor(session.controlling);
        steered = target != nullptr && target->playing() ? target->entity : NULL_ENTITY;
    }
    if (PlayerInput* state = world_.tryGet<PlayerInput>(steered)) state->current = input;

    // The window the client is drawing rides every input packet, so a resize or
    // a zoom widens what is replicated on the next tick rather than at the next
    // join. Zero means "unchanged", which is what a client that never learned
    // to report it sends.
    //
    // Always onto the sender's OWN body, whatever it is steering: the claim
    // culls this client's stream, decides what this body hears on Local and
    // keeps the spawner from putting mobs down in plain sight of it. An admin
    // watching through another flower is culled to this same claim by
    // replicate(), and the flower they are steering keeps its own player's.
    if (input.viewportWidth > 0 && input.viewportHeight > 0) {
        // Clamped against the loadout as it stands NOW, every frame, so taking
        // the antennae off shrinks the claim on the next packet.
        const Vec2 viewport = claimableViewport(world_, session.entity, content(),
                                                input.viewportWidth, input.viewportHeight);
        if (PlayerLocation* location = world_.tryGet<PlayerLocation>(session.entity)) {
            location->viewport = viewport;
        }
    }
}

void GameServer::handleRespawn(Session& session) {
    if (!session.authenticated()) return;
    // A lent console is lent for one life. Dropping it here rather than on
    // death means the grantee keeps it while they are looking at the death
    // card, which is where the reference leaves it too.
    revokeTempAdmin(session.connection);
    // The map the client is still drawing. A corpse keeps its realm until it
    // is replaced, so this is what the client last heard; a session with no
    // body has told its client nothing since the join, and is restated
    // regardless.
    bool corpseRealmKnown = false;
    Realm corpseRealm = Realm::Overworld;
    if (session.playing() && world_.isAlive(session.entity)) {
        Health* health = world_.tryGet<Health>(session.entity);
        if (health && health->alive()) return;   // not actually dead
        if (const Transform* corpse = world_.tryGet<Transform>(session.entity)) {
            corpseRealmKnown = true;
            corpseRealm = corpse->realm;
        }
        despawnPlayer(session, false);
    }
    const Entity reborn = spawnPlayer(session);
    // A flower that died in a map it teleported into comes back where its
    // spawn choice says -- usually another map. The snapshot stream restates
    // the body but never the realm, so the client would keep drawing the map
    // it died on under a body standing somewhere else: the same message a
    // pad sends, for the same reason.
    if (reborn != NULL_ENTITY) {
        const Transform* transform = world_.tryGet<Transform>(reborn);
        if (transform != nullptr && (!corpseRealmKnown || transform->realm != corpseRealm)) {
            sendRealmChange(session, transform->position);
        }
    }
    // A fresh arena run has a fresh kit; the same restatement the join makes.
    sendProfile(session);
}

void GameServer::collectSpawnBlockers(Realm realm, std::vector<MobDisc>& out) const {
    out.clear();
    Query<MobTag, Transform, Body> mobs{const_cast<World&>(world_)};
    mobs.each([&](Entity, MobTag&, Transform& transform, Body& body) {
        if (transform.realm != realm) return;
        out.push_back({transform.position, body.radius});
    });
}

void GameServer::onPlayerRevived(Entity revived, Entity reviver) {
    Session* session = sessionForEntity(revived);
    if (session == nullptr) return;

    // The corpse's death has already been announced and the reaper has stopped
    // looking at it. Clearing the flag is what lets this body die a second
    // time: without it the next death is silent and the player is left standing
    // as a corpse nobody told them about.
    session->deathReported = false;
    net::Connection* connection = listener_.find(session->connection);
    if (connection == nullptr) return;

    // Whoever carried the yggdrasil, by the name on their nameplate -- a bot's
    // reads the same way a player's does. A reviver whose own body went away
    // between the raise and this call leaves the client its own fallback.
    std::string reviverName;
    if (reviver != NULL_ENTITY && world_.isAlive(reviver)) {
        if (const PlayerAccount* account = world_.tryGet<PlayerAccount>(reviver)) {
            reviverName = account->username;
        }
    }

    // The counterpart of the `Died` the reaper sent: without it the client
    // keeps the death card up and stops sending input, so a revived player
    // stands in the world unable to move.
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Revived));
    w.str(reviverName);
    connection->send(w);
}

Entity GameServer::spawnPlayer(Session& session) {
    session.marketAccess=false;
    // Never on top of a body the session still holds. Both callers arrive
    // with none -- handleJoin refuses a session that is playing, and a respawn
    // takes the corpse off first -- so one still attached here is a body some
    // change of stage forgot, which is how a repeated Hello used to strand a
    // flower per join. Overwriting session.entity would leave it standing for
    // good, so it is taken out first, with any control and split it is part
    // of. Removed rather than refused: a refused join leaves the stray body
    // exactly where it is and the socket unable to play. Removed with the
    // ordinary save, which is persistPlayer's to make or refuse, and it makes
    // it only for a Playing session. In the state this exists to catch -- a
    // stage that stopped saying Playing while the body stood -- that is a
    // refusal, and the right one: the account on the session may have changed
    // while the stage said there was no body, and a save then would write one
    // account's flower into another's record. The cost is whatever the stray
    // body earned after the saves stopped seeing it.
    if (session.entity != NULL_ENTITY || session.split()) {
        if (shouldLogRoutineActivity(session.username)) {
            std::printf("[SESSION] %s (connection %u) still held a body at spawn; removing it\n",
                        session.username.c_str(), static_cast<unsigned>(session.connection));
        }
        despawnPlayer(session, true);
        // A split with no active half to end it through, should one ever exist.
        endSplit(session, clockMillis_, false);
    }

    // Where a player appears is a property of the MAP, not of the player.
    // Level deliberately does not enter into it: picking a zone by tier reads
    // as if a high-level flower should start in high-tier ground, and what it
    // actually does is drop everyone into the mythic band in the middle of the
    // world, which nothing can walk out of.
    // The candidate has to be clear of the mobs standing on it, not only of
    // the walls: the reference refuses a spawn point that overlaps a body or
    // that has more than a handful of mobs within 200 units, which is what
    // stops a fresh flower materialising inside a swarm.
    const Realm realm = spawnRealmFor(session);
    Vec2 spawn;
    if (realm == kAdminArenaRealm) {
        spawn = terrain_->findOpenSpawn(rng_, terrain_->spawnPoint(realm), kTileSize, realm);
    } else if (realm == Realm::Arena) {
        spawn = kArenaSpawn;
    } else if (realm == Realm::Maze) {
        // Inside the entrance room, jittered so a party does not stack on one
        // point (src/server/playerManager.ts:168-179), and on floor whatever
        // the jitter did.
        spawn = terrain_->findOpenSpawn(rng_, activeMaze().spawn(), kMazeCellSize * 0.3, realm);
    } else {
        std::vector<MobDisc> blockers;
        collectSpawnBlockers(realm, blockers);
        const SpawnChoice* choice = chosenDoor(session);
        const MapData* map = worldMaps_.forRealm(realm);
        // The chosen rectangle first; its own map's default when the rectangle
        // is walled over or crowded; the overworld's default when the player
        // chose nothing at all.
        if (choice == nullptr || map == nullptr ||
            !map->spawnAt(worldMaps_.maps()[static_cast<std::size_t>(worldMapSlot(realm))]
                              .elements()[static_cast<std::size_t>(choice->element)]
                              .spawnId,
                          rng_, *terrain_, spawn, &blockers)) {
            const MapData* fallback = map != nullptr ? map : worldMaps_.forRealm(Realm::Overworld);
            spawn = fallback != nullptr ? fallback->defaultSpawn(rng_, *terrain_, &blockers)
                                        : terrain_->spawnPoint(realm);
        }
    }

    // The realm is settled on the session BEFORE the account is applied, and
    // the arena's scratch record with it: applyAccountToEntity reads both.
    session.realm = realm;
    session.arena.reset();
    if (realm == Realm::Arena) session.arena = startArenaRun(database_.progress(session.userId));
    if (realm == kAdminArenaRealm) applyHostedKit(session);
    else { session.eventKit.reset(); session.eventRestricted.reset(); }

    const Entity entity = createPlayerBody(session, realm, spawn);

    // A FRESH body only: full health and the respawn window. createPlayerBody
    // must never do either -- a splitter's second body is built by it too, and
    // it inherits what the flower it was cut from was carrying.
    Health& health = world_.get<Health>(entity);
    health.current = health.max;
    health.invulnerableUntilMillis = monotonicMillis() + kRespawnInvulnerabilitySeconds * 1000.0;

    session.entity = entity;
    session.stage = SessionStage::Playing;
    // Same person, new body: whatever the last one did to a mob that is still
    // standing is this one's now, so a boss it softened up before dying is
    // still credited to them when it falls -- the line names them, not
    // nobody, and the gallery, XP and drops count them in. Only for the
    // account that body played for.
    if (session.lastBody != NULL_ENTITY && !session.userId.empty() &&
        session.lastBodyUserId == session.userId) {
        handOverCredit(session.lastBody, entity);
    }
    session.lastBody = NULL_ENTITY;
    session.lastBodyUserId.clear();
    // A fresh body has a death of its own still to announce.
    session.deathReported = false;
    // And a fresh life owes nothing to the last one's losses: a splitter on
    // the bar cuts this body in two on the next tick.
    session.splitReadyAtMillis = 0;
    // A player picks their door on the title screen, and a squad they joined
    // before going back to it is a squad they may now be standing three
    // biomes away from. This is the hole the join-time checks cannot close,
    // because nothing about the join goes through them.
    enforceSquadBiome(squadIdOf(session));
    // The roster carries WIRE IDS, and this player just acquired a new one.
    // Without this a squadmate's dot and party bar stay pinned to the body
    // they had before they died.
    if (const Squad* squad = squads_.forMember(squadIdOf(session))) broadcastSquadUpdate(*squad);
    return entity;
}

Entity GameServer::createPlayerBody(Session& session, Realm realm, Vec2 spawn) {
    const Entity entity = world_.create();
    world_.add<PlayerTag>(entity);
    world_.add<Transform>(entity, Transform{spawn, 0.0, realm});
    world_.add<Motion>(entity);
    world_.add<Knockback>(entity);
    // In the ring players are hostile to each other; everywhere else they are
    // not. Petals and pets copy this Faction, so the whole kit follows.
    world_.add<Faction>(entity, Faction{Team::Players, realm == Realm::Arena || (realm == kAdminArenaRealm && hostedArenaPvp_)});
    if(realm==kAdminArenaRealm)world_.get<Faction>(entity).hostedTeam=hostedTeamFor(session);
    if (realm == Realm::Arena) world_.add<ArenaScore>(entity);
    world_.add<PlayerInput>(entity);
    world_.add<PlayerLocation>(entity);
    world_.add<PlayerModifiers>(entity);
    world_.add<PlayerVisuals>(entity);
    world_.add<PlayerSkillTree>(entity);
    world_.add<Loadout>(entity);
    world_.add<PetalRing>(entity);
    // A flower's body damages mobs on contact in the TypeScript server. The
    // zero interval means every separated re-contact may land; the fixed
    // 25-unit bump normally prevents it from becoming a per-tick damage beam.
    world_.add<ContactDamage>(entity, ContactDamage{kPlayerBaseDamage, 0.0});
    world_.add<HitCooldowns>(entity);
    world_.add<Afflictions>(entity);
    world_.add<ShieldState>(entity);
    // The nameplate carries the flower's name, which is what the title screen
    // asked for; the account name stays on the session for chat and for saves.
    world_.add<PlayerAccount>(entity,
                              PlayerAccount{session.userId, session.nameplate(),
                                            session.connection, session.admin});

    const PlayerRecord& record = liveRecord(session);
    applyAccountToEntity(record, entity);

    world_.add<NetId>(entity, NetId{netIds_.next()});
    Replicated replicated;
    replicated.kind = net::EntityKind::Player;
    world_.add<Replicated>(entity, replicated);
    return entity;
}

void GameServer::applyAccountToEntity(const PlayerRecord& record, Entity entity) {
    // Which realm the body is in decides which of the account's tracks it
    // plays on: the maze has its own XP and its own tree
    // (src/server/playerManager.ts:198-245), and the ring has a flat health
    // pool with talents switched off (src/server/playerManager.ts:812-824).
    const Transform* transform = world_.tryGet<Transform>(entity);
    const Realm realm = transform != nullptr ? transform->realm : Realm::Overworld;
    const bool maze = realm == Realm::Maze;
    const SkillSet& skills = maze ? record.mazeSkills : record.skills;

    // XP is seeded from the account ONCE, when the body is built. After that
    // the body is the authority: kills pay the live component, and the record
    // only catches up when persistPlayer runs -- every 30 seconds, on death
    // and on leave. Re-seeding here, which every loadout edit and swap does,
    // rewound the flower to its last save: a level gained since then was
    // shown for a few frames and taken back, and the next save wrote the
    // rewound figure over the XP for good.
    const bool fresh = !world_.has<PlayerProgress>(entity);
    PlayerProgress& state = world_.ensure<PlayerProgress>(entity);
    if (fresh) {
        state.totalXp = maze ? record.mazeTotalXp : record.totalXp;
        state.level = levelFromTotalXp(state.totalXp).level;
    }
    state.stars = record.stars;
    // Copied out: the ensure<>() calls below can move this row to another
    // archetype and leave `state` pointing at whatever took its slot.
    const int level = state.level;

    // Cosmetic skin bits are account data, and so is the worn custom skin --
    // the body is rebuilt on every respawn, so without this line a player who
    // dies comes back a plain flower. The temporary glitch bit stays on
    // PlayerVisuals and is intentionally not reset by a loadout edit.
    PlayerVisuals& cosmetics = world_.ensure<PlayerVisuals>(entity);
    cosmetics.renderFlags = record.renderFlags;
    cosmetics.equippedSkinId = record.equippedSkinId;

    // The tree is copied onto the body so the tick never reaches into storage.
    // Every path that changes it -- login, respawn, buying a tier, a reset --
    // comes back through here, which is what keeps the two in step.
    world_.ensure<PlayerSkillTree>(entity).skills = skills;

    Body& body = world_.ensure<Body>(entity);
    body.radius = playerRadiusForLevel(level);
    body.mass = 1.0;

    Health& health = world_.ensure<Health>(entity);
    const double previousFraction = health.max > 0 ? health.current / health.max : 1.0;
    health.max = realm == Realm::Arena
                     ? kArenaMaxHealth
                     : maxHealthForLevel(level) * skills.statScale(SkillId::PlayerHealth);
    // Preserve the FRACTION across a max-health change, so levelling up mid
    // fight neither heals you to full nor leaves you proportionally worse off.
    //
    // Clamped DOWNWARD only. This function also runs on every loadout edit and
    // every talent purchase, including ones sent from the death screen -- the
    // client keeps its panels live there and a corpse keeps its session. A
    // rescue that read "empty means full" would refill a dead flower's health
    // bar in front of everyone watching it, and arming respawn protection here
    // would hand out three seconds of immunity for the price of swapping two
    // empty loadout slots, over and over. Both belong to a fresh body, so both
    // live in spawnPlayer.
    health.current = clamp(health.max * clamp(previousFraction, 0.0, 1.0), 0.0, health.max);

    world_.ensure<ContactDamage>(entity).amount = bodyDamageForLevel(level);
    world_.get<ContactDamage>(entity).intervalMillis = 0.0;

    Loadout& loadout = world_.ensure<Loadout>(entity);
    for (std::size_t i = 0; i < kLoadoutSlots; ++i) {
        const WornSlot worn = wornSlot(record, i, realm);
        loadout.slots[i].configIndex = worn.petalIndex;
        loadout.slots[i].rarity = worn.rarity;
        // `broken` and `reloadReadyAtMillis` are deliberately NOT touched. They
        // are the ring's own bookkeeping: the petal pass arms a full reload on
        // any slot whose contents changed and leaves an unchanged one alone, so
        // clearing them here would wipe the timer of a slot the player did not
        // touch, and would make re-equipping the same petal over one that just
        // broke a way to dodge its reload entirely.
    }
}

void GameServer::applyAccountToSession(Session& session) {
    enforceHostedRules(session);
    const PlayerRecord& record = liveRecord(session);
    for (const Entity body : bodiesOf(session)) {
        if (body != NULL_ENTITY && world_.isAlive(body)) applyAccountToEntity(record, body);
    }
}

void GameServer::persistPlayer(const Session& session) {
    if (session.eventKit) return;
    if (!session.playing() || !world_.isAlive(session.entity)) return;
    const PlayerProgress* progress = world_.tryGet<PlayerProgress>(session.entity);
    if (!progress) return;

    PlayerRecord& record = database_.progress(session.userId);
    // Onto the track the body was playing on: a maze run's XP is the maze's,
    // and writing it into totalXP would destroy the outside level
    // (src/server/playerManager.ts:975-978).
    if (session.realm == Realm::Maze) record.mazeTotalXp = progress->totalXp;
    else record.totalXp = progress->totalXp;
    record.stars = progress->stars;
    database_.markDirty();
}

void GameServer::despawnPlayer(Session& session, bool persist) {
    session.marketAccess=false;
    if (session.entity == NULL_ENTITY) return;
    // Control needs a flower at both ends, so the body going is the end of
    // any this session is part of: whoever was steering it is put back on
    // their own flower and told why, and a flower this one was steering is
    // handed back to its player. Through the back-references, and while the
    // body still exists to be parked and named.
    endControlOf(session, "left the world", true);
    // The other half first, and with no reload armed: the body it would have
    // been armed on is about to be destroyed as well, and the split is ending
    // because the PLAYER is leaving, not because a flower was lost.
    endSplit(session, clockMillis_, false);
    if (persist) persistPlayer(session);
    // Leaving the ring, by any door, is the end of the run.
    if (session.arena) endArenaRun(session);
    session.eventKit.reset();
    session.eventRestricted.reset();
    session.realm = Realm::Overworld;

    // Remembered past its destruction: the mobs it hurt still have it on their
    // ledgers, and the next body takes those rows over. After endSplit, which
    // has already moved the other half's rows onto this one.
    session.lastBody = session.entity;
    session.lastBodyUserId = session.userId;

    // The petals and pets belong to the body, not the account, so they go
    // with it.
    destroyBody(session.entity);

    session.entity = NULL_ENTITY;
    session.stage = SessionStage::Authenticated;
    views_[session.connection].reset();
    // Same reason as the spawn: the id this member was known by is gone, and a
    // roster still naming it points every squadmate's HUD at nothing.
    if (const Squad* squad = squads_.forMember(squadIdOf(session))) broadcastSquadUpdate(*squad);
}

void GameServer::dropBody(Session& session) {
    // Saved only while Playing (persistPlayer's own rule), but taken out
    // whenever a body is held at all: nothing names a body once its session
    // has stopped naming it, and one left behind would stand in the world for
    // nobody, streamed to everyone near it, until something killed it. The
    // stage and the body agree on every path there is; this is what keeps one
    // that some day does not from leaking a flower per connection.
    if (session.playing()) persistPlayer(session);
    if (session.entity != NULL_ENTITY) despawnPlayer(session, false);
}

void GameServer::destroyBody(Entity body) {
    if (body == NULL_ENTITY || !world_.isAlive(body)) return;
    // The ring is on the Loadout; the pets are on the SLOT STATE, and the only
    // other thing that ever walks those is the ring pass recalling a downed
    // flower's summons (PetalSystem::clearRing). A body destroyed while it was
    // standing is never down, so without this its pets outlived it with a
    // dangling owner -- and an ownerless pet wanders for good.
    //
    // Destroyed, not killed, exactly as a recall does it: nothing dies here,
    // so nothing raises a death event or drops anything. A handle the world
    // already reaped is harmless: handles are generational.
    if (const Loadout* loadout = world_.tryGet<Loadout>(body)) {
        for (const Entity petal : loadout->spawned) commands_.destroy(petal);
    }
    if (const PetalSlotState* state = world_.tryGet<PetalSlotState>(body)) {
        for (const PetalSlotState::Slot& slot : state->slots) {
            for (const Entity pet : slot.pets) commands_.destroy(pet);
        }
    }
    commands_.destroy(body);
}

void GameServer::handOverCredit(Entity from, Entity to) {
    if (from == NULL_ENTITY || to == NULL_ENTITY || from == to) return;
    Query<Bounty> ledgers{world_};
    ledgers.each([&](Entity, Bounty& bounty) {
        Bounty::handOver(bounty.contributors, from, to);
    });
    // The snapshot a wave nest weighs its ledger against moves with it, or the
    // whole inherited row reads as damage landed this tick and the next wave
    // turns on a flower that has not touched the nest.
    Query<NestWaves> nests{world_};
    nests.each([&](Entity, NestWaves& waves) {
        Bounty::handOver(waves.ledgerSeen, from, to);
    });
}

} // namespace flix
