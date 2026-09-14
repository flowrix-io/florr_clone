// SPDX-License-Identifier: MPL-2.0
//
// The MCU half of the CPU monitor: it owns the LED matrix and does nothing
// else. Linux measures the load and sends a finished 8x13 frame down the
// Router Bridge; this redraws whatever frame arrived last, forever.
//
// The redraw in loop() is not redundant with the one a new frame would imply.
// The matrix is driven by the MCU rather than latched in hardware, so the
// picture only stays on the panel for as long as something keeps drawing it --
// stop, and the display fades out. Holding the last frame also means a hiccup
// on the Linux side leaves the graph standing still rather than going dark.

#include <Arduino_LED_Matrix.h>
#include <Arduino_RouterBridge.h>

#include <vector>

Arduino_LED_Matrix matrix;

const uint8_t FRAME_ROWS = 8;
const uint8_t FRAME_COLS = 13;
const uint8_t FRAME_SIZE = FRAME_ROWS * FRAME_COLS;

// Row-major, one brightness per LED. Starts empty, so the panel is dark until
// the first frame arrives rather than showing whatever was in memory.
uint8_t frame[FRAME_SIZE] = {0};

// Called from Python with the next frame to display. Short by design: it runs
// on the Bridge's callback, and the drawing is loop()'s job.
void draw(std::vector<uint8_t> newFrame) {
    size_t len = min(newFrame.size(), (size_t)FRAME_SIZE);
    memcpy(frame, newFrame.data(), len);
}

void setup() {
    matrix.begin();
    // Three bits: brightness 0..7 per LED, which is what the Python side
    // scales its bars to. Raising this here without raising it there would
    // dim the whole graph into near-darkness.
    matrix.setGrayscaleBits(3);
    matrix.clear();

    Bridge.begin();
    Bridge.provide("draw", draw);
}

void loop() {
    matrix.draw(frame);
    delay(10);
}
