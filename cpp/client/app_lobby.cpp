// The title screen: where a logged-in player stands before there is a world.
//
// The scrolling backdrop and its drifting petals, the flower's name, the
// spawn picker's two rows, the Ready button and the daily-login card. The
// panels over it are the menu system's (client/ui/menus.h) and the chat line
// under it is app_chat.cpp's -- what is left here is the screen those are
// drawn on, plus the one decision it exists to take: where the next game
// starts.
//
// The picker is the part worth knowing about. Every staged map contributes
// the player spawn rectangles somebody drew on it; the default and the two
// realms with no map file of their own are synthesised at the front; and
// pickerTabs() files the result under one tab per biome -- so a build with
// one map shows the row the browser build has, and a build with seven still
// fits the frame.

#include "client/app.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <utility>

#include "client/app_internal.h"
#include "client/render/art_cache.h"
#include "client/ui/draw.h"
#include "client/ui/text_input.h"
#include "shared/game/constants.h"
#include "shared/game/tiled_map.h"

namespace flix {

using namespace flix::ui;

namespace {

/// The spawn picker's two rows. A row is sized so all of its buttons fit the
/// design width with a gap between them, shrinking from the natural width
/// when it has to and never growing past it.
constexpr double kPickerRowHeight = 32.0;
/// The picker's height when it is one row of tabs-as-buttons: the height
/// the original single biome row had.
constexpr double kPickerSingleRowHeight = 35.0;
constexpr double kPickerGap = 10.0;
/// A picker button's NATURAL width, and its widest: the browser build's biome
/// button, which is 90 by 35 however many biomes the row holds. The row only
/// ever shrinks from this. Letting a short row divide the frame between its
/// buttons instead made every one of them a 150-wide slab -- a picker that
/// looks like a different control depending on how many maps are staged, and
/// nothing like the row it replaced.
constexpr double kPickerNaturalWidth = 90.0;
/// The floor a crowded row shrinks to. Below it the labels stop fitting, so
/// the row is allowed to run off the frame instead -- which is what the
/// reference does, and better than an unreadable button.
constexpr double kPickerMinWidth = 70.0;
/// Breathing room the widest row keeps from the design frame's edges.
constexpr double kPickerMargin = 10.0;

/// The backdrop's petals are drawn at 0.5x to 2x of this.
constexpr double kTitlePetalPixels = 32.0;

/// The daily-login card's body; its border is the same colour at 0.7 value.
constexpr std::uint32_t kStreakPanel = 0x66FFFFu;
/// How long its star wobbles after a fresh claim.
constexpr double kStreakPulseSeconds = 3.0;

/// The title screen's own hit test, inclusive on all four edges. The browser
/// writes every one of these as `x >= left && x <= left + width` (index.ts:877,
/// 900, 915-916, 955-956), so its rightmost column and bottom row are live
/// where ui::hit -- half-open, because the world's collision code needs it that
/// way -- leaves them dead.
bool hitInclusive(Rect r, Vec2 p) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/// The name field's overflow rule: drop trailing characters until the string
/// plus an ellipsis fits, then append one. Measured in the same bold 18px face
/// the field draws in, because a narrower measure would cut too much.
std::string ellipsised(Canvas& canvas, std::string value, double maxWidth) {
    if (textWidth(canvas, value, 18.0, true) <= maxWidth) return value;
    while (!value.empty() && textWidth(canvas, value + "...", 18.0, true) > maxWidth) {
        // Whole UTF-8 sequences, so a cut never leaves a broken character.
        std::size_t at = value.size() - 1;
        while (at > 0 && (static_cast<unsigned char>(value[at]) & 0xC0) == 0x80) --at;
        value.erase(at);
    }
    return value + "...";
}

/// "17h 34m" / "4m 12s" / "9s", as the streak widget formats a countdown.
std::string formatDuration(std::int64_t millis) {
    if (millis <= 0) return "0s";
    const std::int64_t total = millis / 1000;
    const std::int64_t h = total / 3600;
    const std::int64_t m = (total % 3600) / 60;
    const std::int64_t sec = total % 60;
    if (h > 0) return std::to_string(h) + "h " + std::to_string(m) + "m";
    if (m > 0) return std::to_string(m) + "m " + std::to_string(sec) + "s";
    return std::to_string(sec) + "s";
}

/// A picker row's button width: the natural width, shrunk only as far as a
/// crowded row needs to fit `rowSpace`, and never below the floor that keeps
/// its labels readable. A row with room to spare gets buttons the size the
/// reference draws them, not the size of its share of the frame.
double pickerButtonWidth(std::size_t count, double rowSpace) {
    if (count == 0) return kPickerNaturalWidth;
    const double fitted = (rowSpace - kPickerMargin * 2.0 - (count - 1) * kPickerGap) /
                          static_cast<double>(count);
    return clamp(fitted, kPickerMinWidth, kPickerNaturalWidth);
}

/// One row of `count` buttons of `width` by `height`, centred on centreX at
/// `y`.
void layPickerRow(std::vector<Rect>& out, std::size_t count, double width, double centreX,
                  double y, double height = kPickerRowHeight) {
    if (count == 0) return;
    const double rowWidth = count * (width + kPickerGap) - kPickerGap;
    for (std::size_t i = 0; i < count; ++i) {
        out.push_back({centreX - rowWidth * 0.5 + i * (width + kPickerGap), y, width, height});
    }
}

/// "ant_hell" -> "Ant Hell": the tab label for a biome id, which is a file
/// stem rather than something anyone wrote to be read.
std::string titleCaseId(const std::string& id) {
    std::string out;
    out.reserve(id.size());
    bool wordStart = true;
    for (char c : id) {
        if (c == '_' || c == '-' || c == ' ') {
            out.push_back(' ');
            wordStart = true;
            continue;
        }
        out.push_back(wordStart ? static_cast<char>(std::toupper(static_cast<unsigned char>(c)))
                                : c);
        wordStart = false;
    }
    return out;
}

} // namespace

ui::TextFieldStyle App::nameFieldStyle() {
    // The lobby's own field, and NOT the auth form's: a near-opaque white plate
    // with a grey edge and a BLACK caret, which is a different control from the
    // game's green fields rather than a restyling of them.
    TextFieldStyle style;
    style.fill = kPaper;
    style.fillAlpha = 0.9;
    style.outline = 0xB4B4B4u;
    style.focusedOutline = 0xB4B4B4u;
    style.outlineAlpha = 0.8;
    style.outlineWidth = 4.0;
    style.focusedOutlineWidth = 4.0;
    style.radius = 3.0;
    style.textSize = 18.0;
    style.textStrokeWidth = 3.0;
    style.bold = true;
    style.caret = kInk;
    return style;
}

void App::updateLobby(double dt) {
    (void)dt;
    if (config_.autoJoin && !config_.autoUsername.empty() &&
        net_.status() != NetClient::Status::Playing) {
        startGame();
    }

    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    const LobbyLayout layout = lobbyLayout(window_.width(), window_.height());

    // Exactly one thing owns the keyboard at a time. A panel's own search box
    // outranks the chat line, which outranks the name field, which outranks
    // the menu hotkeys -- otherwise typing a name opens half the menus.
    if (menus_.wantsText()) {
        // A panel is taking the keystrokes; nothing here may also read them.
    } else if (chatOpen_) {
        editChatLine();
    } else if (nameField_.focused) {
        editText(playerName_, 20, nameField_);
        ui::trackTextMouse(window_, nameField_, nameBox_,
                           ui::textFieldRun(nameBox_, playerName_, nameFieldStyle()), playerName_,
                           timeSeconds_);
        // Enter starts the game only from here, which is the one place the
        // reference accepts it: with nothing focused, Enter opens chat.
        if (window_.keyPressed(Key::Enter)) {
            nameField_.blur();
            startGame();
        } else if (window_.keyPressed(Key::Escape)) {
            nameField_.blur();
        }
    } else if (!menus_.handleKeys(window_)) {
        if (window_.keyPressed(Key::Enter) || pressedChatBox()) chatOpen_ = true;
    }

    // A release anywhere ends the press, including one a panel swallowed --
    // otherwise a button stays lit after a click that went somewhere else.
    if (window_.mouseReleased(MouseButton::Left)) pressedControl_.clear();

    // A click that landed on a panel or on the icon strip was for the menus,
    // and must not also start a game behind them.
    if (!menus_.capturesMouse(mouse)) {
        if (window_.mousePressed(MouseButton::Left)) {
            pressedControl_.clear();
            if (hitInclusive(layout.ready, mouse)) pressedControl_ = "start";
            for (std::size_t i = 0; i < layout.tabs.size(); ++i) {
                if (hitInclusive(layout.tabs[i], mouse)) {
                    pressedControl_ = "tab_" + std::to_string(i);
                }
            }
            for (std::size_t i = 0; i < layout.doors.size(); ++i) {
                if (hitInclusive(layout.doors[i], mouse)) {
                    pressedControl_ = "door_" + std::to_string(i);
                }
            }
        }
        if (window_.mouseReleased(MouseButton::Left)) {
            // "default" is stored as no choice at all, so a player who never
            // touches the picker is not pinned to a door that may be edited
            // out of the map later.
            const auto choose = [&](std::size_t choice) {
                menus_.settings().spawnChoice =
                    spawnChoices_[choice].id == "default" ? std::string() : spawnChoices_[choice].id;
            };
            bool onPicker = false;
            const std::vector<PickerTab> tabs = pickerTabs();
            for (std::size_t i = 0; i < layout.tabs.size() && i < tabs.size(); ++i) {
                if (!hitInclusive(layout.tabs[i], mouse)) continue;
                onPicker = true;
                pickerTab_ = tabs[i].id;
                // A tab with one door IS that door -- Default, the arena, the
                // maze, a biome with a single entrance -- so one click picks
                // it rather than opening a row of one to click again.
                if (tabs[i].choices.size() == 1) choose(tabs[i].choices.front());
            }
            const PickerTab* open = nullptr;
            for (const PickerTab& tab : tabs) {
                if (tab.id == pickerTab_) open = &tab;
            }
            for (std::size_t i = 0; i < layout.doors.size(); ++i) {
                if (!hitInclusive(layout.doors[i], mouse)) continue;
                onPicker = true;
                if (open != nullptr && i < open->choices.size()) choose(open->choices[i]);
            }

            // Focus follows the click. Ready and the picker's two rows are the
            // things the reference lets you click WITHOUT losing the caret in
            // the name field; everything else blurs it.
            // Taking the name whole: a click into the box that was not already
            // focused selects it, so the first keystroke replaces the old name
            // rather than appending to it -- which is what a browser does and
            // what this box, capped at twenty characters, wants.
            if (hitInclusive(layout.name, mouse)) {
                if (!nameField_.focused) nameField_.focus(playerName_, timeSeconds_);
            } else if (!onPicker && !hitInclusive(layout.ready, mouse)) {
                nameField_.blur();
            }
            chatOpen_ = hit(titleChatBox(window_.width(), window_.height()), mouse);

            if (hitInclusive(layout.ready, mouse)) startGame();
        }
    }

    if (net_.status() == NetClient::Status::Playing) {
        net_.view().snapAll();
        // The join's spawn point: the first snapshot has not placed the body
        // yet, and the view's own self position is still zero.
        camera_.snapTo(net_.selfPlaced() ? net_.view().selfDrawnPosition() : net_.arrival());
        beginSceneWipe(true);
        // --dead is the only route a scripted run has to the death card: being
        // killed for real is not something `--frames` can arrange.
        screen_ = config_.autoDead ? Screen::Dead : Screen::Playing;
        deathCardVisible_ = true;
        // The browser starts the tutorial a second after the game's socket
        // authenticates, which is this moment: Game builds the Tutorial, and
        // reaching the world is what a Game exists for.
        //
        // A scripted login is not a player, and the card would cover a quarter
        // of every other capture -- which is precisely why the browser's own
        // harness writes `tutorial_completed` before those joins and clears it
        // for the one shot that wants the card. --tutorial is that shot.
        if (config_.autoTutorial || config_.autoUsername.empty()) {
            tutorial_.beginGame(menus_.settings(), timeSeconds_, config_.autoTutorial);
        }
    }
}

void App::startGame() {
    // A scripted --spawn overrides the picker for this join only. It is
    // deliberately NOT written back to the settings: the file is the player's,
    // and a screenshot run that left "maze" in it would send their next
    // ordinary game to the maze.
    const std::string& where =
        config_.autoSpawn.empty() ? menus_.settings().spawnChoice : config_.autoSpawn;
    net_.joinGame(window_.width(), window_.height(), where, playerName_);
}

// ---------------------------------------------------------------------------
// The backdrop
// ---------------------------------------------------------------------------

const SvgDocument* App::titleBackground(const std::string& backdrop) {
    // The ground artworks, by the name a spawn point's `backdrop` names them
    // with -- which defaults to the spawn point's own id, so a point called
    // `desert` gets the desert without saying anything. Anything unrecognised
    // tiles the garden's, which is what the browser build did too.
    static const std::unordered_map<std::string, std::string> kFiles = {
        {"default", "land.svg"},  {"land", "land.svg"},     {"garden", "land.svg"},
        {"desert", "desert.svg"},
        {"ocean", "ocean.svg"},   {"hel", "hel.svg"},       {"ant_hell", "ant_hell.svg"},
        {"sewers", "sewers.svg"}, {"jungle", "jungle.svg"}, {"computer", "computer.svg"},
        {"unknown", "unknown.svg"},
    };
    const auto entry = kFiles.find(backdrop);
    const std::string file = entry == kFiles.end() ? "land.svg" : entry->second;

    // Compiled on first use and kept: a player flicking along the picker would
    // otherwise re-parse an SVG per frame.
    auto cached = titleBackgrounds_.find(file);
    if (cached == titleBackgrounds_.end()) {
        auto document = std::make_shared<SvgDocument>(
            SvgDocument::fromFile(config_.dataDir + "/" + file));
        cached = titleBackgrounds_.emplace(file, std::move(document)).first;
    }
    // A missing or unparseable backdrop is optional art, never a failure: the
    // painted fallback below still reads as ground.
    return cached->second->empty() ? nullptr : cached->second.get();
}

void App::drawTitleBackground(Canvas& canvas, double time) {
    // The chosen door's own artwork, so the title screen shows the ground the
    // player is about to be dropped onto. A door that names no backdrop
    // shows its biome's, which is what the tab it sits under is called.
    std::string backdrop = "default";
    for (const SpawnChoice& choice : spawnChoices_) {
        if (choice.id != menus_.settings().spawnChoice) continue;
        if (!choice.backdrop.empty()) backdrop = choice.backdrop;
        else if (!choice.biome.empty()) backdrop = choice.biome;
        break;
    }
    const SvgDocument* texture = titleBackground(backdrop);

    // A fixed step per rendered frame rather than elapsed seconds: this is the
    // reference's own clock, and matching it is what keeps the two scrolling
    // at the same rate for the same number of frames.
    titleBackgroundTime_ += 16.0;

    if (texture) {
        // The camera runs a 2000px circle about the screen centre, so the
        // drift sweeps a full turn every five and a half minutes instead of
        // sliding down one diagonal forever. Speed is constant at r*omega.
        const double a = titleBackgroundTime_ * 0.00002;
        const double cameraX = canvas.width() * 0.5 + std::cos(a) * 2000.0;
        const double cameraY = canvas.height() * 0.5 + std::sin(a) * 2000.0;

        const double tileW = texture->width() > 0 ? texture->width() : 400.0;
        const double tileH = texture->height() > 0 ? texture->height() : 400.0;
        const double startX = std::floor(cameraX / tileW) * tileW;
        const double startY = std::floor(cameraY / tileH) * tileH;
        const int tilesX = static_cast<int>(std::ceil(canvas.width() / tileW)) + 2;
        const int tilesY = static_cast<int>(std::ceil(canvas.height() / tileH)) + 2;

        for (int i = 0; i <= tilesX; ++i) {
            for (int j = 0; j <= tilesY; ++j) {
                // Each tile is drawn two pixels oversized with the overlap
                // centred, and snapped to a whole pixel: a fractional origin
                // makes the seams crawl as the camera moves.
                const double x = std::floor(startX + i * tileW - cameraX - 1.0);
                const double y = std::floor(startY + j * tileH - cameraY - 1.0);
                // The counts above are the reference's, and they overshoot the
                // window by a tile in each direction; a tile that lands wholly
                // outside it is a whole SVG rasterized into nothing. On a
                // 1280x720 window that is twenty of the thirty-five.
                if (x + tileW + 2 <= 0 || y + tileH + 2 <= 0 ||
                    x >= canvas.width() || y >= canvas.height()) {
                    continue;
                }
                // Fifteen copies of one static picture a frame: on the web
                // that is a texture blit, everywhere else it is the artwork
                // (see art_cache.h for why those are not the same answer).
                if (!drawCachedArt(canvas, *texture, x, y, tileW + 2, tileH + 2)) {
                    texture->renderFitted(canvas, static_cast<float>(x), static_cast<float>(y),
                                          static_cast<float>(tileW + 2),
                                          static_cast<float>(tileH + 2),
                                          static_cast<float>(time));
                }
            }
        }
    } else {
        // No art: a flat field, which is what the reference falls back to. A
        // pattern here would be a second design nobody asked for.
        setFill(canvas, kBackdrop);
        canvas.fillRect(0, 0, static_cast<float>(canvas.width()),
                        static_cast<float>(canvas.height()));
    }

    drawTitlePetals(canvas, time);
}

void App::drawTitlePetals(Canvas& canvas, double time) {
    if (titlePetalTypes_.empty()) return;

    // A 2% chance per frame with no cap, which settles at about twenty petals
    // on a 1280-wide screen. The population is meant to build up, so a screen
    // opened a second ago is legitimately emptier than one left running.
    if (titleRng_.chance(0.02)) {
        TitlePetal petal;
        petal.x = -50.0;
        petal.y = titleRng_.unit() * canvas.height();
        petal.speedX = 0.5 + titleRng_.unit() * 2.0;
        petal.size = (0.5 + titleRng_.unit() * 1.5) * kTitlePetalPixels;
        petal.rotation = titleRng_.unit() * 360.0;
        petal.rotationSpeed = (titleRng_.unit() - 0.5) * 4.0;
        petal.petal = titlePetalTypes_[titleRng_.below(
            static_cast<std::uint32_t>(titlePetalTypes_.size()))];
        titlePetals_.push_back(petal);
    }

    // Purely horizontal: a petal's y is set once and never touched again, so
    // nothing bobs and nothing wraps. The only way off screen is the right.
    const double exit = canvas.width() + 50.0;
    for (TitlePetal& petal : titlePetals_) {
        petal.x += petal.speedX;
        petal.rotation += petal.rotationSpeed;
    }
    titlePetals_.erase(std::remove_if(titlePetals_.begin(), titlePetals_.end(),
                                      [exit](const TitlePetal& p) { return p.x > exit; }),
                       titlePetals_.end());

    // Animated petal art is baked at ~24fps in the reference, so quantise the
    // clock the SVG animations read rather than letting them run smooth.
    const double artTime = std::floor(time * 1000.0 / 42.0) * 0.042;
    // Oldest first: a new petal lands on top of the ones already flying.
    for (const TitlePetal& petal : titlePetals_) {
        sprites_.drawPetal(canvas, petal.petal, petal.x + petal.size * 0.5,
                           petal.y + petal.size * 0.5, petal.size,
                           petal.rotation * kPi / 180.0, artTime);
    }
}

// ---------------------------------------------------------------------------
// Layout and drawing
// ---------------------------------------------------------------------------

std::vector<App::PickerTab> App::pickerTabs() const {
    // Default first and the two generated realms last, with every biome the
    // doors are filed under between them in the order the doors were loaded
    // -- which is the order maps.json lists the maps, so the overworld's own
    // doors decide the row and a temporary map never reorders it.
    std::vector<PickerTab> tabs;
    tabs.push_back(PickerTab{"default", "Default", 0x00BE4Fu, {}});
    PickerTab arena{kArenaSpawnChoice, "PVP Arena", 0xDC3C3Cu, {}};
    PickerTab maze{kMazeSpawnChoice, "Maze", 0x573D80u, {}};
    for (std::size_t i = 0; i < spawnChoices_.size(); ++i) {
        const SpawnChoice& choice = spawnChoices_[i];
        if (choice.id == "default") {
            tabs.front().color = choice.color;
            tabs.front().choices.push_back(i);
            continue;
        }
        if (choice.id == kArenaSpawnChoice) {
            arena.color = choice.color;
            arena.choices.push_back(i);
            continue;
        }
        if (choice.id == kMazeSpawnChoice) {
            maze.color = choice.color;
            maze.choices.push_back(i);
            continue;
        }
        // A door with no biome at all files under its own id, so it is still
        // reachable rather than silently dropped from the picker.
        const std::string& biome = choice.biome.empty() ? choice.id : choice.biome;
        PickerTab* tab = nullptr;
        for (PickerTab& candidate : tabs) {
            if (candidate.id == biome) tab = &candidate;
        }
        if (tab == nullptr) {
            // The tab wears the colour of its first door, which for the
            // overworld's doors is the colour the biome always had.
            tabs.push_back(PickerTab{biome, titleCaseId(biome), choice.color, {}});
            tab = &tabs.back();
        }
        tab->choices.push_back(i);
    }
    tabs.push_back(std::move(arena));
    tabs.push_back(std::move(maze));
    return tabs;
}

std::string App::pickerTabOf(const std::string& choiceId) const {
    if (choiceId.empty()) return "default";
    for (const PickerTab& tab : pickerTabs()) {
        for (std::size_t i : tab.choices) {
            if (spawnChoices_[i].id == choiceId) return tab.id;
        }
    }
    return "default";
}

App::LobbyLayout App::lobbyLayout(int viewWidth, int viewHeight) const {
    // The browser title screen's rhythm, measured from the centre: the name
    // field and the Ready button side by side a hundred above it, the
    // "Spawn At:" label at fifty, then the picker's two rows -- the biome
    // tabs at twenty-two above and the selected biome's doors at fourteen
    // below -- both of which have to clear the loadout bar at fifty below.
    const double centreX = viewWidth * 0.5;
    const double centreY = viewHeight * 0.5;

    LobbyLayout layout;
    layout.name = {centreX - 200.0, centreY - 100.0, 280.0, 42.0};
    layout.ready = {centreX + 120.0, centreY - 100.0, 120.0, 42.0};

    // Each row is sized to fit the frame on its own, so neither wraps:
    // wrapping would put the picker on top of the loadout bar. The frame is
    // the design width, or less of it when the window's aspect shows less --
    // a 16:9 window scaled to the design HEIGHT shows about 1650 units.
    const double rowSpace = std::min(static_cast<double>(viewWidth),
                                     static_cast<double>(kDesignWidth));
    const std::vector<PickerTab> tabs = pickerTabs();
    // One row when every tab has at most one door -- the shipped case, where
    // a biome is entered from its main area alone and the sublevels hang off
    // pads. The tabs are then the buttons themselves, in the slot the
    // picker's original single row had (twenty above centre, thirty-five
    // tall), and there is no doors row to open. Two rows only when some tab
    // really has several doors to choose between.
    bool singleRow = true;
    for (const PickerTab& tab : tabs) singleRow &= tab.choices.size() <= 1;
    if (singleRow) {
        layPickerRow(layout.tabs, tabs.size(), pickerButtonWidth(tabs.size(), rowSpace), centreX,
                     centreY - 20.0, kPickerSingleRowHeight);
        return layout;
    }
    layPickerRow(layout.tabs, tabs.size(), pickerButtonWidth(tabs.size(), rowSpace), centreX,
                 centreY - 22.0);
    for (const PickerTab& tab : tabs) {
        if (tab.id != pickerTab_) continue;
        layPickerRow(layout.doors, tab.choices.size(),
                     pickerButtonWidth(tab.choices.size(), rowSpace), centreX, centreY + 14.0);
    }
    return layout;
}

void App::drawLobby(Canvas& canvas, double time) {
    const double centreX = canvas.width() * 0.5;
    const double centreY = canvas.height() * 0.5;
    const Vec2 mouse{window_.mouseX(), window_.mouseY()};
    // A panel under the pointer owns it: the reference stops updating the
    // title screen's hover as soon as one of its menus is open, so a button
    // does not light up through the card standing on it. A pointer that has
    // left the window owns nothing at all -- `mouseleave` drops the hovered
    // biome, the hovered Ready button and the latched press together.
    const bool freeMouse = pointerInWindow(window_) && !menus_.capturesMouse(mouse);

    TextStyle title;
    title.size = 48.0;
    title.align = Align::Centre;
    title.bold = true;
    title.strokeWidth = 6.0;
    text(canvas, "flowrix beta", centreX, centreY - 200.0, title);

    const LobbyLayout layout = lobbyLayout(canvas.width(), canvas.height());

    // Drawn by hand rather than through ui::textField: this one is a pale
    // plate with a grey edge and a BLACK caret, which is a different control
    // from the game's green fields and not a restyling of them.
    TextFieldStyle nameStyle = nameFieldStyle();
    nameStyle.fillAlpha = nameField_.focused ? 0.95 : 0.9;
    nameBox_ = layout.name;
    // The raw value while it is being edited, so the caret and the highlight
    // land on the glyphs actually drawn; the ellipsised form once the caret
    // has gone, which is what keeps a long name inside its plate.
    textField(canvas, layout.name,
              nameField_.focused ? playerName_ : ellipsised(canvas, playerName_, 260.0),
              "This flower is called...", nameField_.focused, false, time, nameStyle,
              &nameField_);

    ButtonStyle readyStyle;
    readyStyle.fill = 0x1DD129u;
    readyStyle.textSize = 18.0;
    button(canvas, layout.ready, "Ready", freeMouse && hitInclusive(layout.ready, mouse),
           freeMouse && pressedControl_ == "start", readyStyle);

    TextStyle label;
    label.size = 18.0;
    label.align = Align::Centre;
    label.bold = true;
    label.strokeWidth = 4.0;
    text(canvas, "Spawn At:", centreX, centreY - 50.0, label);

    // The picker: a row of biome tabs, and under it the doors of the open
    // tab. The chosen one in each row is drawn darker with a heavier
    // outline, rather than brighter: hover already means brighter, and two
    // states that both brighten are two states nobody can tell apart.
    const auto pickerButton = [&](const Rect& box, const std::string& text_,
                                  std::uint32_t colour, bool chosen, const std::string& id) {
        ButtonStyle style;
        style.fill = chosen ? hsvScale(colour, 0.85) : colour;
        style.outlineWidth = chosen ? 5.0 : 4.0;
        // A crowded row shrinks its type with its buttons, so "Ant Hell"
        // still fits inside one. A row at its natural width keeps the
        // reference's 14.
        style.textSize = box.w < kPickerNaturalWidth ? 12.0 : 14.0;
        button(canvas, box, text_, freeMouse && !chosen && hitInclusive(box, mouse),
               freeMouse && pressedControl_ == id, style);
    };
    const std::vector<PickerTab> tabs = pickerTabs();
    const PickerTab* open = nullptr;
    for (std::size_t i = 0; i < layout.tabs.size() && i < tabs.size(); ++i) {
        const bool chosen = tabs[i].id == pickerTab_;
        if (chosen) open = &tabs[i];
        pickerButton(layout.tabs[i], tabs[i].label, tabs[i].color, chosen,
                     "tab_" + std::to_string(i));
    }
    for (std::size_t i = 0; open != nullptr && i < layout.doors.size() &&
                            i < open->choices.size(); ++i) {
        const SpawnChoice& choice = spawnChoices_[open->choices[i]];
        const bool chosen = choice.id == menus_.settings().spawnChoice ||
                            (choice.id == "default" && menus_.settings().spawnChoice.empty());
        pickerButton(layout.doors[i], choice.label, choice.color, chosen,
                     "door_" + std::to_string(i));
    }

    TextStyle hint;
    hint.size = 14.0;
    hint.align = Align::Centre;
    hint.baseline = Baseline::Top;
    hint.bold = true;
    hint.strokeWidth = 3.0;
    const char* lines[] = {
        "Controls:",
        "Arrow keys to move",
        "Hold space to extend petals",
        "Press Z to open the inventory.",
        "Press U + number keys 1-9 to use items.",
        "Press number keys 1-9 to swap items with secondary loadout",
        "Press K to switch between mouse and keyboard controls",
        "Use Q and E to swap petals",
        "Use T to unequip the selected petal",
    };
    // The last two lines name the keys that arm and empty the trash slot,
    // which only the classic bar has. The modern one leaves Q/E/T unbound, so
    // it must not go on advertising them.
    const std::size_t shown =
        std::size(lines) - (menus_.settings().classicLoadoutBar ? 0u : 2u);
    // Below the loadout bar, which occupies centreY+50 to centreY+260 and
    // paints a different amount of that box depending on which shape it is in
    // -- the modern metrics hang the number captions under the second row,
    // where the classic ones keep them above the first.
    double y = centreY + titleHintsOffsetY(menus_.settings().classicLoadoutBar);
    for (std::size_t i = 0; i < shown; ++i) {
        text(canvas, lines[i], centreX, y, hint);
        y += 20.0;
    }

    drawTitleChat(canvas, time);
    if (statsVisible()) drawStatsCounters(canvas, true);
}

// ---------------------------------------------------------------------------
// The daily-login card
// ---------------------------------------------------------------------------

const SvgDocument* App::streakStar(std::uint32_t fill) {
    auto cached = streakStars_.find(fill);
    if (cached != streakStars_.end()) return cached->second->empty() ? nullptr : cached->second.get();

    // The game-icons.net 'stars' glyph, the same one the menu strip uses, but
    // stroked and tinted: the card's star has a thick black outline and a fill
    // that says whether today has been claimed, and renderFitted cannot
    // recolour a document after the fact.
    //
    // TWO paths, stroke-only then fill-only, because SVG paints fill under
    // stroke and the reference paints stroke under fill. One path would show
    // the whole 36-unit stroke instead of the outer half of it, and the star
    // would read as an outline with a small yellow centre.
    static const char* kStarPath =
        "M256 38.013c-22.458 0-66.472 110.3-84.64 123.502-18.17 13.2-136.674 20.975-143.614 "
        "42.334-6.94 21.358 84.362 97.303 91.302 118.662 6.94 21.36-22.286 136.465-4.116 149.665 "
        "18.17 13.2 118.61-50.164 141.068-50.164 22.458 0 122.9 63.365 141.068 50.164 18.17-13.2"
        "-11.056-128.306-4.116-149.665 6.94-21.36 98.242-97.304 91.302-118.663-6.94-21.36-125.444"
        "-29.134-143.613-42.335-18.168-13.2-62.182-123.502-84.64-123.502z";
    char colour[8];
    std::snprintf(colour, sizeof colour, "#%06x", fill & 0xFFFFFFu);
    const std::string svg =
        std::string("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\">"
                    "<path fill=\"none\" stroke=\"#000000\" stroke-width=\"36\" "
                    "stroke-linejoin=\"round\" d=\"") + kStarPath +
        "\"/><path stroke=\"none\" fill=\"" + colour + "\" d=\"" + kStarPath + "\"/></svg>";
    auto document = std::make_shared<SvgDocument>(SvgDocument::fromString(svg));
    cached = streakStars_.emplace(fill, std::move(document)).first;
    return cached->second->empty() ? nullptr : cached->second.get();
}

void App::drawDailyStreak(Canvas& canvas, double time) {
    const DailyStreak& streak = net_.dailyStreak();
    if (!streak.known) return;

    constexpr double kWidth = 220.0;
    constexpr double kHeight = 150.0;
    constexpr double kBorder = 4.0;
    const Rect card{canvas.width() - kWidth - 16.0, 16.0, kWidth, kHeight};

    // Border and body as two filled rounded rects rather than a stroke: that is
    // how the reference draws it, and a centred stroke would round differently.
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(card.x), static_cast<float>(card.y),
                     static_cast<float>(card.w), static_cast<float>(card.h), 3.0f);
    setFill(canvas, shade(kStreakPanel, 0.7));
    canvas.fill();
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(card.x + kBorder), static_cast<float>(card.y + kBorder),
                     static_cast<float>(card.w - kBorder * 2),
                     static_cast<float>(card.h - kBorder * 2), 1.0f);
    setFill(canvas, kStreakPanel);
    canvas.fill();

    // The streak runs 1..5 and then starts the cycle again; the star shows
    // where in that cycle today's reward sits, not the streak's raw length.
    const int cycleDay = streak.streak > 0 ? ((streak.streak - 1) % 5) + 1 : 0;
    const double starX = card.x + card.w * 0.5;
    const double starY = card.y + 40.0;
    const std::uint32_t fill =
        cycleDay > 0 ? (streak.newDay ? 0xFFF28Au : 0xFFE65Du) : 0x8A4858u;

    // A short wobble to celebrate a fresh claim, easing out as it runs down.
    // Keyed on when the card first had something to say rather than on
    // `newDay`, which stays true for the whole session and would otherwise
    // wobble forever.
    if (streakSeenAt_ < 0) streakSeenAt_ = time;
    const double pulseLeft = streak.newDay ? kStreakPulseSeconds - (time - streakSeenAt_) : 0.0;
    const double radius =
        pulseLeft > 0
            ? 22.0 * (1.0 + std::sin(time * 1000.0 / 140.0) * 0.08 *
                                (pulseLeft / kStreakPulseSeconds))
            : 22.0;
    if (const SvgDocument* star = streakStar(fill)) {
        star->renderFitted(canvas, static_cast<float>(starX - radius),
                           static_cast<float>(starY - radius),
                           static_cast<float>(radius * 2.0), static_cast<float>(radius * 2.0),
                           0.0f);
    }
    if (cycleDay > 0) {
        TextStyle number;
        number.size = 16.0;
        number.bold = true;
        number.align = Align::Centre;
        number.strokeWidth = 3.0;
        text(canvas, std::to_string(cycleDay), starX, starY + 1.0, number);
    }

    const std::int64_t now = wallClockMillis();
    const bool claimed = now < streak.nextClaimAtMillis;

    TextStyle status;
    status.size = 13.0;
    status.bold = true;
    status.align = Align::Centre;
    status.baseline = Baseline::Top;
    status.strokeWidth = 3.0;
    status.fill = claimed ? kPaper : kWarning;
    text(canvas,
         claimed ? ("Claimed · Day " + std::to_string(streak.streak)) : "Ready to claim!",
         card.x + card.w * 0.5, card.y + 74.0, status);

    TextStyle countdown;
    countdown.size = 11.0;
    countdown.align = Align::Left;
    countdown.baseline = Baseline::Top;
    countdown.strokeWidth = 2.5;
    text(canvas,
         claimed ? ("Next: " + formatDuration(streak.nextClaimAtMillis - now)) : "Next: now",
         card.x + 12.0, card.y + 100.0, countdown);
    text(canvas, "Resets: " + formatDuration(streak.streakExpiresAtMillis - now),
         card.x + 12.0, card.y + 120.0, countdown);
}

} // namespace flix
