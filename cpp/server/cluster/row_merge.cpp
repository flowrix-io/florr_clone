#include "server/cluster/row_merge.h"

#include <algorithm>
#include <array>
#include <cstring>

namespace flix {

namespace {

// A difference is an object of member name -> edit, each edit an array whose
// first element says what kind it is:
//   ["+", amount]   add to a number
//   ["=", value]    set
//   ["-"]           erase
//   [".", {...}]    the members of an object, the same way again

/// The members of a row that are amounts: everything under them is added
/// rather than set. The rest -- the ring, the talents, the streak date -- are
/// values, and the last to set one wins.
bool isAmount(const std::string& member) {
    static constexpr std::array<const char*, 6> kAmounts = {
        {"totalXP", "mazeTotalXP", "stars", "casinoChips", "inventory", "mobKills"}};
    return std::any_of(kAmounts.begin(), kAmounts.end(),
                       [&](const char* name) { return member == name; });
}

Json edit(const char* kind) {
    Json e = Json::array();
    e.push(Json(kind));
    return e;
}

bool same(const Json& a, const Json& b) {
    if (a.type() != b.type()) return false;
    switch (a.type()) {
        case Json::Type::Null: return true;
        case Json::Type::Bool: return a.asBool() == b.asBool();
        case Json::Type::Number: return a.asDouble() == b.asDouble();
        case Json::Type::String: return a.stringRef() == b.stringRef();
        case Json::Type::Array: {
            if (a.size() != b.size()) return false;
            for (std::size_t i = 0; i < a.size(); ++i) {
                if (!same(a[i], b[i])) return false;
            }
            return true;
        }
        case Json::Type::Object: {
            if (a.size() != b.size()) return false;
            for (const auto& [key, value] : a.members()) {
                if (!b.contains(key) || !same(value, b[key])) return false;
            }
            return true;
        }
    }
    return false;
}

Json difference(const Json& from, const Json& to, bool amounts, bool top) {
    Json out = Json::object();
    const auto compare = [&](const std::string& key) {
        const Json& a = from[key];
        const Json& b = to[key];
        const bool had = from.contains(key);
        const bool has = to.contains(key);
        const bool amount = amounts || (top && isAmount(key));
        if (amount && (a.isNumber() || !had || a.isNull()) && (b.isNumber() || !has || b.isNull())) {
            // Absent is zero: a stack that empties is erased from the bag.
            const double delta = b.asDouble(0) - a.asDouble(0);
            if (delta == 0) return;
            Json e = edit("+");
            e.push(Json(delta));
            out[key] = std::move(e);
            return;
        }
        const bool nested = (a.isObject() || !had) && (b.isObject() || (amount && !has));
        if (nested && (amount || (had && has))) {
            Json inner = difference(a, b, amount, false);
            if (inner.isNull()) return;
            Json e = edit(".");
            e.push(std::move(inner));
            out[key] = std::move(e);
            return;
        }
        if (!has) {
            out[key] = edit("-");
            return;
        }
        if (had && same(a, b)) return;
        Json e = edit("=");
        e.push(b);
        out[key] = std::move(e);
    };
    for (const std::string& key : from.keys()) compare(key);
    for (const std::string& key : to.keys()) {
        if (!from.contains(key)) compare(key);
    }
    return out.size() == 0 ? Json() : out;
}

} // namespace

Json rowDifference(const Json& from, const Json& to) { return difference(from, to, false, true); }

void applyRowDifference(Json& row, const Json& change) {
    if (!change.isObject()) return;
    for (const std::string& key : change.keys()) {
        const Json& e = change[key];
        if (!e.isArray() || e.size() == 0) continue;
        const std::string kind = e[0].asString();
        if (kind == "-") {
            row.erase(key);
        } else if (kind == "=" && e.size() > 1) {
            row[key] = e[1];
        } else if (kind == "+" && e.size() > 1) {
            const Json& held = std::as_const(row)[key];
            row[key] = Json(std::max(0.0, held.asDouble(0) + e[1].asDouble(0)));
        } else if (kind == "." && e.size() > 1) {
            Json& inner = row[key];
            if (!inner.isObject()) inner = Json::object();
            applyRowDifference(inner, e[1]);
        }
    }
}

} // namespace flix
