#pragma once
// World <-> screen mapping.
//
// The camera follows the player with a spring rather than rigidly, so that a
// knockback or a fast direction change moves the world under the flower
// instead of snapping the whole scene. Zoom is derived from the window size so
// a large window shows more world rather than the same world drawn bigger --
// otherwise widening the window would be a competitive advantage.

#include "shared/core/types.h"

namespace flr {

class Camera {
public:
    /// Follows `target`, easing toward it. `dt` in seconds.
    void follow(Vec2 target, double dt) {
        if (!initialised_) {
            centre_ = target;
            initialised_ = true;
            return;
        }
        // Frame-rate independent easing; a fixed per-frame lerp would make the
        // camera lag more on a slow machine.
        centre_.x = damp(centre_.x, target.x, followRate, dt);
        centre_.y = damp(centre_.y, target.y, followRate, dt);
    }

    /// Jumps the camera outright. For respawn and teleport, where easing would
    /// pan the whole map past the player.
    void snapTo(Vec2 target) {
        centre_ = target;
        initialised_ = true;
    }

    void setViewport(int width, int height) {
        viewportWidth_ = width;
        viewportHeight_ = height;
    }

    /// Zoom that keeps a constant amount of world visible vertically, so the
    /// game plays identically at any window size.
    double zoom() const {
        const double base = viewportHeight_ / referenceHeight;
        return base * userZoom;
    }

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

    /// World units visible vertically at zoom 1. Sets how much of the map a
    /// player sees, which is a balance decision, not a display one.
    double referenceHeight = 1080.0;

    /// Player-controlled zoom, and the transient zoom some petals apply.
    double userZoom = 1.0;

    /// Fraction of the remaining distance the camera closes per second.
    double followRate = 0.9999;

private:
    Vec2 centre_;
    int viewportWidth_ = 1280;
    int viewportHeight_ = 720;
    bool initialised_ = false;
};

} // namespace flr
