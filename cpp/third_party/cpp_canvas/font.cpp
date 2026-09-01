#include "font.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>
#include <fstream>

namespace {

// Big-endian readers. TrueType is big-endian throughout; bounds are checked on
// every read because a font file is untrusted input.
std::uint8_t u8(const std::vector<std::uint8_t>& d, std::uint32_t at) {
  return at < d.size() ? d[at] : 0;
}
std::uint16_t u16(const std::vector<std::uint8_t>& d, std::uint32_t at) {
  return static_cast<std::uint16_t>((u8(d,at) << 8) | u8(d,at+1));
}
std::int16_t i16(const std::vector<std::uint8_t>& d, std::uint32_t at) {
  return static_cast<std::int16_t>(u16(d,at));
}
std::uint32_t u32(const std::vector<std::uint8_t>& d, std::uint32_t at) {
  return (static_cast<std::uint32_t>(u16(d,at)) << 16) | u16(d,at+2);
}

// Decodes one UTF-8 codepoint, advancing `i`. Invalid bytes yield U+FFFD so a
// mangled string still renders something rather than desynchronising.
std::uint32_t decodeUtf8(const std::string& s, std::size_t& i) {
  const auto byte = [&](std::size_t k) { return static_cast<unsigned char>(s[k]); };
  const unsigned char c = byte(i);
  if (c < 0x80) { ++i; return c; }
  const auto cont = [&](std::size_t k) { return k < s.size() && (byte(k) & 0xC0) == 0x80; };
  if ((c & 0xE0) == 0xC0 && cont(i+1)) { std::uint32_t v = ((c & 0x1Fu) << 6) | (byte(i+1) & 0x3Fu); i += 2; return v; }
  if ((c & 0xF0) == 0xE0 && cont(i+1) && cont(i+2)) { std::uint32_t v = ((c & 0x0Fu) << 12) | ((byte(i+1) & 0x3Fu) << 6) | (byte(i+2) & 0x3Fu); i += 3; return v; }
  if ((c & 0xF8) == 0xF0 && cont(i+1) && cont(i+2) && cont(i+3)) { std::uint32_t v = ((c & 0x07u) << 18) | ((byte(i+1) & 0x3Fu) << 12) | ((byte(i+2) & 0x3Fu) << 6) | (byte(i+3) & 0x3Fu); i += 4; return v; }
  ++i; return 0xFFFD;
}

bool endsWithFontExtension(const std::string& name) {
  const auto lower = [](std::string s) { for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c))); return s; };
  const std::string n = lower(name);
  return n.size() > 4 && (n.compare(n.size()-4,4,".ttf") == 0 || n.compare(n.size()-4,4,".ttc") == 0 || n.compare(n.size()-4,4,".otf") == 0);
}

} // namespace

bool Font::loadFromFile(const std::string& path) {
  std::ifstream in(path, std::ios::binary | std::ios::ate);
  if (!in) return false;
  const std::streamsize size = in.tellg();
  if (size <= 0) return false;
  in.seekg(0);
  std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
  if (!in.read(reinterpret_cast<char*>(bytes.data()), size)) return false;
  return loadFromMemory(std::move(bytes));
}

bool Font::loadFromMemory(std::vector<std::uint8_t> bytes) {
  data_ = std::move(bytes);
  cache_.clear();
  valid_ = parse();
  return valid_;
}

