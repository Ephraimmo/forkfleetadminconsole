// Gives every open seating at a restaurant a waiter as soon as it needs one.
//
// Runs on staff devices only — each online waiter's Waiter screen and the
// console's Table overview — so a guest's app never touches the roster. It
// watches the tables and the roster; whenever a seating has no waiter and one
// is available, it assigns the next waiter in turn (assignSeatingWaiter). Many
// devices may run this at once: each assignment is a transaction, so a seating
// is only ever assigned once.

import { useEffect, useRef } from "react";

import type { RestaurantTable } from "@/lib/tables.firebase";
import {
  assignSeatingWaiter,
  pickNextWaiter,
  seatingsNeedingWaiter,
  type WaiterRoster,
} from "@/lib/waiters.firebase";

export function useAutoAssignWaiters(
  restaurantId: string | null,
  tables: RestaurantTable[] | null,
  roster: WaiterRoster | null,
  enabled = true,
) {
  // Seatings with an assignment in flight, so a burst of snapshots doesn't repeat it.
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled || !restaurantId || !tables || !roster) return;
    const waiters = Object.values(roster.waiters);
    for (const table of seatingsNeedingWaiter(tables)) {
      const sessionId = table.session!.id;
      if (inFlight.current.has(sessionId)) continue;
      if (!pickNextWaiter(waiters, table.branch_id)) continue; // nobody to give it to yet
      inFlight.current.add(sessionId);
      void assignSeatingWaiter({
        restaurant_id: restaurantId,
        table_id: table.id,
        session_id: sessionId,
      })
        .catch((err) => console.warn("[waiters] automatic assignment failed", err))
        .finally(() => inFlight.current.delete(sessionId));
    }
  }, [enabled, restaurantId, tables, roster]);
}
