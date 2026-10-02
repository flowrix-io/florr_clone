#include "test.h"

#include "canvas.h"

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <vector>

// Canvas::darkenDevice is blitDevice specialised to black: integer arithmetic
// instead of a float blend, empty mask runs stepped over eight at a time, and
// rows split across the fill threads. None of that may show in the pixels --
// it has to land where a black blit through the same mask lands.

#ifndef __EMSCRIPTEN__

namespace {

// Big enough to take the threaded path, and an odd width so a row does not
// end on a whole eight-byte step.
constexpr int kWidth = 517;
constexpr int kHeight = 300;

Canvas paintedBackground() {
    Canvas canvas = Canvas::createVirtual(kWidth, kHeight);
    std::vector<std::uint8_t> rgba(static_cast<std::size_t>(kWidth) * kHeight * 4);
    for (int y = 0; y < kHeight; ++y) {
        for (int x = 0; x < kWidth; ++x) {
            std::uint8_t* p = &rgba[(static_cast<std::size_t>(y) * kWidth + x) * 4];
            p[0] = static_cast<std::uint8_t>((x * 7 + y * 3) & 0xFF);
            p[1] = static_cast<std::uint8_t>((x * 13 + 40) & 0xFF);
            p[2] = static_cast<std::uint8_t>((y * 11 + x) & 0xFF);
            p[3] = 255;
        }
    }
    canvas.putImageData(rgba, kWidth, kHeight, 0, 0);
    return canvas;
}

// Every value 0..255 somewhere, with long empty runs as a vignette has.
std::vector<std::uint8_t> testMask() {
    std::vector<std::uint8_t> mask(static_cast<std::size_t>(kWidth) * kHeight, 0);
    for (int y = 0; y < kHeight; ++y) {
        for (int x = 0; x < kWidth; ++x) {
            if (x > 120 && x < 400) continue;
            mask[static_cast<std::size_t>(y) * kWidth + x] =
                static_cast<std::uint8_t>((x * 5 + y * 17) & 0xFF);
        }
    }
    return mask;
}

} // namespace

TEST(darken_device_matches_a_black_blit_through_the_same_mask) {
    const std::vector<std::uint8_t> mask = testMask();
    std::vector<std::uint8_t> black(mask.size() * 4, 0);
    for (std::size_t i = 0; i < mask.size(); ++i) black[i * 4 + 3] = mask[i];

    for (const float alpha : {1.0f, 0.6f}) {
        Canvas darkened = paintedBackground();
        darkened.setGlobalAlpha(alpha);
        darkened.darkenDevice(mask.data(), kWidth, kHeight, 0, 0);

        Canvas blitted = paintedBackground();
        blitted.setGlobalAlpha(alpha);
        blitted.blitDevice(black.data(), kWidth, kHeight, 0, 0);

        const std::vector<std::uint8_t> a = darkened.getImageData(0, 0, kWidth, kHeight);
        const std::vector<std::uint8_t> b = blitted.getImageData(0, 0, kWidth, kHeight);
        CHECK(a.size() == b.size());
        int worst = 0;
        for (std::size_t i = 0; i < a.size(); ++i) {
            worst = std::max(worst, std::abs(static_cast<int>(a[i]) - static_cast<int>(b[i])));
        }
        // Rounding only: the two take different roads to the same product.
        CHECK(worst <= 1);
    }
}

TEST(darken_device_leaves_pixels_under_an_empty_mask_untouched) {
    const std::vector<std::uint8_t> mask = testMask();
    Canvas darkened = paintedBackground();
    darkened.darkenDevice(mask.data(), kWidth, kHeight, 0, 0);
    const std::vector<std::uint8_t> after = darkened.getImageData(0, 0, kWidth, kHeight);
    const std::vector<std::uint8_t> before =
        paintedBackground().getImageData(0, 0, kWidth, kHeight);
    bool untouched = true;
    for (std::size_t i = 0; i < mask.size(); ++i) {
        if (mask[i] != 0) continue;
        for (int c = 0; c < 4; ++c) untouched = untouched && after[i * 4 + c] == before[i * 4 + c];
    }
    CHECK(untouched);
}

#endif
