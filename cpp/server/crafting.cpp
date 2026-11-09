// Turning petals into other petals: the crafting table, and the NPCs that
// trade in them -- the oracle, the trader, the assemblers and the titan, with
// its one-of-each universals.

#include "server/game_server.h"

#include <algorithm>
#include <cstdio>
#include <functional>
#include <optional>
#include <random>
#include <unordered_map>
#include <utility>

#include "server/game_server_internal.h"
#include "server/systems/combat.h"
#include "server/systems/npcs.h"
#include "server/text.h"
#include "shared/game/absorb.h"
#include "shared/game/config.h"

namespace flix {

namespace {

/// The batch a craft consumes.
constexpr int kCraftBatch = 5;

/// Whether the account holds `petalIndex` at universal anywhere: in the bag
/// or worn in a loadout slot. One of each petal may exist at universal, and
/// both are where it can be.
bool holdsUniversal(const PlayerRecord& record, std::uint16_t petalIndex) {
    if (petalIndex == kNoPetal) return false;
    if (record.itemCount(Rarity::Universal, inventoryKey(petalIndex)) > 0) return true;
    const std::string& id = content().petal(petalIndex).id;
    for (const std::optional<StoredItem>& slot : record.loadout) {
        if (slot.has_value() && slot->rarity == Rarity::Universal && slot->petalType == id) {
            return true;
        }
    }
    return false;
}

/// Rng as a standard bit generator, which is all the <random> distributions
/// ask of one.
struct RngBits {
    Rng& rng;
    using result_type = std::uint64_t;
    static constexpr result_type min() { return 0; }
    static constexpr result_type max() { return ~result_type{0}; }
    result_type operator()() { return rng.next(); }
};

/// How many of `trials` independent rolls at `chance` come up. Rolled one by
/// one while that is cheap; past that, one draw from the binomial they add up
/// to, which is the same number by a different road -- and a single draw
/// whether the trials are a hundred or four hundred million.
std::int64_t countSuccesses(Rng& rng, std::int64_t trials, double chance) {
    if (trials <= 0 || chance <= 0.0) return 0;
    if (chance >= 1.0) return trials;
    constexpr std::int64_t kRollOneByOne = 64;
    if (trials <= kRollOneByOne) {
        std::int64_t hits = 0;
        for (std::int64_t i = 0; i < trials; ++i) {
            if (rng.chance(chance)) ++hits;
        }
        return hits;
    }
    RngBits bits{rng};
    return std::binomial_distribution<std::int64_t>(trials, chance)(bits);
}

/// How long `userId` has left to wait in `readyAt` as of `now`, 0 when it
/// need not. A lapsed wait is forgotten on the way.
double waitLeft(std::unordered_map<std::string, double>& readyAt, const std::string& userId,
                double now) {
    const auto found = readyAt.find(userId);
    if (found == readyAt.end()) return 0.0;
    const double wait = found->second - now;
    if (wait > 0.0) return wait;
    readyAt.erase(found);
    return 0.0;
}

} // namespace

void GameServer::handleCraft(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::uint16_t petalIndex = reader.u16();
    const Rarity rarity = clampRarity(reader.u8());
    const std::uint32_t count = reader.u32();
    if (!reader.ok() || !session.authenticated()) return;

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::CraftResult));

    PlayerRecord& record = liveRecord(session);
    // Past kMaxStackCount is more than any stack holds, so it is refused as
    // short rather than narrowed into a number that might not be.
    const bool valid = count >= kCraftBatch &&
                       count <= static_cast<std::uint32_t>(kMaxStackCount) &&
                       craftsOutOf(rarity) && petalIndex < content().petalCount();
    if (!valid || !takeFromInventory(record, petalIndex, rarity, static_cast<int>(count))) {
        w.boolean(false);
        w.u16(petalIndex);
        w.u8(static_cast<std::uint8_t>(rarity));
        w.u32(0);
        w.u8(0);
        w.str("Not enough petals to craft.");
        connection.send(w);
        resyncProfile(session, connection);
        return;
    }

    // The whole request is crafted as one POOL rather than as one batch per
    // click: every attempt eats five, and the survivors a failure hands back
    // drop straight into the pool to be tried again, until fewer than five are
    // left. That is what makes the returns actually get crafted instead of
    // piling up in the inventory, and it is why the client plays one spin for
    // a staged xN. Bounded: an attempt removes five and returns at most four,
    // so the pool strictly shrinks.
    // Every equipped clover of the tier being crafted nudges the odds up. The
    // reference counts the PRIMARY ten slots only -- the storage row behind
    // them is not equipped and does not help -- and the bonus is stated in
    // percentage points against a 0..100 roll, which is five ten-thousandths
    // of the fraction this ladder is expressed in.
    constexpr double kCloverCraftBonus = 0.0005;
    const std::uint16_t clover = content().petalIndex("clover");
    int clovers = 0;
    if (clover != kInvalidIndex) {
        const std::size_t equipped =
            std::min<std::size_t>(record.loadout.size(), kLoadoutActiveSlots);
        for (std::size_t i = 0; i < equipped; ++i) {
            if (!record.loadout[i].has_value()) continue;
            const StoredItem& slot = *record.loadout[i];
            if (slot.rarity != rarity) continue;
            if (content().petalIndex(slot.petalType) == clover) ++clovers;
        }
    }
    const double chance =
        std::min(1.0, craftSuccessChance(rarity) + kCloverCraftBonus * clovers);

    // Rolled a ROUND at a time rather than an attempt at a time. Every attempt
    // costs at most five, so pool/5 attempts in a row are all affordable
    // however the earlier ones land -- which makes a round exactly that many
    // attempts, and only its totals matter. A failure keeps one to four of its
    // five evenly: a cost of 1 plus two fair bits (0..3), so `losses` failures
    // cost `losses`, plus twice one coin count, plus another. The same
    // distribution as rolling them singly, in a few dozen rounds rather than
    // the ~800 million single rolls a full stack would take -- which, on the
    // tick thread, was seconds of frozen server.
    std::int64_t pool = count;
    std::int64_t crafted = 0;
    while (pool >= kCraftBatch) {
        const std::int64_t attempts = pool / kCraftBatch;
        const std::int64_t wins = countSuccesses(rng_, attempts, chance);
        const std::int64_t losses = attempts - wins;
        const std::int64_t lost = losses + 2 * countSuccesses(rng_, losses, 0.5) +
                                  countSuccesses(rng_, losses, 0.5);
        pool -= wins * kCraftBatch + lost;
        crafted += wins;
    }
    // The sub-batch tail, 0..4, and at most a fifth of the request crafted:
    // both back inside an int.
    const int petalsReturned = static_cast<int>(pool);
    const int upgrades = static_cast<int>(crafted);

    if (petalsReturned > 0) giveToInventory(record, petalIndex, rarity, petalsReturned);
    if (upgrades > 0) giveToInventory(record, petalIndex, upgradeRarity(rarity), upgrades);
    database_.markDirty();

    if (upgrades > 0) announceRareCraft(session, petalIndex, upgradeRarity(rarity));

    w.boolean(upgrades > 0);
    w.u16(petalIndex);
    w.u8(static_cast<std::uint8_t>(upgrades > 0 ? upgradeRarity(rarity) : rarity));
    w.u32(static_cast<std::uint32_t>(upgrades));
    w.u8(static_cast<std::uint8_t>(petalsReturned));
    w.str(upgrades > 0 ? "" : "The craft failed.");
    connection.send(w);
    sendProfile(session, connection);
}

