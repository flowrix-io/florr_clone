#pragma once
// Path edits over a JSON document, for the admin database editor.
//
// Pure functions, separate from the GameServer methods that use them
// (server/admin_db.cpp), so the rules about what a path may name can be tested
// without a server. Nothing here creates an intermediate level: a path names a
// value that exists, or -- for a set -- a new key directly under an object that
// does. An editor that conjured `inventory.rare` out of a typo in `rarre` would
// be writing a shape nothing reads.

#include <string>
#include <vector>

#include "shared/core/json.h"
#include "shared/net/admin_db.h"

namespace flix::admin_db {

/// The value at `path` inside `root`, or null when any step is missing. An
/// empty path is `root` itself.
const Json* nodeAt(const Json& root, const net::AdminDbPath& path);

/// Puts `value` at `path`. Under an object the last step may be a new key; under
/// an array it must be an existing index, or "-" to append. False, with a
/// sentence in `error`, when the path does not lead anywhere.
bool setAt(Json& root, const net::AdminDbPath& path, Json value, std::string& error);

/// Deletes the value at `path`. An array closes up behind it.
bool removeAt(Json& root, const net::AdminDbPath& path, std::string& error);

/// `path` as one line for a log or a message: steps joined with '.', so
/// ["progress", "inventory", "rare"] reads "progress.inventory.rare".
std::string describePath(const net::AdminDbPath& path);

/// One difference between two versions of a value: a path below it, and what
/// the second version holds there -- or that it holds nothing.
struct Change {
    net::AdminDbPath path;
    bool remove = false;
    Json value;
};

/// What turns `base` into `edited`, as the fewest whole values. Objects are
/// compared key by key; anything else that differs -- a number, a string, an
/// ARRAY -- is one change. An array is one value because its indices are not
/// names: a slot put in at the front would read as every later slot changed,
/// and applied to a list that has moved on since, would scramble it.
std::vector<Change> diff(const Json& base, const Json& edited);

/// Applies `changes` to the value at `path`, all or none. That value may have
/// moved on from the one the changes were worked out against, which is the
/// point: what they do not name is left as it is now. A change under a key
/// that has gone since is refused, as a set there would be (no level is
/// invented); removing what is already gone is already done.
bool patchAt(Json& root, const net::AdminDbPath& path, const std::vector<Change>& changes,
             std::string& error);

} // namespace flix::admin_db
