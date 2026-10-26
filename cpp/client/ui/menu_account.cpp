// Account.
//
// The one card about the account itself rather than anything it owns: who is
// signed in, the username a guest may pick -- once -- the password, signing in
// to a different account, and Log Out. A first visit lands on a guest account
// the server made and named (App::updateConnecting), so this card, not a login
// form, is where a player turns that into an account of their own.
//
// Every control here is a request to the server. The card checks what can be
// checked on this side of the round trip and puts the server's answer under
// the form that asked; it decides nothing. Which sections it shows is the
// Profile's two account flags: the username form only for a guest, and the
// password form without its "current" box for an account whose owner was never
// told one.
//
// The password form and Log Out used to be the settings card's Advanced tab's
// account block, and keep its look: captions over standard square inputs,
// gardn buttons, one caret shared by every box.
//
// Like the settings card, its state lives at file scope: there is exactly one
// account card in the process, so a file-scope instance is the same thing as a
// member, and AccountPanel stays a plain class beside its siblings.

#include <algorithm>
#include <array>
#include <string>

#include "client/ui/menu_theme.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "shared/core/text.h"

namespace flix {

using namespace flix::ui;

namespace {

// --- layout -----------------------------------------------------------------

constexpr double kWidth = 420.0;
constexpr double kHeight = 700.0;
constexpr double kPad = 15.0;
constexpr double kHeaderHeight = 30.0;
constexpr double kFieldHeight = 32.0;
constexpr double kFieldGap = 8.0;
constexpr double kButtonWidth = 160.0;
constexpr double kButtonHeight = 32.0;
constexpr double kSectionGap = 18.0;
/// Chrome reports 100 CSS px of deltaY per wheel notch; SDL reports one notch
/// as 1.0. The settings card's step, for the same reason.
constexpr double kWheelStep = 100.0;
/// How long a button that asks twice stays armed after the first click.
constexpr double kArmSeconds = 4.0;

// --- palette ----------------------------------------------------------------

// The settings card's, which is where these controls came from.
constexpr std::uint32_t kActionFill = 0x5A9FDBu;
constexpr std::uint32_t kNeutralFill = 0xA3A3A3u;
constexpr std::uint32_t kDangerFill = 0xCC4444u;
/// The quiet line under a heading: white, a little lilac, so it reads as a
/// note on the card rather than as one more heading.
constexpr std::uint32_t kNoteFill = 0xEBDDF7u;
constexpr std::uint32_t kGuestBadge = 0xFFDD66u;

// --- the account's rules, as far as this side can check them ----------------

/// Database::validUsername's length. The server checks the rest of the rule
/// and says which part a name broke; this is only what a field cuts at.
constexpr std::size_t kMaxUsernameBytes = 16;
/// The settings card's three password limits, which moved here with the form:
/// bcrypt stops at 72 bytes, so a new password may not run past it; the
/// current one takes what the login box takes, because an imported account may
/// hold something longer; and eight is Database::validPassword's floor.
constexpr std::size_t kMaxNewPasswordBytes = 72;
constexpr std::size_t kMaxTypedPasswordBytes = 100;
constexpr std::size_t kMinNewPasswordBytes = 8;
/// The login box's cap (App::updateLogin): an account made under an older rule
/// can be longer than the sixteen a new one may have.
constexpr std::size_t kMaxLoginNameBytes = 50;

// --- what the card can point at ---------------------------------------------

/// Every box on the card, in the order Tab walks them. Not every one is shown:
/// see fieldShown().
enum Field : int {
    kUsername,
    kCurrentPassword,
    kNewPassword,
    kConfirmPassword,
    kLoginName,
    kLoginPassword,
    kFieldCount,
};

enum Button : int { kNoButton = -1, kSetUsername, kChangePassword, kLogIn, kLogOut };

bool masked(int field) {
    return field == kCurrentPassword || field == kNewPassword || field == kConfirmPassword ||
           field == kLoginPassword;
}

std::size_t fieldCap(int field) {
    switch (field) {
        case kUsername:        return kMaxUsernameBytes;
        case kCurrentPassword: return kMaxTypedPasswordBytes;
        case kNewPassword:
        case kConfirmPassword: return kMaxNewPasswordBytes;
        case kLoginName:       return kMaxLoginNameBytes;
        default:               return kMaxTypedPasswordBytes;
    }
}

/// Whether the box is on the card for this account: the username box only for
/// a guest, and the current-password box only for an account whose owner has
/// one to type.
bool fieldShown(int field, const Profile& profile) {
    if (field == kUsername) return profile.guest;
    if (field == kCurrentPassword) return profile.hasPassword;
    return true;
}

// --- state ------------------------------------------------------------------

/// One request's progress, as the card shows it under its form.
struct RequestLine {
    /// Between sending and reading the answer. The button greys out and stops
    /// firing, so a second click cannot race the first one's answer.
    bool pending = false;
    bool ok = false;
    std::string message;

