#pragma once
// The client application: window, screens, input, and the frame loop.
//
// One state machine drives the whole client. Each screen owns its layout and
// its hit-testing; there is no retained widget tree, because at this size an
// immediate-mode pass is simpler to follow and impossible to leave stale.

#include <cstdint>
#include <string>
#include <vector>

#include "canvas.h"
#include "window.h"

#include "client/camera.h"
#include "client/net_client.h"
#include "client/prediction.h"
#include "client/render/sprites.h"
#include "client/render/world_renderer.h"
#include "shared/core/types.h"

namespace flr {

class ContentRegistry;

enum class Screen : std::uint8_t {
    Connecting,   ///< reaching the server and handshaking
    Login,        ///< username/password, or resuming a stored session
    Lobby,        ///< logged in: loadout, inventory, and the play button
    Playing,
    Dead,         ///< the death card, over a frozen world
    Disconnected,
};

struct AppConfig {
    std::string host = "127.0.0.1";
    std::uint16_t port = 4242;
    std::string dataDir = "data";
    /// Where the session token is remembered between runs, so a returning
    /// player is not asked to log in again. Only the token is stored -- never
    /// the password.
    std::string sessionFile = ".florr-session";
    int windowWidth = 1280;
    int windowHeight = 720;
    bool fullscreen = false;

    /// Render this many frames, write the last one to `screenshotPath`, and
    /// exit. For testing what the client actually draws without needing a
    /// display, a window server, or screen-recording permission.
    int screenshotAfterFrames = 0;
    std::string screenshotPath;
    /// Log in and join automatically, so a screenshot run reaches the game
    /// rather than sitting on the login form.
    std::string autoUsername;
    std::string autoPassword;
};

class App {
public:
    App();
    ~App();

    /// Loads content, opens the window, and connects. Returns false with
    /// `errorOut` set if any of those cannot be done.
    bool start(const AppConfig&, std::string& errorOut);

    /// Runs until the window closes.
    void run();

private:
    void frame(double dt);
    void pollNetwork();

    void updateConnecting();
    void updateLogin(double dt);
    void updateLobby(double dt);
    void updatePlaying(double dt);
    void updateDead(double dt);

    void drawLogin(Canvas&, double time);
    void drawLobby(Canvas&, double time);
    void drawHud(Canvas&, double time);
    void drawDeathCard(Canvas&, double time);
    void drawChat(Canvas&, double time);
    void drawNotices(Canvas&, double time);
    void drawConnectionState(Canvas&, double time);

    /// Builds this frame's input from the keyboard and mouse, applies it to the
    /// local prediction, and sends it.
    void sendInputFrame(double dt);

    /// Text entry shared by the login fields and the chat box.
    void editText(std::string& target, std::size_t maxLength);

    void loadSessionToken();
    void saveSessionToken() const;

    /// A token read from disk at startup. Held rather than sent immediately:
    /// the socket is not up yet at load time, and the server refuses anything
    /// before it has answered the handshake.
    std::string storedToken_;

    AppConfig config_;
    Window window_;
    NetClient net_;
    Camera camera_;
    Prediction prediction_;
    SpriteCache sprites_;
    WorldRenderer renderer_;

    Screen screen_ = Screen::Connecting;
    double timeSeconds_ = 0;

    // -- login form --------------------------------------------------------
    std::string usernameField_;
    std::string passwordField_;
    int focusedField_ = 0;        ///< 0 username, 1 password
    bool registering_ = false;
    std::string loginMessage_;

    /// Scripted-login progress. A screenshot or smoke run has no one to type,
    /// so it registers, and falls back to logging in when the name is taken.
    enum class AutoLogin : std::uint8_t { Idle, Registering, LoggingIn, Done, Failed };
    AutoLogin autoLogin_ = AutoLogin::Idle;

    // -- chat --------------------------------------------------------------
    bool chatOpen_ = false;
    std::string chatDraft_;

    // -- panels ------------------------------------------------------------
    bool inventoryOpen_ = false;
    /// The inventory stack the player picked up, while dragging it to a slot.
    int draggingStack_ = -1;

    // -- input -------------------------------------------------------------
    std::uint32_t inputSequence_ = 0;
    /// Accumulates real time so input is produced at the simulation rate rather
    /// than once per rendered frame -- a 144 Hz client must not send (and be
    /// simulated for) six times what a 25 Hz one does.
    double inputAccumulator_ = 0;

    bool running_ = false;
};

} // namespace flr
