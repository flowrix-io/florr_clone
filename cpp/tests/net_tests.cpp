#include "test.h"

#include "shared/net/bytebuffer.h"
#include "shared/net/protocol.h"
#include "shared/net/transport.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <string>
#include <vector>

using namespace flr;
using namespace flr::net;

// ---------------------------------------------------------------------------
// ByteWriter / ByteReader
// ---------------------------------------------------------------------------

TEST(bytebuffer_round_trips_every_scalar) {
    ByteWriter w;
    w.u8(0xAB);
    w.i8(-42);
    w.u16(0xBEEF);
    w.i16(-12345);
    w.u32(0xDEADBEEF);
    w.i32(-2000000000);
    w.u64(0x0123456789ABCDEFull);
    w.i64(-9000000000000LL);
    w.f32(1.5f);
    w.f64(-2.25);
    w.boolean(true);
    w.boolean(false);
    w.str("hello \xC3\xA9 world");

    ByteReader r(w.data(), w.size());
    CHECK_EQ(r.u8(), std::uint8_t(0xAB));
    CHECK_EQ(r.i8(), std::int8_t(-42));
    CHECK_EQ(r.u16(), std::uint16_t(0xBEEF));
    CHECK_EQ(r.i16(), std::int16_t(-12345));
    CHECK_EQ(r.u32(), std::uint32_t(0xDEADBEEF));
    CHECK_EQ(r.i32(), std::int32_t(-2000000000));
    CHECK_EQ(r.u64(), std::uint64_t(0x0123456789ABCDEFull));
    CHECK_EQ(r.i64(), std::int64_t(-9000000000000LL));
    CHECK_NEAR(r.f32(), 1.5, 1e-9);
    CHECK_NEAR(r.f64(), -2.25, 1e-12);
    CHECK_EQ(r.boolean(), true);
    CHECK_EQ(r.boolean(), false);
    CHECK_EQ(r.str(), std::string("hello \xC3\xA9 world"));
    CHECK(r.ok());
    CHECK_EQ(r.remaining(), std::size_t(0));
}

TEST(reading_past_the_end_fails_softly) {
    ByteWriter w;
    w.u16(7);
    ByteReader r(w.data(), w.size());
    CHECK_EQ(r.u16(), std::uint16_t(7));
    CHECK(r.ok());
    // Past the end: zeroes, a sticky failure flag, and no out-of-bounds read.
    CHECK_EQ(r.u32(), std::uint32_t(0));
    CHECK(!r.ok());
    CHECK_EQ(r.str(), std::string());
    CHECK_EQ(r.remaining(), std::size_t(0));
}

TEST(truncated_string_length_does_not_overrun) {
    ByteWriter w;
    w.u16(5000);          // claims 5000 bytes follow
    w.raw("abc", 3);      // but only 3 do
    ByteReader r(w.data(), w.size());
    CHECK_EQ(r.str(), std::string());
    CHECK(!r.ok());
}

TEST(quantised_angles_survive_the_round_trip) {
    for (int i = -720; i <= 720; i += 7) {
        const double radians = i * kPi / 180.0;
        ByteWriter w;
        w.angle(radians);
        ByteReader r(w.data(), w.size());
        const double back = r.angle();
        // One step is tau/65536; allow two for the rounding at each end.
        CHECK_NEAR(std::fabs(wrapAngle(back - radians)), 0.0, 2.0 * kTau / 65536.0);
    }
}

TEST(unit_ratios_clamp_and_round_trip) {
    ByteWriter w;
    w.unitByte(0.0); w.unitByte(1.0); w.unitByte(0.5);
    w.unitByte(-3.0); w.unitByte(9.0);       // out of range must clamp
    w.unitShort(0.3333);
    ByteReader r(w.data(), w.size());
    CHECK_NEAR(r.unitByte(), 0.0, 1e-9);
    CHECK_NEAR(r.unitByte(), 1.0, 1e-9);
    CHECK_NEAR(r.unitByte(), 0.5, 1.0 / 255.0);
    CHECK_NEAR(r.unitByte(), 0.0, 1e-9);
    CHECK_NEAR(r.unitByte(), 1.0, 1e-9);
    CHECK_NEAR(r.unitShort(), 0.3333, 1.0 / 65535.0);
}

TEST(positions_keep_sub_pixel_accuracy_at_the_world_edge) {
    ByteWriter w;
    w.position({59999.75, -59999.75});
    ByteReader r(w.data(), w.size());
    const Vec2 back = r.position();
    // f32 resolves to ~0.004 at 60k, far under a drawn pixel.
    CHECK_NEAR(back.x, 59999.75, 0.01);
    CHECK_NEAR(back.y, -59999.75, 0.01);
}

