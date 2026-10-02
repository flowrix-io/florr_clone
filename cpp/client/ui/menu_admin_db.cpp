// The admin database editor: every account, and every table the server keeps
// as raw JSON, as trees an admin can read and change.
//
// Opened only by `/admin db [username]`. It has no strip button and no key:
// the server answers that command with an Open message for a database-flagged
// admin and with nothing for anyone else, so the panel cannot be reached by
// someone it would refuse, and every request it sends is checked again there.
//
// The left column picks a document -- an account, found by name, or a table --
// and the right column is that document as a tree. A value is changed by
// clicking it, typing, and pressing Enter; a field is added with the + on the
// object or array that will hold it, and removed with its x, which asks twice.
// Nothing is changed here first: the request goes out, the server re-reads the
// row through the same parse a restart would, and what comes back is drawn.
// So the tree is always what the database holds, and the line at the foot of
// the card says so when the server stored something other than what was typed.

#include <algorithm>
#include <cctype>
#include <ctime>
#include <set>
#include <string>
#include <vector>

#include "client/ui/menu_theme.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "shared/core/json.h"

namespace flix {

using namespace flix::ui;

namespace {

constexpr double kWidth = 980.0;
constexpr double kHeight = 640.0;
constexpr double kHeaderHeight = 48.0;
constexpr double kFooterHeight = 30.0;
constexpr double kPad = 12.0;
constexpr double kListWidth = 280.0;
constexpr double kTabHeight = 26.0;
constexpr double kFieldHeight = 30.0;
constexpr double kListRow = 32.0;
constexpr double kTreeRow = 24.0;
constexpr double kIndent = 16.0;
constexpr double kDocHeader = 40.0;
constexpr double kWheelStep = 60.0;
constexpr double kScrollbarWidth = 8.0;
/// How long the search box waits after the last keystroke before it asks.
constexpr double kSearchDebounce = 0.3;
/// How long a destructive button stays armed for its second click.
constexpr double kArmSeconds = 3.0;

constexpr std::uint32_t kStringInk = 0xFFE9A8u;
constexpr std::uint32_t kNumberInk = 0xA8E6FFu;
constexpr std::uint32_t kBoolInk = 0xD9BFFFu;
constexpr std::uint32_t kNullInk = 0xBDBDBDu;
constexpr std::uint32_t kAdminInk = 0xFFC94Du;
constexpr std::uint32_t kMutedInk = 0xFF8A80u;
constexpr std::uint32_t kOnlineDot = 0x7DFF7Du;
constexpr std::uint32_t kOfflineDot = 0x8A8A8Au;
constexpr std::uint32_t kOkInk = 0xB9F6A6u;
constexpr std::uint32_t kBadInk = 0xFFB0B0u;

constexpr ChipStyle kChip{0x6C7884u, 0x48515Au};
constexpr ChipStyle kDangerChip{0xC0504Du, 0x8E3A38u};
constexpr ChipStyle kGoChip{0x4CAF50u, 0x2E7D32u};

/// What a click landed on.
enum class Act : std::uint8_t {
    None,
    Close,
    TabAccounts,
    TabTables,
    PickAccount,
    PickTable,
    LoadMore,
    Toggle,
    Edit,
    Add,
    AddEntry,
    Remove,
    SaveEdit,
    SaveAdd,
    Password,
    SavePassword,
    CancelPassword,
    SignOut,
    Delete,
};

struct Hit {
    Rect rect;
    Act act = Act::None;
    int index = -1;
};

/// One drawn line of the tree.
struct TreeRow {
    enum class Kind : std::uint8_t { Value, Add, Loading };
    Kind kind = Kind::Value;
    int depth = 0;
    std::string key;
    const net::AdminDbNode* node = nullptr;
    net::AdminDbPath path;
    bool parentIsArray = false;
    /// Shown but not editable: an account's id, name and admin flag, and text
    /// too long to have been sent.
    bool locked = false;
    /// Has no x: the two sections of an account document.
    bool fixed = false;
};

/// Everything the panel keeps between frames.
///
/// At file scope for the reason the guild panel's dialog is: there is one
/// panel, and menus.h is a header every panel shares.
struct State {
    bool accountsTab = true;
    bool requested = false;

    std::string search;
    TextFieldState searchField;
    /// When the box changed without the list being asked again, or negative.
    double searchChangedAt = -1;

    Scroller list;
    Scroller tree;

    /// Which document the expansion below belongs to.
    bool docSeen = false;
    net::AdminDbScope docScope = net::AdminDbScope::Account;
    std::string docKey;
    std::set<std::string> expanded;

    bool editing = false;
    net::AdminDbPath editPath;
    bool editString = false;
    std::string editText;
    TextFieldState editField;

    bool adding = false;
    net::AdminDbPath addParent;
    bool addToArray = false;
    std::string addKey;
    TextFieldState addKeyField;
    std::string addValue;
    TextFieldState addValueField;

    bool passwording = false;
    std::string password;
    TextFieldState passwordField;

    /// The one destructive button waiting for its second click.
    std::string armed;
    double armedAt = -100;