void GameServer::handleOracleCraft(Session& session, net::Connection& connection,
                                  ByteReader& reader) {
    const std::uint16_t petalIndex = reader.u16();
    const Rarity rarity = clampRarity(reader.u8());
    if (!reader.ok() || !session.authenticated()) return;

    const auto refuse = [&](const std::string& reason) {
        ByteWriter w;
        w.u8(static_cast<std::uint8_t>(net::ServerMessage::OracleResult));
        w.boolean(false);
        w.u16(petalIndex);
        w.u8(static_cast<std::uint8_t>(rarity));
        w.u16(0);
        w.u32(0);
        w.str(reason);
        connection.send(w);
    };

    if (serviceAtHand(session, NpcService::Oracle, "an oracle", refuse) == NULL_ENTITY) return;

    // Once per half hour, per ACCOUNT -- not per body or per connection.
    const double wait = oracleWaitMillis(session.userId);
    if (wait > 0.0) {
        refuse(oracleCooldownText(wait));
        return;
    }

    // One upgrade, no roll, nothing returned: the price is the whole
    // transaction. Apex and universal cost zero because nothing crafts out of
    // either, which is what refuses them here.
    const int cost = oracleCraftCost(rarity);
    if (cost <= 0 || petalIndex >= content().petalCount()) {
        refuse("The oracle cannot craft that.");
        return;
    }
    PlayerRecord& record = liveRecord(session);
    if (!takeFromInventory(record, petalIndex, rarity, cost)) {
        refuse("Not enough petals.");
        resyncProfile(session, connection);
        return;
    }
    const Rarity made = upgradeRarity(rarity);
    giveToInventory(record, petalIndex, made, 1);
    oracleReadyAt_[session.userId] = clockMillis_ + kOracleCooldownMillis;
    database_.markDirty();

    // A super bought is announced exactly as a super rolled is: the line is
    // about what exists now, not about how lucky anyone got.
    announceRareCraft(session, petalIndex, made);

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::OracleResult));
    w.boolean(true);
    w.u16(petalIndex);
    w.u8(static_cast<std::uint8_t>(made));
    w.u16(1);
    w.u32(static_cast<std::uint32_t>(cost));
    w.str("");
    connection.send(w);
    // The profile carries the new wait, which is what turns the panel's line
    // red the moment the upgrade has landed.
    sendProfile(session, connection);
}

