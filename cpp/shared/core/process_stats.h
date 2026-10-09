#pragma once
// What this process is costing the machine, for the debug menu's memory
// graphs.
//
// The TypeScript build read `process.memoryUsage()` on the server and
// `performance.memory.usedJSHeapSize` in the client. Natively neither exists,
// and neither has a portable equivalent, so this is the nearest honest pair:
// the resident set the OS has given the process, and the bytes the allocator
// currently has handed out. The wasm server runs under Node, so it asks
// `process.memoryUsage()` itself, exactly as the TypeScript server did. A
// platform that will not answer reports 0 -- a browser tab, which is where
// the web client and the offline page run, has no `process` to ask -- and the
// panel draws that as "no data" rather than as a zero reading.

#include <cstdint>

namespace flix {

/// Resident set size in bytes -- Node's `rss`, which is what the wasm server
/// reports.
std::uint64_t residentBytes();

/// Live allocator bytes, the closest counterpart to a garbage-collected
/// heap's `heapUsed`. Not the same number as an arena's total footprint: it
/// is what the program is actually holding, which is what the graph is for.
/// Under Node it IS `heapUsed`: the V8 heap that a long session's JS-side
/// leak climbs. The wasm heap is one ArrayBuffer V8 counts outside it, so a
/// leak on the C++ side shows in residentBytes() instead.
std::uint64_t heapBytes();

} // namespace flix