    std::string status;
    bool statusOk = true;
    std::uint32_t seenResult = 0;
    std::uint32_t seenGone = 0;
};

State& state() {
    static State s;
    return s;
}

std::string lowered(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

std::string trimmedText(const std::string& s) {
    const std::size_t first = s.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const std::size_t last = s.find_last_not_of(" \t\r\n");
    return s.substr(first, last - first + 1);
}

/// A path as one string, for the expansion set and the armed button. The
/// separator is a control character no key in the file can hold.
std::string pathKey(const net::AdminDbPath& path) {
    std::string out;
    for (const std::string& step : path) {
        out += step;
        out += '\x1f';
    }
    return out;
}

/// The identity a document is remembered under: an account's name in any
/// case, since the server answers with the stored spelling of a typed one.
std::string docIdentity(net::AdminDbScope scope, const std::string& key) {
    return scope == net::AdminDbScope::Account ? "a:" + lowered(key) : "t:" + key;
}

TextStyle label(double size, bool bold, std::uint32_t fill = kPaper, Align align = Align::Left) {
    TextStyle style;
    style.size = size;
    style.bold = bold;
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

void dot(Canvas& canvas, double x, double y, double radius, std::uint32_t colour) {
    setFill(canvas, colour);
    canvas.beginPath();
    canvas.arc(static_cast<float>(x), static_cast<float>(y), static_cast<float>(radius), 0.0f,
               static_cast<float>(kTau));
    canvas.fill();
}

/// A small coloured word on a dark pill -- ADMIN, MUTED. Returns its width.
double badge(Canvas& canvas, const std::string& word, double x, double cy, std::uint32_t ink) {
    const double width = measure(word, 10.0, true) + 10.0;
    fillRound(canvas, Rect{x, cy - 8.0, width, 16.0}, 4.0, kInk, 0.35);
    text(canvas, word, x + width * 0.5, cy, label(10.0, true, ink, Align::Centre));
    return width;
}

/// The disclosure triangle in front of an object or array.
void disclosure(Canvas& canvas, double x, double cy, bool open) {
    setFill(canvas, kPaper, 0.85);
    canvas.beginPath();
    if (open) {
        canvas.moveTo(static_cast<float>(x - 4.0), static_cast<float>(cy - 2.5));
        canvas.lineTo(static_cast<float>(x + 4.0), static_cast<float>(cy - 2.5));
        canvas.lineTo(static_cast<float>(x), static_cast<float>(cy + 3.5));
    } else {
        canvas.moveTo(static_cast<float>(x - 2.5), static_cast<float>(cy - 4.0));
        canvas.lineTo(static_cast<float>(x + 3.5), static_cast<float>(cy));
        canvas.lineTo(static_cast<float>(x - 2.5), static_cast<float>(cy + 4.0));
    }
    canvas.closePath();
    canvas.fill();
}

std::uint32_t valueInk(const net::AdminDbNode& node) {
    switch (node.type) {
        case Json::Type::String: return kStringInk;
        case Json::Type::Number: return kNumberInk;
        case Json::Type::Bool: return kBoolInk;
        case Json::Type::Null: return kNullInk;
        case Json::Type::Array:
        case Json::Type::Object: break;
    }
    return kNullInk;
}

/// How a value reads in its row. Strings keep their quotes, so "12" and 12
/// cannot be mistaken for one another.
std::string valueText(const net::AdminDbNode& node) {
    switch (node.type) {
        case Json::Type::String:
            if (node.unloaded) return "(" + withSeparators(node.size) + " bytes of text)";
            return jsonEscape(node.text);
        case Json::Type::Array:
            return "[" + withSeparators(node.size) + (node.size == 1 ? " item]" : " items]");
        case Json::Type::Object:
            return "{" + withSeparators(node.size) + (node.size == 1 ? " field}" : " fields}");
        case Json::Type::Null:
        case Json::Type::Bool:
        case Json::Type::Number:
            break;
    }
    return net::adminDbScalarText(node);
}

/// "1 entry", "3 items": a table's size the way its kind counts it.
std::string entriesText(std::uint32_t count, bool isArray) {
    const char* noun = isArray ? (count == 1 ? " item" : " items")
                               : (count == 1 ? " entry" : " entries");
    return withSeparators(count) + noun;
}

/// A timestamp's date, for a number that is plainly one: a key that names a
/// moment ("createdAt", "timestamp") holding Unix millis in this century.
/// Empty for anything else -- a guess shown as fact would be worse than none.
std::string timestampHint(const std::string& key, const net::AdminDbNode& node) {
    if (node.type != Json::Type::Number) return {};
    const bool named = key == "timestamp" ||
                       (key.size() > 2 && key.compare(key.size() - 2, 2, "At") == 0);
    if (!named || node.number < 1.0e12 || node.number >= 4.1e12) return {};
    const std::time_t seconds = static_cast<std::time_t>(node.number / 1000.0);
    std::tm utc{};
    if (gmtime_r(&seconds, &utc) == nullptr) return {};
    char buffer[32];
    std::strftime(buffer, sizeof buffer, "%Y-%m-%d %H:%M UTC", &utc);
    return buffer;
}

void flatten(const net::AdminDbNode& node, net::AdminDbPath& path, int depth, const State& s,
             bool accountDoc, std::vector<TreeRow>& out) {
    for (std::size_t i = 0; i < node.children.size(); ++i) {
        const net::AdminDbNode& child = node.children[i];
        path.push_back(node.keys[i]);
        TreeRow row;
        row.depth = depth;
        row.key = node.keys[i];
        row.node = &child;
        row.path = path;
        row.parentIsArray = node.type == Json::Type::Array;
        row.fixed = accountDoc && depth == 0;
        // The server refuses all three of these whatever the panel sends;
        // drawing them read-only only saves the admin the round trip.
        row.locked = (child.type == Json::Type::String && child.unloaded) ||
                     (accountDoc && path.size() == 2 && path[0] == "account" &&
                      (path[1] == "id" || path[1] == "username" || path[1] == "admin"));
        out.push_back(row);
        if (child.container() && s.expanded.count(pathKey(path)) != 0) {
            if (s.adding && s.addParent == path) {
                TreeRow add;
                add.kind = TreeRow::Kind::Add;
                add.depth = depth + 1;
                add.path = path;
                out.push_back(add);
            }
            if (child.unloaded) {
                TreeRow loading;
                loading.kind = TreeRow::Kind::Loading;
                loading.depth = depth + 1;
                out.push_back(loading);
            } else {
                flatten(child, path, depth + 1, s, accountDoc, out);
            }
        }
        path.pop_back();
    }
}

void setStatus(State& s, const std::string& message, bool ok) {
    s.status = message;
    s.statusOk = ok;
}

void cancelEdits(State& s) {
    s.editing = false;
    s.editField.blur();
    s.adding = false;
    s.addKeyField.blur();
    s.addValueField.blur();
}

/// Arms `what`, or reports that it was already armed -- the second click.
bool confirmArmed(State& s, const std::string& what, double now) {
    if (s.armed == what && now - s.armedAt <= kArmSeconds) {
        s.armed.clear();
        return true;
    }
    s.armed = what;
    s.armedAt = now;
    return false;
}

bool isArmed(const State& s, const std::string& what, double now) {
    return s.armed == what && now - s.armedAt <= kArmSeconds;
}

void startEdit(State& s, const TreeRow& row, double now) {
    cancelEdits(s);
    s.editing = true;
    s.editPath = row.path;
    s.editString = row.node->type == Json::Type::String;
    s.editText = net::adminDbScalarText(*row.node);
    s.editField.focus(s.editText, now);
}

void startAdd(State& s, const net::AdminDbPath& parent, bool toArray, double now) {
    cancelEdits(s);
    s.adding = true;
    s.addParent = parent;
    s.addToArray = toArray;
    s.addKey.clear();
    s.addValue.clear();
    if (toArray) s.addValueField.focusAtEnd(s.addValue, now);
    else s.addKeyField.focusAtEnd(s.addKey, now);
    s.expanded.insert(pathKey(parent));
}

void commitEdit(State& s, NetClient& net) {
    std::string json;
    if (s.editString) {
        // A string field takes the text as typed: quoting it is the panel's
        // job, and an admin fixing a name should not have to escape it.
        json = jsonEscape(s.editText);
    } else {
        json = trimmedText(s.editText);
        Json probe;
        std::string error;
        if (!Json::parse(json, probe, error)) {
            setStatus(s, "That is not a valid value. Numbers, true, false and null are typed "
                         "bare; text goes in \"quotes\".", false);
            return;
        }
    }
    net.adminDbSet(s.editPath, json);
    s.editing = false;
    s.editField.blur();
}

void commitAdd(State& s, NetClient& net) {
    const std::string key = trimmedText(s.addKey);
    if (!s.addToArray && key.empty()) {
        setStatus(s, "Give the new field a name.", false);
        return;
    }
    const std::string typed = trimmedText(s.addValue);
    if (typed.empty()) {
        setStatus(s, "Type a value: a number, true, false, null, text, {} or [].", false);
        return;
    }
    // Anything that parses is taken as JSON; anything else is text. So 12 is
    // a number, "12" is text, {} is an empty object, and hello is "hello".
    Json probe;
    std::string error;
    const std::string json = Json::parse(typed, probe, error) ? typed : jsonEscape(typed);
    net::AdminDbPath path = s.addParent;
    path.push_back(s.addToArray ? std::string("-") : key);
    net.adminDbSet(path, json);
    s.adding = false;
    s.addKeyField.blur();
    s.addValueField.blur();
}

} // namespace

double AdminDbPanel::preferredWidth() { return kWidth; }
double AdminDbPanel::preferredHeight() { return kHeight; }

void AdminDbPanel::reset() {
    State& s = state();
    // The search and the open document survive a close and reopen: an admin
    // who closed the card to look at the world comes back to where they were.
    // Only what is mid-gesture goes.
    s.requested = false;
    s.searchField.blur();
    cancelEdits(s);
    s.passwording = false;
    s.passwordField.blur();
    s.armed.clear();
}

bool AdminDbPanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Rect panel = ctx.bounds;
    const Vec2 mouse = ctx.mouse();
    const double now = ctx.timeSeconds;
    NetClient& net = ctx.net;
    AdminDbState& db = net.adminDb();
    State& s = state();

    // -- what the server said since last frame -------------------------------

    if (!db.openUsername.empty()) {
        // `/admin db <name>`: find the account and open it.
        s.accountsTab = true;
        s.search = db.openUsername;
        s.searchChangedAt = -1;
        net.adminDbList(s.search, 0);
        net.adminDbOpen(net::AdminDbScope::Account, db.openUsername);
        db.openUsername.clear();
        s.requested = true;
        net.adminDbTables();
    }
    if (!s.requested) {
        s.requested = true;
        net.adminDbList(s.search, 0);
        net.adminDbTables();
    }
    if (db.resultSeq != s.seenResult) {
        s.seenResult = db.resultSeq;
        setStatus(s, db.resultMessage, db.resultOk);
    }
    if (db.goneSeq != s.seenGone) {
        // A document was deleted: the list it was in is out of date.
        s.seenGone = db.goneSeq;
        net.adminDbList(s.search, 0);
        net.adminDbTables();
    }
    if (s.searchChangedAt >= 0 && now - s.searchChangedAt >= kSearchDebounce) {
        s.searchChangedAt = -1;
        net.adminDbList(s.search, 0);
        s.list.offset = 0;
    }
    // A new document starts collapsed, but for the two halves of an account,
    // which are what anyone opening one has come to read.
    const std::string identity = db.documentOpen ? docIdentity(db.scope, db.key) : std::string();
    if (identity != (s.docSeen ? docIdentity(s.docScope, s.docKey) : std::string())) {
        s.docSeen = db.documentOpen;
        s.docScope = db.scope;
        s.docKey = db.key;
        s.expanded.clear();
        if (db.scope == net::AdminDbScope::Account) {
            s.expanded.insert(pathKey({"account"}));
            s.expanded.insert(pathKey({"progress"}));
        }
        s.tree.offset = 0;
        cancelEdits(s);
        s.passwording = false;
        s.armed.clear();
    }
    if (!s.armed.empty() && now - s.armedAt > kArmSeconds) s.armed.clear();

    // -- geometry ------------------------------------------------------------

    const double bodyTop = panel.y + kHeaderHeight;
    const double footerTop = panel.bottom() - kFooterHeight;
    const Rect left{panel.x + kPad, bodyTop, kListWidth, footerTop - bodyTop - 6.0};
    const Rect right{left.right() + kPad, bodyTop, panel.right() - kPad - (left.right() + kPad),
                     left.h};

    std::vector<Hit> regions;
    const auto addRegion = [&](Rect r, Act act, int index = -1) {
        if (r.w > 0 && r.h > 0) regions.push_back({r, act, index});
    };

    overlayCard(canvas, panel, kAdminDbSkin);
    TextStyle heading;
    heading.size = 22.0;
    heading.bold = true;
    heading.fill = kPaper;
    heading.strokeWidth = 4.0;
    heading.baseline = Baseline::Top;
    heading.roundJoin = true;
    text(canvas, "Database", panel.x + 16.0, panel.y + 12.0, heading);
    text(canvas, "admin only - edits are saved at once", panel.x + 140.0, panel.y + 25.0,
         label(12.0, false, kPaper));

    const Rect closeRect = closeButtonRect(panel);
    panelClose(canvas, closeRect, closeRect.contains(mouse));
    addRegion(closeRect, Act::Close);

    // -- the left column: tabs, search, list ---------------------------------

    const double tabW = (left.w - 6.0) * 0.5;
    const Rect accountsTab{left.x, left.y, tabW, kTabHeight};
    const Rect tablesTab{left.x + tabW + 6.0, left.y, tabW, kTabHeight};
    {
        ChipStyle on = kChip;
        on.fill = 0x8A98A6u;
        chip(canvas, accountsTab, "Accounts", accountsTab.contains(mouse),
             s.accountsTab ? on : kChip);
        chip(canvas, tablesTab, "Tables", tablesTab.contains(mouse), s.accountsTab ? kChip : on);
        addRegion(accountsTab, Act::TabAccounts);
        addRegion(tablesTab, Act::TabTables);
    }

    double listTop = accountsTab.bottom() + 8.0;
    const Rect searchRect{left.x, listTop, left.w, kFieldHeight};
    if (s.accountsTab) {
        inputField(canvas, searchRect, s.search, "Search accounts", s.searchField.focused, now,
                   &s.searchField);
        listTop = searchRect.bottom() + 6.0;
        const std::string counted =
            db.listPending && db.accounts.empty()
                ? std::string("Searching...")
                : withSeparators(db.accounts.size()) + " of " + withSeparators(db.listTotal) +
                      (db.listTotal == 1 ? " account" : " accounts");
        text(canvas, counted, left.x + 2.0, listTop + 7.0, label(12.0, false, kPaper));
        listTop += 18.0;
    }
    const Rect listView{left.x, listTop, left.w, std::max(0.0, left.bottom() - listTop)};
    fillRound(canvas, listView, 6.0, kInk, 0.16);

    {
        const int rowCount = s.accountsTab
                                 ? static_cast<int>(db.accounts.size()) +
                                       (db.accounts.size() < db.listTotal ? 1 : 0)
                                 : static_cast<int>(db.tables.size());
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

            if (s.accountsTab && i == static_cast<int>(db.accounts.size())) {
                fillRound(canvas, row, 5.0, kPaper, hovered ? 0.18 : 0.08);
                const std::uint32_t remaining =
                    db.listTotal - static_cast<std::uint32_t>(db.accounts.size());
                text(canvas,
                     db.listPending ? "Loading..." : "Load more (" + withSeparators(remaining) + ")",
                     row.x + row.w * 0.5, cy, label(13.0, true, kPaper, Align::Centre));
                addRegion(clipTo(row, listView), Act::LoadMore);
                continue;
            }

            bool selected = false;
            if (s.accountsTab) {
                const AdminDbAccountRow& account = db.accounts[static_cast<std::size_t>(i)];
                selected = db.documentOpen && db.scope == net::AdminDbScope::Account &&
                           lowered(db.key) == lowered(account.username);
                fillRound(canvas, row, 5.0, kPaper, selected ? 0.3 : hovered ? 0.16 : 0.07);
                dot(canvas, row.x + 11.0, cy, 4.5,
                    (account.flags & net::AdminDbOnline) != 0 ? kOnlineDot : kOfflineDot);
                double badgesW = 0;
                const std::string level = "Lv " + std::to_string(account.level);
                const double levelW = measure(level, 12.0, false);
                double bx = row.right() - 8.0 - levelW;
                if ((account.flags & net::AdminDbMuted) != 0) {
                    const double w = measure("MUTED", 10.0, true) + 10.0;
                    bx -= w + 4.0;
                    badge(canvas, "MUTED", bx, cy, kMutedInk);
                    badgesW += w + 4.0;
                }
                if ((account.flags & net::AdminDbIsAdmin) != 0) {
                    const double w = measure("ADMIN", 10.0, true) + 10.0;
                    bx -= w + 4.0;
                    badge(canvas, "ADMIN", bx, cy, kAdminInk);
                    badgesW += w + 4.0;
                }
                text(canvas, level, row.right() - 8.0, cy, label(12.0, false, kPaper, Align::Right));
                const double nameW = row.w - 30.0 - levelW - badgesW - 12.0;
                text(canvas, ellipsize(account.username, 13.0, true, nameW), row.x + 22.0, cy,
                     label(13.0, true));
                addRegion(clipTo(row, listView), Act::PickAccount, i);
            } else {
                const AdminDbTableRow& table = db.tables[static_cast<std::size_t>(i)];
                selected = db.documentOpen && db.scope == net::AdminDbScope::Table &&
                           db.key == table.name;
                fillRound(canvas, row, 5.0, kPaper, selected ? 0.3 : hovered ? 0.16 : 0.07);
                const std::string count = entriesText(table.entries, table.isArray);
                text(canvas, count, row.right() - 8.0, cy, label(12.0, false, kPaper, Align::Right));
                text(canvas,
                     ellipsize(table.name, 13.0, true, row.w - 24.0 - measure(count, 12.0, false)),
                     row.x + 10.0, cy, label(13.0, true));
                addRegion(clipTo(row, listView), Act::PickTable, i);
            }
        }
        if (rowCount == 0) {
            const std::string empty = s.accountsTab ? (db.listPending ? "" : "No accounts match.")
                                                    : "The database has no other tables.";
            text(canvas, empty, listView.x + listView.w * 0.5, listView.y + 24.0,
                 label(13.0, false, kPaper, Align::Centre));
        }
        canvas.restore();
        scrollbar(canvas, Rect{listView.x, listView.y + 4.0, listView.w - 2.0, listView.h - 13.0},
                  s.list.contentHeight, s.list.offset, kAdminDbSkin.accent, kScrollbarWidth);
    }

