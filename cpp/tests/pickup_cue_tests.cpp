#include "test.h"

#include "client/camera.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "shared/net/protocol.h"

#include <vector>

using namespace flix;

// The client half of the pickup cue.
//
// A drop can be collected on the tick it spawned -- magnetism is a pickup
// RADIUS, and an apex observer's is 437 units, further out than the petals
// that did the killing -- so no snapshot ever carries the entity and the
// client has never heard of that net id. The cue is then the only thing there
// is to draw from, which is why it carries the drop's position and look.
// Ignoring a cue for an id the entity table never held is what makes a
// well-equipped flower look like mobs stopped dropping loot.
//
// That materialising only holds for the VIEWER'S OWN pickup, which is certain:
// the item is in their inventory whatever the entity does next. Everyone
// else's is not. A drop is shared -- it pays out one copy per eligible flower
// and the entity survives until the last of them has collected -- so a
// stranger's pickup leaves the item lying exactly where it was, and a
// stranger's pickup of a drop this client never held is an item that was never
// there. The cue for one of those has to draw nothing; see the second half of
// this file.
//
// Counted rather than looked at: sectionTiming().itemCount is how many drops
// survived culling in the last frame, live and dying alike, which is exactly
// "how many items is the viewer being shown".

namespace {

constexpr int kFrameSize = 320;
constexpr Vec2 kDropAt{1000.0, 1000.0};
constexpr std::uint32_t kDropNetId = 4242;
constexpr std::uint32_t kTakerNetId = 7;
/// Somebody else's flower, for the cues that are not the viewer's.
constexpr std::uint32_t kStrangerNetId = 8;

/// Longer than the 150 ms pickup flight and shorter than the 300 ms despawn
/// spin, so what is left on screen after it tells the two animations apart.
constexpr double kPastTheFlight = 0.2;

Camera frameCamera() {
    Camera camera;
    camera.setViewport(kFrameSize, kFrameSize);
    camera.userZoom = 1.0;
    camera.snapTo(kDropAt);
    return camera;
}

ViewEvent pickupCue(std::uint16_t petalIndex, Rarity rarity,
                    std::uint32_t takerNetId = kTakerNetId) {
    ViewEvent cue;
    cue.kind = net::EventKind::PickedUp;
    cue.netId = kDropNetId;
    cue.otherNetId = takerNetId;
    cue.position = kDropAt;
    // The look, in the two fixed fields this kind has no other use for.
    cue.amount = petalIndex;
    cue.flag = static_cast<std::uint8_t>(rarityIndex(rarity));
    return cue;
}

/// The taker, so the item has somewhere to fly to.
RemoteEntity flowerAt(Vec2 position, std::uint32_t netId = kTakerNetId) {
    RemoteEntity flower;
    flower.netId = netId;
    flower.kind = net::EntityKind::Player;
    flower.position = position;
    flower.targetPosition = position;
    flower.needsSnap = false;
    return flower;
}

/// The drop, lying where the cue says it is.
RemoteEntity itemOnTheGround(std::uint16_t petalIndex, Rarity rarity) {
    RemoteEntity item;
    item.netId = kDropNetId;
    item.kind = net::EntityKind::Drop;
    item.typeIndex = petalIndex;
    item.rarity = rarity;
    item.position = kDropAt;
    item.targetPosition = kDropAt;
    item.needsSnap = false;
    return item;
}

/// A view holding the viewer's flower and one stranger's, both beside the
/// drop. kTakerNetId is the VIEWER here, which is what a cue naming it means.
void seedFlowers(WorldView& view) {
    view.setRealm(Realm::Overworld);
    view.seedForTest(flowerAt(kDropAt + Vec2{60.0, 0.0}, kTakerNetId));
    view.seedForTest(flowerAt(kDropAt + Vec2{-60.0, 0.0}, kStrangerNetId));
    view.setSelfNetIdForTest(kTakerNetId);
}

/// One frame, and how many drops it drew.
int itemsDrawn(WorldRenderer& renderer, const WorldView& view) {
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    renderer.draw(canvas, view, frameCamera(), kDropAt, 0.0);
    return renderer.sectionTiming().itemCount;
}

/// How many drops the renderer drew in one frame `age` seconds after the cue.
int itemsDrawnAfterCue(const ViewEvent& cue, double age) {
    WorldView view;
    seedFlowers(view);

    WorldRenderer renderer;
    view.events().push_back(cue);
    renderer.ingestEvents(view);
    renderer.update(age);
    return itemsDrawn(renderer, view);
}

} // namespace

// ---------------------------------------------------------------------------

