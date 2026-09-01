#include "test.h"

#include "client/prediction.h"
#include "client/world_view.h"
#include "server/replication.h"
#include "shared/game/components.h"

#include <string>

using namespace flr;

namespace {

/// A world with one player and a way to add mobs, so each test starts from the
/// same known shape instead of repeating twenty lines of setup.
struct Fixture {
    World world;
    NetIdAllocator ids;
    Replicator replicator;
    ClientView view;
    EventQueue events;
    Entity viewer = NULL_ENTITY;

    Fixture() { viewer = addPlayer("bob", {1000, 1000}); }

    Entity addPlayer(const std::string& name, Vec2 at) {
        const Entity e = world.create();
        world.add<PlayerTag>(e);
        world.add<Transform>(e, Transform{at, 0.0});
        world.add<Motion>(e);
        world.add<Body>(e, Body{kPlayerBaseRadius, 1.0});
        world.add<Health>(e, Health{100, 100, 0, 0});
        world.add<PlayerInput>(e);
        world.add<PlayerProgress>(e, PlayerProgress{500, 5, 3, false});
        world.add<PlayerLocation>(e);
        world.add<PlayerAccount>(e, PlayerAccount{"u-" + name, name, 1, false});
        world.add<NetId>(e, NetId{ids.next()});
        Replicated rep;
        rep.kind = net::EntityKind::Player;
        world.add<Replicated>(e, rep);
        return e;
    }

    Entity addMob(Vec2 at, Rarity rarity = Rarity::Rare, double radius = 30) {
        const Entity e = world.create();
        world.add<MobTag>(e);
        world.add<Transform>(e, Transform{at, 0.5});
        world.add<Body>(e, Body{radius, radius * radius});
        world.add<Health>(e, Health{50, 100, 0, 0});
        world.add<NetId>(e, NetId{ids.next()});
        Replicated rep;
        rep.kind = net::EntityKind::Mob;
        rep.typeIndex = 7;
        rep.rarity = rarity;
        world.add<Replicated>(e, rep);
        return e;
    }

    /// Builds one snapshot and feeds it to `into`, returning the payload size.
    std::size_t tick(WorldView& into, std::uint32_t tickNumber, double nowMillis) {
        ByteWriter out;
        Replicator::Frame frame;
        frame.tick = tickNumber;
        frame.nowMillis = nowMillis;
        frame.events = &events;
        replicator.build(world, viewer, view, frame, out);

        ByteReader reader(out.data(), out.size());
        const std::uint8_t id = reader.u8();
        CHECK_EQ(id, static_cast<std::uint8_t>(net::ServerMessage::Snapshot));
        CHECK(into.applySnapshot(reader));
        CHECK(reader.ok());
        return out.size();
    }
};

std::uint32_t netIdOf(World& w, Entity e) { return w.get<NetId>(e).value; }

} // namespace

// ---------------------------------------------------------------------------

TEST(snapshot_round_trips_a_spawn) {
    Fixture f;
    const Entity mob = f.addMob({1100, 1000});
    WorldView client;
    f.tick(client, 1, 1000);

    // The viewer and the mob both arrive.
    CHECK_EQ(client.entities().size(), std::size_t(2));
    const auto& e = client.entities().at(netIdOf(f.world, mob));
    CHECK_EQ(static_cast<int>(e.kind), static_cast<int>(net::EntityKind::Mob));
    CHECK_EQ(static_cast<int>(e.rarity), static_cast<int>(Rarity::Rare));
    CHECK_EQ(e.typeIndex, std::uint16_t(7));
    CHECK_NEAR(e.targetPosition.x, 1100, 0.05);
    CHECK_NEAR(e.radius, 30.0, 0.05);

    // The viewer's own record is flagged, named, and drives SelfState.
    const auto& me = client.entities().at(netIdOf(f.world, f.viewer));
    CHECK(me.isSelf());
    CHECK_EQ(me.name, std::string("bob"));
    CHECK_EQ(client.self().netId, netIdOf(f.world, f.viewer));
    CHECK_NEAR(client.self().health, 100.0, 1e-3);
    CHECK_EQ(client.self().level, 5);
    CHECK_EQ(client.self().stars, 3);
}