bool Font::parse() {
  if (data_.size() < 12) return false;

  std::uint32_t base = 0;
  const std::uint32_t tag = u32(data_, 0);
  if (tag == 0x74746366) {          // 'ttcf': a collection; take the first face
    if (data_.size() < 16) return false;
    base = u32(data_, 12);
    if (base + 12 > data_.size()) return false;
  }

  const std::uint32_t version = u32(data_, base);
  // 0x00010000 is TrueType outlines; 'true' is the older Apple tag. 'OTTO'
  // means CFF outlines, which this decoder does not read.
  if (version != 0x00010000 && version != 0x74727565) return false;

  const std::uint16_t numTables = u16(data_, base + 4);
  if (base + 12 + numTables * 16u > data_.size()) return false;

  for (std::uint16_t i = 0; i < numTables; ++i) {
    const std::uint32_t rec = base + 12 + i * 16u;
    char name[5] = {0};
    std::memcpy(name, &data_[rec], 4);
    const std::uint32_t offset = u32(data_, rec + 8);
    const std::uint32_t length = u32(data_, rec + 12);
    if (offset > data_.size()) continue;
    tables_[name] = {offset, std::min<std::uint32_t>(length, static_cast<std::uint32_t>(data_.size()) - offset)};
  }

  const std::uint32_t head = tableOffset("head");
  const std::uint32_t maxp = tableOffset("maxp");
  const std::uint32_t hhea = tableOffset("hhea");
  if (!head || !maxp || !tableOffset("glyf") || !tableOffset("loca")) return false;

  unitsPerEm_ = u16(data_, head + 18);
  if (unitsPerEm_ == 0) unitsPerEm_ = 1000;
  indexToLocFormat_ = i16(data_, head + 50);
  numGlyphs_ = u16(data_, maxp + 4);

  if (hhea) {
    ascent_ = i16(data_, hhea + 4);
    descent_ = i16(data_, hhea + 6);
    lineGap_ = i16(data_, hhea + 8);
    numberOfHMetrics_ = u16(data_, hhea + 34);
  }

  // Canvas2D's 'top', 'middle' and 'bottom' are edges of the EM BOX, and the
  // browser splits that box at the baseline in the ratio of the OS/2 sTypo
  // metrics -- not hhea's. For Ubuntu hhea says 932/-189 per 1000 em while
  // sTypo says 776/-185, and taking hhea drops every top-anchored string 1-3px.
  // Only the ratio is kept here; ascent() below does the normalising, and
  // lineHeight() goes back to hhea, which is a different box again.
  const std::uint32_t os2 = tableOffset("OS/2");
  if (os2 && os2 + 72 <= data_.size()) {
    const std::int16_t typoAscender = i16(data_, os2 + 68);
    const std::int16_t typoDescender = i16(data_, os2 + 70);
    if (typoAscender > 0 && typoAscender > typoDescender) {
      ascent_ = typoAscender;
      descent_ = typoDescender;
    }
  }

  // Prefer a Unicode subtable: (3,10) full repertoire, then (3,1) BMP, then
  // (0,x) Unicode platform. Anything else is a legacy encoding we cannot map.
  const std::uint32_t cmap = tableOffset("cmap");
  if (cmap) {
    const std::uint16_t count = u16(data_, cmap + 2);
    std::uint32_t best = 0;
    int bestScore = -1;
    for (std::uint16_t i = 0; i < count; ++i) {
      const std::uint32_t rec = cmap + 4 + i * 8u;
      const std::uint16_t platform = u16(data_, rec);
      const std::uint16_t encoding = u16(data_, rec + 2);
      const std::uint32_t offset = cmap + u32(data_, rec + 4);
      if (offset + 4 > data_.size()) continue;
      int score = -1;
      if (platform == 3 && encoding == 10) score = 3;
      else if (platform == 3 && encoding == 1) score = 2;
      else if (platform == 0) score = 1;
      if (score > bestScore) { bestScore = score; best = offset; }
    }
    if (bestScore >= 0) {
      cmapOffset_ = best;
      cmapFormat_ = u16(data_, best);
    }
  }

  return numGlyphs_ > 0;
}

std::uint32_t Font::tableOffset(const char* tag) const {
  auto it = tables_.find(tag);
  return it == tables_.end() ? 0 : it->second.first;
}

