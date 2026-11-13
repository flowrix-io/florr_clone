#!/bin/sh
cd "$(dirname "$0")" || exit 1
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv || exit 1
fi
if ! .venv/bin/python -c 'import PIL, numpy, pillow_heif, cairosvg, rawpy, cv2' 2>/dev/null; then
  .venv/bin/python -m pip install -r requirements.lock.txt || exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  printf 'Install Node.js from nodejs.org, then open Skin Converter on Crack again.\n'
  read -r _piqora_enter
  exit 1
fi
if [ ! -d node_modules/@visioncortex/vtracer ] || [ ! -d node_modules/earcut ]; then
  npm ci --ignore-scripts || exit 1
fi
exec .venv/bin/python server.py --open