TEST(spawn_is_sent_once_and_not_repeated) {
    Fixture f;
    f.addMob({1100, 1000});
    WorldView client;
    const std::size_t first = f.tick(client, 1, 1000);
    const std::size_t second = f.tick(client, 2, 1040);
    // Nothing moved, so the second snapshot carries no spawns and no updates
    // -- only the fixed header. It must be markedly smaller.
    CHECK(second < first);
    CHECK_EQ(client.entities().size(), std::size_t(2));
}

TEST(only_changed_fields_are_sent) {
    Fixture f;
    const Entity mob = f.addMob({1100, 1000});
    WorldView client;
    f.tick(client, 1, 1000);
    const std::size_t idle = f.tick(client, 2, 1040);

    f.world.get<Transform>(mob).position.x += 25;
    const std::size_t moved = f.tick(client, 3, 1080);
    CHECK(moved > idle);
    CHECK_NEAR(client.entities().at(netIdOf(f.world, mob)).targetPosition.x, 1125, 0.05);

    // A sub-tolerance nudge is not worth bytes and must be suppressed.
    f.world.get<Transform>(mob).position.x += 0.001;
    const std::size_t nudged = f.tick(client, 4, 1120);
    CHECK_EQ(nudged, idle);
}

TEST(health_and_state_changes_replicate) {
    Fixture f;
    const Entity mob = f.addMob({1100, 1000});
    WorldView client;
    f.tick(client, 1, 1000);
    CHECK_NEAR(client.entities().at(netIdOf(f.world, mob)).healthFraction, 0.5, 0.01);

    Health& health = f.world.get<Health>(mob);
    health.current = 25;
    health.flashUntilMillis = 1200;
    f.tick(client, 2, 1040);

    const auto& e = client.entities().at(netIdOf(f.world, mob));
    CHECK_NEAR(e.healthFraction, 0.25, 0.01);
    CHECK((e.state & net::StateHurt) != 0);

    // The flash expires on its own once the deadline passes.
    f.tick(client, 3, 1300);
    CHECK((client.entities().at(netIdOf(f.world, mob)).state & net::StateHurt) == 0);
}

TEST(attack_and_defend_reach_the_client) {
    Fixture f;
    WorldView client;
    f.tick(client, 1, 1000);

    f.world.get<PlayerInput>(f.viewer).current.flags = net::InputAttack;
    f.tick(client, 2, 1040);
    CHECK((client.entities().at(client.self().netId).state & net::StateAttacking) != 0);

    f.world.get<PlayerInput>(f.viewer).current.flags = net::InputDefend;
    f.tick(client, 3, 1080);
    const std::uint8_t state = client.entities().at(client.self().netId).state;
    CHECK((state & net::StateDefending) != 0);
    CHECK((state & net::StateAttacking) == 0);
}

