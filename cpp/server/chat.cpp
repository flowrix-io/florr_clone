// Chat as players say it: Global and Local lines, the screening every line
// goes through before anybody else sees it, and the backlog a sign-in is sent.
// Slash commands are chat_commands.cpp's.

#include "server/game_server.h"

#include <cctype>
#include <cstdio>
#include <deque>
#include <string>

#include "server/chat_moderation.h"
#include "server/game_server_internal.h"
#include "server/text.h"
#include "shared/game/chat_images.h"
#include "shared/game/config.h"

namespace flix {

namespace {

/// How long a line a player said stays theirs for the repeat check: the
/// same line to the same place inside it is refused. Long enough that a line
/// cannot come round again on the rate limit's every-two-seconds beat for a
/// while, short enough that "gg" after one fight and "gg" after the next
/// both go out.
constexpr double kChatRepeatWindowMillis = 30000.0;

constexpr const char* kBlockedWordNotice =
    "<span style=\"color: #ff8866;\">Your message was not sent: it contains a word that is not "
    "allowed in chat.</span>";

/// True when a chat line names a raid tier as a bare word.
///
/// The reference tests `/\b(super|unique)\b/i`, and the word boundary is the
/// whole point: "supercell" is not a raid call, and neither is a name that
/// happens to contain the letters. Ultra is deliberately absent -- bots treat
/// an ultra as a mob to fight, not as a rally point.
bool mentionsRaidTier(const std::string& text) {
    static const char* const kWords[] = {"super", "unique"};
    const auto wordChar = [](unsigned char c) {
        return std::isalnum(c) != 0 || c == '_';
    };
    for (const char* word : kWords) {
        const std::size_t length = std::char_traits<char>::length(word);
        for (std::size_t at = 0; at + length <= text.size(); ++at) {
            bool match = true;
            for (std::size_t i = 0; i < length && match; ++i) {
                match = std::tolower(static_cast<unsigned char>(text[at + i])) == word[i];
            }
            if (!match) continue;
            if (at > 0 && wordChar(static_cast<unsigned char>(text[at - 1]))) continue;
            if (at + length < text.size() &&
                wordChar(static_cast<unsigned char>(text[at + length]))) {
                continue;
            }
            return true;
        }
    }
    return false;
}

} // namespace

ByteWriter chatMessage(net::ChatChannel channel, const std::string& author, const std::string& text,
                       std::uint32_t speakerNetId) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::Chat));
    w.u8(static_cast<std::uint8_t>(channel));
    w.str(author);
    w.str(text);
    w.u32(speakerNetId);
    return w;
}

void GameServer::broadcastChat(net::ChatChannel channel, const std::string& author,
                               const std::string& text, std::uint32_t speakerNetId) {
    broadcastToAuthenticated(chatMessage(channel, author, text, speakerNetId));

    chatHistory_.push_back({channel, author, text, database_.nowMillis()});
    while (chatHistory_.size() > kChatHistoryLines) chatHistory_.pop_front();
}

void GameServer::sendChatHistory(net::Connection& connection) {
    // Nothing said yet is nothing to send: the client's transcript is already
    // empty.
    if (chatHistory_.empty()) return;
    static_assert(kChatHistoryLines <= 0xFF, "the line count is a u8");
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::ChatHistory));
    w.u8(static_cast<std::uint8_t>(chatHistory_.size()));
    for (const ChatHistoryLine& line : chatHistory_) {
        w.u8(static_cast<std::uint8_t>(line.channel));
        w.str(line.author);
        w.str(line.text);
        w.f64(static_cast<double>(line.sentAtMillis));
    }
    connection.send(w);
}

void GameServer::sendChatTo(net::Connection& connection, net::ChatChannel channel,
                            const std::string& author, const std::string& text) {
    // Nobody in the world said this: a directed line is the server answering
    // one player, so it prints in the transcript and floats over no flower.
    connection.send(chatMessage(channel, author, text, 0));
}

