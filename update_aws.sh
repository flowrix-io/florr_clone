cd ~

# --- Node version guard ---------------------------------------------------
# uWebSockets.js v20.67.0 only ships prebuilt binaries for Node 22, 24 and 26.
# An older Node (e.g. the distro default 18) makes server.js crash on boot,
# which surfaces as an nginx 502. Ensure Node >= 22 before deploying.
REQUIRED_NODE_MAJOR=22
NODE_MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+)\..*/\1/')
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
    echo "Node ${NODE_MAJOR:-none} found; installing Node ${REQUIRED_NODE_MAJOR}.x (required by uWebSockets.js)..."
    curl -fsSL https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x | sudo -E bash -
    sudo apt-get install -y nodejs
    NODE_MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+)\..*/\1/')
    if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
        echo "ERROR: Node >= ${REQUIRED_NODE_MAJOR} still not available after install (got $(node -v 2>/dev/null)). Aborting." >&2
        exit 1
    fi
fi
echo "Using Node $(node -v)"
# --------------------------------------------------------------------------

pm2 delete server
pm2 save
cp dist/inventory.json inventory.json
rm -rf dist
rm public_build_florrclone.zip
wget https://sussybite.s3.amazonaws.com/public_build_florrclone.zip
unzip public_build_florrclone.zip
rm public_build_florrclone.zip
sudo cp /etc/letsencrypt/live/florrclone.cryodome.com/privkey.pem cert.key
sudo cp /etc/letsencrypt/live/florrclone.cryodome.com/fullchain.pem cert.crt
sudo chown $(id -u):$(id -g) cert.key cert.crt
cd dist
# WebTransport needs BOTH scoped packages: the JS API and the native QUIC
# backend it loads at runtime. `fails-components/webtransport` (unscoped) is a
# GitHub shorthand that resolves to the monorepo *root* package
# (@fails-components/webtransport-workspace) — it provides neither, which is why
# the server logged "@fails-components/webtransport not installed" and served
# WebSocket only.
#
# Note: UDP must also be open on the game port in the EC2 security group. QUIC
# is UDP-only, so with TCP 3000 open and UDP 3000 closed the listener starts,
# advertises itself, and every handshake times out into the WebSocket fallback.
npm install bcrypt github:uNetworking/uWebSockets.js#v20.67.0 \
    @fails-components/webtransport @fails-components/webtransport-transport-http3-quiche
rm inventory.json
cp ~/inventory.json inventory.json
rm ~/inventory.json
# Node flags for debugging the 100%-CPU event-loop hangs (see scripts/hang-watchdog.sh):
#  --perf-basic-prof-only-functions writes /tmp/perf-<pid>.map (JIT address -> JS
#    function + file:line). The watchdog resolves the spinning instruction pointer
#    (from a gdb backtrace) against this map to name the looping function — the only
#    method that works, since the loop is too tight for --report-on-signal to fire.
#  --report-on-signal is kept as a best-effort SIGUSR2 JS-stack report.
# REMOVE both once the hang is fixed (the perf map grows slowly over a long session).
pm2 start server.js #--node-args="--report-on-signal --perf-basic-prof-only-functions"
pm2 save
sudo reboot