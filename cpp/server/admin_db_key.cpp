#include "server/admin_db_key.h"

#include <cctype>
#include <cstdio>

#include "server/crypto.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#include <arpa/inet.h>
#include <ifaddrs.h>
#include <netinet/in.h>
#endif

namespace flix::admin_db {

namespace {

#ifdef __EMSCRIPTEN__
// Node's view of the interfaces, private first, as the native walk below
// orders them. The offline page has no `process` and no `os`: it answers
// empty rather than throwing on the first `require` it reaches.
EM_JS(void, flix_admin_db_address, (char* out, int capacity), {
  let found = '';
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const interfaces = require('os').networkInterfaces();
      const isPrivate = (a) => /^10\./.test(a) || /^192\.168\./.test(a) ||
                               /^172\.(1[6-9]|2[0-9]|3[01])\./.test(a);
      let fallback = '';
      for (const name of Object.keys(interfaces)) {
        for (const entry of interfaces[name] || []) {
          const v4 = entry.family === 'IPv4' || entry.family === 4;
          if (!v4 || entry.internal) continue;
          if (isPrivate(entry.address)) { if (!found) found = entry.address; }
          else if (!fallback) fallback = entry.address;
        }
      }
      if (!found) found = fallback;
    } catch (e) {
      found = '';
    }
  }
  stringToUTF8(found, out, capacity);
});
#endif

} // namespace

bool isPrivateIPv4(const std::string& address) {
    unsigned a = 0, b = 0, c = 0, d = 0;
    char tail = 0;
    if (std::sscanf(address.c_str(), "%u.%u.%u.%u%c", &a, &b, &c, &d, &tail) != 4) return false;
    if (a > 255 || b > 255 || c > 255 || d > 255) return false;
    return a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168);
}

std::string privateAddress() {
#ifdef __EMSCRIPTEN__
    char answer[64] = {0};
    flix_admin_db_address(answer, static_cast<int>(sizeof answer));
    return answer;
#else
    ifaddrs* list = nullptr;
    if (getifaddrs(&list) != 0) return {};
    std::string found;
    std::string fallback;
    for (const ifaddrs* entry = list; entry != nullptr; entry = entry->ifa_next) {
        if (entry->ifa_addr == nullptr || entry->ifa_addr->sa_family != AF_INET) continue;
        const auto* in = reinterpret_cast<const sockaddr_in*>(entry->ifa_addr);
        char text[INET_ADDRSTRLEN] = {0};
        if (inet_ntop(AF_INET, &in->sin_addr, text, sizeof text) == nullptr) continue;
        const std::string address = text;
        if (address.rfind("127.", 0) == 0) continue;
        if (isPrivateIPv4(address)) {
            found = address;
            break;
        }
        if (fallback.empty()) fallback = address;
    }
    freeifaddrs(list);
    return found.empty() ? fallback : found;
#endif
}

std::string deriveKey(const std::string& secret, const std::string& address) {
    // Its own prefix, so the same secret salting the per-address registration
    // hashes (Database::accountAddressHash) can never produce this value.
    return crypto::sha256Hex("admin-db-key|" + secret + "|" + address).substr(0, 16);
}

bool keyMatches(const std::string& typed, const std::string& key) {
    if (key.empty()) return false;
    std::string lowered = typed;
    for (char& ch : lowered) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    return crypto::constantTimeEquals(lowered, key);
}

} // namespace flix::admin_db