TEST(reserved_counts_can_be_patched_after_the_fact) {
    ByteWriter w;
    const std::size_t countAt = w.reserveU16();
    std::uint16_t written = 0;
    for (int i = 0; i < 5; ++i) { w.u32(static_cast<std::uint32_t>(i)); ++written; }
    w.patchU16(countAt, written);

    ByteReader r(w.data(), w.size());
    CHECK_EQ(r.u16(), std::uint16_t(5));
    for (int i = 0; i < 5; ++i) CHECK_EQ(r.u32(), std::uint32_t(i));
    CHECK(r.ok());
}

TEST(input_frames_round_trip_through_the_wire) {
    InputFrame sent;
    sent.sequence = 123456;
    sent.moveAngle = 1.234;
    sent.moveStrength = 0.75;
    sent.aimAngle = -2.5;
    sent.flags = InputAttack;

    ByteWriter w;
    sent.write(w);
    ByteReader r(w.data(), w.size());
    const InputFrame got = InputFrame::read(r);

    CHECK_EQ(got.sequence, sent.sequence);
    CHECK_NEAR(std::fabs(wrapAngle(got.moveAngle - sent.moveAngle)), 0.0, 1e-3);
    CHECK_NEAR(got.moveStrength, sent.moveStrength, 1.0 / 255.0);
    CHECK_NEAR(std::fabs(wrapAngle(got.aimAngle - sent.aimAngle)), 0.0, 1e-3);
    CHECK(got.attacking());
    CHECK(!got.defending());
    CHECK(r.ok());
}