Entity GameServer::serviceAtHand(const Session& session, NpcService service, const std::string& npc,
                                 const std::function<void(const std::string&)>& refuse,
                                 std::optional<Rarity> tier) {
    // An NPC is a creature standing somewhere, so the one thing a client
    // cannot do is ask it from anywhere else. Where the body IS decides, and
    // the NPC is found here rather than named on the wire: a client that
    // could name one could name one it is nowhere near. A corpse is not
    // standing at anything -- the death card is up, and the forge is still in
    // the menu.
    const bool standing = session.playing() && world_.isAlive(session.entity) &&
                          !world_.has<Dead>(session.entity);
    const Transform* body = standing ? world_.tryGet<Transform>(session.entity) : nullptr;
    if (body == nullptr) {
        refuse("You need to be standing at " + npc + ".");
        return NULL_ENTITY;
    }
    const Entity found = npcs_->findService(world_, service, body->position, body->realm,
                                            kNpcServiceReach + kNpcServiceSlack, tier);
    // "an oracle" is "the oracle" once there is one in sight.
    if (found == NULL_ENTITY) refuse("You are too far from the " + npc.substr(npc.find(' ') + 1) + ".");
    return found;
}

double GameServer::oracleWaitMillis(const std::string& userId) {
    return waitLeft(oracleReadyAt_, userId, clockMillis_);
}

