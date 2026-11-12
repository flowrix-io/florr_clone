// User-created skins.
//
// The catalog is one shared, public list: anything published renders on every
// screen that sees the author wearing it, which is exactly why nothing a
// client sends is trusted. sanitizeSkin() runs here as well as in the studio,
// and the id, the author and the timestamp are the server's to assign.
//
// Stored as raw JSON under the database's `customSkins` key rather than as a
// typed table, because that key holds the browser build's own skin catalog,
// which existing database files carry: its skins have to load here unchanged.

#include "server/game_server.h"

#include <algorithm>
#include <cstdio>
#include <optional>
#include <unordered_map>
#include <unordered_set>
#include <utility>

#include "server/chat_moderation.h"
#include "server/game_server_internal.h"
#include "server/text.h"
#include "shared/game/skin_format.h"
#include "shared/game/skin_likeness.h"

namespace flix {

namespace {

/// The studio's own reply channel. Every outcome the reference reports --
/// success included -- is a chat line from "Skins", not a notice or a toast.
void sendSkinChat(net::Connection& connection, const std::string& text) {
    // The studio, not a flower: no bubble over anybody.
    connection.send(chatMessage(net::ChatChannel::System, "Skins", text, 0));
}

/// A guest account, which may play but may not add to the shared catalog.
///
/// The reference tests `/^User\d{8}$/`; this build's guest minting does not
/// zero-pad (client/app_login.cpp), so the digit run is matched at any length rather
/// than at exactly eight -- otherwise the rule would miss the very accounts it
/// exists to stop.
bool isGuestName(const std::string& name) {
    if (name.size() <= 4 || name.compare(0, 4, "User") != 0) return false;
    for (std::size_t i = 4; i < name.size(); ++i) {
        if (name[i] < '0' || name[i] > '9') return false;
    }
    return true;
}

/// The studio's starter flower, sampled once. It is the skin everybody starts
/// from, so a publish that looks like it adds nothing to the catalog.
const SkinLook& starterLook() {
    static const SkinLook look = sampleSkinLook(starterSkinShapes());
    return look;
}

/// The catalog, parsed, oldest first: the order that decides which of two
/// look-alikes is the original. Ties -- one millisecond, two publishes -- go to
/// the id, so the answer never depends on the file's key order. Rows the parse
/// leaves without shapes (the browser build's old `data` payloads) are never
/// sent and draw nothing, so they are not anybody's original either.
std::vector<CustomSkin> catalogByAge(const Json& table) {
    std::vector<CustomSkin> skins;
    if (!table.isObject()) return skins;
    for (const std::string& id : table.keys()) {
        CustomSkin skin = skinFromJson(table[id]);
        if (skin.id.empty() || skin.shapes.empty()) continue;
        skins.push_back(std::move(skin));
    }
    std::sort(skins.begin(), skins.end(), [](const CustomSkin& a, const CustomSkin& b) {
        if (a.createdAt != b.createdAt) return a.createdAt < b.createdAt;
        return a.id < b.id;
    });
    return skins;
}

/// PublishSkin's and EditSkin's `u8 shapeCount, { SkinShape }*`. Every shape
/// is read, so the reader stays in step, and at most kMaxSkinShapes are kept.
std::vector<SkinShape> readSkinShapes(ByteReader& reader) {
    const std::uint8_t shapeCount = reader.u8();
    std::vector<SkinShape> shapes;
    shapes.reserve(std::min<std::size_t>(shapeCount, kMaxSkinShapes));
    for (int i = 0; i < shapeCount; ++i) {
        SkinShape shape;
        if (readSkinShape(reader, shape) && shapes.size() < static_cast<std::size_t>(kMaxSkinShapes)) {
            shapes.push_back(std::move(shape));
        }
    }
    return shapes;
}

std::string base36(std::uint64_t value) {
    static const char* digits = "0123456789abcdefghijklmnopqrstuvwxyz";
    if (value == 0) return "0";
    std::string out;
    while (value > 0) {
        out += digits[value % 36];
        value /= 36;
    }
    std::reverse(out.begin(), out.end());
    return out;
}

/// Whether a skin's sanitised name may go in the catalogue, where every player
/// reads it. If not, the author is told and the log says why, as for a chat line.
bool skinNameAllowed(const Session& session, net::Connection& connection,
                     const std::string& name, const ChatTerms& terms) {
    const std::string word = blockedWordInName(name, terms);
    if (word.empty()) return true;
    std::printf("[names] refused the skin name \"%s\" from %s (\"%s\")\n", name.c_str(),
                session.username.c_str(), word.c_str());
    sendSkinChat(connection, "That skin name is not allowed. Pick another.");
    return false;
}

/// A skin as a publish or an edit posts it, sanitised (sanitizeSkin) and its
/// name allowed -- or false, with the author told why not.
bool postableSkin(const Session& session, net::Connection& connection, const std::string& name,
                  const std::vector<SkinShape>& shapes, const ChatTerms& terms, SkinCheck& out) {
    out = sanitizeSkin(name, shapes);
    if (!out.ok()) {
        sendSkinChat(connection, out.error);
        return false;
    }
    return skinNameAllowed(session, connection, out.name, terms);
}

/// Whether the account has starred skin `id`.
bool isFavorite(const PlayerRecord& record, const std::string& id) {
    return std::find(record.favoriteSkins.begin(), record.favoriteSkins.end(), id) !=
           record.favoriteSkins.end();
}

constexpr const char* kSkinGone = "That skin no longer exists.";

} // namespace

void GameServer::sendSkinCatalog(Session& session, net::Connection& connection) {
    sendPollState(session, connection);
    // storedTable, not rawTable: this only reads, and rawTable drops the
    // table's cached text (Database::Table). Sent on every sign-in, that made
    // the next save re-dump every custom skin -- the 370 ms `persist` ticks.
    const Json& skins = database_.storedTable("customSkins");
    const PlayerRecord& record = database_.progress(session.userId);

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::SkinCatalog));
    // Advisory only: it decides whether the takedown button is drawn and
    // whether the chat autocomplete offers the /admin and /mod rows. Every
    // delete, and every admin or moderator command, is re-checked server-side
    // regardless of what the client believes -- so a temporary grant may
    // safely raise it, which is how a grantee's console appears without them
    // logging out and back in.
    std::uint8_t standing = 0;
    if (effectiveAdmin(session)) standing |= net::StandingAdmin;
    if (chatModerator(session)) standing |= net::StandingChatModerator;
    w.u8(standing);
    w.str(record.equippedSkinId);

    // Only the skin this account wears. The catalogue no longer fits a frame
    // (a client drops any past kMaxFrameBytes), and nobody needs all of it:
    // the Browse tab pages it in (handleBrowseSkins), and a client asks for
    // the skins on the flowers it sees (handleFetchSkins). This one is sent
    // so the player's own flower and the studio's Equipped state are right
    // from the first frame.
    const CustomSkin worn = skinFromJson(skins[record.equippedSkinId]);
    if (!worn.id.empty() && !worn.shapes.empty()) {
        CustomSkin skin = worn;
        fillTally(skin);
        w.u16(1);
        writeCustomSkin(w, skin);
    } else {
        w.u16(0);
    }

    // The account's own votes and favourites: only skins still in the
    // catalogue, so a dead id never lights a card.
    std::uint16_t voteCount = 0;
    const std::size_t votesAt = w.reserveU16();
    for (const auto& [id, vote] : record.skinVotes) {
        if (voteCount == 0xFFFF || !skins[id].isObject()) continue;
        w.str(id);
        w.u8(static_cast<std::uint8_t>(vote));
        ++voteCount;
    }
    w.patchU16(votesAt, voteCount);
    std::uint16_t favoriteCount = 0;
    const std::size_t favoritesAt = w.reserveU16();
    for (const std::string& id : record.favoriteSkins) {
        if (favoriteCount == 0xFFFF || !skins[id].isObject()) continue;
        w.str(id);
        ++favoriteCount;
    }
    w.patchU16(favoritesAt, favoriteCount);
    connection.send(w);
}

