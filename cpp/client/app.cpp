#include "client/app.h"

#include <algorithm>
#include <array>
#include <cctype>
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
constexpr double kLoginFormWidth = 400;
constexpr double kLoginFormHeight = 500;
constexpr double kRegisterFormHeight = 600;
constexpr double kFieldHeight = 40;
constexpr double kButtonHeight = 40;
constexpr double kHudMargin = 18;
constexpr double kChatWidth = 420;
constexpr double kChatLineHeight = 18;
constexpr std::size_t kVisibleChatLines = 8;
/// How long a chat line stays on screen once the box is closed.
constexpr double kChatFadeMillis = 12000;

Rect centred(double width, double height, int viewW, int viewH, double yOffset = 0) {
    return {(viewW - width) * 0.5, (viewH - height) * 0.5 + yOffset, width, height};
}

/// Mirrors the canvas AuthForm's vertical rhythm in title_screen/auth_form.ts.
/// Keeping the rectangles together prevents the interaction pass and the draw
/// pass from drifting apart when this form changes again.
struct AuthLayout {
    Rect form;
    Rect username;
    Rect password;
    Rect confirmation;
    Rect action;
    Rect modeSwitch;
    double headingY = 0;
};

AuthLayout authLayout(int viewW, int viewH, bool registering) {
    const double formHeight = registering ? kRegisterFormHeight : kLoginFormHeight;
    const Rect form = centred(kLoginFormWidth, formHeight, viewW, viewH);
    const double x = form.x + 20;
    const double w = form.w - 40;
    const double firstFieldY = form.y + 90;

    AuthLayout layout;
    layout.form = form;
    layout.username = {x, firstFieldY, w, kFieldHeight};
    layout.password = {x, firstFieldY + 55, w, kFieldHeight};
    layout.confirmation = {x, firstFieldY + 110, w, kFieldHeight};
    layout.headingY = form.y + 30;

    // The browser form reserves room here for its advanced-server controls.
    // The native client deliberately has no editable endpoint at runtime, but
    // preserving that gap keeps the visual hierarchy identical.
    const double actionY = registering ? firstFieldY + 210 : firstFieldY + 165;
    layout.action = {x, actionY, w, kButtonHeight};
    layout.modeSwitch = {x, actionY + 50, w, kButtonHeight};
    return layout;
}

// ---------------------------------------------------------------------------
// Inventory layout and presentation
// ---------------------------------------------------------------------------

constexpr double kInventoryPadding = 16.0;
constexpr double kInventoryGap = 8.0;

struct InventoryLayout {
    Rect panel;
    Rect close;
    Rect equip;
    Rect craft;
    std::array<Rect, kLoadoutSlots> loadout{};
    Rect items;
    int columns = 1;
    double cellSize = 0;
};

struct InventoryCell {
    Rect rect;
    std::size_t stack = 0;
};

struct InventorySection {
    Rarity rarity = Rarity::Common;
    double y = 0;
};

struct InventoryGrid {
    std::vector<InventoryCell> cells;
    std::vector<InventorySection> sections;
    double contentHeight = 0;
};

InventoryLayout inventoryLayout(int viewW, int viewH) {
    InventoryLayout layout;
    const double width = std::min(780.0, std::max(320.0, static_cast<double>(viewW) - 24.0));
    const double height = std::min(620.0, std::max(360.0, static_cast<double>(viewH) - 24.0));
    layout.panel = centred(width, height, viewW, viewH);

    layout.close = {layout.panel.right() - 42.0, layout.panel.y + 12.0, 30.0, 30.0};
    layout.equip = {layout.panel.right() - 268.0, layout.panel.y + 14.0, 102.0, 28.0};
    layout.craft = {layout.panel.right() - 156.0, layout.panel.y + 14.0, 102.0, 28.0};

    const double innerWidth = layout.panel.w - kInventoryPadding * 2.0;
    const double slotSize = clamp((innerWidth - kInventoryGap * (kLoadoutSlots - 1)) /
                                      static_cast<double>(kLoadoutSlots),
                                  30.0, 58.0);
    const double loadoutWidth = slotSize * kLoadoutSlots + kInventoryGap * (kLoadoutSlots - 1);
    double x = layout.panel.x + (layout.panel.w - loadoutWidth) * 0.5;
    const double y = layout.panel.y + 70.0;
    for (std::size_t i = 0; i < kLoadoutSlots; ++i) {
        layout.loadout[i] = {x, y, slotSize, slotSize};
        x += slotSize + kInventoryGap;
    }

    layout.items = {layout.panel.x + kInventoryPadding, y + slotSize + 37.0,
                    innerWidth, layout.panel.bottom() - (y + slotSize + 37.0) - kInventoryPadding};
    layout.columns = clamp(static_cast<int>((layout.items.w + kInventoryGap) / 94.0), 3, 7);
    layout.cellSize = (layout.items.w - kInventoryGap * (layout.columns - 1)) / layout.columns;
    return layout;
}

