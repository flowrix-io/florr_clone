// The chat box: the transcript, the line being typed, and the commands that
// can be typed into it.
//
// One box on two screens. The title screen and the game draw the same input
// slot from the same layout numbers and edit it through the same key handler,
// so the two cannot drift apart -- which is what titleChatBox() and
// drawChatField() are for.
//
// The transcript is where the server's markup lands. A line arrives as text
// with tags in it, parseMarkup (client/ui/markup.h) turns those back into
// styled runs behind the channel's own "[Squad] name:" tag, and
// layoutChatMessage() flows the runs into the column -- breaking between
// words, and inside a word that will not fit a line of its own.
//
// While the box is open it sits on a dark see-through panel under a strip of
// channel tabs. Each tab's checkbox says whether that channel's lines are
// shown; its name picks the channel Enter sends to, which the open line
// carries at its head as "[Local]". The server's own lines belong to no tab.
//
// handleClientCommand() is the other half of the box: the two commands the
// server has no say in. Everything else typed here, squad, guild and whisper
// lines included, is sent and answered by the server.

#include "client/app.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <utility>

#include "client/ui/draw.h"
#include "client/ui/markup.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "client/ui/touch_scroll.h"

namespace flix {

using namespace flix::ui;

namespace {

// The box is pinned to the bottom-left corner, so every height here is
// measured up from the BOTTOM of the window.
//
// The panel the transcript sits on while the box is open. Its left edge is
// the tab strip's too.
constexpr double kChatX = 96.0;
constexpr double kChatPanelWidth = 558.0;
constexpr double kChatPanelUp = 349.0;        ///< top of the panel, from the bottom edge
constexpr double kChatPanelDown = 49.0;       ///< bottom of the panel, from the bottom edge
constexpr double kChatPanelRadius = 4.0;
/// Black at this alpha, for the panel and every tab alike.
constexpr double kChatPlateAlpha = 0.3;
/// From the panel's edge to the text, either side.
constexpr double kChatTextInset = 4.0;
constexpr double kChatTextSize = 14.0;
/// Every row, wrapped or not, is this far from the next: there is no extra
/// gap between messages.
constexpr double kChatLineHeight = 19.6;
/// The newest row's baseline, up from the panel's bottom.
constexpr double kChatLastBaselineUp = 8.0;
/// The oldest row's baseline when scrolled all the way back, down from the
/// panel's top.
constexpr double kChatFirstBaselineDown = 17.0;

/// The channel strip over the panel.
constexpr double kChatTabsUp = 378.0;         ///< top of the strip, from the bottom edge
constexpr double kChatTabHeight = 24.0;
constexpr double kChatTabGap = 8.4;
constexpr double kChatTabRadius = 3.0;
constexpr double kChatTabLabelSize = 14.0;
/// The label's pen, from the tab's left edge; the checkbox is everything
/// before it.
constexpr double kChatTabLabelX = 25.0;
constexpr double kChatTabPadRight = 4.6;
constexpr double kChatTabBaselineDown = 17.0;
constexpr double kChatCheckInset = 3.7;
constexpr double kChatCheckSize = 16.6;
/// The checkbox's dark edge; a ticked one is filled light inside it.
constexpr double kChatCheckEdge = 2.5;
constexpr std::uint32_t kChatCheckFrame = 0x333333u;
constexpr std::uint32_t kChatCheckFill = 0xDDDDDDu;

/// The input, under the panel's left edge. Its bottom sits 20 up; the panel
/// and the strip sit on top of it, so a change to its height moves them too.
constexpr double kChatFieldX = 100.0;
constexpr double kChatFieldUp = 44.0;         ///< top of the input, from the bottom edge
constexpr double kChatFieldWidth = 257.0;
constexpr double kChatFieldHeight = 24.0;

/// A sender's name on Local and on the server's own named lines.
constexpr std::uint32_t kChatAuthorGrey = 0xBBBBBBu;

/// The channel tabs, in strip order -- the order chatChannels' bits and
/// App::chatSendTab_ count in. Local is first because it is where a line goes
/// unless the player picks otherwise.
enum ChatTab : int { kTabLocal, kTabGlobal, kTabSquad, kTabGuild, kTabWhisper, kChatTabCount };

struct ChatTabStyle {
    const char* label;
    std::uint32_t colour;
};
constexpr ChatTabStyle kChatTabStyles[kChatTabCount] = {
    {"Local", 0xFFFFFFu},
    {"Global", 0xFFE65Du},
    {"Squad", 0xFF94C9u},
    {"Guild", 0x1FDBDEu},
    {"Whisper", 0x6666FFu},
};

/// The tab a channel's lines are filed under, or -1 for the server's own,
/// which no tab hides.
int chatTabOf(net::ChatChannel channel) {
    switch (channel) {
        case net::ChatChannel::Local:       return kTabLocal;
        case net::ChatChannel::Global:      return kTabGlobal;
        case net::ChatChannel::Squad:       return kTabSquad;
        case net::ChatChannel::Guild:       return kTabGuild;
        case net::ChatChannel::Whisper:
        case net::ChatChannel::WhisperSent: return kTabWhisper;
        case net::ChatChannel::System:      break;
    }
    return -1;
}

/// The tag at the head of the open line: the channel Enter sends to, and on
/// Whisper who it goes to once anybody is known.
ui::InputPrefix chatPrefix(int tab, const std::string& whisperPartner) {
    const ChatTabStyle& style = kChatTabStyles[tab];
    if (tab == kTabWhisper && !whisperPartner.empty()) {
        return {"[To " + whisperPartner + "]", style.colour};
    }
    return {std::string("[") + style.label + "]", style.colour};
}

/// What Enter puts in front of a line on each tab, before the server sees it.
/// Global is a line with no slash at all, which the server says to everyone.
std::string chatChannelCommand(int tab, const std::string& whisperPartner) {
    switch (tab) {
        case kTabLocal: return "/l ";
        case kTabSquad: return "/s ";
        case kTabGuild: return "/g ";
        case kTabWhisper: return "/w " + whisperPartner + " ";
        default: return {};
    }
}

/// The bare words that switch the channel Enter sends to, in strip order.
/// Only bare: "/squad invite bob" is the squad's own command and still goes to
/// the server, as "/local hi" goes there to be said once on Local.
constexpr const char* kChatSwitchCommands[kChatTabCount] = {
    "/local", "/global", "/squad", "/guild", "/whisper",
};

/// The tab a line switches to, or -1 when it is not one of those words alone.
/// Case and surrounding spaces do not matter -- a completed command arrives
/// with a space after it.
int chatSwitchTarget(const std::string& line) {
    const std::size_t first = line.find_first_not_of(' ');
    if (first == std::string::npos) return -1;
    const std::size_t last = line.find_last_not_of(' ');
    std::string word = line.substr(first, last - first + 1);
    for (char& c : word) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    for (int tab = 0; tab < kChatTabCount; ++tab) {
        if (word == kChatSwitchCommands[tab]) return tab;
    }
    return -1;
}

/// The server's cap on one chat message, in bytes; past it the line is cut.
constexpr std::size_t kServerChatBytes = 200;
/// What the box itself lets be typed.
constexpr std::size_t kChatDraftBytes = 180;
/// The suggestion list replaces the message column; these are its own metrics.
constexpr double kChatSuggestionRowHeight = 23.0;   // 4px padding, a 15px line, 4px
constexpr double kChatSuggestionSize = 13.0;
/// One notch of the wheel, in pixels of transcript. The panels' Scroller moves
/// by the same step, so the box scrolls at the speed the rest of the client
/// does.
constexpr double kChatWheelStep = 42.0;

/// The slash commands the reference offers, in its order.
///
/// Admin rows are carried so this is the reference's table rather than an
/// edited copy of it, and filtered at draw time by matchChatCommands: they are
/// offered only to a client the server has told is admin.
struct ChatCommand {
    const char* command;
    const char* description;
    bool admin;
};

constexpr ChatCommand kChatCommands[] = {
    {"/help", "Show available commands", false},
    {"/biome", "Show the most populated biome", false},
    {"/boss-timers", "Show each biome's unique/apex cooldown", false},
    {"/create-api-key", "Issue an API key tied to your account: /create-api-key [label]", false},
    {"/delete-api-key", "Revoke one of your API keys: /delete-api-key <key-or-prefix>", false},
    {"/admin save", "Save player progress", true},
    {"/admin list-players", "List online players", true},
    {"/admin list-sockets", "List connected sockets", true},
    {"/admin set_max_enemies", "Set max enemy count", true},
    {"/admin set_bot_count", "Set bot count (0-100, or \"default\")", true},
    {"/admin spawn", "Spawn a mob: /admin spawn <mob> <rarity> [x y] [amount] [stack]", true},
    {"/admin killall", "Kill all wild mobs (pets left intact)", true},
    {"/admin teleport", "Teleport a player", true},
    {"/admin tp", "Teleport a player (shorthand)", true},
    {"/admin teleport_all", "Teleport every player and bot: /admin teleport_all <x> <y>", true},
    {"/admin tpall", "Teleport every player (shorthand)", true},
    {"/admin teleport_bots", "Teleport every bot only: /admin teleport_bots <x> <y>", true},
    {"/admin tpbots", "Teleport every bot only (shorthand)", true},
    {"/admin corrupt", "Toggle corruption (fights players anywhere): /admin corrupt <player> [on|off|toggle]", true},
    {"/admin god", "Make yourself invulnerable: /admin god [on|off|toggle]", true},
    {"/admin generate_code", "Generate a star code", true},
    {"/admin gen_code", "Generate a star code (shorthand)", true},
    {"/admin list_codes", "List all generated codes", true},
    {"/admin delete_code", "Delete a code", true},
    {"/admin notification", "Create a notification", true},
    {"/admin notify", "Create a notification (shorthand)", true},
    {"/admin clear_notifications", "Clear all notifications", true},
    {"/admin clear_notifs", "Clear notifications (shorthand)", true},
    {"/admin give", "Give item(s) to a player: /admin give <player> <item> <rarity> [amount]", true},
    {"/admin grant_admin", "Lend a player the admin console until they respawn: /admin grant_admin <player>", true},
    {"/admin revoke_admin", "Take back a temporary admin grant: /admin revoke_admin <player>", true},
    {"/admin list_admins", "List active temporary admin grants", true},
    {"/admin mute", "Bar a player from chat until unmuted: /admin mute <player>", true},
    {"/admin unmute", "Let a muted player chat again: /admin unmute <player>", true},
    {"/admin unmute_all", "Lift every mute on every account", true},
    {"/admin delete_guests", "Delete default guest accounts", true},
    {"/admin list_today_logins", "List accounts active in last 24h", true},
    {"/admin list_active", "List accounts active in last 24h (shorthand)", true},
    {"/cmd", "Execute server command (alias)", true},
    {"/forcelocalplayerflags", "Set local player face/equip flags (client-only)", false},
    {"/squad-create", "Create a new squad ([public|private])", false},
    {"/squad-invite", "Invite a player to your squad", false},
    {"/squad-find-public", "List joinable public squads", false},
    {"/squad-join", "Join a public squad by its ID", false},
    {"/squad-public", "Make your squad public (leader only)", false},
    {"/squad-private", "Make your squad private (leader only)", false},
    {"/squad-accept", "Accept a squad invite", false},
    {"/squad-decline", "Decline a squad invite", false},
    {"/squad-leave", "Leave your current squad", false},
    {"/squad-info", "Show squad members", false},
    {"/l", "Say something to the players who can see you", false},
    {"/s", "Send a message to your squad", false},
    {"/w", "Whisper to one player: /w <player> <message>", false},
    {"/local", "Switch the chat to Local: the players who can see you", false},
    {"/global", "Switch the chat to Global: everyone on the server", false},
    {"/squad", "Switch the chat to your squad", false},
    {"/guild", "Switch the chat to your guild", false},
    {"/whisper", "Switch the chat to whispers, answering the last one", false},
    {"/guild-create", "Create a new guild: /guild-create <tag> [name]", false},
    {"/guild-invite", "Invite a player to your guild (leader only)", false},
    {"/guild-accept", "Accept a guild invite", false},
    {"/guild-decline", "Decline a guild invite", false},
    {"/guild-leave", "Leave your current guild", false},
    {"/guild-kick", "Kick a member from the guild (leader only)", false},
    {"/guild-rename", "Rename your guild (leader only)", false},
    {"/guild-description", "Set or clear your guild's description (leader only)", false},
    {"/guild-info", "Show guild members and status", false},
    {"/guild-squad", "Invite online guildmates into a squad", false},
    {"/guild-list", "List all guilds (id, name, members)", false},
    {"/guild-menu", "Toggle the guild menu panel", false},
    {"/g", "Send a message to your guild", false},
    {"/admin guild_force_join", "Force a player into a guild", true},
    {"/admin guild_list", "List all guilds", true},
    {"/admin guild_info", "Show info for a guild by id", true},
    {"/admin restart", "Schedule server restart: restart [<N>(s|m|h)|cancel|status]", true},
    {"/admin backup_db", "Back up the database: backup_db [list]", true},
    {"/admin db", "Open the database editor (full admins): /admin db <key> [username]", true},
    {"/admin update", "Back up DB, install latest build from GitHub, restart: update [now|<N>(s|m|h)|status|cancel]", true},
    {"/admin change-maze", "Change the maze: change-maze [next|garden|desert|ocean|<dayNumber>]", true},
    {"/level-from-string", "Show what level a player named <name> would roll", false},
    {"/loadout-from-string", "Show the loadout a player named <name> would roll", false},
    {"/admin remove_petal ", "remove petal from a player", true},
};

/// The commands whose names start with what has been typed, case-blind.
/// Shared by the key handler and the draw pass so the highlighted row and the
/// completed text can never come from two different lists.
std::vector<const ChatCommand*> matchChatCommands(const std::string& typed, bool includeAdmin) {
    std::string needle = typed;
    for (char& c : needle) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));

