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
// styled runs, and layoutChatMessage() flows the runs into a 270px column the
// way the reference's inline spans flow in theirs -- breaking between words,
// and inside a word that will not fit a line of its own.
//
// handleClientCommand() is the other half of the box: the two commands the
// server has no say in. Everything else typed here, squad and guild lines
// included, is sent and answered by the server.

#include "client/app.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <utility>

#include "client/ui/draw.h"
#include "client/ui/markup.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "client/ui/touch_scroll.h"

namespace flix {

using namespace flix::ui;

namespace {

// The reference's chat is a fixed 300x200 box 10px off the bottom-left corner.
// These are its resolved content boxes, measured from the BOTTOM of the window
// because that is the edge it is pinned to.
constexpr double kChatX = 115.0;              ///< left edge of the text column
constexpr double kChatColumnWidth = 270.0;
constexpr double kChatColumnUp = 195.0;       ///< top of the column, from the bottom edge
constexpr double kChatColumnDown = 65.0;      ///< bottom of the column, from the bottom edge
/// One 14px row of Ubuntu at the browser's `normal` line-height.
constexpr double kChatLineHeight = 16.0;
/// A message div's `margin: 2px 0`; adjacent siblings collapse to one gap.
constexpr double kChatMessageGap = 2.0;
constexpr double kChatFieldUp = 44.0;         ///< top of the input, from the bottom edge
constexpr double kChatFieldHeight = 20.0;
/// The size a browser gives an unstyled <input>, which is what the field is.
constexpr double kChatFieldTextSize = 13.333;
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
    {"/s", "Send a message to your squad", false},
    {"/guild-create", "Create a new guild: /guild-create <name>", false},
    {"/guild-invite", "Invite a player to your guild (leader only)", false},
    {"/guild-accept", "Accept a guild invite", false},
    {"/guild-decline", "Decline a guild invite", false},
    {"/guild-leave", "Leave your current guild", false},
    {"/guild-kick", "Kick a member from the guild (leader only)", false},
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
    {"/admin update", "Back up DB, install latest build from GitHub, restart: update [now|<N>(s|m|h)|status|cancel]", true},
    {"/admin change-maze", "Change the maze: change-maze [next|garden|desert|ocean|<dayNumber>]", true},
    {"/level-from-string", "Show what level a player named <name> would roll", false},
    {"/loadout-from-string", "Show the loadout a player named <name> would roll", false},
    {"/admin remove_petal ", "remove petal from a player", true},
};

/// "11:31:44 PM" in the machine's own timezone, which is what
/// `Date#toLocaleTimeString` gives the reference on an en-US browser.
std::string clockTime(std::int64_t unixMillis) {
    const std::time_t seconds = static_cast<std::time_t>(unixMillis / 1000);
    std::tm local{};
#if defined(_WIN32)
    localtime_s(&local, &seconds);
#else
    localtime_r(&seconds, &local);
#endif
    const int hour12 = local.tm_hour % 12 == 0 ? 12 : local.tm_hour % 12;
    char buffer[32];
    std::snprintf(buffer, sizeof buffer, "%d:%02d:%02d %s", hour12, local.tm_min, local.tm_sec,
                  local.tm_hour < 12 ? "AM" : "PM");
    return buffer;
}

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
                         ? 0.0 : measure(" ", token.size, true);
        if (!rows.back().empty() && pen + gap + measure(word, token.size, true) > width) {
            rows.emplace_back();
            pen = 0;
            gap = 0;
        }
        // A word too long for a whole row is cut at the last character that
        // fits and the remainder starts the next row.
        while (measure(word, token.size, true) > width) {
            std::string head = word;
            while (!head.empty() && measure(head, token.size, true) > width) popCodepoint(head);
            if (head.empty()) break;
            place(head, pen);
            word.erase(0, head.size());
            rows.emplace_back();
            pen = 0;
            gap = 0;
        }
        if (word.empty()) continue;
        place(word, pen + gap);
        pen += gap + measure(word, token.size, true);
    }
    return rows;
}