    void clear() { pending = false; ok = false; message.clear(); }
};

struct PanelState {
    std::array<std::string, kFieldCount> values{};
    /// One caret for every box, as the auth form keeps one for its four: only
    /// the focused box has a caret to draw.
    ui::TextFieldState caret;
    int focused = -1;      ///< a Field, or -1
    int pressed = kNoButton;

    RequestLine username;
    RequestLine password;
    RequestLine login;

    /// The three buttons that ask twice: picking a name that can never be
    /// changed, and leaving an account that has no password to come back with
    /// -- by switching away from it, or by logging out of it. The button
    /// relabels and only a second click inside the window does anything, the
    /// settings card's Reset Tutorial guard.
    int armed = kNoButton;
    double armedUntil = 0;

    /// Measured by the last paint, so the scroll range is the real one.
    double contentHeight = 0;
};

PanelState& panelState() {
    static PanelState s;
    return s;
}

void focusField(PanelState& st, int field, double timeSeconds) {
    st.focused = field;
    if (field < 0) {
        st.caret.blur();
        return;
    }
    const std::string& value = st.values[static_cast<std::size_t>(field)];
    // A masked box takes the caret at the end rather than selecting all: it has
    // no visible selection to explain what a keystroke would replace.
    if (masked(field)) st.caret.focusAtEnd(value, timeSeconds);
    else st.caret.focus(value, timeSeconds);
}

/// The next box Tab lands on, skipping the ones this account is not shown.
int nextField(int from, const Profile& profile) {
    for (int step = 1; step <= kFieldCount; ++step) {
        const int field = (from + step) % kFieldCount;
        if (fieldShown(field, profile)) return field;
    }
    return -1;
}

bool armedNow(const PanelState& st, int button, double timeSeconds) {
    return st.armed == button && timeSeconds < st.armedUntil;
}

/// True when this click is the one that should act: the second inside the
/// window, or the only one when `ask` is false. Arms on a first click.
bool confirm(PanelState& st, int button, bool ask, double timeSeconds) {
    if (!ask || armedNow(st, button, timeSeconds)) {
        st.armed = kNoButton;
        return true;
    }
    st.armed = button;
    st.armedUntil = timeSeconds + kArmSeconds;
    return false;
}

// --- the requests -----------------------------------------------------------
//
// Each shared by its button and by Enter in its boxes, so the two cannot drift.

void submitUsername(MenuContext& ctx, PanelState& st) {
    if (st.username.pending || !ctx.net.profile().guest) return;
    const std::string name = trimmed(st.values[kUsername]);
    st.username.ok = false;
    if (name.empty()) {
        st.username.message = "Type the username you want.";
        st.armed = kNoButton;
        return;
    }
    // A name is for good: the first press says so on the button, the second
    // sends it.
    if (!confirm(st, kSetUsername, true, ctx.timeSeconds)) {
        st.username.message.clear();
        return;
    }
    ctx.net.requestSetUsername(name);
    st.username.pending = true;
    st.username.message = "Setting...";
}

void submitPassword(MenuContext& ctx, PanelState& st) {
    if (st.password.pending) return;
    const bool hasPassword = ctx.net.profile().hasPassword;
    const std::string& current = st.values[kCurrentPassword];
    const std::string& next = st.values[kNewPassword];
    const std::string& again = st.values[kConfirmPassword];

    st.password.ok = false;
    if ((hasPassword && current.empty()) || next.empty() || again.empty()) {
        st.password.message = "Fill in every field.";
        return;
    }
    if (next != again) {
        st.password.message = "The new passwords do not match.";
        return;
    }
    if (next.size() < kMinNewPasswordBytes) {
        st.password.message = "New password must be at least 8 characters.";
        return;
    }
    if (hasPassword && next == current) {
        st.password.message = "That is already your password.";
        return;
    }
    // An account with no password has no current one to send; the server does
    // not read the field for it (ClientMessage::ChangePassword).
    ctx.net.requestChangePassword(hasPassword ? current : std::string(), next);
    st.password.pending = true;
    st.password.message = hasPassword ? "Changing..." : "Setting...";
}

void submitLogin(MenuContext& ctx, PanelState& st) {
    if (st.login.pending) return;
    const std::string name = trimmed(st.values[kLoginName]);
    const std::string& password = st.values[kLoginPassword];
    st.login.ok = false;
    if (name.empty() || password.empty()) {
        st.login.message = "Type the account's username and password.";
        st.armed = kNoButton;
        return;
    }
    // Leaving an account with no password is leaving it for good: nothing but
    // this client's token opens it, and signing in elsewhere replaces that.
    if (!confirm(st, kLogIn, !ctx.net.profile().hasPassword, ctx.timeSeconds)) {
        st.login.message.clear();
        return;
    }
    ctx.net.requestLogin(name, password);
    st.login.pending = true;
    st.login.message = "Logging in...";
}

// --- primitives -------------------------------------------------------------

TextStyle bodyStyle(double size, std::uint32_t fill, Align align = Align::Left) {
    TextStyle style;
    style.size = size;
    style.fill = fill;
    style.stroke = kInk;
    style.align = align;
    return style;
}

ButtonStyle gardnStyle(std::uint32_t fill, double textSize) {
    ButtonStyle style;
    style.fill = fill;
    style.outlineWidth = 3.0;
    style.radius = 3.0;
    style.textSize = textSize;
    return style;
}

/// The layout cursor and the widgets the sections share. Hover and click are
/// answered inline, next to the geometry that produced them, as the settings
/// card's Painter does.
struct Painter {
    MenuContext& ctx;
    PanelState& st;
    double x = 0;
    double w = 0;
    bool inView = false;
    double cy = 0;
    bool consumed = false;