    // -- the right column: the open document ---------------------------------

    fillRound(canvas, right, 6.0, kInk, 0.16);
    const bool accountDoc = db.documentOpen && db.scope == net::AdminDbScope::Account;
    Rect passwordRect{};
    std::vector<TreeRow> rows;
    Rect treeView{};

    if (!db.documentOpen) {
        text(canvas, "Pick an account or a table on the left.", right.x + right.w * 0.5,
             right.y + right.h * 0.5, label(15.0, false, kPaper, Align::Centre));
    } else {
        // The header: what is open, and what can be done to it as a whole.
        const double hy = right.y + kDocHeader * 0.5 + 2.0;
        TextStyle name = label(18.0, true);
        name.strokeWidth = 3.0;
        name.roundJoin = true;
        double hx = right.x + 12.0;
        if (accountDoc) {
            dot(canvas, hx + 5.0, hy, 5.0,
                (db.flags & net::AdminDbOnline) != 0 ? kOnlineDot : kOfflineDot);
            hx += 16.0;
        }
        const double actionsW = accountDoc ? 3 * 92.0 + 2 * 6.0 : 100.0;
        const std::string title = ellipsize(db.key, 18.0, true, right.w - actionsW - 160.0);
        text(canvas, title, hx, hy, name);
        hx += measure(title, 18.0, true) + 10.0;
        if (accountDoc) {
            if ((db.flags & net::AdminDbIsAdmin) != 0) hx += badge(canvas, "ADMIN", hx, hy, kAdminInk) + 4.0;
            if ((db.flags & net::AdminDbMuted) != 0) hx += badge(canvas, "MUTED", hx, hy, kMutedInk) + 4.0;
            text(canvas, (db.flags & net::AdminDbOnline) != 0 ? "online" : "offline", hx, hy,
                 label(12.0, false, kPaper));

            double bx = right.right() - 10.0;
            const auto action = [&](const std::string& caption, Act act, const ChipStyle& style) {
                const Rect r{bx - 92.0, hy - 13.0, 92.0, 26.0};
                chip(canvas, r, caption, r.contains(mouse), style);
                addRegion(r, act);
                bx -= 92.0 + 6.0;
            };
            const bool deleteArmed = isArmed(s, "account-delete", now);
            const bool signOutArmed = isArmed(s, "account-signout", now);
            action(deleteArmed ? "Sure?" : "Delete", Act::Delete, kDangerChip);
            action(signOutArmed ? "Sure?" : "Sign out", Act::SignOut,
                   signOutArmed ? kDangerChip : kChip);
            action("Password", Act::Password, kChip);
        } else {
            const AdminDbTableRow* table = nullptr;
            for (const AdminDbTableRow& t : db.tables) {
                if (t.name == db.key) table = &t;
            }
            if (db.loaded) {
                text(canvas, entriesText(db.root.size, db.root.type == Json::Type::Array), hx, hy,
                     label(12.0, false, kPaper));
            }
            const Rect add{right.right() - 10.0 - 100.0, hy - 13.0, 100.0, 26.0};
            chip(canvas, add, "+ Entry", add.contains(mouse), kGoChip);
            addRegion(add, Act::AddEntry, table != nullptr && table->isArray ? 1 : 0);
        }

        double treeTop = right.y + kDocHeader + 4.0;
        if (accountDoc && s.passwording) {
            // Set password: its own row, because it is not a field of the
            // document -- the hash is not shown, and the action does more than
            // store it.
            const double py = treeTop + 2.0;
            text(canvas, "New password", right.x + 12.0, py + 14.0, label(13.0, true));
            passwordRect = Rect{right.x + 112.0, py, 240.0, 28.0};
            inputField(canvas, passwordRect, s.password, "8 characters or more",
                       s.passwordField.focused, now, &s.passwordField);
            const Rect set{passwordRect.right() + 8.0, py + 1.0, 64.0, 26.0};
            const Rect cancel{set.right() + 6.0, py + 1.0, 70.0, 26.0};
            chip(canvas, set, "Set", set.contains(mouse), kGoChip);
            chip(canvas, cancel, "Cancel", cancel.contains(mouse), kChip);
            addRegion(set, Act::SavePassword);
            addRegion(cancel, Act::CancelPassword);
            treeTop += 36.0;
        }

        treeView = Rect{right.x + 4.0, treeTop, right.w - 8.0, right.bottom() - 4.0 - treeTop};
        setFill(canvas, kPaper, 0.12);
        canvas.fillRect(static_cast<float>(right.x + 8.0), static_cast<float>(treeTop - 3.0),
                        static_cast<float>(right.w - 16.0), 1.0f);

        if (!db.loaded) {
            text(canvas, "Loading...", treeView.x + treeView.w * 0.5, treeView.y + 30.0,
                 label(14.0, false, kPaper, Align::Centre));
        } else {
            net::AdminDbPath path;
            if (s.adding && s.addParent.empty()) {
                TreeRow add;
                add.kind = TreeRow::Kind::Add;
                rows.push_back(add);
            }
            flatten(db.root, path, 0, s, accountDoc, rows);
            if (rows.empty()) {
                text(canvas, "Empty.", treeView.x + treeView.w * 0.5, treeView.y + 30.0,
                     label(14.0, false, kPaper, Align::Centre));
            }
        }

        s.tree.contentHeight = static_cast<double>(rows.size()) * kTreeRow + 8.0;
        s.tree.viewHeight = treeView.h;
        if (treeView.contains(mouse)) s.tree.offset -= ctx.wheel() * kWheelStep;
        s.tree.offset -= touchScroll(ctx.window, treeView, s.tree.maxOffset() > 0);
        s.tree.offset = clamp(s.tree.offset, 0.0, s.tree.maxOffset());

        canvas.save();
        clipCanvas(canvas, treeView);
        const double rowRight = treeView.right() - kScrollbarWidth - 6.0;
        double y = treeView.y + 4.0 - s.tree.offset;
        for (std::size_t i = 0; i < rows.size(); ++i, y += kTreeRow) {
            const TreeRow& row = rows[i];
            const Rect rowRect{treeView.x + 2.0, y, rowRight - treeView.x - 2.0, kTreeRow};
            if (rowRect.bottom() < treeView.y || rowRect.y > treeView.bottom()) continue;
            const double cy = y + kTreeRow * 0.5;
            const double x0 = treeView.x + 10.0 + row.depth * kIndent;
            const bool hovered = clipTo(rowRect, treeView).contains(mouse);

            if (row.kind == TreeRow::Kind::Loading) {
                text(canvas, "Loading...", x0 + 12.0, cy, label(12.0, false, kNullInk));
                continue;
            }
            if (row.kind == TreeRow::Kind::Add) {
                fillRound(canvas, Rect{rowRect.x, rowRect.y + 1.0, rowRect.w, rowRect.h - 2.0},
                          4.0, kPaper, 0.12);
                double fx = x0 + 12.0;
                if (!s.addToArray) {
                    const Rect keyRect{fx, y + 2.0, 150.0, kTreeRow - 4.0};
                    inputField(canvas, keyRect, s.addKey, "name", s.addKeyField.focused, now,
                               &s.addKeyField);
                    trackTextMouse(ctx.window, s.addKeyField, keyRect,
                                   inputFieldRun(keyRect, s.addKey, s.addKeyField), s.addKey, now);
                    fx = keyRect.right() + 6.0;
                }
                const Rect save{rowRight - 56.0, y + 3.0, 52.0, kTreeRow - 6.0};
                const Rect valueRect{fx, y + 2.0, std::max(60.0, save.x - 6.0 - fx), kTreeRow - 4.0};
                inputField(canvas, valueRect, s.addValue, "value", s.addValueField.focused, now,
                           &s.addValueField);
                trackTextMouse(ctx.window, s.addValueField, valueRect,
                               inputFieldRun(valueRect, s.addValue, s.addValueField), s.addValue,
                               now);
                ChipStyle small = kGoChip;
                small.textSize = 12.0;
                chip(canvas, save, "Add", save.contains(mouse), small);
                addRegion(clipTo(save, treeView), Act::SaveAdd);
                continue;
            }

            const net::AdminDbNode& node = *row.node;
            const bool editingThis = s.editing && s.editPath == row.path;
            if (hovered || editingThis) {
                fillRound(canvas, rowRect, 4.0, kPaper, 0.09);
            }
            const bool container = node.container();
            const bool open = container && s.expanded.count(pathKey(row.path)) != 0;
            if (container) disclosure(canvas, x0 + 4.0, cy, open);

            const std::string keyText = row.parentIsArray ? "[" + row.key + "]" : row.key;
            const double keyX = x0 + 12.0;
            const double keyMax = std::max(40.0, (rowRight - keyX) * 0.45);
            const std::string shownKey = ellipsize(keyText, 13.0, true, keyMax);
            text(canvas, shownKey, keyX, cy,
                 label(13.0, true, row.parentIsArray ? kNullInk : kPaper));
            const double valueX = keyX + measure(shownKey, 13.0, true) + 12.0;

            // The row's buttons, right-aligned: an x on everything that may be
            // deleted, and a + on everything that can hold more. Collected
            // apart and filed AFTER the row's own region, because the click
            // pass tests the last-filed first and a button must beat its row.
            double bx = rowRight - 4.0;
            const bool showActions = (hovered || editingThis) && !row.locked;
            std::vector<Hit> buttons;
            const auto rowButton = [&](const std::string& caption, Act act, const ChipStyle& style,
                                       double w) {
                const Rect r{bx - w, y + 3.0, w, kTreeRow - 6.0};
                ChipStyle small = style;
                small.textSize = 12.0;
                chip(canvas, r, caption, r.contains(mouse), small);
                const Rect hitbox = clipTo(r, treeView);
                if (hitbox.w > 0 && hitbox.h > 0) {
                    buttons.push_back({hitbox, act, static_cast<int>(i)});
                }
                bx -= w + 4.0;
            };

            Hit rowRegion{clipTo(rowRect, treeView), Act::None, static_cast<int>(i)};
            if (editingThis) {
                rowButton("Save", Act::SaveEdit, kGoChip, 52.0);
                const Rect field{valueX, y + 2.0, std::max(80.0, bx - 4.0 - valueX), kTreeRow - 4.0};
                inputField(canvas, field, s.editText, "", s.editField.focused, now, &s.editField);
                trackTextMouse(ctx.window, s.editField, field,
                               inputFieldRun(field, s.editText, s.editField), s.editText, now);
            } else {
                const bool armed = isArmed(s, "rm:" + pathKey(row.path), now);
                if ((showActions || armed) && !row.fixed) {
                    rowButton(armed ? "Delete?" : "x", Act::Remove, kDangerChip, armed ? 64.0 : 22.0);
                }
                if (showActions && container && !node.unloaded) {
                    rowButton("+", Act::Add, kGoChip, 22.0);
                }
                const double valueMax = std::max(20.0, bx - 6.0 - valueX);
                const std::string shown = ellipsize(valueText(node), 13.0, false, valueMax);
                text(canvas, shown, valueX, cy,
                     label(13.0, false, container ? kNullInk : valueInk(node)));
                const std::string when = timestampHint(row.key, node);
                const double whenX = valueX + measure(shown, 13.0, false) + 10.0;
                if (!when.empty() && whenX + measure(when, 12.0, false) < bx - 6.0) {
                    text(canvas, when, whenX, cy, label(12.0, false, kNullInk));
                }
                if (row.locked && hovered) {
                    text(canvas, "read only", rowRight - 6.0, cy,
                         label(11.0, false, kNullInk, Align::Right));
                }
                rowRegion.act = container ? Act::Toggle : (row.locked ? Act::None : Act::Edit);
            }
            if (rowRegion.rect.w > 0 && rowRegion.rect.h > 0) regions.push_back(rowRegion);
            regions.insert(regions.end(), buttons.begin(), buttons.end());
        }
        canvas.restore();
        scrollbar(canvas, Rect{treeView.x, treeView.y + 4.0, treeView.w - 2.0, treeView.h - 13.0},
                  s.tree.contentHeight, s.tree.offset, kAdminDbSkin.accent, kScrollbarWidth);
    }

