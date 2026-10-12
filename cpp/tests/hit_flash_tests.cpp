#include "test.h"

#include "canvas.h"
#include "client/camera.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "render_rig.h"
#include "shared/net/protocol.h"

#include <algorithm>
#include <cstdlib>
#include <vector>

using namespace flix;

// The hit flash, as florr's client draws it: each Damage event lays 150 ms of
// colour over the body -- white for the first 15 ms, red after -- fading
// linearly from an intensity of clamp(share^0.5, 0.1, 1) (florr's is
// share^0.2), where the share is what the hit took of the victim's max health.
// Every hit a body takes before the next frame is one flash for their total,
// the flashes in flight are composited, and never past half strength. The colour is premultiplied and blended into every
// colour the body is painted with as c * (1 - a) + tint.

namespace {

constexpr std::uint32_t kVictim = 31;
constexpr int kFrameSize = 200;
constexpr Vec2 kAt{1000.0, 1000.0};

ViewEvent hitFor(double share, std::uint32_t netId = kVictim) {
    ViewEvent hit;
    hit.kind = net::EventKind::Damage;
    hit.netId = netId;
    hit.amount = 10.0;
    hit.position = kAt;
    hit.radius = share;
    return hit;
}

void ingest(WorldRenderer& renderer, const std::vector<ViewEvent>& events) {
    WorldView view;
    for (const ViewEvent& event : events) view.events().push_back(event);
    renderer.ingestEvents(view);
}

bool near(int a, int b, int tolerance = 2) { return std::abs(a - b) <= tolerance; }

} // namespace

TEST(a_hit_flashes_white_then_red_and_is_gone_after_150_ms) {
    WorldRenderer renderer;
    CHECK_EQ(static_cast<int>(renderer.hitTint(kVictim).a), 0);

    ingest(renderer, {hitFor(1.0)});
    // The frame that first draws it starts it: the white tenth is on screen,
    // at the half-strength ceiling.
    renderer.update(1.0 / 60.0);
    Color tint = renderer.hitTint(kVictim);
    CHECK(near(tint.r, 127));
    CHECK(near(tint.g, 127));
    CHECK(near(tint.b, 127));
    CHECK(near(tint.a, 127));

    // 30 ms in: four fifths of its life left, red, at four fifths -- still
    // over the ceiling, so held at it.
    renderer.update(0.030);
    tint = renderer.hitTint(kVictim);
    CHECK(near(tint.r, 127));
    CHECK_EQ(static_cast<int>(tint.g), 0);
    CHECK_EQ(static_cast<int>(tint.b), 0);
    CHECK(near(tint.a, 127));

    // 105 ms in: three tenths left, under it.
    renderer.update(0.075);
    CHECK(near(renderer.hitTint(kVictim).a, 76));

    renderer.update(0.050);
    CHECK_EQ(static_cast<int>(renderer.hitTint(kVictim).a), 0);
}

TEST(a_hit_flashes_as_hard_as_its_share_of_the_bar) {
    // A twenty-fifth of the bar: 0.04^0.5 = 0.2.
    WorldRenderer small;
    ingest(small, {hitFor(0.04)});
    small.update(0.0);
    CHECK(near(small.hitTint(kVictim).a, 51));

    // A hit for nothing still shows, at the floor.
    WorldRenderer nothing;
    ingest(nothing, {hitFor(0.0)});
    nothing.update(0.0);
    CHECK(near(nothing.hitTint(kVictim).a, 25));

    // Two before a frame are one flash for their total.
    WorldRenderer two;
    ingest(two, {hitFor(0.04), hitFor(0.04)});
    two.update(0.0);
    WorldRenderer once;
    ingest(once, {hitFor(0.08)});
    once.update(0.0);
    CHECK_EQ(static_cast<int>(two.hitTint(kVictim).a), static_cast<int>(once.hitTint(kVictim).a));

    // Two frames apart, they are composited, not averaged: brighter than one.
    WorldRenderer apart;
    ingest(apart, {hitFor(0.04)});
    apart.update(0.0);
    ingest(apart, {hitFor(0.04)});
    apart.update(0.0);
    CHECK(apart.hitTint(kVictim).a > small.hitTint(kVictim).a + 20);

    // And the flash is the body's own.
    CHECK_EQ(static_cast<int>(two.hitTint(kVictim + 1).a), 0);
}

