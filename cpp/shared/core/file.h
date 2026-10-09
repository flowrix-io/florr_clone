#pragma once
// Whole-file reads and the file-name half of a path: the few lines every
// content loader used to carry a copy of. Header-only, so a loader that needs
// them adds an include and nothing else.

#include <fstream>
#include <sstream>
#include <string>

namespace flix {

/// Reads all of `path` into `out`, byte for byte (binary, so a JSON file's
/// bytes are exactly what the content hash folds). False, with `out`
/// untouched, when the file cannot be opened.
inline bool readFile(const std::string& path, std::string& out) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return false;
    std::ostringstream buffer;
    buffer << in.rdbuf();
    out = buffer.str();
    return true;
}

/// `maps/garden.tmj` -> `garden.tmj`. Either separator counts, so a reference
/// written on Windows names the same file.
inline std::string fileNameOf(const std::string& path) {
    const std::size_t slash = path.find_last_of("/\\");
    return slash == std::string::npos ? path : path.substr(slash + 1);
}

} // namespace flix
