// The skin being made in the studio, across a page load: what the draft file
// keeps, when it is written, and how an edit of a published skin finds that
// skin again on a connection that has not been sent it.

#include "test.h"

#include "client/net_client.h"
#include "client/ui/menus.h"
#include "client/ui/skin_draft.h"
#include "server/db.h"
#include "server_harness.h"
#include "shared/core/file.h"
#include "shared/game/skin_format.h"
#include "test_data.h"

#include <cstdio>
#include <string>
#include <vector>

using namespace flix;
using flix::testsupport::Harness;
using flix::testsupport::loginAs;

namespace {

std::string tempPath(const char* name) {
    return testsupport::tempDir("flix_skin_draft_tests") + "/" + name;
}

/// One of each shape, with values off every default.
std::vector<SkinShape> everyShape() {
    std::vector<SkinShape> out;
    for (int t = 0; t <= static_cast<int>(SkinShapeType::Curve); ++t) {
        SkinShape s;
        s.t = static_cast<SkinShapeType>(t);
        s.x = 1.25 + t;
        s.y = -2.5;
        s.rot = 30;
        s.fill = "#3a86ff";
        s.stroke = "#111111";
        s.sw = 1.5;
        if (s.t == SkinShapeType::Circle) s.r = 9.125;
        if (s.t == SkinShapeType::Ellipse || s.t == SkinShapeType::Rect) { s.rx = 7; s.ry = 3; }
        if (s.t == SkinShapeType::Line || s.t == SkinShapeType::Curve) { s.x2 = 11; s.y2 = 12; }
        if (s.t == SkinShapeType::Curve) { s.cx1 = 1; s.cy1 = 2; s.cx2 = 3; s.cy2 = 4; }
        if (s.t == SkinShapeType::Polygon) s.points = {0, -12, 11, 8, -11, 8};
        out.push_back(s);
    }
    return out;
}

} // namespace

TEST(a_skin_draft_reads_back_as_it_was_written) {
    SkinDraft draft;
    draft.shapes = everyShape();
    draft.name = "half made";
    draft.selected = 3;
    draft.editingId = "sk_red";
    draft.asideShapes = starterSkinShapes();
    draft.asideName = "set aside";
    draft.textMode = true;
    draft.text = "# a comment \"quoted\"\ncircle x=1 r=";

    SkinDraft back;
    CHECK(parseSkinDraft(skinDraftText(draft), back));
    CHECK_EQ(back.name, draft.name);
    CHECK_EQ(back.selected, 3);
    CHECK_EQ(back.editingId, draft.editingId);
    CHECK_EQ(back.asideName, draft.asideName);
    CHECK(back.textMode);
    CHECK_EQ(back.text, draft.text);
    CHECK_EQ(back.shapes.size(), draft.shapes.size());
    CHECK_EQ(back.asideShapes.size(), draft.asideShapes.size());
    // Every shape's every field, as one comparison.
    CHECK_EQ(skinDraftText(back), skinDraftText(draft));
    CHECK(back.shapes[0].r == 9.125);
}

TEST(a_skin_draft_keeps_a_shape_with_no_colour_colourless) {
    SkinShape bare;
    bare.r = 10;
    SkinDraft draft;
    draft.shapes = {bare};
    SkinDraft back;
    CHECK(parseSkinDraft(skinDraftText(draft), back));
    CHECK_EQ(back.shapes.size(), std::size_t(1));
    CHECK(back.shapes[0].fill.empty() && back.shapes[0].stroke.empty());
}

TEST(an_empty_board_is_a_draft_and_a_damaged_file_is_not) {
    SkinDraft draft;
    draft.name = "nothing yet";
    SkinDraft back;
    back.name = "kept";
    for (const char* bad : {"", "{", "[]", "null", "{\"name\":\"x\"}"}) {
        CHECK(!parseSkinDraft(bad, back));
        CHECK_EQ(back.name, std::string("kept"));
    }
    CHECK(parseSkinDraft(skinDraftText(draft), back));
    CHECK(back.shapes.empty());
    CHECK_EQ(back.selected, -1);

    // An edited file cannot point the selection or a shape out of range.
    CHECK(parseSkinDraft("{\"selected\":99,\"shapes\":[{\"t\":\"circle\",\"r\":1e9},"
                         "{\"t\":\"blob\"}]}", back));
    CHECK_EQ(back.shapes.size(), std::size_t(1));
    CHECK_EQ(back.selected, 0);
    CHECK(back.shapes[0].r <= kSkinRadiusLimit);
}

TEST(the_studio_writes_its_draft_only_when_it_changed) {
    const std::string path = tempPath("draft");
    std::remove(path.c_str());
    SkinsPanel::loadDraft(path);
    SkinsPanel::saveDraft();
    std::string text;
    // Nothing drawn, nothing written: another tab's draft would be lost to it.
    CHECK(!readFile(path, text));

    SkinDraft draft;
    draft.shapes = everyShape();
    draft.name = "half made";
    draft.selected = 2;
    CHECK(writeSkinDraftFile(path, skinDraftText(draft)));
    SkinsPanel::loadDraft(path);

    // Loaded and untouched, it leaves what another tab has written since...
    CHECK(writeSkinDraftFile(path, "theirs"));
    SkinsPanel::saveDraft();
    CHECK(readFile(path, text));
    CHECK_EQ(text, std::string("theirs"));

    // The panel is one per process: hand it back without a file to write.
    SkinsPanel::loadDraft({});
}

TEST(a_client_that_was_never_sent_a_skin_asks_for_it_and_learns_whether_it_exists) {
    const auto seed = [](const std::string& path) {
        Database db;
        std::string error;
        db.load(path, error);
        db.setPasswordCost(4);
        db.createUser("artist", "hunter2!");
        CustomSkin skin;
        skin.id = "sk_red";
        skin.name = "sk_red";
        skin.author = "artist";
        skin.createdAt = 100;
        SkinShape disc;
        disc.r = 20;
        disc.fill = "#d01c1d";
        skin.shapes = {disc};
        db.rawTable("customSkins")["sk_red"] = skinToJson(skin);
        db.markDirty();
        db.save();
    };
    Harness h("skin-draft", seed, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient artist;
    // Before the sign-in there is nobody to ask, and not knowing is not Gone.
    CHECK(artist.requireSkin("sk_red") == NetClient::SkinPresence::Unknown);
    CHECK(loginAs(h, artist, "artist", "hunter2!"));
    CHECK(artist.findSkin("sk_red") == nullptr);
    CHECK(artist.requireSkin("sk_red") == NetClient::SkinPresence::Unknown);
    CHECK(h.stepUntil({&artist}, [&] {
        return artist.requireSkin("sk_red") == NetClient::SkinPresence::Held;
    }));
    CHECK(artist.findSkin("sk_red") != nullptr);

    CHECK(h.stepUntil({&artist}, [&] {
        return artist.requireSkin("sk_none") == NetClient::SkinPresence::Gone;
    }));
}
