// The splitter petal: one connection, two flowers.
//
// The browser build (src/petal_actions.ts) makes this a CONSUMABLE. You press
// U with the slot's number to "use" the petal: the first use clones your
// flower, every later one hands control to the other clone. That is three
// things wrong at once -- nothing happens when you equip it, the chord is
// undiscoverable, and the reload the tooltip advertises is never paid.
//
// Here the petal is worn, not used:
//
//   * EQUIPPING IT SPLITS YOU, at once and for nothing. The service below runs
//     every tick and reconciles "is a splitter on the bar" against "does this
//     session have two bodies", so the split follows the loadout rather than a
//     message. Taking it off merges you back.
//   * CLICKING THE LOADED PETAL swaps which half you are steering, and spends
//     the slot. That is where the reload is paid, so switching is rationed and
//     wearing it is not.
//   * THE CUT IS THE PETAL'S OWN. Its artwork is a flower clipped along a
//     jagged vertical line -- the left half of a face -- so the two bodies are
//     placed on either side of that line: one left, one right, the flower
//     opened along the seam the icon draws.
//
// Two bodies on one connection is the invariant everything here protects. They
// share one account record (so there is no loadout to keep in step and no way
// to duplicate one, which is what the browser build's per-body clone did),
// they cannot hurt each other, they rank as ONE person for loot and XP, and
// they are each other's only squadmates -- a split flower may not join anyone
// else's squad while it is two flowers.

#include "server/game_server.h"

#include <algorithm>
#include <cmath>
#include <string>

#include "server/systems/petals.h"
#include "shared/game/config.h"
#include "shared/game/constants.h"
#include "shared/game/terrain.h"

