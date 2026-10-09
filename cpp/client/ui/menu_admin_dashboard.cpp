// The admin dashboard: the flowers in the world and one player's bag, flower
// control, and the console's spawn, give and announce behind a form.
//
// Opened from the strip's admin button -- shown only to an account the server
// says is an admin -- or `/admin gui`, and closed by everything that closes a
// panel, and by itself the moment the server stops calling this account an
// admin (MenuSystem::renderOpenPanel). The server checks every request again.
//
// Four tabs:
//
//  * Players: the flowers in the world, a page at a time, searched by account
//    or nameplate, in account order. Picking one shows its bag -- the
//    account's own record, which is what Give adds to -- and offers Control.
//    Rows are named by CONNECTION on the wire (shared/net/admin_dashboard.h),
//    with the account name the row was picked as beside the id, which the
//    server checks it against; the name is otherwise only shown, and typed
//    into Give's command. A pick does not outlive the connection it was made
//    on: when the client's dashboard state is wiped (a drop, another account
//    on the socket) the card lets go of it and asks for the list again.
//
//  * Spawn and Give: the console's `spawn` and `give`, sent AS console
//    commands, so the server's answer lands in chat where the console's
//    answers always do. Each tab keeps its own rarity, held to what its
//    command takes: a mob stops at the top of the ladder, a petal may be given
//    at universal.
//
//  * Announce: `/admin announce`, with the field held to the same byte cap the
//    server enforces (net::kMaxAnnouncementBytes). A temporary grant may type
//    one; the server refuses it, and the refusal is in chat.
//
// Control and Release are the binary requests, answered on this panel's own
// status line. A successful Control closes the card -- the admin has asked to
// play somebody's flower and needs the world in front of them -- and while it
// runs the strip carries a Release chip (MenuSystem::drawReleaseChip).

#include <algorithm>
#include <string>
#include <vector>

#include "client/ui/menu_theme.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "shared/core/text.h"
#include "shared/game/config.h"

namespace flix {

using namespace flix::ui;

namespace {

constexpr double kWidth = 760.0;
constexpr double kHeight = 560.0;
constexpr double kHeaderHeight = 48.0;
constexpr double kFooterHeight = 30.0;
constexpr double kPad = 12.0;
constexpr double kTabHeight = 28.0;
constexpr double kTabGap = 6.0;
/// Under the tab row, before the body starts.
constexpr double kBodyGap = 10.0;
constexpr double kFieldHeight = 30.0;
/// The left column of the Players, Spawn and Give tabs: a search and a list.
constexpr double kListWidth = 300.0;
constexpr double kListRow = 34.0;
constexpr double kBagRow = 26.0;
constexpr double kCountLine = 18.0;
constexpr double kChipHeight = 28.0;
constexpr double kChipGap = 8.0;
/// The picked player's three buttons.
constexpr double kActionChipWidth = 110.0;
constexpr double kRefreshChipWidth = 96.0;
/// The forms' right column: a label, then its control from this far in.
constexpr double kFormControlX = 90.0;
/// The rarity stepper: its two buttons, and how far apart their outer edges
/// stand, with the tier's name centred between them.
constexpr double kStepperButton = 34.0;
constexpr double kStepperSpan = 234.0;
constexpr double kAmountWidth = 110.0;
constexpr double kSubmitWidth = 260.0;
constexpr double kAnnounceWidth = 180.0;
/// How much taller a form's submit button is than the chips around it.
constexpr double kSubmitExtra = 6.0;
constexpr double kWheelStep = 60.0;
constexpr double kScrollbarWidth = 8.0;
/// How long the player search waits after the last keystroke before it asks.
constexpr double kSearchDebounce = 0.3;
/// The longest amount the forms take: six digits, as the console has always
/// been fed. The server caps a spawn at its own batch bound and says so.
constexpr std::size_t kMaxAmountDigits = 6;
/// What the item searches will hold, and the player search. Longer than any
/// id or name, short enough that a paste cannot fill the box with junk.
constexpr std::size_t kSearchBytes = 64;

constexpr double kCardTitleSize = 22.0;
constexpr double kSubtitleSize = 12.0;
constexpr double kRowNameSize = 14.0;
constexpr double kRowDetailSize = 12.0;
constexpr double kBadgeSize = 10.0;
constexpr double kTextSize = 13.0;
constexpr double kPickedSize = 18.0;
constexpr double kTierSize = 15.0;
constexpr double kSubmitTextSize = 14.0;
/// The line an empty column shows in its middle.
constexpr double kEmptySize = 15.0;

constexpr std::uint32_t kDetailInk = 0xD6D6F0u;
constexpr std::uint32_t kDeadInk = 0xFF8A80u;
constexpr std::uint32_t kSteeredInk = 0xFFD166u;   ///< the Admin chat tab's gold
constexpr std::uint32_t kSelfInk = 0x9FE7FFu;
constexpr std::uint32_t kOkInk = 0xB9F6A6u;
constexpr std::uint32_t kBadInk = 0xFFB0B0u;

constexpr ChipStyle kChip{0x7473B0u, 0x48477Au};
constexpr ChipStyle kOnChip{0x9897D2u, 0x48477Au};
constexpr ChipStyle kGoChip{0x4CAF50u, 0x2E7D32u};
constexpr ChipStyle kDangerChip{0xC0504Du, 0x8E3A38u};

enum class Tab : std::uint8_t { Players, Spawn, Give, Announce };
constexpr int kTabCount = 4;
constexpr const char* kTabLabels[kTabCount] = {"Players", "Spawn", "Give", "Announce"};

/// What a click landed on.
enum class Act : std::uint8_t {
    None,
    Close,
    PickTab,
    PickPlayer,
    LoadMorePlayers,
    LoadMoreBag,
    Refresh,
    Control,
    Release,
    PickItem,
    RarityDown,
    RarityUp,
    Spawn,
    Give,
    Announce,
};

struct Hit {
    Rect rect;
    Act act = Act::None;
    int index = -1;
};

/// One of the two catalogue forms: what is searched, what was picked, at
/// which rarity, and how many.
struct ItemForm {
    std::string search;
    TextFieldState searchField;
    Scroller matches;
    /// The picked mob's or petal's id, or empty.
    std::string picked;
    int rarity = 0;
    std::string amount = "1";
    TextFieldState amountField;
};

/// Everything the panel keeps between frames.
///
/// At file scope for the reason the database editor's is: there is one panel,
/// and menus.h is a header every panel shares. reset() starts it over on
/// every open, so nothing one admin left in it greets the next account to
/// open it on this machine.
struct State {
    Tab tab = Tab::Players;
    bool requested = false;
    /// The AdminDashboardState::generation the pick and the list request
    /// below were made under. When the client's moves -- the socket dropped,
    /// or another account signed in on it -- every connection id this holds
    /// came from a connection that is gone, and is let go of.
    std::uint32_t generation = 0;

