#include "client/ui/text.h"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

#include "client/ui/face_metrics.h"
#include "font.h"

#if defined(__EMSCRIPTEN__)
#include <cstdio>
#include <emscripten.h>
#else
#include <fstream>
#include <iterator>
#endif

namespace flix::ui {

namespace {

#if defined(__EMSCRIPTEN__)
// The advance the browser gives `text` in `font` -- fallback faces included,
// which is the point. A scratch context of its own, so measuring never
// touches the state of one being drawn on.
EM_JS(double, text_browser_width, (const char* font, const char* text), {
  let x = Module.textBrowserMeasure;
  if (!x) {
    const surface = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    x = Module.textBrowserMeasure = surface.getContext('2d');
  }
  x.font = UTF8ToString(font);
  return x.measureText(UTF8ToString(text)).width;
});

double browserTextWidth(const std::string& text, double size) {
    // The same shorthand text_atlas.cpp draws with (its fontSpec), or the
    // width would be of a different face from the one on screen.
    char font[64];
    std::snprintf(font, sizeof font, "bold %.3fpx Ubuntu, sans-serif", size);
    return text_browser_width(font, text.c_str());
}
#endif

/// What a run measured some way other than from the table is remembered by.
///
/// The table (face_metrics.h) measures a run in one read per character, faster
/// than this map can find it. What it cannot measure is a character the face
/// lacks, which the browser draws in a fallback face of its own and only the
/// browser can measure -- a round trip into JavaScript -- and, natively, a
/// whole run in a system font the client fell back to, which Font measures
/// from the file. Those are remembered.
///
/// The size is part of the key rather than being divided out. The advance sum
/// IS independent of it, so one entry per string would do -- but recovering a
/// size from a width measured at another one re-associates the arithmetic, and
/// a text run that lands a hundredth of a pixel from where it used to is a
/// text run that rasterises differently. Keyed this way the cached value is
/// bit-for-bit the one the measurement produced.
struct MeasureKey {
    std::string text;
    float size = 0;
    bool operator==(const MeasureKey& other) const {
        return size == other.size && text == other.text;
    }
};
struct MeasureHash {
    std::size_t operator()(const MeasureKey& key) const {
        std::size_t h = std::hash<std::string>{}(key.text);
        h ^= std::hash<float>{}(key.size) + 0x9e3779b9u + (h << 6) + (h >> 2);
        return h;
    }
};

template <typename Measure>
double remembered(const std::string& text, double size, const Measure& measureRun) {
    // Bounded, and dropped whole when it fills rather than evicted one at a
    // time: what grows this without limit is chat, where every line is a new
    // string.
    static constexpr std::size_t kMaxEntries = 4096;
    static std::unordered_map<MeasureKey, double, MeasureHash> cache;

    MeasureKey key{text, static_cast<float>(size)};
    const auto found = cache.find(key);
    if (found != cache.end()) return found->second;
    const double width = measureRun();
    if (cache.size() >= kMaxEntries) cache.clear();
    cache.emplace(std::move(key), width);
    return width;
}

struct FontState {
#if !defined(__EMSCRIPTEN__)
    Font face;
    // Whether `face` is the very file face_metrics was made from, so that the
    // table measures it. False for a system font the client fell back to.
    bool tabulated = false;
#endif
    std::string dataDir;
    bool ready = false;
};

FontState& state() {
    static FontState s;
    return s;
}

#if !defined(__EMSCRIPTEN__)
bool readFile(const std::string& path, std::vector<std::uint8_t>& out) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return false;
    out.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    return !out.empty();
}
#endif

} // namespace

bool Fonts::init(const std::string& dataDir, std::string& errorOut) {
    FontState& s = state();
    if (s.ready) return true;
    s.dataDir = dataDir;

#if !defined(__EMSCRIPTEN__)
    // The outlines are what this build draws with, so the face is loaded
    // whatever else is true. Its metrics come from the compiled-in table when
    // the file is the one the table was made from -- which the staged face
    // always is -- and from the file otherwise.
    std::vector<std::uint8_t> bytes;
    const std::string staged = dataDir + "/Ubuntu-Bold.ttf";
    if (readFile(staged, bytes)) {
        s.tabulated = face_metrics::describes(bytes.data(), bytes.size());
        if (!s.face.loadFromMemory(std::move(bytes))) s.tabulated = false;
    }
    if (!s.face.valid()) {
        // A bold system face first; a regular one only so that a machine with
        // no bold sans at all still gets a usable client.
        static const std::vector<std::string> kFallback = {
            "Ubuntu-B", "Ubuntu-Bold", "Arial Bold", "DejaVuSans-Bold",
            "LiberationSans-Bold", "Arial", "Helvetica", "DejaVuSans",
        };
        std::string path;
        if (!Font::findSystemFont(kFallback, path) || !s.face.loadFromFile(path)) {
            errorOut = "could not load Ubuntu Bold or a usable fallback";
            return false;
        }
    }
#else
    // The page's own text engine draws every run, in the Ubuntu the page
    // loads, and the face's metrics are compiled in: there is nothing to load.
#endif
    s.ready = true;
    return true;
}

bool Fonts::ready() { return state().ready; }
const std::string& Fonts::dataDirectory() { return state().dataDir; }

#if !defined(__EMSCRIPTEN__)
void appendGlyphs(Path2D& path, const std::string& text, double x, double baselineY,
                  double size) {
    if (!state().ready || text.empty()) return;
    state().face.appendText(path, text, static_cast<float>(x), static_cast<float>(baselineY),
                            static_cast<float>(size));
}
#endif

double measure(const std::string& text, double size) {
    FontState& s = state();
    if (!s.ready) return 0;
#if defined(__EMSCRIPTEN__)
    bool covered = true;
    const double width = face_metrics::measure(text, static_cast<float>(size), &covered);
    if (covered) return width;
    // The browser draws a character Ubuntu lacks -- an arrow, a card suit, an
    // emoji -- in whatever fallback face it has, at that face's width. Laid
    // out at .notdef's width instead, a run of them overprints its
    // neighbours, so a run that needs a fallback is measured by the browser
    // that will draw it. Ordinary text never takes this path.
    return remembered(text, size, [&] { return browserTextWidth(text, size); });
#else
    if (s.tabulated) return face_metrics::measure(text, static_cast<float>(size));
    return remembered(text, size, [&] { return s.face.measure(text, static_cast<float>(size)); });
#endif
}

double ascent(double size) {
    FontState& s = state();
    if (!s.ready) return size * 0.8;
#if !defined(__EMSCRIPTEN__)
    if (!s.tabulated) return s.face.ascent(static_cast<float>(size));
#endif
    return face_metrics::ascent(static_cast<float>(size));
}

double descent(double size) {
    FontState& s = state();
    if (!s.ready) return -size * 0.2;
#if !defined(__EMSCRIPTEN__)
    if (!s.tabulated) return s.face.descent(static_cast<float>(size));
#endif
    return face_metrics::descent(static_cast<float>(size));
}

} // namespace flix::ui
