#include "test.h"
#include "test_data.h"

#include "client/ui/face_metrics.h"
#include "font.h"

#include <cstdint>
#include <cstring>
#include <fstream>
#include <iterator>
#include <random>
#include <string>
#include <vector>

// The compiled-in table against the face it was made from.
//
// face_metrics.h promises the same numbers, to the bit, as a Font loaded from
// the staged Ubuntu-Bold.ttf: a run measured one way and drawn after being
// laid out the other must land on the same fraction of a pixel. So every
// comparison here is of bit patterns, not within a tolerance.

using namespace flix;

namespace {

std::vector<std::uint8_t> stagedFace() {
    std::ifstream in(testsupport::dataDir() + "/Ubuntu-Bold.ttf", std::ios::binary);
    return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

const Font& face() {
    static const Font font = [] {
        Font f;
        f.loadFromMemory(stagedFace());
        return f;
    }();
    return font;
}

std::uint32_t bits(float value) {
    std::uint32_t out = 0;
    std::memcpy(&out, &value, sizeof out);
    return out;
}

std::string utf8(std::uint32_t c) {
    std::string s;
    if (c < 0x80) {
        s += static_cast<char>(c);
    } else if (c < 0x800) {
        s += static_cast<char>(0xC0 | (c >> 6));
        s += static_cast<char>(0x80 | (c & 0x3F));
    } else if (c < 0x10000) {
        s += static_cast<char>(0xE0 | (c >> 12));
        s += static_cast<char>(0x80 | ((c >> 6) & 0x3F));
        s += static_cast<char>(0x80 | (c & 0x3F));
    } else {
        s += static_cast<char>(0xF0 | (c >> 18));
        s += static_cast<char>(0x80 | ((c >> 12) & 0x3F));
        s += static_cast<char>(0x80 | ((c >> 6) & 0x3F));
        s += static_cast<char>(0x80 | (c & 0x3F));
    }
    return s;
}

const float kSizes[] = {0.0f, -3.0f, 0.5f, 1.0f, 7.5f, 12.0f, 14.0f, 16.5f, 23.4567f, 31.9f, 100.0f, 333.3f};

/// Every codepoint the face maps, and a spread of ones it does not: controls,
/// DEL, the C1 block, an arrow, emoji, the last plane.
std::vector<std::uint32_t> probeCodepoints() {
    std::vector<std::uint32_t> out = face().mappedCodepoints();
    for (std::uint32_t c : {0x00u, 0x01u, 0x09u, 0x0Au, 0x1Fu, 0x7Fu, 0x80u, 0x9Fu, 0x2190u, 0x2660u,
                            0xFFFDu, 0xFFFFu, 0x1F600u, 0x10FFFFu}) {
        out.push_back(c);
    }
    return out;
}

/// Strings mixing mapped and unmapped characters with raw bytes, so the
/// decoder's handling of malformed input is compared too.
std::vector<std::string> probeStrings() {
    const std::vector<std::uint32_t> pool = probeCodepoints();
    std::mt19937 rng(20261017);
    std::vector<std::string> out = {"", " ", "Ladybug", "x1.2k", "Score: 12,345", "AVATAR To",
                                    "\xC0\x80", "\xC1\x81", "\xE2\x82", "\xFF\xFE", "\xF0\x9F\x98"};
    for (int n = 0; n < 4000; ++n) {
        std::string s;
        const int length = 1 + static_cast<int>(rng() % 40);
        for (int k = 0; k < length; ++k) {
            const std::uint32_t pick = rng() % 10;
            if (pick < 6) s += static_cast<char>(0x20 + rng() % 95);
            else if (pick < 9) s += utf8(pool[rng() % pool.size()]);
            else s += static_cast<char>(rng() % 256);
        }
        out.push_back(std::move(s));
    }
    return out;
}

} // namespace

TEST(face_metrics_table_is_of_the_staged_face) {
    const std::vector<std::uint8_t> bytes = stagedFace();
    CHECK(!bytes.empty());
    CHECK(face().valid());
    CHECK(ui::face_metrics::describes(bytes.data(), bytes.size()));
    std::vector<std::uint8_t> edited = bytes;
    edited[edited.size() / 2] ^= 1;
    CHECK(!ui::face_metrics::describes(edited.data(), edited.size()));
    CHECK(!ui::face_metrics::describes(bytes.data(), bytes.size() - 1));
}

TEST(face_metrics_measures_every_character_as_the_face_does) {
    int mismatches = 0;
    for (std::uint32_t c : probeCodepoints()) {
        const std::string s = utf8(c);
        if (ui::face_metrics::covers(s) != face().covers(s)) ++mismatches;
        bool covered = false;
        ui::face_metrics::measure(s, 12.0f, &covered);
        if (covered != face().covers(s)) ++mismatches;
        for (float size : kSizes) {
            if (bits(ui::face_metrics::measure(s, size)) != bits(face().measure(s, size))) {
                ++mismatches;
            }
        }
    }
    CHECK_EQ(mismatches, 0);
}

TEST(face_metrics_measures_every_run_as_the_face_does) {
    int mismatches = 0;
    for (const std::string& s : probeStrings()) {
        bool covered = false;
        const float width = ui::face_metrics::measure(s, 14.0f, &covered);
        if (covered != face().covers(s) || ui::face_metrics::covers(s) != face().covers(s)) {
            ++mismatches;
        }
        if (bits(width) != bits(face().measure(s, 14.0f))) ++mismatches;
        for (float size : kSizes) {
            if (bits(ui::face_metrics::measure(s, size)) != bits(face().measure(s, size))) {
                ++mismatches;
            }
        }
    }
    CHECK_EQ(mismatches, 0);
}

TEST(face_metrics_em_box_is_the_faces) {
    int mismatches = 0;
    for (int tenth = -20; tenth <= 4000; ++tenth) {
        const float size = tenth / 10.0f;
        if (bits(ui::face_metrics::ascent(size)) != bits(face().ascent(size))) ++mismatches;
        if (bits(ui::face_metrics::descent(size)) != bits(face().descent(size))) ++mismatches;
    }
    for (float size : kSizes) {
        if (bits(ui::face_metrics::ascent(size)) != bits(face().ascent(size))) ++mismatches;
        if (bits(ui::face_metrics::descent(size)) != bits(face().descent(size))) ++mismatches;
    }
    CHECK_EQ(mismatches, 0);
}

TEST(face_metrics_measures_a_run_too_long_for_exact_float_as_the_face_does) {
    // Past 2^24 font units the face's float sum starts to round, and the
    // table's integer sum would not; measure() switches to the face's own
    // order there. 20,000 W's and a mix of others are well past it.
    std::string run(20000, 'W');
    run += "\xC3\xA9 mixed tail \xF0\x9F\x98\x80";
    for (float size : kSizes) {
        CHECK_EQ(bits(ui::face_metrics::measure(run, size)), bits(face().measure(run, size)));
    }
}

TEST(font_outlines_stay_inside_their_glyph_boxes) {
    // At one em to the pixel the outline Font decodes is in font units, so
    // its points and the glyf header's box meet with no rounding between
    // them. Every point counts, control points included: those are what the
    // box is taken over. A composite glyph that read its own instructions as
    // further components used to grow stray shapes thousands of units away.
    const float em = static_cast<float>(face().unitsPerEm());
    int outside = 0, checked = 0;
    for (std::uint32_t c : face().mappedCodepoints()) {
        Path2D path;
        face().appendText(path, utf8(c), 0.0f, 0.0f, em);
        const Font::GlyphMetrics box = face().metrics(c);
        for (const Path2D::Segment& seg : path.segments()) {
            int points = 0;
            if (seg.command == Path2D::Command::Move || seg.command == Path2D::Command::Line) points = 1;
            else if (seg.command == Path2D::Command::Quadratic) points = 2;
            else if (seg.command == Path2D::Command::Bezier) points = 3;
            for (int p = 0; p < points; ++p) {
                // Font space points up; the outline is already flipped.
                const float x = seg.v[p * 2], y = -seg.v[p * 2 + 1];
                ++checked;
                if (x < box.xMin - 1e-3f || x > box.xMax + 1e-3f || y < box.yMin - 1e-3f ||
                    y > box.yMax + 1e-3f) {
                    ++outside;
                }
            }
        }
    }
    CHECK(checked > 10000);
    CHECK_EQ(outside, 0);
}
