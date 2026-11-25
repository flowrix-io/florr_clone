#pragma once
// Two owners of one account row, reconciled.
//
// While a flower is in the world of a sharded game its progress row is lent to
// the server simulating it, and that server's copy is the row. But the gateway
// still has things to change in it -- a market sale, a star code, an admin's
// `give` -- and it changes its own copy, with the handlers a single server
// changes the row with. What crosses the link is the DIFFERENCE that made:
// star balances, XP, bag counts and kill counts as amounts to add, everything
// else as values to set. Amounts commute, so a petal the flower picked up
// while a sale was in flight and the sale itself both land, in either order.
//
// cpp/docs/ARCHITECTURE.md, "Sharding".

#include <string>

#include "shared/core/json.h"

namespace flix {

/// What turns `from` into `to`, or null when nothing differs.
Json rowDifference(const Json& from, const Json& to);

/// Applies a difference. An amount that would take a count below zero leaves
/// it at zero: whatever the other side spent meanwhile is spent.
void applyRowDifference(Json& row, const Json& difference);

} // namespace flix
