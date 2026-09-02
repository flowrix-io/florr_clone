#include "window.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>

#ifndef __EMSCRIPTEN__
#include <SDL.h>
#endif

namespace {

#ifndef __EMSCRIPTEN__
Key fromScancode(SDL_Scancode code) {
  switch (code) {
    case SDL_SCANCODE_A: return Key::A; case SDL_SCANCODE_B: return Key::B;
    case SDL_SCANCODE_C: return Key::C; case SDL_SCANCODE_D: return Key::D;
    case SDL_SCANCODE_E: return Key::E; case SDL_SCANCODE_F: return Key::F;
    case SDL_SCANCODE_G: return Key::G; case SDL_SCANCODE_H: return Key::H;
    case SDL_SCANCODE_I: return Key::I; case SDL_SCANCODE_J: return Key::J;
    case SDL_SCANCODE_K: return Key::K; case SDL_SCANCODE_L: return Key::L;
    case SDL_SCANCODE_M: return Key::M; case SDL_SCANCODE_N: return Key::N;
    case SDL_SCANCODE_O: return Key::O; case SDL_SCANCODE_P: return Key::P;
    case SDL_SCANCODE_Q: return Key::Q; case SDL_SCANCODE_R: return Key::R;
    case SDL_SCANCODE_S: return Key::S; case SDL_SCANCODE_T: return Key::T;
    case SDL_SCANCODE_U: return Key::U; case SDL_SCANCODE_V: return Key::V;
    case SDL_SCANCODE_W: return Key::W; case SDL_SCANCODE_X: return Key::X;
    case SDL_SCANCODE_Y: return Key::Y; case SDL_SCANCODE_Z: return Key::Z;
    case SDL_SCANCODE_0: return Key::Num0; case SDL_SCANCODE_1: return Key::Num1;
    case SDL_SCANCODE_2: return Key::Num2; case SDL_SCANCODE_3: return Key::Num3;
    case SDL_SCANCODE_4: return Key::Num4; case SDL_SCANCODE_5: return Key::Num5;
    case SDL_SCANCODE_6: return Key::Num6; case SDL_SCANCODE_7: return Key::Num7;
    case SDL_SCANCODE_8: return Key::Num8; case SDL_SCANCODE_9: return Key::Num9;
    case SDL_SCANCODE_SPACE: return Key::Space;
    case SDL_SCANCODE_RETURN: case SDL_SCANCODE_KP_ENTER: return Key::Enter;
    case SDL_SCANCODE_ESCAPE: return Key::Escape;
    case SDL_SCANCODE_BACKSPACE: return Key::Backspace;
    case SDL_SCANCODE_TAB: return Key::Tab;
    case SDL_SCANCODE_DELETE: return Key::Delete;
    case SDL_SCANCODE_HOME: return Key::Home; case SDL_SCANCODE_END: return Key::End;
    case SDL_SCANCODE_LEFT: return Key::Left; case SDL_SCANCODE_RIGHT: return Key::Right;
    case SDL_SCANCODE_UP: return Key::Up; case SDL_SCANCODE_DOWN: return Key::Down;
    case SDL_SCANCODE_LSHIFT: return Key::LeftShift; case SDL_SCANCODE_RSHIFT: return Key::RightShift;
    case SDL_SCANCODE_LCTRL: return Key::LeftCtrl; case SDL_SCANCODE_RCTRL: return Key::RightCtrl;
    case SDL_SCANCODE_LALT: return Key::LeftAlt; case SDL_SCANCODE_RALT: return Key::RightAlt;
    case SDL_SCANCODE_MINUS: return Key::Minus; case SDL_SCANCODE_EQUALS: return Key::Equals;
    case SDL_SCANCODE_COMMA: return Key::Comma; case SDL_SCANCODE_PERIOD: return Key::Period;
    case SDL_SCANCODE_SLASH: return Key::Slash; case SDL_SCANCODE_BACKSLASH: return Key::Backslash;
    case SDL_SCANCODE_SEMICOLON: return Key::Semicolon; case SDL_SCANCODE_APOSTROPHE: return Key::Apostrophe;
    case SDL_SCANCODE_F1: return Key::F1; case SDL_SCANCODE_F2: return Key::F2;
    case SDL_SCANCODE_F3: return Key::F3; case SDL_SCANCODE_F4: return Key::F4;
    case SDL_SCANCODE_F5: return Key::F5; case SDL_SCANCODE_F6: return Key::F6;
    case SDL_SCANCODE_F7: return Key::F7; case SDL_SCANCODE_F8: return Key::F8;
    case SDL_SCANCODE_F9: return Key::F9; case SDL_SCANCODE_F10: return Key::F10;
    case SDL_SCANCODE_F11: return Key::F11; case SDL_SCANCODE_F12: return Key::F12;
    default: return Key::Unknown;
  }
}
#endif

constexpr std::size_t kKeyCount = static_cast<std::size_t>(Key::Count);
constexpr std::size_t kButtonCount = static_cast<std::size_t>(MouseButton::Count);
constexpr std::size_t kCursorCount = static_cast<std::size_t>(CursorShape::Count);

} // namespace

