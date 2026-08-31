#pragma once

// TrueType glyph outlines, decoded to Path2D.
//
// Text is produced as PATHS rather than as a rasterized bitmap cache. That is
// what makes fillText and strokeText fall out of the code that already exists:
// a glyph is filled and stroked by the same routines as any other path, so
// outlined text, transforms, clipping and alpha all work with no extra machinery.

#include <cstdint>
#include <map>
#include <string>
#include <vector>

#include "canvas.h"

class Font {
public:
    // Parses a .ttf / .otf-with-glyf file. Returns false on anything it cannot
    // read; fonts are user-supplied data and a malformed one must not crash.
    bool loadFromFile(const std::string& path);
    bool loadFromMemory(std::vector<std::uint8_t> data);
    bool valid() const { return valid_; }

    // Searches the platform's usual font directories for the first family in
    // `preferred` that exists, then any usable fallback. Names are matched
    // case-insensitively against the file name.
    static bool findSystemFont(const std::vector<std::string>& preferred, std::string& pathOut);

    // Appends `text` to `path`, laid out left to right starting at the text
    // origin (x, baseline y), scaled so that em == pixelSize.
    void appendText(Path2D& path, const std::string& utf8, float x, float y, float pixelSize) const;

    float measure(const std::string& utf8, float pixelSize) const;

    // Vertical metrics scaled to pixelSize, for baseline placement.
    float ascent(float pixelSize) const;
    float descent(float pixelSize) const;   // negative, as in the font
    float lineHeight(float pixelSize) const;

private:
    struct Glyph {
        Path2D path;          // in font units, y already flipped to screen down
        float advance = 0;    // font units
        bool loaded = false;
    };

    bool parse();
    std::uint32_t tableOffset(const char* tag) const;
    std::uint16_t glyphIndex(std::uint32_t codepoint) const;
    const Glyph& glyph(std::uint16_t index) const;
    void buildGlyph(std::uint16_t index, Glyph& out) const;
    void buildSimpleGlyph(std::uint32_t offset, std::uint32_t length, Glyph& out) const;
    void buildCompositeGlyph(std::uint32_t offset, std::uint32_t length, Glyph& out, int depth) const;
    std::uint32_t glyphOffset(std::uint16_t index) const;
    std::uint16_t advanceWidth(std::uint16_t index) const;

    std::vector<std::uint8_t> data_;
    bool valid_ = false;

    std::map<std::string, std::pair<std::uint32_t, std::uint32_t>> tables_;
    std::uint16_t unitsPerEm_ = 1000;
    std::int16_t indexToLocFormat_ = 0;
    std::uint16_t numGlyphs_ = 0;
    std::uint16_t numberOfHMetrics_ = 0;
    std::int16_t ascent_ = 800, descent_ = -200, lineGap_ = 0;
    std::uint32_t cmapOffset_ = 0;
    std::uint16_t cmapFormat_ = 0;

    mutable std::map<std::uint16_t, Glyph> cache_;
};
