#include "server/admin_db_key.h"

#include <cerrno>
#include <cstdio>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <utility>

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
      // Not regex literals: the preprocessor drops their backslashes, and
      // /^10./ also takes 100-109.
      const isPrivate = (a) => {
        const p = a.split('.').map(Number);
        return p[0] === 10 || (p[0] === 192 && p[1] === 168) ||
               (p[0] === 172 && p[1] >= 16 && p[1] <= 31);
      };
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

std::string keyFileFor(const std::string& databasePath) {
    const std::size_t slash = databasePath.find_last_of('/');
    if (slash == std::string::npos) return kKeyFileName;
    return databasePath.substr(0, slash + 1) + kKeyFileName;
}

bool readKeyFile(const std::string& path, std::string& keyOut, std::string& errorOut) {
    keyOut.clear();
    std::FILE* file = std::fopen(path.c_str(), "rb");
    if (file == nullptr) {
        errorOut = path + (errno == ENOENT ? ": no such file" : ": cannot open for reading");
        return false;
    }
    // A key is at most kMaxKeyLength characters, so a file much longer than
    // that is refused without reading the rest of it.
    std::string text;
    char chunk[512];
    while (std::size_t got = std::fread(chunk, 1, sizeof chunk, file)) {
        text.append(chunk, got);
        if (text.size() > 4 * kMaxKeyLength) break;
    }
    const bool failed = std::ferror(file) != 0;
    std::fclose(file);
    if (failed) {
        errorOut = path + ": read error";
        return false;
    }

    const char* const whitespace = " \t\r\n\v\f";
    const std::size_t first = text.find_first_not_of(whitespace);
    if (first == std::string::npos) {
        errorOut = path + ": the file is empty";
        return false;
    }
    const std::size_t last = text.find_last_not_of(whitespace);
    std::string key = text.substr(first, last - first + 1);
    if (key.size() > kMaxKeyLength) {
        errorOut = path + ": the key is longer than " + std::to_string(kMaxKeyLength) +
                   " characters";
        return false;
    }
    // The console splits its line on whitespace, and the chat line drops
    // control characters before it gets there: a key with either in it could
    // never be typed, so it is refused here rather than never matching.
    for (const unsigned char c : key) {
        if (c <= 0x20 || c == 0x7F) {
            errorOut = path + ": the key has a space or a control character in it";
            return false;
        }
    }
    keyOut = std::move(key);
    return true;
}

bool keyFileExists(const std::string& path) {
    struct stat info {};
    return ::stat(path.c_str(), &info) == 0;
}

bool createKeyFile(const std::string& path, const std::string& key, std::string& errorOut) {
    // O_EXCL: an operator's own key is never overwritten, even by a second
    // server starting on the same directory at the same moment.
    const int fd = ::open(path.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (fd < 0) {
        errorOut = path + ": cannot create";
        return false;
    }
    const std::string text = key + "\n";
    const bool written = ::write(fd, text.data(), text.size()) == static_cast<ssize_t>(text.size());
    if (written) ::fsync(fd);
    const bool closed = ::close(fd) == 0;
    if (!written || !closed) {
        std::remove(path.c_str());
        errorOut = path + ": write error";
        return false;
    }
    return true;
}

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
    return crypto::constantTimeEquals(typed, key);
}

} // namespace flix::admin_db
