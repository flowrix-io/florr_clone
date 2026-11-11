// Stages the game's JSON content with the whitespace between its tokens taken
// out.
//
//   json_minify <out-dir> <file.json>...
//
// Each file lands in <out-dir> under its bare name: mobs.json, petals.json,
// mob_drops.json, maps.json, every map maps.json lists and the tilesets they
// name. Tiled saves a map indented, with a ", " between every tile id of every
// layer, and the rest is pretty-printed by hand, so whitespace was nearly half
// of the staged directory (3.4MB of JSON, 1.8MB of it content). Both wasms
// embed that directory whole, and the server keeps all of it in linear memory
// for as long as it runs.
//
// Only whitespace OUTSIDE strings goes -- space, tab, CR and LF, the four bytes
// JSON allows between tokens and the four the reader skips -- so every token
// reaches the readers exactly as written: each number in its own spelling, each
// string byte for byte. The copy parses to the same value as its source, and
// this tool checks that it does before writing it.
//
// The content hash (ContentRegistry::load) is folded over the STAGED bytes, on
// both sides of the handshake, so it is the hash of these copies: an edit that
// only re-indents a source file no longer changes it, and any other edit still
// does.
//
// Each source is parsed first with the game's own reader (shared/core/json.cpp),
// so a file the server would refuse fails the build here instead, with the
// error placed in the SOURCE file by line and column rather than at an offset
// into a copy that is one line long.
//
// Run by the build (cpp/CMakeLists.txt) on every configuration: natively on a
// native one, under the Node the emscripten toolchain found on a web one. The
// same input always gives the same bytes. Every output is written on every run,
// even when unchanged, so that it comes out newer than its source -- see the
// staging command for why that matters.

#include <cstdio>
#include <fstream>
#include <string>

#include "shared/core/file.h"
#include "shared/core/json.h"

namespace {

int fail(const std::string& message) {
    std::fprintf(stderr, "json_minify: %s\n", message.c_str());
    return 1;
}

/// The reader reports "<what> at offset N"; this says where N is in `text` as
/// an editor counts it. Any other error is returned as given.
std::string placeError(const std::string& error, const std::string& text) {
    static const std::string kMarker = " at offset ";
    const std::size_t at = error.rfind(kMarker);
    if (at == std::string::npos) return error;
    const std::string digits = error.substr(at + kMarker.size());
    if (digits.empty()) return error;
    std::size_t offset = 0;
    for (const char c : digits) {
        if (c < '0' || c > '9') return error;
        offset = offset * 10 + static_cast<std::size_t>(c - '0');
    }
    std::size_t line = 1;
    std::size_t column = 1;
    for (std::size_t i = 0; i < offset && i < text.size(); ++i) {
        if (text[i] == '\n') {
            ++line;
            column = 1;
        } else {
            ++column;
        }
    }
    return error.substr(0, at) + " at line " + std::to_string(line) + ", column " +
           std::to_string(column);
}

/// `text` without the whitespace outside its strings. Inside a string a
/// backslash takes the byte after it along unexamined, so an escaped quote does
/// not end the string.
std::string minify(const std::string& text) {
    std::string out;
    out.reserve(text.size());
    bool inString = false;
    for (std::size_t i = 0; i < text.size(); ++i) {
        const char c = text[i];
        if (inString) {
            out += c;
            if (c == '\\' && i + 1 < text.size()) {
                out += text[++i];
            } else if (c == '"') {
                inString = false;
            }
        } else if (c == '"') {
            inString = true;
            out += c;
        } else if (c != ' ' && c != '\t' && c != '\n' && c != '\r') {
            out += c;
        }
    }
    return out;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 3) return fail("usage: json_minify <out-dir> <file.json>...");
    const std::string outDir = argv[1];

    for (int i = 2; i < argc; ++i) {
        const std::string source = argv[i];
        std::string text;
        if (!flix::readFile(source, text)) return fail("cannot read " + source);

        flix::Json value;
        std::string error;
        if (!flix::Json::parse(text, value, error)) {
            return fail(source + ": " + placeError(error, text));
        }

        const std::string minified = minify(text);
        flix::Json copy;
        if (!flix::Json::parse(minified, copy, error) || copy.dump() != value.dump()) {
            return fail(source + ": the minified copy does not read back as the same value");
        }

        const std::string target = outDir + "/" + flix::fileNameOf(source);
        std::ofstream out(target, std::ios::binary | std::ios::trunc);
        out.write(minified.data(), static_cast<std::streamsize>(minified.size()));
        out.close();
        if (!out) return fail("cannot write " + target);
    }
    return 0;
}
