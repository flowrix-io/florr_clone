// "The skin does not appear on the player" is a claim about pixels, so these
// render a frame and read them back rather than asserting on the plumbing that
// feeds the painter.
//
// One flower at the centre of a small frame, no content and no sprites: the
// ground falls back to its flat biome colour and the only thing painted over
// the middle of the frame is the body.

#include "test.h"

#include "client/camera.h"
#include "client/net_client.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "server_harness.h"
#include "shared/game/skin_format.h"

#include <cstdint>
#include <string>
#include <vector>

using namespace flix;

namespace {

constexpr int kFrameSize = 160;
constexpr std::uint32_t kFlowerNetId = 11;
constexpr Vec2 kFlowerAt{0.0, 0.0};

/// A skin that is one flat magenta disc covering the whole body -- a colour no
/// flower, face or ground ever paints, so a pixel of it at the centre of the
/// frame can only have come from the skin.
constexpr std::uint8_t kSkinR = 0xE0;
constexpr std::uint8_t kSkinG = 0x11;
constexpr std::uint8_t kSkinB = 0xCC;

CustomSkin magentaDiscSkin(const std::string& id) {
    SkinShape body;
    body.t = SkinShapeType::Circle;
    body.r = 25;
    body.fill = "#e011cc";

    CustomSkin skin;
    skin.id = id;
    skin.name = "test";
    skin.author = "tester";
    skin.shapes.push_back(body);
    return skin;
}

RemoteEntity flowerWearing(const std::string& skinId) {
    RemoteEntity flower;
    flower.netId = kFlowerNetId;
    flower.kind = net::EntityKind::Player;
    flower.position = kFlowerAt;
    flower.targetPosition = kFlowerAt;
    flower.needsSnap = false;
    flower.radius = playerRadiusForLevel(1);
    flower.level = 1;
    flower.equippedSkinId = skinId;
    return flower;
}

Camera frameCamera() {
    Camera camera;
    camera.setViewport(kFrameSize, kFrameSize);
    camera.userZoom = 1.0;
    camera.snapTo(kFlowerAt);
    return camera;
}

/// True when the middle of the frame is the skin's magenta.
bool skinPaintedTheBody(const std::vector<CustomSkin>* catalog, const std::string& wornId) {
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    WorldView view;
    view.setRealm(Realm::Overworld);
    view.seedForTest(flowerWearing(wornId));

    WorldRenderer renderer;
    if (catalog != nullptr) renderer.setSkinCatalog(catalog);
    renderer.draw(canvas, view, frameCamera(), kFlowerAt, 0.0);

    const std::vector<std::uint8_t> pixels = canvas.getImageData(0, 0, kFrameSize, kFrameSize);
    const std::size_t centre =
        (static_cast<std::size_t>(kFrameSize / 2) * kFrameSize + kFrameSize / 2) * 4;
    if (centre + 2 >= pixels.size()) return false;
    // Exact: the disc is a flat fill and the frame's centre is well inside it,
    // so nothing is blended there.
    return pixels[centre] == kSkinR && pixels[centre + 1] == kSkinG && pixels[centre + 2] == kSkinB;
}

} // namespace

// ---------------------------------------------------------------------------

TEST(an_equipped_custom_skin_is_drawn_on_the_flower) {
    const std::vector<CustomSkin> catalog{magentaDiscSkin("sk_worn")};
    CHECK(skinPaintedTheBody(&catalog, "sk_worn"));
}

TEST(a_flower_wearing_no_skin_keeps_the_default_body) {
    const std::vector<CustomSkin> catalog{magentaDiscSkin("sk_worn")};
    CHECK(!skinPaintedTheBody(&catalog, ""));
}

TEST(a_skin_this_client_has_never_heard_of_falls_back_to_the_default_body) {
    // What a wearer of a skin taken down mid-session looks like: the id is
    // still on the wire, the catalog no longer holds it, and the flower has to
    // draw as a flower rather than as nothing at all.
    const std::vector<CustomSkin> catalog{magentaDiscSkin("sk_other")};
    CHECK(!skinPaintedTheBody(&catalog, "sk_worn"));
    CHECK(!skinPaintedTheBody(nullptr, "sk_worn"));
}