    Canvas& canvas() const { return ctx.canvas; }
    bool over(Rect r) const { return inView && r.contains(ctx.mouse()); }

    bool click(Rect r) {
        if (!over(r) || !ctx.released()) return false;
        consumed = true;
        return true;
    }

    void heading(const std::string& caption) {
        text(canvas(), caption, x, cy + 10.0, bodyStyle(15.0, kPaper));
        cy += 26.0;
    }

    /// A line of explanation, word-wrapped to the column: the card is narrow
    /// and these are sentences.
    void note(const std::string& caption, std::uint32_t fill = kNoteFill) {
        constexpr double kSize = 12.0;
        std::string line;
        std::size_t at = 0;
        const auto flush = [&] {
            text(canvas(), line, x, cy + 8.0, bodyStyle(kSize, fill));
            cy += 18.0;
            line.clear();
        };
        while (at < caption.size()) {
            const std::size_t space = caption.find(' ', at);
            const std::size_t end = space == std::string::npos ? caption.size() : space;
            const std::string word = caption.substr(at, end - at);
            const std::string joined = line.empty() ? word : line + " " + word;
            if (!line.empty() && measure(joined, kSize) > w) {
                flush();
                line = word;
            } else {
                line = joined;
            }
            at = end + 1;
        }
        if (!line.empty()) flush();
        cy += 2.0;
    }

    /// One box, focused by a click on its release -- through click(), so the
    /// same release does not then read as a click on nothing and blur it.
    void field(int id, const char* placeholder) {
        const auto at = static_cast<std::size_t>(id);
        const Rect box{x, cy, w, kFieldHeight};
        const bool focused = st.focused == id;
        inputField(canvas(), box, st.values[at], placeholder, focused, ctx.timeSeconds,
                   focused ? &st.caret : nullptr, masked(id));
        // The unmasked boxes answer for their own pointer while they hold the
        // caret, so a click places it and a drag selects. The masked ones keep
        // their caret at the end.
        if (focused && !masked(id) && inView) {
            trackTextMouse(ctx.window, st.caret, box, inputFieldRun(box, st.values[at], st.caret),
                           st.values[at], ctx.timeSeconds);
        }
        if (click(box) && !focused) focusField(st, id, ctx.timeSeconds);
        if (over(box)) ctx.window.setCursorShape(CursorShape::Text);
        cy += kFieldHeight + kFieldGap;
    }

