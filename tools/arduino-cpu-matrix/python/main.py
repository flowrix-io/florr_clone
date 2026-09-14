# SPDX-License-Identifier: MPL-2.0
"""CPU load on the UNO Q's onboard LED matrix, as a scrolling history graph.

One column per sample, oldest on the left, newest on the right, so the whole
13-wide matrix is the last SAMPLE_PERIOD * 13 seconds of the board's life. A
column's bar grows from the bottom and is eight rows tall at 100%, and because
the matrix has eight brightness levels rather than one, the topmost cell of a
bar is dimmed in proportion to the part of a row the sample did not fill --
that is what makes 30% and 40% distinguishable on a display only eight pixels
high.

The load itself is the aggregate `cpu` line of /proc/stat, differenced between
samples: busy jiffies over total jiffies, across all four cores, which is the
same number `top` prints divided by the core count. This runs in a container,
but /proc/stat there is the host's, so what is drawn is the whole board's load
-- the game server under pm2 included, which is the point of putting it on the
matrix.
"""

from collections import deque
from pathlib import Path
import time

import numpy as np
from arduino.app_utils import App, Bridge, Frame, Logger

# Logger is a logging.Logger subclass, not a module-level facade: it has to be
# instantiated, and its name is what shows up in `arduino-app-cli app logs`.
log = Logger("cpu-monitor")

ROWS = 8
COLUMNS = 13
MAX_LEVEL = 7  # the sketch runs the matrix at 3 grayscale bits

# Fast enough that a busy tick is visible while it is happening, slow enough
# that the whole matrix still spans several seconds of history.
SAMPLE_PERIOD = 0.5

# The matrix shows the boot logo for the first half-minute or so, and the MCU
# is not to be driven while it does. Being the board's default app means this
# can start inside that window, so it waits the board out rather than the app
# out: uptime is what the warning is actually about, and it survives a restart
# of the app.
BOOT_QUIET_SECONDS = 45

# What an idle board looks like: the bottom row lit dimly rather than nothing
# at all, so a dark matrix means the monitor has stopped and not that the
# board has nothing to do.
FLOOR_LEVEL = 1

_STAT = Path("/proc/stat")


def read_cpu_jiffies() -> tuple[int, int]:
    """Return (busy, total) jiffies from the aggregate `cpu` line.

    Fields after the first are user, nice, system, idle, iowait, irq, softirq,
    steal, guest, guest_nice. Only idle and iowait count as not-busy; guest
    time is already included in user, so the trailing two fields are dropped
    rather than added twice.
    """
    fields = _STAT.read_text().split("\n", 1)[0].split()[1:11]
    values = [int(v) for v in fields]
    idle = values[3] + values[4]
    total = sum(values[:8])
    return total - idle, total


def render(history: deque) -> Frame:
    """Draw the sample history into an 8x13 frame, newest column on the right."""
    frame = np.zeros((ROWS, COLUMNS), dtype=np.uint8)
    frame[ROWS - 1, :] = FLOOR_LEVEL

    # Right-aligned: a history shorter than the matrix (the first few seconds
    # after a start) fills in from the right, so the newest sample is always
    # the rightmost column and the graph never appears to run backwards.
    first = COLUMNS - len(history)
    for offset, load in enumerate(history):
        column = first + offset
        filled = load * ROWS
        whole = int(filled)
        for row in range(min(whole, ROWS)):
            frame[ROWS - 1 - row, column] = MAX_LEVEL
        if whole < ROWS:
            # The part of a row the sample did not fill, as brightness. Never
            # rounded away: a bar that is one dim pixel is still a bar, and
            # dropping it would make everything below an eighth of the board
            # look like an idle one. It starts one level ABOVE the floor for
            # the same reason -- a 3% sample drawn at the floor's brightness
            # is a 3% sample you cannot see.
            partial = filled - whole
            if partial > 0.02:
                level = FLOOR_LEVEL + 1 + int(partial * (MAX_LEVEL - FLOOR_LEVEL - 2))
                frame[ROWS - 1 - whole, column] = min(level, MAX_LEVEL)

    return Frame(frame)


def wait_out_the_boot_logo() -> None:
    try:
        uptime = float(Path("/proc/uptime").read_text().split()[0])
    except (OSError, ValueError):
        return
    remaining = BOOT_QUIET_SECONDS - uptime
    if remaining > 0:
        log.info(f"waiting {remaining:.0f}s for the boot logo to finish")
        time.sleep(remaining)


history = deque(maxlen=COLUMNS)
# The baseline is taken after the wait, not before it: a reading from the far
# side of a 45-second sleep would make the first column an average of the whole
# boot rather than of half a second.
wait_out_the_boot_logo()
previous = read_cpu_jiffies()
# Started here rather than at zero so the first summary line waits for a full
# window of history instead of reporting an average over one sample.
last_logged = time.monotonic()


def loop() -> None:
    global previous, last_logged

    time.sleep(SAMPLE_PERIOD)

    current = read_cpu_jiffies()
    busy = current[0] - previous[0]
    total = current[1] - previous[1]
    previous = current
    # A total of zero means the clock did not tick between samples, which says
    # nothing about the load; repeating the last column beats drawing a zero.
    if total <= 0:
        return

    load = min(max(busy / total, 0.0), 1.0)
    history.append(load)

    try:
        Bridge.call("draw", render(history).to_board_bytes())
    except Exception as error:
        # The MCU comes and goes across a sketch upload or a router restart.
        # Losing a frame is not worth losing the monitor over.
        log.warning(f"could not draw frame: {error}")

    now = time.monotonic()
    if now - last_logged >= 30:
        last_logged = now
        average = sum(history) / len(history)
        log.info(f"cpu {load * 100:.0f}% now, {average * 100:.0f}% over the last "
                 f"{len(history) * SAMPLE_PERIOD:.0f}s")


App.run(user_loop=loop)