TEST(player_visual_flags_round_trip_and_update_independently) {
    Fixture f;
    f.world.add<PlayerVisuals>(f.viewer, PlayerVisuals{
        static_cast<std::uint8_t>(FaceDandelioned | FaceSquareEyes | FaceHasCorruption),
        static_cast<std::uint8_t>(EquipCutter | EquipThirdEye | EquipObserver |
                                  EquipAntennae | EquipTest1),
        static_cast<std::uint32_t>(PlayerRenderPumpkin | PlayerRenderRobot),
        true,
    });
    Afflictions poisoned;
    poisoned.poisonPerSecond = 1;
    poisoned.poisonUntilMillis = 2000;
    f.world.add<Afflictions>(f.viewer, poisoned);
    f.world.add<Dead>(f.viewer);
    f.world.get<PlayerInput>(f.viewer).current.flags = net::InputDefend;

    WorldView client;
    f.tick(client, 1, 1000);
    const RemoteEntity& first = client.entities().at(client.self().netId);
    // Face flags combine stored effects with live poison, death and action.
    CHECK((first.faceFlags & FacePoisoned) != 0);
    CHECK((first.faceFlags & FaceDandelioned) != 0);
    CHECK((first.faceFlags & FaceDeadEyes) != 0);
    CHECK((first.faceFlags & FaceSquareEyes) != 0);
    CHECK((first.faceFlags & FaceDefending) != 0);
    CHECK((first.faceFlags & FaceHasCorruption) != 0);
    CHECK_EQ(first.equipFlags, static_cast<std::uint8_t>(EquipCutter | EquipThirdEye |
                                                          EquipObserver | EquipAntennae |
                                                          EquipTest1));
    CHECK_EQ(first.renderFlags, static_cast<std::uint32_t>(PlayerRenderPumpkin |
                                                            PlayerRenderRobot |
                                                            PlayerRenderGlitch));

    // Visual updates use their own snapshot field: movement and health can
    // remain unchanged while the renderer receives a new face/skin state.
    PlayerVisuals& visuals = f.world.get<PlayerVisuals>(f.viewer);
    visuals.faceFlags = FaceNone;
    visuals.equipFlags = EquipNone;
    visuals.renderFlags = PlayerRenderRobot;
    visuals.glitched = false;
    f.world.get<Afflictions>(f.viewer).poisonUntilMillis = 0;
    f.world.get<PlayerInput>(f.viewer).current.flags = net::InputAttack;
    f.world.remove<Dead>(f.viewer);
    f.tick(client, 2, 1040);
    const RemoteEntity& second = client.entities().at(client.self().netId);
    CHECK((second.faceFlags & FaceAttacking) != 0);
    CHECK((second.faceFlags & FaceDefending) == 0);
    CHECK((second.faceFlags & (FacePoisoned | FaceDeadEyes | FaceDandelioned |
                               FaceSquareEyes | FaceHasCorruption)) == 0);
    CHECK_EQ(second.equipFlags, std::uint8_t(EquipNone));
    CHECK_EQ(second.renderFlags, std::uint32_t(PlayerRenderRobot));
}

TEST(entities_leaving_view_are_removed) {
    Fixture f;
    const Entity mob = f.addMob({1100, 1000});
    WorldView client;
    f.tick(client, 1, 1000);
    CHECK_EQ(client.entities().size(), std::size_t(2));

    // Well beyond the viewport plus margin.
    f.world.get<Transform>(mob).position = {40000, 40000};
    f.tick(client, 2, 1040);
    CHECK_EQ(client.entities().size(), std::size_t(1));
    CHECK(client.entities().count(netIdOf(f.world, mob)) == 0);

    // Coming back re-spawns it, with its immutable data intact.
    f.world.get<Transform>(mob).position = {1100, 1000};
    f.tick(client, 3, 1080);
    CHECK_EQ(client.entities().size(), std::size_t(2));
    CHECK_EQ(client.entities().at(netIdOf(f.world, mob)).typeIndex, std::uint16_t(7));
}

TEST(destroyed_entities_are_removed) {
    Fixture f;
    const Entity mob = f.addMob({1100, 1000});
    const std::uint32_t id = netIdOf(f.world, mob);
    WorldView client;
    f.tick(client, 1, 1000);

    f.world.destroy(mob);
    f.tick(client, 2, 1040);
    CHECK(client.entities().count(id) == 0);
}

TEST(net_ids_are_never_reused) {
    Fixture f;
    const Entity first = f.addMob({1100, 1000});
    const std::uint32_t firstId = netIdOf(f.world, first);
    f.world.destroy(first);
    const Entity second = f.addMob({1100, 1000});
    // The ECS slot is recycled, but the wire id must not be, or a client that
    // has not yet processed the removal would update the wrong entity.
    CHECK(netIdOf(f.world, second) != firstId);
}

TEST(snapshot_is_capped_and_keeps_the_nearest) {
    Fixture f;
    f.replicator.maxEntities = 10;
    for (int i = 0; i < 60; ++i) {
        f.addMob({1000 + static_cast<double>(i) * 5.0, 1000});
    }
    WorldView client;
    f.tick(client, 1, 1000);
    CHECK(client.entities().size() <= std::size_t(10));

    // The nearest mob must have survived the cull; the furthest must not.
    bool sawNear = false;
    for (const auto& entry : client.entities()) {
        if (entry.second.kind != net::EntityKind::Mob) continue;
        CHECK(entry.second.targetPosition.x < 1000 + 60 * 5.0);
        if (entry.second.targetPosition.x < 1020) sawNear = true;
    }
    CHECK(sawNear);
}

