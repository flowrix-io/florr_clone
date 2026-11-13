# Skin Converter on Crack

A standalone, local image-to-skin converter. It is outside the Petalwild game
checkout and is not included in the game or its deployment.

Double-click **Open Skin Converter on Crack.command**, then open http://127.0.0.1:4381.
The launcher installs missing local dependencies on first use; conversion itself
uses no cloud service and works offline after setup. Python 3 and Node are needed.
This Mac already has the dependencies installed.

Drop a picture or paste an image from the clipboard. **Smart contours** traces
whole colour regions into layered polygons, fitting smooth ellipses when useful.
It tries multiple colour palettes and chooses the lowest-error compatible result.
Long outlines are triangulated and merged into polygons of at most 16 vertices;
regions are not discarded simply to hit the shape count. **Crisp pixel art** uses
exact merged pixel runs where possible. **Soft detail** is the older rectangular
approximation, retained as an explicit option.

SVG and compressed SVGZ now use the Flowrix SVG-to-skin engine directly first:
supported circles, ellipses, rectangles, lines and cubic curves retain their
native geometry, transforms and paint order, with three-decimal export precision.
The SVG viewport is preserved. When the engine reports dropped shapes, holes or
unsupported features, the converter traces the complete rasterized image instead
and explains why. This avoids silently losing parts of the drawing. For native
SVG output the viewport controls framing; pixel grid and trim apply to tracing.

Game-ready exports use up to **255 shapes**. This requires the paired Petalwild
protocol 89 release. Older game builds still enforce 128. Exact pixel mode
preserves the prepared grid and can exceed 255; incompatible exports are labelled.
The engine supports no gradients or partial alpha (cutouts are thresholded;
flatten mode blends with your selected matte), so arbitrary photos cannot
be pixel-perfect within a fixed shape budget. Edges can soften in game when scaled.

**Supported decoders:** PNG/APNG, JPEG, WebP, GIF, AVIF, HEIC/HEIF, TIFF, BMP,
ICO/ICNS, JPEG2000, PPM/PGM/PBM, TGA, PCX and other Pillow formats; compatible
flattened PSD files; SVG/SVGZ; camera RAW formats supported by
LibRaw. Not every codec variant is guaranteed. JPEG XL, EPS, PDF, and proprietary
editor project files are not advertised as supported. HDR/RAW are developed to
8-bit colour. SVG external resources are refused. Animated/multipage files allow
selection of one still frame/page, not animated skin export.

Uploads stay in memory on 127.0.0.1. No account, analytics, remote fonts, or runtime
network requests. A 40 MB file / 40 MP decoded-image limit bounds resource use;
export grids are capped at 512 pixels per side. No uploaded image is written to disk.
Only explicit Save actions export files. Ctrl+C in the launcher stops the server.

Development checks:

    .venv/bin/python -m unittest discover -v
    node --check app.js
    node --check vectorize.js

Contour engine: VTracer by visioncortex (MIT), WebAssembly npm build;
triangulation: Mapbox Earcut (ISC). Decoder dependencies retain their own licences.

License and upstream provenance: see LICENSE and NOTICE.md. Native SVG engine
derived from Flowrix via Petalwild; the converter remains separate from the game.

Validation: native SVG circle/curve preservation, compressed SVG input,
exact pixel reconstruction, 12 encoded image formats, EXIF rotation,
frame selection, over-budget marking, transparency/matte handling, hostile SVG
resource refusal, native ellipse/polygon output, and transparent contour holes.

This branch is based on Flowrix web at 9ad5a3e6. Flowrix currently accepts 128
shapes; select the Flowrix target. The 255-shape target requires a compatible
game release such as Petalwild protocol 89. No game runtime files are changed.

Launch: double-click Open Skin Converter on Crack.command. Dependencies install
on first launch; image conversion then stays on localhost. See NOTICE.md for
upstream attribution and LICENSE for AGPL terms.

High detail export now supports up to 511 shapes. This is a converter export
limit, not a game protocol update. Flowrix and Petalwild targets retain their
128/255 caps and exact exports above those caps are flagged.

Maximum export budget: 1,000 shapes. Smart mode now traces contours first; it no
longer silently switches to rectangular pixel runs. Polygons only disables
ellipse fitting; Crisp pixel art / Exact pixel grid retain pixel-block export.
Current game import limits remain unchanged.