    std::string search;
    TextFieldState searchField;
    /// When the box changed without the list being asked again, or negative.
    double searchChangedAt = -1;
    Scroller list;

    /// The player picked from the list. By connection, which is how the
    /// server names a row; the account name is what Give types.
    net::ConnectionId selected = 0;
    std::string selectedUsername;
    std::string selectedName;
    Scroller bag;

    ItemForm spawn;
    ItemForm give;

    std::string announcement;
    TextFieldState announcementField;

    std::string status;
    bool statusOk = true;
    std::uint32_t seenResult = 0;
    /// Set while a Control request is out, so its success can close the card.
    bool awaitingControl = false;
};

State& state() {
    static State s;
    return s;
}

TextStyle label(double size, std::uint32_t fill = kPaper, Align align = Align::Left) {
    TextStyle style;
    style.size = size;
    style.fill = fill;
    style.strokeWidth = 0;
    style.align = align;
    style.baseline = Baseline::Middle;
    return style;
}

/// A clickable rect, cut down to the part of it inside `view` -- a half
/// scrolled row must not answer below the pane it is drawn in.
Rect clipTo(Rect r, Rect view) {
    const double x0 = std::max(r.x, view.x);
    const double y0 = std::max(r.y, view.y);
    const double x1 = std::min(r.right(), view.right());
    const double y1 = std::min(r.bottom(), view.bottom());
    return {x0, y0, std::max(0.0, x1 - x0), std::max(0.0, y1 - y0)};
}

void clipCanvas(Canvas& canvas, Rect r) {
    canvas.beginPath();
    canvas.rect(static_cast<float>(r.x), static_cast<float>(r.y), static_cast<float>(r.w),
                static_cast<float>(r.h));
    canvas.clip();
}

/// A small coloured word on a dark pill -- DEAD, STEERED. Drawn right-aligned
/// against `right`; returns its width.
double badge(Canvas& canvas, const std::string& word, double right, double cy, std::uint32_t ink) {
    const double width = measure(word, kBadgeSize) + 10.0;
    fillRound(canvas, Rect{right - width, cy - 8.0, width, 16.0}, 4.0, kInk, 0.35);
    text(canvas, word, right - width * 0.5, cy, label(kBadgeSize, ink, Align::Centre));
    return width;
}

void setStatus(State& s, const std::string& message, bool ok) {
    s.status = message;
    s.statusOk = ok;
}

/// A positive whole number of at most kMaxAmountDigits digits.
bool validAmount(const std::string& amount) {
    if (amount.empty() || amount.size() > kMaxAmountDigits) return false;
    for (const char c : amount) {
        if (c < '0' || c > '9') return false;
    }
    return amount.find_first_not_of('0') != std::string::npos;
}

/// The highest rarity a tab's command takes: the ladder's top for a mob,
/// which no tier above exists for, and universal for a petal.
int rarityCeiling(Tab tab) {
    return tab == Tab::Spawn ? kLadderRarityCount - 1 : kRarityCount - 1;
}

/// One catalogue entry the form can pick.
struct Match {
    std::string id;
    std::string name;
};

/// The mobs or petals whose id or name holds `search`, case-blind, in name
/// order so a search reads like an index.
std::vector<Match> catalogueMatches(bool mobs, const std::string& search) {
    const std::string needle = lowerCase(search);
    const ContentRegistry& registry = content();
    const std::size_t count = mobs ? registry.mobCount() : registry.petalCount();
    std::vector<Match> out;
    for (std::size_t i = 0; i < count; ++i) {
        const auto index = static_cast<std::uint16_t>(i);
        const std::string& id = mobs ? registry.mob(index).id : registry.petal(index).id;
        const std::string& name = mobs ? registry.mob(index).name : registry.petal(index).name;
        if (!needle.empty() && lowerCase(id).find(needle) == std::string::npos &&
            lowerCase(name).find(needle) == std::string::npos) {
            continue;
        }
        out.push_back({id, name.empty() ? id : name});
    }
    std::sort(out.begin(), out.end(), [](const Match& a, const Match& b) {
        const std::string left = lowerCase(a.name);
        const std::string right = lowerCase(b.name);
        return left != right ? left < right : a.id < b.id;
    });
    return out;
}

/// The name a picked id is shown by.
std::string catalogueName(bool mobs, const std::string& id) {
    const ContentRegistry& registry = content();
    if (mobs) {
        const std::uint16_t index = registry.mobIndex(id);
        return index == kInvalidIndex ? id : registry.mob(index).name;
    }
    const std::uint16_t index = registry.petalIndex(id);
    return index == kInvalidIndex ? id : registry.petal(index).name;
}

/// The player list's row for the picked player, if the list holds it.
const net::AdminDashboardPlayer* selectedRow(const AdminDashboardState& d, const State& s) {
    for (const net::AdminDashboardPlayer& row : d.players) {
        if (row.connection == s.selected) return &row;
    }
    return nullptr;
}

/// Why the Control chip is off for this row, or empty when it is on. A guess
/// from what the list said when it was drawn: the server decides, and says.
std::string controlHint(const NetClient& net, const net::AdminDashboardPlayer& row) {
    if (net.controllingFlower()) return "Release the flower you are steering first.";
    if (row.username == net.profile().username) return "That is you.";
    if ((row.flags & net::AdminDashboardDead) != 0) return "That flower is dead.";
    if ((row.flags & net::AdminDashboardControlled) != 0) return "Somebody is steering it already.";
    if ((row.flags & net::AdminDashboardControlling) != 0) {
        return "Its player is steering another flower.";
    }
    if (net.status() != NetClient::Status::Playing) return "Join the world to control a flower.";
    if (row.realm != net.view().realm()) return "That flower is in another realm.";
    return {};
}

} // namespace

double AdminDashboardPanel::preferredWidth() { return kWidth; }
double AdminDashboardPanel::preferredHeight() { return kHeight; }

void AdminDashboardPanel::reset() {
    // From nothing, every open: the selection, the searches and the status
    // are this opening's, and the next account to open the card on this
    // machine must not find the last one's still in it.
    state() = State{};
}

bool AdminDashboardPanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Rect panel = ctx.bounds;
    const Vec2 mouse = ctx.mouse();
    const double now = ctx.timeSeconds;
    NetClient& net = ctx.net;
    const AdminDashboardState& d = net.adminDashboard();
    State& s = state();