std::uint16_t Font::glyphIndex(std::uint32_t codepoint) const {
  if (!cmapOffset_) return 0;

  if (cmapFormat_ == 4) {
    if (codepoint > 0xFFFF) return 0;
    const std::uint16_t segX2 = u16(data_, cmapOffset_ + 6);
    if (segX2 < 2) return 0;
    const std::uint32_t ends = cmapOffset_ + 14;
    const std::uint32_t starts = ends + segX2 + 2;
    const std::uint32_t deltas = starts + segX2;
    const std::uint32_t ranges = deltas + segX2;

    for (std::uint16_t s = 0; s < segX2; s += 2) {
      if (codepoint > u16(data_, ends + s)) continue;
      const std::uint16_t start = u16(data_, starts + s);
      if (codepoint < start) return 0;
      const std::uint16_t rangeOffset = u16(data_, ranges + s);
      if (rangeOffset == 0) {
        return static_cast<std::uint16_t>(codepoint + i16(data_, deltas + s));
      }
      // The idRangeOffset indirection is relative to its own slot, which is
      // the one genuinely strange thing in this table.
      const std::uint32_t at = ranges + s + rangeOffset + (codepoint - start) * 2u;
      const std::uint16_t index = u16(data_, at);
      if (index == 0) return 0;
      return static_cast<std::uint16_t>(index + i16(data_, deltas + s));
    }
    return 0;
  }

  if (cmapFormat_ == 12) {
    const std::uint32_t groups = u32(data_, cmapOffset_ + 12);
    for (std::uint32_t g = 0; g < groups; ++g) {
      const std::uint32_t rec = cmapOffset_ + 16 + g * 12u;
      const std::uint32_t start = u32(data_, rec);
      const std::uint32_t end = u32(data_, rec + 4);
      if (codepoint < start) return 0;      // groups are sorted
      if (codepoint <= end) {
        return static_cast<std::uint16_t>(u32(data_, rec + 8) + (codepoint - start));
      }
    }
    return 0;
  }

  if (cmapFormat_ == 6) {
    const std::uint16_t first = u16(data_, cmapOffset_ + 6);
    const std::uint16_t count = u16(data_, cmapOffset_ + 8);
    if (codepoint < first || codepoint >= static_cast<std::uint32_t>(first) + count) return 0;
    return u16(data_, cmapOffset_ + 10 + (codepoint - first) * 2u);
  }

  if (cmapFormat_ == 0) {
    if (codepoint > 255) return 0;
    return u8(data_, cmapOffset_ + 6 + codepoint);
  }

  return 0;
}

std::uint32_t Font::glyphOffset(std::uint16_t index) const {
  const std::uint32_t loca = tableOffset("loca");
  if (!loca || index >= numGlyphs_) return 0;
  if (indexToLocFormat_ == 0) return u16(data_, loca + index * 2u) * 2u;
  return u32(data_, loca + index * 4u);
}

std::uint16_t Font::advanceWidth(std::uint16_t index) const {
  const std::uint32_t hmtx = tableOffset("hmtx");
  if (!hmtx || numberOfHMetrics_ == 0) return unitsPerEm_ / 2;
  // Past numberOfHMetrics the advance is the last one; only the side bearing
  // continues to vary. Monospace fonts rely on this to store one metric.
  const std::uint16_t clamped = std::min<std::uint16_t>(index, numberOfHMetrics_ - 1);
  return u16(data_, hmtx + clamped * 4u);
}

const Font::Glyph& Font::glyph(std::uint16_t index) const {
  auto it = cache_.find(index);
  if (it != cache_.end()) return it->second;
  Glyph g;
  buildGlyph(index, g);
  return cache_.emplace(index, std::move(g)).first->second;
}

void Font::buildGlyph(std::uint16_t index, Glyph& out) const {
  out.advance = advanceWidth(index);
  out.loaded = true;

  const std::uint32_t glyf = tableOffset("glyf");
  const std::uint32_t start = glyphOffset(index);
  const std::uint32_t end = glyphOffset(static_cast<std::uint16_t>(index + 1));
  // An empty range is a blank glyph (a space), not an error.
  if (!glyf || end <= start || glyf + end > data_.size()) return;

  const std::uint32_t at = glyf + start;
  const std::int16_t contours = i16(data_, at);
  if (contours >= 0) buildSimpleGlyph(at, end - start, out);
  else buildCompositeGlyph(at, end - start, out, 0);
}

