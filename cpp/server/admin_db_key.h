#pragma once
// The key `/admin db` asks for.
//
// The database editor resets passwords and rewrites any record, so the admin
// flag alone does not open it: a stolen admin session, or an admin's password
// guessed or reused elsewhere, would otherwise be the whole database. The key
// is something only the server's own machine can tell you -- it is kept in a
// file beside the database, admin_db_key.txt -- so opening the editor needs
// both an admin account AND access to the box.
//
// The file is the key. Whoever runs the server changes it by editing that file
// (one line; surrounding whitespace is ignored), and the next `/admin db` uses
// the new one: the server reads it again on every attempt, so there is nothing
// to restart. Nothing in the game writes it -- no command, no editor panel,
// and the in-game update leaves it alone -- and the web root never serves it.
//
// When there is no file at start-up the server writes one, with a key
// generated from the machine's private IP address. The address alone would be
// no secret at all -- private ranges are small enough to enumerate, and this
// code is public -- so it is hashed together with the database's own secret
// salt (Database::serverSecret), which never leaves the server.

#include <cstddef>
#include <string>

namespace flix::admin_db {

/// The key file's name, beside the database.
inline constexpr const char* kKeyFileName = "admin_db_key.txt";

/// The longest key the file may hold. `/admin db <key> [username]` is one chat
/// line, and the server cuts a chat line at 200 characters.
inline constexpr std::size_t kMaxKeyLength = 128;

/// The key file for the database at `databasePath`: kKeyFileName in the same
/// directory.
std::string keyFileFor(const std::string& databasePath);

/// Reads the key out of `path`: the file's contents with the whitespace around
/// them trimmed. False, with `errorOut` saying why, when there is no file, it
/// cannot be read, or what it holds could never be typed after `/admin db` --
/// empty, longer than kMaxKeyLength, or with a space or a control character
/// inside it.
bool readKeyFile(const std::string& path, std::string& keyOut, std::string& errorOut);

/// Whether anything is at `path`, usable or not.
bool keyFileExists(const std::string& path);

/// Writes `key` to `path` as a NEW file, readable and writable by its owner
/// only. Fails rather than replace a file that is already there.
bool createKeyFile(const std::string& path, const std::string& key, std::string& errorOut);

/// True for an RFC 1918 IPv4 address: 10/8, 172.16/12 or 192.168/16.
bool isPrivateIPv4(const std::string& address);

/// The first private IPv4 address on this machine's interfaces, in the order
/// the system lists them, or the first non-loopback IPv4 when none is private.
/// Empty when there is none at all -- or no way to ask, as on the offline page,
/// where the server lives in a browser tab.
std::string privateAddress();

/// The key for `address` under `secret`: 16 lowercase hex characters. What a
/// new key file is seeded with.
std::string deriveKey(const std::string& secret, const std::string& address);

/// Whether `typed` is `key`, exactly -- it is a password, so case counts --
/// and in constant time. Never true for an empty key.
bool keyMatches(const std::string& typed, const std::string& key);

} // namespace flix::admin_db