    // -- what the server said since last frame -------------------------------

    // A wipe of the client's dashboard state, or simply this card's first
    // frame since it opened. The card stays open through a drop and the redial
    // after it (App::onReconnected closes no menu), and a pick kept across it
    // named a player by an id from the connection that went -- which a
    // restarted server deals out again from 1, to whoever dials in Nth. So the
    // pick goes, the list is asked for again, and nothing still in flight from
    // before is waited on. The tab, the searches and the forms stay: they are
    // the admin's, not the connection's.
    if (s.generation != d.generation) {
        s.generation = d.generation;
        s.requested = false;
        s.selected = 0;
        s.selectedUsername.clear();
        s.selectedName.clear();
        s.list.offset = 0;
        s.bag.offset = 0;
        s.seenResult = d.resultSeq;
        s.awaitingControl = false;
        setStatus(s, std::string(), true);
    }
    // Only while signed in. The first frames after a redial are a socket with
    // no account on it yet, which the server answers with nothing at all, and
    // a list asked for then would read "Searching..." for good.
    if (!s.requested && net.haveSession()) {
        s.requested = true;
        net.adminDashboardPlayers(s.search, 0);
    }
    if (s.searchChangedAt >= 0 && now - s.searchChangedAt >= kSearchDebounce &&
        net.haveSession()) {
        s.searchChangedAt = -1;
        net.adminDashboardPlayers(s.search, 0);
        s.list.offset = 0;
    }
    if (d.resultSeq != s.seenResult) {
        s.seenResult = d.resultSeq;
        setStatus(s, d.resultMessage, d.resultOk);
        // Control has started: the admin asked to play somebody's flower, and
        // the card is standing in front of it.
        if (s.awaitingControl && d.resultOk && net.controllingFlower()) {
            s.awaitingControl = false;
            return false;
        }
        s.awaitingControl = false;
    }

    // -- geometry ------------------------------------------------------------

    std::vector<Hit> regions;
    const auto addRegion = [&](Rect r, Act act, int index = -1) {
        if (r.w > 0 && r.h > 0) regions.push_back({r, act, index});
    };

    overlayCard(canvas, panel, kAdminDashboardSkin);
    TextStyle heading;
    heading.size = kCardTitleSize;
    heading.fill = kPaper;
    heading.baseline = Baseline::Top;
    heading.roundJoin = true;
    text(canvas, "Admin", panel.x + 16.0, panel.y + 12.0, heading);
    text(canvas, "every request is checked by the server", panel.x + 96.0, panel.y + 25.0,
         label(kSubtitleSize, kDetailInk));

    const Rect closeRect = closeButtonRect(panel);
    panelClose(canvas, closeRect, closeRect.contains(mouse));
    addRegion(closeRect, Act::Close);

    const double tabTop = panel.y + kHeaderHeight;
    const double tabWidth = (panel.w - kPad * 2.0 - kTabGap * (kTabCount - 1)) / kTabCount;
    for (int i = 0; i < kTabCount; ++i) {
        const Rect r{panel.x + kPad + i * (tabWidth + kTabGap), tabTop, tabWidth, kTabHeight};
        chip(canvas, r, kTabLabels[i], r.contains(mouse),
             static_cast<int>(s.tab) == i ? kOnChip : kChip);
        addRegion(r, Act::PickTab, i);
    }

    const double footerTop = panel.bottom() - kFooterHeight;
    const Rect body{panel.x + kPad, tabTop + kTabHeight + kBodyGap, panel.w - kPad * 2.0,
                    footerTop - (tabTop + kTabHeight + kBodyGap) - 6.0};
    const Rect left{body.x, body.y, kListWidth, body.h};
    const Rect right{left.right() + kPad, body.y, body.right() - (left.right() + kPad), body.h};