    // -- the footer: how the last request went -------------------------------

    {
        const double fy = footerTop + kFooterHeight * 0.5 - 3.0;
        const std::string hint = "Enter saves, Esc cancels";
        const double hintW = measure(hint, 12.0, false);
        text(canvas, hint, panel.right() - kPad, fy, label(12.0, false, kPaper, Align::Right));
        if (!s.status.empty()) {
            text(canvas, ellipsize(s.status, 13.0, true, panel.w - kPad * 3 - hintW), panel.x + kPad,
                 fy, label(13.0, true, s.statusOk ? kOkInk : kBadInk));
        }
    }

    // -- keyboard ------------------------------------------------------------

    if (s.accountsTab) {
        trackTextMouse(ctx.window, s.searchField, searchRect,
                       inputFieldRun(searchRect, s.search, s.searchField), s.search, now);
    }
    if (s.passwording && passwordRect.w > 0) {
        trackTextMouse(ctx.window, s.passwordField, passwordRect,
                       inputFieldRun(passwordRect, s.password, s.passwordField), s.password, now);
    }

    const bool enter = ctx.window.keyPressed(Key::Enter);
    const bool escape = ctx.window.keyPressed(Key::Escape);
    TextEditOptions typing;
    typing.maxBytes = 4000;

    if (s.searchField.focused) {
        ctx.wantsText = true;
        TextEditOptions search;
        search.maxBytes = 64;
        if (editText(ctx.window, s.search, s.searchField, now, search)) s.searchChangedAt = now;
        if (enter) {
            s.searchChangedAt = -1;
            net.adminDbList(s.search, 0);
            s.list.offset = 0;
        }
        if (escape) s.searchField.blur();
    }
    if (s.editing && s.editField.focused) {
        ctx.wantsText = true;
        editText(ctx.window, s.editText, s.editField, now, typing);
        if (enter) commitEdit(s, net);
    }
    if (s.editing && escape) cancelEdits(s);
    if (s.adding && (s.addKeyField.focused || s.addValueField.focused)) {
        ctx.wantsText = true;
        if (s.addKeyField.focused) {
            TextEditOptions keyTyping;
            keyTyping.maxBytes = 200;
            editText(ctx.window, s.addKey, s.addKeyField, now, keyTyping);
            if (ctx.window.keyPressed(Key::Tab)) {
                s.addKeyField.blur();
                s.addValueField.focusAtEnd(s.addValue, now);
            }
        } else {
            editText(ctx.window, s.addValue, s.addValueField, now, typing);
        }
        if (enter) commitAdd(s, net);
    }
    if (s.adding && escape) cancelEdits(s);
    if (s.passwording && s.passwordField.focused) {
        ctx.wantsText = true;
        TextEditOptions secret;
        secret.maxBytes = 128;
        secret.copyable = false;
        editText(ctx.window, s.password, s.passwordField, now, secret);
        if (enter && !s.password.empty()) {
            net.adminDbSetPassword(db.key, s.password);
            s.password.clear();
            s.passwording = false;
            s.passwordField.blur();
        }
        if (escape) {
            s.passwording = false;
            s.passwordField.blur();
        }
    }
    if (escape) s.armed.clear();