struct Window::Impl {
#ifndef __EMSCRIPTEN__
  SDL_Window* window = nullptr;
  SDL_Renderer* renderer = nullptr;
  SDL_Texture* texture = nullptr;
  std::vector<std::uint8_t> rgba;
  Uint64 startCounter = 0, lastFrameCounter = 0;
#endif
  std::unique_ptr<Canvas> canvas;
  // The window as the OS sees it, in points.
  int pointWidth = 0, pointHeight = 0;
  // The canvas's backing store, in pixels.
  int pixelWidth = 0, pixelHeight = 0;
  // The design space, in design units. Zero until setDesignSize().
  int designWidth = 0, designHeight = 0;
  // The reported size, in design units. Ceiled, never floored: a full-screen
  // fill written as fillRect(0, 0, width(), height()) has to cover the last
  // pixel column, and half a design unit of overdraw is cheaper than a seam.
  int viewWidth = 0, viewHeight = 0;
  double devicePixelRatio = 1.0;
  double renderScale = 1.0;
  // Points per design unit, and canvas pixels per design unit. `fit` is what
  // the mouse is divided by; `uiScale` is the caller's base transform.
  double fit = 1.0;
  double uiScale = 1.0;
  bool shouldClose = false;

  std::array<bool, kKeyCount> down{}, pressed{}, released{};
  std::array<bool, kButtonCount> mouseHeld{}, mouseDownEdge{}, mouseUpEdge{};
  float mouseX = 0, mouseY = 0, wheel = 0;
  std::string typed;
  bool shift = false, ctrl = false, alt = false;

#ifndef __EMSCRIPTEN__
  // Built on first use and kept: SDL_CreateSystemCursor allocates, and a
  // window that asks for a shape asks for it every frame.
  std::array<SDL_Cursor*, kCursorCount> cursors{};
#endif
  CursorShape cursorRequested = CursorShape::Arrow;
  // Count means "nothing has been pushed to the OS yet".
  CursorShape cursorApplied = CursorShape::Count;

#ifndef __EMSCRIPTEN__
  void applyCursor() {
    if (cursorRequested == cursorApplied) return;
    const auto slot = static_cast<std::size_t>(cursorRequested);
    if (slot >= kCursorCount) return;
    if (!cursors[slot]) {
      SDL_SystemCursor system = SDL_SYSTEM_CURSOR_ARROW;
      if (cursorRequested == CursorShape::Hand) system = SDL_SYSTEM_CURSOR_HAND;
      else if (cursorRequested == CursorShape::Text) system = SDL_SYSTEM_CURSOR_IBEAM;
      cursors[slot] = SDL_CreateSystemCursor(system);
      // A shape the platform will not make is not retried every frame; the
      // pointer keeps whatever it already had.
      if (!cursors[slot]) { cursorApplied = cursorRequested; return; }
    }
    SDL_SetCursor(cursors[slot]);
    cursorApplied = cursorRequested;
  }
#endif

#ifndef __EMSCRIPTEN__
  // Recomputes every derived size from the window's current point size, the
  // display's scale factor and the render-resolution setting, rebuilding the
  // canvas and the upload texture only when the pixel count actually changed.
  //
  // Called every pump rather than only on a resize event: dragging a window
  // between a Retina and a non-Retina monitor changes the drawable size
  // WITHOUT changing the window's point size, and SDL reports that as neither
  // a RESIZED nor a SIZE_CHANGED event on every platform. Two integer queries
  // a frame is a cheaper way to be right than a table of per-platform events.
  void refreshGeometry() {
    if (!window || !renderer) return;

    int points[2] = {0, 0};
    SDL_GetWindowSize(window, &points[0], &points[1]);
    int drawable[2] = {0, 0};
    SDL_GetRendererOutputSize(renderer, &drawable[0], &drawable[1]);
    if (points[0] <= 0 || points[1] <= 0 || drawable[0] <= 0 || drawable[1] <= 0) return;

    pointWidth = points[0];
    pointHeight = points[1];
    devicePixelRatio = static_cast<double>(drawable[0]) / points[0];

    const int wantPixelW = std::max(1, static_cast<int>(std::lround(drawable[0] * renderScale)));
    const int wantPixelH = std::max(1, static_cast<int>(std::lround(drawable[1] * renderScale)));
    if (wantPixelW != pixelWidth || wantPixelH != pixelHeight || !canvas) {
      pixelWidth = wantPixelW;
      pixelHeight = wantPixelH;
      // Canvas cannot be resized in place, so the backing surfaces are
      // rebuilt. This is why callers must not hold canvas() across pump().
      canvas = std::make_unique<Canvas>(pixelWidth, pixelHeight);
      rgba.assign(static_cast<std::size_t>(pixelWidth) * pixelHeight * 4, 0);
      if (texture) SDL_DestroyTexture(texture);
      texture = SDL_CreateTexture(renderer, SDL_PIXELFORMAT_ABGR8888,
                                  SDL_TEXTUREACCESS_STREAMING, pixelWidth, pixelHeight);
    }

    // The fit is measured in POINTS, not pixels: it decides how big the design
    // space looks to a person, and a Retina display does not make a window
    // physically smaller. Measuring it in pixels would halve the design space
    // on exactly the displays this exists to fix.
    //
    // MAX, not min. Both cover the window; the difference is what a window
    // that is not the design aspect ratio does with the leftover.
    //
    //   min covers by revealing extra on the long axis, and pays for it by
    //       letting the SHORT axis set the scale. A window dragged narrow
    //       then shrinks everything -- 400x1000 points comes out at 0.21x
    //       with 1920x4800 units of world on screen. That is a zoom control
    //       made out of the window's edge, and it hands whoever finds it a
    //       view four times the size of everyone else's.
    //   max covers by cropping the short axis, and lets the LONG axis set the
    //       scale. The viewport is then never larger than the design size on
    //       either axis -- exactly it at the design ratio, less on the odd
    //       one -- so no window shape reveals more world than any other, and
    //       none of them makes anything smaller.
    //
    // The cost is that a very lopsided window has very little room: at
    // 3000x300 the viewport is 1920x192 and the HUD is squeezed. That is the
    // right way to lose. Shrinking the world to make room would be the zoom
    // this exists to refuse.
    if (designWidth > 0 && designHeight > 0) {
      fit = std::max(static_cast<double>(pointWidth) / designWidth,
                     static_cast<double>(pointHeight) / designHeight);
      if (!(fit > 0)) fit = 1.0;
    } else {
      fit = 1.0;
    }
    uiScale = fit * devicePixelRatio * renderScale;
    if (!(uiScale > 0)) uiScale = 1.0;

    // Ceiled so a full-screen fill written as fillRect(0, 0, width(), height())
    // reaches the last pixel, and nudged first because it otherwise does not:
    // a window at exactly the design aspect ratio divides out to
    // 1920.0000000000002, and a bare ceil turns that into a 1921-unit viewport
    // that flickers back to 1920 at the next size. The nudge is thirteen
    // orders of magnitude below the coverage it gives up.
    constexpr double kSnap = 1e-6;
    viewWidth = std::max(1, static_cast<int>(std::ceil(pixelWidth / uiScale - kSnap)));
    viewHeight = std::max(1, static_cast<int>(std::ceil(pixelHeight / uiScale - kSnap)));
    canvas->setLogicalSize(viewWidth, viewHeight);
  }
#endif