/// The slant a synthetic italic gets. There is one face in this build -- bold
/// is a real Ubuntu-Bold, italic is not shipped at all -- so <i> is drawn the
/// way a browser draws a missing italic: by shearing the upright glyphs.
constexpr double kItalicShear = 0.21;   // ~12 degrees

/// One run of chat text.
///
/// The reference styles the whole box with a four-way one-pixel black
/// text-shadow plus a soft 3px glow, which is not a thing a stroke can be; two
/// black passes under the fill are what it comes out as. The fill is drawn on
/// its own so a translucent span (the timestamp) does not also thin its
/// outline, which is opaque in the reference.
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
    style.bold = true;
    style.baseline = Baseline::Alphabetic;
    style.fill = kInk;
    style.stroke = kInk;

    style.strokeWidth = 3.0;
    canvas.setGlobalAlpha(0.8f);
    text(canvas, s, x, baseline, style);
    canvas.setGlobalAlpha(1.0f);

    style.strokeWidth = 2.0;
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
        const double width = measure(s, size, true);
        const double y = baseline + size * 0.1;
        canvas.beginPath();
        canvas.moveTo(static_cast<float>(x), static_cast<float>(y));
        canvas.lineTo(static_cast<float>(x + width), static_cast<float>(y));
        canvas.setLineWidth(static_cast<float>(std::max(1.0, size * 0.07) + 2.0));
        setStroke(canvas, kInk, 0.8);
        canvas.stroke();
        canvas.setLineWidth(static_cast<float>(std::max(1.0, size * 0.07)));
        setStroke(canvas, fill, alpha);
        canvas.stroke();
    }

    if (italic) canvas.restore();
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
    const bool suggestingNow = chatOpen_ && !chatDraft_.empty() && chatDraft_[0] == '/';
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
    const bool suggesting = chatOpen_ && !chatDraft_.empty() && chatDraft_[0] == '/';
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
    editText(chatDraft_, 180, chatField_);
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
    // Against the box the last frame painted: input runs before the draw, and
    // the field does not move between the two.
    if (chatBox_.w > 0) {
        ui::TextRun run;
        run.text = chatDraft_;
        run.originX = chatBox_.x + 6.0;
        run.size = kChatFieldTextSize;
        ui::trackTextMouse(window_, chatField_, chatBox_, run, chatDraft_, timeSeconds_);
        // The chat line is open or it is not; a press outside must not blur it
        // into a state where it takes keys but shows no caret.
        chatField_.focused = true;
    }
    // The list opens on the first '/' and re-selects its top row whenever the
    // filter changes, which is what the reference's `input` handler does.
    if (chatDraft_ != before) {
        chatSuggestion_ = (!chatDraft_.empty() && chatDraft_[0] == '/') ? 0 : -1;
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
                chatSuggestion_ = -1;
                return;
            }
            if (window_.keyPressed(Key::Escape)) {
                chatSuggestion_ = -1;
                return;
            }
        }
    }

    if (window_.keyPressed(Key::Enter)) {
        if (!chatDraft_.empty() && !handleClientCommand(chatDraft_)) net_.sendChat(chatDraft_);
        chatDraft_.clear();
        chatOpen_ = false;
    } else if (window_.keyPressed(Key::Escape)) {
        chatDraft_.clear();
        chatOpen_ = false;
    }
}

Rect App::titleChatBox(int viewWidth, int viewHeight) {
    (void)viewWidth;
    // Bottom-left, clear of the icon column, where the reference's chat input
    // sits. Fixed rather than derived: it is a fixed-position element there,
    // and it is the same slot the game draws, so both read it from here.
    return {kChatX, viewHeight - kChatFieldUp, kChatColumnWidth, kChatFieldHeight};
}

