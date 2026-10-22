#pragma once
// A dark map (MapData::isDark, the pyramid): the world dimmed to the map's
// dark colour everywhere but round what gives off light, and every creature
// and item hidden outside that light.
//
// Read out of florr's web client (client.wasm, the world render f_ayb, the
// light table at 5316788). Two stages, both keyed off one light table:
//
//  1. The map's tiles go down as on any map. Every ENTITY is then drawn into a
//     layer of its own, which is cut down to one hard disc per light, radius
//     `(reach + 25) x scale` (destination-in), before it joins the frame. Out
//     of the light the ground shows and nothing on it does.
//  2. Last of the world, a full-screen picture is MULTIPLIED over it: filled
//     with the map's dark colour lifted a tenth toward white (`0.9c + 25.5`),
//     then, per light, a white disc of radius `reach x scale` and another of
//     `(reach + 25) x scale`, each at half alpha. So the world keeps the dark
//     colour's fraction of itself out in the dark, half-way to whole in the
//     25-unit rim and three quarters inside, and overlapping lights stack
//     toward whole.
//
// Each light:
//
//  * is keyed by entity, and is looked up again every frame;
//  * reaches `kind + body radius` world units, the kind being
//      flower                     200
//      pet (a friendly mob)       150
//      a DROPPED bulb             200 + 100 x rarity, 2000 from Unique up
//    and nothing else's (two florr kinds this does not port: a component that
//    lights 25 and a tag that lights 200 -- neither could be named);
//  * has scale = breathe x fade, where breathe swells 1 -> 1.1 and back on a
//    2 pi second cosine, and fade eases toward 1 while the entity is there and
//    toward 0 once it is gone or dead (expm1(-0.006322 dt), about 158 ms), the
//    light staying where it last was;
//  * is forgotten once faded under 0.001.
//
// Ours on top (user, 2026-10-21: "bulb or pets like sun are emissive, and
// light up the surrounding area too"): every EMISSIVE petal lights with the
// bulb's reach, worn as well as dropped, and an emissive mob with its own
// `light_radius` (the sun's 2000), 200 when it names none.

#include <cstdint>
#include <memory>
#include <unordered_map>
#include <vector>

#include "canvas.h"
#include "client/world_view.h"
#include "shared/core/types.h"

namespace flix {

class Camera;
class ContentRegistry;

/// florr's own numbers. See the file comment.
inline constexpr double kFlowerLight = 200.0;
inline constexpr double kPetLight = 150.0;
inline constexpr double kBulbLight = 200.0;
inline constexpr double kBulbLightPerRarity = 100.0;
inline constexpr double kBulbLightTopRarity = 2000.0;
inline constexpr double kLightPad = 25.0;
inline constexpr double kLightBreathe = 0.1;
inline constexpr double kLightFadeRatePerMs = 0.006322;
inline constexpr double kLightForgottenBelow = 0.001;
/// The alpha each of a light's two white discs is laid at.
inline constexpr double kLightDiscAlpha = 0.5;
/// Ours: an emissive mob whose config names no `light_radius`.
inline constexpr double kEmissiveMobLight = 200.0;

/// How far the light `entity` gives off reaches, in world units, body radius
/// included; 0 for none. `content` may be null (nothing is then emissive).
double lightReach(const RemoteEntity& entity, const ContentRegistry* content);

/// The bulb's reach for a petal of `rarity`, body radius not included.
double bulbLight(Rarity rarity);

/// What a map's dark colour (0xRRGGBB) shades the world down to out in the
/// dark: florr lifts it a tenth of the way to white, `c * 0.9 + 25.5`, cut to
/// a byte.
Color darknessFloor(std::uint32_t darkColor);

struct LightSource {
    std::uint32_t netId = 0;
    Vec2 position;
    double reach = 0;
};

/// One light as drawn this frame, in world units: the inner disc
/// (`reach x scale`) and the outer one (`(reach + 25) x scale`), which is
/// also where entities stop being drawn.
struct LightDisc {
    Vec2 centre;
    double inner = 0;
    double outer = 0;
};

/// Every light in `view`, at the entities' drawn positions -- the viewer's
/// own flower at `selfDrawn`.
void gatherLights(const WorldView& view, Vec2 selfDrawn, const ContentRegistry* content,
                  std::vector<LightSource>& out);

class DarkMap {
public:
    struct Light {
        Vec2 position;
        double reach = 0;
        double fade = 0;
        bool present = false;
    };

    DarkMap();
    ~DarkMap();
    DarkMap(const DarkMap&) = delete;
    DarkMap& operator=(const DarkMap&) = delete;

    /// One frame of florr's light table: what is in `sources` is refreshed
    /// and eases in, what is not eases out where it was, `stepSeconds` on.
    /// `snap` lands every fade where it is heading at once.
    void step(const std::vector<LightSource>& sources, double stepSeconds, bool snap = false);
    /// Forgets every light at once: a new realm is a new set of entities.
    void clear() { lights_.clear(); }

    /// This frame's discs, `timeSeconds` driving the breathe.
    void discs(double timeSeconds, std::vector<LightDisc>& out) const;

    /// Stage 2: multiplies everything `canvas` holds by the dark, `floor` out
    /// in it (see darknessFloor), lifted by `discs`. `camera` is the one the
    /// world was drawn through.
    void shade(Canvas& canvas, const Camera& camera, const std::vector<LightDisc>& discs,
               Color floor);

    /// florr's breathe at `timeSeconds`: 1 to 1 + kLightBreathe.
    static double breathe(double timeSeconds);

    const std::unordered_map<std::uint32_t, Light>& lights() const { return lights_; }

private:
    std::unordered_map<std::uint32_t, Light> lights_;
#ifdef __EMSCRIPTEN__
    std::unique_ptr<Canvas> layer_;
#else
    std::vector<std::uint8_t> mask_;
#endif
};

} // namespace flix
