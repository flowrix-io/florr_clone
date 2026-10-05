#pragma once
// The admin database editor's half of the wire.
//
// One ClientMessage (AdminDb) and one ServerMessage (AdminDb), each opening
// with a sub-code, rather than a dozen opcodes: the editor is one feature used
// by a handful of people, and everything it says is gated by the same check on
// the server. The layouts of the sub-messages are documented on the two enums.
//
// What the editor browses is a DOCUMENT -- one account (its account row and
// its progress record side by side), or one of the database's unmodelled
// top-level tables (codes, guilds, notifications, ...) -- and it browses it as
// a tree. A tree rather than a text box, because a document can be far larger
// than a frame: the notification feed alone is a thousand rows. So a node may
// arrive UNLOADED -- its size and nothing else -- and the client asks for that
// path when the admin opens it. See writeAdminDbNode for when that happens.

#include <cstdint>
#include <string>
#include <vector>

#include "shared/core/json.h"
#include "shared/net/bytebuffer.h"

namespace flix::net {

/// What an AdminDb client message asks for.
enum class AdminDbOp : std::uint8_t {
    /// str search, u32 offset -- one page of accounts whose name contains
    /// `search`, case-insensitively. Answered with AdminDbReply::Accounts.
    List = 0,
    /// (empty) -- the editable top-level tables. Answered with Tables.
    Tables,
    /// u8 scope, str key, path -- one node of a document. Answered with Node.
    Fetch,
    /// u8 scope, str key, path, str valueJson -- replaces the value at `path`,
    /// or adds it when the last step names a key the object does not have yet.
    /// A last step of "-" under an array appends. Answered with Node + Result.
    Set,
    /// u8 scope, str key, path -- deletes the value at `path`.
    Remove,
    /// str username, str password -- sets a new password, revokes every
    /// session the account holds and signs out its live connections.
    SetPassword,
    /// str username -- revokes every session and signs out its connections.
    SignOut,
    // 7 was DeleteAccount. Removed for security: the editor cannot delete an
    // account. Do not reuse the code -- an old client may still send it.
};

/// What an AdminDb server message carries.
enum class AdminDbReply : std::uint8_t {
    /// str username -- open the editor, on this account when one is named.
    /// The answer to `/admin db`; the panel cannot be opened any other way.
    Open = 0,
    /// str search, u32 offset, u32 totalMatched, u16 count,
    /// { str username, u16 level, u8 AdminDbAccountFlags }*
    Accounts,
    /// u16 count, { str name, u8 isArray, u32 entries }*
    Tables,
    /// u8 scope, str key, path, u8 AdminDbAccountFlags, node -- the node at
    /// `path`, which the client puts in place of whatever it held there.
    Node,
    /// u8 ok, u8 scope, str key, u8 gone, str message -- how an edit or an
    /// action went. `gone` says the document no longer exists, so a
    /// client showing it must let it go.
    Result,
};

/// Which kind of document a key names.
enum class AdminDbScope : std::uint8_t {
    /// `key` is a username; the document is {"account": ..., "progress": ...}.
    Account = 0,
    /// `key` is a top-level table's name; the document is the table.
    Table = 1,
};

enum AdminDbAccountFlags : std::uint8_t {
    AdminDbIsAdmin = 1 << 0,
    AdminDbMuted   = 1 << 1,
    AdminDbOnline  = 1 << 2,
};

/// Accounts per List page.
inline constexpr std::uint16_t kAdminDbPageSize = 50;

/// Strings longer than this travel as their length alone and cannot be edited
/// in the panel. The wire's own string is capped at 64 KiB and would TRUNCATE
/// a longer one silently -- and an editor that showed the truncated text would
/// write it back over the real value the first time somebody touched it.
inline constexpr std::size_t kAdminDbMaxString = 4096;

/// How many bytes of encoded tree one Node reply may spend before its
/// children are sent unloaded. Well under the 1 MiB frame cap.
inline constexpr std::size_t kAdminDbNodeBudget = 256 * 1024;

/// A path into a document: one step per level, an array index written as its
/// decimal. Steps rather than one "a/b/c" string so a key holding a slash
/// needs no escaping.
using AdminDbPath = std::vector<std::string>;

void writeAdminDbPath(ByteWriter&, const AdminDbPath&);
AdminDbPath readAdminDbPath(ByteReader&);

/// One node of a document, as the client holds it.
struct AdminDbNode {
    Json::Type type = Json::Type::Null;
    bool boolean = false;
    double number = 0;
    std::string text;
    /// Set on a string too long to carry (see kAdminDbMaxString), and on a
    /// container whose children were not sent. `size` is still exact.
    bool unloaded = false;
    /// A string's length in bytes; a container's element count.
    std::uint32_t size = 0;
    /// An object's keys, or an array's indices as decimals, beside `children`.
    std::vector<std::string> keys;
    std::vector<AdminDbNode> children;

    bool container() const { return type == Json::Type::Array || type == Json::Type::Object; }
    /// The child under `key`, or null.
    AdminDbNode* child(const std::string& key);
    const AdminDbNode* child(const std::string& key) const;
    /// The node at `path` below this one, or null when any step is missing.
    AdminDbNode* find(const AdminDbPath& path);
};

/// Encodes `value` as a tree. Containers are loaded to any depth while the
/// whole encoding fits kAdminDbNodeBudget; past that, `value`'s children are
/// sent with their own children unloaded, and past THAT `value` itself goes
/// unloaded -- which a client shows as a size it cannot open.
void writeAdminDbNode(ByteWriter&, const Json& value);

/// Decodes one node. False on a malformed or over-deep tree; `out` is then
/// unspecified.
bool readAdminDbNode(ByteReader&, AdminDbNode& out);

/// `value` as one line of compact JSON, for the panel to show and edit.
std::string adminDbScalarText(const AdminDbNode&);

} // namespace flix::net