namespace {

/// A Browse row: what the sort and the search read, without the shapes.
struct BrowseRow {
    const std::string* key = nullptr;
    double createdAt = 0;
    std::int64_t score = 0;
    std::uint32_t likes = 0;
};

/// The frame budget a reply's skins are packed into, under kMaxFrameBytes
/// with room to spare for the rest of the reply.
constexpr std::size_t kSkinFrameBudget = net::kMaxFrameBytes - 64 * 1024;

} // namespace

void GameServer::handleBrowseSkins(Session& session, net::Connection& connection,
                                   ByteReader& reader) {
    const std::uint32_t token = reader.u32();
    const std::uint8_t sortByte = reader.u8();
    const std::string search = reader.str();
    const std::uint32_t offset = reader.u32();
    if (!reader.ok() || !session.authenticated()) return;
    if (sortByte > static_cast<std::uint8_t>(SkinSort::Favorites)) return;
    const auto sort = static_cast<SkinSort>(sortByte);

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::SkinPage));
    w.u32(token);
    // Answered either way: a client left waiting on a dropped request would
    // never load the next page.
    if (!spend(session.requestAllowance)) {
        w.u8(1);
        connection.send(w);
        return;
    }
    w.u8(0);

    // Read-only, so storedTable: see sendSkinCatalog. Rows are filtered and
    // sorted by the few fields that decide it; only the page's own skins are
    // parsed whole.
    const Json& skins = database_.storedTable("customSkins");
    const std::string needle = skinSearchNeedle(search);
    // The const lookup: progress() would drop the account row's cached text.
    std::unordered_set<std::string> starred;
    if (sort == SkinSort::Favorites) {
        const PlayerRecord* record = std::as_const(database_).findProgress(session.userId);
        if (record != nullptr) {
            starred.insert(record->favoriteSkins.begin(), record->favoriteSkins.end());
        }
    }
    std::vector<BrowseRow> rows;
    rows.reserve(sort == SkinSort::Favorites ? starred.size() : skins.size());
    for (const std::string& key : skins.keys()) {
        if (sort == SkinSort::Favorites && starred.count(key) == 0) continue;
        const Json& row = skins[key];
        // As catalogByAge: a row without an id or shapes is never sent.
        if (!row.isObject() || row["id"].asString().empty()) continue;
        if (!row["shapes"].isArray() || row["shapes"].size() == 0) continue;
        if (!skinMatchesSearch(row["name"].stringRef(), row["author"].stringRef(), needle)) {
            continue;
        }
        BrowseRow entry;
        entry.key = &key;
        entry.createdAt = row["createdAt"].asDouble(0.0);
        if (sort == SkinSort::Top) {
            const SkinTally tally = skinTally(key);
            entry.likes = tally.likes;
            entry.score = static_cast<std::int64_t>(tally.likes) - tally.dislikes;
        }
        rows.push_back(entry);
    }
    // A total order, ties broken by id, so the pages of one listing never
    // overlap or skip whatever request they arrive in.
    std::sort(rows.begin(), rows.end(), [sort](const BrowseRow& a, const BrowseRow& b) {
        if (sort == SkinSort::Top) {
            if (a.score != b.score) return a.score > b.score;
            if (a.likes != b.likes) return a.likes > b.likes;
        }
        if (a.createdAt != b.createdAt) return a.createdAt > b.createdAt;
        return *a.key > *b.key;
    });

    w.u32(static_cast<std::uint32_t>(rows.size()));
    w.u32(offset);
    const std::size_t countAt = w.reserveU16();
    std::uint16_t count = 0;
    for (std::size_t i = offset; i < rows.size() && count < kSkinPageSize; ++i) {
        CustomSkin skin = skinFromJson(skins[*rows[i].key]);
        fillTally(skin);
        const std::size_t before = w.size();
        writeCustomSkin(w, skin);
        // Always the first, so a page moves on: no single skin comes near
        // the budget (kMaxSkinShapes caps it at ~25 KB).
        if (w.size() > kSkinFrameBudget && count > 0) {
            w.buffer().resize(before);
            break;
        }
        ++count;
    }
    w.patchU16(countAt, count);
    connection.send(w);
}

