#pragma once

#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "shared/game/config.h"

namespace flix {

// Uses the same canvas widgets on native, web and offline builds.
inline void renderAdminDashboard(Canvas& canvas, Window& window, NetClient& net,
                                 double now, bool& open, Rect& bounds, Rect& launcher,
                                 bool& wantsText) {
    using namespace ui;
    struct State {
        std::string search, itemSearch, amount = "1", announcement;
        std::string target, targetName;
        TextFieldState playerField, itemField, amountField, announcementField;
        int tab = 0, rarity = 0, page = 0;
        std::size_t item = 0;
        bool wasOpen = false;
        double lastRefresh = -10;
        std::string status;
    };
    static State s;
    const Vec2 mouse{window.mouseX(), window.mouseY()};
    auto label = [&](const std::string& value, double x, double y, double size = 15.0) {
        TextStyle style; style.size = size;
        text(canvas, value, x, y, style);
    };
    auto action = [&](Rect r, const std::string& value, bool enabled = true) {
        ButtonStyle style; style.textSize = 14; style.enabled = enabled;
        style.shrinkToFit = true; style.fill = 0x456F88;
        button(canvas, r, value, r.contains(mouse), false, style);
        return enabled && r.contains(mouse) && window.mouseReleased(MouseButton::Left);
    };
    // All recipients see fresh owner announcements, even with chat closed.
    if (net.adminAnnouncementVisible()) {
        const double w = std::min(650.0, canvas.width() - 40.0);
        Rect notice{(canvas.width() - w) / 2, 85, w, 75};
        plate(canvas, notice, 0x332B18);
        label("ADMIN  /  a19kisme", notice.x + 15, notice.y + 20, 17);
        TextStyle body; body.size = 16;
        const double measured = measure(net.adminAnnouncement, body.size);
        if (measured > notice.w - 30) body.size *= (notice.w - 30) / measured;
        text(canvas, net.adminAnnouncement, notice.x + 15, notice.y + 49, body);
    }
    bounds = {}; launcher = {};
    if (!net.haveSession() || !net.isSkinAdmin()) { s = State{}; return; }
    launcher = {20, 155, net.adminDashboard["control"].asBool() ? 270.0 : 110.0, 34};
    if (action({20, 155, 110, 34}, open ? "Close Admin" : "Admin")) open = !open;
    if (net.adminDashboard["control"].asBool()) {
        if (now - s.lastRefresh > 2) {
            net.sendChat("/admin dashboard"); s.lastRefresh = now;
        }
        if (action({140, 155, 150, 34}, "Release flower")) {
            net.sendChat("/admin release");
            net.sendChat("/admin dashboard");
        }
    }
    if (!open) { s.wasOpen = false; return; }
    if (!s.wasOpen) { net.sendChat("/admin dashboard"); s.wasOpen = true; }
    if (window.keyPressed(Key::Escape)) { open = false; return; }
    const double w = std::min(760.0, canvas.width() - 24.0);
    bounds = {(canvas.width() - w) / 2, 120, w, std::min(620.0, canvas.height() - 140.0)};
    plate(canvas, bounds, 0x243442);
    const double x = bounds.x + 18, y = bounds.y + 24;
    label("Admin dashboard", x, y, 23);
    const char* tabs[] = {"Players & inventory", "Spawn mobs", "Give petals", "Announcements"};
    for (int i = 0; i < 4; ++i)
        if (action({x + i * (w - 36) / 4, y + 25, (w - 44) / 4, 32}, tabs[i])) {
            s.tab = i; s.page = 0; s.item = 0;
        }
    auto field = [&](Rect r, std::string& value, TextFieldState& state, const char* hint) {
        trackTextMouse(window, state, r, inputFieldRun(r, value, state), value, now);
        if (state.focused) { wantsText = true; TextEditOptions options; options.maxBytes = 120;
            editText(window, value, state, now, options); }
        inputField(canvas, r, value, hint, state.focused, now, &state);
    };
    auto refresh = [&] {
        net.sendChat("/admin dashboard" + (s.target.empty() ? "" : " " + s.target + " " + std::to_string(s.page)));
        s.lastRefresh = now;
    };
    auto command = [&](const std::string& cmd) {
        net.sendChat("/admin " + cmd); s.status = "Sent: " + cmd; refresh();
    };
    double top = y + 76;
    if (s.tab == 0 || s.tab == 2) {
        field({x, top, w - 150, 30}, s.search, s.playerField, "Search online flowers");
        if (action({bounds.right() - 116, top, 98, 30}, "Refresh")) refresh();
        top += 40;
        int shown = 0;
        for (const auto& player : net.adminDashboard["players"].items()) {
            const std::string username = player["username"].asString();
            const std::string name = player["name"].asString();
            if (!s.search.empty() && username.find(s.search) == std::string::npos &&
                name.find(s.search) == std::string::npos) continue;
            if (shown++ >= 4) break;
            const std::string id = player["id"].asString();
            if (action({x, top, w - 36, 27}, (s.target == id ? "Selected: " : "") + name + " (@" + username + ")")) {
                s.target = id; s.targetName = username; s.page = 0; refresh();
            }
            top += 32;
        }
        if (!shown) { label("No matching flowers online. Try Refresh.", x, top + 12); top += 32; }
    }
    if (s.tab == 0) {
        const bool selected = !s.target.empty();
        if (action({x, top, 150, 30}, "View inventory", selected)) { s.page = 0; refresh(); }
        if (action({x + 162, top, 150, 30}, "Control flower", selected)) {
            command("control " + s.target); open = false;
        }
        if (action({x + 324, top, 130, 30}, "Release")) command("release");
        top += 43;
        label("Inventory: " + s.targetName, x, top); top += 26;
        std::vector<std::string> rows;
        const auto& inventory = net.adminDashboard["inventory"];
        for (const auto& rarity : inventory.keys()) for (const auto& item : inventory[rarity].keys())
            rows.push_back(item + "  /  " + rarity + "  /  x" + inventory[rarity][item].dump());
        for (int i = 0; i < static_cast<int>(rows.size()); ++i) {
            label(rows[i], x, top, 14); top += 24;
        }
        if (selected && rows.empty()) label("No items to show. Refresh to check again.", x, top);
        if (action({x, bounds.bottom() - 55, 80, 28}, "Previous", s.page > 0)) { --s.page; refresh(); }
        if (action({x + 92, bounds.bottom() - 55, 80, 28}, "Next", (s.page + 1) * 6 < net.adminDashboard["inventoryTotal"].asInt())) { ++s.page; refresh(); }
    } else if (s.tab == 1 || s.tab == 2) {
        field({x, top, w - 36, 30}, s.itemSearch, s.itemField, "Search mob or petal name"); top += 42;
        std::vector<std::string> matches;
        const auto& registry = content();
        const std::size_t count = s.tab == 1 ? registry.mobCount() : registry.petalCount();
        for (std::size_t i = 0; i < count; ++i) {
            const std::string id = s.tab == 1 ? registry.mob(static_cast<std::uint16_t>(i)).id : registry.petal(static_cast<std::uint16_t>(i)).id;
            if (id.find(s.itemSearch) != std::string::npos) matches.push_back(id);
        }
        if (matches.empty()) { label("No matching items", x, top); return; }
        s.item %= matches.size();
        if (action({x, top, 48, 30}, "<")) s.item = (s.item + matches.size() - 1) % matches.size();
        label(matches[s.item], x + 62, top + 15);
        if (action({bounds.right() - 66, top, 48, 30}, ">")) s.item = (s.item + 1) % matches.size();
        top += 42;
        if (action({x, top, 190, 30}, std::string("Rarity: ") + rarityName(static_cast<Rarity>(s.rarity))))
            s.rarity = (s.rarity + 1) % (s.tab == 1 ? 10 : kRarityCount);
        field({x + 208, top, 100, 30}, s.amount, s.amountField, "Amount");
        top += 44;
        bool valid = !s.amount.empty() && s.amount.size() <= 6;
        for (char c : s.amount) valid = valid && c >= '0' && c <= '9';
        valid = valid && s.amount.find_first_not_of('0') != std::string::npos;
        if (action({x, top, 230, 34}, s.tab == 1 ? "Spawn at my flower" : "Give to selected flower", valid && (s.tab == 1 || !s.target.empty())))
            command((s.tab == 1 ? "spawn " : "give " + s.target + " ") + matches[s.item] + " " + rarityName(static_cast<Rarity>(s.rarity)) + " " + s.amount);
    } else {
        label("Only a19kisme can broadcast. Everyone receives the banner.", x, top, 14);
        field({x, top + 24, w - 36, 34}, s.announcement, s.announcementField, "Announcement text");
        if (action({x, top + 72, 210, 34}, "Send announcement", net.profile().username == "a19kisme" && !s.announcement.empty())) {
            command("announce " + s.announcement); s.announcement.clear();
        }
    }
    label(s.status.substr(0, 90), x, bounds.bottom() - 15, 12);
}
} // namespace flix
