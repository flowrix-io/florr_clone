#!/usr/bin/env node
// Writes the web builds' copy of the typeface: the face with every glyph
// outline taken out, keeping only what lays text out.
//
// The browser draws all of the web client's text itself, in the Ubuntu the
// page links from Google Fonts; the client never fills a glyph. What it does
// need is the face's numbers. Every run is measured, aligned, wrapped and
// hit-tested against the face's own advance widths and em box
// (client/ui/text.cpp), so a label lands in the same place in every browser,
// before the webfont has arrived as well as after, and where the native client
// puts it. Those numbers are a few kilobytes of the 330KB file. The rest is
// outlines, hinting and shaping tables, and embedding them in bundle.wasm
// shipped a second copy of a face the page already fetches. Only the offline
// page, which cannot fetch anything, embeds the real file.
//
// The tables that carry the numbers are copied byte for byte: cmap (character
// to glyph), hmtx (the advances), hhea and OS/2 (the vertical metrics), head
// and maxp (units per em, the glyph count, the loca format). glyf becomes
// empty and loca gives every glyph an empty range, which is TrueType's own way
// of writing a blank glyph. The output is still a well-formed font: Font
// (third_party/cpp_canvas/font.cpp) reads it with no special case, and it
// measures, covers and splits the em box exactly as the full face does.
// Nothing else is kept.
//
// The same input always gives the same bytes, so a rebuild with nothing
// changed leaves the wasm alone.
//
// Run by the web build (cpp/CMakeLists.txt), under the Node the emscripten
// toolchain found:
//   node font_metrics.js <face.ttf> <out>

'use strict';

const fs = require('fs');

function fail(message) {
    console.error('font_metrics: ' + message);
    process.exit(1);
}

const [input, output] = process.argv.slice(2);
if (!input || !output) fail('usage: node font_metrics.js <face.ttf> <out>');

const font = fs.readFileSync(input);
if (font.length < 12) fail(`${input} is too short to be a font`);
// TrueType outlines, the only kind Font reads: 0x00010000, or Apple's 'true'.
// A collection ('ttcf') or a CFF face ('OTTO') is refused rather than guessed
// at.
const version = font.readUInt32BE(0);
if (version !== 0x00010000 && version !== 0x74727565) {
    fail(`${input} is not a single TrueType face`);
}

const tables = new Map();
const numTables = font.readUInt16BE(4);
if (12 + numTables * 16 > font.length) fail(`${input}: the table directory is truncated`);
for (let i = 0; i < numTables; ++i) {
    const record = 12 + i * 16;
    const tag = font.toString('latin1', record, record + 4);
    const offset = font.readUInt32BE(record + 8);
    const length = font.readUInt32BE(record + 12);
    if (offset + length > font.length) fail(`${input}: the ${tag} table runs past the end`);
    tables.set(tag, font.subarray(offset, offset + length));
}

// What Font reads to measure, cover and place a run. Copied when the face has
// them; a table the face lacks is a table Font falls back without in both
// files alike, so the two still measure the same.
const kept = new Map();
for (const tag of ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'OS/2']) {
    // A copy, not a view: head is edited below.
    if (tables.has(tag)) kept.set(tag, Buffer.from(tables.get(tag)));
}

const head = kept.get('head');
const maxp = kept.get('maxp');
if (!head || head.length < 54) fail(`${input} has no usable head table`);
if (!maxp || maxp.length < 6) fail(`${input} has no usable maxp table`);

// One offset per glyph and one past the last, every one zero: each glyph's
// range in glyf is empty. Written in whichever width head says loca is in.
const glyphCount = maxp.readUInt16BE(4);
const longOffsets = head.readInt16BE(50) !== 0;
kept.set('loca', Buffer.alloc((glyphCount + 1) * (longOffsets ? 4 : 2)));
kept.set('glyf', Buffer.alloc(0));

// The file's checksum is taken with head's adjustment field zeroed, and so is
// head's own entry in the directory.
head.writeUInt32BE(0, 8);

/** The sum of a table's big-endian 32-bit words, zero-padded to a whole one. */
function checksum(bytes) {
    const padded = Buffer.alloc((bytes.length + 3) & ~3);
    bytes.copy(padded);
    let sum = 0;
    for (let at = 0; at < padded.length; at += 4) sum = (sum + padded.readUInt32BE(at)) >>> 0;
    return sum;
}

// The directory is binary-searched by tag, so it is sorted by tag's bytes.
const tags = [...kept.keys()].sort();
const count = tags.length;
let entrySelector = 0;
while ((2 << entrySelector) <= count) ++entrySelector;
const searchRange = (1 << entrySelector) * 16;

// Every table starts on a 4-byte boundary, padded with zeros.
let end = 12 + count * 16;
const offsets = tags.map((tag) => {
    const at = end;
    end = (at + kept.get(tag).length + 3) & ~3;
    return at;
});

const out = Buffer.alloc(end);
out.writeUInt32BE(version, 0);
out.writeUInt16BE(count, 4);
out.writeUInt16BE(searchRange, 6);
out.writeUInt16BE(entrySelector, 8);
out.writeUInt16BE(count * 16 - searchRange, 10);
tags.forEach((tag, i) => {
    const table = kept.get(tag);
    const record = 12 + i * 16;
    out.write(tag, record, 4, 'latin1');
    out.writeUInt32BE(checksum(table), record + 4);
    out.writeUInt32BE(offsets[i], record + 8);
    out.writeUInt32BE(table.length, record + 12);
    table.copy(out, offsets[i]);
});
out.writeUInt32BE((0xB1B0AFBA - checksum(out)) >>> 0, offsets[tags.indexOf('head')] + 8);

fs.writeFileSync(output, out);
