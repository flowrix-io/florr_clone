#pragma once
// The shared, render-free model for user-created player skins.
//
// A skin is DATA, not code: a short list of drawing primitives that a client
// turns into plain canvas calls. Nothing here draws, so the server links the
// very same validator the client trusts -- and it must, because a published
// skin ends up on EVERY player's screen. Untrusted input goes through
// sanitizeSkin() before it is stored or broadcast: shape types are
// whitelisted, every number is clamped, and a colour is accepted only as
// #rrggbb. The renderer never treats a skin string as anything but a fill or
// stroke style.
//
// Ported from src/skin_format.ts, limits included -- the two builds share a
// database, so a payload one accepts and the other rejects would be a skin
// that renders on half the players.

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "shared/core/json.h"
#include "shared/net/bytebuffer.h"

namespace flix {

inline constexpr int kMaxSkinShapes = 24;
inline constexpr std::size_t kMaxSkinNameLen = 24;
inline constexpr int kMaxPolyPoints = 16;
/// Per author, not per server: the catalog is shared, so one player cannot
/// fill it.
inline constexpr int kMaxSkinsPerUser = 24;

/// Local-space bound. The flower body radius is ~25, so 64 leaves room for a
/// skin that overhangs it without letting one cover the screen.
inline constexpr double kSkinCoordLimit = 64.0;
inline constexpr double kSkinRadiusLimit = 64.0;
inline constexpr double kMaxSkinStrokeWidth = 14.0;

enum class SkinShapeType : std::uint8_t { Circle, Ellipse, Rect, Polygon, Line, Curve };

/// One drawing primitive, in player-local space.
///
/// Colours stay strings because "" -- no fill, no outline -- is a distinct and
/// meaningful value that no packed RGB can carry, and because the studio's
/// text editor round-trips them verbatim.
struct SkinShape {
    SkinShapeType t = SkinShapeType::Circle;
    double x = 0, y = 0;
    double r = 0, rx = 0, ry = 0;
    double x2 = 0, y2 = 0;
    double cx1 = 0, cy1 = 0, cx2 = 0, cy2 = 0;
    std::vector<double> points;   ///< polygon: flat [x0,y0,x1,y1,...]
    double rot = 0;               ///< degrees
    std::string fill;
    std::string stroke;
    double sw = 0;
};

/// A published skin. `id` and `createdAt` are the server's to assign; a client
/// that invents them gets them overwritten.
struct CustomSkin {
    std::string id;
    std::string name;
    std::string author;
    std::vector<SkinShape> shapes;
    /// Unix milliseconds. Double rather than int64 because it round-trips
    /// through the JSON database the browser build wrote.
    double createdAt = 0;
};

const char* skinShapeTypeName(SkinShapeType);
bool parseSkinShapeType(const std::string& word, SkinShapeType& out);

/// True for exactly "#rrggbb". Anything else -- a named colour, a gradient
/// spelling, a script fragment -- is not a colour as far as a skin is
/// concerned.
bool isSkinHexColor(const std::string&);

/// Collapses a name to a safe, length-limited display string. The reference's
/// filter is `/[^\w \-]/g`, and its `\w` is ASCII only, so a multi-byte letter
/// is dropped rather than kept.
std::string sanitizeSkinName(const std::string& raw);

/// Clamps one shape into range, or returns false when it is unusable. Only two
/// things are rejected outright: an unknown type, and a polygon with fewer
/// than three points. Everything else is brought into range.
bool sanitizeSkinShape(SkinShape in, SkinShape& out);

/// The outcome of validating an authored payload. `error` is the FIRST problem
/// and is player-facing text; the name and shapes are the sanitized ones,
/// valid only when it is empty.
struct SkinCheck {
    std::string error;
    std::string name;
    std::vector<SkinShape> shapes;

    bool ok() const { return error.empty(); }
};

SkinCheck sanitizeSkin(const std::string& name, const std::vector<SkinShape>& shapes);

// --- wire --------------------------------------------------------------
// Whole-struct, no deltas: a skin crosses the wire on publish and on login,
// never per frame, so there is nothing here worth compressing.

void writeSkinShape(ByteWriter&, const SkinShape&);
bool readSkinShape(ByteReader&, SkinShape& out);
void writeCustomSkin(ByteWriter&, const CustomSkin&);
bool readCustomSkin(ByteReader&, CustomSkin& out);

// --- JSON --------------------------------------------------------------
// The database's on-disk shape, which the browser build also reads and writes.
// Optional fields are omitted rather than written as zero, so a file this
// build saves still diffs cleanly against one the old server wrote.

Json skinToJson(const CustomSkin&);
CustomSkin skinFromJson(const Json&);

} // namespace flix
