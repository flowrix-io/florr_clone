#include "test.h"

#include "shared/core/json.h"
#include "shared/core/types.h"
#include "shared/core/world.h"

#include <string>

using namespace flr;

// --- components used only by these tests ------------------------------------
namespace {
struct TPosition { Vec2 value; };
struct TVelocity { Vec2 value; };
struct THealth { double hp = 0; };
struct TLabel { std::string text; };   // non-trivial: exercises the move paths
struct TFrozen {};                     // tag
} // namespace
FLR_COMPONENT(TPosition);
FLR_COMPONENT(TVelocity);
FLR_COMPONENT(THealth);
FLR_COMPONENT(TLabel);
FLR_COMPONENT(TFrozen);

// ---------------------------------------------------------------------------
// ECS
// ---------------------------------------------------------------------------

TEST(entity_handles_pack_index_and_generation) {
    const Entity e = makeEntity(12345, 7);
    CHECK_EQ(entityIndex(e), 12345u);
    CHECK_EQ(entityGeneration(e), 7u);
    CHECK(e != NULL_ENTITY);
    CHECK_EQ(makeEntity(0, 0), NULL_ENTITY);
}

TEST(create_and_destroy_tracks_liveness) {
    World w;
    CHECK_EQ(w.size(), std::size_t(0));
    const Entity a = w.create();
    const Entity b = w.create();
    CHECK(w.isAlive(a));
    CHECK(w.isAlive(b));
    CHECK_EQ(w.size(), std::size_t(2));
    CHECK(a != b);
    CHECK(a != NULL_ENTITY);

    CHECK(w.destroy(a));
    CHECK(!w.isAlive(a));
    CHECK(w.isAlive(b));
    CHECK_EQ(w.size(), std::size_t(1));
    CHECK(!w.destroy(a));      // already dead
    CHECK(!w.isAlive(NULL_ENTITY));
}

TEST(recycled_slot_invalidates_the_old_handle) {
    World w;
    const Entity first = w.create();
    w.destroy(first);
    const Entity second = w.create();
    // The slot is reused, so the raw index matches...
    CHECK_EQ(entityIndex(first), entityIndex(second));
    // ...but the generation bump makes the stale handle report dead.
    CHECK(!w.isAlive(first));
    CHECK(w.isAlive(second));
    CHECK(first != second);
}

TEST(components_add_read_and_remove) {
    World w;
    const Entity e = w.create();
    CHECK(!w.has<TPosition>(e));
    CHECK(w.tryGet<TPosition>(e) == nullptr);

    w.add<TPosition>(e, TPosition{{10, 20}});
    CHECK(w.has<TPosition>(e));
    CHECK_NEAR(w.get<TPosition>(e).value.x, 10, 1e-12);
    CHECK_NEAR(w.get<TPosition>(e).value.y, 20, 1e-12);

    w.add<TVelocity>(e, TVelocity{{1, 2}});
    // Adding a second component moves the entity to a new archetype; the
    // first must survive the relocation with its value intact.
    CHECK_NEAR(w.get<TPosition>(e).value.x, 10, 1e-12);
    CHECK_NEAR(w.get<TVelocity>(e).value.y, 2, 1e-12);

    w.remove<TPosition>(e);
    CHECK(!w.has<TPosition>(e));
    CHECK(w.has<TVelocity>(e));
    CHECK_NEAR(w.get<TVelocity>(e).value.y, 2, 1e-12);
}

TEST(non_trivial_components_survive_archetype_moves) {
    World w;
    const Entity e = w.create();
    w.add<TLabel>(e, TLabel{"a string long enough to heap-allocate its buffer"});
    for (int i = 0; i < 8; ++i) {
        // Each add/remove pair relocates the TLabel twice.
        w.add<THealth>(e, THealth{static_cast<double>(i)});
        w.remove<THealth>(e);
    }
    CHECK_EQ(w.get<TLabel>(e).text, std::string("a string long enough to heap-allocate its buffer"));
}

