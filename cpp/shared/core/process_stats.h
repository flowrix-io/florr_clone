#pragma once
// What this process is costing the machine, for the debug menu's memory
// graphs.
//
// The browser build reads `process.memoryUsage()` on the server and
// `performance.memory.usedJSHeapSize` in the client. Neither exists here, and
// neither has a portable equivalent, so this is the nearest honest pair: the
// resident set the OS has given the process, and the bytes the allocator
// currently has handed out. A platform that will not answer reports 0, which
// the panel draws as "no data" rather than as a zero reading.

#include <cstdint>

namespace flr {

/// Resident set size in bytes -- the browser server's `rss`.
std::uint64_t residentBytes();

/// Live allocator bytes, the closest counterpart to a garbage-collected
/// heap's `heapUsed`. Not the same number as an arena's total footprint: it
/// is what the program is actually holding, which is what the graph is for.
std::uint64_t heapBytes();

} // namespace flr
