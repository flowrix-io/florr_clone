#pragma once
// Pictures fetched by URL: what a chat line's <img src="https://..."> shows.
//
// Only the browser build can show one. The page fetches and decodes it as an
// ordinary <img> and draws it straight onto the canvas (see
// canvasRequestRemoteImage), so the pixels never enter the wasm heap and no
// codec or TLS stack has to be linked for it. The native build has neither,
// and answers Unsupported -- the transcript prints a placeholder there.

#include <string>

#include "canvas.h"

namespace flix::ui {

#if defined(__EMSCRIPTEN__)
inline constexpr bool kRemoteImages = true;
#else
inline constexpr bool kRemoteImages = false;
#endif

struct RemoteImage {
    enum class State { Loading, Ready, Failed, Unsupported };
    State state = State::Unsupported;
    /// The natural size, once Ready.
    int width = 0;
    int height = 0;
};

/// Where `url` stands, starting its fetch the first time it is asked about.
/// Cheap to call every frame: a URL is fetched once and remembered.
RemoteImage remoteImage(const std::string& url);

/// Draws `url` into the box, if it has loaded. Nothing otherwise.
void drawRemoteImage(Canvas& canvas, const std::string& url, double x, double y, double w,
                     double h);

} // namespace flix::ui
