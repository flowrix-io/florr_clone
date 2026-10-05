#pragma once
// The key `/admin db` asks for.
//
// The database editor resets passwords and rewrites any record, so the admin
// flag alone does not open it: a stolen admin session, or an admin's password
// guessed or reused elsewhere, would otherwise be the whole database. The key
// is something only the server's own machine can tell you -- it is printed in
// the server's log at start-up -- so opening the editor needs both an admin
// account AND access to the box.
//
// It is generated from the machine's private IP address, so it changes when
// the server moves to another machine or network. The address alone would be
// no secret at all -- private ranges are small enough to enumerate, and this
// code is public -- so it is hashed together with the database's own secret
// salt (Database::serverSecret), which never leaves the server.

#include <string>

namespace flix::admin_db {

/// True for an RFC 1918 IPv4 address: 10/8, 172.16/12 or 192.168/16.
bool isPrivateIPv4(const std::string& address);

/// The first private IPv4 address on this machine's interfaces, in the order
/// the system lists them, or the first non-loopback IPv4 when none is private.
/// Empty when there is none at all -- or no way to ask, as on the offline page,
/// where the server lives in a browser tab.
std::string privateAddress();

/// The key for `address` under `secret`: 16 lowercase hex characters.
std::string deriveKey(const std::string& secret, const std::string& address);

/// Whether `typed` is `key`. Case-blind, and in constant time.
bool keyMatches(const std::string& typed, const std::string& key);

} // namespace flix::admin_db