void GameServer::handleFetchSkins(Session& session, net::Connection& connection,
                                  ByteReader& reader) {
    const std::uint8_t asked = reader.u8();
    std::vector<std::string> ids;
    for (int i = 0; i < asked; ++i) {
        std::string id = reader.str();
        if (static_cast<int>(ids.size()) < kMaxSkinFetch) ids.push_back(std::move(id));
    }
    if (!reader.ok() || !session.authenticated() || ids.empty()) return;
    // Unanswered when the budget is spent: the client asks again a few
    // seconds later for whatever it still lacks.
    if (!spend(session.requestAllowance)) return;

    const Json& skins = database_.storedTable("customSkins");
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::SkinsFetched));
    const std::size_t countAt = w.reserveU16();
    std::uint16_t count = 0;
    std::vector<const std::string*> missing;
    for (const std::string& id : ids) {
        CustomSkin skin = skinFromJson(skins[id]);
        if (skin.id.empty() || skin.shapes.empty()) {
            missing.push_back(&id);
            continue;
        }
        fillTally(skin);
        // kMaxSkinFetch full-size skins come to ~400 KB, inside a frame. An id
        // left out regardless is neither sent nor missing, and asked again.
        const std::size_t before = w.size();
        writeCustomSkin(w, skin);
        if (w.size() > kSkinFrameBudget) {
            w.buffer().resize(before);
            break;
        }
        ++count;
    }
    w.patchU16(countAt, count);
    w.u16(static_cast<std::uint16_t>(missing.size()));
    for (const std::string* id : missing) w.str(*id);
    connection.send(w);
}

