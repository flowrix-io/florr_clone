// Spending and earning stars outside the world: the star shop and star codes.

#include "server/game_server.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>

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

/// A lock holds the store until the account presses Unlock: it has no
/// expiry.

/// The table the locks live in: account id -> the rotation it locked. Its own
/// top-level table, read and written as raw JSON the way the star codes are,
/// because nothing but these two handlers ever looks at it.
constexpr const char* kShopLockTable = "shopLocks";

/// The rotation `stored` names, when it is a lock in force at `current`; -1
/// when it is not one at all (or names a rotation that has not happened yet,
/// which only a clock set backwards could produce).
std::int64_t liveLock(const Json& stored, std::int64_t current) {
    if (!stored.isNumber()) return -1;
    const double value = stored.asDouble(-1);
    if (!std::isfinite(value) || value < 0) return -1;
    const auto rotation = static_cast<std::int64_t>(value);
    if (rotation > current) return -1;
    return rotation;
}

} // namespace

std::int64_t GameServer::shopRotationFor(const std::string& userId) const {
    const std::int64_t current = shopRotation(shopClockNow());
    // Read through storedTable, which does not invalidate the table's cached
    // text: a purchase is not an edit to the locks.
    const Json& locks = database_.storedTable(kShopLockTable);
    if (!locks.isObject() || !locks.contains(userId)) return current;
    const std::int64_t locked = liveLock(locks[userId], current);
    return locked >= 0 ? locked : current;
}

/// The shop's Lock button: `status`, `lock` or `unlock`, answered with where
/// the account's store stands -- `locked` and the `rotation` it is showing.
/// A lock lasts until the account unlocks it.
/// Sent on the market's JSON channel, so no message layout changed for it.
void GameServer::runShopLock(Session& session, net::Connection& connection, const Json& q) {
    const std::string action = q["action"].asString();
    if (action != "status" && action != "lock" && action != "unlock") {
        sendAdminTools(session, connection, "shop", false, "Unknown shop action.");
        return;
    }
    const std::int64_t current = shopRotation(shopClockNow());
    std::int64_t locked = -1;
    {
        const Json& locks = database_.storedTable(kShopLockTable);
        if (locks.isObject() && locks.contains(session.userId)) {
            locked = liveLock(locks[session.userId], current);
            // A stored value that is not a usable lock is cleared on the way
            // past.
            if (locked < 0) {
                database_.rawTable(kShopLockTable).erase(session.userId);
                database_.markDirty();
            }
        }
    }
    if (action == "lock" && locked < 0) {
        locked = current;
        database_.rawTable(kShopLockTable)[session.userId] = Json(static_cast<double>(current));
        database_.markDirty();
    } else if (action == "unlock" && locked >= 0) {
        locked = -1;
        database_.rawTable(kShopLockTable).erase(session.userId);
        database_.markDirty();
    }

    Json data = Json::object();
    data["locked"] = Json(locked >= 0);
    data["rotation"] = Json(static_cast<double>(locked >= 0 ? locked : current));
    sendAdminTools(session, connection, "shop", true, {}, data);
}

void GameServer::handleBuyPetal(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::uint16_t petalIndex = reader.u16();
    const Rarity rarity = clampRarity(reader.u8());
    const std::uint8_t offerSlot = reader.u8();
    if (!reader.ok() || !session.authenticated()) return;

    // The client sends what it wants, never what it costs. A price that came
    // off the wire is a price the client chose. Off a card the ladder stops at
    // super; on one, the card's own tier -- unique included -- is checked
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
    if (session.playing() && (session.realm == Realm::Arena || session.eventKit)) {
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
    // rotation the account locked, until the account unlocks it.
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
