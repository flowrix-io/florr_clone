#pragma once
// Length-prefixed message transport over TCP.
//
// One poll() loop drives every connection. At this game's scale -- a few
// hundred sockets on one listener -- poll() costs less than the complexity of
// keeping an epoll and a kqueue path honest, and it is the same code on Linux
// and macOS.
//
// Both sides speak the same framing: [u32 length][payload]. Reads accumulate
// until a whole frame is present; writes queue and drain as the socket allows,
// so a slow client backs up in its own buffer instead of blocking the tick.
//
// There are two backends under all of this, and only the byte movement differs
// -- the framing, the backlog rule and the TransportHandler contract are one
// implementation shared by both:
//
//   native       a TCP socket and poll(), as described above. A socket that
//                opens with an HTTP upgrade instead is a WebSocket
//                (net/websocket.h) carrying the same framing -- the link
//                between two servers of a sharded game, which is always
//                one (Dialer::serverLink); a native client's is plain TCP.
//   emscripten   whatever the JavaScript runtime has, via net/web_channel.h:
//                WebTransport when the runtime and the server both offer it,
//                WebSocket otherwise, and an in-page loopback when the server
//                is in the same page as the client. `fd()` there is a channel
//                handle rather than a descriptor, and poll()'s timeout is
//                ignored, because neither a browser tab nor a Node event loop
//                may be blocked.

#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "shared/net/bytebuffer.h"
#include "shared/net/protocol.h"
#include "shared/net/web_channel.h"

namespace flix::net {

/// One accepted socket and its buffers.
class Connection {
public:
    Connection(int fd, ConnectionId id, std::string peer);
    ~Connection();
    Connection(const Connection&) = delete;
    Connection& operator=(const Connection&) = delete;

    ConnectionId id() const { return id_; }
    const std::string& peer() const { return peer_; }
    /// What the request that opened this connection said about its origin.
    /// Empty but for a WebSocket accepted by the web backend. Client-written:
    /// see clientAddress() (server/account_limits.h) for which parts count.
    const ForwardedHeaders& forwarded() const { return forwarded_; }
    /// The path a WebSocket was opened at ("/ws" for a page, "/link" for the
    /// link between two servers of a sharded game); empty for a connection
    /// that is not one.
    const std::string& path() const { return path_; }
    int fd() const { return fd_; }
    bool open() const { return fd_ >= 0 || sink_ != nullptr; }
    /// True for a connection with no transport of its own: see Listener::adopt.
    bool adopted() const { return sink_ != nullptr; }
    /// The largest frame this end accepts. kMaxFrameBytes for a client; the
    /// link between two servers of a sharded game raises it.
    std::uint32_t maxFrameBytes = kMaxFrameBytes;
    /// Listener::maxPendingBytes for this connection alone, or 0 for the
    /// listener's: the link between two servers, on the game's own port.
    std::size_t maxPendingBytes = 0;

    /// Queues a frame. Never blocks; the bytes leave in later drains.
    void send(const ByteWriter& message);
    void send(const std::byte* data, std::size_t size);

    /// Bytes queued but not yet handed to the kernel. The server drops a
    /// connection whose backlog grows without bound rather than buying memory
    /// on behalf of a client that has stopped reading.
    std::size_t pendingBytes() const { return outbound_.size() - outboundSent_; }

    /// Every byte read off the socket, and every byte handed to it, since it
    /// opened. The two ends of one connection compare these to know whether
    /// anything is still on its way between them: the test harness waits on a
    /// socket only while its peer has written more than it has read.
    std::uint64_t bytesRead() const { return streamRead_; }
    std::uint64_t bytesWritten() const { return streamWritten_; }

    /// Marks the connection for close once its queued bytes have drained, or
    /// once kCloseDrainMillis have passed, whichever is first: a peer that
    /// has stopped reading never drains anything. Nothing it sends from here
    /// on is handed to the handler.
    void closeGracefully();
    bool closing() const { return closing_; }

    /// How long ago the frame being handled arrived: when the bytes that
    /// completed it reached this process, read inside onMessage. The web
    /// backend knows the moment the page or Node took them off the network,
    /// which can be most of a frame before a client's poll reads them; a
    /// socket only knows when they were read, so there it is about zero.
    double frameAgeMillis() const;

private:
    friend class Listener;
    friend class Dialer;

