#include "shared/net/admin_db.h"

namespace flix::net {

namespace {

/// Deeper than any document the database holds. A bound only so a malformed
/// frame cannot recurse the reader off the end of the stack.
constexpr int kMaxDepth = 64;

/// `loadDepth` is how many more container levels to send loaded: negative is
/// all of them, zero sends this node unloaded.
void writeNode(ByteWriter& w, const Json& value, int loadDepth) {
    w.u8(static_cast<std::uint8_t>(value.type()));
    switch (value.type()) {
        case Json::Type::Null:
            break;
        case Json::Type::Bool:
            w.boolean(value.asBool());
            break;
        case Json::Type::Number:
            w.f64(value.asDouble());
            break;
        case Json::Type::String: {
            const std::string& text = value.stringRef();
            const bool fits = text.size() <= kAdminDbMaxString;
            w.boolean(fits);
            if (fits) w.str(text);
            else w.u32(static_cast<std::uint32_t>(text.size()));
            break;
        }
        case Json::Type::Array:
        case Json::Type::Object: {
            w.u32(static_cast<std::uint32_t>(value.size()));
            const bool load = loadDepth != 0;
            w.boolean(load);
            if (!load) break;
            const int next = loadDepth < 0 ? -1 : loadDepth - 1;
            if (value.isArray()) {
                for (const Json& item : value.items()) writeNode(w, item, next);
            } else {
                for (const std::string& key : value.keys()) {
                    w.str(key);
                    writeNode(w, value[key], next);
                }
            }
            break;
        }
    }
}

bool readNode(ByteReader& r, AdminDbNode& out, int depth) {
    if (depth > kMaxDepth) return false;
    const std::uint8_t type = r.u8();
    if (type > static_cast<std::uint8_t>(Json::Type::Object)) return false;
    out = AdminDbNode{};
    out.type = static_cast<Json::Type>(type);
    switch (out.type) {
        case Json::Type::Null:
            break;
        case Json::Type::Bool:
            out.boolean = r.boolean();
            break;
        case Json::Type::Number:
            out.number = r.f64();
            break;
        case Json::Type::String:
            if (r.boolean()) {
                out.text = r.str();
                out.size = static_cast<std::uint32_t>(out.text.size());
            } else {
                out.unloaded = true;
                out.size = r.u32();
            }
            break;
        case Json::Type::Array:
        case Json::Type::Object: {
            out.size = r.u32();
            out.unloaded = !r.boolean();
            if (out.unloaded) break;
            // Every child costs at least its type byte, so a count past what
            // is left in the frame is a lie -- refused before it is reserved.
            if (out.size > r.remaining()) return false;
            out.keys.reserve(out.size);
            out.children.reserve(out.size);
            for (std::uint32_t i = 0; i < out.size; ++i) {
                out.keys.push_back(out.type == Json::Type::Object ? r.str() : std::to_string(i));
                out.children.emplace_back();
                if (!readNode(r, out.children.back(), depth + 1)) return false;
            }
            break;
        }
    }
    return r.ok();
}

} // namespace

void writeAdminDbPath(ByteWriter& w, const AdminDbPath& path) {
    const std::size_t steps = path.size() > 255 ? 255 : path.size();
    w.u8(static_cast<std::uint8_t>(steps));
    for (std::size_t i = 0; i < steps; ++i) w.str(path[i]);
}

AdminDbPath readAdminDbPath(ByteReader& r) {
    AdminDbPath path;
    const std::uint8_t steps = r.u8();
    path.reserve(steps);
    for (std::uint8_t i = 0; i < steps && r.ok(); ++i) path.push_back(r.str());
    return path;
}

AdminDbNode* AdminDbNode::child(const std::string& key) {
    for (std::size_t i = 0; i < keys.size(); ++i) {
        if (keys[i] == key) return &children[i];
    }
    return nullptr;
}

const AdminDbNode* AdminDbNode::child(const std::string& key) const {
    return const_cast<AdminDbNode*>(this)->child(key);
}

AdminDbNode* AdminDbNode::find(const AdminDbPath& path) {
    AdminDbNode* node = this;
    for (const std::string& step : path) {
        node = node->child(step);
        if (node == nullptr) return nullptr;
    }
    return node;
}

void writeAdminDbNode(ByteWriter& w, const Json& value) {
    // Encoded into a scratch writer first, because the budget is a question
    // about the RESULT: a document's size is not known until it is written.
    // The account documents always pass the first attempt; only a large table
    // ever falls through to the shallow one.
    for (const int loadDepth : {-1, 1}) {
        ByteWriter trial(4096);
        writeNode(trial, value, loadDepth);
        if (trial.size() <= kAdminDbNodeBudget) {
            w.raw(trial.data(), trial.size());
            return;
        }
    }
    writeNode(w, value, 0);
}

bool readAdminDbNode(ByteReader& r, AdminDbNode& out) { return readNode(r, out, 0); }

std::string adminDbScalarText(const AdminDbNode& node) {
    switch (node.type) {
        case Json::Type::Null: return "null";
        case Json::Type::Bool: return node.boolean ? "true" : "false";
        case Json::Type::Number: return Json(node.number).dump();
        case Json::Type::String: return node.text;
        case Json::Type::Array:
        case Json::Type::Object: break;
    }
    return {};
}

} // namespace flix::net