void Font::buildSimpleGlyph(std::uint32_t at, std::uint32_t length, Glyph& out) const {
  const std::int16_t contourCount = i16(data_, at);
  if (contourCount <= 0) return;

  std::uint32_t p = at + 10;
  std::vector<std::uint16_t> contourEnds(static_cast<std::size_t>(contourCount));
  for (int i = 0; i < contourCount; ++i) { contourEnds[static_cast<std::size_t>(i)] = u16(data_, p); p += 2; }

  const std::uint32_t pointCount = contourEnds.back() + 1u;
  if (pointCount > 10000) return;   // implausible; refuse rather than allocate

  const std::uint16_t instructionLength = u16(data_, p);
  p += 2 + instructionLength;

  std::vector<std::uint8_t> flags;
  flags.reserve(pointCount);
  while (flags.size() < pointCount && p < at + length) {
    const std::uint8_t flag = u8(data_, p++);
    flags.push_back(flag);
    if (flag & 0x08) {                       // repeat
      std::uint8_t repeat = u8(data_, p++);
      while (repeat-- && flags.size() < pointCount) flags.push_back(flag);
    }
  }
  if (flags.size() < pointCount) return;

  std::vector<int> xs(pointCount), ys(pointCount);
  int value = 0;
  for (std::uint32_t i = 0; i < pointCount; ++i) {
    const std::uint8_t flag = flags[i];
    if (flag & 0x02) { const std::uint8_t d = u8(data_, p++); value += (flag & 0x10) ? d : -d; }
    else if (!(flag & 0x10)) { value += i16(data_, p); p += 2; }
    xs[i] = value;
  }
  value = 0;
  for (std::uint32_t i = 0; i < pointCount; ++i) {
    const std::uint8_t flag = flags[i];
    if (flag & 0x04) { const std::uint8_t d = u8(data_, p++); value += (flag & 0x20) ? d : -d; }
    else if (!(flag & 0x20)) { value += i16(data_, p); p += 2; }
    ys[i] = value;
  }

  // Font space is y-up; canvas space is y-down. Flipping here means every
  // consumer downstream works in ordinary screen coordinates.
  const auto px = [&](std::uint32_t i) { return static_cast<float>(xs[i]); };
  const auto py = [&](std::uint32_t i) { return static_cast<float>(-ys[i]); };
  const auto onCurve = [&](std::uint32_t i) { return (flags[i] & 0x01) != 0; };

  std::uint32_t first = 0;
  for (int c = 0; c < contourCount; ++c) {
    const std::uint32_t last = contourEnds[static_cast<std::size_t>(c)];
    if (last < first || last >= pointCount) break;
    const std::uint32_t count = last - first + 1;
    if (count < 2) { first = last + 1; continue; }

    // A contour may begin on an off-curve point, in which case the true start
    // is the implied midpoint between it and the last point.
    float startX, startY;
    std::uint32_t begin;
    if (onCurve(first)) {
      startX = px(first); startY = py(first); begin = first + 1;
    } else if (onCurve(last)) {
      startX = px(last); startY = py(last); begin = first;
    } else {
      startX = (px(first) + px(last)) * 0.5f;
      startY = (py(first) + py(last)) * 0.5f;
      begin = first;
    }
    out.path.moveTo(startX, startY);

    float controlX = 0, controlY = 0;
    bool haveControl = false;
    for (std::uint32_t k = 0; k < count; ++k) {
      const std::uint32_t i = first + ((begin - first) + k) % count;
      if (onCurve(i)) {
        if (haveControl) { out.path.quadraticCurveTo(controlX, controlY, px(i), py(i)); haveControl = false; }
        else out.path.lineTo(px(i), py(i));
      } else {
        if (haveControl) {
          // Two consecutive controls imply an on-curve point midway between.
          const float midX = (controlX + px(i)) * 0.5f;
          const float midY = (controlY + py(i)) * 0.5f;
          out.path.quadraticCurveTo(controlX, controlY, midX, midY);
        }
        controlX = px(i); controlY = py(i); haveControl = true;
      }
    }
    if (haveControl) out.path.quadraticCurveTo(controlX, controlY, startX, startY);
    out.path.closePath();

    first = last + 1;
  }
}