  void clearEdges() {
    pressed.fill(false);
    released.fill(false);
    mouseDownEdge.fill(false);
    mouseUpEdge.fill(false);
    wheel = 0;
    typed.clear();
  }
};

Window::Window() : impl_(std::make_unique<Impl>()) {}
Window::~Window() { close(); }

bool Window::open(int width, int height, const std::string& title, std::string& errorOut) {
#ifdef __EMSCRIPTEN__
  (void)width; (void)height; (void)title;
  errorOut = "Window is a native-only facility";
  return false;
#else
  close();
  if (SDL_Init(SDL_INIT_VIDEO) != 0) { errorOut = SDL_GetError(); return false; }

  // ALLOW_HIGHDPI is what makes the drawable bigger than the window on a
  // Retina display. Without it the OS hands the renderer a 1x surface and
  // stretches it, so every pixel drawn is a blurry pair of pixels shown. With
  // it the caller has to deal in three sizes -- see the header -- which is
  // what uiScale() and the design space are for.
  impl_->window = SDL_CreateWindow(title.c_str(), SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
                                   width, height,
                                   SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE |
                                       SDL_WINDOW_ALLOW_HIGHDPI);
  if (!impl_->window) { errorOut = SDL_GetError(); SDL_Quit(); return false; }

  // The canvas is stretched to the drawable whenever renderScale() < 1, and
  // nearest -- SDL's default -- makes that stretch look like a mistake rather
  // than a setting. The browser build's equivalent is `image-rendering: auto`.
  SDL_SetHint(SDL_HINT_RENDER_SCALE_QUALITY, "linear");

  impl_->renderer = SDL_CreateRenderer(impl_->window, -1,
                                       SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);
  if (!impl_->renderer) {
    // Software is slow but correct; a missing GPU path must not be fatal.
    impl_->renderer = SDL_CreateRenderer(impl_->window, -1, SDL_RENDERER_SOFTWARE);
  }
  if (!impl_->renderer) {
    errorOut = SDL_GetError();
    SDL_DestroyWindow(impl_->window); impl_->window = nullptr; SDL_Quit();
    return false;
  }

  // Builds the canvas, the texture and every derived scale from what the OS
  // actually gave us, which on a HiDPI display is not what was asked for.
  impl_->refreshGeometry();
  if (!impl_->canvas || !impl_->texture) {
    errorOut = SDL_GetError();
    close();
    return false;
  }

  impl_->startCounter = SDL_GetPerformanceCounter();
  impl_->lastFrameCounter = impl_->startCounter;

  SDL_StartTextInput();
  open_ = true;
  return true;
#endif
}

