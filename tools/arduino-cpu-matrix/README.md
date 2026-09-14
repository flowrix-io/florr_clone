# CPU Monitor — the UNO Q's LED matrix as a load graph

The Arduino UNO Q that runs the LAN test server (`arduino@arduino.local`, see
the pm2 `server` process) has an 8x13 blue LED matrix on the board itself. This
Arduino App puts the board's CPU load on it, so the thing on the desk says what
it is doing without anyone opening a shell.

```
............7      one column per sample, newest on the RIGHT
..........577      a bar is eight rows tall at 100%
........27777      the top cell of a bar is dimmed by the part of
.......577777      a row the sample did not fill
.....37777777
....477777777      the bottom row stays dimly lit at idle, so a dark
..27777777777      matrix means the monitor stopped rather than that
1577777777777      the board is asleep
```

Each column is one `SAMPLE_PERIOD` (0.5s), so the matrix holds the last six and
a half seconds. The load is the aggregate `cpu` line of `/proc/stat`,
differenced between samples — busy jiffies over total, across all four cores,
the same number `top` prints divided by the core count.

## Layout

The two halves of an Arduino App, which is what the board's framework runs:

- `python/main.py` — on Linux (in a container, where `/proc/stat` is still the
  host's). Measures, draws the frame, sends it down the Router Bridge.
- `sketch/sketch.ino` — on the MCU. Owns the matrix, redraws the last frame it
  was given. The panel is not latched, so something has to keep drawing it.

## Deploying it

The board is the only place it runs; this directory is the copy under version
control.

```bash
tar -czf - arduino-cpu-matrix | ssh arduino@arduino.local 'tar -xzf - -C ~/ArduinoApps'
ssh arduino@arduino.local 'mv ~/ArduinoApps/arduino-cpu-matrix ~/ArduinoApps/cpu-monitor'
ssh arduino@arduino.local 'arduino-app-cli app start ~/ArduinoApps/cpu-monitor'
```

The first start compiles and uploads the sketch, which takes a few minutes.
Afterwards:

```bash
arduino-app-cli app logs ~/ArduinoApps/cpu-monitor --follow   # the Python side
arduino-app-cli app list                                      # RUNNING?
arduino-app-cli properties set default user:cpu-monitor       # start it at boot
```

Only one Arduino App runs at a time, so starting another one stops this. The
game server is not an App — it is pm2's — and the two do not interfere.