// ---------------------------------------------------------------------------
// End to end: the real server, the real wire, two real clients.
//
// The render tests above prove the painter draws what it is handed; these
// prove something is handed to it. The gap between the two was the whole bug
// -- the studio published and equipped a skin the server stored and nothing
// ever put it on a body.

namespace {

using flix::testsupport::connectClient;
using flix::testsupport::Harness;

/// `other`'s view of `me`'s flower, or null while it has not arrived.
const RemoteEntity* flowerOf(const NetClient& other, std::uint32_t netId) {
    const auto it = other.view().entities().find(netId);
    return it == other.view().entities().end() ? nullptr : &it->second;
}

bool joinAs(Harness& h, NetClient& client, const char* name) {
    if (!connectClient(h, client)) return false;
    client.requestRegister(name, "hunter2!");
    if (!h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::LoggedIn; })) {
        return false;
    }
    client.joinGame(1280, 720);
    if (!h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; })) {
        return false;
    }
    return h.stepUntil({&client}, [&] { return client.view().self().netId != 0; });
}

} // namespace

TEST(a_published_skin_is_worn_on_the_wearers_body_for_everyone) {
    // No bots: this test says "that flower over there is the other player".
    Harness h("skin-equip", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient author;
    NetClient watcher;
    CHECK(joinAs(h, author, "skinner"));
    CHECK(joinAs(h, watcher, "onlooker"));
    const std::uint32_t authorNetId = author.view().self().netId;

    SkinShape body;
    body.t = SkinShapeType::Circle;
    body.r = 20;
    body.fill = "#e011cc";
    author.publishSkin("mine", {body});
    // The catalog is broadcast, so the WATCHER learns the skin too -- which is
    // what lets it draw a wearer it has never authored anything for.
    CHECK(h.stepUntil({&author, &watcher}, [&] {
        return !author.skinCatalog().empty() && !watcher.skinCatalog().empty();
    }));
    const std::string id = author.skinCatalog().front().id;
    CHECK(!id.empty());

    author.equipSkin(id);
    CHECK(h.stepUntil({&author, &watcher}, [&] {
        const RemoteEntity* seen = flowerOf(watcher, authorNetId);
        return seen != nullptr && seen->equippedSkinId == id;
    }));
    // And on the author's own screen, not only on everyone else's.
    const RemoteEntity* own = flowerOf(author, authorNetId);
    CHECK(own != nullptr && own->equippedSkinId == id);
    CHECK(watcher.findSkin(id) != nullptr);

    // Taking it off travels the same way.
    author.equipSkin("");
    CHECK(h.stepUntil({&author, &watcher}, [&] {
        const RemoteEntity* seen = flowerOf(watcher, authorNetId);
        return seen != nullptr && seen->equippedSkinId.empty();
    }));
}

TEST(a_worn_skin_survives_a_respawn) {
    // The body is rebuilt from the account row when a player dies, so a skin
    // that lives only on the old entity comes back a plain flower.
    Harness h("skin-respawn", {}, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient client;
    CHECK(joinAs(h, client, "reborn"));

    SkinShape body;
    body.t = SkinShapeType::Circle;
    body.r = 20;
    body.fill = "#e011cc";
    client.publishSkin("mine", {body});
    CHECK(h.stepUntil({&client}, [&] { return !client.skinCatalog().empty(); }));
    const std::string id = client.skinCatalog().front().id;
    client.equipSkin(id);
    CHECK(h.stepUntil({&client}, [&] {
        const RemoteEntity* own = flowerOf(client, client.view().self().netId);
        return own != nullptr && own->equippedSkinId == id;
    }));

    // Back to the menu and in again: a fresh body, built from the account.
    client.leaveGame();
    CHECK(h.stepUntil({&client}, [&] { return client.status() != NetClient::Status::Playing; }));
    client.joinGame(1280, 720);
    CHECK(h.stepUntil({&client}, [&] { return client.status() == NetClient::Status::Playing; }));
    CHECK(h.stepUntil({&client}, [&] {
        const RemoteEntity* own = flowerOf(client, client.view().self().netId);
        return own != nullptr && own->equippedSkinId == id;
    }));
}