    // Fields as laid out this frame, for the keyboard pass at the end.
    Rect searchRect{};
    Rect itemSearchRect{};
    Rect amountRect{};
    Rect announcementRect{};

    // -- the Players tab -------------------------------------------------------

    if (s.tab == Tab::Players) {
        searchRect = Rect{left.x, left.y, left.w, kFieldHeight};
        inputField(canvas, searchRect, s.search, "Search players", s.searchField.focused, now,
                   &s.searchField);
        double listTop = searchRect.bottom() + 6.0;
        const std::string counted =
            !net.haveSession() ? std::string("Not connected.")
            : d.playersPending && d.players.empty() ? std::string("Searching...")
            : d.playersRefused && d.players.empty() ? std::string("Not loaded -- press Refresh.")
            : withSeparators(d.players.size()) + " of " + withSeparators(d.playersTotal) +
                  (d.playersTotal == 1 ? " flower in the world" : " flowers in the world");
        text(canvas, counted, left.x + 2.0, listTop + 7.0, label(kRowDetailSize, kDetailInk));
        listTop += kCountLine;
        const Rect listView{left.x, listTop, left.w, std::max(0.0, left.bottom() - listTop)};
        fillRound(canvas, listView, 6.0, kInk, 0.16);

        const bool more = d.players.size() < d.playersTotal;
        const int rowCount = static_cast<int>(d.players.size()) + (more ? 1 : 0);
        s.list.contentHeight = rowCount * kListRow + 8.0;
        s.list.viewHeight = listView.h;
        if (listView.contains(mouse)) s.list.offset -= ctx.wheel() * kWheelStep;
        s.list.offset -= touchScroll(ctx.window, listView, s.list.maxOffset() > 0);
        s.list.offset = clamp(s.list.offset, 0.0, s.list.maxOffset());

        canvas.save();
        clipCanvas(canvas, listView);
        const double rowW = listView.w - 8.0 - kScrollbarWidth;
        double y = listView.y + 4.0 - s.list.offset;
        for (int i = 0; i < rowCount; ++i, y += kListRow) {
            const Rect row{listView.x + 4.0, y, rowW, kListRow - 4.0};
            if (row.bottom() < listView.y || row.y > listView.bottom()) continue;
            const bool hovered = clipTo(row, listView).contains(mouse);
            const double cy = row.y + row.h * 0.5;
            if (i == static_cast<int>(d.players.size())) {
                fillRound(canvas, row, 5.0, kPaper, hovered ? 0.18 : 0.08);
                const std::uint32_t remaining =
                    d.playersTotal - static_cast<std::uint32_t>(d.players.size());
                text(canvas,
                     d.playersPending ? "Loading..." : "Load more (" + withSeparators(remaining) + ")",
                     row.x + row.w * 0.5, cy, label(kTextSize, kPaper, Align::Centre));
                addRegion(clipTo(row, listView), Act::LoadMorePlayers);
                continue;
            }
            const net::AdminDashboardPlayer& player = d.players[static_cast<std::size_t>(i)];
            const bool picked = player.connection == s.selected;
            fillRound(canvas, row, 5.0, kPaper, picked ? 0.3 : hovered ? 0.16 : 0.07);
            double badgeRight = row.right() - 6.0;
            if ((player.flags & net::AdminDashboardDead) != 0) {
                badgeRight -= badge(canvas, "DEAD", badgeRight, cy, kDeadInk) + 4.0;
            }
            if ((player.flags & net::AdminDashboardControlled) != 0) {
                badgeRight -= badge(canvas, "STEERED", badgeRight, cy, kSteeredInk) + 4.0;
            }
            if ((player.flags & net::AdminDashboardControlling) != 0) {
                badgeRight -= badge(canvas, "STEERING", badgeRight, cy, kSteeredInk) + 4.0;
            }
            if (player.username == net.profile().username) {
                badgeRight -= badge(canvas, "YOU", badgeRight, cy, kSelfInk) + 4.0;
            }
            // The account first: it is who the row IS, and what every command
            // names. The nameplate after it is only what their flower says.
            const std::string account = "@" + player.username;
            const double nameRoom = badgeRight - row.x - 14.0;
            const std::string shownAccount = ellipsize(account, kRowNameSize, nameRoom);
            text(canvas, shownAccount, row.x + 8.0, cy, label(kRowNameSize));
            const double plateX = row.x + 8.0 + measure(shownAccount, kRowNameSize) + 8.0;
            if (player.name != player.username && plateX < badgeRight - 30.0) {
                text(canvas, ellipsize(player.name, kRowDetailSize, badgeRight - plateX - 6.0),
                     plateX, cy, label(kRowDetailSize, kDetailInk));
            }
            addRegion(clipTo(row, listView), Act::PickPlayer, i);
        }
        if (rowCount == 0) {
            text(canvas, d.playersPending ? "" : "No flower in the world matches.",
                 listView.x + listView.w * 0.5, listView.y + 24.0,
                 label(kTextSize, kPaper, Align::Centre));
        }
        canvas.restore();
        scrollbar(canvas, Rect{listView.x, listView.y + 4.0, listView.w - 2.0, listView.h - 13.0},
                  s.list.contentHeight, s.list.offset, kAdminDashboardSkin.accent, kScrollbarWidth);

        // The right column: the picked player, what can be done to them, and
        // their bag.
        fillRound(canvas, right, 6.0, kInk, 0.16);
        const net::AdminDashboardPlayer* row = selectedRow(d, s);
        const double hy = right.y + 20.0;
        if (s.selected == 0) {
            text(canvas, "Pick a player on the left.", right.x + right.w * 0.5,
                 right.y + right.h * 0.5, label(kEmptySize, kPaper, Align::Centre));
        } else {
            TextStyle name = label(kPickedSize);
            name.roundJoin = true;
            const std::string title = ellipsize("@" + s.selectedUsername, kPickedSize, right.w - 24.0);
            text(canvas, title, right.x + 12.0, hy, name);
            if (!s.selectedName.empty() && s.selectedName != s.selectedUsername) {
                text(canvas, ellipsize(s.selectedName, kRowDetailSize, right.w - 24.0),
                     right.x + 12.0, hy + 20.0, label(kRowDetailSize, kDetailInk));
            }

            // The actions. Control is offered only when the list says it can
            // work; the server is still the one that decides.
            const double cy = hy + 38.0;
            // A player no longer in the rows -- the search moved on, or the
            // list is a page behind -- is still worth asking for: the server
            // knows where they are, and says.
            std::string hint;
            if (row != nullptr) hint = controlHint(net, *row);
            else if (net.controllingFlower()) hint = "Release the flower you are steering first.";
            ChipStyle control = kGoChip;
            control.enabled = hint.empty();
            const Rect controlRect{right.x + 12.0, cy, kActionChipWidth, kChipHeight};
            chip(canvas, controlRect, "Control", control.enabled && controlRect.contains(mouse),
                 control);
            if (control.enabled) addRegion(controlRect, Act::Control);
            ChipStyle release = kDangerChip;
            release.enabled = net.controllingFlower();
            const Rect releaseRect{controlRect.right() + kChipGap, cy, kActionChipWidth, kChipHeight};
            chip(canvas, releaseRect, "Release", release.enabled && releaseRect.contains(mouse),
                 release);
            if (release.enabled) addRegion(releaseRect, Act::Release);
            const Rect refreshRect{releaseRect.right() + kChipGap, cy, kRefreshChipWidth, kChipHeight};
            chip(canvas, refreshRect, "Refresh", refreshRect.contains(mouse), kChip);
            addRegion(refreshRect, Act::Refresh);
            if (!hint.empty()) {
                text(canvas, ellipsize(hint, kRowDetailSize, right.w - 24.0), right.x + 12.0,
                     cy + kChipHeight + 12.0, label(kRowDetailSize, kDetailInk));
            }

            // The bag: the account's own record, best tier first.
            const double bagTop = cy + kChipHeight + 26.0;
            const std::string bagCaption =
                d.bagGone ? std::string("That player has left.")
                : d.bagPending && d.bag.empty() ? std::string("Loading the bag...")
                : d.bagRefused && d.bag.empty() ? std::string("Bag not loaded -- press Refresh.")
                    : "Bag: " + withSeparators(d.bagTotal) +
                          (d.bagTotal == 1 ? " stack" : " stacks") +
                          (d.bag.size() < d.bagTotal
                               ? " (" + withSeparators(d.bag.size()) + " shown)"
                               : std::string());
            text(canvas, bagCaption, right.x + 12.0, bagTop + 8.0, label(kTextSize));
            const Rect bagView{right.x + 4.0, bagTop + kCountLine + 4.0, right.w - 8.0,
                               std::max(0.0, right.bottom() - 4.0 - (bagTop + kCountLine + 4.0))};
            const bool moreBag = !d.bagGone && d.bag.size() < d.bagTotal;
            const int bagRows = static_cast<int>(d.bag.size()) + (moreBag ? 1 : 0);
            s.bag.contentHeight = bagRows * kBagRow + 8.0;
            s.bag.viewHeight = bagView.h;
            if (bagView.contains(mouse)) s.bag.offset -= ctx.wheel() * kWheelStep;
            s.bag.offset -= touchScroll(ctx.window, bagView, s.bag.maxOffset() > 0);
            s.bag.offset = clamp(s.bag.offset, 0.0, s.bag.maxOffset());

            canvas.save();
            clipCanvas(canvas, bagView);
            double by = bagView.y + 4.0 - s.bag.offset;
            const double bagRight = bagView.right() - kScrollbarWidth - 6.0;
            for (int i = 0; i < bagRows; ++i, by += kBagRow) {
                const Rect line{bagView.x + 4.0, by, bagRight - bagView.x - 4.0, kBagRow - 2.0};
                if (line.bottom() < bagView.y || line.y > bagView.bottom()) continue;
                const double ly = line.y + line.h * 0.5;
                if (i == static_cast<int>(d.bag.size())) {
                    const bool hovered = clipTo(line, bagView).contains(mouse);
                    fillRound(canvas, line, 4.0, kPaper, hovered ? 0.18 : 0.08);
                    text(canvas, d.bagPending ? "Loading..." : std::string("Load more"),
                         line.x + line.w * 0.5, ly, label(kTextSize, kPaper, Align::Centre));
                    addRegion(clipTo(line, bagView), Act::LoadMoreBag);
                    continue;
                }
                const net::AdminDashboardStack& stack = d.bag[static_cast<std::size_t>(i)];
                fillRound(canvas, Rect{line.x, line.y + 4.0, 6.0, line.h - 8.0}, 2.0,
                          rarityColor(stack.rarity));
                const std::string petal = stack.petalIndex < content().petalCount()
                                              ? catalogueName(false, content().petal(stack.petalIndex).id)
                                              : std::string("?");
                text(canvas, ellipsize(petal, kTextSize, line.w * 0.5), line.x + 14.0, ly,
                     label(kTextSize));
                text(canvas, rarityLabel(stack.rarity), line.x + line.w * 0.62, ly,
                     label(kRowDetailSize, rarityColor(stack.rarity)));
                text(canvas, "x" + withSeparators(stack.count), line.right() - 6.0, ly,
                     label(kTextSize, kPaper, Align::Right));
            }
            if (bagRows == 0 && !d.bagPending && !d.bagGone) {
                text(canvas, "Empty.", bagView.x + bagView.w * 0.5, bagView.y + 24.0,
                     label(kTextSize, kPaper, Align::Centre));
            }
            canvas.restore();
            scrollbar(canvas, Rect{bagView.x, bagView.y + 4.0, bagView.w - 2.0, bagView.h - 13.0},
                      s.bag.contentHeight, s.bag.offset, kAdminDashboardSkin.accent,
                      kScrollbarWidth);
        }
    }