void Window::close() {
#ifndef __EMSCRIPTEN__
  if (impl_->texture) { SDL_DestroyTexture(impl_->texture); impl_->texture = nullptr; }
  if (impl_->renderer) { SDL_DestroyRenderer(impl_->renderer); impl_->renderer = nullptr; }
  for (SDL_Cursor*& cursor : impl_->cursors) {
    if (cursor) { SDL_FreeCursor(cursor); cursor = nullptr; }
  }
  impl_->cursorRequested = CursorShape::Arrow;
  impl_->cursorApplied = CursorShape::Count;
  if (impl_->window) { SDL_DestroyWindow(impl_->window); impl_->window = nullptr; SDL_Quit(); }
#endif
  impl_->canvas.reset();
  open_ = false;
}

bool Window::pump() {
#ifdef __EMSCRIPTEN__
  return false;
#else
  if (!open_) return false;
  impl_->clearEdges();
  // Before the events are read, so this frame's mouse positions are converted
  // with the geometry this frame will be drawn with.
  impl_->refreshGeometry();

  SDL_Event event;
  while (SDL_PollEvent(&event)) {
    switch (event.type) {
      case SDL_QUIT:
        impl_->shouldClose = true;
        break;

      case SDL_KEYDOWN: {
        // repeat != 0 is the OS auto-repeating a held key: it must feed text
        // fields but must not read as a fresh press to game logic.
        const Key k = fromScancode(event.key.keysym.scancode);
        const std::size_t i = static_cast<std::size_t>(k);
        if (i < kKeyCount) {
          if (!event.key.repeat) impl_->pressed[i] = true;
          impl_->down[i] = true;
        }
        // The two erase keys are the ones a text field must see repeat on:
        // holding either has to keep deleting, as it does in the browser.
        if (event.key.repeat && (k == Key::Backspace || k == Key::Delete)) {
          impl_->pressed[i] = true;
        }
        break;
      }

      case SDL_KEYUP: {
        const std::size_t i = static_cast<std::size_t>(fromScancode(event.key.keysym.scancode));
        if (i < kKeyCount) { impl_->down[i] = false; impl_->released[i] = true; }
        break;
      }

      case SDL_TEXTINPUT:
        impl_->typed += event.text.text;
        break;

      case SDL_MOUSEMOTION: {
        // Event coordinates are in points. The caller draws and hit-tests in
        // design units, so points are all that has to be divided out -- the
        // device pixel ratio and the render scale are the base transform's
        // business, not the pointer's.
        const float toDesign = impl_->fit > 0 ? static_cast<float>(1.0 / impl_->fit) : 1.0f;
        impl_->mouseX = event.motion.x * toDesign;
        impl_->mouseY = event.motion.y * toDesign;
        break;
      }

      case SDL_MOUSEBUTTONDOWN:
      case SDL_MOUSEBUTTONUP: {
        std::size_t index = kButtonCount;
        if (event.button.button == SDL_BUTTON_LEFT) index = static_cast<std::size_t>(MouseButton::Left);
        else if (event.button.button == SDL_BUTTON_MIDDLE) index = static_cast<std::size_t>(MouseButton::Middle);
        else if (event.button.button == SDL_BUTTON_RIGHT) index = static_cast<std::size_t>(MouseButton::Right);
        if (index < kButtonCount) {
          const bool downNow = event.type == SDL_MOUSEBUTTONDOWN;
          impl_->mouseHeld[index] = downNow;
          (downNow ? impl_->mouseDownEdge : impl_->mouseUpEdge)[index] = true;
        }
        break;
      }

      case SDL_MOUSEWHEEL:
        impl_->wheel += event.wheel.preciseY != 0 ? event.wheel.preciseY
                                                  : static_cast<float>(event.wheel.y);
        break;

      default:
        break;
    }
  }

  const SDL_Keymod mods = SDL_GetModState();
  impl_->shift = (mods & KMOD_SHIFT) != 0;
  impl_->ctrl = (mods & (KMOD_CTRL | KMOD_GUI)) != 0;
  impl_->alt = (mods & KMOD_ALT) != 0;

  return !impl_->shouldClose;
#endif
}