void GameServer::handleTrade(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::uint16_t petalIndex = reader.u16();
    const Rarity rarity = clampRarity(reader.u8());
    if (!reader.ok() || !session.authenticated()) return;

    const auto refuse = [&](const std::string& reason) {
        ByteWriter w;
        w.u8(static_cast<std::uint8_t>(net::ServerMessage::TradeResult));
        w.boolean(false);
        w.u16(petalIndex);
        w.u8(static_cast<std::uint8_t>(rarity));
        w.u16(kNoPetal);
        w.str(reason);
        connection.send(w);
    };

    if (serviceAtHand(session, NpcService::Trader, "a trader", refuse) == NULL_ENTITY) return;

    // Once a day, per ACCOUNT.
    const double wait = traderWaitMillis(session.userId);
    if (wait > 0.0) {
        refuse(traderCooldownText(wait));
        return;
    }

    // The petals.json flag is the whole rule: every LADDER tier of a tradable
    // petal is taken, apex included, and the coin itself is marked untradable.
    // Never universal: a universal coin would be a universal nobody gave.
    const std::uint16_t coin = content().petalIndex(kTraderCoinPetal);
    if (petalIndex >= content().petalCount() || !content().petal(petalIndex).tradable ||
        rarityIndex(rarity) >= kLadderRarityCount || coin == kInvalidIndex) {
        refuse("The trader will not take that.");
        return;
    }
    PlayerRecord& record = liveRecord(session);
    if (!takeFromInventory(record, petalIndex, rarity, 1)) {
        refuse("You don't have that petal.");
        resyncProfile(session, connection);
        return;
    }
    giveToInventory(record, coin, rarity, 1);
    traderReadyAt_[session.userId] = clockMillis_ + kTraderCooldownMillis;
    database_.markDirty();

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::TradeResult));
    w.boolean(true);
    w.u16(petalIndex);
    w.u8(static_cast<std::uint8_t>(rarity));
    w.u16(coin);
    w.str("");
    connection.send(w);
    // The profile carries the new wait: it is what turns the panel's line red
    // and every stack in its grid grey.
    sendProfile(session, connection);
}

double GameServer::traderWaitMillis(const std::string& userId) {
    return waitLeft(traderReadyAt_, userId, clockMillis_);
}

void GameServer::handleAssemble(Session& session, net::Connection& connection,
                                ByteReader& reader) {
    const Rarity rarity = clampRarity(reader.u8());
    const std::uint8_t recipeIndex = reader.u8();
    const int count = reader.u16();
    if (!reader.ok() || !session.authenticated()) return;

    const auto reply = [&](int made, const std::string& reason) {
        ByteWriter w;
        w.u8(static_cast<std::uint8_t>(net::ServerMessage::AssembleResult));
        w.boolean(made > 0);
        w.u8(static_cast<std::uint8_t>(rarity));
        w.u8(recipeIndex);
        w.u16(static_cast<std::uint16_t>(made));
        w.str(reason);
        connection.send(w);
    };

    // The tier only picks WHICH assembler, for a flower standing between two.
    const Entity assembler = serviceAtHand(
        session, NpcService::Assembler, "an assembler",
        [&](const std::string& reason) { reply(0, reason); }, rarity);
    if (assembler == NULL_ENTITY) return;

    // It offers ONE recipe, its own (Npc::recipe): asking for another is a
    // window that has not caught up with which assembler it is at.
    const Npc& npc = world_.get<Npc>(assembler);
    const std::vector<AssemblyRecipe>& recipes = content().mob(npc.configIndex).npc.recipes;
    if (recipeIndex >= recipes.size() || recipeIndex != npc.recipe) {
        reply(0, "The assembler does not make that.");
        return;
    }
    // Universal is forged at the titan and nowhere else: an assembler an
    // operator stood at universal makes nothing.
    if (rarityIndex(rarity) >= kLadderRarityCount) {
        reply(0, "The assembler cannot work at that rarity.");
        return;
    }
    if (count <= 0 || count > kAssemblerMaxBatch) {
        reply(0, "The assembler cannot make that many.");
        return;
    }

    // All or nothing: every input is counted before any is taken, so a batch
    // short of its last petal destroys none of the others.
    const AssemblyRecipe& recipe = recipes[recipeIndex];
    PlayerRecord& record = liveRecord(session);
    for (const AssemblyRecipe::Stack& input : recipe.inputs) {
        const std::int64_t need = recipe.takes(input.petal) * count;
        if (need > kMaxStackCount ||
            record.itemCount(rarity, inventoryKey(input.petal)) < need) {
            reply(0, "You don't have enough " + content().petal(input.petal).name + ".");
            resyncProfile(session, connection);
            return;
        }
    }
    // Taken once per distinct petal, everything the recipe names of it at a
    // time; then every output, each as many times over.
    std::vector<std::uint16_t> taken;
    for (const AssemblyRecipe::Stack& input : recipe.inputs) {
        if (std::find(taken.begin(), taken.end(), input.petal) != taken.end()) continue;
        takeFromInventory(record, input.petal, rarity,
                          static_cast<int>(recipe.takes(input.petal) * count));
        taken.push_back(input.petal);
    }
    for (const AssemblyRecipe::Stack& output : recipe.outputs) {
        giveToInventory(record, output.petal, rarity,
                        static_cast<int>(std::min<std::int64_t>(output.count * count,
                                                                kMaxStackCount)));
    }
    database_.markDirty();

    reply(count, "");
    // The profile carries the new stacks, which is what refills the window's
    // seats and greys whatever is now short.
    sendProfile(session, connection);
    announceRareCraft(session, recipe.outputs.front().petal, rarity);
}

