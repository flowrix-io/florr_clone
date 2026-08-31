#include "client/app.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>

#include "client/ui/draw.h"
#include "client/ui/text.h"
#include "shared/game/config.h"
#include "shared/game/constants.h"

namespace flr {

using namespace flr::ui;

namespace {

/// Layout constants for the shell. Kept local because nothing outside this
/// file positions these; the shared values that widgets derive from live in
/// theme.h.
constexpr double kLoginPanelWidth = 380;
constexpr double kLoginPanelHeight = 300;
constexpr double kFieldHeight = 42;
constexpr double kButtonHeight = 44;
constexpr double kHudMargin = 18;
constexpr double kChatWidth = 420;
constexpr double kChatLineHeight = 18;
constexpr std::size_t kVisibleChatLines = 8;
/// How long a chat line stays on screen once the box is closed.
constexpr double kChatFadeMillis = 12000;

Rect centred(double width, double height, int viewW, int viewH, double yOffset = 0) {
    return {(viewW - width) * 0.5, (viewH - height) * 0.5 + yOffset, width, height};
}

} // namespace

App::App() = default;
App::~App() = default;

bool App::start(const AppConfig& config, std::string& errorOut) {
    config_ = config;

    // Without this every text call silently draws nothing, which looks like a
    // layout bug rather than a missing font.
    if (!Fonts::init(errorOut)) {
        errorOut = "no usable font: " + errorOut;
        return false;
    }

    if (!loadContent(config.dataDir, errorOut)) return false;
    if (!sprites_.build(content())) {
        errorOut = "could not compile sprite artwork";
        return false;
    }
    for (const std::string& warning : sprites_.warnings()) {
        std::fprintf(stderr, "[sprites] %s\n", warning.c_str());
    }

    if (!window_.open(config.windowWidth, config.windowHeight, "florr", errorOut)) return false;

    renderer_.setContent(&content());
    renderer_.setSprites(&sprites_);
    net_.contentHash = content().contentHash();

    loadSessionToken();
    if (!net_.connect(config.host, config.port)) {
        errorOut = net_.lastError();
        return false;
    }

    screen_ = Screen::Connecting;
    running_ = true;
    return true;
}

void App::run() {
    int frames = 0;
    while (running_ && window_.pump()) {
        const double dt = window_.frameDelay(60.0);
        timeSeconds_ = window_.timeSeconds();
        frame(dt);

        if (config_.screenshotAfterFrames > 0 && ++frames >= config_.screenshotAfterFrames) {
            if (!config_.screenshotPath.empty()) {
                window_.canvas().savePPM(config_.screenshotPath);
                std::fprintf(stderr, "wrote %s\n", config_.screenshotPath.c_str());
            }
            running_ = false;
        }
    }
}

void App::pollNetwork() {
    // Zero timeout: the frame loop sets the cadence, and blocking here would
    // couple frame rate to packet arrival.
    net_.poll(0);

    if (net_.status() == NetClient::Status::Failed && screen_ != Screen::Disconnected) {
        screen_ = Screen::Disconnected;
    }
    if (net_.authAnswered) {
        net_.authAnswered = false;
        loginMessage_ = net_.authMessage;
        if (net_.authStatus == net::AuthStatus::Ok) {
            passwordField_.clear();
            loginMessage_.clear();
            autoLogin_ = AutoLogin::Done;
            saveSessionToken();
            screen_ = Screen::Lobby;
        }
    }
    if (net_.dead() && screen_ == Screen::Playing) screen_ = Screen::Dead;
}

void App::frame(double dt) {
    pollNetwork();

    Canvas& canvas = window_.canvas();
    camera_.setViewport(window_.width(), window_.height());

    switch (screen_) {
        case Screen::Connecting:   updateConnecting(); break;
        case Screen::Login:        updateLogin(dt); break;
        case Screen::Lobby:        updateLobby(dt); break;
        case Screen::Playing:      updatePlaying(dt); break;
        case Screen::Dead:         updateDead(dt); break;
        case Screen::Disconnected: break;
    }

    // --- draw -------------------------------------------------------------
    if (screen_ == Screen::Playing || screen_ == Screen::Dead) {
        renderer_.ingestEvents(net_.view());
        renderer_.update(dt);
        net_.view().interpolate(window_.timeSeconds() * 1000.0);
        camera_.follow(prediction_.position(), dt);
        renderer_.draw(canvas, net_.view(), camera_, prediction_.position(), timeSeconds_);
        drawHud(canvas, timeSeconds_);
        drawChat(canvas, timeSeconds_);
        if (screen_ == Screen::Dead) drawDeathCard(canvas, timeSeconds_);
    } else {
        setFill(canvas, kBackdrop);
        canvas.fillRect(0, 0, static_cast<float>(canvas.width()),
                        static_cast<float>(canvas.height()));
        if (screen_ == Screen::Login) drawLogin(canvas, timeSeconds_);
        else if (screen_ == Screen::Lobby) drawLobby(canvas, timeSeconds_);
        else drawConnectionState(canvas, timeSeconds_);
    }

    drawNotices(canvas, timeSeconds_);
    window_.present();
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

void App::updateConnecting() {
    if (net_.status() != NetClient::Status::Ready) return;

    if (!config_.autoUsername.empty()) {
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

void App::editText(std::string& target, std::size_t maxLength) {
    const std::string& typed = window_.typedText();
    for (std::size_t i = 0; i < typed.size(); ++i) {
        if (target.size() >= maxLength) break;
        const unsigned char c = static_cast<unsigned char>(typed[i]);
        if (c >= 0x20) target += typed[i];
    }
    if (window_.keyPressed(Key::Backspace) && !target.empty()) {
        // Erase a whole UTF-8 sequence, not a byte: deleting one byte of a
        // multi-byte character leaves an invalid string behind.
        std::size_t at = target.size() - 1;
        while (at > 0 && (static_cast<unsigned char>(target[at]) & 0xC0) == 0x80) --at;
        target.erase(at);
    }
}

void App::updateLogin(double dt) {
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

    if (window_.keyPressed(Key::Tab)) focusedField_ ^= 1;
    editText(focusedField_ == 0 ? usernameField_ : passwordField_, 64);

    const bool submit = window_.keyPressed(Key::Enter);
    const Rect panel = centred(kLoginPanelWidth, kLoginPanelHeight,
                               window_.width(), window_.height());
    const Vec2 mouse{window_.mouseX(), window_.mouseY()};

    const Rect userRect{panel.x + 24, panel.y + 86, panel.w - 48, kFieldHeight};
    const Rect passRect{panel.x + 24, panel.y + 140, panel.w - 48, kFieldHeight};
    const Rect actionRect{panel.x + 24, panel.y + 200, panel.w - 48, kButtonHeight};
    const Rect toggleRect{panel.x + 24, panel.y + 252, panel.w - 48, 24};

    if (window_.mousePressed(MouseButton::Left)) {
        if (hit(userRect, mouse)) focusedField_ = 0;
        else if (hit(passRect, mouse)) focusedField_ = 1;
        else if (hit(toggleRect, mouse)) { registering_ = !registering_; loginMessage_.clear(); }
    }

    const bool clicked = window_.mouseReleased(MouseButton::Left) && hit(actionRect, mouse);
    if ((clicked || submit) && !usernameField_.empty() && !passwordField_.empty()) {
        loginMessage_.clear();
        if (registering_) net_.requestRegister(usernameField_, passwordField_);
        else net_.requestLogin(usernameField_, passwordField_);
    }
    (void)dt;
}

void App::updateLobby(double dt) {
    if (!config_.autoUsername.empty() && net_.status() != NetClient::Status::Playing) {
        net_.joinGame(window_.width(), window_.height());
    }
    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    const Rect playRect{(window_.width() - 260) * 0.5, window_.height() * 0.62, 260, 56};

    if ((window_.mouseReleased(MouseButton::Left) && hit(playRect, mouse)) ||
        window_.keyPressed(Key::Enter)) {
        net_.joinGame(window_.width(), window_.height());
    }
    if (net_.status() == NetClient::Status::Playing) {
        prediction_.reset(net_.view().self().position);
        camera_.snapTo(prediction_.position());
        screen_ = Screen::Playing;
    }
    (void)dt;
}

void App::sendInputFrame(double dt) {
    net::InputFrame input;
    input.sequence = ++inputSequence_;

    // Movement follows the cursor, which is the control scheme this game is
    // built around: the flower runs toward the pointer, at a speed set by how
    // far away it is. WASD is offered as an alternative rather than a
    // supplement, and wins when held so the two cannot fight.
    Vec2 keyboard{0, 0};
    if (window_.keyDown(Key::W) || window_.keyDown(Key::Up)) keyboard.y -= 1;
    if (window_.keyDown(Key::S) || window_.keyDown(Key::Down)) keyboard.y += 1;
    if (window_.keyDown(Key::A) || window_.keyDown(Key::Left)) keyboard.x -= 1;
    if (window_.keyDown(Key::D) || window_.keyDown(Key::Right)) keyboard.x += 1;

    const Vec2 cursorWorld = camera_.screenToWorld({window_.mouseX(), window_.mouseY()});
    const Vec2 toCursor = cursorWorld - prediction_.position();

    if (keyboard.lengthSq() > 0) {
        const Vec2 direction = keyboard.normalized();
        input.moveAngle = direction.angle();
        input.moveStrength = 1.0;
    } else {
        const double distance = toCursor.length();
        input.moveAngle = distance > 1e-6 ? toCursor.angle() : 0.0;
        input.moveStrength = std::min(1.0, distance / kFullSpeedCursorDistance);
    }

    // Aim always follows the cursor, even under keyboard movement: where the
    // petals point and where you walk are separate decisions.
    input.aimAngle = toCursor.lengthSq() > 1e-12 ? toCursor.angle() : 0.0;

    if (!chatOpen_) {
        if (window_.mouseDown(MouseButton::Left) || window_.keyDown(Key::Space)) {
            input.flags |= net::InputAttack;
        }
        if (window_.mouseDown(MouseButton::Right) || window_.keyDown(Key::LeftShift) ||
            window_.keyDown(Key::RightShift)) {
            input.flags |= net::InputDefend;
        }
    }

    prediction_.apply(input, kPlayerMaxSpeed, dt);
    net_.sendInput(input);
}

void App::updatePlaying(double dt) {
    // Chat swallows the keyboard while open, or typing would also drive the
    // flower and trip every hotkey.
    if (chatOpen_) {
        editText(chatDraft_, 180);
        if (window_.keyPressed(Key::Enter)) {
            if (!chatDraft_.empty()) net_.sendChat(chatDraft_);
            chatDraft_.clear();
            chatOpen_ = false;
        } else if (window_.keyPressed(Key::Escape)) {
            chatDraft_.clear();
            chatOpen_ = false;
        }
    } else {
        if (window_.keyPressed(Key::Enter)) chatOpen_ = true;
        if (window_.keyPressed(Key::Tab) || window_.keyPressed(Key::I)) {
            inventoryOpen_ = !inventoryOpen_;
        }
        if (window_.keyPressed(Key::Escape)) {
            if (inventoryOpen_) inventoryOpen_ = false;
            else { net_.leaveGame(); screen_ = Screen::Lobby; return; }
        }
    }

    // Reconcile before producing this frame's input, so the new input is
    // predicted from the authoritative state rather than from a stale one.
    const SelfState& self = net_.view().self();
    prediction_.reconcile(self.position, self.velocity, self.acknowledgedInput, kPlayerMaxSpeed);

    // Input is produced at the simulation rate rather than per rendered frame:
    // a 144 Hz client must not get six times the inputs of a 25 Hz one.
    inputAccumulator_ += dt;
    const double step = net::kTickSeconds;
    int produced = 0;
    while (inputAccumulator_ >= step && produced < 4) {
        inputAccumulator_ -= step;
        sendInputFrame(step);
        ++produced;
    }
    // A long stall must not queue a burst of catch-up input.
    if (inputAccumulator_ > step * 4) inputAccumulator_ = 0;

    camera_.userZoom = clamp(camera_.userZoom + window_.wheelDelta() * 0.05, 0.6, 1.6);
}

void App::updateDead(double dt) {
    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    const Rect card = centred(360, 220, window_.width(), window_.height());
    const Rect respawn{card.x + 24, card.y + 130, card.w - 48, kButtonHeight};
    const Rect toTitle{card.x + 24, card.y + 180, card.w - 48, 28};

    if (window_.mouseReleased(MouseButton::Left)) {
        if (hit(respawn, mouse)) {
            net_.requestRespawn();
            prediction_.reset(net_.view().self().position);
            screen_ = Screen::Playing;
        } else if (hit(toTitle, mouse)) {
            net_.leaveGame();
            screen_ = Screen::Lobby;
        }
    }
    (void)dt;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

void App::drawConnectionState(Canvas& canvas, double time) {
    TextStyle style;
    style.size = kHeadingSize;
    style.align = Align::Centre;

    std::string message;
    switch (screen_) {
        case Screen::Disconnected:
            message = net_.lastError().empty() ? "Disconnected" : ("Disconnected: " + net_.lastError());
            style.fill = kDanger;
            break;
        default: {
            // A cycling ellipsis, so a slow connect looks like progress rather
            // than a hang.
            const int dots = static_cast<int>(std::fmod(time * 2.0, 4.0));
            message = "Connecting" + std::string(static_cast<std::size_t>(dots), '.');
            break;
        }
    }
    text(canvas, message, canvas.width() * 0.5, canvas.height() * 0.5, style);
}

void App::drawLogin(Canvas& canvas, double time) {
    const Rect box = centred(kLoginPanelWidth, kLoginPanelHeight, canvas.width(), canvas.height());

    TextStyle title;
    title.size = kTitleSize;
    title.align = Align::Centre;
    title.bold = true;
    text(canvas, "florr", canvas.width() * 0.5, box.y - 48, title);

    panel(canvas, box);

    TextStyle heading;
    heading.size = kHeadingSize;
    heading.align = Align::Centre;
    heading.bold = true;
    text(canvas, registering_ ? "Create an account" : "Log in",
         box.x + box.w * 0.5, box.y + 40, heading);

    textField(canvas, {box.x + 24, box.y + 86, box.w - 48, kFieldHeight},
              usernameField_, "Username", focusedField_ == 0, false, time);
    textField(canvas, {box.x + 24, box.y + 140, box.w - 48, kFieldHeight},
              passwordField_, "Password", focusedField_ == 1, true, time);

    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    const Rect action{box.x + 24, box.y + 200, box.w - 48, kButtonHeight};
    ButtonStyle actionStyle;
    actionStyle.enabled = !usernameField_.empty() && !passwordField_.empty();
    actionStyle.textSize = kHeadingSize - 4;
    button(canvas, action, registering_ ? "Register" : "Log in",
           hit(action, mouse), window_.mouseDown(MouseButton::Left) && hit(action, mouse),
           actionStyle);

    TextStyle toggle;
    toggle.size = kSmallSize;
    toggle.align = Align::Centre;
    toggle.fill = lighten(kPaper, 0.0);
    toggle.strokeWidth = 0;
    text(canvas, registering_ ? "Already have an account? Log in"
                              : "No account? Create one",
         box.x + box.w * 0.5, box.y + 264, toggle);

    if (!loginMessage_.empty()) {
        TextStyle error;
        error.size = kSmallSize + 1;
        error.align = Align::Centre;
        error.fill = kDanger;
        text(canvas, loginMessage_, box.x + box.w * 0.5, box.y + box.h + 22, error);
    }
}

void App::drawLobby(Canvas& canvas, double time) {
    const Profile& profile = net_.profile();

    TextStyle title;
    title.size = kTitleSize;
    title.align = Align::Centre;
    title.bold = true;
    text(canvas, "florr", canvas.width() * 0.5, canvas.height() * 0.18, title);

    TextStyle who;
    who.size = kHeadingSize;
    who.align = Align::Centre;
    text(canvas, profile.username + "   ·   Level " + std::to_string(profile.level),
         canvas.width() * 0.5, canvas.height() * 0.26, who);

    // The loadout, shown as it will appear in game so the player recognises it.
    const double slotSize = kSlotSize;
    const std::size_t slots = std::max<std::size_t>(profile.loadout.size(), kLoadoutSlots);
    const double totalWidth = slots * slotSize + (slots - 1) * kSlotGap;
    double x = (canvas.width() - totalWidth) * 0.5;
    const double y = canvas.height() * 0.40;

    for (std::size_t i = 0; i < slots; ++i) {
        const Rect slot{x, y, slotSize, slotSize};
        const bool filled = i < profile.loadout.size() && !profile.loadout[i].empty();
        plate(canvas, slot, filled ? rarityColor(profile.loadout[i].rarity) : kSlot, kSlotRadius);
        if (filled) {
            sprites_.drawPetal(canvas, profile.loadout[i].petalIndex,
                               slot.x + slot.w * 0.5, slot.y + slot.h * 0.5,
                               slot.w * 0.68, 0.0, time);
        }
        TextStyle number;
        number.size = kSmallSize;
        number.align = Align::Centre;
        number.fill = shade(kPaper, 0.8);
        text(canvas, std::to_string(i + 1), slot.x + slot.w * 0.5, slot.bottom() + 12, number);
        x += slotSize + kSlotGap;
    }

    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    const Rect play{(canvas.width() - 260) * 0.5, canvas.height() * 0.62, 260, 56};
    ButtonStyle playStyle;
    playStyle.textSize = kHeadingSize;
    button(canvas, play, "Play", hit(play, mouse),
           window_.mouseDown(MouseButton::Left) && hit(play, mouse), playStyle);

    TextStyle hint;
    hint.size = kSmallSize;
    hint.align = Align::Centre;
    hint.fill = shade(kPaper, 0.75);
    text(canvas, "Move with the mouse · hold left to attack · right to defend",
         canvas.width() * 0.5, play.bottom() + 30, hint);
}

void App::drawHud(Canvas& canvas, double time) {
    const SelfState& self = net_.view().self();

    // Health, bottom centre, wide enough to read at a glance mid-fight.
    const double barWidth = std::min(420.0, canvas.width() * 0.36);
    const Rect health{(canvas.width() - barWidth) * 0.5,
                      canvas.height() - kHudMargin - 26, barWidth, 22};
    const double fraction = self.maxHealth > 0 ? self.health / self.maxHealth : 0.0;
    bar(canvas, health, fraction, fraction < 0.3 ? kDanger : kHealth);

    TextStyle hp;
    hp.size = kSmallSize + 1;
    hp.align = Align::Centre;
    text(canvas,
         std::to_string(static_cast<long>(self.health + 0.5)) + " / " +
             std::to_string(static_cast<long>(self.maxHealth + 0.5)),
         health.x + health.w * 0.5, health.y + health.h * 0.5, hp);

    // XP, along the very top, where it is visible but never in the way.
    const LevelProgress progress = levelFromTotalXp(self.totalXp);
    const Rect xp{kHudMargin, kHudMargin, canvas.width() - kHudMargin * 2, 14};
    bar(canvas, xp, progress.xpForNext > 0 ? progress.xpIntoLevel / progress.xpForNext : 0.0,
        kXpBar);

    TextStyle level;
    level.size = kSmallSize;
    level.align = Align::Left;
    text(canvas, "Level " + std::to_string(progress.level), xp.x + 10, xp.y + xp.h * 0.5, level);

    // The loadout, mirroring the lobby's layout so the two read as one thing.
    const Profile& profile = net_.profile();
    const std::size_t slots = std::max<std::size_t>(profile.loadout.size(), kLoadoutSlots);
    const double slotSize = 44;
    const double totalWidth = slots * slotSize + (slots - 1) * 6;
    double x = (canvas.width() - totalWidth) * 0.5;
    const double y = health.y - slotSize - 12;
    for (std::size_t i = 0; i < slots; ++i) {
        const Rect slot{x, y, slotSize, slotSize};
        const bool filled = i < profile.loadout.size() && !profile.loadout[i].empty();
        plate(canvas, slot, filled ? rarityColor(profile.loadout[i].rarity) : kSlot,
              kSlotRadius, kInk, -1, 0.9);
        if (filled) {
            sprites_.drawPetal(canvas, profile.loadout[i].petalIndex,
                               slot.x + slot.w * 0.5, slot.y + slot.h * 0.5,
                               slot.w * 0.66, 0.0, time);
        }
        x += slotSize + 6;
    }

    // Connection quality, small and out of the way, but present -- a player
    // being killed by lag deserves to know that is what happened.
    TextStyle ping;
    ping.size = kSmallSize;
    ping.align = Align::Right;
    ping.fill = net_.pingMillis() > 200 ? kWarning : shade(kPaper, 0.7);
    text(canvas, std::to_string(static_cast<int>(net_.pingMillis())) + " ms",
         canvas.width() - kHudMargin, xp.bottom() + 16, ping);
}

void App::drawChat(Canvas& canvas, double time) {
    const std::vector<ChatLine>& lines = net_.chat();
    const double nowMs = time * 1000.0;

    double y = canvas.height() - 140;
    std::size_t shown = 0;
    for (auto it = lines.rbegin(); it != lines.rend() && shown < kVisibleChatLines; ++it) {
        // Once the box is closed, old lines fade out so chat does not
        // permanently occupy a corner of the screen.
        const double age = nowMs - it->receivedAtMillis;
        if (!chatOpen_ && age > kChatFadeMillis) break;

        TextStyle style;
        style.size = kSmallSize + 1;
        style.align = Align::Left;
        style.fill = it->channel == net::ChatChannel::System ? kWarning : kPaper;
        const double alpha = (!chatOpen_ && age > kChatFadeMillis - 2000)
                                 ? (kChatFadeMillis - age) / 2000.0
                                 : 1.0;
        canvas.setGlobalAlpha(static_cast<float>(clamp(alpha, 0.0, 1.0)));
        const std::string text_ = it->author.empty() ? it->text : (it->author + ": " + it->text);
        text(canvas, text_, kHudMargin, y, style);
        canvas.setGlobalAlpha(1.0f);

        y -= kChatLineHeight;
        ++shown;
    }

    if (chatOpen_) {
        const Rect box{kHudMargin, canvas.height() - 118.0, kChatWidth, 30.0};
        textField(canvas, box, chatDraft_, "Say something…", true, false, time);
    }
}

void App::drawNotices(Canvas& canvas, double time) {
    const double nowMs = time * 1000.0;
    std::vector<Notice>& notices = net_.notices();

    // Drop expired ones here rather than in the network layer: the renderer is
    // what decides how long a message is worth showing.
    notices.erase(std::remove_if(notices.begin(), notices.end(),
                                 [nowMs](const Notice& n) {
                                     return nowMs - n.receivedAtMillis > 5000;
                                 }),
                  notices.end());

    double y = 90;
    for (const Notice& notice : notices) {
        const double age = nowMs - notice.receivedAtMillis;
        const double alpha = age > 4000 ? (5000 - age) / 1000.0 : 1.0;

        std::uint32_t colour = kPaper;
        switch (notice.severity) {
            case net::NoticeSeverity::Good: colour = kAccent; break;
            case net::NoticeSeverity::Warning: colour = kWarning; break;
            case net::NoticeSeverity::Bad: colour = kDanger; break;
            default: break;
        }

        TextStyle style;
        style.size = kBodySize;
        style.align = Align::Centre;
        style.fill = colour;
        canvas.setGlobalAlpha(static_cast<float>(clamp(alpha, 0.0, 1.0)));
        text(canvas, notice.text, canvas.width() * 0.5, y, style);
        canvas.setGlobalAlpha(1.0f);
        y += 24;
    }
}

void App::drawDeathCard(Canvas& canvas, double time) {
    scrim(canvas, 0.5);
    const Rect card = centred(360, 220, canvas.width(), canvas.height());
    panel(canvas, card);

    TextStyle heading;
    heading.size = kHeadingSize + 6;
    heading.align = Align::Centre;
    heading.bold = true;
    heading.fill = kDanger;
    text(canvas, "You died", card.x + card.w * 0.5, card.y + 46, heading);

    if (!net_.killerName().empty()) {
        TextStyle by;
        by.size = kBodySize;
        by.align = Align::Centre;
        text(canvas, "killed by " + net_.killerName(), card.x + card.w * 0.5, card.y + 84, by);
    }

    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    const Rect respawn{card.x + 24, card.y + 130, card.w - 48, kButtonHeight};
    button(canvas, respawn, "Respawn", hit(respawn, mouse),
           window_.mouseDown(MouseButton::Left) && hit(respawn, mouse));

    TextStyle back;
    back.size = kSmallSize;
    back.align = Align::Centre;
    back.fill = shade(kPaper, 0.8);
    text(canvas, "or return to the menu", card.x + card.w * 0.5, card.y + 194, back);
    (void)time;
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

void App::loadSessionToken() {
    std::ifstream in(config_.sessionFile);
    if (!in) return;
    // Only a token is ever stored -- never the password -- so a stolen or
    // shared machine leaks at most one revocable, expiring handle.
    std::getline(in, storedToken_);
}

void App::saveSessionToken() const {
    if (net_.sessionToken().empty()) return;
    std::ofstream out(config_.sessionFile, std::ios::trunc);
    if (out) out << net_.sessionToken() << "\n";
}

} // namespace flr