void Font::buildCompositeGlyph(std::uint32_t at, std::uint32_t length, Glyph& out, int depth) const {
  if (depth > 5) return;   // composites can nest; bound it rather than recurse forever

  std::uint32_t p = at + 10;
  while (p + 4 <= at + length) {
    const std::uint16_t flags = u16(data_, p);
    const std::uint16_t glyphIdx = u16(data_, p + 2);
    p += 4;

    float dx = 0, dy = 0;
    if (flags & 0x0001) {                       // ARG_1_AND_2_ARE_WORDS
      dx = i16(data_, p); dy = i16(data_, p + 2); p += 4;
    } else {
      dx = static_cast<std::int8_t>(u8(data_, p));
      dy = static_cast<std::int8_t>(u8(data_, p + 1));
      p += 2;
    }
    // Args can be point indices rather than offsets; that form is vanishingly
    // rare in text fonts and is treated as no offset rather than misplacing it.
    if (!(flags & 0x0002)) { dx = 0; dy = 0; }

    float a = 1, b = 0, c = 0, d = 1;
    const auto f2dot14 = [&](std::uint32_t o) { return i16(data_, o) / 16384.0f; };
    if (flags & 0x0008) { a = d = f2dot14(p); p += 2; }
    else if (flags & 0x0040) { a = f2dot14(p); d = f2dot14(p + 2); p += 4; }
    else if (flags & 0x0080) { a = f2dot14(p); b = f2dot14(p + 2); c = f2dot14(p + 4); d = f2dot14(p + 6); p += 8; }

    const Glyph& part = glyph(glyphIdx);
    // The component's outline is already y-flipped, so the offset must be too,
    // and the b/c shear terms mirror with it.
    for (const Path2D::Segment& s : part.path.segments()) {
      Path2D::Segment moved = s;
      const int pairs = s.command == Path2D::Command::Move || s.command == Path2D::Command::Line ? 1
                      : s.command == Path2D::Command::Quadratic ? 2
                      : s.command == Path2D::Command::Bezier ? 3 : 0;
      for (int i = 0; i < pairs; ++i) {
        const float x = s.v[i * 2], y = s.v[i * 2 + 1];
        moved.v[i * 2]     = a * x + c * y + dx;
        moved.v[i * 2 + 1] = b * x + d * y - dy;
      }
      out.path.segments().push_back(moved);
    }
  }
}

void Font::appendText(Path2D& path, const std::string& utf8, float x, float y, float pixelSize) const {
  if (!valid_ || utf8.empty() || pixelSize <= 0) return;
  // Downstream a glyph is an ordinary path, which is the point -- but the
  // rasterizer still has to know it is filling text, because the browser gives
  // glyph coverage a gamma it does not give a shape's.
  path.markGlyphOutlines();
  const float scale = pixelSize / static_cast<float>(unitsPerEm_);

  float penX = 0;
  std::size_t i = 0;
  while (i < utf8.size()) {
    const std::uint32_t codepoint = decodeUtf8(utf8, i);
    const std::uint16_t index = glyphIndex(codepoint);
    const Glyph& g = glyph(index);

    for (const Path2D::Segment& s : g.path.segments()) {
      Path2D::Segment placed = s;
      const int pairs = s.command == Path2D::Command::Move || s.command == Path2D::Command::Line ? 1
                      : s.command == Path2D::Command::Quadratic ? 2
                      : s.command == Path2D::Command::Bezier ? 3 : 0;
      for (int k = 0; k < pairs; ++k) {
        placed.v[k * 2]     = x + (penX + s.v[k * 2]) * scale;
        placed.v[k * 2 + 1] = y + s.v[k * 2 + 1] * scale;
      }
      path.segments().push_back(placed);
    }
    penX += g.advance;
  }
}