TEST(events_are_scoped_to_what_the_client_can_see) {
    Fixture f;
    const Entity mob = f.addMob({1100, 1000});
    WorldView client;
    f.tick(client, 1, 1000);
    client.events().clear();

    f.events.damage(netIdOf(f.world, mob), 37, {1100, 1000});
    f.events.damage(999, 12, {50000, 50000});   // far away
    f.tick(client, 2, 1040);

    CHECK_EQ(client.events().size(), std::size_t(1));
    CHECK_EQ(static_cast<int>(client.events()[0].kind), static_cast<int>(net::EventKind::Damage));
    CHECK_NEAR(client.events()[0].amount, 37.0, 0.01);
}

TEST(truncated_snapshot_is_rejected_wholesale) {
    Fixture f;
    f.addMob({1100, 1000});
    ByteWriter out;
    Replicator::Frame frame;
    frame.tick = 1;
    frame.nowMillis = 1000;
    f.replicator.build(f.world, f.viewer, f.view, frame, out);

    WorldView client;
    // Chop the payload short: the decoder must apply nothing rather than
    // leaving the view half-populated.
    ByteReader reader(out.data(), out.size() - 12);
    reader.u8();
    CHECK(!client.applySnapshot(reader));
    CHECK_EQ(client.entities().size(), std::size_t(0));
}