void App::drawTitleChat(Canvas& canvas, double time) {
    // Only the input slot: the title screen has no transcript above it.
    drawChatField(canvas, titleChatBox(canvas.width(), canvas.height()), time);
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
    const Rect column{kChatX, bottom - kChatColumnUp, kChatColumnWidth,
                      kChatColumnUp - kChatColumnDown};
    // The transcript and the line under it, as one box. A press outside it
    // closes the chat, and a press inside must not -- selecting a message is
    // done with the box open.
    const double regionBottom = bottom - kChatFieldUp + kChatFieldHeight;
    chatRegion_ = {column.x, column.y, column.w, regionBottom - column.y};
    // For the wheel, which runs before this draw and needs last frame's box.
    chatColumn_ = column;

    // A leading slash swaps the transcript for the command list -- the
    // reference hides one element and shows the other in the same slot.
    const bool suggesting = chatOpen_ && !chatDraft_.empty() && chatDraft_[0] == '/';
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
            canvas.rect(static_cast<float>(column.x), static_cast<float>(column.y),
                        static_cast<float>(column.w), static_cast<float>(column.h));
            canvas.clip();
            double y = column.y;
            for (std::size_t i = static_cast<std::size_t>(first); i < matches.size(); ++i) {
                if (y >= column.bottom()) break;
                if (static_cast<int>(i) == selected) {
                    setFill(canvas, kPaper, 0.15);
                    canvas.fillRect(static_cast<float>(column.x), static_cast<float>(y),
                                    static_cast<float>(column.w),
                                    static_cast<float>(kChatSuggestionRowHeight));
                }
                const double baseline = y + 4.0 + ascent(kChatSuggestionSize, true);
                const double textX = column.x + 8.0;
                chatRun(canvas, matches[i]->command, textX, baseline, kChatSuggestionSize,
                        0xAADDFFu, 1.0);
                const double afterCommand =
                    textX + measure(matches[i]->command, kChatSuggestionSize, true) + 6.0;
                // The description is ellipsised rather than wrapped: its span
                // is `overflow: hidden; text-overflow: ellipsis; white-space:
                // nowrap`.
                std::string description = std::string("- ") + matches[i]->description;
                const double room = column.right() - 8.0 - afterCommand;
                if (measure(description, 12.0, true) > room) {
                    while (!description.empty() &&
                           measure(description + "...", 12.0, true) > room) {
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
        // The transcript never expires. It flows from the TOP of its column
        // and is scrolled to the bottom only once it overflows, which is what a
        // bottom-anchored overflow:auto block does.
        const double halfLead =
            (kChatLineHeight - (ascent(14.0, true) - descent(14.0, true))) * 0.5;
        const double baselineOffset = halfLead + ascent(14.0, true);

        // How many lines landed since the last frame. A transcript resting at
        // the bottom simply shows them; one the reader has scrolled back
        // through has to be held still against them, below.
        const std::uint64_t arrived = net_.chatSequence() - chatSeenSeq_;
        chatSeenSeq_ = net_.chatSequence();

        // Newest first, and only as far back as the column can show -- plus
        // whatever the wheel has scrolled past the bottom of it. Wrapping a
        // hundred-line transcript every frame to then clip all but six rows of
        // it is work nobody sees.
        //
        // Walked in two goes, the second only when a new line moves the
        // offset, so the walk back is resumed rather than started again.
        std::vector<std::vector<ChatRow>> newestFirst;
        double content = kChatMessageGap;   // the last message's bottom margin
        auto it = net_.chat().rbegin();
        const auto oldest = net_.chat().rend();
        const auto layoutBack = [&](double needed, std::size_t atLeast) {
            for (; it != oldest && (content < needed || newestFirst.size() < atLeast); ++it) {
                std::vector<ChatToken> tokens;
                tokens.push_back({"[" + clockTime(it->wallClockMillis) + "]", 12.0, kPaper, 0.6});
                if (!it->author.empty()) {
                    // Every sender is the same green, whatever channel carried the
                    // line: the reference has no per-channel colouring at all.
                    tokens.push_back({it->author + ":", 14.0, 0x00FF00u, 1.0});
                }
                // The wire carries markup, not plain text: every boss announcement
                // is a <b style="color: ..."> and every multi-line command answer
                // is joined with <br/>. Splitting the raw string on spaces printed
                // the tags as words; parseMarkup turns them back into styling.
                bool afterWhitespace = true;
                for (const ui::MarkupSpan& span : ui::parseMarkup(it->text)) {
                    if (span.lineBreak) {
                        tokens.push_back({{}, 14.0, kPaper, 1.0, false, false, false, true, false});
                        afterWhitespace = true;
                        continue;
                    }
                    const std::uint32_t fill = span.hasColor ? span.color : kPaper;
                    std::size_t at = 0;
                    while (at < span.text.size()) {
                        const std::size_t space = span.text.find_first_of(" \t\r\n", at);
                        const std::string word = span.text.substr(
                            at, space == std::string::npos ? std::string::npos : space - at);
                        if (!word.empty()) {
                            tokens.push_back({word, 14.0, fill, 1.0, span.italic, span.underline,
                                              span.blink, false, !afterWhitespace});
                            afterWhitespace = false;
                        }
                        if (space == std::string::npos) break;
                        afterWhitespace = true;
                        at = space + 1;
                    }
                    // A span ending mid-word ("<b>Hel</b>lo") must not gain a space
                    // at the style change; one ending on a space must keep it.
                    if (!span.text.empty()) {
                        const char last = span.text.back();
                        afterWhitespace = last == ' ' || last == '\t' || last == '\r' || last == '\n';
                    }
                }
                newestFirst.push_back(layoutChatMessage(tokens, column.w));
                content += newestFirst.back().size() * kChatLineHeight + kChatMessageGap;
            }
        };
        // The lines that arrived are laid out whether or not they are in view:
        // their height is what the offset has to move by.
        layoutBack(column.h + chatScroll_,
                   chatScroll_ > 0 ? static_cast<std::size_t>(arrived) : 0);

        // A line landing while the reader is parked up the transcript must not
        // drag what they are reading out from under them. It lands at the
        // BOTTOM, so everything above it moves up by its height -- and the
        // offset is counted off that bottom, so growing it by the same amount
        // leaves the view exactly where it was.
        //
        // The reference cannot do this: its box is a DOM element it forces to
        // `scrollHeight` on every message, which is why reading back through a
        // busy chat there does not work at all.
        if (chatScroll_ > 0 && arrived > 0) {
            const std::size_t landed =
                std::min<std::size_t>(static_cast<std::size_t>(arrived), newestFirst.size());
            double grew = 0;
            for (std::size_t m = 0; m < landed; ++m) {
                grew += newestFirst[m].size() * kChatLineHeight + kChatMessageGap;
            }
            chatScroll_ += grew;
            layoutBack(column.h + chatScroll_, 0);
        }

        // The oldest line is as far back as the wheel goes. Only a walk that
        // reached it knows the whole height, so the ceiling is applied here
        // rather than where the wheel is read; a clamp can only ever LOWER the
        // offset, so there is nothing left to lay out afterwards.
        if (it == oldest) {
            const double slack = content - column.h;
            chatScroll_ = clamp(chatScroll_, 0.0, slack > 0 ? slack : 0.0);
        }
        // A transcript with more than it can show is one a finger can drag --
        // see scrollChat. One that fits keeps its press immediate, so a finger
        // aimed across the corner still swings.
        if (content > column.h || chatScroll_ > 0) {
            ui::TouchScrollRegions::instance().record(column);
        }

        if (!newestFirst.empty()) {
            // A short transcript sits at the TOP of its column; only once it
            // overflows does the box scroll, and then it is pinned to the
            // bottom. That is what an overflow:auto block scrolled to its end
            // does, and it is why a first message appears near the top of the
            // screen rather than just above the input.
            //
            // Scrolling back moves the whole column DOWN by the offset: the
            // newest lines slide out under the input slot and the clip keeps
            // them there.
            const double newestHeight = newestFirst.front().size() * kChatLineHeight;
            const bool overflowing = content >= column.h + chatScroll_;
            double top = (overflowing ? column.bottom() + chatScroll_ : column.y + content) -
                         kChatMessageGap - newestHeight;

            canvas.save();
            canvas.beginPath();
            canvas.rect(static_cast<float>(column.x), static_cast<float>(column.y),
                        static_cast<float>(column.w), static_cast<float>(column.h));
            canvas.clip();
            for (std::size_t m = 0; m < newestFirst.size(); ++m) {
                const std::vector<ChatRow>& rows = newestFirst[m];
                for (std::size_t row = 0; row < rows.size(); ++row) {
                    const double rowTop = top + row * kChatLineHeight;
                    if (rowTop + kChatLineHeight < column.y || rowTop > column.bottom()) continue;
                    for (const ChatPlacedRun& run : rows[row]) {
                        // `blink 1s step-start infinite`, which is what the
                        // reference's <blink> resolves to: shown for the first
                        // half of every second and hidden for the second.
                        if (run.blink && std::fmod(time, 1.0) >= 0.5) continue;
                        chatRun(canvas, run.text, column.x + run.x, rowTop + baselineOffset,
                                run.size, run.fill, run.alpha, run.italic, run.underline);
                    }
                }
                if (m + 1 >= newestFirst.size()) break;
                // The message above this one ends one collapsed margin higher.
                top -= kChatMessageGap + newestFirst[m + 1].size() * kChatLineHeight;
                if (top + newestFirst[m + 1].size() * kChatLineHeight < column.y) break;
            }
            canvas.restore();
        }
    }

    drawChatField(canvas, {kChatX, bottom - kChatFieldUp, kChatColumnWidth, kChatFieldHeight},
                  time);
}

void App::drawChatField(Canvas& canvas, Rect box, double time) {
    chatBox_ = box;
    // A closed slot answers for no keystrokes, so nothing hit-tests it and it
    // would never reach the keyboard regions -- which is exactly the tap that
    // has to raise the keyboard, because it is the tap that opens the line.
    // While it IS open, trackTextMouse records it like every other field.
    if (!chatOpen_) ui::TextFieldRegions::instance().record(box);
    // A dark translucent slot with a hairline white edge -- the reference's
    // chat input, which is the one control in the game that is not drawn in the
    // chunky plate style everything else uses.
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(box.x), static_cast<float>(box.y),
                     static_cast<float>(box.w), static_cast<float>(box.h), 3.0f);
    setFill(canvas, kInk, chatOpen_ ? 0.5 : 0.3);
    canvas.fill();
    // Inset by half the line so the edge lands INSIDE the box, as a one-pixel
    // border does; a centred stroke would make the slot a pixel wider.
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(box.x + 0.5), static_cast<float>(box.y + 0.5),
                     static_cast<float>(box.w - 1.0), static_cast<float>(box.h - 1.0), 2.5f);
    canvas.save();
    canvas.setLineWidth(1.0f);
    setStroke(canvas, kPaper, 0.3);
    canvas.stroke();
    canvas.restore();

    TextStyle line;
    line.size = kChatFieldTextSize;
    line.align = Align::Left;
    line.strokeWidth = 0;
    // The placeholder is a property of the field being EMPTY, not of it being
    // unfocused: an <input> keeps showing it with the caret sitting in front.
    const bool empty = chatDraft_.empty();
    line.fill = empty ? 0x757575u : kPaper;

    ui::TextRun run;
    run.text = chatDraft_;
    run.originX = box.x + 6.0;
    run.size = kChatFieldTextSize;
    if (chatOpen_) {
        // A pale wash: the slot is a dark translucent plate, and the blue one
        // the light fields use disappears into it.
        selectionHighlight(canvas, run, chatField_.selection,
                           Rect{box.x + 2.0, box.y + 3.0, box.w - 4.0, box.h - 6.0}, kPaper,
                           0.30);
    }
    text(canvas, empty ? "Press Enter to chat..." : chatDraft_, run.originX,
         box.y + box.h * 0.5, line);

    if (!chatOpen_) return;
    if (!caretVisible(chatField_, time)) return;
    const double caretX = xOfIndex(run, chatField_.selection.caret);
    setFill(canvas, kPaper);
    canvas.fillRect(static_cast<float>(caretX), static_cast<float>(box.y + 4.0), 1.0f,
                    static_cast<float>(box.h - 8.0));
}

} // namespace flix