    /// What the last request said, white while it is still out: "Setting..."
    /// is not a refusal, and red is what this row means when it is one.
    void answer(const RequestLine& line) {
        if (line.message.empty()) return;
        const std::uint32_t tone = line.pending ? kPaper : (line.ok ? kAccent : kDanger);
        text(canvas(), line.message, x, cy + 8.0, bodyStyle(12.0, tone));
        cy += 22.0;
    }

    /// A gardn button. Painted greyed and dead while `pending`: there is
    /// nothing to press until the answer lands. Returns true when clicked.
    bool button(const std::string& caption, std::uint32_t fill, int id, bool pending) {
        const Rect r{x, cy, kButtonWidth, kButtonHeight};
        cy += kButtonHeight + 10.0;
        if (pending) {
            ui::button(canvas(), r, caption, false, false, gardnStyle(kNeutralFill, 14.0));
            return false;
        }
        if (over(r) && ctx.pressed()) st.pressed = id;
        ui::button(canvas(), r, caption, over(r), st.pressed == id, gardnStyle(fill, 14.0));
        return click(r);
    }
};

/// Reads every answer the server has sent since the last frame.
void readAnswers(MenuContext& ctx, PanelState& st) {
    UsernameOutcome& named = ctx.net.usernameOutcome();
    if (named.pending) {
        named.pending = false;
        st.username.pending = false;
        st.username.ok = named.ok;
        st.username.message =
            named.ok ? "Your username is now " + ctx.net.profile().username + "." : named.message;
        if (named.ok) {
            st.values[kUsername].clear();
            if (st.focused == kUsername) focusField(st, -1, ctx.timeSeconds);
        }
    }

    PasswordOutcome& changed = ctx.net.passwordOutcome();
    if (changed.pending) {
        changed.pending = false;
        st.password.pending = false;
        st.password.ok = changed.ok;
        st.password.message = changed.ok ? "Password saved." : changed.message;
        if (changed.ok) {
            st.values[kCurrentPassword].clear();
            st.values[kNewPassword].clear();
            st.values[kConfirmPassword].clear();
            if (st.focused >= kCurrentPassword && st.focused <= kConfirmPassword) {
                focusField(st, -1, ctx.timeSeconds);
            }
        }
    }

    SwitchOutcome& switched = ctx.net.switchOutcome();
    if (switched.pending) {
        switched.pending = false;
        st.login.pending = false;
        st.login.ok = switched.ok;
        st.login.message =
            switched.ok ? "Logged in as " + ctx.net.profile().username + "." : switched.message;
        // A new account is a new card: nothing typed for the last one, and no
        // answer it was given, belongs on this one.
        if (switched.ok) {
            for (std::string& value : st.values) value.clear();
            focusField(st, -1, ctx.timeSeconds);
            st.username.clear();
            st.password.clear();
            st.armed = kNoButton;
        }
    }

    // A request whose answer can no longer arrive must not leave its form dead
    // forever: the socket that would have carried it is gone.
    if (!ctx.net.haveSession()) {
        for (RequestLine* line : {&st.username, &st.password, &st.login}) {
            if (!line->pending) continue;
            line->pending = false;
            line->ok = false;
            line->message = "Lost the connection. Try again.";
        }
    }
}

} // namespace

double AccountPanel::preferredWidth() { return kWidth; }
double AccountPanel::preferredHeight() { return kHeight; }

void AccountPanel::reset() {
    // Typed passwords and names do not outlive the card, and neither does what
    // the last attempt was told: reopening it is not a request to be shown a
    // stale refusal. A request still out stays pending -- its answer is due,
    // and readAnswers will put it where it belongs.
    PanelState& st = panelState();
    for (std::string& value : st.values) value.clear();
    focusField(st, -1, 0.0);
    st.pressed = kNoButton;
    st.armed = kNoButton;
    for (RequestLine* line : {&st.username, &st.password, &st.login}) {
        if (!line->pending) line->clear();
    }
    scroll_.offset = 0;
}

bool AccountPanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    PanelState& st = panelState();
    const Rect panel = ctx.bounds;
    const Vec2 mouse = ctx.mouse();
    const Profile& profile = ctx.net.profile();