    std::vector<const ChatCommand*> matches;
    for (const ChatCommand& command : kChatCommands) {
        // The browser gates the admin rows on a `showAdminCommands`
        // localStorage flag; this client has no such store, so it gates them
        // on what the server actually said -- the admin flag that arrives with
        // the skin catalog, which a temporary grant re-sends. Listing them to
        // everyone would advertise a console most players cannot open.
        if (command.admin && !includeAdmin) continue;
        std::string name = command.command;
        for (char& c : name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        if (name.size() >= needle.size() && name.compare(0, needle.size(), needle) == 0) {
            matches.push_back(&command);
        }
    }
    return matches;
}

/// One styled run of a transcript line, before it is laid out.
///
/// `italic`, `underline` and `blink` come from the line's markup; everything
/// in the transcript is already bold, so <b> -- which is what wraps every boss
/// announcement -- has no field of its own. That matches the reference, whose
/// chat box is font-weight:700 to begin with.
struct ChatToken {
    std::string text;
    double size = 14.0;
    std::uint32_t fill = kPaper;
    double alpha = 1.0;
    bool italic = false;
    bool underline = false;
    bool blink = false;
    /// A <br>: end the row here and start the next one.
    bool lineBreak = false;
    /// Set when this run continues the previous one's word rather than
    /// starting a new one, as the "lo" of `<b>Hel</b>lo` does. Without it the
    /// layout would insert a space at every style change.
    bool joinsPrevious = false;
};

/// The same run once it knows which row it is on and where along it.
struct ChatPlacedRun {
    std::string text;
    double x = 0;
    double size = 14.0;
    std::uint32_t fill = kPaper;
    double alpha = 1.0;
    bool italic = false;
    bool underline = false;
    bool blink = false;
};

using ChatRow = std::vector<ChatPlacedRun>;

/// Erases the last whole UTF-8 sequence, so a cut never leaves half a
/// character behind.
void popCodepoint(std::string& value) {
    if (value.empty()) return;
    std::size_t at = value.size() - 1;
    while (at > 0 && (static_cast<unsigned char>(value[at]) & 0xC0) == 0x80) --at;
    value.erase(at);
}

/// Flows a message's runs into rows no wider than `width`.
///
/// The reference's message is a block of inline spans in a 270px column, so it
/// breaks between words; `word-wrap: break-word` then breaks INSIDE a word
/// that will not fit a line of its own, which is what the inner loop is for.
std::vector<ChatRow> layoutChatMessage(const std::vector<ChatToken>& tokens, double width) {
    std::vector<ChatRow> rows;
    rows.emplace_back();
    double pen = 0;

    for (const ChatToken& token : tokens) {
        // A <br> ends the row wherever it stands, including on an empty one --
        // "Public squads:<br/><br/>" is meant to leave a blank line.
        if (token.lineBreak) {
            rows.emplace_back();
            pen = 0;
            continue;
        }
        std::string word = token.text;
        if (word.empty()) continue;
        const auto place = [&](const std::string& run, double x) {
            rows.back().push_back({run, x, token.size, token.fill, token.alpha, token.italic,
                                   token.underline, token.blink});
        };
        double gap = (rows.back().empty() || token.joinsPrevious)
                         ? 0.0 : measure(" ", token.size);
        if (!rows.back().empty() && pen + gap + measure(word, token.size) > width) {
            rows.emplace_back();
            pen = 0;
            gap = 0;
        }
        // A word too long for a whole row is cut at the last character that
        // fits and the remainder starts the next row.
        while (measure(word, token.size) > width) {
            std::string head = word;
            while (!head.empty() && measure(head, token.size) > width) popCodepoint(head);
            if (head.empty()) break;
            place(head, pen);
            word.erase(0, head.size());
            rows.emplace_back();
            pen = 0;
            gap = 0;
        }
        if (word.empty()) continue;
        place(word, pen + gap);
        pen += gap + measure(word, token.size);
    }
    return rows;
}

/// The slant a synthetic italic gets. There is one face in this build --
/// Ubuntu Bold; italic is not shipped at all -- so <i> is drawn the way a
/// browser draws a missing italic: by shearing the upright glyphs.
constexpr double kItalicShear = 0.21;   // ~12 degrees

/// One run of chat text.
///
/// Outlined like every other label, at gardn's size * kTextStrokeRatio. The
/// fill is drawn on its own so a translucent span (the timestamp) does not
/// also thin its outline, which stays opaque.
void chatRun(Canvas& canvas, const std::string& s, double x, double baseline, double size,
             std::uint32_t fill, double alpha, bool italic = false, bool underline = false) {
    if (italic) {
        // Sheared about the baseline, so the run keeps its origin and the row
        // below is not walked into.
        canvas.save();
        canvas.translate(static_cast<float>(x), static_cast<float>(baseline));
        canvas.transform(1.0f, 0.0f, static_cast<float>(-kItalicShear), 1.0f, 0.0f, 0.0f);
        canvas.translate(static_cast<float>(-x), static_cast<float>(-baseline));
    }

    TextStyle style;
    style.size = size;
    style.baseline = Baseline::Alphabetic;
    style.fill = kInk;
    style.stroke = kInk;

    if (alpha >= 1.0) {
        style.fill = fill;
        text(canvas, s, x, baseline, style);
    } else {
        text(canvas, s, x, baseline, style);
        style.strokeWidth = 0;
        style.fill = fill;
        canvas.setGlobalAlpha(static_cast<float>(alpha));
        text(canvas, s, x, baseline, style);
        canvas.setGlobalAlpha(1.0f);
    }

    if (underline) {
        // A hairline a tenth of the point size below the baseline, outlined
        // like the glyphs so it stays readable over the world behind it.
        const double width = measure(s, size);
        const double y = baseline + size * 0.1;
        canvas.beginPath();
        canvas.moveTo(static_cast<float>(x), static_cast<float>(y));
        canvas.lineTo(static_cast<float>(x + width), static_cast<float>(y));
        canvas.setLineWidth(
            static_cast<float>(std::max(1.0, size * 0.07) + size * kTextStrokeRatio));
        setStroke(canvas, kInk);
        canvas.stroke();
        canvas.setLineWidth(static_cast<float>(std::max(1.0, size * 0.07)));
        setStroke(canvas, fill, alpha);
        canvas.stroke();
    }

    if (italic) canvas.restore();
}

/// One transcript line as runs: the channel's tag and the sender, then the
/// body's own markup.
///
/// A player's line reads "[Squad] name: text" -- the tag and the name in the
/// channel's colour (a Local sender in grey), the text white. A channel's
/// notice, which has no sender, is the text alone in the channel's colour.
/// The server's own lines carry no tag at all, and a colour their markup
/// names always wins over the channel's.
std::vector<ChatToken> chatLineTokens(const ChatLine& line) {
    std::vector<ChatToken> tokens;
    const int tab = chatTabOf(line.channel);
    std::uint32_t bodyFill = kPaper;
    const auto word = [&](const std::string& text, std::uint32_t fill, bool joins = false) {
        ChatToken token;
        token.text = text;
        token.size = kChatTextSize;
        token.fill = fill;
        token.joinsPrevious = joins;
        tokens.push_back(std::move(token));
    };
    // The colon belongs to the body's colour, and hangs off the name.
    const auto signature = [&](const std::string& name, std::uint32_t fill) {
        std::size_t at = 0;
        while (at < name.size()) {
            const std::size_t space = name.find(' ', at);
            const std::string part =
                name.substr(at, space == std::string::npos ? std::string::npos : space - at);
            if (!part.empty()) word(part, fill);
            if (space == std::string::npos) break;
            at = space + 1;
        }
        word(":", kPaper, true);
    };

    if (tab >= 0) {
        const ChatTabStyle& style = kChatTabStyles[tab];
        if (line.author.empty()) {
            bodyFill = style.colour;
        } else {
            word(std::string("[") + style.label + "]", style.colour);
            if (line.channel == net::ChatChannel::WhisperSent) word("To", style.colour);
            signature(line.author, tab == kTabLocal ? kChatAuthorGrey : style.colour);
        }
    } else if (!line.author.empty() && line.author != "System") {
        // A named voice of the server's own, such as the skin studio's.
        signature(line.author, kChatAuthorGrey);
    }

    // The wire carries markup, not plain text: every boss announcement is a
    // <b style="color: ..."> and every multi-line command answer is joined
    // with <br/>. Splitting the raw string on spaces printed the tags as
    // words; parseMarkup turns them back into styling.
    bool afterWhitespace = true;
    for (const ui::MarkupSpan& span : ui::parseMarkup(line.text)) {
        if (span.lineBreak) {
            tokens.push_back({{}, kChatTextSize, kPaper, 1.0, false, false, false, true, false});
            afterWhitespace = true;
            continue;
        }
        const std::uint32_t fill = span.hasColor ? span.color : bodyFill;
        std::size_t at = 0;
        while (at < span.text.size()) {
            const std::size_t space = span.text.find_first_of(" \t\r\n", at);
            const std::string text = span.text.substr(
                at, space == std::string::npos ? std::string::npos : space - at);
            if (!text.empty()) {
                tokens.push_back({text, kChatTextSize, fill, 1.0, span.italic, span.underline,
                                  span.blink, false, !afterWhitespace});
                afterWhitespace = false;
            }
            if (space == std::string::npos) break;
            afterWhitespace = true;
            at = space + 1;
        }
        // A span ending mid-word ("<b>Hel</b>lo") must not gain a space at
        // the style change; one ending on a space must keep it.
        if (!span.text.empty()) {
            const char last = span.text.back();
            afterWhitespace = last == ' ' || last == '\t' || last == '\r' || last == '\n';
        }
    }
    return tokens;
}

/// The three flag families `/forcelocalplayerflags` can set, by the names the
/// reference's own enums give them -- src/player.ts is what an operator has
/// been typing at, so the same words have to work here.
struct NamedFlag {
    const char* name;
    std::uint32_t value;
};
constexpr NamedFlag kFaceFlagNames[] = {
    {"Poisoned", FacePoisoned},       {"Dandelioned", FaceDandelioned},
    {"DeadEyes", FaceDeadEyes},       {"SquareEyes", FaceSquareEyes},
    {"Attacking", FaceAttacking},     {"Defending", FaceDefending},
    {"HasCorruption", FaceHasCorruption},
};
constexpr NamedFlag kEquipFlagNames[] = {
    {"Cutter", EquipCutter},     {"ThirdEye", EquipThirdEye}, {"Observer", EquipObserver},
    {"Antennae", EquipAntennae}, {"Test1", EquipTest1},
};
constexpr NamedFlag kRenderFlagNames[] = {
    {"Pumpkin", PlayerRenderPumpkin},
    {"Robot", PlayerRenderRobot},
    {"Glitch", PlayerRenderGlitch},
};

template <std::size_t N>
std::string flagNameList(const NamedFlag (&flags)[N]) {
    std::string out;
    for (const NamedFlag& flag : flags) {
        if (!out.empty()) out += ", ";
        out += flag.name;
    }
    return out;
}

/// Folds a run of flag names into one mask. A bare NUMBER anywhere in the run
/// takes over outright, which is how the reference reads it: it is an escape
/// hatch for a bit the table does not name yet.
template <std::size_t N>
bool foldFlags(const NamedFlag (&table)[N], const std::vector<std::string>& names,
               std::uint32_t& out, std::string& unknownOut) {
    out = 0;
    for (const std::string& name : names) {
        const NamedFlag* found = nullptr;
        for (const NamedFlag& flag : table) {
            std::string candidate = flag.name;
            if (candidate.size() != name.size()) continue;
            bool same = true;
            for (std::size_t i = 0; i < name.size() && same; ++i) {
                same = std::tolower(static_cast<unsigned char>(candidate[i])) ==
                       std::tolower(static_cast<unsigned char>(name[i]));
            }
            if (same) found = &flag;
        }
        if (found != nullptr) {
            out |= found->value;
            continue;
        }
        bool numeric = !name.empty();
        for (const char c : name) {
            if (!std::isdigit(static_cast<unsigned char>(c))) numeric = false;
        }
        if (!numeric) {
            unknownOut = name;
            return false;
        }
        out = static_cast<std::uint32_t>(std::strtoul(name.c_str(), nullptr, 10));
        return true;
    }
    return true;
}

} // namespace

