#include "client/ui/text.h"

#include <cstddef>
#include <functional>
#include <memory>
#include <string>
#include <unordered_map>

namespace flix::ui {

namespace {

/// What a measured run is remembered by.
///
/// Measuring is not cheap: Font::measure decodes the string, and every
/// character costs a walk of the cmap's segments plus an hmtx read. The game
/// measures every label it aligns, and it aligns them all again next frame
/// from the same few dozen strings -- mob names, rarities, counts. A profile
/// of a busy scene put 4% of the frame in here.
///
/// The size is part of the key rather than being divided out. The advance sum
/// IS independent of it, so one entry per string would do -- but recovering a
/// size from a width measured at another one re-associates the arithmetic, and
/// a text run that lands a hundredth of a pixel from where it used to is a
/// text run that rasterises differently. Keyed this way the cached value is
/// bit-for-bit the one the walk produced.
struct MeasureKey {
    std::string text;
    float size = 0;
    bool bold = false;
    bool operator==(const MeasureKey& other) const {
        return bold == other.bold && size == other.size && text == other.text;
    }
};
struct MeasureHash {
    std::size_t operator()(const MeasureKey& key) const {
        std::size_t h = std::hash<std::string>{}(key.text);
        h ^= std::hash<float>{}(key.size) + 0x9e3779b9u + (h << 6) + (h >> 2);
        return key.bold ? h ^ 0x5bf03635u : h;
    }
};

struct FontState {
    Font regular;
    Font bold;
    std::string regularPath;
    std::string boldPath;
    bool ready = false;
};

FontState& state() {
    static FontState s;
    return s;
}

} // namespace

bool Fonts::init(const std::string& dataDir, std::string& errorOut) {
    FontState& s = state();
    if (s.ready) return true;

    const auto loadBundled = [&](Font& font, std::string& path, const char* filename) {
        path = dataDir + "/" + filename;
        return font.loadFromFile(path);
    };

    if (!loadBundled(s.regular, s.regularPath, "Ubuntu-Regular.ttf")) {
        static const std::vector<std::string> kRegularFallback = {
            "Ubuntu-R", "Ubuntu-Regular", "Arial", "Helvetica",
            "DejaVuSans", "LiberationSans-Regular",
        };
        if (!Font::findSystemFont(kRegularFallback, s.regularPath) ||
            !s.regular.loadFromFile(s.regularPath)) {
            errorOut = "could not load Ubuntu Regular or a usable fallback";
            return false;
        }
    }

    if (!loadBundled(s.bold, s.boldPath, "Ubuntu-Bold.ttf")) {
        static const std::vector<std::string> kBoldFallback = {
            "Ubuntu-B", "Ubuntu-Bold", "Arial Bold", "DejaVuSans-Bold",
            "LiberationSans-Bold",
        };
        if (!Font::findSystemFont(kBoldFallback, s.boldPath) ||
            !s.bold.loadFromFile(s.boldPath)) {
            // A missing bold face must not make the client unusable. Load the
            // regular file into the second face; text remains correctly sized.
            s.boldPath = s.regularPath;
            if (!s.bold.loadFromFile(s.boldPath)) {
                errorOut = "could not load a usable bold font";
                return false;
            }
        }
    }
    s.ready = true;
    return true;
}

bool Fonts::ready() { return state().ready; }
const Font& Fonts::face(bool bold) { return bold ? state().bold : state().regular; }
const std::string& Fonts::path() { return state().regularPath; }

void appendGlyphs(Path2D& path, const std::string& text, double x, double baselineY,
                  double size, bool bold) {
    if (!state().ready || text.empty()) return;
    Fonts::face(bold).appendText(path, text, static_cast<float>(x),
                                 static_cast<float>(baselineY), static_cast<float>(size));
}

double measure(const std::string& text, double size, bool bold) {
    if (!state().ready) return 0;
    // Bounded, and dropped whole when it fills rather than evicted one at a
    // time: what grows this without limit is chat, where every line is a new
    // string, and the labels that repeat every frame are cheap to measure
    // again on the frame after a clear.
    static constexpr std::size_t kMaxEntries = 4096;
    static std::unordered_map<MeasureKey, double, MeasureHash> cache;

    MeasureKey key{text, static_cast<float>(size), bold};
    const auto found = cache.find(key);
    if (found != cache.end()) return found->second;

    const double width = Fonts::face(bold).measure(text, static_cast<float>(size));
    if (cache.size() >= kMaxEntries) cache.clear();
    cache.emplace(std::move(key), width);
    return width;
}

double ascent(double size, bool bold) {
    return state().ready ? Fonts::face(bold).ascent(static_cast<float>(size)) : size * 0.8;
}

double descent(double size, bool bold) {
    return state().ready ? Fonts::face(bold).descent(static_cast<float>(size)) : -size * 0.2;
}

double lineHeight(double size, bool bold) {
    return state().ready ? Fonts::face(bold).lineHeight(static_cast<float>(size)) : size * 1.3;
}

} // namespace flix::ui