std::string inventoryName(const std::string& id) {
    std::string name;
    bool capitalise = true;
    for (const unsigned char raw : id) {
        if (raw == '_' || raw == ' ') {
            if (!name.empty() && name.back() != ' ') name += ' ';
            capitalise = true;
            continue;
        }
        name += static_cast<char>(capitalise ? std::toupper(raw) : std::tolower(raw));
        capitalise = false;
    }
    return name;
}

InventoryGrid inventoryGrid(const Profile& profile, const InventoryLayout& layout, double scroll) {
    InventoryGrid grid;
    double y = layout.items.y - scroll;

    for (int rarity = kRarityCount - 1; rarity >= 0; --rarity) {
        std::vector<std::size_t> stacks;
        for (std::size_t i = 0; i < profile.inventory.size(); ++i) {
            const Profile::Stack& stack = profile.inventory[i];
            if (stack.count > 0 && rarityIndex(stack.rarity) == rarity) stacks.push_back(i);
        }
        if (stacks.empty()) continue;

        std::sort(stacks.begin(), stacks.end(), [&](std::size_t a, std::size_t b) {
            const PetalConfig& left = content().petal(profile.inventory[a].petalIndex);
            const PetalConfig& right = content().petal(profile.inventory[b].petalIndex);
            return left.name == right.name ? profile.inventory[a].petalIndex < profile.inventory[b].petalIndex
                                           : left.name < right.name;
        });

        grid.sections.push_back({static_cast<Rarity>(rarity), y + 10.0});
        y += 23.0;
        for (std::size_t i = 0; i < stacks.size(); ++i) {
            const int column = static_cast<int>(i % static_cast<std::size_t>(layout.columns));
            const int row = static_cast<int>(i / static_cast<std::size_t>(layout.columns));
            grid.cells.push_back({{layout.items.x + column * (layout.cellSize + kInventoryGap),
                                   y + row * (layout.cellSize + kInventoryGap),
                                   layout.cellSize, layout.cellSize}, stacks[i]});
        }
        const int rows = static_cast<int>((stacks.size() + static_cast<std::size_t>(layout.columns) - 1) /
                                          static_cast<std::size_t>(layout.columns));
        y += rows * (layout.cellSize + kInventoryGap) + 9.0;
    }

    grid.contentHeight = std::max(0.0, y - (layout.items.y - scroll));
    return grid;
}

const Profile::Stack* findInventoryStack(const Profile& profile, std::uint16_t petalIndex, Rarity rarity) {
    for (const Profile::Stack& stack : profile.inventory) {
        if (stack.petalIndex == petalIndex && stack.rarity == rarity && stack.count > 0) return &stack;
    }
    return nullptr;
}

} // namespace

App::App() = default;
App::~App() = default;