namespace flix {

namespace {

/// How far each half is carried off the cut line, as a multiple of the body's
/// own radius.
///
/// One radius each way, so the two bodies stand edge to edge with the seam
/// between them: any less and the split is invisible under the flowers, any
/// more and they read as two flowers that happened to appear together rather
/// than as one that came apart. The cut itself is vertical because the petal's
/// artwork is, which is also why the halves are a LEFT and a RIGHT one.
constexpr double kSplitSeparationRadii = 1.0;

/// Whether this body is gone, or a corpse waiting on the reaper.
bool bodyFinished(const World& world, Entity body) {
    if (body == NULL_ENTITY || !world.isAlive(body)) return true;
    if (world.has<Dead>(body)) return true;
    const Health* health = world.tryGet<Health>(body);
    return health != nullptr && !health->alive();
}

} // namespace

std::array<Entity, 2> GameServer::bodiesOf(const Session& session) const {
    return {session.entity, session.splitOther};
}

int GameServer::splitterSlotOf(Entity body) const {
    if (body == NULL_ENTITY || !world_.isAlive(body)) return -1;
    const Loadout* loadout = world_.tryGet<Loadout>(body);
    if (loadout == nullptr) return -1;
    for (int i = 0; i < kLoadoutActiveSlots; ++i) {
        const LoadoutSlot& slot = loadout->slots[static_cast<std::size_t>(i)];
        // A slot serving its cooldown is still EQUIPPED. Reading a reloading
        // splitter as "not worn" would merge the flower back together the
        // instant it switched halves, which is the one moment it must not.
        if (!slot.empty() && content().petal(slot.configIndex).id == kSplitterPetalId) return i;
    }
    return -1;
}

void GameServer::parkBody(Entity body) {
    if (body == NULL_ENTITY || !world_.isAlive(body)) return;
    // An empty frame rather than no frame: movement reads PlayerInput every
    // tick, and only the ACTIVE half is ever written by handleInput. Left
    // holding the heading it was abandoned with, the parked flower walks that
    // way forever -- through mobs, over teleporters and into walls.
    if (PlayerInput* input = world_.tryGet<PlayerInput>(body)) {
        const net::InputFrame previous = input->current;
        input->current = net::InputFrame{};
        // The sequence is kept so the client's own reconciliation does not see
        // the acknowledgement run backwards if this half is switched back to.
        input->current.sequence = previous.sequence;
        input->current.aimAngle = previous.aimAngle;
        input->aimDirection = Vec2::fromAngle(previous.aimAngle);
    }
    if (Motion* motion = world_.tryGet<Motion>(body)) motion->velocity = {0, 0};
    if (Knockback* knockback = world_.tryGet<Knockback>(body)) knockback->impulse = {0, 0};
}

void GameServer::armSplitterReload(const Session& session, double nowMillis) {
    // Spend it wherever it can be spent -- that is what takes the petal off
    // the ring and starts the timer.
    double deadline = 0;
    for (const Entity body : bodiesOf(session)) {
        if (body == NULL_ENTITY || !world_.isAlive(body)) continue;
        const int slot = splitterSlotOf(body);
        if (slot < 0) continue;
        petals_->spendSlot(world_, content(), body, static_cast<std::uint8_t>(slot), nowMillis);
        const Loadout* loadout = world_.tryGet<Loadout>(body);
        if (loadout != nullptr) {
            deadline = std::max(deadline,
                                loadout->slots[static_cast<std::size_t>(slot)].reloadReadyAtMillis);
        }
    }
    if (deadline <= 0.0) return;

    // Then hold BOTH halves to the later of the two deadlines.
    //
    // The two bodies were born a tick or two apart, so their slots come off
    // their equip cooldowns a tick or two apart -- and a spend refuses a slot
    // that is already reloading, which left the half being switched TO holding
    // a timer that lapsed on the next tick. The player could then switch
    // straight back, and the cooldown the switch is supposed to cost was a
    // single frame. The halves wear ONE logical loadout; this is the slot
    // where that has to be true on the clock as well as in the contents.
    for (const Entity body : bodiesOf(session)) {
        if (body == NULL_ENTITY || !world_.isAlive(body)) continue;
        const int slot = splitterSlotOf(body);
        if (slot < 0) continue;
        Loadout& loadout = world_.get<Loadout>(body);
        LoadoutSlot& entry = loadout.slots[static_cast<std::size_t>(slot)];
        entry.broken = true;
        entry.reloadReadyAtMillis = std::max(entry.reloadReadyAtMillis, deadline);
    }
}

void GameServer::syncSplitProgress(const Session& session) {
    if (!session.split()) return;
    PlayerProgress* mine = world_.tryGet<PlayerProgress>(session.entity);
    PlayerProgress* theirs = world_.tryGet<PlayerProgress>(session.splitOther);
    if (mine == nullptr || theirs == nullptr) return;

    // XP and stars are credited to the BODY that earned them and there are two
    // of them, so without this a switch rewinds the player to whatever the
    // other half had banked and the save writes back whichever one happened to
    // be active. The higher of the two wins, and the two quantities are
    // levelled SEPARATELY: a kill can pay stars to one half and XP to the
    // other, and following one of them would drag the other backwards.
    //
    // Safe because neither figure ever falls on its own. XP only grows, and a
    // star balance only drops through the shop or a code -- which write the
    // ACCOUNT and are pushed onto both bodies by applyAccountToSession, so the
    // two agree again before this is next asked.
    const double xp = std::max(mine->totalXp, theirs->totalXp);
    const double stars = std::max(mine->stars, theirs->stars);
    if (mine->totalXp == xp && theirs->totalXp == xp && mine->stars == stars &&
        theirs->stars == stars) {
        return;
    }
    mine->stars = stars;
    theirs->stars = stars;
    PlayerProgress* behind = mine->totalXp < xp ? mine : theirs;
    if (behind->totalXp >= xp) return;
    behind->totalXp = xp;

    const int level = levelFromTotalXp(behind->totalXp).level;
    if (level == behind->level) return;
    // A level the body did not earn for itself still has to reach its stats,
    // or the parked half comes back at the old size with the old pool. The
    // same three the level-up path writes, and no heal: this body did not
    // level up, it was told what the account's level is.
    behind->level = level;
    const Entity body = behind == mine ? session.entity : session.splitOther;
    const PlayerModifiers* modifiers = world_.tryGet<PlayerModifiers>(body);
    const PlayerSkillTree* tree = world_.tryGet<PlayerSkillTree>(body);
    const Transform* at = world_.tryGet<Transform>(body);
    const bool arena = at != nullptr && at->realm == Realm::Arena;
    if (Health* health = world_.tryGet<Health>(body)) {
        const double fraction = health->max > 0 ? health->current / health->max : 1.0;
        health->max = arena ? kArenaMaxHealth
                            : maxHealthForLevel(level) *
                                  (tree != nullptr ? tree->skills.statScale(SkillId::PlayerHealth)
                                                   : 1.0) *
                                  (modifiers != nullptr ? modifiers->maxHealthScale : 1.0);
        health->current = clamp(health->max * clamp(fraction, 0.0, 1.0), 0.0, health->max);
    }
    if (Body* shape = world_.tryGet<Body>(body)) shape->radius = playerRadiusForLevel(level);
    if (ContactDamage* contact = world_.tryGet<ContactDamage>(body)) {
        contact->amount = bodyDamageForLevel(level) +
                          (modifiers != nullptr ? modifiers->bodyDamageBonus : 0.0);
    }
}

bool GameServer::splitSession(Session& session) {
    if (session.split() || !session.playing()) return false;
    // Never in the PVP ring. A run in there plays on a scratch account with a
    // fixed starter ring, so no splitter can be worn and this cannot fire --
    // but a run's death is settled through the session, and a half dying under
    // the transfer below would hand the ring's score and bag to nobody. Said
    // out loud rather than left to the loadout to prevent.
    if (session.arena || session.realm == Realm::Arena) return false;
    const Transform* origin = world_.tryGet<Transform>(session.entity);
    if (origin == nullptr) return false;

    // Along the petal's own cut: its icon is a flower clipped by a jagged line
    // running top to bottom, so the seam is vertical and the halves go left
    // and right of it.
    //
    // Everything the original body is asked for is COPIED OUT here, before a
    // single entity is built. Adding a component moves a row between
    // archetypes and can reallocate the column it came from, so a pointer held
    // across createPlayerBody() below is a pointer into whatever ended up in
    // that slot -- which is how the second flower came out standing somewhere
    // nobody could see.
    const Body* shape = world_.tryGet<Body>(session.entity);
    const double reach = (shape != nullptr ? shape->radius : kPlayerBaseRadius) *
                         kSplitSeparationRadii;
    const Realm realm = origin->realm;
    const Vec2 centre = origin->position;
    const double facing = origin->angle;
    const Health* wounded = world_.tryGet<Health>(session.entity);
    const double healthFraction = wounded != nullptr ? wounded->fraction() : 1.0;
    const double invulnerableUntil = wounded != nullptr ? wounded->invulnerableUntilMillis : 0.0;
    const PlayerProgress* earned = world_.tryGet<PlayerProgress>(session.entity);
    const PlayerProgress progress = earned != nullptr ? *earned : PlayerProgress{};
    Vec2 left{centre.x - reach, centre.y};
    Vec2 right{centre.x + reach, centre.y};
    // A seam that puts either half inside a wall is not a seam: that half
    // stays where the flower was standing, and the ordinary body separation
    // pushes the pair apart on the next tick. Tested on the CENTRE alone --
    // the flower already fits where it is standing, and a swept test that
    // refused every seam touching a wall would refuse most of the maze.
    if (terrain_->blocked(left, realm)) left = centre;
    if (terrain_->blocked(right, realm)) right = centre;

    const Entity clone = createPlayerBody(session, realm, right);
    if (clone == NULL_ENTITY) return false;

    // ONE FLOWER CUT IN TWO, not a second flower issued free. The clone
    // carries the health the original was standing at, in the same proportion
    // -- splitting at a sliver gives you two slivers -- and inherits whatever
    // respawn protection was still running rather than being granted its own.
    if (Health* theirs = world_.tryGet<Health>(clone)) {
        theirs->current = clamp(theirs->max * healthFraction, 0.0, theirs->max);
        theirs->invulnerableUntilMillis = invulnerableUntil;
    }
    if (PlayerProgress* theirs = world_.tryGet<PlayerProgress>(clone)) {
        theirs->totalXp = progress.totalXp;
        theirs->level = progress.level;
        theirs->stars = progress.stars;
    }
    if (Transform* theirs = world_.tryGet<Transform>(clone)) theirs->angle = facing;

    // Re-fetched, never the pointer taken above: see the note there.
    if (Transform* moved = world_.tryGet<Transform>(session.entity)) moved->position = left;
    session.splitOther = clone;
    parkBody(clone);

    // A SPLIT FLOWER SQUADS WITH ITSELF AND NOBODY ELSE. Whatever party it was
    // in is left on the way in -- one person steering two bodies through
    // somebody else's four-flower cap is not a party -- and a private squad of
    // its own takes its place, so the client's party HUD carries the other
    // half's bar and the minimap its dot. Every door back into a squad is
    // refused while it is split (splitSquadRefusal).
    net::Connection* connection = listener_.find(session.connection);
    if (squads_.forMember(squadIdOf(session)) != nullptr) {
        departSquad(session, connection, squadDisplayName(squadIdOf(session)));
    }
    if (connection != nullptr) {
        if (Squad* own = squads_.create(squadIdOf(session), false, rng_)) {
            sendSquadUpdate(*connection, own);
        }
    }
    return true;
}

void GameServer::endSplit(Session& session, double nowMillis, bool armReload) {
    if (!session.split()) return;
    const Entity parked = session.splitOther;
    session.splitOther = NULL_ENTITY;
    if (armReload) {
        armSplitterReload(session, nowMillis);
        // And hold the split itself off for the same cooldown. The slot's own
        // flag cannot do this job: a slot serves a full reload whenever its
        // contents change, login included, so gating the split on it would
        // charge ten seconds for merely equipping the petal.
        const int slot = splitterSlotOf(session.entity);
        const Loadout* loadout = world_.tryGet<Loadout>(session.entity);
        session.splitReadyAtMillis =
            slot >= 0 && loadout != nullptr
                ? loadout->slots[static_cast<std::size_t>(slot)].reloadReadyAtMillis
                : nowMillis;
    }

    // A body still standing is taken out of the world outright; a corpse is
    // left to the reaper, which is already holding it and now finds it owned
    // by nobody -- so it takes the ring with it and announces nothing, which
    // is right for the DEATH CARD (the person is not dead, one of their halves
    // is) and wrong for the pop. Say the pop here, once, while the body is
    // still ours to name: a flower that came apart in front of you and then
    // simply stopped existing reads as a dropped frame.
    if (world_.isAlive(parked) && !world_.has<Dead>(parked)) {
        if (const Loadout* loadout = world_.tryGet<Loadout>(parked)) {
            for (const Entity petal : loadout->spawned) commands_.destroy(petal);
        }
        commands_.destroy(parked);
    } else if (world_.isAlive(parked) && world_.has<NetId>(parked)) {
        const Transform* at = world_.tryGet<Transform>(parked);
        events_.killed(world_.get<NetId>(parked).value, at != nullptr ? at->position : Vec2{},
                       at != nullptr ? at->realm : Realm::Overworld);
    }

    // The squad the split made for itself goes with it. Nobody else can be in
    // one -- every door is refused while split -- so leaving is a disband.
    net::Connection* connection = listener_.find(session.connection);
    if (squads_.forMember(squadIdOf(session)) != nullptr) {
        departSquad(session, connection, squadDisplayName(squadIdOf(session)));
    }
}

void GameServer::switchSplitHalf(Session& session, double nowMillis) {
    if (!session.split()) return;
    // Spent on BOTH halves, so the bar reads the same cooldown whichever body
    // is being steered and a switch back costs the same as a switch out.
    armSplitterReload(session, nowMillis);

    parkBody(session.entity);
    std::swap(session.entity, session.splitOther);

    // The client learns which flower is its own from the SELF FLAG on a spawn
    // record, and it already holds both of these bodies -- so nothing in the
    // ordinary delta stream could ever tell it the camera moved. Resetting the
    // view restates everything in reach from first sight, with the flag on the
    // other body this time, and the arrival snaps the camera instead of gliding
    // it across the map. It is the same message a teleporter sends, for the
    // same reason.
    const Transform* arrived = world_.tryGet<Transform>(session.entity);
    session.realm = arrived != nullptr ? arrived->realm : session.realm;
    sendRealmChange(session, arrived != nullptr ? arrived->position : Vec2{});

    // The roster carries wire ids and the two halves have just swapped places
    // in it, so the party HUD would otherwise point at the body the player is
    // now standing in and call it their squadmate.
    if (const Squad* squad = squads_.forMember(squadIdOf(session))) broadcastSquadUpdate(*squad);
}

void GameServer::serviceSplitters(double nowMillis) {
    for (auto& entry : sessions_) {
        Session& session = entry.second;
        if (!session.playing()) continue;

        if (session.split()) {
            const bool activeGone = bodyFinished(world_, session.entity);
            const bool parkedGone = bodyFinished(world_, session.splitOther);
            if (activeGone && !parkedGone) {
                // The steered half died and the other one is still standing.
                // The person is not dead -- they are the flower that is left
                // -- so control passes to it BEFORE the reaper meets the
                // corpse, which is what stops a death card being put up over a
                // body the player is no longer in. The corpse is then owned by
                // nobody and the reaper clears it away silently.
                const Entity corpse = session.entity;
                session.entity = session.splitOther;
                session.splitOther = corpse;
                endSplit(session, nowMillis, true);
                const Transform* at = world_.tryGet<Transform>(session.entity);
                session.realm = at != nullptr ? at->realm : session.realm;
                sendRealmChange(session, at != nullptr ? at->position : Vec2{});
                if (const Squad* squad = squads_.forMember(squadIdOf(session))) {
                    broadcastSquadUpdate(*squad);
                }
                continue;
            }
            if (parkedGone) {
                // Only the spare is gone: the split simply ends, and the
                // splitter pays a reload so the spare is not replaced on the
                // next tick. Whoever killed it got a flower, not a free one.
                endSplit(session, nowMillis, true);
                continue;
            }
        }

        if (bodyFinished(world_, session.entity)) continue;
        const int slot = splitterSlotOf(session.entity);

        if (session.split()) {
            // Taken off the bar: the halves come back together. The one left
            // is the one being steered, wherever the other was parked.
            if (slot < 0) {
                endSplit(session, nowMillis, false);
                continue;
            }
            parkBody(session.splitOther);
            syncSplitProgress(session);
            continue;
        }

        if (slot < 0) continue;
        // EQUIPPING IT IS ENOUGH. Not "equipping it and then waiting out the
        // slot's reload": every slot serves one the moment its contents change
        // -- that is what stops a swapped-in spare from dodging a cooldown --
        // and honouring it here would make the petal's own advertised effect
        // cost ten seconds every time it was put on. The only thing that ever
        // holds a split off is a half having just been LOST.
        if (nowMillis < session.splitReadyAtMillis) continue;
        splitSession(session);
    }
}

void GameServer::handleUsePetal(Session& session, ByteReader& reader) {
    const std::uint8_t slot = reader.u8();
    if (!reader.ok() || !session.playing()) return;
    // Budgeted with input rather than with chat: a click on the bar is a
    // gameplay action, and a client that sends nothing else can still send
    // these as fast as it likes.
    if (!spend(session.inputAllowance)) return;
    if (slot >= kLoadoutActiveSlots) return;

    const Loadout* loadout = world_.tryGet<Loadout>(session.entity);
    if (loadout == nullptr) return;
    const LoadoutSlot& entry = loadout->slots[slot];
    if (entry.empty()) return;
    // Only the petals that DO something when they are used answer to this, and
    // only while the slot is loaded. Both are re-asked here rather than
    // trusted from the bar: the client decides what to draw, the server decides
    // what happens.
    if (!petalIsClickToUse(content().petal(entry.configIndex))) return;
    if (entry.broken) return;

    // A splitter that has not split yet is doing its job on the tick clock --
    // the service above splits on equip -- so a click before that lands has
    // nothing to switch to and must not spend the slot for it.
    if (!session.split()) return;
    switchSplitHalf(session, clockMillis_);
}

std::string GameServer::splitSquadRefusal(SquadMemberId who, const std::string& whoLabel) const {
    if (who.bot()) return {};
    const auto it = sessions_.find(who.connection);
    if (it == sessions_.end() || !it->second.split()) return {};
    return whoLabel + " split in two. A split flower squads with itself until the splitter "
                      "comes off the bar.";
}

} // namespace flix
