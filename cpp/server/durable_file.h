#pragma once
// The few file operations a record that must outlive the process is written
// with: the database's journal and a simulation server's lease journal
// (server/cluster/lease_journal.h). Defined in server/db.cpp, beside the
// journal they were written for.

#include <cstdint>
#include <string>

namespace flix::durable {

/// Writes all of `text` at the end of `fd`, whose length is `length`. On a
/// short write the file is cut back to `length` and false is returned; `fd` is
/// closed and set to -1 when even that fails.
bool appendWhole(int& fd, std::uint64_t& length, const std::string& text);

/// Starts syncing the file at `path` to the disk without waiting for it (on
/// Node, on libuv's thread pool). A ticket for syncState, or 0 when there is
/// nothing to wait for.
int beginSync(const std::string& path);
/// 0 while that sync is still running, 1 once it succeeded, 2 if it failed.
int syncState(int ticket);

} // namespace flix::durable
