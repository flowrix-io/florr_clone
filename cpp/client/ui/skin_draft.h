#pragma once
// What the skin studio's Create tab keeps between page loads: the board, the
// name, and -- while a published skin is being edited -- which one, with the
// new-skin draft set aside for it.
//
// Render-free and input-free, so the file can be tested without a window. The
// file sits beside the settings file, which in a browser means localStorage
// (client/web/persist.h).

#include <string>
#include <vector>

#include "shared/game/skin_format.h"

namespace flix {

struct SkinDraft {
    std::vector<SkinShape> shapes;
    std::string name;
    /// The selected shape's index, -1 for none.
    int selected = -1;
    /// The published skin being edited, "" while making a new one.
    std::string editingId;
    std::vector<SkinShape> asideShapes;
    std::string asideName;
    /// The Text editor, when it is the one open: its text as typed, which may
    /// not parse and may hold comments the shapes cannot.
    bool textMode = false;
    std::string text;
};

/// The draft as the file holds it.
std::string skinDraftText(const SkinDraft&);

/// Reads one back, every shape clamped as any untrusted one is. False, with
/// `out` untouched, for text that is not a draft: an empty file, as a first
/// run has, or a damaged one.
bool parseSkinDraft(const std::string& text, SkinDraft& out);

/// Replaces the file at `path`, in one write: the browser's storage behind it
/// re-encodes the whole file per write.
bool writeSkinDraftFile(const std::string& path, const std::string& text);

} // namespace flix