bool App::pressedChatBox() const {
    // The slot says "Press Enter to chat...", and on a phone there is no Enter
    // to press. Clicking an input to focus it is what every other field in the
    // client already does -- and what the reference's chat, which is a real
    // DOM input, does by being one.
    //
    // Against the box the LAST frame painted, like everything else that
    // hit-tests the chat: this runs before the draw pass, and the slot does not
    // move between the two.
    if (chatOpen_ || chatBox_.w <= 0) return false;
    const Vec2 pointer{window_.mouseX(), window_.mouseY()};
    // A panel over the slot owns the press. The tall lists start at x = 100
    // and the slot at 115, so they really do overlap -- and the two panels
    // that hide the chat entirely leave the box behind them.
    if (menus_.capturesMouse(pointer)) return false;
    return window_.mousePressed(MouseButton::Left) && chatBox_.contains(pointer);
}

bool App::scrollChat() {
    // A finger dragging the transcript, which is a phone's only way back
    // through it. Tested against where the finger LANDED, as every list's drag
    // is, and never claims the wheel: a finger has none to give the zoom.
    const TouchPan& pan = window_.touchPan();
    const bool suggestingNow = chatOpen_ && chatSuggestion_ >= 0;
    if (pan.active && menus_.settings().showChat && chatColumn_.w > 0 && !suggestingNow) {
        const Vec2 origin{pan.originX, pan.originY};
        if (chatColumn_.contains(origin) && !menus_.capturesMouse(origin)) {
            // Dragging DOWN pulls older lines into view, and older is further
            // off the bottom, which is what the offset counts. The draw clamps
            // the ceiling, as it does for the wheel.
            chatScroll_ = std::max(0.0, chatScroll_ + pan.dy);
        }
    }

    // Hovering the chat is not scrolling it: a frame with no wheel in it is
    // nobody's, and claiming those would stop the zoom working for a pointer
    // that happens to be resting in the corner.
    if (window_.wheelDelta() == 0) return false;
    // A box that is not on screen answers for nothing over it: chatColumn_ is
    // where the chat LAST painted, and switching it off in settings leaves
    // that rectangle behind.
    if (!menus_.settings().showChat) return false;
    // Against the box the LAST frame painted, like everything else that
    // hit-tests the chat.
    if (chatColumn_.w <= 0) return false;
    const Vec2 pointer{window_.mouseX(), window_.mouseY()};
    if (!chatColumn_.contains(pointer)) return false;
    // A panel over the column owns the wheel; the tall lists really do overlap
    // the chat's corner.
    if (menus_.capturesMouse(pointer)) return false;
    // The command list is a picker the arrow keys move through, not a
    // transcript -- but it is drawn in this column, and a wheel over it must
    // still not reach the zoom behind it.
    const bool suggesting = chatOpen_ && chatSuggestion_ >= 0;
    if (!suggesting) {
        // Positive is a scroll up, which shows OLDER lines -- and older is
        // further off the bottom, which is what the offset counts. The ceiling
        // needs the transcript's height, so the draw applies it.
        chatScroll_ = std::max(0.0, chatScroll_ + window_.wheelDelta() * kChatWheelStep);
    }
    return true;
}