void GameServer::handlePublishSkin(Session& session, net::Connection& connection,
                                   ByteReader& reader) {
    const std::string name = reader.str();
    const std::vector<SkinShape> shapes = readSkinShapes(reader);
    if (!reader.ok() || !session.authenticated()) return;

    // Three clicks' worth of the request budget: every attempt, refused or
    // not, rasterises the skin and compares it with the whole catalogue, and
    // one that lands is broadcast to every player.
    if (!spend(session.requestAllowance, 3.0)) {
        sendSkinChat(connection, "You are publishing too quickly. Wait a few seconds.");
        return;
    }
    if (isGuestName(session.username)) {
        sendSkinChat(connection, "Create a (non-guest) account to publish skins.");
        return;
    }
    SkinCheck check;
    if (!postableSkin(session, connection, name, shapes, database_.chatTerms(), check)) return;

    // Read through storedTable, and the mutable table taken only for the
    // write at the end: rawTable drops the catalogue's cached text, and every
    // refusal below used to cost the next save a re-dump of every skin. (A
    // const view also keeps Json's non-const operator[] from CREATING the key
    // a lookup misses.)
    const Json& stored = database_.storedTable("customSkins");
    // Authors are matched case-blind, as the reference matches them: the
    // account "Rose" and the author string "rose" are one person.
    const std::string me = lowerCase(session.username);
    int mine = 0;
    for (const std::string& id : stored.keys()) {
        if (lowerCase(stored[id]["author"].asString()) == me) ++mine;
    }
    if (mine >= kMaxSkinsPerUser) {
        sendSkinChat(connection, "You've reached the limit of " +
                                     std::to_string(kMaxSkinsPerUser) +
                                     " published skins. Delete one first.");
        return;
    }

    // Last, because it is the one check that costs anything: the cheap
    // refusals above never sample a thing.
    SkinLook look = sampleSkinLook(check.shapes);
    if (const std::string refusal = skinLookRefusal(look, me, {}, "publishing");
        !refusal.empty()) {
        sendSkinChat(connection, refusal);
        return;
    }

    CustomSkin skin;
    // Time plus a random tail, as the reference mints it: the clock alone
    // collides when two players publish in the same millisecond.
    skin.id = "sk_" + base36(static_cast<std::uint64_t>(database_.nowMillis())) + "_" +
              base36(rng_.next() % 2176782336ull);
    skin.name = check.name;
    skin.author = session.username;
    skin.shapes = check.shapes;
    skin.createdAt = static_cast<double>(database_.nowMillis());
    database_.rawTable("customSkins")[skin.id] = skinToJson(skin);
    database_.markDirty();
    skinLooks_[skin.id] = CachedSkinLook{skinShapesHash(skin.shapes), std::move(look)};

    broadcastSkin(skin);
    sendSkinChat(connection, "Published \"" + skin.name + "\". It's now in the Browse tab.");
}