    // -- clicks --------------------------------------------------------------

    if (!ctx.released()) return true;
    for (auto it = regions.rbegin(); it != regions.rend(); ++it) {
        const Hit& region = *it;
        if (!region.rect.contains(mouse)) continue;
        const TreeRow* row = region.index >= 0 && static_cast<std::size_t>(region.index) < rows.size()
                                 ? &rows[static_cast<std::size_t>(region.index)]
                                 : nullptr;
        switch (region.act) {
            case Act::None:
                break;
            case Act::Close:
                return false;
            case Act::TabAccounts:
                if (!s.accountsTab) {
                    s.accountsTab = true;
                    s.list.offset = 0;
                }
                break;
            case Act::TabTables:
                if (s.accountsTab) {
                    s.accountsTab = false;
                    s.list.offset = 0;
                    s.searchField.blur();
                    net.adminDbTables();
                }
                break;
            case Act::PickAccount:
                if (region.index < static_cast<int>(db.accounts.size())) {
                    net.adminDbOpen(net::AdminDbScope::Account,
                                    db.accounts[static_cast<std::size_t>(region.index)].username);
                }
                break;
            case Act::PickTable:
                if (region.index < static_cast<int>(db.tables.size())) {
                    net.adminDbOpen(net::AdminDbScope::Table,
                                    db.tables[static_cast<std::size_t>(region.index)].name);
                }
                break;
            case Act::LoadMore:
                if (!db.listPending) {
                    net.adminDbList(db.listSearch, static_cast<std::uint32_t>(db.accounts.size()));
                }
                break;
            case Act::Toggle:
                if (row != nullptr) {
                    const std::string key = pathKey(row->path);
                    if (s.expanded.erase(key) == 0) {
                        s.expanded.insert(key);
                        // A container the server sent shut is asked for the
                        // first time it is opened.
                        const bool asked = std::find(db.fetching.begin(), db.fetching.end(),
                                                     row->path) != db.fetching.end();
                        if (row->node->unloaded && !asked) net.adminDbFetch(row->path);
                    }
                }
                break;
            case Act::Edit:
                if (row != nullptr) startEdit(s, *row, now);
                break;
            case Act::Add:
                if (row != nullptr) {
                    startAdd(s, row->path, row->node->type == Json::Type::Array, now);
                }
                break;
            case Act::AddEntry:
                startAdd(s, {}, region.index == 1, now);
                break;
            case Act::Remove:
                if (row != nullptr && confirmArmed(s, "rm:" + pathKey(row->path), now)) {
                    net.adminDbRemove(row->path);
                }
                break;
            case Act::SaveEdit:
                commitEdit(s, net);
                break;
            case Act::SaveAdd:
                commitAdd(s, net);
                break;
            case Act::Password:
                cancelEdits(s);
                s.passwording = !s.passwording;
                s.password.clear();
                if (s.passwording) s.passwordField.focusAtEnd(s.password, now);
                else s.passwordField.blur();
                break;
            case Act::SavePassword:
                if (s.password.empty()) {
                    setStatus(s, "Type the new password first.", false);
                } else {
                    net.adminDbSetPassword(db.key, s.password);
                    s.password.clear();
                    s.passwording = false;
                    s.passwordField.blur();
                }
                break;
            case Act::CancelPassword:
                s.password.clear();
                s.passwording = false;
                s.passwordField.blur();
                break;
            case Act::SignOut:
                if (confirmArmed(s, "account-signout", now)) net.adminDbSignOut(db.key);
                break;
            case Act::Delete:
                if (confirmArmed(s, "account-delete", now)) net.adminDbDeleteAccount(db.key);
                break;
        }
        break;
    }
    return true;
}

} // namespace flix