    /// Reads what the socket has. Returns false when the peer hung up or the
    /// connection broke its framing contract.
    bool readAvailable(std::string& errorOut);
    /// Writes what the socket will take. Returns false on a fatal error.
    bool writeAvailable(std::string& errorOut);
    /// Pops one complete frame into `out`. False when none is buffered yet.
    bool nextFrame(std::vector<std::byte>& out);
    /// Bytes the transport itself still holds, on top of what this object has
    /// queued. Zero on a socket, where the kernel's buffer is not ours to see;
    /// the web backend's real backpressure signal.
    std::size_t transportBuffered() const;
    bool wantsWrite() const;
    /// Known to be what it is: plain framing or an open WebSocket, not still
    /// in a handshake. A listener announces a connection (onConnect) once it is.
    bool ready() const;
    /// Drops what has already gone out. Called at the end of every write
    /// drain, by both backends.
    void compactOutbound();
    /// Throws away everything read and not yet framed. What a closing
    /// connection's reads come to: its peer is not listened to any more, and
    /// keeping what it sends would let a socket that never drains buffer
    /// without limit.
    void discardInbound();
    void shutdownNow();
    /// An adopted connection's write drain: every queued frame to the sink.
    void drainToSink();
    /// Records that the connection is dead: a write outside poll() -- a flush
    /// -- found the socket gone, or the peer broke the framing contract. The
    /// descriptor stays open and nothing more is queued or sent; the owner's
    /// next poll() reports it through the handler and only then closes it.
    /// See Listener::flush for why the close may not happen here.
    void markFailed(const std::string& reason);
    bool failed() const { return !failure_.empty(); }

    int fd_;
    ConnectionId id_;
    std::string peer_;
    /// Where an adopted connection's frames go; null for a real one.
    std::function<void(const std::byte*, std::size_t)> sink_;
    ForwardedHeaders forwarded_;
    std::string path_;
    /// Has been handed to the handler (onConnect), so its end is reported.
    bool announced_ = false;
    double acceptedMillis_ = 0;
    bool closing_ = false;
    /// When closeGracefully() was first called, on the transport's steady clock.
    double closingSinceMillis_ = 0;
    /// Why the connection is dead (see markFailed); empty while it is not.
    std::string failure_;

    std::vector<std::byte> inbound_;
    std::size_t inboundConsumed_ = 0;

    /// Records that `bytes` more were read, which arrived at `atMillis`.
    void noteArrival(std::size_t bytes, double atMillis);
    /// When each read's bytes arrived, oldest first, keyed by where they end
    /// in the stream (counted from the first byte ever read, so compacting
    /// `inbound_` moves nothing). Only reads not yet wholly framed are kept.
    struct Arrival {
        std::uint64_t streamEnd = 0;
        double atMillis = 0;
    };
    std::deque<Arrival> arrivals_;
    std::uint64_t streamRead_ = 0;
    std::uint64_t streamFramed_ = 0;
    double frameArrivedMillis_ = 0;

    std::vector<std::byte> outbound_;
    std::size_t outboundSent_ = 0;
    std::uint64_t streamWritten_ = 0;

    /// What the socket itself carries, natively. Raw: the framing above, as it
    /// is. Otherwise a WebSocket around it, or the handshake before one: an
    /// accepted socket is Sniffing until its first bytes say which.
    enum class Wire : std::uint8_t { Raw, Sniffing, ServerHandshake, ClientHandshake, WebSocket };
    Wire wire_ = Wire::Raw;
    /// This end dialled, so it masks what it sends.
    bool wsClient_ = false;
    std::string wsKey_;
    /// Bytes off the socket not yet unwrapped, and bytes for it already wrapped.
    std::vector<std::byte> wireIn_;
    std::vector<std::byte> wireOut_;
    std::size_t wireOutSent_ = 0;
    /// A dialler: starts the upgrade to `path` on a socket that has just connected.
    void beginClientHandshake(const std::string& path);
    /// Unwraps what wireIn_ holds into inbound_ (and answers handshakes, pings
    /// and closes into wireOut_). False when the peer is done or broke the rules.
    bool unwrap(std::string& errorOut);
    /// Wraps what outbound_ holds into wireOut_.
    void wrap();
    bool writeWire(std::string& errorOut);
};

/// Callbacks a transport owner implements. All are invoked from poll().
///
/// Every connection the peer or the network ends -- a hang-up, a reset seen by
/// a read OR by a flush, a refused frame, a backlog -- is reported through
/// onDisconnect exactly once, before its descriptor is closed. The owner's own
/// teardown is the exception: Listener::stop(), Dialer::disconnect() and a
/// Dialer that fails before it was ever announced report nothing, because the
/// owner is the one letting go. An owner keeps
/// per-connection state (the game server keeps a whole session and the flower
/// it steers) and onDisconnect is the only way it learns to let go of it.
struct TransportHandler {
    virtual ~TransportHandler() = default;
    virtual void onConnect(Connection& c) {}
    virtual void onMessage(Connection& c, ByteReader& reader) {}
    virtual void onDisconnect(Connection& c, const std::string& reason) {}
};

/// Accepts connections on a TCP port.
class Listener {
public:
    Listener();
    ~Listener();