void GameServer::handleEditSkin(Session& session, net::Connection& connection,
                                ByteReader& reader) {
    const std::string id = reader.str();
    const std::string name = reader.str();
    const std::vector<SkinShape> shapes = readSkinShapes(reader);
    if (!reader.ok() || !session.authenticated()) return;

    // Billed as a publish is: an edit that lands is sampled, compared with
    // the catalogue and broadcast exactly as one is.
    if (!spend(session.requestAllowance, 3.0)) {
        sendSkinChat(connection, "You are saving too quickly. Wait a few seconds.");
        return;
    }
    // storedTable until the write, for the reason handlePublishSkin gives.
    const Json& stored = database_.storedTable("customSkins");
    if (!stored[id].isObject()) {
        sendSkinChat(connection, kSkinGone);
        return;
    }
    CustomSkin skin = skinFromJson(stored[id]);
    // The author only. An admin may take anyone's skin down, but not redraw
    // it and leave the author's name on it. Case-blind, as every author
    // match is.
    const std::string me = lowerCase(session.username);
    if (lowerCase(skin.author) != me) {
        sendSkinChat(connection, "You can only edit your own skins.");
        return;
    }
    SkinCheck check;
    if (!postableSkin(session, connection, name, shapes, database_.chatTerms(), check)) return;

    // A rename keeps the picture, which is in the catalogue already, so only
    // new shapes are sampled -- and compared with every skin but this one.
    const bool reshaped = skinShapesHash(check.shapes) != skinShapesHash(skin.shapes);
    if (!reshaped && check.name == skin.name) {
        sendSkinChat(connection, "\"" + skin.name + "\" has no changes to save.");
        return;
    }
    std::optional<SkinLook> look;
    if (reshaped) {
        look = sampleSkinLook(check.shapes);
        if (const std::string refusal = skinLookRefusal(*look, me, id, "saving");
            !refusal.empty()) {
            sendSkinChat(connection, refusal);
            return;
        }
    }

    // Id, author and createdAt stay -- the age is what decides which of two
    // look-alikes is the original -- and so do the votes and stars, which
    // are on the voters' rows. editedAt only ever moves forward: it is what
    // a client's baked picture of the old shapes is keyed on.
    skin.name = check.name;
    skin.shapes = check.shapes;
    skin.editedAt = std::max(static_cast<double>(database_.nowMillis()), skin.editedAt + 1.0);
    database_.rawTable("customSkins")[id] = skinToJson(skin);
    database_.markDirty();
    if (look) skinLooks_[id] = CachedSkinLook{skinShapesHash(skin.shapes), std::move(*look)};

    // The client replaces its whole copy, tally included.
    fillTally(skin);
    broadcastSkin(skin);
    sendSkinChat(connection, "Saved \"" + skin.name + "\".");
}

void GameServer::fillTally(CustomSkin& skin) {
    const SkinTally tally = skinTally(skin.id);
    skin.likes = tally.likes;
    skin.dislikes = tally.dislikes;
}

void GameServer::broadcastSkin(const CustomSkin& skin) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::SkinPublished));
    writeCustomSkin(w, skin);
    // Everyone, not just the author: a skin nobody else has cannot be drawn on
    // the player wearing it.
    broadcastToAuthenticated(w);
}

std::string GameServer::skinLookRefusal(const SkinLook& look, const std::string& me,
                                        const std::string& exceptId, const char* verb) {
    if (skinsLookAlikeLinedUp(look, starterLook())) {
        return std::string("That's the starter flower. Change it a bit more before ") + verb + ".";
    }
    const std::optional<CustomSkin> original = findSimilarSkin(look, exceptId);
    if (!original) return {};
    if (lowerCase(original->author) == me) {
        return "That looks just like your \"" + original->name +
               "\". Change it a bit more, or delete that one first.";
    }
    return "That looks just like \"" + original->name + "\" by " + original->author +
           ". Change it a bit more before " + verb + ".";
}

