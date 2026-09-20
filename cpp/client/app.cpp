// The app shell: what starts, what runs every frame, and what is saved on the
// way out.
//
// App is one class behind one header (client/app.h), but it is not one file.
// Each screen and each in-game surface is big enough to be worth reading on
// its own, so each has a translation unit of its own:
//
//   app_login.cpp     reaching the server, and the auth form
//   app_lobby.cpp     the title screen: backdrop, spawn picker, daily streak
//   app_game.cpp      the input frame, dying, and the disconnect banner
//   app_hud.cpp       the corner HUD, the squad bars and the boss bars
//   app_minimap.cpp   the world map, the maze map and the arena scoreboard
//   app_chat.cpp      the transcript, its input line and the slash commands
//
// What stays here is the shell those run inside: the window and the socket,
// the loop that decides which screen gets the frame, and the state that
// outlives any one of them -- the session on disk, the wipe that covers a
// scene change, the text selection over whatever painted last, and the stats
// readout, which is measured off this loop and nowhere else.

#include "client/app.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <utility>

#include "client/app_internal.h"
#include "client/interpolation.h"
#include "client/ui/draw.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "client/web/reload.h"
#include "shared/game/config.h"
#include "shared/game/constants.h"
#include "shared/game/tiled_map.h"

namespace flix {

using namespace flix::ui;

namespace {

/// How far the world is dimmed while the player is dead.
///
/// `~/gardn` paints `0x20000000` here -- black at 32 of 255 -- and this build
/// deliberately does not: at 12.5% the world barely moved, and against a HUD
/// that stays at full brightness there was nothing to tell you the game had
/// stopped being yours. This is the browser build's old death scrim by
/// strength, over the world ALONE by placement. Turning it back down to
/// gardn's number is a one-line change; it is not a parity bug.
constexpr double kDeathDimAlpha = 0.65;

/// JavaScript's `toFixed(2)`, for the stats overlay's frame time.
std::string twoDecimals(double value) {
    char buffer[32];
    std::snprintf(buffer, sizeof buffer, "%.2f", value);
    return buffer;
}

std::string oneDecimal(double value) {
    char buffer[32];
    std::snprintf(buffer, sizeof buffer, "%.1f", value);
    return buffer;
}

/// The reference's `formatBytes`: whole bytes below a kilobyte, one decimal
/// above. Used for both the throughput totals and the per-event breakdown.
std::string formatBytes(double bytes) {
    char buffer[32];
    if (bytes < 1024.0) {
        std::snprintf(buffer, sizeof buffer, "%d B", static_cast<int>(bytes));
    } else if (bytes < 1024.0 * 1024.0) {
        std::snprintf(buffer, sizeof buffer, "%.1f KB", bytes / 1024.0);
    } else {
        std::snprintf(buffer, sizeof buffer, "%.1f MB", bytes / (1024.0 * 1024.0));
    }
    return buffer;
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
    if (!sprites_.build(content(), config.dataDir)) {
        errorOut = "could not compile sprite artwork";
        return false;
    }
    for (const std::string& warning : sprites_.warnings()) {
        std::fprintf(stderr, "[sprites] %s\n", warning.c_str());
    }


    if (!window_.open(config.windowWidth, config.windowHeight, "florr", errorOut)) return false;
    // Everything below draws in design units, not pixels. Set before the
    // first frame, because the camera's viewport and every panel's layout are
    // read straight off window_.width()/height().
    window_.setDesignSize(kDesignWidth, kDesignHeight);
    coarsePointer_ = window_.coarsePointer();

    renderer_.setContent(&content());
    renderer_.setSprites(&sprites_);
    // The published skins, for the flowers wearing them. NetClient owns the
    // list and replaces it on every SkinCatalog/SkinPublished/SkinDeleted, so
    // the renderer holds the container and looks a wearer up per frame rather
    // than caching a resolved pointer that a takedown would dangle.
    renderer_.setSkinCatalog(&net_.skinCatalog());
    // What each flower was last heard saying, for the bubbles over their
    // heads. Owned by NetClient for the same reason the catalog is: the lines
    // arrive on the socket, and the renderer reads the live list per frame.
    renderer_.setChatBubbles(&net_.chatBubbles());
    // NetClient keeps this object alive for the entire connection and replaces
    // its grid with the server's authoritative one when a game is joined.
    renderer_.setTerrain(&net_.terrain());
    // Every staged map, by realm: the TILE ART the renderer paints the world
    // with, plus the annotations -- teleporter pads, the rarity glow's bands.
    // A pointer to a member that is filled a few lines down: the renderer
    // reads it per frame, never now.
    renderer_.setWorldMaps(&worldMaps_);
    // The same maps the renderer draws from, for their collision shapes: the
    // wire's grid is the coarse view, the file is the exact geometry. A realm
    // with no map here falls back to whole-cell collision, which is
    // conservative -- see NetClient::installLocalCollision.
    net_.setWorldMaps(&worldMaps_);
    net_.contentHash = content().contentHash();

    // The client reads the maps for what they MEAN, what they LOOK LIKE, and
    // the SHAPES their tiles collide with; what is solid is still the server's
    // answer. The coarse grid arrives over the wire, authoritative, and a
    // second copy off disk would be a second answer about which cells block --
    // so no Terrain is passed here, and NetClient installs the shapes for the
    // realm it is dropped into on top of the grid it was sent (net_.
    // setWorldMaps below). Maps it cannot read cost the picker its choices, the
    // world its art and the client its exact edges, not its start.
    std::string mapWarning;
    if (!worldMaps_.load(config.dataDir, nullptr, mapWarning)) {
        std::fprintf(stderr, "[map] %s; the spawn picker will offer the default only\n",
                     mapWarning.c_str());
    }
    // Everything the picker can name: the default, the two realms that have
    // no map file, and then every player spawn rectangle every staged map
    // draws -- which is how a second map is reachable without walking to a
    // teleporter first. pickerTabs() files these under one tab per biome.
    spawnChoices_.push_back(
        SpawnChoice{"default", "Default", 0x00BE4Fu, Realm::Overworld, -1, {}, {}});
    spawnChoices_.push_back(
        SpawnChoice{kArenaSpawnChoice, "PVP Arena", 0xDC3C3Cu, Realm::Arena, -1, {}, {}});
    spawnChoices_.push_back(
        SpawnChoice{kMazeSpawnChoice, "Maze", 0x573D80u, Realm::Maze, -1, {}, {}});
    for (const SpawnChoice& choice : worldMaps_.spawnChoices()) spawnChoices_.push_back(choice);

    // The backdrop's petals are drawn from every petal a player could actually
    // own: admin-only art and the runtime egg petals are excluded, exactly as
    // the browser build's pickPetal filters them.
    for (std::uint16_t i = 0; i < content().petalCount(); ++i) {
        const PetalConfig& petal = content().petal(i);
        if (petal.isAdminPetal) continue;
        const std::string& id = petal.id;
        if (id.size() >= 4 && id.compare(id.size() - 4, 4, "_egg") == 0) continue;
        titlePetalTypes_.push_back(i);
    }

    // The endpoint the Advanced Settings drawer starts on: where this client
    // was pointed. The browser seeds the same field with its own origin.
    serverField_ = config_.host + ":" + std::to_string(config_.port);

    // Seeded from the clock, not a constant: this stream also mints guest
    // credentials, and a fixed seed would hand two clients started together
    // the same account name and the same password.
    titleRng_.reseed(static_cast<std::uint64_t>(wallClockMillis()));

    loadSession();
    // Whether Settings offers a Grant Admin row at all. A hook is the only way
    // this client can make anybody an admin, so a build without one -- every
    // build that dials a real server -- draws no button.
    menus_.setAdminGrantOffered(static_cast<bool>(config_.grantAdmin));
    // A missing settings file is a first run, not a failure: the defaults in
    // ClientSettings are already the shipped configuration.
    menus_.settings().load(settingsPath());
    // A saved door that no staged map offers any more -- renamed, removed,
    // or a sublevel door that stopped being pickable -- is dropped here,
    // once. Kept, it would send a choice the server refuses with a notice
    // on every join, and show a picker with nothing chosen on it.
    {
        const std::string& saved = menus_.settings().spawnChoice;
        bool offered = saved.empty();
        for (const SpawnChoice& choice : spawnChoices_) offered |= choice.id == saved;
        if (!offered) {
            std::fprintf(stderr, "[spawn] the saved spawn point \"%s\" is not on this build's "
                                 "maps; starting at the default\n", saved.c_str());
            menus_.settings().spawnChoice.clear();
        }
    }
    // The picker opens on the tab the saved door is filed under, so the row a
    // returning player sees is the one their choice is on.
    pickerTab_ = pickerTabOf(menus_.settings().spawnChoice);
    // Before the first frame rather than only from frame(): a --frames run
    // short enough to be one screenshot would otherwise photograph the
    // default resolution whatever the file says.
    window_.setRenderScale(menus_.settings().renderScale);
    if (!net_.connect(config.host, config.port)) {
        errorOut = net_.lastError();
        return false;
    }

    // The touch controls own their own contacts, and have to say so the
    // instant a finger lands rather than on the frame that follows -- see the
    // touch section of Window's header for why the answer cannot wait.
    window_.setTouchClaimHandler([this](const TouchPoint& point) {
        return touchControlsVisible() && mobile_.hits(point.x, point.y);
    });

    if (config.autoMenu != MenuId::None) menus_.toggle(config.autoMenu);

    // Seeded before the first frame rather than after the join, so a
    // --frames run short enough to be one screenshot still photographs them.
    // No author: these stand in for the server's own announcements, which are
    // the lines that carry markup.
    for (const std::string& line : config.seedChat) net_.addLocalChat({}, line);

    screen_ = Screen::Connecting;
    running_ = true;
    return true;
}

void App::run() {
    while (step()) {
    }
    shutdown();
}

void App::persist() {
    // Written on the way out rather than on every toggle: this is a handful of
    // switches, and a file write per click would be absurd. The flower's name
    // is remembered on the same terms.
    menus_.settings().save(settingsPath());
    saveSession();
}

void App::shutdown() {
    persist();
}

bool App::step() {
    if (!running_ || !window_.pump()) return false;

    const double dt = window_.frameDelay(60.0);
    timeSeconds_ = window_.timeSeconds();
    frame(dt);
    // Measured around frame() and not off `dt`: dt includes the sleep that
    // frameDelay just took, so it reports the cap rather than the cost.
    const double frameMillis = (window_.timeSeconds() - timeSeconds_) * 1000.0;
    frameTimeAccum_ += frameMillis;
    ++frameTimeSamples_;
    runFrameAccum_ += frameMillis;
    ++runFrameSamples_;
    const WorldRenderer::SectionTiming& section = renderer_.sectionTiming();
    sectionMobs_.accumMillis += section.mobsMillis;
    sectionItems_.accumMillis += section.itemsMillis;
    sectionProjectiles_.accumMillis += section.projectilesMillis;
    sectionMobs_.windowPeakMillis =
        std::max(sectionMobs_.windowPeakMillis, section.mobsMillis);
    sectionItems_.windowPeakMillis =
        std::max(sectionItems_.windowPeakMillis, section.itemsMillis);
    sectionProjectiles_.windowPeakMillis =
        std::max(sectionProjectiles_.windowPeakMillis, section.projectilesMillis);
    sectionItemCount_ = section.itemCount;

    if (config_.screenshotAfterFrames > 0 &&
        ++framesDrawn_ >= config_.screenshotAfterFrames) {
        if (!config_.screenshotPath.empty()) {
            window_.canvas().savePPM(config_.screenshotPath);
            std::fprintf(stderr, "wrote %s\n", config_.screenshotPath.c_str());
        }
        // The cost of the work, with the 60Hz sleep excluded -- see
        // runFrameAccum_. This is the number to compare between two builds.
        if (runFrameSamples_ > 0) {
            const double avg = runFrameAccum_ / runFrameSamples_;
            std::fprintf(stderr, "frames=%d avg=%.2fms/frame (%.1f fps uncapped)\n",
                         runFrameSamples_, avg, avg > 0 ? 1000.0 / avg : 0.0);
        }
        running_ = false;
    }

    return running_;
}

void App::pollNetwork() {
    // Zero timeout: the frame loop sets the cadence, and blocking here would
    // couple frame rate to packet arrival.
    net_.poll(0);

    // The server is serving a build this one is not. Nothing here can talk to
    // it, and the bytes that could are on the server: on the web that is a
    // page load away, so take it. A native client has no such move and falls
    // through to the refusal message the handshake already left in lastError().
    if (net_.staleBuild) {
        net_.staleBuild = false;
        web::reloadForStaleBuild();
    }

    // The socket came back -- see onReconnected for why that is not simply
    // carrying on where the drop happened.
    if (net_.reconnected) {
        net_.reconnected = false;
        onReconnected();
    }

    // A drop mid-game does NOT take the game off the screen: the world, the
    // HUD and the panels keep drawing and a banner says what happened. Only a
    // failure before the player ever had a body replaces the screen.
    if (net_.status() == NetClient::Status::Failed && screen_ != Screen::Disconnected &&
        screen_ != Screen::Playing && screen_ != Screen::Dead) {
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
            focusedField_ = -1;
            saveSession();
            screen_ = Screen::Lobby;
        }
    }
    if (net_.sessionTokenRenewed) {
        // A password change reissued this session's token. Written out now
        // rather than at shutdown: the old one is already dead server-side, so
        // a crash between here and the exit would cost a login the player has
        // no way to connect to what they just did.
        net_.sessionTokenRenewed = false;
        saveSession();
    }
    if (net_.dead() && screen_ == Screen::Playing) {
        // Nothing is closed on death. An open panel and the icon strip keep
        // rendering behind the card, exactly as they do in the reference.
        deathCardVisible_ = true;
        screen_ = Screen::Dead;
    }
    // A yggdrasil put the body back on its feet. Read as a one-shot flag
    // rather than as `!net_.dead()`, because --dead raises the card on a
    // client the server never told anything, and the symmetric test would
    // take it straight back down.
    if (net_.revived) {
        net_.revived = false;
        if (screen_ == Screen::Dead) {
            // The card goes with the death it was announcing; the world under
            // it never stopped drawing, so there is nothing else to restore.
            deathCardVisible_ = false;
            screen_ = Screen::Playing;
        }
    }
}

void App::frame(double dt) {
    pollNetwork();

    // Before anything is updated OR painted: the auth form registers its
    // focused field from the update phase and the panels record their text
    // from the draw phase, and both belong to the frame that is starting.
    ui::TextSelect::instance().beginFrame();
    // Same reason, and the same one-frame contract: a field records its box as
    // it is hit-tested, and the window is handed the set at the end of the
    // frame so a touch can raise the keyboard from inside its own gesture.
    ui::TextFieldRegions::instance().beginFrame();

    // The pointer starts every frame as an arrow and whatever is under it says
    // otherwise, which is how the reference works: `canvas.style.cursor` is
    // reassigned on each move and falls back to the sheet's `cursor: default`.
    // Without the reset a panel that closed under a hand cursor would leave it.
    window_.setCursorShape(CursorShape::Arrow);

    // A once-a-second frame count, which is what the counters report -- an
    // instantaneous 1/dt jitters too much to read.
    ++frameCounter_;
    if (timeSeconds_ - fpsWindowStart_ >= 1.0) {
        framesPerSecond_ = frameCounter_;
        frameCounter_ = 0;
        fpsWindowStart_ = timeSeconds_;
        // Rolled over with the frame count, as the reference rolls its own
        // (src/game.ts:1252-1265): one number a second, not sixty.
        frameTimeAvgMs_ = frameTimeSamples_ > 0 ? frameTimeAccum_ / frameTimeSamples_ : 0.0;
        // The per-layer figures roll on the same boundary and over the same
        // sample count, so "Render avg/peak" always adds up against the frame
        // time printed beside it.
        for (SectionStats* section : {&sectionMobs_, &sectionItems_, &sectionProjectiles_}) {
            section->avgMillis =
                frameTimeSamples_ > 0 ? section->accumMillis / frameTimeSamples_ : 0.0;
            section->peakMillis = section->windowPeakMillis;
            section->accumMillis = 0;
            section->windowPeakMillis = 0;
        }
        frameTimeAccum_ = 0;
        frameTimeSamples_ = 0;
        // Counters are drained here and nowhere else, which is what makes the
        // figures bytes per SECOND rather than bytes since some other event.
        net_.takeWireStats(incomingBytesPerSecond_, outgoingBytesPerSecond_, topWireEvents_);
    }

    // The render-resolution setting reaches the window here rather than from
    // the settings panel, for the same reason the renderer's switches do
    // below: one place copies the settings out, and the panel never reaches
    // into anything. setRenderScale ignores a value it already has, so this
    // costs nothing on the frames where nothing moved.
    window_.setRenderScale(menus_.settings().renderScale);

    Canvas& canvas = window_.canvas();
    // The frame's base transform: design units -> canvas pixels. Every draw
    // call below is in design units, and this is the only place that knows
    // how big a design unit is. resetTransform first because the canvas
    // persists across frames and a save() a screen forgot to balance would
    // otherwise compound frame after frame.
    canvas.resetTransform();
    const float uiScale = static_cast<float>(window_.uiScale());
    canvas.scale(uiScale, uiScale);
    camera_.setViewport(window_.width(), window_.height());
    // Laid out every frame and before any screen runs: a phone that turns on
    // its side changes the viewport between one frame and the next, and the
    // claim handler is asked about a contact using whatever the last frame
    // placed.
    mobile_.layout(window_.width(), window_.height(),
                   inGameLoadoutBarHeight(menus_.settings().classicLoadoutBar,
                                          window_.width()));
    // This frame's contacts, before any screen reads them. Here rather than in
    // updatePlaying because the frames the controls are NOT up for are the
    // ones that matter: dying, or a panel opening over a deflected stick, has
    // to drop what it was holding, and neither of those runs updatePlaying at
    // all -- a button left held would still be firing on the next game.
    if (touchControlsVisible()) mobile_.update(window_.touchEvents());
    else mobile_.reset();

    // Before any screen sees this frame's click. The browser's tutorial box is
    // a DOM element over the canvas: it takes the press first and the game
    // never hears about it, which is what the capturesMouse() guards below
    // stand in for.
    if (screen_ == Screen::Playing || screen_ == Screen::Dead) {
        tutorial_.update(window_, menus_.settings(), net_.profile(), timeSeconds_);
    }

    // Every drawn position advances here, BEFORE the screens see the frame.
    // The cursor control law measures from the flower's drawn position and the
    // camera pins to it, so easing after them would steer and frame the world
    // from a position one frame stale.
    if (screen_ == Screen::Playing || screen_ == Screen::Dead) {
        net_.view().easeRatePerSecond = easeRateFromAmount(menus_.settings().interpolation);
        // renderClockMillis(), not the window's clock: snapshot arrivals are
        // stamped against this one, and mob playback has to be measured on
        // the same timeline it is stamped on.
        net_.view().interpolate(renderClockMillis(), dt);
        // A teleporter that led to another map: the body is in a different
        // coordinate space now, and easing the flower or the camera from
        // where it WAS would sweep the view across a world it is not in.
        // Snapped exactly as the join does, then the stream takes over.
        Vec2 arrival;
        if (net_.takeRealmChange(arrival)) {
            net_.view().snapAll();
            camera_.snapTo(arrival);
        }
    }

    // The death card eases in from below and back out again, the way the
    // reference's container animation does: a fifth of the remaining distance
    // per 60Hz frame. Advanced here rather than in updateDead, because the
    // frames it slides back OUT on are frames the player is alive for.
    {
        const bool inWorld = screen_ == Screen::Playing || screen_ == Screen::Dead;
        const double target = (screen_ == Screen::Dead && deathCardVisible_) ? 1.0 : 0.0;
        // Snapped rather than eased when there is nothing to animate over:
        // leaving the world takes the card with it, and a scripted capture
        // wants the card where it comes to rest rather than wherever the
        // requested frame happens to catch it.
        if (!inWorld || config_.screenshotAfterFrames > 0) deathCardSlide_ = target;
        else deathCardSlide_ += (target - deathCardSlide_) * (1.0 - std::pow(0.8, dt * 60.0));
    }

    switch (screen_) {
        case Screen::Connecting:   updateConnecting(); break;
        case Screen::Login:        updateLogin(dt); break;
        case Screen::Lobby:        updateLobby(dt); break;
        case Screen::Playing:      updatePlaying(dt); break;
        case Screen::Dead:         updateDead(dt); break;
        case Screen::Disconnected: break;
    }

    // One heartbeat a second while the socket is up, as the reference's own
    // interval does. It is what makes the ping readout a number.
    // Every status the socket can be in once the handshake has passed: Ready
    // is only the gap before login, and a heartbeat that stopped there would
    // leave the readout on "--" for the whole session -- which is exactly what
    // it did.
    const NetClient::Status status = net_.status();
    const bool socketUp = status == NetClient::Status::Ready ||
                          status == NetClient::Status::LoggedIn ||
                          status == NetClient::Status::Playing;
    if (socketUp && timeSeconds_ >= nextPingSeconds_) {
        net_.sendPing();
        nextPingSeconds_ = timeSeconds_ + 1.0;
    }

    // Every frame, on every screen, open or not: the debug panel's graphs are
    // meant to already hold history when it is opened. See
    // DebugPanel::recordFrame.
    menus_.recordDebugSample(dt, net_);

    // The renderer's switches live in the settings menu, so they are copied
    // across every frame rather than the menu reaching into the renderer.
    renderer_.options = menus_.settings().render;
    camera_.userZoom = menus_.settings().zoom;
    // The petals' share of the zoom, read off the account's own loadout: the
    // server does not compute it and it is not on the wire, as in the
    // browser. It rides into the viewport the next input frame reports, so
    // the server widens what it streams as soon as an observer goes on.
    camera_.loadoutZoom = loadoutCameraZoom(net_.profile(), content());
    const bool inWorld = screen_ == Screen::Playing || screen_ == Screen::Dead;
    menus_.setInGame(inWorld);
    if (menus_.takeExitRequest() && inWorld) leaveToTitle();
    // No inWorld guard: Settings' Log Out is offered on the title screen too,
    // and it is the one action that has to work from either of them.
    if (menus_.takeLogoutRequest()) logout();
    // Nor here: the offline page's Grant Admin row is drawn wherever the panel
    // is, and an account is all the grant needs. Nothing is sent -- the hook
    // reaches the server object in this same process, and the server answers
    // by resending the catalog that carries the flag.
    if (menus_.takeAdminGrantRequest() && config_.grantAdmin) {
        config_.grantAdmin(net_.profile().username);
    }

    // --- draw -------------------------------------------------------------
    // Forgotten before the draw, and set again by whoever paints it. Both the
    // chat's hit tests read the box the LAST frame painted, so a screen that
    // stops painting it -- the settings switch off, a panel covering it, the
    // title screen's own layout -- has to leave nothing behind to press.
    chatBox_ = {};
    if (inWorld) {
        renderer_.ingestEvents(net_.view());
        renderer_.update(dt);
        // Bubbles expire on the frame clock, like every other timed visual
        // here, and only while there is a world for them to float over --
        // leaving the game clears them outright.
        net_.ageChatBubbles(dt);
        // Pinned, not eased: the reference keeps the flower exactly on the
        // screen centre, which is what the cursor-relative control law reads.
        // The EASE is on the flower itself, one frame earlier -- see frame().
        //
        // Until a snapshot has placed the body -- the frames right after a
        // join or a realm change -- the view's self is a zeroed default, and
        // pinning to it draws the map's top-left corner with no flower in it.
        // The arrival the server sent is the honest position for those frames.
        const Vec2 selfDrawn =
            net_.selfPlaced() ? net_.view().selfDrawnPosition() : net_.arrival();
        camera_.snapTo(selfDrawn);
        renderer_.draw(canvas, net_.view(), camera_, selfDrawn, timeSeconds_);
        // Dead: the WORLD goes dim, and only the world. The reference's wash
        // goes between `render_game()` and its game UI window, so the HUD, the
        // minimap, the loadout bar and the card itself all stay at full
        // brightness over it; this sits in the same seam, at this build's own
        // depth (see kDeathDimAlpha). Switched, not faded -- in the reference
        // it appears on the frame `alive()` goes false.
        if (screen_ == Screen::Dead) scrim(canvas, kDeathDimAlpha);
        drawHud(canvas, timeSeconds_);
        // The reference hides the whole chat box while one of the three
        // petal-handling panels is up, rather than letting it poke out beside
        // the card.
        const MenuId open = menus_.open();
        const bool panelHidesChat = open == MenuId::Inventory || open == MenuId::Crafting;
        if (menus_.settings().showChat && !panelHidesChat) drawChat(canvas, timeSeconds_);
        // Panels and the icon strip keep drawing while dead, undimmed, with
        // the card over both -- but UNDER the loadout bar, which the reference paints
        // after the death screen: the card is the first child of its game UI
        // window and the loadout the fourth. Handing the card to the menus as
        // their between-strip-and-bar slot is the only way to land it there.
        // Only the paint moves: the card's button is still answered by
        // updateDead, before any of this.
        menus_.render(canvas, window_, net_, sprites_, renderer_, timeSeconds_, dt, [&] {
            // The slide, not the flag: the card keeps painting on its way back
            // down after a yggdrasil has put the body on its feet.
            if (deathCardSlide_ > 0.01) drawDeathCard(canvas, timeSeconds_);
        });
        if (net_.status() == NetClient::Status::Failed) drawDisconnectBanner(canvas);
        // Ping and the rest live here and nowhere else: the reference has no
        // always-on latency readout, only this opt-in corner.
        if (statsVisible()) drawStatsCounters(canvas, false);
        // Over every other layer but the wipe: the tutorial box is z-index
        // 9999, above the panels, the strip, the loadout bar and the death
        // card. Its one anchored step rings the crafting panel, which is the
        // only element in the reference that `.tutorial-highlight` can ever
        // find -- see the note in Tutorial::draw.
        tutorial_.draw(canvas, timeSeconds_,
                       menus_.open() == MenuId::Crafting
                           ? CraftingPanel::bounds(window_.width(), window_.height())
                           : Rect{});
    } else {
        drawTitleBackground(canvas, timeSeconds_);
        if (screen_ == Screen::Login) {
            drawLogin(canvas, timeSeconds_);
            // The strip paints OVER the form, after it, exactly as
            // canvasButtons.draw runs after authForm.render. Only the strip:
            // the browser hides the loadout bar for as long as the auth form
            // is up, and there is nothing logged in yet for a panel to show.
            menus_.renderStripOnly(canvas, window_, timeSeconds_);
        }
        else if (screen_ == Screen::Lobby) {
            drawLobby(canvas, timeSeconds_);
            // The same menus, on the title screen. The panels read the account
            // rather than the world, so there is nothing for them to miss here.
            menus_.render(canvas, window_, net_, sprites_, renderer_, timeSeconds_, dt);
            // Over the panels, as the reference's own always-on-top widget is.
            drawDailyStreak(canvas, timeSeconds_);
        }
        else drawConnectionState(canvas, timeSeconds_);
    }

    // After every panel and the chat have painted, so the runs a selection is
    // resolved against are this frame's, and over them, so the highlight is
    // not covered by what drew it.
    updateTextSelection(canvas);

    // Last of all, over every other layer: the wipe is what hides the seam
    // between two scenes, so nothing may paint on top of it.
    drawSceneWipe(canvas);
    // After every field has been hit-tested, which is the only point at which
    // the set is complete.
    publishKeyboardRegions();
    window_.present();
}

// ---------------------------------------------------------------------------
// Text entry, and what may take the keyboard
// ---------------------------------------------------------------------------

bool App::touchControlsVisible() const {
    // Playing only. There is nothing on the title screen, and nothing on the
    // death card, a thumb cannot already reach through the mirrored pointer --
    // and a stick over a dead flower steers nothing.
    if (screen_ != Screen::Playing) return false;
    // A panel standing over the controls takes the whole screen back: its own
    // buttons and its drag-and-drop are what the finger is there for, and a
    // stick underneath would swallow presses meant for it.
    if (menus_.anyOpen()) return false;
    // --mobile. A desktop window reports a mouse and would never show these,
    // which makes this the only way a scripted run can photograph them.
    if (config_.forceTouchControls) return true;
    // `touchSeen` is the honest half of the test and `coarsePointer` the
    // early one: a browser that calls itself a desktop until something is
    // actually touched -- which is every tablet in "request desktop site" --
    // answers the query with a mouse and the touch with a finger.
    return menus_.settings().touchControlsWanted(coarsePointer_ || window_.touchSeen());
}

void App::publishKeyboardRegions() {
    const std::vector<Rect>& boxes = ui::TextFieldRegions::instance().boxes();
    std::vector<WindowRect> regions;
    regions.reserve(boxes.size());
    for (const Rect& box : boxes) {
        regions.push_back(WindowRect{static_cast<float>(box.x), static_cast<float>(box.y),
                                     static_cast<float>(box.w), static_cast<float>(box.h)});
    }
    window_.setSoftKeyboardRegions(std::move(regions));
    // And take it away when nothing holds the caret any more. The page's own
    // handler only dismisses on a touch that lands outside every field, which
    // a line closed by Enter -- or by the panel it lived in shutting -- never
    // gets, and the keyboard would stay up over a game nobody is typing into.
    if (!keyboardCaptured()) window_.dismissSoftKeyboard();
}

bool App::keyboardCaptured() const {
    // The three things that can hold the caret, in the order updateLobby and
    // updatePlaying resolve them: a panel's field, the chat line, and the
    // lobby's name / auth fields.
    return menus_.wantsText() || chatOpen_ || nameField_.focused || focusedField_ >= 0;
}

void App::editText(std::string& target, std::size_t maxLength, ui::TextFieldState& state,
                   bool masked) {
    if (masked) state.selection.collapse(target.size());
    ui::TextEditOptions typing;
    typing.maxBytes = maxLength;
    typing.copyable = !masked;
    ui::editText(window_, target, state, timeSeconds_, typing);
    if (masked) state.selection.collapse(target.size());
}

void App::updateTextSelection(Canvas& canvas) {
    ui::TextSelect& selectable = ui::TextSelect::instance();
    const Vec2 mouse{window_.mouseX(), window_.mouseY()};

    // The menu owns the pointer while it is up, so a click on one of its rows
    // does not also start a drag through the text behind it.
    selectable.trackMouse(window_, contextMenu_.contains(mouse));
    selectable.paint(canvas);
    // The I-beam is the only sign that a label can be dragged across, and the
    // bands are tight around the glyphs, so it lands on text and nothing else.
    if (!contextMenu_.isOpen() && selectable.overText(mouse)) {
        window_.setCursorShape(CursorShape::Text);
    }

    const ui::FocusedField field = selectable.focusedField();
    const bool overField = field.valid() && field.box.w > 0 && field.box.contains(mouse);

    // Ctrl/Cmd+C over a page selection. A focused field has already had its
    // own go at the keystroke -- and now only takes it when IT has something
    // selected -- so this is what is left, and it is the only way to copy a
    // label or a chat line without going through the menu.
    if (window_.ctrlHeld() && window_.keyPressed(Key::C) && selectable.hasSelection() &&
        !(field.valid() && !field.state->selection.empty())) {
        const std::string text = selectable.selectedText();
        if (!text.empty()) window_.setClipboardText(text);
    }
    // Select All belongs to a focused field first -- editText has already
    // answered for that -- and to the page only when there is none.
    if (window_.ctrlHeld() && window_.keyPressed(Key::A) && !field.valid()) {
        selectable.selectAll();
    }

    if (window_.mousePressed(MouseButton::Right) && !contextMenu_.isOpen()) {
        // Only over something this client owns. Over the world the right
        // button is the defend control, and a card there would eat it.
        const bool overOwnUi = overField || menus_.capturesMouse(mouse) ||
                               selectable.overText(mouse) ||
                               (chatOpen_ && chatBox_.contains(mouse));
        if (overOwnUi) {
            const bool editable = field.valid();
            const bool fieldHasSelection = editable && !field.state->selection.empty();
            const bool canCopy = (fieldHasSelection && field.options.copyable) ||
                                 selectable.hasSelection();

            std::vector<ui::ContextMenu::Item> items;
            if (editable) {
                items.push_back({ui::ContextAction::Cut, "Cut",
                                 fieldHasSelection && field.options.copyable});
            }
            items.push_back({ui::ContextAction::Copy, "Copy", canCopy});
            if (editable) {
                items.push_back({ui::ContextAction::Paste, "Paste",
                                 !window_.clipboardText().empty()});
            }
            items.push_back({ui::ContextAction::SelectAll, "Select All", true});
            contextMenu_.open(mouse, std::move(items), window_.width(), window_.height());
        }
    }

    switch (contextMenu_.update(canvas, window_)) {
        case ui::ContextAction::Copy: {
            const std::string text =
                field.valid() && !field.state->selection.empty() && field.options.copyable
                    ? field.state->selection.of(*field.value)
                    : selectable.selectedText();
            if (!text.empty()) window_.setClipboardText(text);
            break;
        }
        case ui::ContextAction::Cut: {
            if (!field.valid() || !field.options.copyable) break;
            const std::string text = field.state->selection.of(*field.value);
            if (text.empty()) break;
            window_.setClipboardText(text);
            const std::size_t at = field.state->selection.begin();
            field.value->erase(at, field.state->selection.end() - at);
            field.state->selection.collapse(at);
            field.state->caretSeconds = timeSeconds_;
            break;
        }
        case ui::ContextAction::Paste: {
            // Whatever `clipboardText` can answer for. On the desktop that is
            // the system clipboard; in a browser it is the last thing pasted
            // INTO the page, because a page may not read the clipboard on a
            // click without a permission prompt -- see Window::pastedText.
            if (!field.valid()) break;
            ui::TextEditFrame paste;
            paste.pasted = window_.clipboardText();
            if (paste.pasted.empty()) break;
            ui::editText(paste, *field.value, field.state->selection, field.options);
            field.state->caretSeconds = timeSeconds_;
            break;
        }
        case ui::ContextAction::SelectAll:
            if (field.valid()) field.state->selection.selectAll(*field.value);
            else selectable.selectAll();
            break;
        case ui::ContextAction::None:
            break;
    }
}

// ---------------------------------------------------------------------------
// Coming back, and leaving
// ---------------------------------------------------------------------------

void App::onReconnected() {
    // Whatever this client was holding about the last session is about a
    // process that no longer exists. The death card especially: it is a card
    // about a body that is not coming back.
    deathCardVisible_ = false;
    loginMessage_.clear();
    screen_ = Screen::Login;

    // The account outlives the socket, so it is presented again rather than
    // asked for. A token the new server refuses lands on the login form, which
    // is the screen already showing.
    const std::string token =
        net_.sessionToken().empty() ? storedToken_ : net_.sessionToken();
    if (!token.empty()) {
        net_.resumeSession(token);
        net_.addSystemMessage("Reconnected to the server.");
    } else {
        net_.addSystemMessage("Reconnected to the server. Please log in again.");
    }
    storedToken_.clear();
}

void App::leaveToTitle() {
    net_.leaveGame();
    menus_.close();
    // Not finished, just gone: the browser destroys the Tutorial with the Game
    // that owns it, and an unfinished one comes back on the next join.
    tutorial_.endGame();
    beginSceneWipe(false);
    screen_ = Screen::Lobby;
}

void App::logout() {
    // Not leaveToTitle(): that lands on the lobby, which is the one screen a
    // logged-out client must not be on. The body itself is NetClient's to take
    // off the server -- it leaves the game before it sends the logout, because
    // the account a flower would be saved into goes away with the session.
    const bool inWorld = screen_ == Screen::Playing || screen_ == Screen::Dead;
    if (inWorld) tutorial_.endGame();
    net_.logout();
    menus_.close();

    // Forget the token on disk as well as in memory: a logout a restart undoes
    // is not a logout. The file is emptied rather than left alone because
    // saveSession() declines to write at all once there is nothing to save,
    // which would leave the old token sitting there. The name is not part of
    // the account, so it is written straight back if there is one.
    //
    // Emptied, not removed: an empty session file reads back as no session at
    // all, and on the browser build the file is the mount point for the
    // storage behind it -- deleting it would take the persistence with it.
    // See client/web/persist.cpp.
    storedToken_.clear();
    // A temporary, so the stream is closed again before saveSession() opens
    // the same path.
    std::ofstream(config_.sessionFile, std::ios::trunc);
    saveSession();

    // The form opens the way it does on a first run: blank, unfocused, and
    // with no message left over from the session that just ended.
    usernameField_.clear();
    passwordField_.clear();
    confirmPasswordField_.clear();
    loginMessage_.clear();
    focusedField_ = -1;
    registering_ = false;
    advancedOpen_ = false;
    pressedControl_.clear();
    pendingAuth_.clear();
    // Done, not Idle: a scripted run must not answer a deliberate logout by
    // registering itself straight back in.
    autoLogin_ = AutoLogin::Done;

    deathCardVisible_ = false;
    chatOpen_ = false;
    chatDraft_.clear();
    chatSuggestion_ = -1;
    chatField_.blur();
    nameField_.blur();

    // Only worth a wipe when there is a world to hide: lobby and login are the
    // same scene with a different card on it, and wiping between them would
    // read as a stutter rather than a transition.
    if (inWorld) beginSceneWipe(false);
    screen_ = Screen::Login;
}

// ---------------------------------------------------------------------------
// Scene wipe
// ---------------------------------------------------------------------------

void App::beginSceneWipe(bool toGame) {
    // Snapshot BEFORE the scene commits. Nothing has painted yet this frame, so
    // the window still holds the outgoing scene whole -- which is exactly the
    // still the wipe has to hold up while the incoming one builds itself.
    Canvas& canvas = window_.canvas();
    // PIXELS, not design units: this is a copy of the backing store, and
    // asking for a design-sized rectangle of it would photograph the top-left
    // corner of the screen and stretch that over the whole wipe. It is drawn
    // back at design size in drawSceneWipe, which is where the two spaces
    // meet. Copy canvas-to-canvas rather than reading its pixels through C++:
    // under Emscripten that stays entirely inside the browser's Canvas2D
    // backend instead of moving a full frame into and back out of Wasm.
    const int width = canvas.pixelWidth();
    const int height = canvas.pixelHeight();
    std::unique_ptr<Canvas> snapshot;
    if (width > 0 && height > 0) {
        snapshot = std::make_unique<Canvas>(Canvas::createVirtual(width, height));
        snapshot->drawCanvas(canvas, 0, 0, static_cast<float>(width),
                             static_cast<float>(height));
    }

    wipe_.snapshot = std::move(snapshot);
    wipe_.holeGrows = toGame;
    wipe_.phase = SceneWipe::Phase::Covered;
    wipe_.phaseStartSeconds = timeSeconds_;
}

bool App::wipeReadyToReveal() const {
    // Going back to the title there is nothing to wait for. Going into a game
    // the hold lasts until the player's own body has actually arrived, so the
    // reveal never opens on an empty world.
    if (!wipe_.holeGrows) return true;
    return (screen_ == Screen::Playing || screen_ == Screen::Dead) &&
           net_.view().self().netId != 0;
}

void App::drawSceneWipe(Canvas& canvas) {
    if (wipe_.phase == SceneWipe::Phase::Idle) return;
    // A scripted capture wants the finished scene, not the eight hundred
    // milliseconds of transition on the way into it. Skipped rather than
    // shortened, so a run that lands mid-wipe still photographs the screen the
    // flags asked for.
    if (config_.screenshotAfterFrames > 0) {
        wipe_.phase = SceneWipe::Phase::Idle;
        wipe_.snapshot.reset();
        return;
    }

    /// Long enough to read as a deliberate transition, short enough not to be
    /// in the way. The reference's IRIS_DURATION_MS.
    constexpr double kWipeSeconds = 0.8;
    /// A stall must not leave the screen covered forever, so the hold gives up.
    constexpr double kCoveredTimeoutSeconds = 8.0;

    const double elapsed = timeSeconds_ - wipe_.phaseStartSeconds;
    double progress = 0;
    if (wipe_.phase == SceneWipe::Phase::Covered) {
        if (wipeReadyToReveal() || elapsed > kCoveredTimeoutSeconds) {
            wipe_.phase = SceneWipe::Phase::Wiping;
            wipe_.phaseStartSeconds = timeSeconds_;
        }
    } else {
        progress = std::min(elapsed / kWipeSeconds, 1.0);
    }

    const double centreX = canvas.width() * 0.5;
    const double centreY = canvas.height() * 0.5;
    // The circle circumscribes the viewport, so a fully open hole clears the
    // corners rather than leaving four dark wedges.
    const double maxRadius = std::sqrt(centreX * centreX + centreY * centreY);
    const double inverse = 1.0 - progress;
    const double eased =
        wipe_.holeGrows ? 1.0 - inverse * inverse * inverse : inverse * inverse * inverse;
    const double radius = std::max(0.0, eased * maxRadius);

    canvas.save();
    canvas.beginPath();
    if (wipe_.holeGrows) {
        // Everything OUTSIDE the growing hole keeps the outgoing still. The
        // counter-clockwise arc punches the hole out of the rectangle by
        // winding against it.
        //
        // The angles run kTau -> 0, not 0 -> kTau. A reversed arc's sweep is
        // normalised with fmod unless it is already a whole turn NEGATIVE, so
        // asking for (0, +kTau) counter-clockwise degenerates to a zero-length
        // arc and the hole never appears.
        canvas.rect(0, 0, static_cast<float>(canvas.width()), static_cast<float>(canvas.height()));
        canvas.arc(static_cast<float>(centreX), static_cast<float>(centreY),
                   static_cast<float>(radius), static_cast<float>(kTau), 0.0f, true);
    } else {
        canvas.arc(static_cast<float>(centreX), static_cast<float>(centreY),
                   static_cast<float>(radius), 0, static_cast<float>(kTau));
    }
    canvas.clip();
    if (wipe_.snapshot) {
        canvas.drawCanvas(*wipe_.snapshot, 0, 0, static_cast<float>(canvas.width()),
                          static_cast<float>(canvas.height()));
    } else {
        // No still to hold up, so the wipe falls through black instead.
        setFill(canvas, kInk);
        canvas.fillRect(0, 0, static_cast<float>(canvas.width()),
                        static_cast<float>(canvas.height()));
    }
    canvas.restore();

    if (radius > 0) {
        canvas.save();
        setStroke(canvas, kInk);
        canvas.setLineWidth(6.0f);
        canvas.strokeCircle(static_cast<float>(centreX), static_cast<float>(centreY),
                            static_cast<float>(radius));
        canvas.restore();
    }

    if (wipe_.phase == SceneWipe::Phase::Wiping && progress >= 1.0) {
        wipe_.phase = SceneWipe::Phase::Idle;
        wipe_.snapshot.reset();
    }
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

void App::loadSession() {
    std::ifstream in(config_.sessionFile);
    if (!in) return;
    // Two lines: the session token, then the flower's name. Only a token is
    // ever stored -- never the password -- so a stolen or shared machine leaks
    // at most one revocable, expiring handle. A file written by an older build
    // has only the first line, which reads back as an empty name.
    std::getline(in, storedToken_);
    std::getline(in, playerName_);
}

void App::saveSession() const {
    if (net_.sessionToken().empty() && playerName_.empty()) return;
    std::ofstream out(config_.sessionFile, std::ios::trunc);
    if (out) out << net_.sessionToken() << "\n" << playerName_ << "\n";
}

std::string App::settingsPath() const {
    // Beside the session file, so one config directory holds both and a
    // portable install stays portable.
    return config_.sessionFile + "-settings";
}

// ---------------------------------------------------------------------------
// The stats readout
// ---------------------------------------------------------------------------

bool App::statsVisible() const {
    return config_.showStats || menus_.settings().showStats;
}

void App::drawStatsCounters(Canvas& canvas, bool titleScreen) {
    TextStyle style;
    style.size = 11.0;
    style.bold = true;
    style.align = Align::Right;
    style.baseline = Baseline::Bottom;
    style.strokeWidth = 2.0;

    struct Line { std::string text; std::uint32_t fill; };
    std::vector<Line> lines;

    if (titleScreen) {
        // The title screen's overlay is a set of PLACEHOLDERS, not a readout:
        // renderStatsCounters (src/title_screen/index.ts:1228-1232) spells four
        // of the five lines out as literals and fills in nothing but the frame
        // count. There is no world behind this screen to report on, and
        // substituting live-looking zeroes would claim there is.
        lines = {
            {"Pos: --, --", 0xFFD700u},
            {"Ping: -- | In: 0 B/s | Out: 0 B/s", 0xA78BFAu},
            {"Players: 0", 0x4ECDC4u},
            {"Mobs: 0", 0xFF6B6Bu},
            {"FPS: " + std::to_string(framesPerSecond_) + " | Memory: 0.00 MB", 0x00FF00u},
        };
    } else {
        int players = 0;
        int mobs = 0;
        for (const auto& entry : net_.view().entities()) {
            if (entry.second.kind == net::EntityKind::Player) ++players;
            else if (entry.second.kind == net::EntityKind::Mob) ++mobs;
        }

        // Bottom-up, in the reference's order, so the frame counter is near the
        // corner and the render breakdown is the top line.

        // Position is omitted, not zeroed, until the world has placed this
        // flower -- the reference pushes the line only when it can resolve its
        // own socket's entity.
        if (net_.view().self().netId != 0) {
            const Vec2 me = net_.view().selfDrawnPosition();
            lines.push_back({"Pos: " + std::to_string(static_cast<long>(std::lround(me.x))) +
                                 ", " + std::to_string(static_cast<long>(std::lround(me.y))),
                             0xFFD700u});
        }

        // Before the first Pong there is no round trip to report, and the
        // reference prints "--" rather than a confident 0ms.
        const double ping = net_.averagePingMillis();
        const std::string pingText =
            ping > 0 ? std::to_string(static_cast<int>(std::lround(ping))) + "ms" : "--";
        lines.push_back({"Ping: " + pingText + " (" + net_.connectionQuality() + ")" +
                             " | In: " + formatBytes(incomingBytesPerSecond_) + "/s" +
                             " | Out: " + formatBytes(outgoingBytesPerSecond_) + "/s",
                         0xA78BFAu});

        // The heaviest opcodes of the last second, incoming first by size.
        // The arrow is the direction, as in the reference.
        if (!topWireEvents_.empty()) {
            std::string top = "Top: ";
            for (std::size_t i = 0; i < topWireEvents_.size(); ++i) {
                const NetClient::WireEvent& event = topWireEvents_[i];
                if (i > 0) top += " | ";
                // The reference draws these as U+2190/U+2192. The two Ubuntu
                // faces this client pins have no glyph for either -- the
                // browser only gets them from a system fallback -- so they
                // would come out as .notdef boxes. These say the same thing in
                // characters the face actually has.
                top += event.incoming ? "< " : "> ";
                top += event.name;
                top += " " + formatBytes(event.bytes) + "/s";
            }
            lines.push_back({top, 0xA78BFAu});
        }

        lines.push_back({"Players: " + std::to_string(players), 0x4ECDC4u});
        lines.push_back({"Mobs: " + std::to_string(mobs), 0xFF6B6Bu});

        // The work cost of a frame, which is the number that says whether the
        // frame rate is a budget problem or just the 60Hz cap.
        const std::string frameText =
            frameTimeAvgMs_ > 0 ? twoDecimals(frameTimeAvgMs_) + "ms" : "--";
        // Memory is the browser's offscreen-canvas tally, and that renderer
        // keeps none -- getOffscreenCanvasMemoryMB returns a hard 0, so the
        // reference prints this exact literal too. It is not a stub here.
        lines.push_back({"FPS: " + std::to_string(framesPerSecond_) + " (" + frameText +
                             "/frame) | Memory: 0.00 MB",
                         0x00FF00u});

        const auto section = [](const SectionStats& stats) {
            return twoDecimals(stats.avgMillis) + "/" + oneDecimal(stats.peakMillis) + "ms";
        };
        lines.push_back({"Render avg/peak: items " + section(sectionItems_) + " (" +
                             std::to_string(sectionItemCount_) + ") | mobs " +
                             section(sectionMobs_) + " | proj " + section(sectionProjectiles_),
                         0xFACC15u});
    }

    double y = canvas.height() - 8.0;
    for (const Line& line : lines) {
        style.fill = line.fill;
        text(canvas, line.text, canvas.width() - 8.0, y, style);
        y -= 15.0;
    }
}

} // namespace flix