void GameServer::handleAbsorb(Session& session, net::Connection& connection,
                              ByteReader& reader) {
    struct Stack {
        std::uint16_t petalIndex = kNoPetal;
        Rarity rarity = Rarity::Common;
        std::int64_t count = 0;
    };
    const int stackCount = reader.u16();
    std::vector<Stack> stacks;
    stacks.reserve(static_cast<std::size_t>(std::min(stackCount, kMaxAbsorbStacks)));
    // Where each (petal, tier) already sits in `stacks`. A search of the list
    // per entry was quadratic in what the client sent, and ran before
    // anything was validated: 4096 junk pairs cost milliseconds of tick a
    // request.
    std::unordered_map<std::uint32_t, std::size_t> seen;
    bool malformed = stackCount <= 0 || stackCount > kMaxAbsorbStacks;
    for (int i = 0; i < stackCount && !malformed; ++i) {
        Stack stack;
        stack.petalIndex = reader.u16();
        // Read raw rather than through clampRarity: a byte past the ladder is
        // a request to refuse, not one to quietly read as a universal.
        const std::uint8_t rarity = reader.u8();
        stack.count = reader.u32();
        if (!reader.ok()) break;
        if (rarity >= kRarityCount || stack.petalIndex >= content().petalCount()) {
            malformed = true;
            break;
        }
        stack.rarity = static_cast<Rarity>(rarity);
        // One stack per petal and tier: a request naming one twice is asking
        // for the sum of them, and is checked against the bag as that.
        const std::uint32_t key = (std::uint32_t{stack.petalIndex} << 8) | rarity;
        const auto [it, fresh] = seen.emplace(key, stacks.size());
        if (fresh) stacks.push_back(stack);
        else stacks[it->second].count += stack.count;
    }
    if (!reader.ok() || !session.authenticated()) return;

    const auto reply = [&](bool ok, double xp, std::int64_t absorbed, const std::string& reason) {
        ByteWriter w;
        w.u8(static_cast<std::uint8_t>(net::ServerMessage::AbsorbResult));
        w.boolean(ok);
        w.f64(xp);
        w.u32(static_cast<std::uint32_t>(std::clamp<std::int64_t>(absorbed, 0, UINT32_MAX)));
        w.str(reason);
        connection.send(w);
    };
    if (malformed) {
        reply(false, 0, 0, "Nothing to absorb.");
        return;
    }

    // All or nothing: every stack is checked before any is taken, so a
    // request one petal short destroys none of the others.
    PlayerRecord& record = liveRecord(session);
    double units = 0.0;
    std::int64_t absorbed = 0;
    for (const Stack& stack : stacks) {
        if (stack.petalIndex >= content().petalCount() || stack.count <= 0 ||
            stack.count > kMaxStackCount) {
            reply(false, 0, 0, "Nothing to absorb.");
            return;
        }
        const PetalConfig& petal = content().petal(stack.petalIndex);
        if (!absorbable(petal, stack.rarity)) {
            reply(false, 0, 0, petal.name + " cannot be absorbed.");
            return;
        }
        if (record.itemCount(stack.rarity, inventoryKey(stack.petalIndex)) < stack.count) {
            reply(false, 0, 0, "You don't have enough " + petal.name + ".");
            resyncProfile(session, connection);
            return;
        }
        units += static_cast<double>(stack.count) * absorbUnits(stack.rarity);
        absorbed += stack.count;
    }
    for (const Stack& stack : stacks) {
        takeFromInventory(record, stack.petalIndex, stack.rarity, static_cast<int>(stack.count));
    }

    // Priced by the tree the flower is playing on -- the maze's in the maze,
    // the arena run's (which buys nothing) in the ring -- which is the tree
    // the Profile shows, so the "+N XP" the window printed is what lands.
    const bool onMazeTrack = session.playingIn(Realm::Maze);
    const double xp = absorbXpTotal(units, onMazeTrack ? record.mazeSkills : record.skills);
    PlayerRecord& account = database_.progress(session.userId);
    // Onto the body whenever there is one, as a kill's XP is: it is the XP
    // authority while it exists, and the record is brought level with it
    // straight after so the Profile below already shows the new level. A
    // living flower levels up on the spot -- health and body damage -- and a
    // corpse simply holds the XP until the respawn reads it back out of the
    // record. With no body at all the account's own track takes it.
    const bool hasBody = session.playing() && world_.isAlive(session.entity) &&
                         world_.has<PlayerProgress>(session.entity);
    if (xp > 0.0) {
        if (hasBody && !world_.has<Dead>(session.entity)) {
            CombatSystem::grantXp(world_, session.entity, xp);
            persistPlayer(session);
        } else if (hasBody) {
            PlayerProgress& progress = world_.get<PlayerProgress>(session.entity);
            progress.totalXp += xp;
            progress.level = levelFromTotalXp(progress.totalXp).level;
            persistPlayer(session);
        } else {
            account.totalXp += xp;
        }
    }
    database_.markDirty();

    reply(true, xp, absorbed, "");
    sendProfile(session, connection);
}