bool App::start(const AppConfig& config, std::string& errorOut) {
    config_ = config;

    // Without this every text call silently draws nothing, which looks like a
    // layout bug rather than a missing font.
    if (!Fonts::init(config.dataDir, errorOut)) {
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

    // The browser title scene tiles this exact SVG below the form. Compile it
    // once just like mob and petal artwork; a missing optional backdrop must
    // never prevent a player from reaching the login screen.
    auto titleBackground = std::make_shared<SvgDocument>(
        SvgDocument::fromFile(config.dataDir + "/land.svg"));
    if (!titleBackground->empty()) titleBackground_ = std::move(titleBackground);

    if (!window_.open(config.windowWidth, config.windowHeight, "florr", errorOut)) return false;

    renderer_.setContent(&content());
    renderer_.setSprites(&sprites_);
    // NetClient keeps this object alive for the entire connection and replaces
    // its grid with the authoritative TypeScript map when a game is joined.
    renderer_.setTerrain(&net_.terrain());
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
            confirmPasswordField_.clear();
            loginMessage_.clear();
            autoLogin_ = AutoLogin::Done;
            saveSessionToken();
            screen_ = Screen::Lobby;
        }
    }
    if (net_.dead() && screen_ == Screen::Playing) {
        inventoryOpen_ = false;
        draggingStack_ = -1;
        draggingLoadoutSlot_ = -1;
        screen_ = Screen::Dead;
    }
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
        if (inventoryOpen_ && screen_ == Screen::Playing) drawInventory(canvas, timeSeconds_);
        if (screen_ == Screen::Dead) drawDeathCard(canvas, timeSeconds_);
    } else {
        drawTitleBackground(canvas, timeSeconds_);
        if (screen_ == Screen::Login) drawLogin(canvas, timeSeconds_);
        else if (screen_ == Screen::Lobby) {
            drawLobby(canvas, timeSeconds_);
            if (inventoryOpen_) drawInventory(canvas, timeSeconds_);
        }
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

    const int fieldCount = registering_ ? 3 : 2;
    if (window_.keyPressed(Key::Tab)) focusedField_ = (focusedField_ + 1) % fieldCount;
    if (focusedField_ == 0) editText(usernameField_, 64);
    else if (focusedField_ == 1) editText(passwordField_, 64);
    else editText(confirmPasswordField_, 64);

    const bool submit = window_.keyPressed(Key::Enter);
    const AuthLayout layout = authLayout(window_.width(), window_.height(), registering_);
    const Vec2 mouse{window_.mouseX(), window_.mouseY()};

    if (window_.mousePressed(MouseButton::Left)) {
        if (hit(layout.username, mouse)) focusedField_ = 0;
        else if (hit(layout.password, mouse)) focusedField_ = 1;
        else if (registering_ && hit(layout.confirmation, mouse)) focusedField_ = 2;
    }

    if (window_.mouseReleased(MouseButton::Left) && hit(layout.modeSwitch, mouse)) {
        registering_ = !registering_;
        focusedField_ = 0;
        confirmPasswordField_.clear();
        loginMessage_.clear();
        return;
    }

    const bool clicked = window_.mouseReleased(MouseButton::Left) && hit(layout.action, mouse);
    if ((clicked || submit) && !usernameField_.empty() && !passwordField_.empty()) {
        loginMessage_.clear();
        if (registering_ && passwordField_ != confirmPasswordField_) {
            loginMessage_ = "Passwords do not match";
        } else if (registering_) net_.requestRegister(usernameField_, passwordField_);
        else net_.requestLogin(usernameField_, passwordField_);
    }
    (void)dt;
}

