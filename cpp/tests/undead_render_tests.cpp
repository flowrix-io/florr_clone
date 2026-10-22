#include "test.h"

#include "canvas.h"
#include "client/camera.h"
#include "client/render/sprites.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "render_rig.h"
#include "shared/game/config.h"
#include "shared/game/player_flags.h"
#include "shared/net/protocol.h"
#include "test_data.h"

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

using namespace flix;

namespace {

constexpr int kFrameSize = 160;
constexpr Vec2 kAt{1000.0, 1000.0};

const SpriteCache& shippedSprites() {
    static const SpriteCache sprites = [] {
        SpriteCache cache;
        cache.build(testsupport::shippedContent(), testsupport::dataDir());
        return cache;
    }();
    return sprites;
}

/// One default flower at the centre of the frame, its face flags `face`.
std::vector<std::uint8_t> flowerFrame(std::uint8_t face, const char* keepAs,
                                      std::uint16_t equip = EquipNone) {
    WorldView view;
    view.setRealm(Realm::Overworld);
    RemoteEntity flower;
    flower.netId = 7;
    flower.kind = net::EntityKind::Player;
    flower.position = flower.targetPosition = kAt;
    flower.needsSnap = false;
    flower.radius = playerRadiusForLevel(1);
    flower.level = 1;
    flower.faceFlags = face;
    flower.equipFlags = equip;
    view.seedForTest(flower);

    WorldRenderer renderer;
    renderer.setContent(&testsupport::shippedContent());
    renderer.setSprites(&shippedSprites());
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    renderer.draw(canvas, view, testsupport::frameCamera(kFrameSize, kAt), kAt, 0.0);
    std::vector<std::uint8_t> frame = canvas.getImageData(0, 0, kFrameSize, kFrameSize);
    // FLIX_UNDEAD_PPM=<dir> keeps the frames, for a look by eye.
    if (const char* dir = std::getenv("FLIX_UNDEAD_PPM")) {
        if (std::FILE* out = std::fopen((std::string(dir) + "/" + keepAs + ".ppm").c_str(), "wb")) {
            std::fprintf(out, "P6\n%d %d\n255\n", kFrameSize, kFrameSize);
            for (std::size_t i = 0; i + 3 < frame.size(); i += 4) std::fwrite(&frame[i], 1, 3, out);
            std::fclose(out);
        }
    }
    return frame;
}

/// Pixels within a few steps of `rgb` in every channel.
int pixelsNear(const std::vector<std::uint8_t>& rgba, std::uint32_t rgb, int tolerance = 3) {
    const int want[3] = {static_cast<int>((rgb >> 16) & 0xFF), static_cast<int>((rgb >> 8) & 0xFF),
                         static_cast<int>(rgb & 0xFF)};
    int count = 0;
    for (std::size_t i = 0; i + 3 < rgba.size(); i += 4) {
        bool match = true;
        for (int c = 0; c < 3; ++c) match = match && std::abs(rgba[i + c] - want[c]) <= tolerance;
        if (match) ++count;
    }
    return count;
}

} // namespace

TEST(an_undead_flower_is_green_and_wrapped_in_its_bandage) {
    if (testsupport::shippedContent().petalIndex("bandage") == kInvalidIndex) {
        CHECK(false);
        return;
    }
    const std::vector<std::uint8_t> living = flowerFrame(FaceNone, "living");
    const std::vector<std::uint8_t> undead = flowerFrame(FaceUndead, "undead");

    // The body turns florr's undead green; the wraps are the bandage's linen.
    constexpr std::uint32_t kUndeadGreen = 0x83B05Du;
    constexpr std::uint32_t kLinen = 0xE5DAA1u;
    CHECK_EQ(pixelsNear(living, kUndeadGreen), 0);
    CHECK_EQ(pixelsNear(living, kLinen), 0);
    CHECK(pixelsNear(undead, kUndeadGreen) > 200);
    CHECK(pixelsNear(undead, kLinen) > 200);
    // And no longer the flower yellow anywhere.
    CHECK_EQ(pixelsNear(undead, 0xFFE763u), 0);
}

TEST(a_flower_wearing_a_bandage_is_wrapped_in_it_while_alive_too) {
    // User, 2026-10-22: "The bandage petal should always show the bandage
    // drawing when it is equipped, not just when petal is active." The wrap,
    // on the flower's own yellow -- the green is Undead's alone.
    if (testsupport::shippedContent().petalIndex("bandage") == kInvalidIndex) {
        CHECK(false);
        return;
    }
    const std::vector<std::uint8_t> worn = flowerFrame(FaceNone, "worn", EquipBandage);
    constexpr std::uint32_t kLinen = 0xE5DAA1u;
    CHECK(pixelsNear(worn, kLinen) > 200);
    CHECK_EQ(pixelsNear(worn, 0x83B05Du), 0);
    CHECK(pixelsNear(worn, 0xFFE763u) > 200);
}