TEST(a_swing_shared_over_a_colony_flashes_once_not_once_per_share) {
    // A termite overmind next to twenty others takes a sliver of every swing
    // at any of them, each its own Damage event. Each alone is a hit for
    // nothing, at the floor; one frame of them must stay one floor flash,
    // not twenty laid over each other.
    std::vector<ViewEvent> shares;
    for (int i = 0; i < 20; ++i) shares.push_back(hitFor(0.0001));
    WorldRenderer renderer;
    ingest(renderer, shares);
    renderer.update(0.0);
    CHECK(near(renderer.hitTint(kVictim).a, 25));
}

TEST(a_chip_for_a_sliver_of_a_huge_bar_flashes_at_the_floor) {
    // An apex leaf takes half a percent of an ultra termite overmind's bar and
    // a fortieth of that off a super's. On florr's byte curve the ultra's chip
    // was one step over 1/255 and flashed at a third -- across a body that
    // fills the screen -- while the super's sat at the floor. Both are chips.
    WorldRenderer ultra;
    ingest(ultra, {hitFor(0.00495)});
    ultra.update(0.0);
    WorldRenderer super;
    ingest(super, {hitFor(0.00026)});
    super.update(0.0);
    CHECK(near(ultra.hitTint(kVictim).a, 25));
    CHECK_EQ(static_cast<int>(ultra.hitTint(kVictim).a), static_cast<int>(super.hitTint(kVictim).a));
}

TEST(a_flash_never_passes_half_strength) {
    // Hits for the whole bar every frame: florr's would hold full white.
    WorldRenderer renderer;
    for (int frame = 0; frame < 12; ++frame) {
        ingest(renderer, {hitFor(1.0)});
        renderer.update(1.0 / 60.0);
        CHECK(renderer.hitTint(kVictim).a <= 128);
    }
}

TEST(a_color_tint_washes_every_style_set_after_it) {
    Canvas canvas = Canvas::createVirtual(4, 4);
    canvas.setColorTint(Color{204, 0, 0, 204});
    canvas.setFillStyle(Color{0, 0, 255});
    canvas.fillRect(0, 0, 4, 4);
    std::vector<std::uint8_t> px = canvas.getImageData(1, 1, 1, 1);
    // blue * 0.2 + red premultiplied at 0.8
    CHECK(near(px[0], 204));
    CHECK(near(px[1], 0));
    CHECK(near(px[2], 51));

    // Off again: a style set now is the colour asked for.
    canvas.setColorTint(Color{0, 0, 0, 0});
    canvas.setFillStyle(Color{0, 0, 255});
    canvas.fillRect(0, 0, 4, 4);
    px = canvas.getImageData(1, 1, 1, 1);
    CHECK_EQ(static_cast<int>(px[0]), 0);
    CHECK_EQ(static_cast<int>(px[2]), 255);
}

TEST(a_struck_flower_is_drawn_white_then_back_to_yellow) {
    WorldView view;
    view.setRealm(Realm::Overworld);
    RemoteEntity flower;
    flower.netId = kVictim;
    flower.kind = net::EntityKind::Player;
    flower.position = flower.targetPosition = kAt;
    flower.needsSnap = false;
    flower.radius = playerRadiusForLevel(1);
    flower.level = 1;
    view.seedForTest(flower);

    WorldRenderer renderer;
    const auto petalAt = [&](int x, int y) {
        Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
        renderer.draw(canvas, view, testsupport::frameCamera(kFrameSize, kAt), kAt, 0.0);
        return canvas.getImageData(x, y, 1, 1);
    };
    // Inside the body, clear of the eyes and the mouth.
    const int x = kFrameSize / 2 - 15;
    const int y = kFrameSize / 2;

    const std::vector<std::uint8_t> before = petalAt(x, y);
    ingest(renderer, {hitFor(1.0)});
    renderer.update(0.0);
    const std::vector<std::uint8_t> struck = petalAt(x, y);
    renderer.update(0.2);
    const std::vector<std::uint8_t> after = petalAt(x, y);

    // The default flower is #FFE763; struck, it is washed halfway to white.
    CHECK(near(before[0], 0xFF, 6) && near(before[1], 0xE7, 6) && near(before[2], 0x63, 6));
    CHECK(near(struck[0], 0xFF, 6) && near(struck[1], 0xE7 / 2 + 127, 6) &&
          near(struck[2], 0x63 / 2 + 127, 6));
    CHECK_EQ(testsupport::differingPixels(before, after, 1), 0);
}

