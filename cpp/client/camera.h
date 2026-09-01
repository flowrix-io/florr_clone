#pragma once
// World <-> screen mapping.
//
// Two decisions here look wrong in isolation and are not: the browser client
// is the reference, and it does both of these on purpose.
//
//  * Zoom is resolution-independent. `Graphics.zoomLevel` (src/graphics/
//    core.ts) is a flat 1.0 -- the player's zoom setting times whatever a
//    petal asks for -- and the world transform is nothing but
//    ctx.scale(zoomLevel, zoomLevel) (src/graphics/render.ts). A bigger window
//    therefore shows MORE world at the same pixel scale rather than the same
//    world drawn bigger. Scaling zoom by viewportHeight/1080 instead, as this
//    camera used to, shrank every world-unit metric in the renderer to 0.667x
//    at 720p while the HUD stayed put.
//
//  * The camera is pinned to the flower, never eased toward it. src/game.ts's
//    updateCamera writes the camera straight from the flower's *drawn*
//    position each frame, so the flower sits exactly on the screen centre.
//    That is load-bearing: the mouse control law reads the cursor's offset
//    from the screen centre and treats it as the offset from the flower, so a
//    lagging camera would skew steering, not just drift the flower off centre.

#include "shared/core/types.h"

namespace flr {

class Camera {
public:
    /// Centres the camera on `target`. The only way the camera moves: it is
    /// called every frame with the flower's drawn position, and again on
    /// respawn and teleport.
    void snapTo(Vec2 target) { centre_ = target; }

    void setViewport(int width, int height) {
        viewportWidth_ = width;
        viewportHeight_ = height;
    }

    /// World units -> pixels. Independent of the window size, so widening the
    /// window reveals more map instead of magnifying what is already there.
    double zoom() const { return userZoom; }

    Vec2 worldToScreen(Vec2 world) const {
        const double z = zoom();
        return {
            (world.x - centre_.x) * z + viewportWidth_ * 0.5,
            (world.y - centre_.y) * z + viewportHeight_ * 0.5,
        };
    }

    Vec2 screenToWorld(Vec2 screen) const {
        const double z = zoom();
        return {
            (screen.x - viewportWidth_ * 0.5) / z + centre_.x,
            (screen.y - viewportHeight_ * 0.5) / z + centre_.y,
        };
    }

    /// The world rectangle currently on screen, grown by `margin` world units.
    /// Used to skip drawing anything outside it.
    Rect visibleWorld(double margin = 0) const {
        const double z = zoom();
        const double halfW = viewportWidth_ * 0.5 / z + margin;
        const double halfH = viewportHeight_ * 0.5 / z + margin;
        return {centre_.x - halfW, centre_.y - halfH, halfW * 2, halfH * 2};
    }

    Vec2 centre() const { return centre_; }
    int viewportWidth() const { return viewportWidth_; }
    int viewportHeight() const { return viewportHeight_; }

    /// Player-controlled zoom, and the transient zoom some petals apply.
    double userZoom = 1.0;

private:
    Vec2 centre_;
    int viewportWidth_ = 1280;
    int viewportHeight_ = 720;
};

} // namespace flr
