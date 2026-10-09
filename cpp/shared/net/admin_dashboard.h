#pragma once
// The admin dashboard's half of the wire.
//
// One ClientMessage (AdminDashboard) and one ServerMessage (AdminDashboard),
// each opening with a sub-code, as the database editor's do (admin_db.h): the
// dashboard is one feature used by a handful of people, and everything it asks
// is gated by the same check on the server -- the admin console's, a database
// admin or a temporary grant -- and billed to the same budget, the console's
// command allowance. The layouts of the sub-messages are documented on the two
// enums. (Version 51.)
//
// A player is named by CONNECTION here, never by a name typed into a lookup:
// the list is of sessions, a connection id is what the server looks one up by,
// and a name typed into a command is resolved by rules (account first, then a
// bot's nameplate) the panel has no business re-deriving. But an id alone is
// not a person. Another account can sign in on the same socket, and every new
// server process numbers its connections from 1 again, so an id a panel picked
// a minute ago can name somebody else entirely. A request about a player
// therefore carries the account name the row was picked as, and the server
// acts only while that connection still holds that account. The id is only
// ever sent back to the server it came from.
//
// Pages rather than whole lists for the reason the editor gives: a wire string
// is capped at 64 KiB and a frame at 1 MiB (kMaxFrameBytes), and a list of
// every flower on a busy server, or every stack in a hoarder's bag, would
// reach either. kAdminDashboardPageSize rows is far under both whatever the
// names hold.

#include <cstdint>
#include <string>

#include "shared/game/rarity.h"
#include "shared/game/realm.h"
#include "shared/net/bytebuffer.h"
#include "shared/net/protocol.h"

namespace flix::net {

/// What an AdminDashboard client message asks for.
enum class AdminDashboardOp : std::uint8_t {
    /// str search, u32 offset -- one page of the flowers in the world whose
    /// account name or nameplate contains `search`, case-insensitively, in
    /// account-name order. Answered with AdminDashboardReply::Players.
    Players = 0,
    /// u32 connection, str username, u32 offset -- one page of that player's
    /// bag: the account's own progress record, which is what `give` writes,
    /// never an arena run's scratch kit. `username` is the account the row was
    /// picked as; a connection that no longer holds it is answered as one that
    /// holds no account (an empty username), so a reused id never shows one
    /// player's bag under another's name. Answered with Inventory.
    Inventory,
    /// u32 connection, str username -- steer that player's flower with this
    /// session's own input, refused ("That player has left.") unless the
    /// connection still holds `username`. Answered with Result, and with
    /// Control when it starts.
    Control,
    /// (empty) -- stop steering, and go back to this session's own flower.
    /// Answered with Result, and with Control when there was something to
    /// release.
    Release,
};

/// What an AdminDashboard server message carries.
enum class AdminDashboardReply : std::uint8_t {
    /// str search, u32 offset, u32 totalMatched, u16 count,
    /// { AdminDashboardPlayer }* -- see writeAdminDashboardPlayer.
    Players = 0,
    /// u32 connection, str username, u32 offset, u32 totalStacks, u16 count,
    /// { AdminDashboardStack }* -- see writeAdminDashboardStack. An empty
    /// username says that connection holds no account any more, and the panel
    /// lets it go.
    Inventory,
    /// u8 active, u32 connection, str username -- whose flower this session is
    /// steering. Pushed whenever control starts or ends, whatever ended it, so
    /// the client never has to ask.
    Control,
    /// u8 ok, str message -- how a Control or Release request went. The words
    /// are the ones `/admin control` and `/admin release` print, since both
    /// roads reach the same server function.
    Result,
    /// u8 op, str message -- the request with that AdminDashboardOp was not
    /// acted on: it came faster than the session's command allowance, which
    /// every op spends from as a console command does. Sent beside the
    /// console's own "too quickly" notice, so the panel can stop waiting for
    /// an answer that is not coming -- a page it marked as loading, a Control
    /// it is waiting to close on.
    Refused,
};

/// A row's state, beside its names.
enum AdminDashboardPlayerFlags : std::uint8_t {
    AdminDashboardDead        = 1 << 0,   ///< the flower is a corpse
    AdminDashboardControlled  = 1 << 1,   ///< an admin is steering it
    AdminDashboardControlling = 1 << 2,   ///< its player is steering someone else's
};

/// Rows per Players page and stacks per Inventory page.
inline constexpr std::uint16_t kAdminDashboardPageSize = 50;

/// One row of the player list.
struct AdminDashboardPlayer {
    ConnectionId connection = 0;
    /// The ACCOUNT, which is what every console command resolves a person by.
    std::string username;
    /// The nameplate, which is whatever the player typed on the title screen.
    std::string name;
    Realm realm = Realm::Overworld;
    std::uint8_t flags = 0;   ///< AdminDashboardPlayerFlags
};

/// One stack of a bag.
struct AdminDashboardStack {
    std::uint16_t petalIndex = 0;
    Rarity rarity = Rarity::Common;
    std::uint32_t count = 0;
};

/// u32 connection, str username, str name, u8 realm, u8 flags.
void writeAdminDashboardPlayer(ByteWriter&, const AdminDashboardPlayer&);
/// False when the reader ran off the end; `out` is then unspecified.
bool readAdminDashboardPlayer(ByteReader&, AdminDashboardPlayer& out);

/// u16 itemType, u8 rarity, u32 count.
void writeAdminDashboardStack(ByteWriter&, const AdminDashboardStack&);
bool readAdminDashboardStack(ByteReader&, AdminDashboardStack& out);

} // namespace flix::net
