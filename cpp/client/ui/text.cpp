#include "client/ui/text.h"

#include <memory>

namespace flr::ui {

namespace {

struct FontState {
    Font font;
    std::string path;
    bool ready = false;
};

FontState& state() {
    static FontState s;
    return s;
}

} // namespace

bool Fonts::init(std::string& errorOut) {
    FontState& s = state();
    if (s.ready) return true;

    // Ordered by how close each is to the game's look: a humanist sans with
    // generous counters, which stays legible at the small sizes the HUD uses.
    static const std::vector<std::string> kPreferred = {
        "Ubuntu-R", "Ubuntu", "DejaVuSans", "LiberationSans-Regular",
        "Arial", "Helvetica", "HelveticaNeue",
    };

    if (!Font::findSystemFont(kPreferred, s.path)) {
        errorOut = "no usable system font found";
        return false;
    }
    if (!s.font.loadFromFile(s.path)) {
        errorOut = "could not parse font: " + s.path;
        return false;
    }
    s.ready = true;
    return true;
}

bool Fonts::ready() { return state().ready; }
const Font& Fonts::face() { return state().font; }
const std::string& Fonts::path() { return state().path; }

void appendGlyphs(Path2D& path, const std::string& text, double x, double baselineY, double size) {
    if (!state().ready || text.empty()) return;
    state().font.appendText(path, text, static_cast<float>(x), static_cast<float>(baselineY),
                            static_cast<float>(size));
}

double measure(const std::string& text, double size) {
    if (!state().ready) return 0;
    return state().font.measure(text, static_cast<float>(size));
}

double ascent(double size) {
    return state().ready ? state().font.ascent(static_cast<float>(size)) : size * 0.8;
}

double descent(double size) {
    return state().ready ? state().font.descent(static_cast<float>(size)) : -size * 0.2;
}

double lineHeight(double size) {
    return state().ready ? state().font.lineHeight(static_cast<float>(size)) : size * 1.3;
}

} // namespace flr::ui