void App::editChatLine() {
    const std::string before = chatDraft_;
    ui::TextEditOptions typing;
    // What the channel puts in front of the line counts against the server's
    // cap too, and a whisper's can be long enough to push the end of a full
    // draft off it -- cut mid-character, as the server cuts by the byte.
    const std::size_t overhead =
        chatChannelCommand(chatSendTab_, net_.whisperPartner()).size();
    typing.maxBytes =
        std::min(kChatDraftBytes, kServerChatBytes - std::min(kServerChatBytes, overhead));
    // The open command list takes Up/Down for its rows, as the reference's
    // keydown handler preventDefaults them; with it closed they move the caret.
    typing.upDown = chatSuggestion_ < 0;
    ui::editText(window_, chatDraft_, chatField_, timeSeconds_, typing);
    // A press anywhere outside the chat -- a panel, the world, the strip --
    // closes the line, which is what clicking away from a focused input does
    // everywhere else. The draft is KEPT: reopening with Enter picks it back
    // up rather than throwing away half a sentence.
    if (window_.mousePressed(MouseButton::Left) && chatRegion_.w > 0 &&
        !chatRegion_.contains({window_.mouseX(), window_.mouseY()})) {
        chatOpen_ = false;
        chatSuggestion_ = -1;
        return;
    }
    // The channel strip, as last painted. The checkbox end of a tab -- all of
    // it up to the label, not just the box -- shows or hides that channel;
    // the rest picks it for sending.
    if (window_.mousePressed(MouseButton::Left)) {
        const Vec2 pointer{window_.mouseX(), window_.mouseY()};
        for (int tab = 0; tab < kChatTabCount; ++tab) {
            const Rect whole = chatTabs_[static_cast<std::size_t>(tab)];
            if (whole.w <= 0 || !whole.contains(pointer)) continue;
            if (chatTabChecks_[static_cast<std::size_t>(tab)].contains(pointer)) {
                menus_.settings().chatChannels ^= static_cast<std::uint8_t>(1u << tab);
                // Back to the newest line: an offset into the old selection
                // of lines points at nothing in the new one.
                chatScroll_ = 0;
            } else {
                chatSendTab_ = tab;
            }
            break;
        }
    }
    // Tab and a press on the line's "[Local]" both step on to the next
    // channel, wrapping, in strip order; Shift+Tab steps back.
    const auto stepChannel = [&](int step) {
        chatSendTab_ = (chatSendTab_ + step + kChatTabCount) % kChatTabCount;
    };
    // Against the box the last frame painted: input runs before the draw, and
    // the field does not move between the two.
    if (chatBox_.w > 0) {
        const ui::InputPrefix prefix = chatPrefix(chatSendTab_, net_.whisperPartner());
        const Rect tag = ui::inputPrefixBounds(chatBox_, ui::InputLook::Chat, &prefix);
        if (window_.mousePressed(MouseButton::Left) &&
            tag.contains({window_.mouseX(), window_.mouseY()})) {
            // The tag's press, not the field's: it must not also drop the
            // caret at the start of the line or begin a selection there.
            stepChannel(1);
        } else {
            ui::trackTextMouse(window_, chatField_, chatBox_,
                               ui::inputFieldRun(chatBox_, chatDraft_, chatField_,
                                                 ui::InputLook::Chat, &prefix),
                               chatDraft_, timeSeconds_);
        }
        // The chat line is open or it is not; a press outside must not blur it
        // into a state where it takes keys but shows no caret.
        chatField_.focused = true;
    }
    // The list opens on the first '/' and re-selects its top row whenever the
    // filter changes, which is what the reference's `input` handler does.
    if (chatDraft_ != before) {
        chatSuggestion_ = (!chatDraft_.empty() && chatDraft_[0] == '/') ? 0 : -1;
    }

    // A switch word is acted on as typed, ahead of the command list -- which
    // would otherwise take the Enter to complete "/squad" into "/squad ". The
    // line stays open on the new channel, ready for what is said there.
    if (window_.keyPressed(Key::Enter)) {
        const int target = chatSwitchTarget(chatDraft_);
        if (target >= 0) {
            chatSendTab_ = target;
            chatDraft_.clear();
            chatField_.focusAtEnd(chatDraft_, timeSeconds_);
            chatSuggestion_ = -1;
            return;
        }
    }

    if (chatSuggestion_ >= 0) {
        const std::vector<const ChatCommand*> matches = matchChatCommands(chatDraft_, net_.isSkinAdmin());
        if (matches.empty()) {
            chatSuggestion_ = -1;
        } else {
            const int last = static_cast<int>(matches.size()) - 1;
            if (chatSuggestion_ > last) chatSuggestion_ = last;
            if (window_.keyPressed(Key::Down)) {
                chatSuggestion_ = std::min(chatSuggestion_ + 1, last);
            }
            if (window_.keyPressed(Key::Up)) chatSuggestion_ = std::max(chatSuggestion_ - 1, 0);
            // Completing wins over sending: with a row highlighted, Enter fills
            // the command in rather than posting a half-typed one.
            if (window_.keyPressed(Key::Tab) || window_.keyPressed(Key::Enter)) {
                const ChatCommand* chosen = matches[static_cast<std::size_t>(chatSuggestion_)];
                chatDraft_ = std::string(chosen->command) + " ";
                // Setting an <input>'s value puts its caret at the end; left
                // where it was, the next keystroke lands inside the command.
                chatField_.focusAtEnd(chatDraft_, timeSeconds_);
                chatSuggestion_ = -1;
                return;
            }
            if (window_.keyPressed(Key::Escape)) {
                chatSuggestion_ = -1;
                return;
            }
        }
    }

    // With no list up to complete into, Tab is the channel's.
    if (window_.keyPressed(Key::Tab)) stepChannel(window_.shiftHeld() ? -1 : 1);

    if (window_.keyPressed(Key::Enter)) {
        if (!chatDraft_.empty()) sendChatLine(chatDraft_);
        chatDraft_.clear();
        chatOpen_ = false;
    } else if (window_.keyPressed(Key::Escape)) {
        chatDraft_.clear();
        chatOpen_ = false;
    }
}