    // As the settings card does it: a button is never painted pressed on the
    // frame it fires.
    if (ctx.released()) st.pressed = kNoButton;
    if (st.armed != kNoButton && ctx.timeSeconds >= st.armedUntil) st.armed = kNoButton;

    readAnswers(ctx, st);
    // A box the account no longer shows -- the username box, the moment the
    // name is set -- cannot keep the caret.
    if (st.focused >= 0 && !fieldShown(st.focused, profile)) focusField(st, -1, ctx.timeSeconds);

    // Keys first, so a keystroke shows in the paint that follows it.
    if (st.focused >= 0) {
        std::string& value = st.values[static_cast<std::size_t>(st.focused)];
        if (ctx.window.keyPressed(Key::Escape)) {
            focusField(st, -1, ctx.timeSeconds);
        } else if (ctx.window.keyPressed(Key::Tab)) {
            focusField(st, nextField(st.focused, profile), ctx.timeSeconds);
        } else if (ctx.window.keyPressed(Key::Enter)) {
            // Enter submits the form the box belongs to.
            if (st.focused == kUsername) submitUsername(ctx, st);
            else if (st.focused <= kConfirmPassword) submitPassword(ctx, st);
            else submitLogin(ctx, st);
        } else if (masked(st.focused)) {
            TextEditOptions typing;
            typing.maxBytes = fieldCap(st.focused);
            // Pasting INTO a masked box is fine; reading one back out is what
            // the mask exists to stop. The caret is pinned to the end on both
            // sides of the edit for the same reason: a selection nobody can
            // see is a keystroke that deletes something without saying so.
            typing.copyable = false;
            st.caret.selection.collapse(value.size());
            editText(ctx.window, value, st.caret, ctx.timeSeconds, typing);
            st.caret.selection.collapse(value.size());
        } else {
            TextEditOptions typing;
            typing.maxBytes = fieldCap(st.focused);
            // Account names are letters, digits and underscore; a pasted emoji
            // is dropped here rather than refused after a round trip.
            typing.asciiOnly = true;
            editText(ctx.window, value, st.caret, ctx.timeSeconds, typing);
        }
    }
    if (st.focused >= 0) ctx.wantsText = true;

    // --- card ---------------------------------------------------------------
    panelCard(canvas, panel, kAccountSkin);
    const double contentX = panel.x + kPad;
    const double contentW = panel.w - kPad * 2;
    text(canvas, "Account", contentX, panel.y + kPad + kHeaderHeight * 0.5,
         bodyStyle(20.0, kPaper));

    const bool inPanel = panel.contains(mouse);
    bool keepOpen = true;
    const Rect closeRect = closeButtonRect(panel);
    const bool closeHovered = inPanel && closeRect.contains(mouse);
    ui::panelClose(canvas, closeRect, closeHovered);
    if (closeHovered && ctx.released()) keepOpen = false;

    const double contentTop = panel.y + kHeaderHeight + kPad + 10.0;
    const double contentBottom = panel.bottom() - kPad;
    const double viewHeight = std::max(0.0, contentBottom - contentTop);