    /// Binds and listens. Returns false with `errorOut` set on failure.
    bool start(std::uint16_t port, std::string& errorOut);
    void stop();

    /// Services sockets for up to `timeoutMillis`, dispatching to `handler`.
    /// Returns the number of frames delivered.
    int poll(TransportHandler& handler, int timeoutMillis);

    /// Pushes queued bytes out without waiting for readability. Called at the
    /// end of a tick so a snapshot leaves immediately rather than after the
    /// next poll timeout. A connection whose write fails here is not closed
    /// here: it is reported, and closed, by the next poll().
    void flush();

    /// Adds a connection that has no transport: each frame sent on it is
    /// handed to `sink`, whole, when the listener drains (poll and flush, after
    /// beforeWrite, exactly when a socket's bytes would have left). What the
    /// peer says is delivered by the owner calling its own onMessage. Replaces
    /// any connection already holding `id`, and is announced to nobody:
    /// closing one still reports onDisconnect from poll(). How a server of a
    /// sharded game holds the players whose sockets are the gateway's.
    Connection& adopt(ConnectionId id, std::string peer,
                      std::function<void(const std::byte*, std::size_t)> sink);
    /// An id no accepted connection will have, for adopt().
    ConnectionId reserveId() { return nextId_++; }
    /// Forgets an adopted connection now, undelivered frames and all, without
    /// reporting it: the owner is the one letting go.
    void abandon(ConnectionId id);

    /// Why the port could not be listened on, where that is only known after
    /// start() has returned: Node says so from its event loop. Else empty.
    std::string lateError() const;

    Connection* find(ConnectionId id);
    std::size_t connectionCount() const { return connections_.size(); }

    /// Runs `fn` for every live connection.
    void each(const std::function<void(Connection&)>& fn);

    /// Disconnects `id` after its queued bytes drain.
    void close(ConnectionId id);

    /// A connection queuing more than this is dropped: it has stopped reading,
    /// and buffering a snapshot stream for it costs the server unbounded memory.
    std::size_t maxPendingBytes = 4u << 20;   // 4 MiB

    /// Connection::maxFrameBytes of every connection accepted from here on.
    std::uint32_t maxFrameBytes = kMaxFrameBytes;

    /// Natively: a socket may be a WebSocket (net/websocket.h) rather than the
    /// plain framing -- the link between two servers of a sharded game, at
    /// /link. Each accepted socket is then announced (onConnect) only once its
    /// first bytes have said which, and with its path; one that says nothing
    /// for long is let go of unannounced. Set on the game's own port. The web
    /// backend's sockets are all WebSockets, and this changes nothing there.
    bool webSockets = false;

    /// TLS material for the web backend, set before start(). Both empty means
    /// the conventional pair names are looked for in the working directory;
    /// finding none leaves the listener on plain HTTP and WebSocket only,
    /// because WebTransport is secure-context only and there would be nothing
    /// to offer. Ignored natively, which speaks TCP and does no TLS at all.
    std::string certPath;
    std::string keyPath;