void GameServer::handleChat(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::string raw = reader.str();
    if (!reader.ok() || !session.authenticated()) return;
    const std::string text = sanitizeChat(raw);
    if (text.empty()) return;

    // A leading slash is a command, and a command is answered rather than
    // said. This has to come BEFORE the mute check: a muted player is barred
    // from talking to other players, not from asking the server questions
    // about their own account.
    //
    // It also spends a DIFFERENT budget. The chat allowance exists to stop one
    // player flooding everyone else, and a command's output goes back to its
    // sender alone -- billed to the chat bucket, four commands emptied it and
    // the console became one command every two seconds.
    if (!text.empty() && text[0] == '/') {
        if (!spend(session.commandAllowance)) {
            sendNotice(connection, net::NoticeSeverity::Warning,
                       "You are sending commands too quickly.");
            return;
        }
        if (handleChatCommand(session, connection, text)) return;
    }

    // A line with no slash is said to everyone. Local is "/l", which the
    // command dispatch hands back to sayInPublic.
    sayInPublic(session, connection, net::ChatChannel::Global, text);
}

void GameServer::sayInPublic(Session& session, net::Connection& connection,
                             net::ChatChannel channel, const std::string& text) {
    // The body the line is said FROM, so every client can float it over that
    // flower. Zero while the speaker is on the title screen or dead -- there
    // is nothing in the world to anchor a bubble to then, and a Global line
    // is still printed in the transcript.
    std::uint32_t speakerNetId = 0;
    if (session.playing()) {
        if (const NetId* id = world_.tryGet<NetId>(session.entity)) speakerNetId = id->value;
    }
    // Local is measured from the flower, and there is none to measure from.
    // Refused before anything is billed: nothing was said.
    if (channel == net::ChatChannel::Local && speakerNetId == 0) {
        sendSystem(connection, "Local chat reaches the players who can see you, and you are "
                               "not in the world. Switch to Global to be heard from here.");
        return;
    }

    if (!spend(session.chatAllowance)) {
        sendNotice(connection, net::NoticeSeverity::Warning, "You are sending messages too quickly.");
        return;
    }

    // Everything from here reaches other players, which is exactly what a
    // mute blocks.
    if (speakerMuted(session, connection)) return;

    std::string said = text;
    if (!screenChatLine(session, connection, channel, "", said)) return;

    if (channel == net::ChatChannel::Local) {
        sendLocalChat(session, said, speakerNetId);
    } else {
        broadcastChat(net::ChatChannel::Global, session.username, said, speakerNetId);
    }

    // Somebody saying "super" or "unique" rallies every bot onto the best boss
    // in the world, exactly as the reference's chat handler does. Only those
    // two words: an ultra is a high-tier mob to fight, never a raid to call.
    // No-ops when no qualifying boss exists.
    if (mentionsRaidTier(said)) triggerBotRaid(clockMillis_);
}