    scroll_.viewHeight = viewHeight;
    scroll_.contentHeight = st.contentHeight;
    if (inPanel) scroll_.offset -= static_cast<double>(ctx.wheel()) * kWheelStep;
    scroll_.offset -= touchScroll(ctx.window, Rect{panel.x, contentTop, panel.w, viewHeight},
                                  scroll_.maxOffset() > 0);
    scroll_.offset = clamp(scroll_.offset, 0.0, scroll_.maxOffset());

    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(panel.x), static_cast<float>(contentTop),
                static_cast<float>(panel.w), static_cast<float>(viewHeight));
    canvas.clip();

    Painter p{ctx, st, contentX, contentW,
              inPanel && mouse.y >= contentTop && mouse.y <= contentBottom,
              contentTop - scroll_.offset, false};
    const double contentStart = p.cy;

    if (!ctx.net.haveSession()) {
        // The strip only offers this card with a session, so this is the
        // mid-game drop: nothing here could be sent.
        p.note("Not connected to the server.", kPaper);
    } else {
        // --- who --------------------------------------------------------------
        text(canvas, "Signed in as", contentX, p.cy + 8.0, bodyStyle(13.0, kNoteFill));
        TextStyle name = bodyStyle(18.0, kPaper);
        const double nameX = contentX + measure("Signed in as ", 13.0);
        text(canvas, profile.username, nameX, p.cy + 8.0, name);
        if (profile.guest) {
            text(canvas, "(guest)", nameX + measure(profile.username + " ", 18.0), p.cy + 8.0,
                 bodyStyle(13.0, kGuestBadge));
        }
        p.cy += 30.0;

        // --- username -----------------------------------------------------------
        p.heading("Username");
        if (profile.guest) {
            p.note("A guest account can choose its username once. It cannot be changed later.");
            p.field(kUsername, "New username");
            p.answer(st.username);
            const bool armed = armedNow(st, kSetUsername, ctx.timeSeconds);
            if (p.button(armed ? "Are you sure?" : "Set Username",
                         armed ? kDangerFill : kActionFill, kSetUsername, st.username.pending)) {
                submitUsername(ctx, st);
            }
        } else {
            // Said rather than hidden, so a player looking for the rename
            // finds out why there is none.
            p.note("Your username is set and cannot be changed.");
            p.answer(st.username);
        }
        p.cy += kSectionGap;

        // --- password -----------------------------------------------------------
        p.heading(profile.hasPassword ? "Change Password" : "Set Password");
        if (!profile.hasPassword) {
            p.note("This account has no password yet. Set one to log in from anywhere.",
                   kGuestBadge);
        }
        if (profile.hasPassword) p.field(kCurrentPassword, "Current Password");
        p.field(kNewPassword, "New Password");
        p.field(kConfirmPassword, "Confirm New Password");
        // Above the button, as on the settings card: an answer below it could
        // sit past the fold of a card that scrolls.
        p.answer(st.password);
        if (p.button(profile.hasPassword ? "Change Password" : "Set Password", kActionFill,
                     kChangePassword, st.password.pending)) {
            submitPassword(ctx, st);
        }
        p.cy += kSectionGap;

        // --- another account ------------------------------------------------------
        p.heading("Log In to Another Account");
        if (!profile.hasPassword) {
            p.note("Set a password first, or this account is lost when you switch.", kGuestBadge);
        }
        p.field(kLoginName, "Username");
        p.field(kLoginPassword, "Password");
        p.answer(st.login);
        const bool loginArmed = armedNow(st, kLogIn, ctx.timeSeconds);
        if (p.button(loginArmed ? "Are you sure?" : "Log In", loginArmed ? kDangerFill : kActionFill,
                     kLogIn, st.login.pending)) {
            submitLogin(ctx, st);
        }
        p.cy += kSectionGap;

        // --- leaving ----------------------------------------------------------------
        // The app does the work -- revoking the account's tokens, forgetting
        // the stored one and going back to the login form. An account with no
        // password asks first: logging out of it is losing it.
        const bool logoutArmed = armedNow(st, kLogOut, ctx.timeSeconds);
        if (p.button(logoutArmed ? "Are you sure?" : "Log Out", kDangerFill, kLogOut, false) &&
            confirm(st, kLogOut, !profile.hasPassword, ctx.timeSeconds)) {
            ctx.logoutRequested = true;
            keepOpen = false;
        }
        if (logoutArmed) p.note("This account has no password. Logging out loses it.", kGuestBadge);
    }

    st.contentHeight = p.cy - contentStart;
    canvas.restore();

    // A click on the card that no widget took drops the caret, the way
    // clicking off a field does everywhere else. Unlike the settings card, a
    // click outside does not close it: a half-typed password is worth more
    // than the click that would throw it away.
    if (ctx.released() && inPanel && !p.consumed) {
        focusField(st, -1, ctx.timeSeconds);
        st.armed = kNoButton;
    }
    return keepOpen;
}

} // namespace flix