void GameServer::handleEquipSkin(Session& session, net::Connection& connection,
                                 ByteReader& reader) {
    const std::string id = reader.str();
    if (!reader.ok() || !session.authenticated()) return;

    // Read-only, so storedTable: see sendSkinCatalog.
    const Json& catalog = database_.storedTable("customSkins");
    if (!id.empty() && !catalog[id].isObject()) {
        sendSkinChat(connection, kSkinGone);
        return;
    }

    PlayerRecord& record = database_.progress(session.userId);
    record.equippedSkinId = id;
    database_.markDirty();
    if (session.playing() && world_.isAlive(session.entity)) {
        // Onto the live body too, or the change waits for the next respawn:
        // the snapshot reads the component, never the account row.
        PlayerVisuals& visuals = world_.ensure<PlayerVisuals>(session.entity);
        visuals.equippedSkinId = id;
    }
}

void GameServer::handleDeleteSkin(Session& session, net::Connection& connection,
                                  ByteReader& reader) {
    const std::string id = reader.str();
    if (!reader.ok() || !session.authenticated()) return;

    // Checked through storedTable, and only a delete that will happen takes
    // the mutable table: rawTable drops the catalogue's cached text, so a
    // refused delete -- a name that does not exist, a skin that is not yours
    // -- used to cost the next save a re-dump of every custom skin.
    const Json& stored = database_.storedTable("customSkins");
    if (!stored[id].isObject()) return;
    const std::string author = stored[id]["author"].asString();
    const std::string name = stored[id]["name"].asString();

    // Case-blind, as when the skin was counted against its author's limit.
    const bool owner = lowerCase(author) == lowerCase(session.username);
    if (!session.admin && !owner) {
        sendSkinChat(connection, "You can only take down your own skins.");
        return;
    }
    database_.rawTable("customSkins").erase(id);
    skinLooks_.erase(id);
    forgetSkinOpinions({id});
    database_.markDirty();

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::SkinDeleted));
    w.str(id);
    broadcastToAuthenticated(w);
    sendSkinChat(connection, owner ? "Deleted \"" + name + "\"."
                                   : "Took down \"" + name + "\" by " + author + ".");
}

const SkinLook& GameServer::catalogSkinLook(const CustomSkin& skin) {
    const std::uint64_t hash = skinShapesHash(skin.shapes);
    auto found = skinLooks_.find(skin.id);
    if (found == skinLooks_.end() || found->second.shapesHash != hash) {
        found = skinLooks_.insert_or_assign(skin.id, CachedSkinLook{hash, sampleSkinLook(skin.shapes)})
                    .first;
    }
    return found->second.look;
}

std::optional<CustomSkin> GameServer::findSimilarSkin(const SkinLook& look,
                                                      const std::string& exceptId) {
    const Json& table = database_.storedTable("customSkins");
    // Forget the looks of skins that are gone, whoever took them down -- the
    // admin editor erases rows without coming through here.
    for (auto it = skinLooks_.begin(); it != skinLooks_.end();) {
        it = table.isObject() && table.contains(it->first) ? std::next(it) : skinLooks_.erase(it);
    }
    for (CustomSkin& skin : catalogByAge(table)) {
        if (skin.id == exceptId) continue;
        if (skinsLookSimilar(look, catalogSkinLook(skin))) return std::move(skin);
    }
    return std::nullopt;
}