void App::sendChatLine(const std::string& line) {
    if (handleClientCommand(line)) return;
    // "/global hi" says one line to everyone without leaving the channel, as
    // "/local hi" does on Local -- that one the server answers itself. Global
    // is a line with no slash, so the word is simply taken off.
    if (line.size() > 8 && chatSwitchTarget(line.substr(0, 7)) == kTabGlobal && line[7] == ' ') {
        const std::size_t text = line.find_first_not_of(' ', 7);
        if (text != std::string::npos) net_.sendChat(line.substr(text));
        return;
    }
    // A command is a command on every channel: "/w bob hi" typed on Squad is
    // a whisper, not a squad line reading "/w bob hi".
    if (line[0] == '/' || chatSendTab_ == kTabGlobal) {
        net_.sendChat(line);
        return;
    }
    if (chatSendTab_ == kTabWhisper && net_.whisperPartner().empty()) {
        // Nobody to answer yet. Said here rather than sent, since the server
        // has no idea who the line was meant for either.
        net_.addSystemMessage("Nobody to whisper to yet. Start with /w &lt;player&gt; "
                              "&lt;message&gt;.");
        return;
    }
    net_.sendChat(chatChannelCommand(chatSendTab_, net_.whisperPartner()) + line);
}

Rect App::titleChatBox(int viewWidth, int viewHeight) {
    (void)viewWidth;
    // Bottom-left, clear of the icon column, under the transcript's left edge.
    // Fixed rather than derived, and the same slot the game draws, so both
    // read it from here.
    return {kChatFieldX, viewHeight - kChatFieldUp, kChatFieldWidth, kChatFieldHeight};
}