void App::updateLobby(double dt) {
    if (!config_.autoUsername.empty() && net_.status() != NetClient::Status::Playing) {
        net_.joinGame(window_.width(), window_.height());
    }
    if (window_.keyPressed(Key::Z) || window_.keyPressed(Key::I) || window_.keyPressed(Key::Tab)) {
        inventoryOpen_ = !inventoryOpen_;
        draggingStack_ = -1;
        draggingLoadoutSlot_ = -1;
        inventoryScroll_ = 0;
    }
    if (inventoryOpen_) {
        updateInventory();
        return;
    }

    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    const Rect playRect{(window_.width() - 260) * 0.5, window_.height() * 0.62, 260, 56};
    const Rect inventoryRect{(window_.width() - 260) * 0.5, playRect.bottom() + 12.0, 260, 42};

    if ((window_.mouseReleased(MouseButton::Left) && hit(playRect, mouse)) ||
        window_.keyPressed(Key::Enter)) {
        net_.joinGame(window_.width(), window_.height());
    }
    if (window_.mouseReleased(MouseButton::Left) && hit(inventoryRect, mouse)) {
        inventoryOpen_ = true;
        inventoryScroll_ = 0;
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

    // A modal inventory owns the pointer. Keep sending zero movement so the
    // server and prediction agree that the flower has stopped while an item
    // is being dragged, rather than steering toward the panel under the mouse.
    if (inventoryOpen_) {
        prediction_.apply(input, kPlayerMaxSpeed, dt);
        net_.sendInput(input);
        return;
    }

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

    if (!chatOpen_ && !inventoryOpen_) {
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
        if (window_.keyPressed(Key::Tab) || window_.keyPressed(Key::I) || window_.keyPressed(Key::Z)) {
            inventoryOpen_ = !inventoryOpen_;
            draggingStack_ = -1;
            draggingLoadoutSlot_ = -1;
            inventoryScroll_ = 0;
        }
        if (window_.keyPressed(Key::Escape)) {
            if (inventoryOpen_) inventoryOpen_ = false;
            else { net_.leaveGame(); screen_ = Screen::Lobby; return; }
        }
        if (inventoryOpen_) updateInventory();
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

    if (!inventoryOpen_) {
        camera_.userZoom = clamp(camera_.userZoom + window_.wheelDelta() * 0.05, 0.6, 1.6);
    }
}

void App::updateInventory() {
    const Profile& profile = net_.profile();
    const InventoryLayout layout = inventoryLayout(window_.width(), window_.height());

    // The profile can contain hundreds of stacks. Scroll only the cells, not
    // the loadout and actions, so equip/craft never disappear below the fold.
    const InventoryGrid naturalGrid = inventoryGrid(profile, layout, 0.0);
    const double maxScroll = std::max(0.0, naturalGrid.contentHeight - layout.items.h);
    if (window_.wheelDelta() != 0.0f) {
        inventoryScroll_ = clamp(inventoryScroll_ - static_cast<double>(window_.wheelDelta()) * 42.0,
                                 0.0, maxScroll);
    } else {
        inventoryScroll_ = clamp(inventoryScroll_, 0.0, maxScroll);
    }
    const InventoryGrid grid = inventoryGrid(profile, layout, inventoryScroll_);
    const Vec2 mouse{window_.mouseX(), window_.mouseY()};

    if (window_.mousePressed(MouseButton::Left)) {
        for (const InventoryCell& cell : grid.cells) {
            if (hit(cell.rect, mouse)) {
                draggingStack_ = static_cast<int>(cell.stack);
                draggingLoadoutSlot_ = -1;
                return;
            }
        }
        for (std::size_t i = 0; i < layout.loadout.size(); ++i) {
            const bool filled = i < profile.loadout.size() && !profile.loadout[i].empty();
            if (filled && hit(layout.loadout[i], mouse)) {
                draggingLoadoutSlot_ = static_cast<int>(i);
                draggingStack_ = -1;
                return;
            }
        }
    }

    if (!window_.mouseReleased(MouseButton::Left)) return;

    if (hit(layout.close, mouse)) {
        inventoryOpen_ = false;
        draggingStack_ = -1;
        draggingLoadoutSlot_ = -1;
        return;
    }

    int targetSlot = -1;
    for (std::size_t i = 0; i < layout.loadout.size(); ++i) {
        if (hit(layout.loadout[i], mouse)) {
            targetSlot = static_cast<int>(i);
            break;
        }
    }

    if (draggingStack_ >= 0) {
        if (draggingStack_ < static_cast<int>(profile.inventory.size())) {
            const Profile::Stack& stack = profile.inventory[static_cast<std::size_t>(draggingStack_)];
            if (targetSlot >= 0) {
                net_.setLoadoutSlot(targetSlot, stack.petalIndex, stack.rarity);
            } else {
                // A click (press/release on the same cell) chooses the stack;
                // a drop outside a loadout slot simply returns it to the list.
                for (const InventoryCell& cell : grid.cells) {
                    if (cell.stack == static_cast<std::size_t>(draggingStack_) && hit(cell.rect, mouse)) {
                        selectedPetalIndex_ = stack.petalIndex;
                        selectedRarity_ = stack.rarity;
                        break;
                    }
                }
            }
        }
        draggingStack_ = -1;
        return;
    }

    if (draggingLoadoutSlot_ >= 0) {
        if (targetSlot >= 0 && targetSlot != draggingLoadoutSlot_) {
            net_.swapLoadoutSlots(draggingLoadoutSlot_, targetSlot);
        } else if (targetSlot < 0) {
            // Dropping a loadout item back onto the panel (or outside it)
            // unequips it. The server returns the petal to the inventory.
            net_.setLoadoutSlot(draggingLoadoutSlot_, kNoPetal, Rarity::Common);
        }
        draggingLoadoutSlot_ = -1;
        return;
    }

    const Profile::Stack* selected = findInventoryStack(profile, selectedPetalIndex_, selectedRarity_);
    if (selected != nullptr && hit(layout.equip, mouse)) {
        for (std::size_t i = 0; i < kLoadoutSlots; ++i) {
            if (i >= profile.loadout.size() || profile.loadout[i].empty()) {
                net_.setLoadoutSlot(static_cast<int>(i), selected->petalIndex, selected->rarity);
                break;
            }
        }
    } else if (selected != nullptr && selected->count >= 5 && hit(layout.craft, mouse)) {
        net_.requestCraft(selected->petalIndex, selected->rarity, 5);
    }
}

void App::updateDead(double dt) {
    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    const double centreX = window_.width() * 0.5;
    const double centreY = window_.height() * 0.5;
    const Rect respawn{centreX - 100, centreY + 30, 200, 50};
    const Rect toTitle{centreX - 70, centreY + 95, 140, 36};

    if (window_.keyPressed(Key::Enter) || window_.mouseReleased(MouseButton::Left)) {
        if (window_.keyPressed(Key::Enter) || hit(respawn, mouse)) {
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
    const AuthLayout layout = authLayout(canvas.width(), canvas.height(), registering_);
    const double centreX = canvas.width() * 0.5;

    TextStyle title;
    title.size = 48;
    title.align = Align::Centre;
    title.bold = true;
    title.strokeWidth = 6;
    // The TypeScript UI places this above the form. Clamp it for short native
    // windows where its desktop-first offset would otherwise be off-screen.
    text(canvas, "flowrix beta", centreX, std::max(52.0, canvas.height() * 0.5 - 400.0), title);

    TextStyle heading;
    heading.size = 28;
    heading.align = Align::Centre;
    heading.bold = true;
    heading.strokeWidth = 3;
    text(canvas, registering_ ? "Create an account" : "Log in",
         centreX, layout.headingY, heading);

    TextFieldStyle authField;
    authField.fill = 0x18CE18u;
    authField.outline = shade(authField.fill, 0.8);
    authField.focusedOutline = authField.outline;
    authField.radius = 3.0;
    authField.outlineWidth = 4.0;
    authField.focusedOutlineWidth = 5.0;
    authField.textStrokeWidth = 2.0;
    textField(canvas, layout.username,
              usernameField_, "Username", focusedField_ == 0, false, time, authField);
    textField(canvas, layout.password,
              passwordField_, "Password", focusedField_ == 1, true, time, authField);
    if (registering_) {
        textField(canvas, layout.confirmation, confirmPasswordField_, "Confirm Password",
                  focusedField_ == 2, true, time, authField);
    }

    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    ButtonStyle actionStyle;
    actionStyle.fill = 0x8A2BE2u;
    actionStyle.radius = 3.0;
    actionStyle.enabled = !usernameField_.empty() && !passwordField_.empty() &&
                          (!registering_ || !confirmPasswordField_.empty());
    actionStyle.textSize = 18;
    button(canvas, layout.action, registering_ ? "Register" : "Log in",
           hit(layout.action, mouse), window_.mouseDown(MouseButton::Left) && hit(layout.action, mouse),
           actionStyle);

    ButtonStyle modeStyle;
    modeStyle.fill = registering_ ? 0x6A1B9Au : 0x8A2BE2u;
    modeStyle.radius = 3.0;
    modeStyle.textSize = 18;
    button(canvas, layout.modeSwitch, registering_ ? "Back to Log in" : "Register",
           hit(layout.modeSwitch, mouse),
           window_.mouseDown(MouseButton::Left) && hit(layout.modeSwitch, mouse), modeStyle);

    if (!loginMessage_.empty()) {
        TextStyle error;
        error.size = 14;
        error.align = Align::Centre;
        error.fill = kDanger;
        error.strokeWidth = 2;
        text(canvas, loginMessage_, centreX, layout.modeSwitch.bottom() + 24, error);
    }
}

void App::drawTitleBackground(Canvas& canvas, double time) {
    // Fallback reproduces the dominant colour of land.svg when a custom data
    // directory does not include the optional title texture.
    setFill(canvas, 0x1EA761u);
    canvas.fillRect(0, 0, static_cast<float>(canvas.width()), static_cast<float>(canvas.height()));

    constexpr double kTile = 400.0;
    const double scrollX = std::fmod(time * 32.0, kTile);
    const double scrollY = std::fmod(time * 19.0, kTile);
    if (titleBackground_) {
        for (double y = -kTile - scrollY; y < canvas.height(); y += kTile) {
            for (double x = -kTile - scrollX; x < canvas.width(); x += kTile) {
                // A small overlap removes sub-pixel seams in both the native
                // rasteriser and browser Canvas 2D backends.
                titleBackground_->renderFitted(canvas, static_cast<float>(x), static_cast<float>(y),
                                               static_cast<float>(kTile + 2),
                                               static_cast<float>(kTile + 2),
                                               static_cast<float>(time));
            }
        }
    } else {
        // Keep the fallback textured instead of reverting to a flat backdrop.
        setFill(canvas, 0x1C9959u);
        for (double y = -80 - scrollY; y < canvas.height() + 80; y += 120) {
            for (double x = -80 - scrollX; x < canvas.width() + 80; x += 120) {
                canvas.fillCircle(static_cast<float>(x), static_cast<float>(y), 18);
            }
        }
    }

    // The browser title scene floats real petal art over the scrolling biome.
    // Use stable, time-driven paths so this stays deterministic in screenshots
    // and does not need a second retained UI system.
    const std::size_t petalCount = content().petalCount();
    if (petalCount == 0) return;
    for (int i = 0; i < 7; ++i) {
        const double speed = 18.0 + i * 3.5;
        const double x = std::fmod(time * speed + i * 211.0,
                                   static_cast<double>(canvas.width()) + 140.0) - 70.0;
        const double y = std::fmod(i * 97.0 + std::sin(time * 0.7 + i) * 60.0 +
                                   canvas.height() * 0.16,
                                   std::max(1.0, static_cast<double>(canvas.height())));
        const double size = 28.0 + (i % 3) * 12.0;
        const std::uint16_t petal = static_cast<std::uint16_t>((i * 17) % petalCount);
        canvas.setGlobalAlpha(0.86f);
        sprites_.drawPetal(canvas, petal, x, y, size, time * (0.35 + i * 0.06), time);
        canvas.setGlobalAlpha(1.0f);
    }
}

void App::drawLobby(Canvas& canvas, double time) {
    const Profile& profile = net_.profile();

    TextStyle title;
    title.size = kTitleSize;
    title.align = Align::Centre;
    title.bold = true;
    text(canvas, "flowrix beta 2", canvas.width() * 0.5, canvas.height() * 0.18, title);

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
        const std::uint32_t fill = filled ? rarityColor(profile.loadout[i].rarity) : kSlot;
        plate(canvas, slot, fill, kSlotRadius, shade(fill, 0.8));
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

    const Rect inventory{(canvas.width() - 260) * 0.5, play.bottom() + 12.0, 260, 42};
    ButtonStyle inventoryStyle;
    inventoryStyle.fill = kPanel;
    inventoryStyle.outline = kPanelDark;
    inventoryStyle.textSize = kBodySize;
    button(canvas, inventory, "Inventory  (Z)", hit(inventory, mouse),
           window_.mouseDown(MouseButton::Left) && hit(inventory, mouse), inventoryStyle);

    TextStyle hint;
    hint.size = kSmallSize;
    hint.align = Align::Centre;
    hint.fill = shade(kPaper, 0.75);
    text(canvas, "Move with the mouse · hold left to attack · right to defend",
         canvas.width() * 0.5, inventory.bottom() + 28, hint);
}

void App::drawInventory(Canvas& canvas, double time) {
    const Profile& profile = net_.profile();
    const InventoryLayout layout = inventoryLayout(canvas.width(), canvas.height());
    const InventoryGrid grid = inventoryGrid(profile, layout, inventoryScroll_);
    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    const Profile::Stack* selected =
        findInventoryStack(profile, selectedPetalIndex_, selectedRarity_);

    scrim(canvas, 0.50);
    panel(canvas, layout.panel);

    TextStyle title;
    title.size = kHeadingSize;
    title.bold = true;
    title.align = Align::Left;
    text(canvas, "Inventory", layout.panel.x + kInventoryPadding, layout.panel.y + 28.0, title);

    TextStyle guidance;
    guidance.size = kSmallSize;
    guidance.fill = shade(kPaper, 0.8);
    guidance.strokeWidth = 0;
    text(canvas, selected == nullptr
                     ? "Select a petal, then drag it to a loadout slot."
                     : inventoryName(content().petal(selected->petalIndex).name) + " · " +
                           rarityLabel(selected->rarity) + " · x" + std::to_string(selected->count),
         layout.panel.x + kInventoryPadding, layout.panel.y + 49.0, guidance);

    ButtonStyle closeStyle;
    closeStyle.fill = kDanger;
    closeStyle.outline = shade(kDanger, 0.72);
    closeStyle.outlineWidth = 3.0;
    closeStyle.textSize = 18.0;
    closeStyle.textStrokeWidth = 2.0;
    button(canvas, layout.close, "×", hit(layout.close, mouse),
           window_.mouseDown(MouseButton::Left) && hit(layout.close, mouse), closeStyle);

    bool hasEmptySlot = false;
    for (std::size_t i = 0; i < kLoadoutSlots; ++i) {
        if (i >= profile.loadout.size() || profile.loadout[i].empty()) {
            hasEmptySlot = true;
            break;
        }
    }
    ButtonStyle actionStyle;
    actionStyle.fill = kAccent;
    actionStyle.outlineWidth = 3.0;
    actionStyle.textSize = 12.0;
    actionStyle.textStrokeWidth = 2.0;
    actionStyle.enabled = selected != nullptr && hasEmptySlot;
    button(canvas, layout.equip, "Equip", hit(layout.equip, mouse),
           window_.mouseDown(MouseButton::Left) && hit(layout.equip, mouse), actionStyle);

    ButtonStyle craftStyle = actionStyle;
    craftStyle.fill = 0x8A2BE2u;
    craftStyle.enabled = selected != nullptr && selected->count >= 5 && selected->rarity != Rarity::Apex;
    button(canvas, layout.craft, "Craft x5", hit(layout.craft, mouse),
           window_.mouseDown(MouseButton::Left) && hit(layout.craft, mouse), craftStyle);

    TextStyle loadoutLabel;
    loadoutLabel.size = kSmallSize;
    loadoutLabel.bold = true;
    loadoutLabel.align = Align::Centre;
    loadoutLabel.fill = shade(kPaper, 0.85);
    loadoutLabel.strokeWidth = 0;
    text(canvas, "LOADOUT", layout.panel.x + layout.panel.w * 0.5, layout.panel.y + 61.0, loadoutLabel);

    for (std::size_t i = 0; i < layout.loadout.size(); ++i) {
        const Rect slot = layout.loadout[i];
        const bool filled = i < profile.loadout.size() && !profile.loadout[i].empty();
        const std::uint32_t fill = filled ? rarityColor(profile.loadout[i].rarity) : kSlot;
        plate(canvas, slot, fill, kSlotRadius, shade(fill, 0.78),
              draggingLoadoutSlot_ == static_cast<int>(i) ? 5.0 : 3.0);
        if (filled) {
            sprites_.drawPetal(canvas, profile.loadout[i].petalIndex,
                               slot.x + slot.w * 0.5, slot.y + slot.h * 0.5,
                               slot.w * 0.68, 0.0, time);
        }
        TextStyle slotNumber;
        slotNumber.size = 10.0;
        slotNumber.align = Align::Centre;
        slotNumber.fill = filled ? shade(kPaper, 0.8) : shade(kInk, 0.4);
        slotNumber.strokeWidth = filled ? 1.5 : 0.0;
        text(canvas, std::to_string(i + 1), slot.x + slot.w * 0.5, slot.bottom() + 10.0, slotNumber);
    }

    TextStyle itemsLabel;
    itemsLabel.size = kSmallSize;
    itemsLabel.bold = true;
    itemsLabel.fill = shade(kPaper, 0.85);
    itemsLabel.strokeWidth = 0;
    text(canvas, "PETALS", layout.items.x, layout.items.y - 14.0, itemsLabel);

    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(layout.items.x), static_cast<float>(layout.items.y),
                static_cast<float>(layout.items.w), static_cast<float>(layout.items.h));
    canvas.clip();

    for (const InventorySection& section : grid.sections) {
        if (section.y < layout.items.y - 12.0 || section.y > layout.items.bottom() + 12.0) continue;
        TextStyle sectionStyle;
        sectionStyle.size = kSmallSize;
        sectionStyle.bold = true;
        sectionStyle.fill = rarityColor(section.rarity);
        sectionStyle.strokeWidth = 2.0;
        text(canvas, rarityLabel(section.rarity), layout.items.x, section.y, sectionStyle);
    }

    for (const InventoryCell& cell : grid.cells) {
        if (!cell.rect.intersects(layout.items) || cell.stack >= profile.inventory.size()) continue;
        const Profile::Stack& stack = profile.inventory[cell.stack];
        const bool isSelected = selected != nullptr && selected->petalIndex == stack.petalIndex &&
                                selected->rarity == stack.rarity;
        const bool isDragging = draggingStack_ == static_cast<int>(cell.stack);
        const std::uint32_t fill = rarityColor(stack.rarity);
        plate(canvas, cell.rect, fill, kSlotRadius, isSelected ? kPaper : shade(fill, 0.72),
              isSelected || isDragging ? 5.0 : 3.0, isDragging ? 0.72 : 1.0);
        sprites_.drawPetal(canvas, stack.petalIndex,
                           cell.rect.x + cell.rect.w * 0.5, cell.rect.y + cell.rect.h * 0.42,
                           cell.rect.w * 0.47, 0.0, time);

        TextStyle name;
        name.size = clamp(cell.rect.w * 0.115, 8.0, 12.0);
        name.bold = true;
        name.align = Align::Centre;
        name.strokeWidth = 2.0;
        text(canvas, inventoryName(content().petal(stack.petalIndex).name),
             cell.rect.x + cell.rect.w * 0.5, cell.rect.bottom() - 10.0, name);

        if (stack.count > 1) {
            TextStyle count;
            count.size = 11.0;
            count.bold = true;
            count.align = Align::Right;
            count.strokeWidth = 2.0;
            text(canvas, "x" + std::to_string(stack.count), cell.rect.right() - 5.0, cell.rect.y + 10.0, count);
        }
    }
    canvas.restore();

    if (grid.cells.empty()) {
        TextStyle empty;
        empty.size = kBodySize;
        empty.align = Align::Centre;
        empty.fill = shade(kPaper, 0.75);
        empty.strokeWidth = 0;
        text(canvas, "No petals collected yet.", layout.items.x + layout.items.w * 0.5,
             layout.items.y + layout.items.h * 0.5, empty);
    } else if (grid.contentHeight > layout.items.h) {
        TextStyle scrollHint;
        scrollHint.size = 10.0;
        scrollHint.align = Align::Right;
        scrollHint.fill = shade(kPaper, 0.72);
        scrollHint.strokeWidth = 0;
        text(canvas, "Scroll for more", layout.items.right(), layout.panel.bottom() - 7.0, scrollHint);
    }
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
        const std::uint32_t fill = filled ? rarityColor(profile.loadout[i].rarity) : kSlot;
        plate(canvas, slot, fill, kSlotRadius, shade(fill, 0.8), -1, 0.9);
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
    scrim(canvas, 0.65);
    const double centreX = canvas.width() * 0.5;
    const double centreY = canvas.height() * 0.5;

    TextStyle heading;
    heading.size = 48;
    heading.align = Align::Centre;
    heading.bold = true;
    heading.fill = kDanger;
    heading.strokeWidth = 5;
    text(canvas, "You Died!", centreX, centreY - 60, heading);

    TextStyle by;
    by.size = 22;
    by.align = Align::Centre;
    by.strokeWidth = 3;
    const std::string killer = net_.killerName().empty()
        ? "A mysterious entity"
        : net_.killerName();
    text(canvas, "You were destroyed by: " + killer, centreX, centreY - 10, by);

    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    const Rect respawn{centreX - 100, centreY + 30, 200, 50};
    ButtonStyle continueStyle;
    continueStyle.fill = 0x4A8E3Au;
    continueStyle.outline = 0x2D5A22u;
    continueStyle.outlineWidth = 3;
    continueStyle.radius = 10;
    continueStyle.textSize = 22;
    button(canvas, respawn, "Continue", hit(respawn, mouse),
           window_.mouseDown(MouseButton::Left) && hit(respawn, mouse), continueStyle);

    const Rect close{centreX - 70, centreY + 95, 140, 36};
    ButtonStyle closeStyle;
    closeStyle.fill = 0x666666u;
    closeStyle.outline = 0x444444u;
    closeStyle.outlineWidth = 3;
    closeStyle.radius = 10;
    closeStyle.textSize = 16;
    button(canvas, close, "Close", hit(close, mouse),
           window_.mouseDown(MouseButton::Left) && hit(close, mouse), closeStyle);

    TextStyle hint;
    hint.size = 14;
    hint.align = Align::Centre;
    hint.fill = shade(kPaper, 0.6);
    hint.strokeWidth = 0;
    text(canvas, "Press ENTER to continue", centreX, close.bottom() + 25, hint);
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
