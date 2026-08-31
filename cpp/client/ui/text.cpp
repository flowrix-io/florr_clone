#include "client/ui/text.h"

#include <memory>

namespace flr::ui {

namespace {

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
    return Fonts::face(bold).measure(text, static_cast<float>(size));
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

} // namespace flr::ui