TEST(content_hash_detects_a_changed_config) {
    const std::uint32_t a = contentHash("{\"bee\":{\"damage\":50}}");
    const std::uint32_t b = contentHash("{\"bee\":{\"damage\":51}}");
    CHECK(a != b);
    CHECK_EQ(a, contentHash("{\"bee\":{\"damage\":50}}"));
    // Chaining lets several files fold into one handshake value.
    CHECK(contentHash("second", a) != contentHash("second"));
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

namespace {

struct Recorder : TransportHandler {
    std::vector<std::string> connects;
    std::vector<std::string> messages;
    std::vector<std::string> disconnects;
    std::vector<ConnectionId> ids;

    void onConnect(Connection& c) override {
        connects.push_back(c.peer());
        ids.push_back(c.id());
    }
    void onMessage(Connection& c, ByteReader& r) override {
        messages.push_back(r.str());
    }
    void onDisconnect(Connection& c, const std::string& reason) override {
        disconnects.push_back(reason);
    }
};

ByteWriter textFrame(const std::string& s) {
    ByteWriter w;
    w.str(s);
    return w;
}

/// Pumps both ends until `done` holds or the budget runs out. Returns whether
/// the condition was reached, so a hung test fails rather than blocking CI.
template <class F>
bool pump(Listener& server, Recorder& serverSide, Dialer& client, Recorder& clientSide, F done) {
    for (int i = 0; i < 400; ++i) {
        server.poll(serverSide, 2);
        client.poll(clientSide, 2);
        server.flush();
        client.flush();
        if (done()) return true;
    }
    return false;
}

/// Binds an ephemeral port by trying a range; a fixed port would collide with
/// a previous run's socket still in TIME_WAIT.
bool startOnFreePort(Listener& listener, std::uint16_t& portOut) {
    std::string error;
    for (std::uint16_t port = 47800; port < 47860; ++port) {
        if (listener.start(port, error)) { portOut = port; return true; }
    }
    return false;
}

} // namespace

TEST(transport_delivers_messages_both_directions) {
    Listener server;
    std::uint16_t port = 0;
    if (!startOnFreePort(server, port)) { CHECK(false); return; }

    Recorder serverSide, clientSide;
    Dialer client;
    std::string error;
    CHECK(client.connect("127.0.0.1", port, error));

    CHECK(pump(server, serverSide, client, clientSide,
               [&] { return client.connected() && serverSide.connects.size() == 1; }));

    client.send(textFrame("hello from client"));
    CHECK(pump(server, serverSide, client, clientSide,
               [&] { return serverSide.messages.size() == 1; }));
    CHECK_EQ(serverSide.messages[0], std::string("hello from client"));

    server.each([](Connection& c) { c.send(textFrame("hello from server")); });
    CHECK(pump(server, serverSide, client, clientSide,
               [&] { return clientSide.messages.size() == 1; }));
    CHECK_EQ(clientSide.messages[0], std::string("hello from server"));
}

TEST(transport_preserves_message_boundaries_under_batching) {
    Listener server;
    std::uint16_t port = 0;
    if (!startOnFreePort(server, port)) { CHECK(false); return; }

    Recorder serverSide, clientSide;
    Dialer client;
    std::string error;
    CHECK(client.connect("127.0.0.1", port, error));
    CHECK(pump(server, serverSide, client, clientSide, [&] { return client.connected(); }));

    // Queue many frames at once: they coalesce into one TCP write, and the
    // reader must still split them back into exactly the frames that went in.
    const int kCount = 500;
    for (int i = 0; i < kCount; ++i) client.send(textFrame("msg-" + std::to_string(i)));

    CHECK(pump(server, serverSide, client, clientSide,
               [&] { return serverSide.messages.size() >= std::size_t(kCount); }));
    CHECK_EQ(serverSide.messages.size(), std::size_t(kCount));
    for (int i = 0; i < kCount; ++i) {
        CHECK_EQ(serverSide.messages[static_cast<std::size_t>(i)], "msg-" + std::to_string(i));
    }
}

TEST(transport_reassembles_a_frame_split_across_reads) {
    Listener server;
    std::uint16_t port = 0;
    if (!startOnFreePort(server, port)) { CHECK(false); return; }

    Recorder serverSide, clientSide;
    Dialer client;
    std::string error;
    CHECK(client.connect("127.0.0.1", port, error));
    CHECK(pump(server, serverSide, client, clientSide, [&] { return client.connected(); }));

    // Far larger than one read chunk, so it necessarily arrives in pieces.
    const std::string big(300 * 1024, 'x');
    client.send(textFrame(big.substr(0, 60000)));

    CHECK(pump(server, serverSide, client, clientSide,
               [&] { return serverSide.messages.size() == 1; }));
    CHECK_EQ(serverSide.messages[0].size(), std::size_t(60000));
}

TEST(transport_reports_disconnect_when_the_peer_goes_away) {
    Listener server;
    std::uint16_t port = 0;
    if (!startOnFreePort(server, port)) { CHECK(false); return; }

    Recorder serverSide, clientSide;
    {
        Dialer client;
        std::string error;
        CHECK(client.connect("127.0.0.1", port, error));
        CHECK(pump(server, serverSide, client, clientSide,
                   [&] { return serverSide.connects.size() == 1; }));
    }   // client destructor closes the socket

    for (int i = 0; i < 200 && serverSide.disconnects.empty(); ++i) server.poll(serverSide, 2);
    CHECK_EQ(serverSide.disconnects.size(), std::size_t(1));
    CHECK_EQ(server.connectionCount(), std::size_t(0));
}

TEST(dialer_fails_cleanly_against_a_dead_port) {
    Recorder clientSide;
    Dialer client;
    std::string error;
    // Nothing is listening here; the connect must resolve to Failed rather
    // than hanging the caller's frame loop.
    client.connect("127.0.0.1", 47999, error);
    for (int i = 0; i < 200 && client.state() == Dialer::State::Connecting; ++i) {
        client.poll(clientSide, 2);
    }
    CHECK(client.state() != Dialer::State::Connected);
    CHECK(!client.connected());
}

TEST(oversized_length_prefix_is_refused) {
    Listener server;
    std::uint16_t port = 0;
    if (!startOnFreePort(server, port)) { CHECK(false); return; }

    Recorder serverSide;

    // A raw socket, so the bogus framing goes on the wire verbatim rather than
    // being produced by our own (correct) writer.
    const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    CHECK(fd >= 0);
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    ::inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
    CHECK(::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof addr) == 0);

    for (int i = 0; i < 50 && serverSide.connects.empty(); ++i) server.poll(serverSide, 2);
    CHECK_EQ(serverSide.connects.size(), std::size_t(1));

    // Claim a gigabyte. The server must drop the connection rather than
    // reserve the memory, and must never surface it as a message.
    const std::uint32_t bogus = 0x40000000u;
    CHECK(::send(fd, &bogus, sizeof bogus, 0) == static_cast<ssize_t>(sizeof bogus));

    for (int i = 0; i < 300 && serverSide.disconnects.empty(); ++i) server.poll(serverSide, 2);
    CHECK_EQ(serverSide.disconnects.size(), std::size_t(1));
    CHECK(serverSide.messages.empty());
    CHECK_EQ(server.connectionCount(), std::size_t(0));
    ::close(fd);
}