    /// Called before any queued byte is handed to the transport -- in poll()
    /// and in flush() alike -- so the owner can make durable whatever those
    /// bytes are about to tell a peer. The game server writes its database
    /// journal here: a reply announcing a drop must never reach a client ahead
    /// of the record of that drop reaching the disk. Must be cheap when there
    /// is nothing to do; it runs once per connection with bytes to send.
    std::function<void()> beforeWrite;

    /// Address to bind, or empty for every interface. A localhost development
    /// server sets this to 127.0.0.1; production keeps the empty default.
    std::string bindHost;

    /// Directory the web backend serves the client from over the same HTTP(S)
    /// listener: the web build's own files, by name, and nothing else in it
    /// (see web::listen). Empty means the directory the program was loaded
    /// from, which is where the client build sits. Ignored natively, which
    /// serves no files at all.
    std::string webRoot;

private:
    void acceptPending(TransportHandler& handler);
    void drop(Connection& c, TransportHandler& handler, const std::string& reason);
    /// Drops, through drop(), every connection a flush() found dead since the
    /// last poll, so the handler hears of each one. Run first thing in both
    /// backends' poll().
    void dropFailed(TransportHandler& handler);
    /// The adopted connections' half of a poll: drained, and dropped once
    /// closing. They have no descriptor for poll() to wait on.
    void pollAdopted(TransportHandler& handler);
    void sweepClosed();
    /// Everything that happens to one connection once the transport says it
    /// may read and/or write: the write drain, the read, the frame loop, and
    /// the three conditions that end a connection. Returns false when the
    /// connection should be dropped, with `error` saying why.
    ///
    /// Shared by both backends deliberately. They differ in how they learn a
    /// connection is ready -- poll() revents against a JavaScript queue -- and
    /// in nothing else; a copy of these rules per backend is how they would
    /// come to differ in more.
    bool service(Connection& c, bool readable, bool writable, TransportHandler& handler,
                 int& delivered, std::string& error);

    int listenFd_ = -1;
    ConnectionId nextId_ = 1;
    std::vector<std::unique_ptr<Connection>> connections_;
    std::vector<std::byte> frameScratch_;
};

/// The client end: one outgoing connection.
class Dialer {
public:
    Dialer();
    ~Dialer();

    enum class State { Idle, Connecting, Connected, Failed };

    /// Starts a non-blocking connect. Progress is made inside poll(), so the
    /// caller's frame loop never stalls on a slow or dead host.
    bool connect(const std::string& host, std::uint16_t port, std::string& errorOut);
    void disconnect();

    State state() const { return state_; }
    bool connected() const { return state_ == State::Connected; }
    const std::string& error() const { return error_; }
    /// Connection::maxFrameBytes of the next connect().
    std::uint32_t maxFrameBytes = kMaxFrameBytes;
    /// The link between two servers of a sharded game, not a player's
    /// connection: always a WebSocket, at /link, in both backends (natively,
    /// net/websocket.h; on the web, web::connect's `link`). It is Connected,
    /// and announced, once the upgrade has been answered.
    bool serverLink = false;
    /// As Listener::beforeWrite.
    std::function<void()> beforeWrite;
    /// Bytes queued and not yet handed over.
    std::size_t pendingBytes() const { return connection_ ? connection_->pendingBytes() : 0; }
    /// The socket, while there is one: from connect() until a failure or a
    /// disconnect() lets go of it.
    const Connection* connection() const { return connection_.get(); }

    /// Queues a frame. Safe before the connect completes; it drains after.
    void send(const ByteWriter& message);

    /// Services the socket for up to `timeoutMillis` and dispatches frames.
    /// Returns the number delivered.
    int poll(TransportHandler& handler, int timeoutMillis);

    /// As Listener::flush: a write that fails here is reported to the handler
    /// by the next poll(), not dropped silently.
    void flush();

private:
    void fail(const std::string& reason, TransportHandler* handler);
    /// Fails the connection through the handler if a flush() found it dead.
    /// Returns whether it did. Run first thing in both backends' poll().
    bool failReported(TransportHandler& handler);

    std::unique_ptr<Connection> connection_;
    State state_ = State::Idle;
    std::string error_;
    std::vector<std::byte> frameScratch_;
    bool announced_ = false;
    /// Natively: connected, and waiting on the WebSocket upgrade (serverLink).
    bool upgrading_ = false;
    double upgradeSinceMillis_ = 0;
};

} // namespace flix::net