void GameServer::foldLookAlikeSkins() {
    const std::vector<CustomSkin> skins = catalogByAge(database_.storedTable("customSkins"));
    // Copy id -> the id it folds into, "" for the starter flower.
    std::unordered_map<std::string, std::string> foldedInto;
    std::vector<const CustomSkin*> originals;
    for (const CustomSkin& skin : skins) {
        const SkinLook& look = catalogSkinLook(skin);
        const CustomSkin* original = nullptr;
        const bool starter = skinsLookAlike(look, starterLook());
        if (!starter) {
            // Against the originals only, never a copy: A, then B like A, then
            // C like B but not like A is two skins, not one.
            for (const CustomSkin* candidate : originals) {
                if (skinsLookAlike(look, catalogSkinLook(*candidate))) {
                    original = candidate;
                    break;
                }
            }
            if (original == nullptr) {
                originals.push_back(&skin);
                continue;
            }
        }
        foldedInto[skin.id] = original != nullptr ? original->id : std::string();
        if (original != nullptr) {
            std::printf("[skins] folded \"%s\" by %s (%s) into \"%s\" by %s (%s)\n",
                        skin.name.c_str(), skin.author.c_str(), skin.id.c_str(),
                        original->name.c_str(), original->author.c_str(), original->id.c_str());
        } else {
            std::printf("[skins] removed \"%s\" by %s (%s): it is the starter flower\n",
                        skin.name.c_str(), skin.author.c_str(), skin.id.c_str());
        }
    }
    if (foldedInto.empty()) return;

    Json& catalog = database_.rawTable("customSkins");
    std::unordered_set<std::string> gone;
    for (const auto& fold : foldedInto) {
        catalog.erase(fold.first);
        skinLooks_.erase(fold.first);
        gone.insert(fold.first);
    }
    // Votes on a copy are not moved to its original: a like was for the copy
    // somebody saw, and one account can have voted on both.
    forgetSkinOpinions(gone);
    // Offline accounts too: a row still naming a copy would come back to a
    // skin that no longer exists, which draws as the plain flower.
    int rehomed = 0;
    for (const std::string& userId : database_.playerIds()) {
        const PlayerRecord* record = database_.findProgress(userId);
        if (record == nullptr || record->equippedSkinId.empty()) continue;
        const auto fold = foldedInto.find(record->equippedSkinId);
        if (fold == foldedInto.end()) continue;
        database_.progress(userId).equippedSkinId = fold->second;
        ++rehomed;
    }
    database_.markDirty();
    std::printf("[skins] folded %zu look-alike skin(s); %d account(s) moved onto the "
                "original\n",
                foldedInto.size(), rehomed);
}

GameServer::SkinTally GameServer::skinTally(const std::string& id) {
    if (skinTalliesStale_) {
        // Read-only, so the const lookups: a recount must not drop every
        // row's cached text and have the next save re-dump the users table.
        skinTallies_.clear();
        const Database& accounts = database_;
        for (const std::string& userId : accounts.playerIds()) {
            const PlayerRecord* record = accounts.findProgress(userId);
            if (record == nullptr) continue;
            for (const auto& [skinId, vote] : record->skinVotes) {
                SkinTally& tally = skinTallies_[skinId];
                if (vote == SkinVote::Like) ++tally.likes;
                else if (vote == SkinVote::Dislike) ++tally.dislikes;
            }
        }
        skinTalliesStale_ = false;
    }
    const auto found = skinTallies_.find(id);
    return found == skinTallies_.end() ? SkinTally{} : found->second;
}

void GameServer::forgetSkinOpinions(const std::unordered_set<std::string>& ids) {
    if (ids.empty()) return;
    for (const std::string& id : ids) skinTallies_.erase(id);
    bool changed = false;
    // Through the const lookup first, and the mutable one only for the rows
    // that change: progress() drops a row's cached text (Database::Table).
    const Database& accounts = database_;
    for (const std::string& userId : accounts.playerIds()) {
        const PlayerRecord* seen = accounts.findProgress(userId);
        if (seen == nullptr) continue;
        bool touches = false;
        for (const std::string& id : ids) {
            if (seen->skinVotes.count(id) != 0 || isFavorite(*seen, id)) {
                touches = true;
                break;
            }
        }
        if (!touches) continue;
        PlayerRecord& record = database_.progress(userId);
        for (const std::string& id : ids) record.skinVotes.erase(id);
        record.favoriteSkins.erase(
            std::remove_if(record.favoriteSkins.begin(), record.favoriteSkins.end(),
                           [&](const std::string& id) { return ids.count(id) != 0; }),
            record.favoriteSkins.end());
        changed = true;
    }
    if (changed) database_.markDirty();
}

void GameServer::sendSkinOpinion(const Session& session, net::Connection& connection,
                                 const std::string& id) {
    const PlayerRecord* record = std::as_const(database_).findProgress(session.userId);
    SkinVote vote = SkinVote::None;
    bool favorite = false;
    if (record != nullptr) {
        if (const auto found = record->skinVotes.find(id); found != record->skinVotes.end()) {
            vote = found->second;
        }
        favorite = isFavorite(*record, id);
    }
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::SkinOpinion));
    w.str(id);
    w.u8(static_cast<std::uint8_t>(vote));
    w.boolean(favorite);
    connection.send(w);
}

