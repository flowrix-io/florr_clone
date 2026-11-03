// Editing a published skin: who may, what an edit keeps, and which designs
// it is refused on.
//
// An edit replaces a skin's name and shapes under the id it already has, so
// these cases read the copy another client is sent and the row the save will
// write, and check that the votes and stars on the voters' rows still point
// at it.

#include "test.h"

#include "client/net_client.h"
#include "server/db.h"
#include "server_harness.h"
#include "shared/game/skin_format.h"
#include "shared/game/skin_likeness.h"

#include <string>
#include <vector>

using namespace flix;
using flix::testsupport::Harness;
using flix::testsupport::loginAs;
using flix::testsupport::loginNew;
using flix::testsupport::sawText;
using flix::testsupport::sawTextSince;

namespace {

/// A plain disc, told apart from the others by its colour and size.
std::vector<SkinShape> disc(const char* fill, double r = 20) {
    SkinShape body;
    body.t = SkinShapeType::Circle;
    body.r = r;
    body.fill = fill;
    return {body};
}

CustomSkin stored(const char* id, const char* author, const char* fill, double createdAt) {
    CustomSkin skin;
    skin.id = id;
    skin.name = id;
    skin.author = author;
    skin.createdAt = createdAt;
    skin.shapes = disc(fill);
    return skin;
}

/// `artist` (password hunter2!) with two skins, and `fan`, who likes and
/// starred the red one.
void seedCatalog(const std::string& path) {
    Database db;
    std::string error;
    db.load(path, error);
    db.setPasswordCost(4);
    db.createUser("artist", "hunter2!");
    const std::string fan = db.createUser("fan", "hunter2!").account->id;
    db.progress(fan).skinVotes["sk_red"] = SkinVote::Like;
    db.progress(fan).favoriteSkins = {"sk_red"};
    Json& catalog = db.rawTable("customSkins");
    catalog["sk_red"] = skinToJson(stored("sk_red", "artist", "#d01c1d", 100));
    catalog["sk_blue"] = skinToJson(stored("sk_blue", "artist", "#3a86ff", 200));
    db.markDirty();
    db.save();
}

const Json& storedRow(const Harness& h, const char* id) {
    return h.server.database().storedTable("customSkins")[id];
}

/// Sends one edit and steps until the server has answered in the chat. The
/// three seconds first refill what each edit costs of the request budget, so
/// a case can make several in a row without being told to slow down.
bool edit(Harness& h, NetClient& client, const char* id, const char* name,
          const std::vector<SkinShape>& shapes) {
    h.step(static_cast<int>(3 * net::kTicksPerSecond), {&client});
    const std::uint64_t mark = client.chatSequence();
    client.editSkin(id, name, shapes);
    return h.stepUntil({&client}, [&] { return client.chatSequence() != mark; });
}

} // namespace

