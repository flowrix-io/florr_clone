#include "client/ui/remote_image.h"

#include <cstdint>
#include <unordered_map>

namespace flix::ui {

#if defined(__EMSCRIPTEN__)

namespace {

/// Bounded, least recently asked about first: a transcript holds a hundred
/// lines, but a long session sees far more pictures than that, and each one
/// kept is a decoded bitmap the page holds on to. One evicted while still on
/// screen is simply fetched again -- from the browser's cache, as a rule.
constexpr std::size_t kMaxImages = 48;

struct Entry {
    int handle = 0;
    std::uint64_t lastAsked = 0;
};

std::unordered_map<std::string, Entry>& entries() {
    static std::unordered_map<std::string, Entry> map;
    return map;
}

std::uint64_t gClock = 0;

void evictOldest() {
    auto& map = entries();
    auto oldest = map.end();
    for (auto it = map.begin(); it != map.end(); ++it) {
        if (oldest == map.end() || it->second.lastAsked < oldest->second.lastAsked) oldest = it;
    }
    if (oldest == map.end()) return;
    canvasReleaseRemoteImage(oldest->second.handle);
    map.erase(oldest);
}

Entry& entryFor(const std::string& url) {
    auto& map = entries();
    auto found = map.find(url);
    if (found == map.end()) {
        if (map.size() >= kMaxImages) evictOldest();
        found = map.emplace(url, Entry{canvasRequestRemoteImage(url), 0}).first;
    }
    found->second.lastAsked = ++gClock;
    return found->second;
}

} // namespace

RemoteImage remoteImage(const std::string& url) {
    RemoteImage out;
    const int state = canvasRemoteImageStatus(entryFor(url).handle, out.width, out.height);
    out.state = state > 0    ? RemoteImage::State::Ready
                : state == 0 ? RemoteImage::State::Loading
                             : RemoteImage::State::Failed;
    return out;
}

void drawRemoteImage(Canvas& canvas, const std::string& url, double x, double y, double w,
                     double h) {
    canvas.drawRemoteImage(entryFor(url).handle, static_cast<float>(x), static_cast<float>(y),
                           static_cast<float>(w), static_cast<float>(h));
}

#else

RemoteImage remoteImage(const std::string&) { return {}; }

void drawRemoteImage(Canvas&, const std::string&, double, double, double, double) {}

#endif

} // namespace flix::ui