    // -- the Spawn and Give tabs -------------------------------------------------

    std::vector<Match> matches;
    if (s.tab == Tab::Spawn || s.tab == Tab::Give) {
        const bool mobs = s.tab == Tab::Spawn;
        ItemForm& form = mobs ? s.spawn : s.give;
        itemSearchRect = Rect{left.x, left.y, left.w, kFieldHeight};
        inputField(canvas, itemSearchRect, form.search, mobs ? "Search mobs" : "Search petals",
                   form.searchField.focused, now, &form.searchField);
        matches = catalogueMatches(mobs, form.search);
        double listTop = itemSearchRect.bottom() + 6.0;
        text(canvas, withSeparators(matches.size()) + (matches.size() == 1 ? " match" : " matches"),
             left.x + 2.0, listTop + 7.0, label(kRowDetailSize, kDetailInk));
        listTop += kCountLine;
        const Rect listView{left.x, listTop, left.w, std::max(0.0, left.bottom() - listTop)};
        fillRound(canvas, listView, 6.0, kInk, 0.16);

        form.matches.contentHeight = static_cast<double>(matches.size()) * kBagRow + 8.0;
        form.matches.viewHeight = listView.h;
        if (listView.contains(mouse)) form.matches.offset -= ctx.wheel() * kWheelStep;
        form.matches.offset -= touchScroll(ctx.window, listView, form.matches.maxOffset() > 0);
        form.matches.offset = clamp(form.matches.offset, 0.0, form.matches.maxOffset());

        canvas.save();
        clipCanvas(canvas, listView);
        double y = listView.y + 4.0 - form.matches.offset;
        const double rowW = listView.w - 8.0 - kScrollbarWidth;
        for (std::size_t i = 0; i < matches.size(); ++i, y += kBagRow) {
            const Rect row{listView.x + 4.0, y, rowW, kBagRow - 2.0};
            if (row.bottom() < listView.y || row.y > listView.bottom()) continue;
            const bool hovered = clipTo(row, listView).contains(mouse);
            const bool picked = matches[i].id == form.picked;
            fillRound(canvas, row, 4.0, kPaper, picked ? 0.3 : hovered ? 0.16 : 0.06);
            const double cy = row.y + row.h * 0.5;
            const double idWidth = std::min(measure(matches[i].id, kRowDetailSize), rowW * 0.45);
            text(canvas, ellipsize(matches[i].name, kTextSize, rowW - idWidth - 22.0),
                 row.x + 8.0, cy, label(kTextSize));
            text(canvas, ellipsize(matches[i].id, kRowDetailSize, idWidth), row.right() - 6.0, cy,
                 label(kRowDetailSize, kDetailInk, Align::Right));
            addRegion(clipTo(row, listView), Act::PickItem, static_cast<int>(i));
        }
        if (matches.empty()) {
            text(canvas, "Nothing matches.", listView.x + listView.w * 0.5, listView.y + 24.0,
                 label(kTextSize, kPaper, Align::Centre));
        }
        canvas.restore();
        scrollbar(canvas, Rect{listView.x, listView.y + 4.0, listView.w - 2.0, listView.h - 13.0},
                  form.matches.contentHeight, form.matches.offset, kAdminDashboardSkin.accent,
                  kScrollbarWidth);

        // The right column: the order, as it will be typed into the console.
        fillRound(canvas, right, 6.0, kInk, 0.16);
        form.rarity = std::clamp(form.rarity, 0, rarityCeiling(s.tab));
        const Rarity rarity = static_cast<Rarity>(form.rarity);
        double ry = right.y + 20.0;
        const std::string purpose =
            mobs ? std::string("Spawned at your own flower, even while you steer another.")
                 : (s.selectedUsername.empty() ? std::string("Pick a player on the Players tab first.")
                                               : "Given to @" + s.selectedUsername +
                                                     "'s account, online or not.");
        text(canvas, ellipsize(purpose, kTextSize, right.w - 24.0), right.x + 12.0, ry,
             label(kTextSize, kDetailInk));
        ry += 30.0;
        TextStyle pickedStyle = label(kPickedSize);
        pickedStyle.roundJoin = true;
        text(canvas,
             form.picked.empty()
                 ? std::string(mobs ? "Pick a mob on the left." : "Pick a petal on the left.")
                 : ellipsize(catalogueName(mobs, form.picked), kPickedSize, right.w - 24.0),
             right.x + 12.0, ry, pickedStyle);
        ry += 34.0;

        // Rarity: stepped, and held to what the command takes on this tab.
        text(canvas, "Rarity", right.x + 12.0, ry + kChipHeight * 0.5, label(kTextSize));
        const Rect down{right.x + kFormControlX, ry, kStepperButton, kChipHeight};
        const Rect up{down.x + kStepperSpan - kStepperButton, ry, kStepperButton, kChipHeight};
        ChipStyle downStyle = kChip;
        downStyle.enabled = form.rarity > 0;
        ChipStyle upStyle = kChip;
        upStyle.enabled = form.rarity < rarityCeiling(s.tab);
        chip(canvas, down, "<", downStyle.enabled && down.contains(mouse), downStyle);
        chip(canvas, up, ">", upStyle.enabled && up.contains(mouse), upStyle);
        if (downStyle.enabled) addRegion(down, Act::RarityDown);
        if (upStyle.enabled) addRegion(up, Act::RarityUp);
        TextStyle tier = label(kTierSize, rarityColor(rarity), Align::Centre);
        tier.strokeWidth = -1;
        text(canvas, rarityLabel(rarity), (down.right() + up.x) * 0.5, ry + kChipHeight * 0.5, tier);
        ry += kChipHeight + 14.0;

        text(canvas, "Amount", right.x + 12.0, ry + kFieldHeight * 0.5, label(kTextSize));
        amountRect = Rect{right.x + kFormControlX, ry, kAmountWidth, kFieldHeight};
        inputField(canvas, amountRect, form.amount, "1", form.amountField.focused, now,
                   &form.amountField);
        ry += kFieldHeight + 18.0;

        const bool ready = !form.picked.empty() && validAmount(form.amount) &&
                           (mobs || !s.selectedUsername.empty());
        ChipStyle go = kGoChip;
        go.enabled = ready;
        go.textSize = kSubmitTextSize;
        const Rect action{right.x + 12.0, ry, kSubmitWidth, kChipHeight + kSubmitExtra};
        chip(canvas, action, mobs ? "Spawn at your flower" : "Give",
             ready && action.contains(mouse), go);
        if (ready) addRegion(action, mobs ? Act::Spawn : Act::Give);
        if (!validAmount(form.amount)) {
            text(canvas,
                 "The amount is a whole number from 1 to " + std::string(kMaxAmountDigits, '9') +
                     ".",
                 right.x + 12.0, action.bottom() + 16.0, label(kRowDetailSize, kBadInk));
        }
    }