Canvas& Window::canvas() { return *impl_->canvas; }
int Window::width() const { return impl_->viewWidth; }
int Window::height() const { return impl_->viewHeight; }
int Window::pixelWidth() const { return impl_->pixelWidth; }
int Window::pixelHeight() const { return impl_->pixelHeight; }
double Window::uiScale() const { return impl_->uiScale; }
double Window::devicePixelRatio() const { return impl_->devicePixelRatio; }
double Window::renderScale() const { return impl_->renderScale; }

void Window::setDesignSize(int width, int height) {
  impl_->designWidth = std::max(0, width);
  impl_->designHeight = std::max(0, height);
#ifndef __EMSCRIPTEN__
  impl_->refreshGeometry();
#endif
}

void Window::setRenderScale(double scale) {
  // Clamped rather than rejected: this comes straight off a settings slider,
  // and a canvas of zero pixels is not a preference anyone can hold.
  const double clamped = std::min(1.0, std::max(0.25, scale));
  if (clamped == impl_->renderScale) return;
  impl_->renderScale = clamped;
#ifndef __EMSCRIPTEN__
  impl_->refreshGeometry();
#endif
}

void Window::present() {
#ifndef __EMSCRIPTEN__
  if (!open_) return;
  // Here rather than in setCursorShape: the shape is asserted by whatever is
  // under the pointer during the frame, and only the last word of the frame
  // should reach the OS.
  impl_->applyCursor();
  if (!impl_->canvas || !impl_->texture) return;

  // getImageData is the Canvas API's only pixel accessor, and it already
  // composites onto opaque; taking the whole surface once per frame is one
  // copy, which the upload would cost anyway. It is handed straight to
  // SDL_UpdateTexture -- copying it into impl_->rgba first was a second pass
  // over three and a half megabytes for nothing. The member buffer stays as
  // the fallback for a size the canvas could not satisfy.
  const std::vector<std::uint8_t> pixels =
      impl_->canvas->getImageData(0, 0, impl_->pixelWidth, impl_->pixelHeight);
  const std::uint8_t* upload = impl_->rgba.data();
  if (pixels.size() == impl_->rgba.size()) upload = pixels.data();

  SDL_UpdateTexture(impl_->texture, nullptr, upload, impl_->pixelWidth * 4);
  SDL_RenderClear(impl_->renderer);
  SDL_RenderCopy(impl_->renderer, impl_->texture, nullptr, nullptr);
  SDL_RenderPresent(impl_->renderer);
#endif
}

