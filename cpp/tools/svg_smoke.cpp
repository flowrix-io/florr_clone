// Renders every mob and petal SVG out of the game's own config files through
// cpp_canvas and writes the result as one contact sheet.
//
// The entire visual identity of the rewrite rests on one assumption: that the
// artwork in mobs.json / petals.json can be compiled to canvas draw calls
// rather than reimplemented. This proves it. Each sprite is fitted to its own
// cell through the document's viewBox, labelled with its id, and anything that
// is not drawable SVG is marked in place rather than left as a blank tile.

#include "canvas.h"
#include "svg.h"

#include "shared/core/json.h"

#include <chrono>
#include <cstdio>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace {

constexpr int kColumns = 12;
constexpr float kCell = 106.0f;      // cell pitch
constexpr float kTile = 88.0f;       // sprite box inside the cell
constexpr float kRow = 126.0f;       // cell pitch including the label
constexpr float kMargin = 16.0f;
constexpr float kHeader = 30.0f;

// Why a cell holds no artwork. Only Failed is a defect in the SVG compiler;
// the rest are properties of the source data and are expected.
enum class Kind { Drawn, Empty, Procedural, Raster, Failed };

struct Sprite {
    std::string id;
    SvgDocument doc;
    Kind kind = Kind::Drawn;
};

const char* marker(Kind kind) {
    switch (kind) {
        case Kind::Empty:      return "empty";
        case Kind::Procedural: return "$proc";
        case Kind::Raster:     return "raster";
        case Kind::Failed:     return "FAILED";
        default:               return "";
    }
}

int rowsFor(std::size_t count) { return static_cast<int>((count + kColumns - 1) / kColumns); }

bool mentionsRaster(const SvgDocument& doc) {
    for (const std::string& warning : doc.warnings())
        if (warning.find("<image>") != std::string::npos) return true;
    return false;
}

void load(const flr::Json& table, std::vector<Sprite>& out, std::map<std::string,int>& warnings) {
    for (const std::string& key : table.keys()) {
        std::string source = table[key]["image"].asString();
        std::size_t begin = source.find_first_not_of(" \t\r\n");
        if (begin == std::string::npos) { out.push_back({key, SvgDocument(), Kind::Empty}); continue; }

        // The configs also carry a non-SVG procedural form, "$sponge:a,b,id".
        // Handing that to the SVG parser would report a bogus failure.
        if (source[begin] == '$') { out.push_back({key, SvgDocument(), Kind::Procedural}); continue; }

        Sprite sprite{key, SvgDocument::fromString(source), Kind::Drawn};
        for (const std::string& warning : sprite.doc.warnings()) ++warnings[warning];
        if (mentionsRaster(sprite.doc)) sprite.kind = Kind::Raster;
        else if (sprite.doc.empty()) sprite.kind = Kind::Empty;
        out.push_back(std::move(sprite));
    }
}

void section(Canvas& canvas, const char* title, float y) {
    canvas.setFillStyle(Color{236, 240, 245});
    canvas.setFont("17px sans-serif");
    canvas.setTextAlign("left");
    canvas.setTextBaseline("middle");
    canvas.fillText(title, kMargin, y + kHeader/2);
}

void drawGrid(Canvas& canvas, std::vector<Sprite>& sprites, float top, float time) {
    for (std::size_t i = 0; i < sprites.size(); ++i) {
        const float x = kMargin + static_cast<float>(i % kColumns) * kCell;
        const float y = top + static_cast<float>(i / kColumns) * kRow;
        const float tileX = x + (kCell - kTile) / 2;
        Sprite& sprite = sprites[i];

        canvas.setFillStyle(Color{146, 153, 162});
        canvas.beginPath();
        canvas.roundRect(tileX, y, kTile, kTile, 6);
        canvas.fill();

        if (sprite.kind == Kind::Drawn && !sprite.doc.renderFitted(canvas, tileX, y, kTile, kTile, time))
            sprite.kind = Kind::Failed;

        if (sprite.kind != Kind::Drawn) {
            canvas.setFillStyle(sprite.kind == Kind::Failed ? Color{198, 72, 72} : Color{108, 115, 124});
            canvas.setFont("12px sans-serif");
            canvas.setTextAlign("center");
            canvas.setTextBaseline("middle");
            canvas.fillText(marker(sprite.kind), tileX + kTile/2, y + kTile/2, kTile - 8);
        }

        canvas.setFillStyle(Color{200, 207, 216});
        canvas.setFont("12px sans-serif");
        canvas.setTextAlign("center");
        canvas.setTextBaseline("top");
        canvas.fillText(sprite.id, x + kCell/2, y + kTile + 7, kCell - 4);
    }
}