    // -- the Announce tab --------------------------------------------------------

    if (s.tab == Tab::Announce) {
        fillRound(canvas, body, 6.0, kInk, 0.16);
        double ay = body.y + 22.0;
        text(canvas, "Every player sees a banner for eight seconds, and the line in their "
                     "Admin chat tab.",
             body.x + 12.0, ay, label(kTextSize));
        ay += 20.0;
        text(canvas, "Full admins only: a temporary grant is refused, and the refusal is in chat.",
             body.x + 12.0, ay, label(kTextSize, kDetailInk));
        ay += 26.0;
        announcementRect = Rect{body.x + 12.0, ay, body.w - 24.0, kFieldHeight + 4.0};
        inputField(canvas, announcementRect, s.announcement, "What everyone should read",
                   s.announcementField.focused, now, &s.announcementField);
        ay = announcementRect.bottom() + 12.0;
        text(canvas,
             std::to_string(s.announcement.size()) + " / " +
                 std::to_string(net::kMaxAnnouncementBytes) + " bytes",
             announcementRect.right(), ay, label(kRowDetailSize, kDetailInk, Align::Right));
        const bool ready = s.announcement.find_first_not_of(' ') != std::string::npos;
        ChipStyle go = kGoChip;
        go.enabled = ready;
        go.textSize = kSubmitTextSize;
        const Rect action{body.x + 12.0, ay - kSubmitExtra, kAnnounceWidth,
                          kChipHeight + kSubmitExtra};
        chip(canvas, action, "Announce", ready && action.contains(mouse), go);
        if (ready) addRegion(action, Act::Announce);
    }