void GameServer::handleTitanForge(Session& session, net::Connection& connection,
                                  ByteReader& reader) {
    const std::uint16_t petalIndex = reader.u16();
    if (!reader.ok() || !session.authenticated()) return;

    const auto reply = [&](bool ok, const std::string& reason) {
        ByteWriter w;
        w.u8(static_cast<std::uint8_t>(net::ServerMessage::TitanForgeResult));
        w.boolean(ok);
        w.u16(petalIndex);
        w.str(reason);
        connection.send(w);
    };

    if (serviceAtHand(session, NpcService::Titan, "the titan",
                      [&](const std::string& reason) { reply(false, reason); }) == NULL_ENTITY) {
        return;
    }
    if (petalIndex >= content().petalCount()) {
        reply(false, "The titan cannot forge that.");
        return;
    }

    // One of each petal at universal, the forger's own included: forging the
    // one you already hold would only burn five apex for a second copy.
    PlayerRecord& record = liveRecord(session);
    if (holdsUniversal(record, petalIndex)) {
        reply(false, "You already have the Universal " + content().petal(petalIndex).name + ".");
        return;
    }

    // Five apex in, one universal out, every time: there is no roll to lose,
    // and so nothing to hand back.
    if (!takeFromInventory(record, petalIndex, Rarity::Apex, kTitanForgeCost)) {
        reply(false, "You need " + std::to_string(kTitanForgeCost) + " Apex " +
                         content().petal(petalIndex).name + " to forge it.");
        resyncProfile(session, connection);
        return;
    }
    giveToInventory(record, petalIndex, Rarity::Universal, 1);
    database_.markDirty();
    const bool tracked = tracksUniversals(session.userId);
    std::printf("[TITAN] %s forged a universal %s%s\n", session.username.c_str(),
                content().petal(petalIndex).id.c_str(), tracked ? "" : " (admin, untracked)");

    // The forger's account is now the one place a universal of it may be,
    // and the titan remembers it there. An admin's is outside the rule: the
    // player who holds the real one keeps it, the titan still names them,
    // and nobody is told "The Universal" changed hands.
    if (tracked) {
        takeUniversals(petalIndex, session.userId);
        universalHolders_[petalIndex] = HolderMemo{session.username, clockMillis_};
        announceRareCraft(session, petalIndex, Rarity::Universal);
    }

    reply(true, "");
    sendProfile(session, connection);
}

