#include "shared/net/admin_dashboard.h"

namespace flix::net {

void writeAdminDashboardPlayer(ByteWriter& w, const AdminDashboardPlayer& row) {
    w.u32(row.connection);
    w.str(row.username);
    w.str(row.name);
    w.u8(static_cast<std::uint8_t>(row.realm));
    w.u8(row.flags);
}

bool readAdminDashboardPlayer(ByteReader& r, AdminDashboardPlayer& out) {
    out.connection = r.u32();
    out.username = r.str();
    out.name = r.str();
    // Through the realm's own guard: a byte past the realms this build can
    // hold reads as the overworld rather than indexing off the end of a table.
    out.realm = realmFromByte(r.u8());
    out.flags = r.u8();
    return r.ok();
}

void writeAdminDashboardStack(ByteWriter& w, const AdminDashboardStack& stack) {
    w.u16(stack.petalIndex);
    w.u8(static_cast<std::uint8_t>(stack.rarity));
    w.u32(stack.count);
}

bool readAdminDashboardStack(ByteReader& r, AdminDashboardStack& out) {
    out.petalIndex = r.u16();
    out.rarity = clampRarity(r.u8());
    out.count = r.u32();
    return r.ok();
}

} // namespace flix::net