void GameServer::handleVoteSkin(Session& session, net::Connection& connection,
                                ByteReader& reader) {
    const std::string id = reader.str();
    const std::uint8_t raw = reader.u8();
    if (!reader.ok() || !session.authenticated() || id.empty()) return;
    if (raw > static_cast<std::uint8_t>(SkinVote::Dislike)) return;
    const SkinVote vote = static_cast<SkinVote>(raw);

    // Every refusal still answers with the account's standing, so a client
    // that drew a vote it guessed at is put back to what is stored.
    const Json& catalog = database_.storedTable("customSkins");
    if (!catalog[id].isObject()) {
        sendSkinChat(connection, kSkinGone);
        sendSkinOpinion(session, connection, id);
        return;
    }
    // The same two rules as publishing, for the same reason: a vote is a
    // mark on the shared catalogue. Guests are free to make by the thousand,
    // and an author's own like would be a vote for themselves.
    const Account* account = std::as_const(database_).findUserById(session.userId);
    if (isGuestName(session.username) || (account != nullptr && account->guest)) {
        sendSkinChat(connection, "Create a (non-guest) account to vote on skins.");
        sendSkinOpinion(session, connection, id);
        return;
    }
    if (lowerCase(catalog[id]["author"].asString()) == lowerCase(session.username)) {
        sendSkinChat(connection, "You can't vote on your own skin.");
        sendSkinOpinion(session, connection, id);
        return;
    }

    // Counted (stale or not) BEFORE the row changes, so the step below moves
    // a tally that does not already include this vote.
    SkinTally tally = skinTally(id);
    PlayerRecord& record = database_.progress(session.userId);
    const auto found = record.skinVotes.find(id);
    const SkinVote before = found == record.skinVotes.end() ? SkinVote::None : found->second;
    if (before != vote) {
        if (before == SkinVote::Like && tally.likes > 0) --tally.likes;
        if (before == SkinVote::Dislike && tally.dislikes > 0) --tally.dislikes;
        if (vote == SkinVote::Like) ++tally.likes;
        if (vote == SkinVote::Dislike) ++tally.dislikes;
        if (vote == SkinVote::None) record.skinVotes.erase(id);
        else record.skinVotes[id] = vote;
        skinTallies_[id] = tally;
        database_.markDirty();
    }
    sendSkinOpinion(session, connection, id);
    if (before == vote) return;

    // Everyone, as a publish is: every Browse tab shows the same counts.
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::SkinVotes));
    w.str(id);
    w.u32(tally.likes);
    w.u32(tally.dislikes);
    broadcastToAuthenticated(w);
}

void GameServer::handleFavoriteSkin(Session& session, net::Connection& connection,
                                    ByteReader& reader) {
    const std::string id = reader.str();
    const bool favorite = reader.boolean();
    if (!reader.ok() || !session.authenticated() || id.empty()) return;

    // A bookmark, so guests may keep one and an author may star their own.
    // Taking one OFF needs no skin behind it: that is how a stale star goes.
    const Json& catalog = database_.storedTable("customSkins");
    const PlayerRecord* seen = std::as_const(database_).findProgress(session.userId);
    const bool has = seen != nullptr && isFavorite(*seen, id);
    if (favorite && !has) {
        if (!catalog[id].isObject()) {
            sendSkinChat(connection, kSkinGone);
        } else if (seen != nullptr &&
                   seen->favoriteSkins.size() >= static_cast<std::size_t>(kMaxFavoriteSkins)) {
            sendSkinChat(connection, "You can keep at most " + std::to_string(kMaxFavoriteSkins) +
                                         " favorites. Unstar one first.");
        } else {
            database_.progress(session.userId).favoriteSkins.push_back(id);
            database_.markDirty();
        }
    } else if (!favorite && has) {
        std::vector<std::string>& list = database_.progress(session.userId).favoriteSkins;
        list.erase(std::remove(list.begin(), list.end(), id), list.end());
        database_.markDirty();
    }
    sendSkinOpinion(session, connection, id);
}

} // namespace flix
