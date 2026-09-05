#include "shared/core/process_stats.h"

#if defined(__APPLE__)
#include <mach/mach.h>
#include <malloc/malloc.h>
#elif defined(__linux__)
#include <cstdio>
#include <malloc.h>
#include <unistd.h>
#endif

namespace flix {

std::uint64_t residentBytes() {
#if defined(__APPLE__)
    mach_task_basic_info info{};
    mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
    if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO,
                  reinterpret_cast<task_info_t>(&info), &count) != KERN_SUCCESS) {
        return 0;
    }
    return static_cast<std::uint64_t>(info.resident_size);
#elif defined(__linux__)
    // statm's second field is resident pages. /proc/self/status would give the
    // same number already in kB, but it is a much larger file to read once a
    // second for one value.
    std::FILE* file = std::fopen("/proc/self/statm", "r");
    if (!file) return 0;
    unsigned long total = 0, resident = 0;
    const int fields = std::fscanf(file, "%lu %lu", &total, &resident);
    std::fclose(file);
    if (fields != 2) return 0;
    const long pageSize = ::sysconf(_SC_PAGESIZE);
    if (pageSize <= 0) return 0;
    return static_cast<std::uint64_t>(resident) * static_cast<std::uint64_t>(pageSize);
#else
    return 0;
#endif
}

std::uint64_t heapBytes() {
#if defined(__APPLE__)
    // A null zone asks for every zone the process has, which is what the
    // per-zone call would otherwise have to be summed over by hand.
    malloc_statistics_t stats{};
    malloc_zone_statistics(nullptr, &stats);
    return static_cast<std::uint64_t>(stats.size_in_use);
#elif defined(__linux__)
#if defined(__GLIBC__) && (__GLIBC__ > 2 || (__GLIBC__ == 2 && __GLIBC_MINOR__ >= 33))
    // mallinfo() truncates to int, which wraps at 2GB; mallinfo2 is the same
    // fields at 64 bits and is what a long-lived server needs.
    const struct mallinfo2 info = mallinfo2();
    return static_cast<std::uint64_t>(info.uordblks);
#else
    const struct mallinfo info = mallinfo();
    return static_cast<std::uint64_t>(static_cast<unsigned int>(info.uordblks));
#endif
#else
    return 0;
#endif
}

} // namespace flix