TEST(swap_remove_repairs_the_relocated_entity) {
    World w;
    std::vector<Entity> made;
    for (int i = 0; i < 16; ++i) {
        const Entity e = w.create();
        w.add<THealth>(e, THealth{static_cast<double>(i)});
        made.push_back(e);
    }
    // Destroying from the front forces a swap-remove every time: the last row
    // moves into the hole and its owner's stored row must be repaired.
    for (int i = 0; i < 8; ++i) w.destroy(made[static_cast<std::size_t>(i)]);
    for (int i = 8; i < 16; ++i) {
        const Entity e = made[static_cast<std::size_t>(i)];
        CHECK(w.isAlive(e));
        CHECK_NEAR(w.get<THealth>(e).hp, i, 1e-12);
    }
}

TEST(query_matches_supersets_and_honours_exclusions) {
    World w;
    const Entity mover = w.create();
    w.add<TPosition>(mover); w.add<TVelocity>(mover);
    const Entity frozen = w.create();
    w.add<TPosition>(frozen); w.add<TVelocity>(frozen); w.add<TFrozen>(frozen);
    const Entity still = w.create();
    w.add<TPosition>(still);

    Query<TPosition, TVelocity> all{w};
    CHECK_EQ(all.count(), std::size_t(2));

    Query<TPosition, TVelocity> unfrozen{w};
    unfrozen.without<TFrozen>();
    CHECK_EQ(unfrozen.count(), std::size_t(1));
    CHECK_EQ(unfrozen.first(), mover);

    Query<TPosition> positions{w};
    CHECK_EQ(positions.count(), std::size_t(3));
}

TEST(query_refreshes_when_new_archetypes_appear) {
    World w;
    Query<TPosition> q{w};
    CHECK_EQ(q.count(), std::size_t(0));

    const Entity a = w.create();
    w.add<TPosition>(a);
    CHECK_EQ(q.count(), std::size_t(1));

    // A brand-new archetype (TPosition+THealth) must be picked up by the query
    // that was already built and cached.
    const Entity b = w.create();
    w.add<TPosition>(b); w.add<THealth>(b);
    CHECK_EQ(q.count(), std::size_t(2));
}

TEST(query_each_writes_through_to_storage) {
    World w;
    for (int i = 0; i < 32; ++i) {
        const Entity e = w.create();
        w.add<TPosition>(e, TPosition{{static_cast<double>(i), 0}});
        w.add<TVelocity>(e, TVelocity{{2, 3}});
    }
    Query<TPosition, TVelocity> q{w};
    q.each([](Entity, TPosition& p, TVelocity& v) { p.value += v.value; });

    double sumX = 0;
    q.each([&](Entity, TPosition& p, TVelocity&) { sumX += p.value.x; sumX += 0; });
    // 0..31 summed is 496, plus 2 added to each of 32 entities.
    CHECK_NEAR(sumX, 496 + 64, 1e-9);
}

TEST(chunks_expose_contiguous_columns) {
    World w;
    for (int i = 0; i < 10; ++i) {
        const Entity e = w.create();
        w.add<THealth>(e, THealth{1.0});
    }
    std::size_t seen = 0;
    Query<THealth> q{w};
    q.chunks([&](std::size_t n, const Entity* ents, THealth* hp) {
        for (std::size_t i = 0; i < n; ++i) {
            CHECK(ents[i] != NULL_ENTITY);
            hp[i].hp += 1.0;
        }
        seen += n;
    });
    CHECK_EQ(seen, std::size_t(10));
    q.each([](Entity, THealth& h) { CHECK_NEAR(h.hp, 2.0, 1e-12); });
}

TEST(names_bind_and_are_dropped_on_destroy) {
    World w;
    const Entity e = w.create();
    w.bindName(e, "socket-42");
    CHECK_EQ(w.lookup("socket-42"), e);
    CHECK(w.nameOf(e) != nullptr);
    CHECK_EQ(*w.nameOf(e), std::string("socket-42"));

    w.destroy(e);
    CHECK_EQ(w.lookup("socket-42"), NULL_ENTITY);

    // Rebinding a name to a different entity releases the old mapping.
    const Entity a = w.create();
    const Entity b = w.create();
    w.bindName(a, "dup");
    w.bindName(b, "dup");
    CHECK_EQ(w.lookup("dup"), b);
    CHECK(w.nameOf(a) == nullptr || w.nameOf(a)->empty());
}