// The screen shake: a hit on the viewer's OWN flower pushes the world it is
// drawn through, by at most five world units, and settles within seconds.

namespace {

WorldView viewWithSelf() {
    WorldView view;
    view.setRealm(Realm::Overworld);
    RemoteEntity flower;
    flower.netId = kVictim;
    flower.kind = net::EntityKind::Player;
    flower.spawnFlags = net::SpawnIsSelf;
    flower.position = flower.targetPosition = kAt;
    flower.needsSnap = false;
    view.seedForTest(flower);
    view.setSelfNetIdForTest(kVictim);
    return view;
}

/// The largest push over `seconds` of 60 fps frames.
double largestShake(WorldRenderer& renderer, double seconds) {
    double largest = 0.0;
    for (int i = 0; i < static_cast<int>(seconds * 60.0); ++i) {
        renderer.update(1.0 / 60.0);
        largest = std::max(largest, renderer.shakeOffset().length());
    }
    return largest;
}

double shakeAfterHitOn(std::uint32_t netId, bool enabled) {
    WorldView view = viewWithSelf();
    WorldRenderer renderer;
    renderer.options.screenShake = enabled;
    view.events().push_back(hitFor(0.1, netId));
    renderer.ingestEvents(view);
    return largestShake(renderer, 0.3);
}

} // namespace

TEST(a_hit_on_your_own_flower_shakes_the_screen_and_settles) {
    WorldView view = viewWithSelf();
    WorldRenderer renderer;
    CHECK_EQ(renderer.shakeOffset().length(), 0.0);

    view.events().push_back(hitFor(0.1));
    renderer.ingestEvents(view);
    const double shake = largestShake(renderer, 0.3);
    CHECK(shake > 1.0);
    CHECK(shake <= 5.0 + 1e-9);

    // Two seconds on, nothing is left of it.
    largestShake(renderer, 2.0);
    CHECK(renderer.shakeOffset().length() < 0.05);
}

TEST(only_your_own_flower_being_hit_shakes_the_screen_and_the_setting_turns_it_off) {
    CHECK(shakeAfterHitOn(kVictim, true) > 1.0);
    CHECK_EQ(shakeAfterHitOn(kVictim + 1, true), 0.0);
    CHECK_EQ(shakeAfterHitOn(kVictim, false), 0.0);
}

TEST(the_screen_shake_is_the_same_size_on_screen_at_any_zoom) {
    WorldView view = viewWithSelf();
    WorldRenderer renderer;
    view.events().push_back(hitFor(0.1));
    renderer.ingestEvents(view);
    // Into the shake, on a frame where it has moved the camera.
    for (int i = 0; i < 6 && renderer.shakeOffset().length() < 1.0; ++i) renderer.update(1.0 / 60.0);
    CHECK(renderer.shakeOffset().length() >= 1.0);

    const auto pushOnScreen = [&](double loadoutZoom) {
        Camera camera = testsupport::frameCamera(kFrameSize, kAt);
        camera.loadoutZoom = loadoutZoom;
        const Camera shaken = renderer.shakenCamera(camera);
        return (shaken.worldToScreen(kAt) - camera.worldToScreen(kAt)).length();
    };
    CHECK_NEAR(pushOnScreen(1.0), renderer.shakeOffset().length(), 1e-9);
    CHECK_NEAR(pushOnScreen(0.5), renderer.shakeOffset().length(), 1e-9);
    CHECK_NEAR(pushOnScreen(0.25), renderer.shakeOffset().length(), 1e-9);
}