void GameServer::handleTitanHolder(Session& session, net::Connection& connection,
                                   ByteReader& reader) {
    const std::uint16_t petalIndex = reader.u16();
    if (!reader.ok() || !session.authenticated()) return;
    if (petalIndex >= content().petalCount()) return;
    // Each answer can be a sweep of every account, so one session gets one
    // every kTitanHolderQueryMillis; the client asks again for one dropped.
    if (clockMillis_ < session.nextTitanQueryMillis) return;
    // Asked of the titan, so only where it can be asked: standing at it.
    if (serviceAtHand(session, NpcService::Titan, "the titan", [](const std::string&) {}) ==
        NULL_ENTITY) {
        return;
    }
    session.nextTitanQueryMillis = clockMillis_ + kTitanHolderQueryMillis;

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::TitanHolder));
    w.u16(petalIndex);
    w.str(universalHolderName(petalIndex));
    connection.send(w);
}

bool GameServer::tracksUniversals(const std::string& userId) const {
    // The account's flag, not the session's: the sweeps below reach offline
    // accounts, and a temporary admin grant is lent to a connection, not
    // to the petals an account owns.
    const Account* account = database_.findUserById(userId);
    return account == nullptr || !account->admin;
}

std::string GameServer::universalHolderName(std::uint16_t petalIndex) {
    const auto memo = universalHolders_.find(petalIndex);
    if (memo != universalHolders_.end() &&
        clockMillis_ - memo->second.atMillis < kTitanHolderMemoMillis) {
        return memo->second.username;
    }
    // A forge leaves one holder; an operator's `give` can leave more, and then
    // any of them is a flower the titan forged it for as far as it can tell.
    std::string holder;
    for (const std::string& userId : database_.playerIds()) {
        const PlayerRecord* record = database_.findProgress(userId);
        if (record == nullptr || !holdsUniversal(*record, petalIndex)) continue;
        const Account* account = std::as_const(database_).findUserById(userId);
        if (account == nullptr || account->admin) continue;
        holder = account->username;
        break;
    }
    universalHolders_[petalIndex] = HolderMemo{holder, clockMillis_};
    return holder;
}

