// Getting in: the connecting screen, and the auth form behind it.
//
// Two of App's screens, and really one surface. Connecting is a line of text
// over the title backdrop while the socket finishes its handshake; Login is
// the form that opens once it has, and the only screen that can talk to the
// server without an account behind it. Both are drawn before there is
// anything of the player's to show, which is why neither of them touches the
// world, the HUD or the panels.
//
// The form is the browser build's canvas AuthForm, rectangle for rectangle:
// see authLayout() for why its geometry is walked down rather than written
// out, and authControlAt() for why one function answers hover, press and
// activation.

#include "client/app.h"

#include <cstdlib>
#include <limits>

#include "client/app_internal.h"
#include "client/ui/draw.h"
#include "client/ui/text_input.h"

namespace flix {

using namespace flix::ui;

namespace {

/// Layout constants for the shell, in design units like everything else. Kept
/// local because nothing outside this file positions these; the shared values
/// that widgets derive from live in theme.h.
constexpr double kLoginFormWidth = 400;
constexpr double kLoginFormHeight = 500;
constexpr double kRegisterFormHeight = 600;
constexpr double kFieldHeight = 40;
constexpr double kButtonHeight = 40;
constexpr double kAdvancedHeight = 35;

Rect centred(double width, double height, int viewW, int viewH, double yOffset = 0) {
    return {(viewW - width) * 0.5, (viewH - height) * 0.5 + yOffset, width, height};
}

/// Mirrors the canvas AuthForm's vertical rhythm in title_screen/auth_form.ts.
/// Keeping the rectangles together prevents the interaction pass and the draw
/// pass from drifting apart when this form changes again.
struct AuthLayout {
    Rect username;
    Rect password;
    Rect confirmation;      ///< registering only
    Rect advanced;          ///< the Advanced Settings disclosure
    Rect serverIp;          ///< only while the disclosure is open
    Rect action;            ///< Login, or Register while registering
    Rect secondary;         ///< Register (switches mode), or Register Offline
    Rect guest;             ///< login only
    /// Register only: the "Already have an account? Login" band. Unbounded in
    /// x, because the text it covers is centred and the browser's hit test
    /// only looks at y.
    Rect modeLink;
    double headingY = 0;
    /// The guest hint in login mode, the mode link's text in register mode.
    double hintY = 0;
    double bottomY = 0;     ///< below every control, for the message line
};

AuthLayout authLayout(int viewW, int viewH, bool registering, bool advancedOpen) {
    const double formHeight = registering ? kRegisterFormHeight : kLoginFormHeight;
    const Rect form = centred(kLoginFormWidth, formHeight, viewW, viewH);
    const double x = form.x + 20;
    const double w = form.w - 40;

    // A single walk down the form, as auth_form.ts does it: every offset here
    // is one of its `currentY +=` steps, in the same order. Deriving the
    // rectangles from absolute constants instead is how the two drift apart
    // the first time a row is inserted.
    AuthLayout layout;
    double y = form.y + 30;
    layout.headingY = y;
    y += 50;
    // The browser adds a "not secure" warning and 30px here when it is served
    // over http:. A raw TCP socket has no scheme to be insecure about, so this
    // client is always on the https path.
    y += 10;

    layout.username = {x, y, w, kFieldHeight};
    y += kFieldHeight + 15;
    layout.password = {x, y, w, kFieldHeight};
    y += kFieldHeight + 15;
    if (registering) {
        layout.confirmation = {x, y, w, kFieldHeight};
        y += kFieldHeight + 15;
    }

    layout.advanced = {x, y, w, kAdvancedHeight};
    y += kAdvancedHeight + 10;
    if (advancedOpen) {
        layout.serverIp = {x, y, w, kFieldHeight};
        y += kFieldHeight + 15;
    }
    y += 10;

    layout.action = {x, y, w, kButtonHeight};
    y += kButtonHeight + 10;
    layout.secondary = {x, y, w, kButtonHeight};
    y += kButtonHeight + 10;

    if (registering) {
        layout.modeLink = {0, y, static_cast<double>(viewW), 20};
        layout.hintY = y + 10;
        layout.bottomY = y + 20;
    } else {
        const double guestWidth = w * 0.5;
        const double guestHeight = kButtonHeight * 0.8;
        layout.guest = {x + (w - guestWidth) * 0.5, y, guestWidth, guestHeight};
        y += guestHeight + 4;
        layout.hintY = y + 6;
        layout.bottomY = y + 12;
    }
    return layout;
}

/// The auth control under the pointer, by the browser build's own button ids.
/// One function for hover, for the press latch and for activation, so the
/// three can never disagree about which button is which.
std::string authControlAt(const AuthLayout& layout, bool registering, Vec2 mouse) {
    if (hit(layout.advanced, mouse)) return "toggleAdvanced";
    if (registering) {
        if (hit(layout.action, mouse)) return "register";
        if (hit(layout.secondary, mouse)) return "offline";
        if (hit(layout.modeLink, mouse)) return "showLogin";
        return {};
    }
    if (hit(layout.action, mouse)) return "login";
    if (hit(layout.secondary, mouse)) return "showRegister";
    if (hit(layout.guest, mouse)) return "guest";
    return {};
}

} // namespace

void App::updateConnecting() {
    if (net_.status() != NetClient::Status::Ready) return;

    // --login is the only way to photograph the auth form on a machine that
    // has logged in before: a stored token would otherwise resume past it.
    if (config_.forceLogin) storedToken_.clear();

    if (!config_.forceLogin && !config_.autoUsername.empty()) {
        // A scripted run has no one to type. It also must not race a stored
        // token: the two answers would arrive interleaved and whichever lost
        // would look like a rejection.
        storedToken_.clear();
        usernameField_ = config_.autoUsername;
        passwordField_ = config_.autoPassword;
        autoLogin_ = AutoLogin::Registering;
        net_.requestRegister(config_.autoUsername, config_.autoPassword);
    } else if (!storedToken_.empty()) {
        // A returning player skips the form entirely. If the server rejects
        // the token, handleAuthResult clears its own copy and the login form
        // is already the screen we are on, so there is nothing to unwind.
        net_.resumeSession(storedToken_);
        storedToken_.clear();
    }
    screen_ = Screen::Login;
}

std::string* App::authValue(int index) {
    const int serverField = registering_ ? 3 : 2;
    if (index == 0) return &usernameField_;
    if (index == 1) return &passwordField_;
    if (registering_ && index == 2) return &confirmPasswordField_;
    if (index == serverField) return &serverField_;
    return nullptr;
}

void App::focusAuthField(int index) {
    if (focusedField_ == index) return;
    focusedField_ = index;
    std::string* value = authValue(index);
    if (!value) {
        authField_.blur();
        return;
    }
    // Tabbing or clicking into a field takes its contents whole, which is what
    // a browser does and what makes "tab, type" replace rather than append.
    authField_.focus(*value, timeSeconds_);
}

void App::updateLogin(double dt) {
    (void)dt;
    if (net_.status() == NetClient::Status::LoggedIn) { screen_ = Screen::Lobby; return; }

    if (!config_.autoUsername.empty()) {
        // A name already taken is the normal case on a second run against the
        // same database, so fall back to logging in exactly once. Anything
        // else is a real refusal and must not be retried in a loop.
        if (autoLogin_ == AutoLogin::Registering &&
            net_.authStatus != net::AuthStatus::Ok) {
            if (net_.authStatus == net::AuthStatus::UsernameTaken) {
                autoLogin_ = AutoLogin::LoggingIn;
                net_.requestLogin(config_.autoUsername, config_.autoPassword);
            } else {
                autoLogin_ = AutoLogin::Failed;
            }
        }
        return;
    }

    // An action deferred while the socket was pointed at a new endpoint. The
    // request itself could not travel: it would have gone out on the socket
    // that was being replaced.
    if (!pendingAuth_.empty() && net_.status() == NetClient::Status::Ready) {
        const std::string action = pendingAuth_;
        pendingAuth_.clear();
        submitAuth(action);
        return;
    }

    const AuthLayout layout = authLayout(window_.width(), window_.height(), registering_,
                                         advancedOpen_);
    const Vec2 mouse{window_.mouseX(), window_.mouseY()};

    // Tab cycles the visible fields only, so it never parks the caret on a
    // field the disclosure has folded away. With nothing focused it does
    // nothing at all: the reference's handler opens `if (!this.focusedField)
    // return false;` (auth_form.ts:389-390), so no key reaches the form until
    // the player has clicked into it.
    const int fieldCount = (registering_ ? 3 : 2) + (advancedOpen_ ? 1 : 0);
    if (focusedField_ >= 0 && window_.keyPressed(Key::Tab)) {
        focusAuthField((focusedField_ + 1) % fieldCount);
    }

    // The browser's per-field caps. A field the reference cuts at fifty must
    // not accept sixty-four here and then be refused by the server.
    const int serverField = registering_ ? 3 : 2;
    if (focusedField_ == 0) editText(usernameField_, 50, authField_);
    else if (focusedField_ == 1) editText(passwordField_, 100, authField_, true);
    else if (registering_ && focusedField_ == 2) {
        editText(confirmPasswordField_, 100, authField_, true);
    }
    // The endpoint field alone is uncapped: auth_form.ts:414 falls through to a
    // bare `this.serverIP += e.key`, and only the three credential fields carry
    // a maxlength.
    else if (advancedOpen_ && focusedField_ == serverField) {
        editText(serverField_, std::numeric_limits<std::size_t>::max(), authField_);
    }

    // The two unmasked fields answer for their own pointer, so a click places
    // the caret and a drag selects. The masked pair keep their caret at the end.
    if (focusedField_ == 0 || (advancedOpen_ && focusedField_ == serverField)) {
        const Rect box = focusedField_ == 0 ? layout.username : layout.serverIp;
        std::string& value = focusedField_ == 0 ? usernameField_ : serverField_;
        ui::trackTextMouse(window_, authField_, box, ui::textFieldRun(box, value), value,
                           timeSeconds_);
    }

    // Enter submits only while a field has the caret: the browser's form is a
    // set of inputs, and a key event never reaches it otherwise.
    if (focusedField_ >= 0 && window_.keyPressed(Key::Enter)) {
        submitAuth(registering_ ? "register" : "login");
        return;
    }

    // The icon strip is painted over this form and answers for its own
    // buttons. A click it takes must not also press a control behind it, nor
    // blur the field the player was typing in.
    if (menus_.capturesMouse(mouse)) {
        pressedControl_.clear();
        return;
    }

    if (window_.mousePressed(MouseButton::Left)) {
        pressedControl_ = authControlAt(layout, registering_, mouse);
    }
    if (!window_.mouseReleased(MouseButton::Left)) return;
    pressedControl_.clear();

    const std::string control = authControlAt(layout, registering_, mouse);
    if (!control.empty()) {
        submitAuth(control);
        return;
    }

    // Anything that is not a control and not a field blurs, which restores
    // both placeholders and takes the caret away.
    if (hit(layout.username, mouse)) focusAuthField(0);
    else if (hit(layout.password, mouse)) focusAuthField(1);
    else if (registering_ && hit(layout.confirmation, mouse)) focusAuthField(2);
    else if (advancedOpen_ && hit(layout.serverIp, mouse)) focusAuthField(serverField);
    else focusAuthField(-1);
}

void App::submitAuth(const std::string& action) {
    if (action == "toggleAdvanced") {
        advancedOpen_ = !advancedOpen_;
        // Folding the drawer away must not leave the caret on a field nobody
        // can see any more.
        if (!advancedOpen_ && focusedField_ >= (registering_ ? 3 : 2)) focusedField_ = -1;
        return;
    }
    if (action == "showRegister" || action == "showLogin") {
        registering_ = (action == "showRegister");
        focusedField_ = -1;
        loginMessage_.clear();
        return;
    }
    if (action == "offline") {
        // There is no offline simulation to register against: this client is
        // a network client and nothing else. The button is drawn because the
        // reference draws it, and says so rather than doing nothing.
        loginMessage_ = "Offline play is not available in this client";
        return;
    }

    // A changed endpoint has to be reached before anything can be asked of it,
    // and the request cannot ride the socket that is being replaced.
    if (retargetServer()) {
        pendingAuth_ = action;
        return;
    }

    loginMessage_.clear();
    if (action == "guest") {
        // The browser mints User<8 digits> / password<10 digits> and registers
        // them. Registering here also logs in, so there is no second step.
        const std::string name = "User" + std::to_string(titleRng_.below(100000000u));
        const std::string password =
            "password" + std::to_string(titleRng_.next() % 10000000000ull);
        usernameField_ = name;
        passwordField_ = password;
        net_.addSystemMessage("Guest account " + name + " / " + password +
                              " -- write it down, it is not stored");
        net_.requestRegister(name, password);
        return;
    }
    if (action == "register") {
        if (passwordField_ != confirmPasswordField_) {
            loginMessage_ = "Passwords do not match";
            return;
        }
        net_.requestRegister(usernameField_, passwordField_);
        return;
    }
    net_.requestLogin(usernameField_, passwordField_);
}

bool App::retargetServer() {
    if (serverField_.empty()) return false;

    std::string host = serverField_;
    std::uint16_t port = config_.port;
    // "host", "host:port". A bracketed IPv6 literal is not offered here, and
    // the last colon rule would misread one, so only a single colon counts.
    const std::size_t colon = host.rfind(':');
    if (colon != std::string::npos && host.find(':') == colon) {
        const int parsed = std::atoi(host.c_str() + colon + 1);
        if (parsed > 0 && parsed <= 65535) port = static_cast<std::uint16_t>(parsed);
        host.erase(colon);
    }
    if (host.empty() || (host == config_.host && port == config_.port)) return false;

    config_.host = host;
    config_.port = port;
    loginMessage_.clear();
    net_.connect(host, port);
    return true;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

void App::drawConnectionState(Canvas& canvas, double time) {
    TextStyle style;
    style.size = kHeadingSize;
    style.align = Align::Centre;

    if (screen_ == Screen::Disconnected) {
        style.fill = kDanger;
        text(canvas,
             net_.lastError().empty() ? "Disconnected" : ("Disconnected: " + net_.lastError()),
             canvas.width() * 0.5, canvas.height() * 0.5, style);
        // Said only while it is true. A handshake the server REFUSED is not
        // redialled -- see NetClient::handleWelcome -- and promising a
        // reconnection that is never coming is worse than the bare refusal.
        if (net_.reconnecting()) {
            style.size = 18.0;
            text(canvas, "Reconnecting...", canvas.width() * 0.5, canvas.height() * 0.5 + 34.0,
                 style);
        }
        return;
    }

    // The reference's connecting screen is the title with one static line
    // under it -- deliberately not an animated ellipsis, which reads as a
    // progress bar for something that has no progress to report.
    TextStyle title;
    title.size = 48.0;
    title.align = Align::Centre;
    title.bold = true;
    title.strokeWidth = 6.0;
    text(canvas, "flowrix beta", canvas.width() * 0.5, canvas.height() * 0.5 - 200.0, title);

    // Half the title's point size and a heavier outline than it: the line
    // under the heading is a status, not a second heading
    // (src/title_screen/index.ts:1264-1265).
    style.size = 24.0;
    style.bold = true;
    style.strokeWidth = 4.0;
    text(canvas, "Connecting...", canvas.width() * 0.5, canvas.height() * 0.5, style);
    if (statsVisible()) drawStatsCounters(canvas, true);
    (void)time;
}

void App::drawLogin(Canvas& canvas, double time) {
    const AuthLayout layout = authLayout(canvas.width(), canvas.height(), registering_,
                                         advancedOpen_);
    const double centreX = canvas.width() * 0.5;
    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    // Nothing is hovered while the pointer is outside the window: the
    // reference's `mouseleave` calls authForm.clearHover() and drops the
    // latched press with it.
    const std::string hovered =
        pointerInWindow(window_) ? authControlAt(layout, registering_, mouse) : std::string{};
    const std::string pressed = pointerInWindow(window_) ? pressedControl_ : std::string{};

    TextStyle title;
    title.size = 48;
    title.align = Align::Centre;
    title.bold = true;
    title.strokeWidth = 6;
    // Four hundred above centre, unclamped: on a short window the reference
    // lets it run off the top, and pinning it to the edge instead would put a
    // second heading beside the form's own.
    text(canvas, "flowrix beta", centreX, canvas.height() * 0.5 - 400.0, title);

    TextStyle heading;
    heading.size = 28;
    heading.align = Align::Centre;
    heading.bold = true;
    heading.strokeWidth = 3;
    text(canvas, registering_ ? "Register" : "Login", centreX, layout.headingY, heading);

    // Every default of TextFieldStyle is already this form's: the green plate,
    // its own 0.8-value outline, radius 3, 4px slack / 5px focused, 18px text.
    const TextFieldStyle authField;
    const int serverField = registering_ ? 3 : 2;
    textField(canvas, layout.username,
              usernameField_, "Username", focusedField_ == 0, false, time, authField);
    textField(canvas, layout.password,
              passwordField_, "Password", focusedField_ == 1, true, time, authField);
    if (registering_) {
        textField(canvas, layout.confirmation, confirmPasswordField_, "Confirm Password",
                  focusedField_ == 2, true, time, authField);
    }
    if (advancedOpen_) {
        textField(canvas, layout.serverIp, serverField_, "Server IP",
                  focusedField_ == serverField, false, time, authField);
    }

    ButtonStyle advancedStyle;
    advancedStyle.fill = 0x7B2FA0u;
    advancedStyle.outlineWidth = 4.0;
    advancedStyle.radius = 5.0;
    advancedStyle.textSize = 14.0;
    button(canvas, layout.advanced,
           advancedOpen_ ? "Advanced Settings [^]" : "Advanced Settings [v]",
           hovered == "toggleAdvanced", pressed == "toggleAdvanced", advancedStyle);

    // No disabled state: the reference's buttons are full-colour with both
    // fields empty, and the refusal comes from the server, not from the paint.
    ButtonStyle actionStyle;
    actionStyle.fill = 0x8A2BE2u;
    actionStyle.radius = 5.0;
    actionStyle.textSize = 18.0;
    ButtonStyle quietStyle = actionStyle;
    quietStyle.fill = 0x6A1B9Au;

    if (registering_) {
        button(canvas, layout.action, "Register", hovered == "register",
               pressed == "register", actionStyle);
        button(canvas, layout.secondary, "Register Offline", hovered == "offline",
               pressed == "offline", quietStyle);

        TextStyle link;
        link.size = 14.0;
        link.align = Align::Centre;
        link.strokeWidth = 0;
        link.fill = hovered == "showLogin" ? kPaper : 0xE0B0FFu;
        text(canvas, "Already have an account? Login", centreX, layout.hintY, link);
    } else {
        button(canvas, layout.action, "Login", hovered == "login",
               pressed == "login", actionStyle);
        button(canvas, layout.secondary, "Register", hovered == "showRegister",
               pressed == "showRegister", actionStyle);
        button(canvas, layout.guest, "Guest", hovered == "guest",
               pressed == "guest", quietStyle);

        TextStyle hint;
        hint.size = 11.0;
        hint.align = Align::Centre;
        hint.strokeWidth = 0;
        hint.fill = 0xFF9800u;
        text(canvas, "Guest accounts do not keep progress", centreX, layout.hintY, hint);
    }

    // The reference raises its failures as browser dialogs, which this client
    // has no equivalent of; the wording is the reference's so the two say the
    // same thing, and the line sits below every control rather than over one.
    if (!loginMessage_.empty()) {
        TextStyle error;
        error.size = 14;
        error.align = Align::Centre;
        error.fill = kDanger;
        error.strokeWidth = 2;
        text(canvas, loginMessage_, centreX, layout.bottomY + 24, error);
    }
    if (statsVisible()) drawStatsCounters(canvas, true);
}

} // namespace flix