double Window::frameDelay(double targetFps) {
#ifdef __EMSCRIPTEN__
  (void)targetFps;
  return 1.0 / 60.0;
#else
  const Uint64 frequency = SDL_GetPerformanceFrequency();
  const Uint64 now = SDL_GetPerformanceCounter();
  const double elapsed = static_cast<double>(now - impl_->lastFrameCounter) / frequency;

  if (targetFps > 0) {
    const double target = 1.0 / targetFps;
    if (elapsed < target) {
      const double remaining = target - elapsed;
      // Sleep the bulk and spin the last millisecond: SDL_Delay's resolution
      // is coarse enough that sleeping the whole remainder overshoots and
      // makes the frame rate visibly uneven.
      if (remaining > 0.002) SDL_Delay(static_cast<Uint32>((remaining - 0.001) * 1000.0));
      while (static_cast<double>(SDL_GetPerformanceCounter() - impl_->lastFrameCounter) / frequency < target) {}
    }
  }

  const Uint64 frameEnd = SDL_GetPerformanceCounter();
  const double dt = static_cast<double>(frameEnd - impl_->lastFrameCounter) / frequency;
  impl_->lastFrameCounter = frameEnd;
  // Clamp: a breakpoint or a paused window otherwise returns a dt of minutes,
  // which teleports everything the caller integrates.
  return std::min(dt, 0.25);
#endif
}

double Window::timeSeconds() const {
#ifdef __EMSCRIPTEN__
  return 0;
#else
  return static_cast<double>(SDL_GetPerformanceCounter() - impl_->startCounter) /
         SDL_GetPerformanceFrequency();
#endif
}

bool Window::keyDown(Key k) const {
  const std::size_t i = static_cast<std::size_t>(k);
  return i < kKeyCount && impl_->down[i];
}
bool Window::keyPressed(Key k) const {
  const std::size_t i = static_cast<std::size_t>(k);
  return i < kKeyCount && impl_->pressed[i];
}
bool Window::keyReleased(Key k) const {
  const std::size_t i = static_cast<std::size_t>(k);
  return i < kKeyCount && impl_->released[i];
}
bool Window::mouseDown(MouseButton b) const {
  const std::size_t i = static_cast<std::size_t>(b);
  return i < kButtonCount && impl_->mouseHeld[i];
}
bool Window::mousePressed(MouseButton b) const {
  const std::size_t i = static_cast<std::size_t>(b);
  return i < kButtonCount && impl_->mouseDownEdge[i];
}
bool Window::mouseReleased(MouseButton b) const {
  const std::size_t i = static_cast<std::size_t>(b);
  return i < kButtonCount && impl_->mouseUpEdge[i];
}
float Window::mouseX() const { return impl_->mouseX; }
float Window::mouseY() const { return impl_->mouseY; }
float Window::wheelDelta() const { return impl_->wheel; }
const std::string& Window::typedText() const { return impl_->typed; }
bool Window::shiftHeld() const { return impl_->shift; }
bool Window::ctrlHeld() const { return impl_->ctrl; }
bool Window::altHeld() const { return impl_->alt; }

std::string Window::clipboardText() const {
#ifdef __EMSCRIPTEN__
  return {};
#else
  if (!SDL_HasClipboardText()) return {};
  // SDL hands over a buffer it allocated; it is the caller's to free, and
  // leaking one per paste would be a slow leak in a long session.
  char* text = SDL_GetClipboardText();
  if (!text) return {};
  std::string out(text);
  SDL_free(text);
  return out;
#endif
}

void Window::setClipboardText(const std::string& text) {
#ifndef __EMSCRIPTEN__
  SDL_SetClipboardText(text.c_str());
#else
  (void)text;
#endif
}

void Window::setCursorVisible(bool visible) {
#ifndef __EMSCRIPTEN__
  SDL_ShowCursor(visible ? SDL_ENABLE : SDL_DISABLE);
#endif
}

void Window::setCursorShape(CursorShape shape) {
  if (shape < CursorShape::Count) impl_->cursorRequested = shape;
}