void App::drawTitleChat(Canvas& canvas, double time) {
    // The whole box, transcript and all: the reference's title screen mounts
    // the same Chat the game does, and it is where the answer to a command
    // typed here lands -- as does everything said in the world while the
    // player is picking a biome. Hidden by the same switches as in the game.
    const MenuId open = menus_.open();
    const bool panelHidesChat = open == MenuId::Inventory || open == MenuId::Crafting;
    if (menus_.settings().showChat && !panelHidesChat) {
        drawChat(canvas, time);
        return;
    }
    // The slot stays either way, since Enter still opens it here. The region
    // shrinks to just the slot, so the lobby does not keep a transcript that
    // is no longer on screen as a place a press may land without closing it.
    const Rect box = titleChatBox(canvas.width(), canvas.height());
    chatRegion_ = box;
    drawChatField(canvas, box, time);
}

bool App::handleClientCommand(const std::string& message) {
    if (message == "/guild-menu" || message == "/guild menu") {
        // The reference refuses this outside a running game because its panel
        // lives on the game object. This client's panel is a lobby menu too,
        // so it opens wherever the icon strip is up -- and says the
        // reference's line only where there is genuinely nothing to open.
        if (screen_ == Screen::Lobby || screen_ == Screen::Playing || screen_ == Screen::Dead) {
            menus_.toggle(MenuId::Guild);
        } else {
            net_.addSystemMessage("Guild menu is only available in-game.");
        }
        return true;
    }

    if (message.rfind("/forcelocalplayerflags", 0) != 0) return false;

    std::vector<std::string> words;
    std::string word;
    for (const char c : message.substr(std::string("/forcelocalplayerflags").size())) {
        if (c == ' ' || c == '\t') {
            if (!word.empty()) words.push_back(std::exchange(word, std::string()));
        } else {
            word.push_back(c);
        }
    }
    if (!word.empty()) words.push_back(word);

    WorldView::LocalFlagOverride& override = net_.view().localFlags;
    if (words.empty()) {
        const auto mine = net_.view().entities().find(net_.view().self().netId);
        const std::uint32_t face = mine == net_.view().entities().end() ? 0 : mine->second.faceFlags;
        const std::uint32_t equip =
            mine == net_.view().entities().end() ? 0 : mine->second.equipFlags;
        const std::uint32_t render =
            mine == net_.view().entities().end() ? 0 : mine->second.renderFlags;
        net_.addSystemMessage(
            "Usage: /forcelocalplayerflags &lt;face|equip|render&gt; &lt;flag1&gt; "
            "[flag2] ...<br/>Face flags: " + flagNameList(kFaceFlagNames) +
            "<br/>Equip flags: " + flagNameList(kEquipFlagNames) +
            "<br/>Render flags (skins): " + flagNameList(kRenderFlagNames) +
            "<br/>Current: faceFlags=" + std::to_string(face) + ", equipFlags=" +
            std::to_string(equip) + ", renderFlags=" + std::to_string(render));
        return true;
    }

    std::string family = words.front();
    for (char& c : family) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    const std::vector<std::string> names(words.begin() + 1, words.end());

    std::uint32_t value = 0;
    std::string unknown;
    if (family == "face") {
        if (!foldFlags(kFaceFlagNames, names, value, unknown)) {
            net_.addSystemMessage("Unknown face flag: " + unknown);
            return true;
        }
        override.overridesFace = true;
        override.faceFlags = static_cast<std::uint8_t>(value);
        net_.addSystemMessage("Set local faceFlags to " + std::to_string(value));
    } else if (family == "equip") {
        if (!foldFlags(kEquipFlagNames, names, value, unknown)) {
            net_.addSystemMessage("Unknown equip flag: " + unknown);
            return true;
        }
        override.overridesEquip = true;
        override.equipFlags = static_cast<std::uint8_t>(value);
        net_.addSystemMessage("Set local equipFlags to " + std::to_string(value));
    } else if (family == "render") {
        if (!foldFlags(kRenderFlagNames, names, value, unknown)) {
            net_.addSystemMessage("Unknown render flag: " + unknown);
            return true;
        }
        override.overridesRender = true;
        override.renderFlags = value;
        net_.addSystemMessage("Set local renderFlags to " + std::to_string(value));
    } else {
        net_.addSystemMessage("Usage: /forcelocalplayerflags &lt;face|equip|render&gt; "
                              "&lt;flag1&gt; [flag2] ...");
    }
    return true;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

void App::drawChat(Canvas& canvas, double time) {
    const double bottom = canvas.height();
    const Rect panel{kChatX, bottom - kChatPanelUp, kChatPanelWidth,
                     kChatPanelUp - kChatPanelDown};
    const Rect column{panel.x + kChatTextInset, panel.y, panel.w - kChatTextInset * 2, panel.h};
    const Rect field{kChatFieldX, bottom - kChatFieldUp, kChatFieldWidth, kChatFieldHeight};
    // The transcript, the strip over it while it is up, and the line under
    // it, as one box. A press outside it closes the chat, and a press inside
    // must not -- selecting a message and picking a channel are both done
    // with the box open.
    const double regionTop = chatOpen_ ? bottom - kChatTabsUp : panel.y;
    chatRegion_ = {panel.x, regionTop, panel.w, field.bottom() - regionTop};
    // For the wheel, which runs before this draw and needs last frame's box.
    chatColumn_ = panel;

    // Open, the box sits on its panel under the channel strip. Closed, the
    // lines stand over the world on their outlines alone.
    if (chatOpen_) {
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(panel.x), static_cast<float>(panel.y),
                         static_cast<float>(panel.w), static_cast<float>(panel.h),
                         static_cast<float>(kChatPanelRadius));
        setFill(canvas, kInk, kChatPlateAlpha);
        canvas.fill();
        drawChatTabs(canvas, bottom);
    }

    // A leading slash swaps the transcript for the command list -- the
    // reference hides one element and shows the other in the same slot. Up
    // exactly while it has a row to highlight, which is the state the arrow
    // keys read: Escape, a completion and a filter with no matches all put the
    // transcript back until the next keystroke, as the reference's do.
    const bool suggesting = chatOpen_ && chatSuggestion_ >= 0;
    if (suggesting) {
        const std::vector<const ChatCommand*> matches = matchChatCommands(chatDraft_, net_.isSkinAdmin());
        if (!matches.empty()) {
            // Clamped locally: the key handler owns the selection, and a draw
            // pass that edited it would fight whatever the last keystroke did.
            const int selected =
                clamp(chatSuggestion_, 0, static_cast<int>(matches.size()) - 1);

            // Enough scroll to keep the highlighted row in view, which is what
            // the reference's scrollIntoView({block:'nearest'}) amounts to.
            const int visible = std::max(1, static_cast<int>(column.h / kChatSuggestionRowHeight));
            const int first = selected >= visible ? selected - visible + 1 : 0;

            canvas.save();
            canvas.beginPath();
            canvas.rect(static_cast<float>(panel.x), static_cast<float>(panel.y),
                        static_cast<float>(panel.w), static_cast<float>(panel.h));
            canvas.clip();
            double y = column.y;
            for (std::size_t i = static_cast<std::size_t>(first); i < matches.size(); ++i) {
                if (y >= column.bottom()) break;
                if (static_cast<int>(i) == selected) {
                    setFill(canvas, kPaper, 0.15);
                    canvas.fillRect(static_cast<float>(panel.x), static_cast<float>(y),
                                    static_cast<float>(panel.w),
                                    static_cast<float>(kChatSuggestionRowHeight));
                }
                const double baseline = y + 4.0 + ascent(kChatSuggestionSize);
                const double textX = column.x + 4.0;
                chatRun(canvas, matches[i]->command, textX, baseline, kChatSuggestionSize,
                        0xAADDFFu, 1.0);
                const double afterCommand =
                    textX + measure(matches[i]->command, kChatSuggestionSize) + 6.0;
                // The description is ellipsised rather than wrapped: its span
                // is `overflow: hidden; text-overflow: ellipsis; white-space:
                // nowrap`.
                std::string description = std::string("- ") + matches[i]->description;
                const double room = column.right() - 4.0 - afterCommand;
                if (measure(description, 12.0) > room) {
                    while (!description.empty() &&
                           measure(description + "...", 12.0) > room) {
                        popCodepoint(description);
                    }
                    description += "...";
                }
                chatRun(canvas, description, afterCommand, baseline, 12.0, kPaper, 0.5);
                y += kChatSuggestionRowHeight;
            }
            canvas.restore();
        }
    } else {
        // The transcript is the one thing outside a panel a player can select:
        // it is static, it is prose, and it is the half of the chat box worth
        // copying out. The command list above is not -- it is a live picker
        // the arrow keys move through.
        //
        // Left-drag is also the attack control and the transcript sits in the
        // corner people aim across, so sendInputFrame drops the attack for a
        // press that landed ON a line and for the drag that follows it. Only
        // that press: the bands are tight around the glyphs, so hovering over
        // the chat still shoots.
        ui::TextCaptureScope capture(true);

        // The lines stack UP from the newest, whose last row sits just above
        // the panel's bottom; the offset the wheel builds moves the whole
        // stack down, sliding the newest out under the input.
        const double newestBaseline = panel.bottom() - kChatLastBaselineUp;
        const double oldestBaseline = panel.y + kChatFirstBaselineDown;

        // Only the channels whose boxes are ticked. The server's own lines are
        // on no tab and always pass.
        const std::uint8_t shown = menus_.settings().chatChannels;
        const auto passes = [shown](const ChatLine& line) {
            const int tab = chatTabOf(line.channel);
            return tab < 0 || ((shown >> tab) & 1u) != 0;
        };

        // How many lines landed since the last frame. A transcript resting at
        // the bottom simply shows them; one the reader has scrolled back
        // through has to be held still against them, below.
        const std::uint64_t arrived = net_.chatSequence() - chatSeenSeq_;
        chatSeenSeq_ = net_.chatSequence();

        // Newest first, and only as far back as the panel can show -- plus
        // whatever the wheel has scrolled past the bottom of it. Wrapping a
        // hundred-line transcript every frame to then clip all but fifteen
        // rows of it is work nobody sees.
        //
        // Walked in two goes, the second only when a new line moves the
        // offset, so the walk back is resumed rather than started again.
        std::vector<std::vector<ChatRow>> newestFirst;
        double content = 0;                 // every laid-out row, in pixels
        double arrivedContent = 0;          // the part of it that just landed
        std::uint64_t walked = 0;           // lines walked past, shown or not
        auto it = net_.chat().rbegin();
        const auto oldest = net_.chat().rend();
        const auto layoutBack = [&](double needed, std::uint64_t atLeast) {
            for (; it != oldest && (content < needed || walked < atLeast); ++it) {
                const bool landed = walked < arrived;
                ++walked;
                if (!passes(*it)) continue;
                newestFirst.push_back(layoutChatMessage(chatLineTokens(*it), column.w));
                const double height = newestFirst.back().size() * kChatLineHeight;
                content += height;
                if (landed) arrivedContent += height;
            }
        };
        // The lines that arrived are laid out whether or not they are in view:
        // their height is what the offset has to move by.
        const double span = newestBaseline - oldestBaseline;
        layoutBack(span + kChatLineHeight * 2 + chatScroll_, chatScroll_ > 0 ? arrived : 0);

        // A line landing while the reader is parked up the transcript must not
        // drag what they are reading out from under them. It lands at the
        // BOTTOM, so everything above it moves up by its height -- and the
        // offset is counted off that bottom, so growing it by the same amount
        // leaves the view exactly where it was.
        if (chatScroll_ > 0 && arrivedContent > 0) {
            chatScroll_ += arrivedContent;
            layoutBack(span + kChatLineHeight * 2 + chatScroll_, 0);
        }

        // The oldest line is as far back as the wheel goes. Only a walk that
        // reached it knows the whole height, so the ceiling is applied here
        // rather than where the wheel is read; a clamp can only ever LOWER the
        // offset, so there is nothing left to lay out afterwards.
        const double slack = content - kChatLineHeight - span;
        if (it == oldest) chatScroll_ = clamp(chatScroll_, 0.0, slack > 0 ? slack : 0.0);
        // A transcript with more than it can show is one a finger can drag --
        // see scrollChat. One that fits keeps its press immediate, so a finger
        // aimed across the corner still swings.
        if (slack > 0 || chatScroll_ > 0) ui::TouchScrollRegions::instance().record(panel);

        if (!newestFirst.empty()) {
            const double above = ascent(kChatTextSize);
            const double below = -descent(kChatTextSize);
            canvas.save();
            canvas.beginPath();
            canvas.rect(static_cast<float>(panel.x), static_cast<float>(panel.y),
                        static_cast<float>(panel.w), static_cast<float>(panel.h));
            canvas.clip();
            // The baseline of the message's LAST row; its others stack above.
            double baseline = newestBaseline + chatScroll_;
            for (const std::vector<ChatRow>& rows : newestFirst) {
                const double firstRow = baseline - (rows.size() - 1) * kChatLineHeight;
                if (baseline - above <= panel.bottom()) {
                    for (std::size_t row = 0; row < rows.size(); ++row) {
                        const double rowBaseline = firstRow + row * kChatLineHeight;
                        if (rowBaseline + below < panel.y || rowBaseline - above > panel.bottom()) {
                            continue;
                        }
                        for (const ChatPlacedRun& run : rows[row]) {
                            // `blink 1s step-start infinite`, which is what
                            // the reference's <blink> resolves to: shown for
                            // the first half of every second and hidden for
                            // the second.
                            if (run.blink && std::fmod(time, 1.0) >= 0.5) continue;
                            chatRun(canvas, run.text, column.x + run.x, rowBaseline, run.size,
                                    run.fill, run.alpha, run.italic, run.underline);
                        }
                    }
                }
                baseline = firstRow - kChatLineHeight;
                if (baseline + below < panel.y) break;
            }
            canvas.restore();
        }
    }

    drawChatField(canvas, field, time);
}