int GameServer::takeUniversals(std::uint16_t petalIndex, const std::string& keeperId) {
    if (petalIndex >= content().petalCount()) return 0;
    const PetalConfig& petal = content().petal(petalIndex);
    const std::string key = inventoryKey(petalIndex);

    // Found with the read-only lookup and changed through progress() only
    // where there is something to take, so the sweep costs no row its cached
    // text (see Database::playerIds).
    std::vector<std::string> holders;
    for (const std::string& userId : database_.playerIds()) {
        if (userId == keeperId) continue;
        const PlayerRecord* record = database_.findProgress(userId);
        if (record != nullptr && holdsUniversal(*record, petalIndex) &&
            tracksUniversals(userId)) {
            holders.push_back(userId);
        }
    }

    std::int64_t taken = 0;
    for (const std::string& userId : holders) {
        PlayerRecord& record = database_.progress(userId);
        const int bagged = record.itemCount(Rarity::Universal, key);
        record.addItem(Rarity::Universal, key, -bagged);
        // Wide: a stack runs to kMaxStackCount, and four apex for each of
        // those does not fit an int.
        std::int64_t lost = bagged;
        // A worn one goes too: the slot empties, as if the player had taken it
        // off and the forge had then taken it out of the bag.
        for (std::optional<StoredItem>& slot : record.loadout) {
            if (slot.has_value() && slot->rarity == Rarity::Universal &&
                slot->petalType == petal.id) {
                slot.reset();
                ++lost;
            }
        }
        if (lost <= 0) continue;
        // A refund past a full stack is lost, as anything landing on a full
        // stack is (PlayerRecord::addItem).
        const int refund = static_cast<int>(
            std::min<std::int64_t>(lost * kTitanForgeRefund, kMaxStackCount));
        giveToInventory(record, petalIndex, Rarity::Apex, refund);
        taken += lost;
        const Account* holder = std::as_const(database_).findUserById(userId);
        std::printf("[TITAN] took %lld universal %s from %s\n", static_cast<long long>(lost),
                    petal.id.c_str(), holder != nullptr ? holder->username.c_str() : userId.c_str());

        // The account may be playing right now: its ring loses the petal and
        // its panels see the refund at once.
        const std::string text = "Another player forged the Universal " + petal.name +
                                 ". You received " + std::to_string(refund) + " Apex " +
                                 petal.name + " back.";
        for (auto& entry : sessions_) {
            Session& other = entry.second;
            if (!other.authenticated() || other.userId != userId) continue;
            if (other.playing()) applyAccountToSession(other);
            if (net::Connection* peer = listener_.find(entry.first)) {
                sendProfile(other, *peer);
                sendNotice(*peer, net::NoticeSeverity::Warning, text);
            }
        }
    }
    if (taken > 0) database_.markDirty();
    return static_cast<int>(std::min<std::int64_t>(taken, kMaxStackCount));
}

void GameServer::announceRareCraft(const Session& session, std::uint16_t petalIndex,
                                   Rarity made) {
    // The top three tiers only, and ONE line however many the batch produced:
    // the reference announces the craft, not each petal it yielded. A
    // universal is never crafted -- it is forged at a titan, one at a time --
    // and says so.
    const bool forged = made == Rarity::Universal;
    if (made != Rarity::Super && made != Rarity::Unique && made != Rarity::Apex && !forged) return;
    if (petalIndex >= content().petalCount()) return;

    const std::string verb = forged ? " has been forged by " : " has been crafted by ";
    const std::string tier = rarityLabel(made);
    // "An Apex" -- and "An Unique", because the reference tests the LABEL's
    // first letter against the five vowels and 'U' is one of them. Reproduced
    // rather than corrected: the line is the browser's, word for word. The
    // universal line is not the browser's, and says "The Universal": there is
    // only ever one of each petal at universal.
    const std::string article =
        forged ? "The"
               : std::string("AEIOUaeiou").find(tier[0]) != std::string::npos ? "An" : "A";
    const std::string petal = content().petal(petalIndex).name;
    const std::string& playerName = session.nameplate();

    // Two renderings of one sentence: chat gets the marked-up one, and the
    // feed stores the flat one, because the panel draws glyph outlines and has
    // no parser to hand a tag to.
    const std::string plain = article + " " + tier + " " + petal + verb + "@" +
                              session.username + " [" + playerName + "]";
    broadcastChat(net::ChatChannel::System, "",
                  rarityBoldTag(made) + article + " " + tier +
                      " " + petal + verb + "<b style=\"color: #00ff00;\">@" +
                      escapedMarkup(session.username) + "</b> [<b style=\"color: yellow;\">" +
                      escapedMarkup(playerName) + "</b>]</b>");

    addNotification(forged                   ? "universal_craft"
                    : made == Rarity::Apex   ? "apex_craft"
                    : made == Rarity::Unique ? "unique_craft"
                                             : "super_craft",
                    plain);
}

} // namespace flix