float Font::measure(const std::string& utf8, float pixelSize) const {
  if (!valid_ || pixelSize <= 0) return 0;
  const float scale = pixelSize / static_cast<float>(unitsPerEm_);
  float width = 0;
  std::size_t i = 0;
  while (i < utf8.size()) {
    width += glyph(glyphIndex(decodeUtf8(utf8, i))).advance;
  }
  return width * scale;
}

namespace {

// One edge of the em box: the ascent and descent are rescaled so that together
// they span exactly one em, which is what makes the browser's 'middle' land
// half an em above its 'top' at every size. Values are snapped to 64ths of a
// pixel because the browser's metrics come out of 26.6 fixed point; that is
// what reproduces its baselines to the bit rather than to a hundredth.
float emBoxEdge(int metric, int span, float pixelSize, int unitsPerEm) {
  if (span <= 0) return metric * pixelSize / unitsPerEm;
  return std::round(metric * pixelSize * 64.0f / span) / 64.0f;
}

} // namespace

float Font::ascent(float pixelSize) const {
  return emBoxEdge(ascent_, ascent_ - descent_, pixelSize, unitsPerEm_);
}
float Font::descent(float pixelSize) const {
  return emBoxEdge(descent_, ascent_ - descent_, pixelSize, unitsPerEm_);
}
float Font::lineHeight(float pixelSize) const {
  // A `normal` line box is hhea's ascender, descender and gap, NOT the em box
  // above -- 14px Ubuntu is a 16px row in the browser, and only 932/-189/28
  // gives that. hhea is re-read here because ascent_/descent_ now hold the
  // OS/2 pair.
  const std::uint32_t hhea = tableOffset("hhea");
  if (hhea) {
    const int span = i16(data_, hhea + 4) - i16(data_, hhea + 6) + i16(data_, hhea + 8);
    return span * pixelSize / unitsPerEm_;
  }
  return (ascent_ - descent_ + lineGap_) * pixelSize / unitsPerEm_;
}

bool Font::findSystemFont(const std::vector<std::string>& preferred, std::string& pathOut) {
  static const char* kDirectories[] = {
    "/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts",
    "/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/truetype/ubuntu",
    "/usr/share/fonts/truetype/liberation", "/usr/share/fonts/TTF", "/usr/share/fonts",
    "C:\\Windows\\Fonts",
  };

  const auto lower = [](std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
  };

  // Try each preferred family in order, across every directory, before falling
  // back — otherwise a low-priority directory's match beats a better one.
  for (const std::string& want : preferred) {
    const std::string needle = lower(want);
    for (const char* dir : kDirectories) {
      std::string candidate = std::string(dir) + "/" + want;
      { std::ifstream probe(candidate, std::ios::binary); if (probe) { pathOut = candidate; return true; } }
      for (const char* ext : {".ttf", ".ttc", ".otf"}) {
        candidate = std::string(dir) + "/" + want + ext;
        std::ifstream probe(candidate, std::ios::binary);
        if (probe) { pathOut = candidate; return true; }
      }
      (void)needle;
    }
  }

  // Last resort: a face that is present on essentially every install of each
  // platform, so text renders even when nothing preferred is available.
  static const char* kFallbacks[] = {
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Geneva.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
  };
  for (const char* path : kFallbacks) {
    std::ifstream probe(path, std::ios::binary);
    if (probe) { pathOut = path; return true; }
  }
  (void)endsWithFontExtension;
  return false;
}