TEST(command_buffer_defers_structural_change) {
    World w;
    std::vector<Entity> made;
    for (int i = 0; i < 4; ++i) {
        const Entity e = w.create();
        w.add<THealth>(e, THealth{static_cast<double>(i)});
        made.push_back(e);
    }

    CommandBuffer cmd{w};
    Query<THealth> q{w};
    // Destroying inside the loop would reallocate the column being walked.
    q.each([&](Entity e, THealth& h) {
        if (h.hp < 2) cmd.destroy(e);
        else cmd.addComponent(e, TFrozen{});
    });
    CHECK_EQ(w.size(), std::size_t(4));   // nothing has happened yet
    cmd.flush();
    CHECK_EQ(w.size(), std::size_t(2));
    CHECK(!w.isAlive(made[0]));
    CHECK(w.has<TFrozen>(made[2]));
}

TEST(command_buffer_drains_cascading_work) {
    World w;
    CommandBuffer cmd{w};
    // A command that enqueues another command must still run in this flush,
    // so a "mob dies -> drops loot" chain never straddles a tick boundary.
    cmd.defer([&cmd](World& world) {
        const Entity dropped = world.create();
        world.add<THealth>(dropped, THealth{99});
        cmd.defer([dropped](World& w2) { w2.add<TFrozen>(dropped); });
    });
    cmd.flush();
    CHECK(cmd.empty());
    Query<THealth, TFrozen> q{w};
    CHECK_EQ(q.count(), std::size_t(1));
}

TEST(world_version_tracks_only_structural_change) {
    World w;
    const std::uint64_t start = w.version();
    const Entity e = w.create();
    CHECK(w.version() > start);
    const std::uint64_t afterCreate = w.version();
    w.add<THealth>(e, THealth{1});
    // add/remove move the entity between archetypes but cannot change which
    // entities exist, so a cached view keyed on version stays valid.
    CHECK_EQ(w.version(), afterCreate);
    w.destroy(e);
    CHECK(w.version() > afterCreate);
}

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

TEST(vec2_normalizes_without_nan_at_zero) {
    const Vec2 zero = Vec2{0, 0}.normalized();
    CHECK_NEAR(zero.x, 0, 1e-12);
    CHECK_NEAR(zero.y, 0, 1e-12);
    const Vec2 unit = Vec2{3, 4}.normalized();
    CHECK_NEAR(unit.length(), 1.0, 1e-12);
}

TEST(clamped_length_leaves_short_vectors_alone) {
    const Vec2 shortV = Vec2{1, 0}.clampedLength(5);
    CHECK_NEAR(shortV.x, 1, 1e-12);
    const Vec2 longV = Vec2{30, 40}.clampedLength(5);
    CHECK_NEAR(longV.length(), 5, 1e-12);
    CHECK_NEAR(longV.x, 3, 1e-12);
}

TEST(angle_wrapping_takes_the_short_way_round) {
    CHECK_NEAR(wrapAngle(kPi * 3), kPi, 1e-9);
    // 179 -> -179 degrees is a 2 degree turn, not 358.
    const double d = angleDelta(179.0 * kPi / 180.0, -179.0 * kPi / 180.0);
    CHECK_NEAR(d * 180.0 / kPi, 2.0, 1e-9);
    CHECK_NEAR(lerpAngle(0, kTau - 0.2, 0.5), -0.1, 1e-9);
}

