// "The skin does not appear on the player" is a claim about pixels, so these
// render a frame and read them back rather than asserting on the plumbing that
// feeds the painter.
//
// One flower at the centre of a small frame, no content and no sprites: the
// ground falls back to its flat biome colour and the only thing painted over
// the middle of the frame is the body.

#include "test.h"

#include "client/camera.h"
#include "client/render/skin_render.h"
#include "shared/game/signature_skin.h"
#include "client/net_client.h"
#include "client/render/world_renderer.h"
#include "client/world_view.h"
#include "render_rig.h"
#include "server_harness.h"
#include "shared/game/skin_format.h"

#include <algorithm>
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

/// True when the middle of the frame is the skin's magenta.
bool skinPaintedTheBody(const std::vector<CustomSkin>* catalog, const std::string& wornId) {
    Canvas canvas = Canvas::createVirtual(kFrameSize, kFrameSize);
    WorldView view;
    view.setRealm(Realm::Overworld);
    view.seedForTest(flowerWearing(wornId));

    WorldRenderer renderer;
    if (catalog != nullptr) renderer.setSkinCatalog(catalog);
    renderer.draw(canvas, view, testsupport::frameCamera(kFrameSize, kFlowerAt), kFlowerAt, 0.0);

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

TEST(signature_skin_is_free_cosmetic_and_roundtrips_the_existing_database_format) {
    using namespace flix::testsupport;
    Harness h("signature-gift",[](const std::string& path){seedUser(path,"a19kisme","hunter2!");seedUser(path,"watcher","hunter2!");},dataDir(),0);
    CHECK(h.ready);if(!h.ready)return;NetClient owner,watcher;
    CHECK(loginAs(h,watcher,"watcher","hunter2!"));CHECK(loginAs(h,owner,"a19kisme","hunter2!"));
    CHECK(h.stepUntil({&owner,&watcher},[&]{return owner.findSkin(kSignatureSkinId)&&watcher.findSkin(kSignatureSkinId);}));
    const auto* skin=owner.findSkin(kSignatureSkinId);CHECK(skin);if(!skin)return;
    CHECK_EQ(skin->shapes.size(),std::size_t(72));CHECK(hasSignatureAnimation(*skin));CHECK(!owner.isSkinAdmin());
    auto& db=const_cast<Database&>(h.server.database());const auto* user=db.findUser("a19kisme");CHECK(user&&!user->admin);
    CHECK_EQ(db.findProgress(user->id)->equippedSkinId,std::string(kSignatureSkinId));
    const auto& saved=db.storedTable("customSkins")[kSignatureSkinId];CHECK(!saved.contains("price"));CHECK(!saved.contains("animation"));CHECK(!saved.contains("owned"));
    CHECK(owner.findSkin(kFanSkinId));CHECK(watcher.findSkin(kFanSkinId));
    CHECK(hasFanAnimation(makeFanSkin()));CHECK(!hasSignatureAnimation(makeFanSkin()));
    CHECK(canEquipSignatureSkin(kFanSkinId,"watcher"));
    CHECK(db.save());Database reopened;std::string error;CHECK(reopened.load(h.dbPath,error));
    CHECK(hasSignatureAnimation(skinFromJson(reopened.storedTable("customSkins")[kSignatureSkinId])));
    // Publishing a normal skin with no stars remains free.
    auto& publisher=db.progress(db.findUser("watcher")->id);publisher.stars=0;
    SkinShape rectangle;rectangle.t=SkinShapeType::Rect;rectangle.rx=17;rectangle.ry=11;rectangle.fill="#ec135a";
    watcher.publishSkin("Free rectangle",{rectangle});CHECK(h.stepUntil({&owner,&watcher},[&]{return watcher.skinCatalog().size()==3;}));CHECK_EQ(publisher.stars,0.0);
    // A normal published skin cannot select the named animation by its author.
    CustomSkin ordinary=*skin;ordinary.id="sk_another";CHECK(!hasSignatureAnimation(ordinary));
}
TEST(signature_skin_animates_in_the_world_and_has_a_static_legacy_fallback) {
    const CustomSkin skin=makeSignatureSkin();CHECK(sanitizeSkin(skin.name,skin.shapes).ok());
    ByteWriter writer;writeCustomSkin(writer,skin);ByteReader reader(writer.data(),writer.size());CustomSkin roundtrip;
    CHECK(readCustomSkin(reader,roundtrip));CHECK(reader.ok());CHECK(hasSignatureAnimation(roundtrip));
    std::vector<CustomSkin> catalog{roundtrip};WorldView view;view.setRealm(Realm::Overworld);view.seedForTest(flowerWearing(kSignatureSkinId));
    WorldRenderer renderer;renderer.setSkinCatalog(&catalog);
    Canvas first=Canvas::createVirtual(160,160),second=Canvas::createVirtual(160,160);
    renderer.draw(first,view,testsupport::frameCamera(160,kFlowerAt),kFlowerAt,0);
    renderer.draw(second,view,testsupport::frameCamera(160,kFlowerAt),kFlowerAt,1.4);
    CHECK(testsupport::differingPixels(first.getImageData(0,0,160,160),second.getImageData(0,0,160,160))>150);
    first.savePPM("/tmp/flowrix-signature-world.ppm");
    Canvas preview=Canvas::createVirtual(480,160);preview.setFillStyle("#25243b");preview.fillRect(0,0,480,160);
    for(int frame=0;frame<3;++frame){preview.save();preview.translate(float(80+160*frame),80);renderAnimatedSkin(preview,skin,47,frame*.8);preview.restore();}
    preview.savePPM("/tmp/flowrix-signature-preview.ppm");
    Canvas aura=Canvas::createVirtual(800,440);aura.setFillStyle("#181c2c");aura.fillRect(0,0,800,440);
    for(int frame=0;frame<2;++frame){aura.save();aura.translate(float(200+400*frame),220);renderSignatureAura(aura,34,frame*4.);renderAnimatedSkin(aura,skin,34,frame*4.);aura.restore();}
    aura.savePPM("/tmp/flowrix-signature-aura.ppm");
    Canvas fallback=Canvas::createVirtual(160,160);fallback.translate(80,80);renderSkinShapes(fallback,skin.shapes,50);
    const auto pixels=fallback.getImageData(0,0,160,160);CHECK(std::any_of(pixels.begin(),pixels.end(),[](auto v){return v!=0;}));
}

TEST(fan_skin_animates_for_the_wearer_and_other_players) {
    CHECK(testsupport::fontsReady());
    const std::vector<CustomSkin> catalog{makeFanSkin()};
    for (const bool self : {false, true}) {
        auto flower = flowerWearing(kFanSkinId);
        if (self) flower.spawnFlags |= net::SpawnIsSelf;
        WorldView view;
        view.setRealm(Realm::Overworld);
        view.seedForTest(flower);
        WorldRenderer renderer;
        renderer.setSkinCatalog(&catalog);
        Canvas first = Canvas::createVirtual(240, 240);
        Canvas second = Canvas::createVirtual(240, 240);
        const auto camera = testsupport::frameCamera(240, kFlowerAt);
        renderer.draw(first, view, camera, kFlowerAt, 0);
        renderer.draw(second, view, camera, kFlowerAt, 1.4);
        // Only the body: a changing label or health bar cannot pass this.
        CHECK(testsupport::differingPixels(first.getImageData(90, 90, 60, 60),
                                          second.getImageData(90, 90, 60, 60)) > 100);
        if (self && std::getenv("FLIX_FAN_PREVIEW")) {
            const std::string preview = std::getenv("FLIX_FAN_PREVIEW");
            second.savePPM(preview);
            for (int frame = 0; frame < 48; ++frame) {
                Canvas animated = Canvas::createVirtual(240, 240);
                renderer.draw(animated, view, camera, kFlowerAt, frame / 12.0);
                animated.savePPM(preview + "." + std::to_string(frame) + ".ppm");
            }
        }
    }
}

TEST(fan_skin_equip_reaches_the_wearer_and_other_players) {
    Harness h("fan-equip", {}, flix::testsupport::dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient fan, watcher;
    CHECK(joinAs(h, fan, "fan"));
    CHECK(joinAs(h, watcher, "watcher"));
    const auto* fanSkin = fan.findSkin(kFanSkinId);
    const auto* watcherSkin = watcher.findSkin(kFanSkinId);
    CHECK(fanSkin && hasFanAnimation(*fanSkin));
    CHECK(watcherSkin && hasFanAnimation(*watcherSkin));
    fan.equipSkin(kFanSkinId);
    const auto netId = fan.view().self().netId;
    CHECK(h.stepUntil({&fan, &watcher}, [&] {
        const auto* own = flowerOf(fan, netId);
        const auto* seen = flowerOf(watcher, netId);
        return own && seen && own->equippedSkinId == kFanSkinId &&
               seen->equippedSkinId == kFanSkinId;
    }));
}

TEST(fan_skin_title_is_above_the_head_for_the_wearer_and_other_players) {
    CHECK(testsupport::fontsReady());
    const std::vector<CustomSkin> catalog{makeFanSkin()};
    for (const bool self : {false, true}) {
        const auto frame = [&](bool fan, double time = 0) {
            auto flower = flowerWearing(fan ? kFanSkinId : "");
            if (self) flower.spawnFlags |= net::SpawnIsSelf;
            WorldView view;
            view.setRealm(Realm::Overworld);
            view.seedForTest(flower);
            WorldRenderer renderer;
            renderer.options.names = false;
            renderer.options.healthBars = false;
            renderer.setSkinCatalog(&catalog);
            Canvas canvas = Canvas::createVirtual(240, 240);
            renderer.draw(canvas, view, testsupport::frameCamera(240, kFlowerAt), kFlowerAt, time);
            return canvas.getImageData(40, 45, 160, 40);
        };
        // The body ends at y=95. This region must contain the title even
        // when the ordinary name/health plate is hidden.
        CHECK(testsupport::differingPixels(frame(true), frame(false)) > 30);
        // This crop contains only the overhead title effects, so the
        // rotating skin cannot make a frozen title effect pass.
        CHECK(testsupport::differingPixels(frame(true, 0), frame(true, 1.4)) > 10);
    }
}

TEST(fan_skin_title_scales_with_the_flowers_drawn_size) {
    CHECK(testsupport::fontsReady());
    const std::vector<CustomSkin> catalog{makeFanSkin()};
    const auto titleWidth = [&](double scale) {
        auto flower = flowerWearing(kFanSkinId);
        flower.spawnFlags |= net::SpawnIsSelf;
        flower.radius *= scale;
        WorldView view;
        view.setRealm(Realm::Overworld);
        view.seedForTest(flower);
        WorldRenderer renderer;
        renderer.setSkinCatalog(&catalog);
        Canvas canvas = Canvas::createVirtual(420, 420);
        renderer.draw(canvas, view, testsupport::frameCamera(420, kFlowerAt), kFlowerAt, 0.7);
        // Only pixels above the drawn body's edge, excluding the skin itself.
        const int height = static_cast<int>(210 - 25 * scale - 5);
        const auto pixels = canvas.getImageData(0, 0, 420, height);
        int left = 420, right = -1;
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < 420; ++x) {
                const auto p = static_cast<std::size_t>((y * 420 + x) * 4);
                if (pixels[p] > 80 && pixels[p + 1] > 40) {
                    left = std::min(left, x);
                    right = std::max(right, x);
                }
            }
        }
        return right - left + 1;
    };
    const int normal = titleWidth(1.0);
    const int doubled = titleWidth(2.0);
    CHECK(normal > 50);
    CHECK(doubled > normal * 1.7);
    CHECK(doubled < normal * 2.3);
}

