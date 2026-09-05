#include "shared/game/skin_format.h"

#include <algorithm>
#include <cmath>

#include "shared/core/types.h"

namespace flix {

namespace {

/// A number that is not finite is not a number the clamp can rescue -- NaN
/// compares false against both bounds and would slip through. Mirrors the
/// reference's clampNum, whose `isFinite` guard does the same job.
double clampNum(double v, double lo, double hi, double fallback) {
    if (!std::isfinite(v)) return fallback;
    return clamp(v, lo, hi);
}

std::string sanitizeColor(const std::string& raw) {
    if (!isSkinHexColor(raw)) return {};
    std::string out = raw;
    for (char& c : out) {
        if (c >= 'A' && c <= 'F') c = static_cast<char>(c - 'A' + 'a');
    }
    return out;
}

} // namespace

const char* skinShapeTypeName(SkinShapeType t) {
    switch (t) {
        case SkinShapeType::Circle: return "circle";
        case SkinShapeType::Ellipse: return "ellipse";
        case SkinShapeType::Rect: return "rect";
        case SkinShapeType::Polygon: return "polygon";
        case SkinShapeType::Line: return "line";
        case SkinShapeType::Curve: return "curve";
    }
    return "circle";
}

bool parseSkinShapeType(const std::string& word, SkinShapeType& out) {
    if (word == "circle") { out = SkinShapeType::Circle; return true; }
    if (word == "ellipse") { out = SkinShapeType::Ellipse; return true; }
    if (word == "rect") { out = SkinShapeType::Rect; return true; }
    if (word == "polygon") { out = SkinShapeType::Polygon; return true; }
    if (word == "line") { out = SkinShapeType::Line; return true; }
    if (word == "curve") { out = SkinShapeType::Curve; return true; }
    return false;
}

bool isSkinHexColor(const std::string& s) {
    if (s.size() != 7 || s[0] != '#') return false;
    for (std::size_t i = 1; i < 7; ++i) {
        const char c = s[i];
        const bool digit = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
        if (!digit) return false;
    }
    return true;
}

std::string sanitizeSkinName(const std::string& raw) {
    std::string kept;
    for (const char c : raw) {
        const auto u = static_cast<unsigned char>(c);
        const bool word = (u >= '0' && u <= '9') || (u >= 'A' && u <= 'Z') ||
                          (u >= 'a' && u <= 'z') || u == '_';
        if (word || c == ' ' || c == '-') kept += c;
    }
    // `.replace(/\s+/g, ' ').trim()`: runs collapse to one space, and a run at
    // either end disappears -- which is why the space is emitted lazily,
    // before the next kept character rather than after the last one.
    std::string collapsed;
    bool space = false;
    for (const char c : kept) {
        if (c == ' ') {
            space = true;
            continue;
        }
        if (space && !collapsed.empty()) collapsed += ' ';
        space = false;
        collapsed += c;
    }
    if (collapsed.size() > kMaxSkinNameLen) collapsed.resize(kMaxSkinNameLen);
    return collapsed;
}

bool sanitizeSkinShape(SkinShape s, SkinShape& out) {
    s.x = clampNum(s.x, -kSkinCoordLimit, kSkinCoordLimit, 0.0);
    s.y = clampNum(s.y, -kSkinCoordLimit, kSkinCoordLimit, 0.0);
    s.rot = clampNum(s.rot, -360.0, 360.0, 0.0);
    s.fill = sanitizeColor(s.fill);
    s.stroke = sanitizeColor(s.stroke);
    s.sw = clampNum(s.sw, 0.0, kMaxSkinStrokeWidth, 1.0);
    switch (s.t) {
        case SkinShapeType::Circle:
            s.r = clampNum(s.r, 0.5, kSkinRadiusLimit, 8.0);
            break;
        case SkinShapeType::Ellipse:
        case SkinShapeType::Rect:
            s.rx = clampNum(s.rx, 0.5, kSkinRadiusLimit, 8.0);
            s.ry = clampNum(s.ry, 0.5, kSkinRadiusLimit, 8.0);
            break;
        case SkinShapeType::Line:
            s.x2 = clampNum(s.x2, -kSkinCoordLimit, kSkinCoordLimit, 0.0);
            s.y2 = clampNum(s.y2, -kSkinCoordLimit, kSkinCoordLimit, 0.0);
            if (s.stroke.empty()) s.stroke = "#000000";
            if (s.sw == 0) s.sw = 2;
            break;
        case SkinShapeType::Curve:
            s.x2 = clampNum(s.x2, -kSkinCoordLimit, kSkinCoordLimit, 0.0);
            s.y2 = clampNum(s.y2, -kSkinCoordLimit, kSkinCoordLimit, 0.0);
            s.cx1 = clampNum(s.cx1, -kSkinCoordLimit, kSkinCoordLimit, s.x);
            s.cy1 = clampNum(s.cy1, -kSkinCoordLimit, kSkinCoordLimit, s.y);
            s.cx2 = clampNum(s.cx2, -kSkinCoordLimit, kSkinCoordLimit, s.x2);
            s.cy2 = clampNum(s.cy2, -kSkinCoordLimit, kSkinCoordLimit, s.y2);
            // An unfilled curve is a stroked arc; only default the outline
            // when there is no fill either, so a filled blob stays outline-free.
            if (s.stroke.empty() && s.fill.empty()) {
                s.stroke = "#000000";
                if (s.sw == 0) s.sw = 2;
            }
            break;
        case SkinShapeType::Polygon: {
            std::vector<double> pts;
            for (std::size_t i = 0; i + 1 < s.points.size() &&
                                    pts.size() < static_cast<std::size_t>(kMaxPolyPoints) * 2;
                 i += 2) {
                pts.push_back(clampNum(s.points[i], -kSkinCoordLimit, kSkinCoordLimit, 0.0));
                pts.push_back(clampNum(s.points[i + 1], -kSkinCoordLimit, kSkinCoordLimit, 0.0));
            }
            if (pts.size() < 6) return false;   // fewer than three points
            s.points = std::move(pts);
            break;
        }
    }
    // Neither fill nor outline would draw nothing at all; give it a fill.
    if (s.fill.empty() && s.stroke.empty()) s.fill = "#000000";
    out = std::move(s);
    return true;
}

SkinCheck sanitizeSkin(const std::string& name, const std::vector<SkinShape>& shapes) {
    SkinCheck check;
    check.name = sanitizeSkinName(name);
    if (check.name.empty()) {
        check.error = "Skin needs a name.";
        return check;
    }
    if (shapes.empty()) {
        check.error = "Skin needs at least one shape.";
        return check;
    }
    const std::size_t limit = std::min(shapes.size(), static_cast<std::size_t>(kMaxSkinShapes));
    for (std::size_t i = 0; i < limit; ++i) {
        SkinShape kept;
        if (sanitizeSkinShape(shapes[i], kept)) check.shapes.push_back(std::move(kept));
    }
    if (check.shapes.empty()) {
        check.error = "No valid shapes in skin.";
        check.name.clear();
    }
    return check;
}

// --- wire ------------------------------------------------------------------

void writeSkinShape(ByteWriter& w, const SkinShape& s) {
    w.u8(static_cast<std::uint8_t>(s.t));
    w.f32(static_cast<float>(s.x));
    w.f32(static_cast<float>(s.y));
    w.f32(static_cast<float>(s.r));
    w.f32(static_cast<float>(s.rx));
    w.f32(static_cast<float>(s.ry));
    w.f32(static_cast<float>(s.x2));
    w.f32(static_cast<float>(s.y2));
    w.f32(static_cast<float>(s.cx1));
    w.f32(static_cast<float>(s.cy1));
    w.f32(static_cast<float>(s.cx2));
    w.f32(static_cast<float>(s.cy2));
    w.f32(static_cast<float>(s.rot));
    w.f32(static_cast<float>(s.sw));
    w.str(s.fill);
    w.str(s.stroke);
    w.u8(static_cast<std::uint8_t>(s.points.size() / 2));
    for (const double v : s.points) w.f32(static_cast<float>(v));
}

bool readSkinShape(ByteReader& r, SkinShape& out) {
    const std::uint8_t type = r.u8();
    // Read the whole record before judging the type: a frame carrying a shape
    // this build does not know must still leave the cursor on the next one.
    SkinShape s;
    s.x = r.f32();
    s.y = r.f32();
    s.r = r.f32();
    s.rx = r.f32();
    s.ry = r.f32();
    s.x2 = r.f32();
    s.y2 = r.f32();
    s.cx1 = r.f32();
    s.cy1 = r.f32();
    s.cx2 = r.f32();
    s.cy2 = r.f32();
    s.rot = r.f32();
    s.sw = r.f32();
    s.fill = r.str();
    s.stroke = r.str();
    const std::uint8_t pointPairs = r.u8();
    s.points.reserve(static_cast<std::size_t>(pointPairs) * 2);
    for (int i = 0; i < pointPairs * 2; ++i) s.points.push_back(r.f32());
    if (!r.ok() || type > static_cast<std::uint8_t>(SkinShapeType::Curve)) return false;
    s.t = static_cast<SkinShapeType>(type);
    out = std::move(s);
    return true;
}

void writeCustomSkin(ByteWriter& w, const CustomSkin& skin) {
    w.str(skin.id);
    w.str(skin.name);
    w.str(skin.author);
    w.f64(skin.createdAt);
    const std::size_t count = std::min(skin.shapes.size(), static_cast<std::size_t>(kMaxSkinShapes));
    w.u8(static_cast<std::uint8_t>(count));
    for (std::size_t i = 0; i < count; ++i) writeSkinShape(w, skin.shapes[i]);
}

bool readCustomSkin(ByteReader& r, CustomSkin& out) {
    CustomSkin skin;
    skin.id = r.str();
    skin.name = r.str();
    skin.author = r.str();
    skin.createdAt = r.f64();
    const std::uint8_t count = r.u8();
    skin.shapes.reserve(count);
    for (int i = 0; i < count; ++i) {
        SkinShape shape;
        // A shape that fails to decode is dropped, not fatal: the rest of the
        // catalog is still worth having, and the reader has stayed in step.
        if (readSkinShape(r, shape)) skin.shapes.push_back(std::move(shape));
    }
    if (!r.ok() || skin.id.empty()) return false;
    out = std::move(skin);
    return true;
}

// --- JSON ------------------------------------------------------------------

namespace {

/// Writes a number only when it carries information. The browser build omits
/// undefined fields, and a save that spelled every one of them out as 0 would
/// rewrite every skin in the file on first contact.
void putIf(Json& out, const char* key, double value, bool present) {
    if (present) out[key] = value;
}

} // namespace

Json skinToJson(const CustomSkin& skin) {
    Json out = Json::object();
    out["id"] = skin.id;
    out["name"] = skin.name;
    out["author"] = skin.author;
    Json shapes = Json::array();
    for (const SkinShape& s : skin.shapes) {
        Json j = Json::object();
        j["t"] = skinShapeTypeName(s.t);
        j["x"] = s.x;
        j["y"] = s.y;
        const bool circle = s.t == SkinShapeType::Circle;
        const bool boxed = s.t == SkinShapeType::Ellipse || s.t == SkinShapeType::Rect;
        const bool segment = s.t == SkinShapeType::Line || s.t == SkinShapeType::Curve;
        putIf(j, "r", s.r, circle);
        putIf(j, "rx", s.rx, boxed);
        putIf(j, "ry", s.ry, boxed);
        putIf(j, "x2", s.x2, segment);
        putIf(j, "y2", s.y2, segment);
        putIf(j, "cx1", s.cx1, s.t == SkinShapeType::Curve);
        putIf(j, "cy1", s.cy1, s.t == SkinShapeType::Curve);
        putIf(j, "cx2", s.cx2, s.t == SkinShapeType::Curve);
        putIf(j, "cy2", s.cy2, s.t == SkinShapeType::Curve);
        if (s.t == SkinShapeType::Polygon) {
            Json points = Json::array();
            for (const double v : s.points) points.push(Json(v));
            j["points"] = std::move(points);
        }
        j["rot"] = s.rot;
        j["fill"] = s.fill;
        j["stroke"] = s.stroke;
        j["sw"] = s.sw;
        shapes.push(std::move(j));
    }
    out["shapes"] = std::move(shapes);
    out["createdAt"] = skin.createdAt;
    return out;
}

CustomSkin skinFromJson(const Json& value) {
    CustomSkin skin;
    if (!value.isObject()) return skin;
    skin.id = value["id"].asString();
    skin.name = value["name"].asString();
    skin.author = value["author"].asString();
    skin.createdAt = value["createdAt"].asDouble(0.0);

    const Json& shapes = value["shapes"];
    if (!shapes.isArray()) return skin;
    for (const Json& j : shapes.items()) {
        if (!j.isObject()) continue;
        SkinShape s;
        if (!parseSkinShapeType(j["t"].asString(), s.t)) continue;
        s.x = j["x"].asDouble(0.0);
        s.y = j["y"].asDouble(0.0);
        s.r = j["r"].asDouble(0.0);
        s.rx = j["rx"].asDouble(0.0);
        s.ry = j["ry"].asDouble(0.0);
        s.x2 = j["x2"].asDouble(0.0);
        s.y2 = j["y2"].asDouble(0.0);
        s.cx1 = j["cx1"].asDouble(0.0);
        s.cy1 = j["cy1"].asDouble(0.0);
        s.cx2 = j["cx2"].asDouble(0.0);
        s.cy2 = j["cy2"].asDouble(0.0);
        s.rot = j["rot"].asDouble(0.0);
        s.fill = j["fill"].asString();
        s.stroke = j["stroke"].asString();
        s.sw = j["sw"].asDouble(0.0);
        const Json& points = j["points"];
        if (points.isArray()) {
            for (const Json& p : points.items()) s.points.push_back(p.asDouble(0.0));
        }
        SkinShape kept;
        // Everything on disk is re-sanitized on the way in: the file is shared
        // with another build, and an older one may have written a shape this
        // one's limits no longer allow.
        if (sanitizeSkinShape(std::move(s), kept)) skin.shapes.push_back(std::move(kept));
    }
    return skin;
}

} // namespace flix
