#pragma once
// The bundled face's metrics, worked out at build time.
//
// Every number text needs to lay a run out -- each character's advance and the
// em box's split at the baseline -- is fixed the moment the configure pins
// Ubuntu-Bold.ttf. The build reads them out of that file
// (cpp/tools/font_table.cpp) and they are compiled in here, so measuring a run
// is one table read per character: no file to load, no cmap to walk, no glyph
// to decode, and on the web nothing to ask the browser for any character the
// face has.
//
// Each function returns, bit for bit, what the same call on a Font loaded from
// that file returns (face_metrics_tests.cpp). The web build has no other source
// of metrics; the native one uses these whenever the face it loaded is that
// file, and its own Font otherwise (text.cpp).

#include <cstddef>
#include <cstdint>
#include <string>

namespace flix::ui::face_metrics {

/// FNV-1a over a font file's bytes. The table carries its source's, which is
/// how the native client knows whether the face it loaded is the one the table
/// describes.
inline std::uint64_t fingerprint(const std::uint8_t* data, std::size_t size) {
    std::uint64_t hash = 0xcbf29ce484222325ull;
    for (std::size_t i = 0; i < size; ++i) {
        hash ^= data[i];
        hash *= 0x100000001b3ull;
    }
    return hash;
}

/// Whether `data` is the font file the table was made from.
bool describes(const std::uint8_t* data, std::size_t size);

/// Font::measure. When `covered` is given it is set to Font::covers(utf8),
/// found on the same pass.
float measure(const std::string& utf8, float pixelSize, bool* covered = nullptr);
/// Font::covers.
bool covers(const std::string& utf8);
/// Font::ascent and Font::descent.
float ascent(float pixelSize);
float descent(float pixelSize);

} // namespace flix::ui::face_metrics
