// The rainbow petal's shots are drawn as one circle each, in the colour their
// SVG document would have given them -- held here to that document, pixel for
// pixel, across its whole four-second cycle.
#include "test.h"

#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "canvas.h"
#include "client/render/rainbow_shot.h"
#include "svg.h"
#include "test_data.h"

using namespace flix;

TEST(the_shipped_rainbow_is_drawn_by_the_fast_path) {
    const ContentRegistry& content = testsupport::shippedContent();
    const std::uint16_t rainbow = content.petalIndex("rainbow");
    CHECK(rainbow != kInvalidIndex);
    if (rainbow == kInvalidIndex) return;
    CHECK(isPlainRainbowArt(content.petal(rainbow)));
    // And nothing else is mistaken for it.
    int plain = 0;
    for (std::uint16_t i = 0; i < content.petalCount(); ++i) plain += isPlainRainbowArt(content.petal(i));
    CHECK_EQ(plain, 1);
}

TEST(a_rainbow_shot_is_the_colour_its_document_paints) {
    const ContentRegistry& content = testsupport::shippedContent();
    const std::uint16_t rainbow = content.petalIndex("rainbow");
    if (rainbow == kInvalidIndex) { CHECK(false); return; }
    const SvgDocument document = SvgDocument::fromString(content.petal(rainbow).image);
    constexpr int kSize = 32;
    int mismatches = 0;
    // Every 37 ms over two cycles, and the key times exactly.
    std::vector<double> times;
    for (double t = 0.0; t < 8.0; t += 0.037) times.push_back(t);
    for (int k = 0; k <= 7; ++k) times.push_back(4.0 * k / 7.0);
    times.push_back(3.9999);
    times.push_back(1234.567);
    for (const double t : times) {
        Canvas canvas = Canvas::createVirtual(kSize, kSize);
        canvas.clear(Color{255, 255, 255});
        document.renderFitted(canvas, 0.0f, 0.0f, static_cast<float>(kSize),
                              static_cast<float>(kSize), static_cast<float>(t));
        const std::vector<std::uint8_t> rgba = canvas.getImageData(0, 0, kSize, kSize);
        const std::size_t at = (static_cast<std::size_t>(kSize / 2) * kSize + kSize / 2) * 4;
        const std::uint32_t painted =
            (std::uint32_t{rgba[at]} << 16) | (std::uint32_t{rgba[at + 1]} << 8) | rgba[at + 2];
        if (painted != rainbowFill(t) && ++mismatches <= 3) {
            std::fprintf(stderr, "  t=%.4f document %06x fast %06x\n", t, painted, rainbowFill(t));
        }
    }
    CHECK_EQ(mismatches, 0);
}
