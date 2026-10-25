#include "test.h"

#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "render_rig.h"
#include "shared/net/protocol.h"

#include <vector>

using namespace flix;

// A petal's death, played as gardn plays every deletion: the Killed cue names
// a petal the snapshot has already erased, and the renderer fades it out where
// it was last drawn while it grows by half, over 125 ms.

namespace {

constexpr int kFrameSize = 160;
constexpr Vec2 kAt{1000.0, 1000.0};
constexpr std::uint32_t kPetalNetId = 31;

RemoteEntity petalAt(Vec2 at) {
    RemoteEntity petal;
    petal.netId = kPetalNetId;
    petal.kind = net::EntityKind::Petal;
    petal.position = at;
    petal.targetPosition = at;
    petal.needsSnap = false;
    petal.radius = 10;
    return petal;
}

/// One frame `age` seconds after the snapshot erased the petal, cued as killed
/// or -- `cued` false -- simply gone, as a petal that left view is.
std::vector<std::uint8_t> frameAfterErasing(double age, bool cued = true) {
    WorldView view;
    view.setRealm(Realm::Overworld);
    view.removedPetals().push_back(petalAt(kAt));
    if (cued) {
        ViewEvent killed;
        killed.kind = net::EventKind::Killed;
        killed.netId = kPetalNetId;
        killed.position = kAt;
        view.events().push_back(killed);
    }
    WorldRenderer renderer;
    renderer.ingestEvents(view);
    renderer.update(age);
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    renderer.draw(canvas, view, testsupport::frameCamera(kFrameSize, kAt), kAt, 0.0);
    return canvas.getImageData(0, 0, kFrameSize, kFrameSize);
}

} // namespace

TEST(a_killed_petal_fades_out_where_it_was_growing_by_half) {
    // Erased with no cue: it left view, and nothing is drawn for it.
    const std::vector<std::uint8_t> nothing = frameAfterErasing(0.0, false);

    const int fresh = testsupport::differingPixels(nothing, frameAfterErasing(0.0));
    CHECK(fresh > 0);
    // Four fifths of the way through: half as big again nearly, so it covers
    // more of the frame, however faint.
    CHECK(testsupport::differingPixels(nothing, frameAfterErasing(0.1)) > fresh);
    // And gone once the 125 ms are up.
    CHECK_EQ(testsupport::differingPixels(nothing, frameAfterErasing(0.13)), 0);
}

TEST(a_petal_that_left_view_plays_no_death) {
    WorldView view;
    view.setRealm(Realm::Overworld);
    view.removedPetals().push_back(petalAt(kAt));
    WorldRenderer renderer;
    renderer.ingestEvents(view);
    // Drained with the events, whether or not anything asked for it.
    CHECK(view.removedPetals().empty());
}