int countOf(const std::vector<Sprite>& a, const std::vector<Sprite>& b, Kind kind) {
    int n = 0;
    for (const Sprite& s : a) n += s.kind == kind;
    for (const Sprite& s : b) n += s.kind == kind;
    return n;
}

} // namespace

int main(int argc, char** argv) {
    const std::string dataDir = argc > 1 ? argv[1] : "../src";
    const float time = argc > 2 ? std::strtof(argv[2], nullptr) : 0.0f;

    flr::Json mobs, petals;
    std::string error;
    if (!flr::Json::parseFile(dataDir + "/mobs.json", mobs, error)) {
        std::printf("cannot read mobs.json: %s\n", error.c_str());
        return 1;
    }
    if (!flr::Json::parseFile(dataDir + "/petals.json", petals, error)) {
        std::printf("cannot read petals.json: %s\n", error.c_str());
        return 1;
    }

    std::vector<Sprite> mobSprites, petalSprites;
    std::map<std::string,int> warnings;
    const auto compileStart = std::chrono::steady_clock::now();
    load(mobs, mobSprites, warnings);
    load(petals, petalSprites, warnings);
    const double compileMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - compileStart).count();

    const int mobRows = rowsFor(mobSprites.size()), petalRows = rowsFor(petalSprites.size());
    const int width = static_cast<int>(kMargin*2 + kColumns*kCell);
    const int height = static_cast<int>(kMargin*2 + kHeader*2 + (mobRows + petalRows)*kRow);

    Canvas canvas(width, height);
    canvas.clear(Color{44, 49, 57});

    const float mobsTop = kMargin + kHeader;
    const float petalsTop = mobsTop + mobRows*kRow + kHeader;
    section(canvas, "MOBS  (mobs.json)", kMargin);
    section(canvas, "PETALS  (petals.json)", mobsTop + mobRows*kRow);

    const auto renderStart = std::chrono::steady_clock::now();
    drawGrid(canvas, mobSprites, mobsTop, time);
    drawGrid(canvas, petalSprites, petalsTop, time);
    const double renderMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - renderStart).count();

    const std::size_t total = mobSprites.size() + petalSprites.size();
    const int drawn = countOf(mobSprites, petalSprites, Kind::Drawn);
    const int failed = countOf(mobSprites, petalSprites, Kind::Failed);
    std::printf("mobs %zu   petals %zu   compiled %.1f ms   one full frame %.1f ms\n",
                mobSprites.size(), petalSprites.size(), compileMs, renderMs);
    std::printf("drawn %d / %zu   (empty %d, procedural %d, raster %d, FAILED %d)\n",
                drawn, total, countOf(mobSprites, petalSprites, Kind::Empty),
                countOf(mobSprites, petalSprites, Kind::Procedural),
                countOf(mobSprites, petalSprites, Kind::Raster), failed);
    if (warnings.empty()) std::printf("no warnings\n");
    else {
        std::printf("warnings:\n");
        for (const auto& entry : warnings) std::printf("  %4d x  %s\n", entry.second, entry.first.c_str());
    }

    if (!canvas.savePPM("svg-smoke.ppm")) {
        std::printf("could not write svg-smoke.ppm\n");
        return 1;
    }
    std::printf("wrote svg-smoke.ppm (%dx%d)\n", width, height);
    return failed == 0 ? 0 : 2;
}