TEST(an_author_edits_a_skin_in_place_and_it_keeps_its_votes_and_stars) {
    Harness h("skin-edit", seedCatalog, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient artist;
    NetClient fan;
    CHECK(loginAs(h, artist, "artist", "hunter2!"));
    CHECK(loginAs(h, fan, "fan", "hunter2!"));
    CHECK(h.stepUntil({&artist, &fan}, [&] { return fan.findSkin("sk_red") != nullptr; }));

    CHECK(edit(h, artist, "sk_red", "crimson", disc("#2bd14f", 24)));
    CHECK(sawText(artist, "Saved \"crimson\""));
    CHECK(h.stepUntil({&artist, &fan}, [&] {
        const CustomSkin* seen = fan.findSkin("sk_red");
        return seen && seen->name == "crimson";
    }));

    // Everyone's copy is replaced, not joined by a second card.
    const CustomSkin* seen = fan.findSkin("sk_red");
    CHECK_EQ(fan.skinCatalog().size(), std::size_t(2));
    CHECK(seen && seen->shapes.size() == 1 && seen->shapes[0].fill == "#2bd14f");
    CHECK(seen && seen->author == "artist" && seen->createdAt == 100);
    CHECK(seen && seen->editedAt > 0);
    // The tally rides the broadcast, so the like is still counted...
    CHECK(seen && seen->likes == 1);
    // ...and the voter's own standing on it is untouched.
    CHECK(fan.skinVote("sk_red") == SkinVote::Like);
    CHECK(fan.isFavoriteSkin("sk_red"));

    // On disk too, editedAt included, under the same key.
    const Json& row = storedRow(h, "sk_red");
    CHECK_EQ(row["name"].asString(), std::string("crimson"));
    CHECK_EQ(row["shapes"][0]["fill"].asString(), std::string("#2bd14f"));
    CHECK(row["editedAt"].asDouble(0) > 0);
    CHECK_EQ(h.server.database().storedTable("customSkins").keys().size(), std::size_t(2));

    // A second edit moves editedAt on, which is what a baked picture of the
    // first one is keyed on.
    const double first = seen->editedAt;
    CHECK(edit(h, artist, "sk_red", "crimson", disc("#ff9d00", 24)));
    CHECK(h.stepUntil({&artist, &fan}, [&] {
        const CustomSkin* again = fan.findSkin("sk_red");
        return again && again->shapes[0].fill == "#ff9d00";
    }));
    CHECK(fan.findSkin("sk_red")->editedAt > first);
}

TEST(only_the_author_may_edit_and_an_edit_is_checked_as_a_publish_is) {
    Harness h("skin-edit-refused", seedCatalog, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    NetClient artist;
    NetClient fan;
    CHECK(loginAs(h, artist, "artist", "hunter2!"));
    CHECK(loginAs(h, fan, "fan", "hunter2!"));

    CHECK(edit(h, fan, "sk_red", "stolen", disc("#2bd14f")));
    CHECK(sawText(fan, "only edit your own skins"));
    CHECK_EQ(storedRow(h, "sk_red")["name"].asString(), std::string("sk_red"));

    CHECK(edit(h, artist, "sk_gone", "ghost", disc("#2bd14f")));
    CHECK(sawText(artist, "no longer exists"));

    // Redrawn as another skin of theirs: still a copy.
    std::uint64_t mark = artist.chatSequence();
    CHECK(edit(h, artist, "sk_red", "sk_red", disc("#3a86ff")));
    CHECK(sawTextSince(artist, mark, "looks just like your \"sk_blue\""));

    mark = artist.chatSequence();
    CHECK(edit(h, artist, "sk_red", "flower", starterSkinShapes()));
    CHECK(sawTextSince(artist, mark, "That's the starter flower"));

    // But a nudge that still looks like the skin itself is an edit, not a
    // copy of it.
    mark = artist.chatSequence();
    CHECK(edit(h, artist, "sk_red", "sk_red", disc("#d01c1d", 20.5)));
    CHECK(sawTextSince(artist, mark, "Saved \"sk_red\""));

    // And sending it again unchanged saves nothing.
    mark = artist.chatSequence();
    CHECK(edit(h, artist, "sk_red", "sk_red", disc("#d01c1d", 20.5)));
    CHECK(sawTextSince(artist, mark, "has no changes to save"));

    // A rename alone is an edit too.
    mark = artist.chatSequence();
    CHECK(edit(h, artist, "sk_red", "ruby", disc("#d01c1d", 20.5)));
    CHECK(sawTextSince(artist, mark, "Saved \"ruby\""));
    CHECK_EQ(storedRow(h, "sk_red")["name"].asString(), std::string("ruby"));
}

TEST(a_skin_round_trips_its_edit_time_and_an_unedited_one_stores_none) {
    CustomSkin skin = stored("sk_a", "artist", "#d01c1d", 100);
    CHECK(!skinToJson(skin).contains("editedAt"));

    skin.editedAt = 250;
    const CustomSkin back = skinFromJson(skinToJson(skin));
    CHECK_EQ(back.editedAt, 250.0);

    ByteWriter w;
    writeCustomSkin(w, skin);
    ByteReader r(w.buffer());
    CustomSkin wire;
    CHECK(readCustomSkin(r, wire));
    CHECK_EQ(wire.editedAt, 250.0);
    CHECK_EQ(wire.createdAt, 100.0);
}