    // -- the footer: how the last request went -------------------------------

    {
        const double fy = footerTop + kFooterHeight * 0.5 - 3.0;
        const std::string hint = "Enter submits, Esc leaves a field";
        const double hintW = measure(hint, kRowDetailSize);
        text(canvas, hint, panel.right() - kPad, fy, label(kRowDetailSize, kDetailInk, Align::Right));
        if (!s.status.empty()) {
            text(canvas, ellipsize(s.status, kTextSize, panel.w - kPad * 3 - hintW), panel.x + kPad,
                 fy, label(kTextSize, s.statusOk ? kOkInk : kBadInk));
        }
    }

    // -- the orders, as console commands --------------------------------------

    const auto sendSpawn = [&] {
        ItemForm& form = s.spawn;
        const std::string rarity = rarityName(static_cast<Rarity>(form.rarity));
        net.sendChat("/admin spawn " + form.picked + " " + rarity + " " + form.amount);
        setStatus(s, "Asked the server to spawn " + form.amount + " " + rarity + " " +
                         catalogueName(true, form.picked) + ". Its answer is in chat.",
                  true);
    };
    const auto sendGive = [&] {
        ItemForm& form = s.give;
        const std::string rarity = rarityName(static_cast<Rarity>(form.rarity));
        // By ACCOUNT, which is what `give` resolves -- never the connection
        // the list names the row by, which no console command reads.
        net.sendChat("/admin give " + s.selectedUsername + " " + form.picked + " " + rarity + " " +
                     form.amount);
        setStatus(s, "Asked the server to give @" + s.selectedUsername + " " + form.amount + " " +
                         rarity + " " + catalogueName(false, form.picked) +
                         ". Its answer is in chat.",
                  true);
    };
    const auto sendAnnouncement = [&] {
        net.sendChat("/admin announce " + s.announcement);
        setStatus(s, "Announcement sent. If the server refused it, the reason is in chat.", true);
        s.announcement.clear();
        s.announcementField.blur();
    };

    // -- keyboard ------------------------------------------------------------

    const bool enter = ctx.window.keyPressed(Key::Enter);
    const bool escape = ctx.window.keyPressed(Key::Escape);