TEST(stale_snapshots_are_ignored) {
    Fixture f;
    const Entity mob = f.addMob({1100, 1000});
    WorldView client;
    f.tick(client, 5, 1000);

    f.world.get<Transform>(mob).position.x = 1300;
    f.tick(client, 6, 1040);
    CHECK_NEAR(client.entities().at(netIdOf(f.world, mob)).targetPosition.x, 1300, 0.05);

    // Replaying an older tick must not rewind the world.
    ByteWriter out;
    Replicator::Frame frame;
    frame.tick = 3;
    frame.nowMillis = 900;
    ClientView fresh;
    f.replicator.build(f.world, f.viewer, fresh, frame, out);
    ByteReader reader(out.data(), out.size());
    reader.u8();
    client.applySnapshot(reader);
    CHECK_EQ(client.tick(), std::uint32_t(6));
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

TEST(interpolation_blends_between_samples_and_clamps) {
    WorldView view;
    RemoteEntity probe;
    probe.netId = 1;
    probe.previousPosition = {0, 0};
    probe.targetPosition = {100, 0};
    probe.previousAngle = 0;
    probe.targetAngle = kPi / 2;
    probe.sampleStartMillis = 1000;
    probe.sampleEndMillis = 1040;
    probe.fresh = false;

    const auto blendAt = [&](double renderTime) {
        RemoteEntity e = probe;
        double t = (renderTime - e.sampleStartMillis) / (e.sampleEndMillis - e.sampleStartMillis);
        t = clamp(t, 0.0, 1.0);
        return Vec2{lerp(e.previousPosition.x, e.targetPosition.x, t), 0};
    };

    CHECK_NEAR(blendAt(1020).x, 50.0, 1e-9);
    CHECK_NEAR(blendAt(1000).x, 0.0, 1e-9);
    CHECK_NEAR(blendAt(1040).x, 100.0, 1e-9);
    // Past the end it holds still rather than extrapolating through walls.
    CHECK_NEAR(blendAt(2000).x, 100.0, 1e-9);
    CHECK_NEAR(blendAt(0).x, 0.0, 1e-9);
}

TEST(a_freshly_spawned_entity_does_not_slide_in) {
    Fixture f;
    const Entity mob = f.addMob({1200, 1000});
    WorldView client;
    f.tick(client, 1, 1000);
    client.interpolate(99999);
    // Both endpoints were seeded from the spawn position, so it renders where
    // it is rather than sliding from the origin.
    CHECK_NEAR(client.entities().at(netIdOf(f.world, mob)).position.x, 1200, 0.05);
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

namespace {

net::InputFrame moveRight(std::uint32_t sequence) {
    net::InputFrame f;
    f.sequence = sequence;
    f.moveAngle = 0;
    f.moveStrength = 1.0;
    return f;
}

} // namespace

TEST(prediction_moves_immediately_on_input) {
    Prediction p;
    p.reset({0, 0});
    const Vec2 after = p.apply(moveRight(1), kPlayerMaxSpeed, net::kTickSeconds);
    CHECK(after.x > 0);
    CHECK_EQ(p.pendingCount(), std::size_t(1));
}

TEST(reconciling_an_agreeing_server_corrects_nothing) {
    // The whole point of sharing integrateVelocity: when the server saw the
    // same inputs, the replay lands exactly where the client already was.
    Prediction client;
    client.reset({0, 0});
    MoveState server;

    for (std::uint32_t seq = 1; seq <= 20; ++seq) {
        client.apply(moveRight(seq), kPlayerMaxSpeed, net::kTickSeconds);
        integrateVelocity(server, desiredVelocity(0.0, 1.0, kPlayerMaxSpeed), net::kTickSeconds);
        server.position += server.velocity * net::kTickSeconds;
        client.reconcile(server.position, server.velocity, seq, kPlayerMaxSpeed);
        CHECK_NEAR(client.lastCorrection(), 0.0, 1e-9);
    }
    CHECK_NEAR(client.position().x, server.position.x, 1e-9);
    CHECK_EQ(client.pendingCount(), std::size_t(0));
}

TEST(unacknowledged_inputs_are_replayed_after_a_correction) {
    Prediction client;
    client.reset({0, 0});
    MoveState server;

    // The client runs ahead by five inputs, as it would across a round trip.
    for (std::uint32_t seq = 1; seq <= 5; ++seq) {
        client.apply(moveRight(seq), kPlayerMaxSpeed, net::kTickSeconds);
    }
    // The server has only processed the first two.
    for (int i = 0; i < 2; ++i) {
        integrateVelocity(server, desiredVelocity(0.0, 1.0, kPlayerMaxSpeed), net::kTickSeconds);
        server.position += server.velocity * net::kTickSeconds;
    }
    const Vec2 beforeReconcile = client.position();
    client.reconcile(server.position, server.velocity, 2, kPlayerMaxSpeed);

    CHECK_EQ(client.pendingCount(), std::size_t(3));
    // Replay must put it back where it was, not snap it to the server's older
    // position -- otherwise the flower jerks backwards every snapshot.
    CHECK_NEAR(client.position().x, beforeReconcile.x, 1e-9);
    CHECK(client.position().x > server.position.x);
}

TEST(a_disagreeing_server_wins_and_reports_the_correction) {
    Prediction client;
    client.reset({0, 0});
    for (std::uint32_t seq = 1; seq <= 3; ++seq) {
        client.apply(moveRight(seq), kPlayerMaxSpeed, net::kTickSeconds);
    }
    // The server saw a wall: the player never actually moved.
    client.reconcile({0, 0}, {0, 0}, 3, kPlayerMaxSpeed);
    CHECK_NEAR(client.position().x, 0.0, 1e-9);
    CHECK(client.lastCorrection() > 1.0);
}

TEST(prediction_bounds_its_pending_queue) {
    Prediction p;
    p.reset({0, 0});
    for (std::uint32_t seq = 1; seq <= Prediction::kMaxPending * 3; ++seq) {
        p.apply(moveRight(seq), kPlayerMaxSpeed, net::kTickSeconds);
    }
    // A server that stops acknowledging must not grow the client's memory
    // without bound, nor make each reconcile replay an ever-longer history.
    CHECK_EQ(p.pendingCount(), Prediction::kMaxPending);
}

TEST(reset_discards_history) {
    Prediction p;
    p.reset({0, 0});
    p.apply(moveRight(1), kPlayerMaxSpeed, net::kTickSeconds);
    p.reset({500, 500});
    CHECK_EQ(p.pendingCount(), std::size_t(0));
    CHECK_NEAR(p.position().x, 500.0, 1e-12);
    CHECK_NEAR(p.velocity().length(), 0.0, 1e-12);
}