TEST(rng_is_deterministic_and_in_range) {
    Rng a{1234}, b{1234};
    for (int i = 0; i < 64; ++i) CHECK_EQ(a.next(), b.next());

    Rng r{99};
    for (int i = 0; i < 4096; ++i) {
        const double u = r.unit();
        CHECK(u >= 0.0 && u < 1.0);
        const std::uint32_t n = r.below(7);
        CHECK(n < 7u);
        CHECK(r.insideCircle(10.0).length() <= 10.0 + 1e-9);
    }
    // A zero bound must not divide by zero.
    CHECK_EQ(r.below(0), 0u);
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

TEST(json_parses_scalars_and_nesting) {
    Json j;
    std::string err;
    CHECK(Json::parse(R"({"a":1,"b":[true,null,"x"],"c":{"d":-2.5}})", j, err));
    CHECK(j.isObject());
    CHECK_EQ(j["a"].asInt(), 1);
    CHECK_EQ(j["b"].size(), std::size_t(3));
    CHECK_EQ(j["b"][0].asBool(), true);
    CHECK(j["b"][1].isNull());
    CHECK_EQ(j["b"][2].asString(), std::string("x"));
    CHECK_NEAR(j["c"]["d"].asDouble(), -2.5, 1e-12);
}

TEST(json_missing_keys_read_as_null_not_a_crash) {
    const Json j = Json::parseOrNull(R"({"users":{}})");
    // Chained reads on a partial document must degrade to defaults.
    CHECK(j["users"]["nobody"]["admin"].isNull());
    CHECK_EQ(j["users"]["nobody"]["admin"].asBool(), false);
    CHECK_EQ(j["missing"].asInt(42), 42);
    CHECK_EQ(j["missing"].asString("fallback"), std::string("fallback"));
}

TEST(json_object_keys_keep_insertion_order) {
    Json j = Json::object();
    j["zebra"] = 1;
    j["apple"] = 2;
    j["mango"] = 3;
    const auto& keys = j.keys();
    CHECK_EQ(keys.size(), std::size_t(3));
    CHECK_EQ(keys[0], std::string("zebra"));
    CHECK_EQ(keys[1], std::string("apple"));
    CHECK_EQ(keys[2], std::string("mango"));
    // ...and the writer must emit them in that order, so a database round trip
    // does not reshuffle the file under version control.
    CHECK_EQ(j.dump(), std::string(R"({"zebra":1,"apple":2,"mango":3})"));
}

TEST(json_round_trips_through_dump_and_parse) {
    const std::string source =
        R"({"players":{"u1":{"totalXP":125000,"stars":3,"loadout":[{"type":"basic","rarity":"common"},null]}},)"
        R"("users":{"bob":{"id":"u1","admin":true,"password":"$2b$12$abcdefghijklmnopqrstuv"}}})";
    Json a = Json::parseOrNull(source);
    Json b = Json::parseOrNull(a.dump());
    CHECK_EQ(a.dump(), b.dump());
    CHECK_EQ(b["players"]["u1"]["totalXP"].asInt64(), std::int64_t(125000));
    CHECK(b["players"]["u1"]["loadout"][1].isNull());
    CHECK_EQ(b["users"]["bob"]["password"].asString(),
             std::string("$2b$12$abcdefghijklmnopqrstuv"));
}

TEST(json_writes_integers_without_a_decimal_tail) {
    Json j = Json::object();
    j["xp"] = 125000;
    j["ratio"] = 0.5;
    j["big"] = static_cast<long long>(1758000000000LL);   // a ms timestamp
    CHECK_EQ(j.dump(), std::string(R"({"xp":125000,"ratio":0.5,"big":1758000000000})"));
}

TEST(json_escapes_and_unescapes_text) {
    Json j = Json::object();
    j["name"] = std::string("quote\" back\\slash\nnewline\ttab");
    const std::string dumped = j.dump();
    const Json back = Json::parseOrNull(dumped);
    CHECK_EQ(back["name"].asString(), j["name"].asString());

    // Unicode escapes, including a surrogate pair, must decode to UTF-8.
    const Json uni = Json::parseOrNull(R"({"s":"é😀"})");
    CHECK_EQ(uni["s"].asString(), std::string("\xC3\xA9\xF0\x9F\x98\x80"));
}

TEST(json_rejects_malformed_input_without_clobbering_the_target) {
    Json target = Json::parseOrNull(R"({"keep":"me"})");
    std::string err;
    CHECK(!Json::parse("{\"a\":", target, err));
    CHECK(!err.empty());
    // A failed parse must leave the caller's existing document intact — the
    // database loader depends on this to refuse writes rather than lose data.
    CHECK_EQ(target["keep"].asString(), std::string("me"));

    CHECK(!Json::parse("{} trailing", target, err));
    CHECK(!Json::parse("[1,2", target, err));
    CHECK(!Json::parse("", target, err));
}

TEST(json_pretty_printing_is_reparseable) {
    const Json j = Json::parseOrNull(R"({"a":[1,2,{"b":null}],"c":{}})");
    const std::string pretty = j.dump(2);
    CHECK(pretty.find('\n') != std::string::npos);
    CHECK_EQ(Json::parseOrNull(pretty).dump(), j.dump());
}

// ---------------------------------------------------------------------------
// Game constants and components
// ---------------------------------------------------------------------------

#include "shared/game/components.h"
#include "shared/game/rarity.h"

TEST(rarity_round_trips_through_its_name) {
    for (int i = 0; i < kRarityCount; ++i) {
        const Rarity r = static_cast<Rarity>(i);
        CHECK_EQ(parseRarity(rarityName(r)), r);
    }
    // Unknown text degrades to common rather than failing a load.
    CHECK_EQ(parseRarity("nonsense"), Rarity::Common);
    CHECK_EQ(parseRarity(""), Rarity::Common);
}

TEST(rarity_steps_clamp_at_both_ends) {
    CHECK_EQ(downgradeRarity(Rarity::Common), Rarity::Common);
    CHECK_EQ(upgradeRarity(Rarity::Apex), Rarity::Apex);
    CHECK_EQ(upgradeRarity(Rarity::Common), Rarity::Uncommon);
    CHECK_EQ(downgradeRarity(Rarity::Apex), Rarity::Unique);
    CHECK_EQ(clampRarity(-5), Rarity::Common);
    CHECK_EQ(clampRarity(999), Rarity::Apex);
}

TEST(rarity_scaling_is_monotonic) {
    for (int i = 1; i < kRarityCount; ++i) {
        CHECK(kMobHealthScale[i] > kMobHealthScale[i - 1]);
        CHECK(kMobDamageScale[i] > kMobDamageScale[i - 1]);
        CHECK(kMobSizeScale[i] > kMobSizeScale[i - 1]);
        CHECK(petalStatScale(static_cast<Rarity>(i)) > petalStatScale(static_cast<Rarity>(i - 1)));
        CHECK(petalHealScale(static_cast<Rarity>(i)) > petalHealScale(static_cast<Rarity>(i - 1)));
    }
    // Healing softens above mythic instead of continuing to triple.
    const double mythic = petalHealScale(Rarity::Mythic);
    CHECK_NEAR(petalHealScale(Rarity::Ultra) / mythic, std::sqrt(3.0), 1e-9);
    CHECK_NEAR(petalStatScale(Rarity::Ultra) / petalStatScale(Rarity::Mythic), 3.0, 1e-9);
    // Modifiers stay linear, 1x to 4x across common..unique.
    CHECK_NEAR(petalModifierScale(Rarity::Common), 1.0, 1e-9);
    CHECK_NEAR(petalModifierScale(Rarity::Unique), 4.0, 1e-9);
}

TEST(craft_and_drop_odds_stay_in_range) {
    for (int i = 0; i < kRarityCount; ++i) {
        const Rarity r = static_cast<Rarity>(i);
        const double craft = craftSuccessChance(r);
        CHECK(craft > 0.0 && craft <= 0.64);
        const double up = dropUpgradeChance(r);
        CHECK(up >= 0.0 && up < 1.0);
        const double down = dropDowngradeChance(r);
        CHECK(down >= 0.0 && down < 1.0);
    }
    CHECK_NEAR(dropUpgradeChance(Rarity::Apex), 0.0, 1e-12);
    CHECK_NEAR(dropDowngradeChance(Rarity::Common), 0.0, 1e-12);
    // Crafting gets harder, never easier, as tiers climb.
    for (int i = 1; i < kRarityCount; ++i) {
        CHECK(craftSuccessChance(static_cast<Rarity>(i)) <
              craftSuccessChance(static_cast<Rarity>(i - 1)));
    }
}

TEST(stall_power_never_exceeds_full) {
    CHECK_NEAR(stallPower(Rarity::Rare, Rarity::Rare), 1.0, 1e-12);
    // Out-rareing the target buys reliability, not a stronger slow.
    CHECK_NEAR(stallPower(Rarity::Apex, Rarity::Common), 1.0, 1e-12);
    CHECK_NEAR(stallPower(Rarity::Common, Rarity::Uncommon), 1.0 / 3.0, 1e-12);
    CHECK(stallPower(Rarity::Common, Rarity::Mythic) < 0.01);
}

TEST(level_curve_is_consistent_with_its_inverse) {
    double total = 0;
    for (int level = 1; level < 60; ++level) {
        const LevelProgress at = levelFromTotalXp(total);
        CHECK_EQ(at.level, level);
        CHECK_NEAR(at.xpIntoLevel, 0.0, 1e-6);
        // One XP short of the threshold must still be the previous level.
        const LevelProgress justUnder = levelFromTotalXp(total + xpForNextLevel(level) - 1.0);
        CHECK_EQ(justUnder.level, level);
        total += xpForNextLevel(level);
    }
    CHECK_EQ(levelFromTotalXp(0).level, 1);
    CHECK_EQ(levelFromTotalXp(-100).level, 1);
    // The curve must terminate rather than loop at an absurd total.
    CHECK_EQ(levelFromTotalXp(1e300).level, kMaxLevel);
}

TEST(derived_player_stats_grow_with_level) {
    CHECK_NEAR(maxHealthForLevel(1), kPlayerBaseHealth, 1e-9);
    CHECK_NEAR(bodyDamageForLevel(1), kPlayerBaseDamage, 1e-9);
    CHECK(maxHealthForLevel(30) > maxHealthForLevel(29));
    CHECK(playerRadiusForLevel(50) > playerRadiusForLevel(1));
    // Growth is gentle: a level-100 flower is not a wall.
    CHECK(playerRadiusForLevel(100) < kPlayerBaseRadius * 1.5);
}

TEST(movement_converges_to_the_requested_velocity) {
    MoveState state;
    const Vec2 target{kPlayerMaxSpeed, 0};
    for (int i = 0; i < 200; ++i) integrateVelocity(state, target, net::kTickSeconds);
    CHECK_NEAR(state.velocity.x, kPlayerMaxSpeed, 0.5);
    CHECK_NEAR(state.velocity.y, 0.0, 1e-9);

    // Releasing input decays back toward rest rather than stopping dead.
    for (int i = 0; i < 200; ++i) integrateVelocity(state, {0, 0}, net::kTickSeconds);
    CHECK_NEAR(state.velocity.length(), 0.0, 0.5);
}

TEST(movement_is_frame_rate_independent) {
    // One big step and many small ones covering the same time must agree,
    // or a high-refresh client would out-accelerate a low-refresh one.
    MoveState coarse, fine;
    const Vec2 target{kPlayerMaxSpeed, 0};
    for (int i = 0; i < 10; ++i) integrateVelocity(coarse, target, 0.1);
    for (int i = 0; i < 100; ++i) integrateVelocity(fine, target, 0.01);
    CHECK_NEAR(coarse.velocity.x, fine.velocity.x, 1.0);
}

TEST(cursor_distance_maps_to_speed_linearly_then_caps) {
    CHECK_NEAR(desiredVelocity(Vec2{0, 0}, kPlayerMaxSpeed).length(), 0.0, 1e-9);
    // Half the full-speed distance is half speed.
    CHECK_NEAR(desiredVelocity(Vec2{kFullSpeedCursorDistance / 2, 0}, kPlayerMaxSpeed).length(),
               kPlayerMaxSpeed / 2, 1e-6);
    // Beyond it, capped -- throwing the cursor further does not go faster.
    CHECK_NEAR(desiredVelocity(Vec2{kFullSpeedCursorDistance * 10, 0}, kPlayerMaxSpeed).length(),
               kPlayerMaxSpeed, 1e-6);
    // The quantised wire form agrees with the cursor form.
    CHECK_NEAR(desiredVelocity(0.0, 1.0, kPlayerMaxSpeed).x, kPlayerMaxSpeed, 1e-9);
    CHECK_NEAR(desiredVelocity(0.0, 0.0, kPlayerMaxSpeed).length(), 0.0, 1e-12);
}

TEST(sections_tile_the_world_and_reject_outside) {
    CHECK_EQ(sectionAt({1, 1}), 0);
    CHECK_EQ(sectionAt({kWorldSize - 1, kWorldSize - 1}), kSectionCount - 1);
    CHECK_EQ(sectionAt({kSectionSize * 1.5, kSectionSize * 0.5}), 1);
    CHECK_EQ(sectionAt({-1, 10}), -1);
    CHECK_EQ(sectionAt({10, kWorldSize + 1}), -1);
}

TEST(hit_cooldowns_gate_repeat_damage_and_prune) {
    HitCooldowns cd;
    const Entity victim = makeEntity(5, 0);
    CHECK(cd.ready(victim, 1000));
    cd.arm(victim, 1500);
    CHECK(!cd.ready(victim, 1000));
    CHECK(cd.ready(victim, 1500));
    // A different victim is unaffected by the first one's cooldown.
    CHECK(cd.ready(makeEntity(6, 0), 1000));
    // Re-arming updates in place rather than growing the list.
    cd.arm(victim, 2000);
    CHECK_EQ(cd.entries.size(), std::size_t(1));
    CHECK(!cd.ready(victim, 1900));
    // Pruning drops what has expired, so a long-lived petal does not carry
    // every mob it has ever grazed.
    cd.arm(makeEntity(7, 0), 900);
    CHECK_EQ(cd.entries.size(), std::size_t(2));
    cd.prune(1000);
    CHECK_EQ(cd.entries.size(), std::size_t(1));
}

TEST(bounty_credits_accumulate_per_player) {
    Bounty b;
    const Entity a = makeEntity(1, 0), c = makeEntity(2, 0);
    b.credit(a, 10);
    b.credit(c, 5);
    b.credit(a, 7);
    CHECK_EQ(b.contributors.size(), std::size_t(2));
    CHECK_NEAR(b.contributors[0].damage, 17.0, 1e-9);
    CHECK_NEAR(b.contributors[1].damage, 5.0, 1e-9);
}

TEST(components_can_all_be_attached_to_one_world) {
    // Registering every component type and exercising an archetype move over
    // the non-trivial ones catches a missing FLR_COMPONENT or a component that
    // is not default-constructible.
    World w;
    const Entity e = w.create();
    w.add<Transform>(e, Transform{{100, 200}, 1.0});
    w.add<Motion>(e);
    w.add<Body>(e);
    w.add<Health>(e, Health{50, 100, 0, 0});
    w.add<Faction>(e);
    w.add<PlayerTag>(e);
    w.add<PlayerAccount>(e, PlayerAccount{"u1", "bob", 7, false});
    w.add<Loadout>(e);
    w.add<PetalRing>(e);
    w.add<PlayerInput>(e);
    w.add<PlayerProgress>(e);
    w.add<PlayerModifiers>(e);
    w.add<PlayerLocation>(e);
    w.add<HitCooldowns>(e);
    w.add<Bounty>(e);
    w.add<NetId>(e, NetId{42});
    w.add<Replicated>(e);

    CHECK_EQ(w.get<PlayerAccount>(e).username, std::string("bob"));
    CHECK_NEAR(w.get<Transform>(e).position.x, 100.0, 1e-12);
    CHECK_NEAR(w.get<Health>(e).fraction(), 0.5, 1e-12);
    CHECK_EQ(w.get<NetId>(e).value, std::uint32_t(42));

    // Adding one more component relocates every one of the above.
    w.add<Afflictions>(e);
    CHECK_EQ(w.get<PlayerAccount>(e).username, std::string("bob"));
    CHECK_EQ(w.get<NetId>(e).value, std::uint32_t(42));

    const Entity mob = w.create();
    w.add<MobTag>(mob);
    w.add<MobType>(mob);
    w.add<MobAi>(mob);
    w.add<ContactDamage>(mob);
    w.add<Spawner>(mob);
    w.add<BodySegment>(mob);
    const Entity drop = w.create();
    w.add<DropTag>(drop);
    w.add<DropItem>(drop);
    const Entity shot = w.create();
    w.add<ProjectileTag>(shot);
    w.add<Projectile>(shot);
    w.add<Lifetime>(shot);
    const Entity fx = w.create();
    w.add<GroundEffectTag>(fx);
    w.add<GroundEffect>(fx);
    const Entity petal = w.create();
    w.add<PetalTag>(petal);
    w.add<PetalInstance>(petal);
    w.add<Pet>(petal);
    w.add<Knockback>(petal);
    w.add<Dead>(petal);

    CHECK(w.size() >= 5);
    CHECK(componentCount() > 20);
}

// --- a component whose defaults are not all zero -----------------------------
namespace {
struct Defaults {
    double scale = 1.0;
    int count = 7;
    bool enabled = true;
    std::uint16_t sentinel = 0xFFFF;
};
} // namespace
FLR_COMPONENT(Defaults);

TEST(components_keep_their_in_class_initialisers) {
    // Zeroing a trivially-copyable component instead of constructing it looks
    // like a harmless optimisation and silently discards every default. A
    // `speedScale = 1.0` arriving as 0.0 makes a system multiply by nothing.
    World w;
    const Entity e = w.create();
    w.add<Defaults>(e);
    CHECK_NEAR(w.get<Defaults>(e).scale, 1.0, 1e-12);
    CHECK_EQ(w.get<Defaults>(e).count, 7);
    CHECK_EQ(w.get<Defaults>(e).enabled, true);
    CHECK_EQ(w.get<Defaults>(e).sentinel, std::uint16_t(0xFFFF));

    // Also after an archetype move, and in a recycled row.
    w.add<THealth>(e, THealth{5});
    CHECK_NEAR(w.get<Defaults>(e).scale, 1.0, 1e-12);
    CHECK_EQ(w.get<Defaults>(e).sentinel, std::uint16_t(0xFFFF));

    w.destroy(e);
    const Entity recycled = w.create();
    w.add<Defaults>(recycled);
    CHECK_NEAR(w.get<Defaults>(recycled).scale, 1.0, 1e-12);
    CHECK_EQ(w.get<Defaults>(recycled).count, 7);
}

TEST(the_games_own_components_arrive_with_their_defaults) {
    World w;
    const Entity e = w.create();
    // These are the ones a system multiplies by; a zeroed default here is an
    // entity that cannot move, cannot be hurt, and has no petals.
    CHECK_NEAR(w.add<PlayerModifiers>(e).speedScale, 1.0, 1e-12);
    CHECK_NEAR(w.get<PlayerModifiers>(e).damageScale, 1.0, 1e-12);
    CHECK_NEAR(w.get<PlayerModifiers>(e).rangeScale, 1.0, 1e-12);
    CHECK_NEAR(w.get<PlayerModifiers>(e).cameraZoom, 1.0, 1e-12);
    CHECK_NEAR(w.get<PlayerModifiers>(e).maxHealthScale, 1.0, 1e-12);
    CHECK_NEAR(w.add<Afflictions>(e).slowFactor, 1.0, 1e-12);
    CHECK_NEAR(w.add<Body>(e).mass, 1.0, 1e-12);
    CHECK(w.get<Body>(e).radius > 0);
    CHECK_NEAR(w.add<GroundEffect>(e).slowFactor, 1.0, 1e-12);

    const Entity p = w.create();
    // An empty loadout slot must read as empty, not as petal index 0.
    CHECK_EQ(w.add<Loadout>(p).slots[0].configIndex, kNoPetal);
    CHECK(w.get<Loadout>(p).slots[3].empty());
}