TEST(signature_skin_is_owner_only_even_for_modified_clients_and_stale_saved_equips) {
    using namespace flix::testsupport;
    Harness h("signature-exclusive",[](const std::string& path){
        seedUser(path,"a19kisme","hunter2!");seedUser(path,"watcher","hunter2!",true);
        Database db;std::string error;CHECK(db.load(path,error));auto skin=makeSignatureSkin();skin.createdAt=1234;
        db.rawTable("customSkins")[skin.id]=skinToJson(skin);
        db.progress(db.findUser("watcher")->id).equippedSkinId=skin.id;
        db.markDirty();CHECK(db.save());
    },dataDir(),0);CHECK(h.ready);if(!h.ready)return;
    const auto& db=h.server.database();const auto watcherId=db.findUser("watcher")->id;
    CHECK(db.findProgress(watcherId)->equippedSkinId.empty());
    NetClient owner,watcher;CHECK(loginAs(h,watcher,"watcher","hunter2!"));CHECK(loginAs(h,owner,"a19kisme","hunter2!"));
    CHECK(watcher.findSkin(kSignatureSkinId)); // Everyone still receives the artwork.
    const auto before=watcher.chat().size();watcher.equipSkin(kSignatureSkinId);
    CHECK(h.stepUntil({&owner,&watcher},[&]{return watcher.chat().size()>before;}));
    CHECK(db.findProgress(watcherId)->equippedSkinId.empty());CHECK(watcher.equippedSkinId().empty());
    owner.equipSkin(kSignatureSkinId);CHECK(h.stepUntil({&owner},[&]{return db.findProgress(db.findUser("a19kisme")->id)->equippedSkinId==kSignatureSkinId;}));
    CHECK(canEquipSignatureSkin(kSignatureSkinId,"A19KIsMe"));CHECK(!canEquipSignatureSkin(kSignatureSkinId,"watcher"));CHECK(canEquipSignatureSkin("ordinary_skin","watcher"));
}
