// Buying talent tiers and resetting the tree, on whichever track -- the
// account's or the maze's -- the flower is playing.

#include "server/game_server.h"

#include "shared/game/config.h"
#include "shared/game/skills.h"

namespace flix {

void GameServer::handleUpgradeSkill(Session& session, net::Connection& connection,
                                    ByteReader& reader) {
    const std::uint8_t rawSkill = reader.u8();
    const int tier = reader.u8();
    if (!reader.ok() || !session.authenticated()) return;
    if (rawSkill >= kSkillCount) return;

    const SkillId id = static_cast<SkillId>(rawSkill);
    PlayerRecord& record = liveRecord(session);
    if (session.playingIn(Realm::Arena)) {
        sendNotice(connection, net::NoticeSeverity::Warning, "Talents are disabled in the arena.");
        return;
    }
    // The maze buys from its own tree with its own points.
    const bool maze = session.playingIn(Realm::Maze);
    SkillSet& skills = maze ? record.mazeSkills : record.skills;
    const int points = maze ? record.mazeTalentPoints() : record.talentPoints();
    // Prestige opens the prestige biomes, which the maze track never visits:
    // bought there it would be points spent on nothing.
    if (maze && id == SkillId::Prestige) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "Prestige cannot be bought on the maze's tree.");
        return;
    }

    // Tiers are bought one at a time, in order. Accepting an arbitrary target
    // would let a client skip the tiers below it and pay for one of them.
    if (tier < 0 || tier >= skillTierCount(id) || tier != skills.level(id) + 1) {
        sendNotice(connection, net::NoticeSeverity::Warning, "Talents are bought in order.");
        return;
    }
    if (!skills.prerequisiteMet(id)) {
        const SkillFork& fork = *skillFork(id);
        sendNotice(connection, net::NoticeSeverity::Warning,
                   std::string(skillTierLabel(id, tier)) + " needs " +
                       rarityLabel(fork.requirement) + " " +
                       kSkillLabels[static_cast<std::size_t>(fork.parent)] + ".");
        return;
    }

    const int cost = skillTierCost(id, tier);
    if (points < cost) {
        sendNotice(connection, net::NoticeSeverity::Warning,
                   "Not enough talent points (need " + std::to_string(cost) + ").");
        return;
    }

    skills.set(id, tier);
    recordEdited(session, connection);
}

void GameServer::handleResetSkills(Session& session, net::Connection& connection) {
    if (!session.authenticated()) return;
    PlayerRecord& record = liveRecord(session);
    if (session.playingIn(Realm::Arena)) {
        sendNotice(connection, net::NoticeSeverity::Warning, "Talents are disabled in the arena.");
        return;
    }
    if (session.playingIn(Realm::Maze)) {
        record.mazeSkills.clear();
    } else {
        record.skills.clear();
        // Prestige went with the rest of the tree, and a flower may not stay
        // in a prestige biome without it: one there -- either half of a split
        // -- is taken out of the world and its client sent back to the title
        // screen, whose next join starts in the ordinary biome.
        if (!session.eventKit) {
            session.prestige = false;
            bool inPrestige = false;
            if (session.playing()) {
                for (const Entity body : bodiesOf(session)) {
                    if (body == NULL_ENTITY || !world_.isAlive(body)) continue;
                    const Transform* at = world_.tryGet<Transform>(body);
                    if (at != nullptr && worldMaps_.isPrestige(at->realm)) inPrestige = true;
                }
            }
            if (inPrestige) {
                leaveWorld(session);
                ByteWriter w;
                w.u8(static_cast<std::uint8_t>(net::ServerMessage::LeftWorld));
                connection.send(w);
                recordEdited(session, connection);
                sendNotice(connection, net::NoticeSeverity::Info,
                           "Talents reset; every point refunded. Without Prestige you are back "
                           "on the title screen.");
                return;
            }
        }
    }
    recordEdited(session, connection);
    sendNotice(connection, net::NoticeSeverity::Info, "Talents reset; every point refunded.");
}

} // namespace flix
