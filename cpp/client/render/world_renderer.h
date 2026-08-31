#pragma once
// Draws the world: terrain, entities, and the effects layered over them.
//
// Reads only from the WorldView -- it never simulates. Anything that needs to
// persist between frames (a floating damage number, a death puff) lives in the
// effect pool here, seeded from the events the server sent.

#include <cstdint>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "canvas.h"

#include "client/camera.h"
#include "client/render/sprites.h"
#include "client/world_view.h"
#include "shared/core/types.h"

namespace flr {

class ContentRegistry;
class Terrain;

/// A short-lived visual with no gameplay meaning.
struct Effect {
    enum class Kind : std::uint8_t { DamageNumber, HealNumber, Puff, Ripple };
    Kind kind = Kind::DamageNumber;
    Vec2 position;
    Vec2 drift;
    double value = 0;
    double radius = 0;
    std::uint32_t color = 0xFFFFFFu;
    double ageSeconds = 0;
    double lifeSeconds = 1.0;
};

class WorldRenderer {
public:
    void setContent(const ContentRegistry* content) { content_ = content; }
    void setSprites(const SpriteCache* sprites) { sprites_ = sprites; }

    /// Turns this frame's server events into effects. Drains `view.events()`.
    void ingestEvents(WorldView& view);

    /// Ages effects and retires expired ones.
    void update(double dt);

    /// What the renderer actually needs: a set of entities to draw.
    using EntityMap = std::unordered_map<std::uint32_t, RemoteEntity>;

    /// Draws the whole world. `predictedSelf` is the client's own predicted
    /// position, which replaces the interpolated one for the player's own body
    /// -- otherwise the flower you control visibly lags your input.
    void draw(Canvas&, const EntityMap&, const Camera&, Vec2 predictedSelf,
              double timeSeconds) const;

    /// The same, reading the entities out of a live view. Taking the map
    /// separately as well is what lets a tool or a replay render a scene it
    /// assembled itself, with no socket behind it.
    void draw(Canvas&, const WorldView&, const Camera&, Vec2 predictedSelf,
              double timeSeconds) const;

    /// Terrain is optional: a client that has not yet been sent the map draws a
    /// plain biome ground rather than nothing.
    void setTerrain(const Terrain* terrain) { terrain_ = terrain; }

    /// Cap on live effects. A crowded fight can generate hundreds of damage
    /// numbers a second, and past a point they are noise that costs frame time.
    std::size_t maxEffects = 256;

private:
    void drawTerrain(Canvas&, const Camera&) const;
    void drawEntity(Canvas&, const RemoteEntity&, const Camera&, Vec2 at, double timeSeconds) const;
    void drawFlower(Canvas&, const RemoteEntity&, const Camera&, Vec2 at, double timeSeconds) const;
    void drawFlowerBody(Canvas&, const RemoteEntity&, double timeSeconds) const;
    void drawDefaultFlower(Canvas&, const RemoteEntity&, double timeSeconds) const;
    void drawPumpkin(Canvas&, const RemoteEntity&) const;
    void drawRobot(Canvas&, const RemoteEntity&) const;
    void drawHealthBar(Canvas&, const RemoteEntity&, const Camera&, Vec2 at) const;
    void drawEffects(Canvas&, const Camera&) const;

    const ContentRegistry* content_ = nullptr;
    const SpriteCache* sprites_ = nullptr;
    const Terrain* terrain_ = nullptr;
    std::vector<Effect> effects_;

    // A single transparent buffer is reused one flower at a time for the
    // Glitch flag. It grows with the largest on-screen flower and never needs
    // to survive a frame, so sharing avoids a canvas allocation per player.
    mutable std::unique_ptr<Canvas> glitchBody_;
    mutable int glitchSide_ = 0;
};

} // namespace flr