bool GameServer::screenChatLine(Session& session, net::Connection& speaker,
                                net::ChatChannel channel, const std::string& to,
                                std::string& text) {
    // Everyone, admins included, for all of it: the client refuses any other
    // host whoever posted it, so letting one through here would only send a
    // picture nobody can see -- and a full admin's line reaches the same
    // players a guest's does.
    ChatImageFilter filtered = filterChatImages(text);
    if (filtered.removed != 0) {
        sendSystem(speaker, "<span style=\"color: #ff8866;\">" +
                                std::string(filtered.removed == 1 ? "Your image was" : "Your images were") +
                                " removed: images must come from a known image host (" +
                                chatImageHostSummary() + ").</span>");
        text = std::move(filtered.text);
    }
    // A line that was only the pictures is not sent as an empty one, and
    // neither is one of markup that draws nothing -- not even a notice, any
    // more than an empty line gets one.
    if (chatLineDrawsNothing(text)) return false;

    // One line, one row. A <br> -- which sanitizeChat's newline stripping
    // never sees -- started a row with nothing in front of it, and a colour
    // span then made that row a System line or an admin's announcement, which
    // the chat backlog replayed to everyone who signed in after.
    if (chatLineBreaksRows(text)) {
        sendSystem(speaker, "<span style=\"color: #ff8866;\">Your message was not sent: a chat "
                            "line cannot contain line breaks.</span>");
        return false;
    }

    // Before the word check, which reads letters in stored order: a browser
    // draws "\u202Ekcuf" as a word that check never sees.
    if (chatLineReversesText(text)) {
        sendSystem(speaker, "<span style=\"color: #ff8866;\">Your message was not sent: it "
                            "contains invisible characters that reverse text.</span>");
        return false;
    }

    // Refused, not starred: nothing of it reaches anyone. The word goes in
    // the log, which is how an admin tells a false match from a real one;
    // the speaker is not shown it.
    const std::string word = blockedWordIn(text);
    if (!word.empty()) {
        std::printf("[chat] refused a line from %s (\"%s\"): %s\n", session.username.c_str(),
                    word.c_str(), text.c_str());
        sendSystem(speaker, kBlockedWordNotice);
        return false;
    }

    if (chatLineFloods(text)) {
        sendSystem(speaker, "<span style=\"color: #ff8866;\">Your message was not sent: it is "
                            "mostly the same thing over and over.</span>");
        return false;
    }

    // The same line to the same place again within the window. Where it went
    // is part of it: whispering "hi" to two players is not saying it twice.
    std::deque<Session::SaidLine>& recent = session.recentLines;
    while (!recent.empty() && clockMillis_ - recent.front().atMillis > kChatRepeatWindowMillis) {
        recent.pop_front();
    }
    const std::string key = std::to_string(static_cast<int>(channel)) + ' ' + lowerCase(to) +
                            '\n' + chatRepeatKey(text);
    for (const Session::SaidLine& said : recent) {
        if (said.key != key) continue;
        sendSystem(speaker, "<span style=\"color: #ff8866;\">Your message was not sent: you "
                            "said that a moment ago.</span>");
        return false;
    }
    if (!claimChatCooldown(session, clockMillis_)) {
        sendNotice(speaker, net::NoticeSeverity::Warning,
                   "You are sending messages too quickly. Wait 0.5 seconds between messages.");
        return false;
    }
    recent.push_back({key, clockMillis_});
    return true;
}

void GameServer::sendLocalChat(const Session& speaker, const std::string& text,
                               std::uint32_t speakerNetId) {
    const Transform* from = world_.tryGet<Transform>(speaker.entity);
    if (from == nullptr) return;
    // Seen at all is enough, not seen whole: a flower half off the edge of a
    // screen is still one its player can see talking.
    const Body* body = world_.tryGet<Body>(speaker.entity);
    const double margin = body != nullptr ? body->radius : 0.0;

    const ByteWriter w = chatMessage(net::ChatChannel::Local, speaker.username, text, speakerNetId);
    for (const auto& [id, listener] : sessions_) {
        if (!listener.authenticated() || !listener.playing()) continue;
        // The speaker hears themselves whatever their own box says.
        if (&listener != &speaker) {
            // From the flower the listener is WATCHING, which for an admin
            // steering another player's is that one: the line is heard where
            // its bubble can be seen.
            const Transform* at = world_.tryGet<Transform>(viewpointOf(listener));
            if (at == nullptr || at->realm != from->realm) continue;
            // The listener's own screen, as the client reported it, centred
            // on the body it is watching from -- the box replication streams
            // and the speech bubble is drawn inside.
            Vec2 viewport{kViewportWidth, kViewportHeight};
            if (const PlayerLocation* location = world_.tryGet<PlayerLocation>(listener.entity)) {
                viewport = location->viewport;
            }
            const double dx = std::abs(from->position.x - at->position.x);
            const double dy = std::abs(from->position.y - at->position.y);
            if (dx > viewport.x * 0.5 + margin || dy > viewport.y * 0.5 + margin) continue;
        }
        if (net::Connection* peer = listener_.find(listener.connection)) peer->send(w);
    }
}

} // namespace flix
