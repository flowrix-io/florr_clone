#include "client/ui/skin_draft.h"

#include <algorithm>
#include <cstdio>
#include <utility>

#include "shared/core/json.h"

namespace flix {

namespace {

/// The same spelling the database keeps a skin's shapes in.
Json shapesToJson(const std::vector<SkinShape>& shapes) {
    CustomSkin skin;
    skin.shapes = shapes;
    return skinToJson(skin)["shapes"];
}

std::vector<SkinShape> shapesFromJson(const Json& shapes) {
    std::vector<SkinShape> out;
    if (!shapes.isArray()) return out;
    for (const Json& value : shapes.items()) {
        if (static_cast<int>(out.size()) >= kMaxSkinShapes) break;
        // One shape at a time, so a shape the format drops cannot put the
        // rest out of step with their own colours below.
        Json one = Json::object();
        Json list = Json::array();
        list.push(value);
        one["shapes"] = std::move(list);
        CustomSkin skin = skinFromJson(one);
        if (skin.shapes.empty()) continue;
        SkinShape& shape = skin.shapes[0];
        // The format paints a colourless shape black, as publishing does. On
        // the board "none" is a colour still being chosen, and stays.
        if (value["fill"].asString().empty()) shape.fill.clear();
        if (value["stroke"].asString().empty()) shape.stroke.clear();
        out.push_back(std::move(shape));
    }
    return out;
}

} // namespace

std::string skinDraftText(const SkinDraft& draft) {
    Json out = Json::object();
    out["name"] = draft.name;
    out["selected"] = draft.selected;
    out["shapes"] = shapesToJson(draft.shapes);
    if (!draft.editingId.empty()) {
        out["editing"] = draft.editingId;
        out["asideName"] = draft.asideName;
        out["asideShapes"] = shapesToJson(draft.asideShapes);
    }
    if (draft.textMode) out["text"] = draft.text;
    return out.dump();
}

bool parseSkinDraft(const std::string& text, SkinDraft& out) {
    Json json;
    std::string error;
    if (!Json::parse(text, json, error) || !json.isObject()) return false;
    const Json& in = json;
    if (!in["shapes"].isArray()) return false;

    SkinDraft draft;
    draft.name = sanitizeSkinName(in["name"].asString());
    draft.shapes = shapesFromJson(in["shapes"]);
    const int last = static_cast<int>(draft.shapes.size()) - 1;
    draft.selected = std::min(std::max(in["selected"].asInt(last < 0 ? -1 : 0), -1), last);
    draft.editingId = in["editing"].asString();
    if (!draft.editingId.empty()) {
        draft.asideName = sanitizeSkinName(in["asideName"].asString());
        draft.asideShapes = shapesFromJson(in["asideShapes"]);
    }
    draft.textMode = in["text"].isString();
    draft.text = in["text"].asString();
    out = std::move(draft);
    return true;
}

bool writeSkinDraftFile(const std::string& path, const std::string& text) {
    std::FILE* file = std::fopen(path.c_str(), "wb");
    if (file == nullptr) return false;
    // Unbuffered: a buffer would hand the bytes over a few KB at a time.
    std::setvbuf(file, nullptr, _IONBF, 0);
    const bool wrote = std::fwrite(text.data(), 1, text.size(), file) == text.size();
    return std::fclose(file) == 0 && wrote;
}

} // namespace flix