    if (searchRect.w > 0) {
        trackTextMouse(ctx.window, s.searchField, searchRect,
                       inputFieldRun(searchRect, s.search, s.searchField), s.search, now);
        if (s.searchField.focused) {
            ctx.wantsText = true;
            TextEditOptions typing;
            typing.maxBytes = kSearchBytes;
            if (editText(ctx.window, s.search, s.searchField, now, typing)) s.searchChangedAt = now;
            if (enter) {
                s.searchChangedAt = -1;
                net.adminDashboardPlayers(s.search, 0);
                s.list.offset = 0;
            }
            if (escape) s.searchField.blur();
        }
    }
    if (itemSearchRect.w > 0) {
        ItemForm& form = s.tab == Tab::Spawn ? s.spawn : s.give;
        trackTextMouse(ctx.window, form.searchField, itemSearchRect,
                       inputFieldRun(itemSearchRect, form.search, form.searchField), form.search,
                       now);
        trackTextMouse(ctx.window, form.amountField, amountRect,
                       inputFieldRun(amountRect, form.amount, form.amountField), form.amount, now);
        if (form.searchField.focused) {
            ctx.wantsText = true;
            TextEditOptions typing;
            typing.maxBytes = kSearchBytes;
            if (editText(ctx.window, form.search, form.searchField, now, typing)) {
                form.matches.offset = 0;
            }
            // Enter takes the first match, which is what a search is usually
            // typed to find.
            if (enter && !matches.empty()) form.picked = matches.front().id;
            if (escape) form.searchField.blur();
        }
        if (form.amountField.focused) {
            ctx.wantsText = true;
            TextEditOptions digits;
            digits.maxBytes = kMaxAmountDigits;
            digits.asciiOnly = true;
            editText(ctx.window, form.amount, form.amountField, now, digits);
            if (enter && validAmount(form.amount) && !form.picked.empty()) {
                if (s.tab == Tab::Spawn) {
                    sendSpawn();
                } else if (!s.selectedUsername.empty()) {
                    sendGive();
                }
            }
            if (escape) form.amountField.blur();
        }
    }
    if (announcementRect.w > 0) {
        trackTextMouse(ctx.window, s.announcementField, announcementRect,
                       inputFieldRun(announcementRect, s.announcement, s.announcementField),
                       s.announcement, now);
        if (s.announcementField.focused) {
            ctx.wantsText = true;
            TextEditOptions typing;
            // The server's own cap, so the box never takes what it would
            // refuse; trimmed on a character boundary by the editor.
            typing.maxBytes = net::kMaxAnnouncementBytes;
            editText(ctx.window, s.announcement, s.announcementField, now, typing);
            if (enter && s.announcement.find_first_not_of(' ') != std::string::npos) {
                sendAnnouncement();
            } else if (escape) {
                s.announcementField.blur();
            }
        }
    }

    // -- clicks --------------------------------------------------------------

    if (!ctx.released()) return true;
    for (auto it = regions.rbegin(); it != regions.rend(); ++it) {
        const Hit& region = *it;
        if (!region.rect.contains(mouse)) continue;
        switch (region.act) {
            case Act::None:
                break;
            case Act::Close:
                return false;
            case Act::PickTab:
                s.tab = static_cast<Tab>(region.index);
                s.searchField.blur();
                s.spawn.searchField.blur();
                s.spawn.amountField.blur();
                s.give.searchField.blur();
                s.give.amountField.blur();
                s.announcementField.blur();
                break;
            case Act::PickPlayer:
                if (region.index >= 0 && region.index < static_cast<int>(d.players.size())) {
                    const net::AdminDashboardPlayer& player =
                        d.players[static_cast<std::size_t>(region.index)];
                    s.selected = player.connection;
                    s.selectedUsername = player.username;
                    s.selectedName = player.name;
                    s.bag.offset = 0;
                    net.adminDashboardInventory(player.connection, player.username, 0);
                }
                break;
            case Act::LoadMorePlayers:
                if (!d.playersPending) {
                    net.adminDashboardPlayers(d.playersSearch,
                                              static_cast<std::uint32_t>(d.players.size()));
                }
                break;
            case Act::LoadMoreBag:
                if (!d.bagPending && s.selected != 0) {
                    net.adminDashboardInventory(s.selected, s.selectedUsername,
                                                static_cast<std::uint32_t>(d.bag.size()));
                }
                break;
            case Act::Refresh:
                net.adminDashboardPlayers(s.search, 0);
                s.list.offset = 0;
                if (s.selected != 0) {
                    net.adminDashboardInventory(s.selected, s.selectedUsername, 0);
                    s.bag.offset = 0;
                }
                break;
            case Act::Control:
                // With the account the row was picked as, so a connection that
                // has since become somebody else is refused rather than taken.
                if (s.selected != 0) {
                    s.awaitingControl = true;
                    net.adminControl(s.selected, s.selectedUsername);
                    setStatus(s, "Asking to control @" + s.selectedUsername + "...", true);
                }
                break;
            case Act::Release:
                net.adminRelease();
                break;
            case Act::PickItem:
                if (region.index >= 0 && region.index < static_cast<int>(matches.size())) {
                    ItemForm& form = s.tab == Tab::Spawn ? s.spawn : s.give;
                    form.picked = matches[static_cast<std::size_t>(region.index)].id;
                }
                break;
            case Act::RarityDown:
            case Act::RarityUp: {
                ItemForm& form = s.tab == Tab::Spawn ? s.spawn : s.give;
                form.rarity = std::clamp(form.rarity + (region.act == Act::RarityUp ? 1 : -1), 0,
                                         rarityCeiling(s.tab));
                break;
            }
            case Act::Spawn:
                sendSpawn();
                break;
            case Act::Give:
                sendGive();
                break;
            case Act::Announce:
                sendAnnouncement();
                break;
        }
        break;
    }
    return true;
}

} // namespace flix