void App::drawChatTabs(Canvas& canvas, double bottom) {
    static_assert(kChatTabCount == 5, "App::chatTabs_ holds one rect per tab");
    // The labels are controls, not page text: a press on one picks a channel
    // and must not start a selection.
    ui::TextCaptureScope off(false);
    const std::uint8_t shown = menus_.settings().chatChannels;
    const Vec2 pointer{window_.mouseX(), window_.mouseY()};
    double x = kChatX;
    const double y = bottom - kChatTabsUp;
    for (int tab = 0; tab < kChatTabCount; ++tab) {
        const ChatTabStyle& style = kChatTabStyles[tab];
        const double width =
            kChatTabLabelX + measure(style.label, kChatTabLabelSize) + kChatTabPadRight;
        const Rect whole{x, y, width, kChatTabHeight};

        canvas.beginPath();
        canvas.roundRect(static_cast<float>(whole.x), static_cast<float>(whole.y),
                         static_cast<float>(whole.w), static_cast<float>(whole.h),
                         static_cast<float>(kChatTabRadius));
        setFill(canvas, kInk, kChatPlateAlpha);
        canvas.fill();

        const Rect box{x + kChatCheckInset, y + (kChatTabHeight - kChatCheckSize) * 0.5,
                       kChatCheckSize, kChatCheckSize};
        setFill(canvas, kChatCheckFrame);
        canvas.beginPath();
        canvas.roundRect(static_cast<float>(box.x), static_cast<float>(box.y),
                         static_cast<float>(box.w), static_cast<float>(box.h), 1.5f);
        canvas.fill();
        if (((shown >> tab) & 1u) != 0) {
            setFill(canvas, kChatCheckFill);
            canvas.fillRect(static_cast<float>(box.x + kChatCheckEdge),
                            static_cast<float>(box.y + kChatCheckEdge),
                            static_cast<float>(box.w - kChatCheckEdge * 2),
                            static_cast<float>(box.h - kChatCheckEdge * 2));
        }

        TextStyle label;
        label.size = kChatTabLabelSize;
        label.fill = style.colour;
        label.baseline = Baseline::Alphabetic;
        text(canvas, style.label, x + kChatTabLabelX, y + kChatTabBaselineDown, label);

        chatTabs_[static_cast<std::size_t>(tab)] = whole;
        chatTabChecks_[static_cast<std::size_t>(tab)] = {x, y, kChatTabLabelX - 2.0,
                                                         kChatTabHeight};
        if (whole.contains(pointer)) window_.setCursorShape(CursorShape::Hand);
        x += width + kChatTabGap;
    }
}

void App::drawChatField(Canvas& canvas, Rect box, double time) {
    chatBox_ = box;
    // Open, the line is white on a black edge with the channel it sends to at
    // its head. Closed, it is the browser build's dark see-through slot, so it
    // does not sit over the game as a white box. inputField records the box
    // for the on-screen keyboard either way, which a closed line needs: the
    // tap that raises the keyboard is the one that opens it.
    if (chatOpen_) {
        const ui::InputPrefix prefix = chatPrefix(chatSendTab_, net_.whisperPartner());
        ui::inputField(canvas, box, chatDraft_, {}, true, time, &chatField_, false,
                       ui::InputLook::Chat, &prefix);
        // The tag is a button: it steps the line on to the next channel.
        if (ui::inputPrefixBounds(box, ui::InputLook::Chat, &prefix)
                .contains({window_.mouseX(), window_.mouseY()})) {
            window_.setCursorShape(CursorShape::Hand);
        }
    } else {
        ui::inputField(canvas, box, chatDraft_, "Press Enter to chat...", false, time,
                       &chatField_, false, ui::InputLook::Overlay);
    }
}

} // namespace flix