TEST(a_pickup_cue_for_a_drop_the_client_never_saw_still_draws_the_item) {
    // Nothing was on screen and nothing was in the entity table: the whole
    // item comes out of the cue.
    CHECK_EQ(itemsDrawnAfterCue(pickupCue(3, Rarity::Legendary), 0.0), 1);

    // And it is a FLIGHT, not a permanent fixture: past the pickup animation
    // the drop is gone.
    CHECK_EQ(itemsDrawnAfterCue(pickupCue(3, Rarity::Legendary), 1.0), 0);
}

TEST(a_pickup_cue_for_a_drop_the_client_held_animates_it_once) {
    WorldView view;
    seedFlowers(view);
    view.seedForTest(itemOnTheGround(3, Rarity::Rare));

    WorldRenderer renderer;
    // One frame with the drop lying there, which is what puts it in the
    // renderer's own table.
    renderer.ingestEvents(view);
    renderer.update(0.0);
    CHECK_EQ(itemsDrawn(renderer, view), 1);

    // Now it is taken: the snapshot drops the entity in the same breath the
    // cue arrives, and the flight is played from the record the renderer kept.
    // ONE item, not two -- a cue that both materialised an item and left the
    // held record behind would draw the drop twice over.
    view.clear();
    seedFlowers(view);
    view.events().push_back(pickupCue(3, Rarity::Rare));
    renderer.ingestEvents(view);
    renderer.update(0.0);
    CHECK_EQ(itemsDrawn(renderer, view), 1);
}

// ---------------------------------------------------------------------------
// Somebody else's pickup.

TEST(a_stranger_s_pickup_of_a_drop_this_client_never_saw_draws_nothing) {
    // A flower out in the fog collects loot no snapshot ever sent here.
    // Materialising it -- right for the viewer's own magnet pickup, above --
    // shows the viewer an item appearing out of empty ground to fly at
    // somebody, and it is the only thing they ever see of that drop.
    CHECK_EQ(itemsDrawnAfterCue(pickupCue(3, Rarity::Legendary, kStrangerNetId), 0.0), 0);
    CHECK_EQ(itemsDrawnAfterCue(pickupCue(3, Rarity::Legendary, kStrangerNetId), kPastTheFlight),
             0);
}

TEST(a_stranger_s_copy_of_a_shared_drop_leaves_the_item_lying_there) {
    // The drop is still on the wire after the cue, so it went to one eligible
    // flower of several and nothing has left. One item on screen: the one
    // that never moved.
    WorldView view;
    seedFlowers(view);
    view.seedForTest(itemOnTheGround(3, Rarity::Rare));

    WorldRenderer renderer;
    renderer.ingestEvents(view);
    CHECK_EQ(itemsDrawn(renderer, view), 1);

    view.events().push_back(pickupCue(3, Rarity::Rare, kStrangerNetId));
    renderer.ingestEvents(view);
    CHECK_EQ(itemsDrawn(renderer, view), 1);

    // And the claim must not outlive the frame it was made in: when this drop
    // eventually times out it spins out where it lies, rather than flying off
    // to a flower that took its copy seconds ago. Still there past the
    // flight's length, so it is not in one.
    renderer.update(kPastTheFlight);
    CHECK_EQ(itemsDrawn(renderer, view), 1);
}

TEST(a_stranger_s_pickup_that_removes_the_drop_flies_it_to_them) {
    // The last eligible flower collects: the entity is destroyed in the tick
    // the cue is sent, both reach the client in one snapshot, and the flight
    // is what the viewer should see.
    WorldView view;
    seedFlowers(view);
    view.seedForTest(itemOnTheGround(3, Rarity::Rare));

    WorldRenderer renderer;
    renderer.ingestEvents(view);
    CHECK_EQ(itemsDrawn(renderer, view), 1);

    view.clear();
    seedFlowers(view);
    view.events().push_back(pickupCue(3, Rarity::Rare, kStrangerNetId));
    renderer.ingestEvents(view);
    CHECK_EQ(itemsDrawn(renderer, view), 1);

    // A flight, not a despawn spin: it is over well before the spin would be.
    renderer.update(kPastTheFlight);
    CHECK_EQ(itemsDrawn(renderer, view), 0);
}

TEST(a_drop_that_simply_times_out_still_spins_out_where_it_lay) {
    // The same absence with no cue behind it. The longer animation is the
    // proof it went down the despawn path and not an inherited claim.
    WorldView view;
    seedFlowers(view);
    view.seedForTest(itemOnTheGround(3, Rarity::Rare));

    WorldRenderer renderer;
    renderer.ingestEvents(view);

    view.clear();
    seedFlowers(view);
    renderer.ingestEvents(view);

    renderer.update(kPastTheFlight);
    CHECK_EQ(itemsDrawn(renderer, view), 1);
}
