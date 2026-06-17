#!/bin/bash
# Game-server hang watchdog (prod). Runs from cron every minute.
# The server occasionally wedges in a 100%-CPU infinite loop: the process stays
# alive (pm2 "online") but the event loop is blocked, so it stops serving and
# stops logging. pm2 can't detect this. This script health-checks the public
# endpoint; on a confirmed hang it captures diagnostics (native backtrace samples
# to localize the loop) and then restarts the server so downtime is ~1 min instead
# of hours. Remove by deleting the crontab entry + this file.
export PATH=/usr/local/bin:/usr/bin:/bin
PM2=/usr/local/bin/pm2
LOG=/home/ubuntu/hang-watchdog.log
DIAG_DIR=/home/ubuntu/dist
HEALTH_URL=https://127.0.0.1/

# Healthy = the 443 endpoint answers within 8s. When wedged, nginx waits on the
# dead node upstream and curl times out (exit!=0). HTTP status itself is ignored.
healthy() { curl -sk --max-time 8 -o /dev/null "$HEALTH_URL"; }

if healthy; then exit 0; fi
sleep 6
if healthy; then exit 0; fi   # transient blip (GC pause, deploy) — not a hang

PID=$("$PM2" pid server 2>/dev/null)
TS=$(date -u +%Y%m%dT%H%M%SZ)
echo "$TS HANG detected (pid=$PID) — capturing diagnostics then force-restarting" >> "$LOG"

# Snapshot the perf JIT map (address -> JS function) for this pid BEFORE killing it.
# The loop is a tight JITted-JS spin: gdb gives only a raw instruction pointer, and
# --report-on-signal writes nothing (V8 never reaches an interrupt point to honour it).
# The perf map (node --perf-basic-prof-only-functions) lets us turn that IP into a
# real function name + file:line.
MAP="/tmp/perf-$PID.map"
SAVED_MAP="$DIAG_DIR/hang-perfmap-$TS.map"
[ -f "$MAP" ] && cp "$MAP" "$SAVED_MAP"

# Best-effort JS diagnostic report (only succeeds if the loop has an interrupt point).
[ -n "$PID" ] && kill -USR2 "$PID" 2>/dev/null

# Native backtrace samples; the Thread-1 #0 frame is the spinning JIT IP.
OUT="$DIAG_DIR/hang-natbt-$TS.txt"
if command -v gdb >/dev/null 2>&1 && [ -n "$PID" ]; then
  for n in 1 2 3; do
    echo "==== sample $n ($(date -u +%H:%M:%S)) ====" >> "$OUT"
    sudo gdb -p "$PID" -batch -ex "set pagination off" -ex "thread apply all bt" 2>/dev/null \
      | grep -E "#[0-9]+ |Thread " >> "$OUT"
    sleep 1
  done
fi

# Resolve the spinning Thread-1 JIT instruction pointer to a JS function via the map.
IP=$(grep -m1 -E "#0 +0x[0-9a-f]+ in \?\? \(\)" "$OUT" 2>/dev/null | grep -oE "0x[0-9a-f]+" | head -1)
if [ -n "$IP" ] && [ -f "$SAVED_MAP" ] && command -v python3 >/dev/null 2>&1; then
  FUNC=$(python3 - "$IP" "$SAVED_MAP" <<"PY"
import sys
ip = int(sys.argv[1], 16)
res = "<IP not in perf map>"
with open(sys.argv[2]) as f:
    for line in f:
        p = line.split(None, 2)
        if len(p) < 3:
            continue
        try:
            start = int(p[0], 16); end = start + int(p[1], 16)
        except ValueError:
            continue
        if start <= ip < end:
            res = p[2].strip(); break
print(res)
PY
)
  echo "$TS LOOP IP $IP -> $FUNC" >> "$LOG"
else
  echo "$TS could not resolve loop IP (IP=$IP map=$SAVED_MAP)" >> "$LOG"
fi

# NOTE: do NOT core-dump + lldb here. This box has 911MB RAM and no swap; loading a
# ~1GB core into lldb (v8 bt) pages the whole core into RAM and OOM-wedges the entire
# machine (took prod fully offline on 2026-06-17 — needed a console reboot). The perf
# map resolution above is enough to name the function; line-level analysis must be done
# offline on a copied-down core, never in-process on this host.

# Force-restart. pm2 restart does NOT reliably kill a process spinning in a tight JS
# loop (it ignores SIGINT and pm2's SIGKILL stalled in practice, leaving it wedged).
# SIGKILL directly is kernel-enforced; pm2 autorestart brings it back. Fall back to
# pm2 restart if the process is somehow still unhealthy after.
kill -9 "$PID" 2>/dev/null
sleep 4
if ! healthy; then "$PM2" restart server >> "$LOG" 2>&1; fi
echo "$TS force-restart done (new pid=$("$PM2" pid server 2>/dev/null))" >> "$LOG"
