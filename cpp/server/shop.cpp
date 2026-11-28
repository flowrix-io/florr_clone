// Spending and earning stars outside the world: the star shop and star codes.

#include "server/game_server.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "server/game_server_internal.h"
#include "shared/game/config.h"
#include "shared/game/shop.h"

namespace flix {

namespace {

/// A double the way JavaScript would print it: no trailing ".0" on a whole
/// number, which is what a star award always is in practice, and no exponent
/// for anything a code could plausibly be worth.
std::string numberText(double value) {
    if (value == std::floor(value) && std::fabs(value) < 1e15) {
        return std::to_string(static_cast<long long>(value));
    }
    char buffer[32];
    std::snprintf(buffer, sizeof buffer, "%g", value);
    return buffer;
}

/// The table the locks live in: account id -> the rotation it locked. Its own
/// top-level table, read and written as raw JSON the way the star codes are,
/// because nothing but these two handlers ever looks at it.
constexpr const char* kShopLockTable = "shopLocks";

/// The rotation `stored` names, when it is a lock still in force at
/// `current`; -1 when it is not one at all or has run out.
std::int64_t liveLock(const Json& stored, std::int64_t current) {
    if (!stored.isNumber()) return -1;
    const double value = stored.asDouble(-1);
    if (!std::isfinite(value) || value < 0) return -1;
    const auto rotation = static_cast<std::int64_t>(value);
    if (rotation > current || current - rotation >= kShopLockRotations) return -1;
    return rotation;
}

/// The petals each account's store locks itself on: account id -> an array of
/// {petal, tier, since} (ShopWatch). Kept like the locks, and for the same
/// reason.
constexpr const char* kShopWatchTable = "shopWatches";

/// The watches `stored` holds, less any this content no longer offers.
std::vector<ShopWatch> watchesFrom(const Json& stored) {
    std::vector<ShopWatch> watches;
    if (!stored.isArray()) return watches;
    for (const Json& row : stored.items()) {
        const double since = row["since"].asDouble(-1);
        if (!std::isfinite(since) || since < 0) continue;
        ShopWatch watch;
        watch.petalIndex = content().petalIndex(row["petal"].asString());
        watch.tier = row["tier"].asInt(kShopWatchAnyTier);
        watch.since = static_cast<std::int64_t>(since);
        if (!shopMayOffer(watch.petalIndex, watch.tier)) continue;
        watches.push_back(watch);
        if (watches.size() >= kMaxShopWatches) break;
    }
    return watches;
}

Json watchesJson(const std::vector<ShopWatch>& watches) {
    Json rows = Json::array();
    for (const ShopWatch& watch : watches) {
        Json row = Json::object();
        row["petal"] = Json(content().petal(watch.petalIndex).id);
        row["tier"] = Json(static_cast<double>(watch.tier));
        row["since"] = Json(static_cast<double>(watch.since));
        rows.push(std::move(row));
    }
    return rows;
}

} // namespace

std::int64_t GameServer::shopRotationFor(const std::string& userId) const {
    const std::int64_t current = shopRotation(shopClockNow());
    // Read through storedTable, which does not invalidate the table's cached
    // text: a purchase is not an edit to the locks.
    const Json& locks = database_.storedTable(kShopLockTable);
    if (locks.isObject() && locks.contains(userId)) {
        const std::int64_t locked = liveLock(locks[userId], current);
        if (locked >= 0) return locked;
    }
    // A watched petal locks the store the hour it appears, whether or not
    // runShopLock has written that lock down yet.
    const Json& watches = database_.storedTable(kShopWatchTable);
    if (watches.isObject() && watches.contains(userId)) {
        const std::int64_t found = watchedShopRotation(watchesFrom(watches[userId]), current);
        if (found >= 0) return found;
    }
    return current;
}

/// The shop's Lock button and the petals it locks on by itself: `status`,
/// `lock`, `unlock`, `watch` (a `petal`, a `tier` and whether it is `on`) or
/// `clear_watches`, answered with where the account's store stands --
/// `locked`, the `rotation` it is showing, its `watches` and, while locked,
/// `until` (seconds since the epoch) when the lock runs out. Sent on the
/// market's JSON channel, so no message layout changed for it.
void GameServer::runShopLock(Session& session, net::Connection& connection, const Json& q) {
    const std::string action = q["action"].asString();
    if (action != "status" && action != "lock" && action != "unlock" && action != "watch" &&
        action != "clear_watches") {
        sendAdminTools(session, connection, "shop", false, "Unknown shop action.");
        return;
    }
    const std::string& userId = session.userId;
    const std::int64_t current = shopRotation(shopClockNow());

    std::int64_t locked = -1;
    bool staleLock = false;
    {
        const Json& locks = database_.storedTable(kShopLockTable);
        if (locks.isObject() && locks.contains(userId)) {
            locked = liveLock(locks[userId], current);
            staleLock = locked < 0;
        }
    }
    std::vector<ShopWatch> watches;
    {
        const Json& stored = database_.storedTable(kShopWatchTable);
        if (stored.isObject() && stored.contains(userId)) watches = watchesFrom(stored[userId]);
    }
    const std::int64_t lockedBefore = locked;
    bool watchesChanged = false;

    // Every rotation before `next` has been looked at: none of them locks the
    // store again.
    const auto lookedUpTo = [&](std::int64_t next) {
        for (ShopWatch& watch : watches) {
            if (watch.since >= next) continue;
            watch.since = next;
            watchesChanged = true;
        }
    };
    // Locks on the first rotation a watch was waiting for. Written down, so
    // the lock outlives its watch being taken off and the rotations behind it
    // are generated once, not on every request.
    const auto lockOnWatched = [&] {
        if (locked >= 0 || watches.empty()) return;
        locked = watchedShopRotation(watches, current);
        lookedUpTo((locked >= 0 ? locked : current) + 1);
    };

    // Whatever appeared while nobody was asking comes first.
    lockOnWatched();
    if (action == "lock" && locked < 0) {
        locked = current;
    } else if (action == "unlock") {
        // Back to the live store, so nothing already seen may lock it again.
        locked = -1;
        lookedUpTo(current + 1);
    } else if (action == "watch") {
        const std::uint16_t petal = content().petalIndex(q["petal"].asString());
        const double wanted = q["tier"].asDouble(kShopWatchAnyTier);
        const int tier = wanted >= kShopWatchAnyTier && wanted < kLadderRarityCount
                             ? static_cast<int>(wanted)
                             : kLadderRarityCount;
        const auto at = std::find_if(watches.begin(), watches.end(), [&](const ShopWatch& w) {
            return w.petalIndex == petal && w.tier == tier;
        });
        if (!q["on"].asBool()) {
            if (at != watches.end()) {
                watches.erase(at);
                watchesChanged = true;
            }
        } else if (at == watches.end() && watches.size() < kMaxShopWatches &&
                   shopMayOffer(petal, tier)) {
            // From this hour on: a petal already in the store locks it now.
            watches.push_back({petal, tier, current});
            watchesChanged = true;
            lockOnWatched();
        }
    } else if (action == "clear_watches" && !watches.empty()) {
        watches.clear();
        watchesChanged = true;
    }

    // A lock that has run out is cleared on the way past, so the table does
    // not keep every account that ever pressed the button.
    if (locked != lockedBefore || (staleLock && locked < 0)) {
        Json& locks = database_.rawTable(kShopLockTable);
        if (locked >= 0) locks[userId] = Json(static_cast<double>(locked));
        else locks.erase(userId);
        database_.markDirty();
    }
    if (watchesChanged) {
        Json& stored = database_.rawTable(kShopWatchTable);
        if (watches.empty()) stored.erase(userId);
        else stored[userId] = watchesJson(watches);
        database_.markDirty();
    }

    Json data = Json::object();
    data["locked"] = Json(locked >= 0);
    data["rotation"] = Json(static_cast<double>(locked >= 0 ? locked : current));
    data["watches"] = watchesJson(watches);
    if (locked >= 0) {
        data["until"] =
            Json(static_cast<double>(shopRotationEnd(locked + kShopLockRotations - 1)));
    }
    sendAdminTools(session, connection, "shop", true, {}, data);
}

void GameServer::handleBuyPetal(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::uint16_t petalIndex = reader.u16();
    const Rarity rarity = clampRarity(reader.u8());
    const std::uint8_t offerSlot = reader.u8();
    if (!reader.ok() || !session.authenticated()) return;

    // The client sends what it wants, never what it costs. A price that came
    // off the wire is a price the client chose. Off a card the ladder stops at
    // super; on one, the card's own tier -- eternal included -- is checked
    // against the rotation below.
    const bool offCard = offerSlot == net::kNoShopOffer;
    if (!shopSellsPetal(petalIndex) || (offCard && !shopSellsRarity(rarity)) ||
        !petalComesAt(content().petal(petalIndex), rarity)) {
        sendShopResult(connection, net::ShopResultKind::Purchase, false, 0, "That is not for sale.");
        return;
    }
    // Not from inside the ring. Stars are the ACCOUNT's and so is what they
    // buy, but a flower in the arena is playing out of the run's own bag --
    // so the petal would be bought, charged for, and invisible until the run
    // ended. Refused for the same reason talents are.
    const cluster::ClientState& there = session.elsewhere.state;
    if ((session.playing() && (session.realm == Realm::Arena || session.eventKit)) ||
        (there.playing && (there.arena || there.eventKit))) {
        sendShopResult(connection, net::ShopResultKind::Purchase, false,
                       database_.progress(session.userId).stars,
                       "The shop is closed in the arena.");
        return;
    }

    PlayerRecord& record = database_.progress(session.userId);
    // A card off the rotating store costs what that card showed, discount
    // included; anything else costs the full ladder price. The slot is only a
    // claim about WHICH card was clicked -- the offers are regenerated here,
    // and a slot whose petal and tier do not match the current rotation's is a
    // click on a store that has since changed. A locked store is the
    // rotation the account locked, for as long as the lock holds.
    double price = shopPrice(petalIndex, rarity);
    if (!offCard) {
        const std::vector<ShopOffer> offers = shopOffers(shopRotationFor(session.userId));
        const auto slot = static_cast<std::size_t>(offerSlot);
        if (slot >= offers.size() || offers[slot].petalIndex != petalIndex ||
            offers[slot].rarity != rarity) {
            sendShopResult(connection, net::ShopResultKind::Purchase, false, 0,
                           "That offer has expired.");
            return;
        }
        price = offers[slot].price;
    }
    // A split flower carries the balance on both halves, and the tick levels
    // them to the HIGHER of the two -- so a charge to the steered half alone
    // was refunded by the parked one on the next tick. Levelled before it is
    // read, and the new balance written onto both below.
    syncSplitProgress(session);
    PlayerProgress* live = session.playing() && world_.isAlive(session.entity)
                               ? world_.tryGet<PlayerProgress>(session.entity)
                               : nullptr;
    const double stars = live ? live->stars : record.stars;
    if (stars < price) {
        sendShopResult(connection, net::ShopResultKind::Purchase, false, 0, "Not enough stars.");
        return;
    }

    // The price AS QUOTED, not a cast of it. shopPrice() floors, so this is
    // already whole -- but the ladder reaches 3.5^9 times a base of a hundred
    // million, which is comfortably past what an int can hold and used to trap
    // or wrap on the way to the subtraction.
    record.stars = stars - price;
    if (live) {
        for (const Entity body : bodiesOf(session)) {
            if (body == NULL_ENTITY || !world_.isAlive(body)) continue;
            if (PlayerProgress* progress = world_.tryGet<PlayerProgress>(body)) {
                progress->stars = record.stars;
            }
        }
    }
    giveToInventory(record, petalIndex, rarity, 1);
    database_.markDirty();
    sendProfile(session, connection);
    sendShopResult(connection, net::ShopResultKind::Purchase, true, 0, {});
}

/// Redeems a star code.
///
/// The codes live in the database's own `codes` table -- the one
/// `/admin generate_code` writes, in the shape the browser build's admin
/// commands wrote it -- so a code minted in either era redeems here without a
/// second registry to keep in step.
void GameServer::handleRedeemCode(Session& session, net::Connection& connection,
                                  ByteReader& reader) {
    const std::string typed = reader.str();
    if (!reader.ok() || !session.authenticated()) return;

    // Trimmed and upper-cased before the lookup, exactly as the browser build
    // normalises it: codes are printed in capitals and pasted with whitespace.
    std::string code = typed;
    code.erase(code.begin(),
               std::find_if(code.begin(), code.end(),
                            [](unsigned char c) { return c > ' '; }));
    code.erase(std::find_if(code.rbegin(), code.rend(),
                            [](unsigned char c) { return c > ' '; })
                   .base(),
               code.end());
    for (char& c : code) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));

    Json& codes = database_.rawTable("codes");
    if (code.empty() || !codes.contains(code)) {
        sendShopResult(connection, net::ShopResultKind::Redeem, false, 0, "Invalid code");
        return;
    }

    // Read through a const alias: Json's mutable operator[] inserts, and a
    // code this call is about to refuse must not grow keys on the way out.
    const Json& stored = const_cast<const Json&>(codes)[code];
    const int maxUses = stored["maxUses"].asInt(0);
    const int uses = stored["uses"].asInt(0);
    // Keyed on the ACCOUNT, not the socket: a player who reconnects is the
    // same person, and a code that reset with the connection would be
    // unlimited to anyone willing to press Play twice.
    Json owners = stored["usedBy"];
    if (!owners.isArray()) owners = Json::array();
    for (const Json& owner : owners.items()) {
        if (owner.asString() == session.userId) {
            sendShopResult(connection, net::ShopResultKind::Redeem, false, 0,
                           "Code already redeemed");
            return;
        }
    }
    if (maxUses > 0 && uses >= maxUses) {
        sendShopResult(connection, net::ShopResultKind::Redeem, false, 0,
                       "Code has reached maximum uses");
        return;
    }

    const double stars = stored["stars"].asDouble(0);
    PlayerRecord& record = database_.progress(session.userId);
    record.stars += stars;
    if (!session.eventKit && session.playing() && world_.isAlive(session.entity)) {
        if (PlayerProgress* live = world_.tryGet<PlayerProgress>(session.entity)) {
            live->stars = record.stars;
        }
    }

    owners.push(Json(session.userId));
    Json& entry = codes[code];
    entry["uses"] = Json(uses + 1);
    entry["usedBy"] = std::move(owners);
    // A fully spent code is dropped rather than left to be rejected forever,
    // which is what the browser build does with it.
    if (maxUses > 0 && uses + 1 >= maxUses) codes.erase(code);
    database_.markDirty();

    sendProfile(session, connection);
    sendShopResult(connection, net::ShopResultKind::Redeem, true, stars, {});

    // The star is U+2B50, exactly as the browser build wrote it. The code
    // itself is NOT in the row, as the browser build had it: the feed is read
    // by anyone who has said Hello, signed in or not, so a code good for more
    // than one use was published to all of them by its first redemption.
    const std::string& playerName = session.nameplate();
    addNotification("star_code", "A star code was redeemed by @" + session.username + " [" +
                                    playerName + "]! +" + numberText(stars) +
                                    " \xE2\xAD\x90 Stars");
}

} // namespace flix
