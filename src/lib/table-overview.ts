// Table overview — the live state of every table at a restaurant, derived from
// the tables (and the seating on each), the order book and guests' waiter
// calls. Pure, so the page can recompute it whenever any of them changes.

import { DINE_IN_STATUS_LABEL, OPEN_DINE_IN_STATUSES, type DineInOrderInfo } from "@/lib/dine-in";
import type { OrderStatus } from "@/lib/orders.firebase";
import {
  isSessionIdle,
  type RestaurantTable,
  type TableOrderMode,
  type TableSession,
} from "@/lib/tables.firebase";
import type { WaiterRequest } from "@/lib/waiter-requests.firebase";

export type TableOccupancy = "occupied" | "available" | "inactive";

export const OCCUPANCY_LABEL: Record<TableOccupancy, string> = {
  occupied: "Occupied",
  available: "Available",
  inactive: "Inactive",
};

/** Statuses that end an order without it being served. */
const ENDED_STATUSES: OrderStatus[] = ["rejected", "cancelled", "refunded"];

/** The order fields the overview reads (a DispatchOrder satisfies this). */
export interface OverviewSourceOrder {
  id: string;
  order_number: string;
  status: OrderStatus;
  order_type: string;
  restaurant_id: string;
  created_at: string;
  placed_at: string;
  customer_name: string;
  dine_in: DineInOrderInfo | null;
  items: { item_name: string; quantity: number }[];
}

export interface OverviewOrder {
  id: string;
  order_number: string;
  status: OrderStatus;
  status_label: string;
  /** Still being prepared or waiting to be served. */
  in_progress: boolean;
  guest_label: string;
  round: number;
  created_at: string;
  items: { item_name: string; quantity: number }[];
  /** Everyone who added to it (a shared table order has several). */
  contributors: string[];
}

export interface TableOverview {
  table: RestaurantTable;
  status: TableOccupancy;
  /** The mode in force: the open seating's, otherwise the table's. */
  mode: TableOrderMode;
  /** The table's configured mode when it differs from the open seating's — it applies once cleared. */
  next_mode: TableOrderMode | null;
  /** The seating currently at the table (null when the table is free). */
  session: TableSession | null;
  /** Everything ordered this seating that wasn't rejected or cancelled, oldest first. */
  orders: OverviewOrder[];
  /** The subset still being prepared or waiting to be served. */
  active_orders: OverviewOrder[];
  /** Single mode: the table's order — the open one, else the most recent. */
  table_order: OverviewOrder | null;
  /** Single mode: the table order's items added up, e.g. Steak ×2. */
  item_summary: { item_name: string; quantity: number }[];
  guest_count: number;
  /** Guests' waiter calls at this table that nobody has resolved yet, oldest first. */
  waiter_requests: WaiterRequest[];
}

function toOverviewOrder(o: OverviewSourceOrder): OverviewOrder {
  return {
    id: o.id,
    order_number: o.order_number,
    status: o.status,
    status_label: DINE_IN_STATUS_LABEL[o.status] ?? o.status,
    in_progress: OPEN_DINE_IN_STATUSES.includes(o.status),
    guest_label: o.dine_in?.guest_label ?? o.customer_name ?? "Guest",
    round: o.dine_in?.round ?? 1,
    created_at: o.created_at || o.placed_at,
    items: o.items,
    contributors: (o.dine_in?.contributors ?? []).map((c) => c.label),
  };
}

/** Add up identical items: Steak ×1 + Steak ×1 → Steak ×2, first-ordered first. */
export function summarizeItems(
  items: { item_name: string; quantity: number }[],
): { item_name: string; quantity: number }[] {
  const byName = new Map<string, number>();
  for (const item of items)
    byName.set(item.item_name, (byName.get(item.item_name) ?? 0) + item.quantity);
  return [...byName].map(([item_name, quantity]) => ({ item_name, quantity }));
}

/**
 * Status rules:
 *   - occupied: an order in the seating is still in progress, the seating is
 *     recent and has served orders (guests are still at the table), or a
 *     guest in the seating is waiting for a waiter;
 *   - available: nothing live in a seating — never ordered, cleared by staff,
 *     only rejected/cancelled orders, or idle past SESSION_IDLE_TIMEOUT_MS;
 *   - inactive: a free table that has been switched off.
 */
export function buildTableOverview(
  tables: RestaurantTable[],
  orders: OverviewSourceOrder[],
  now = Date.now(),
  waiterRequests: WaiterRequest[] = [],
): TableOverview[] {
  const bySession = new Map<string, OverviewSourceOrder[]>();
  for (const order of orders) {
    const sessionId = order.dine_in?.table_session_id;
    if (order.order_type !== "dine_in" || !sessionId) continue;
    const list = bySession.get(sessionId) ?? [];
    list.push(order);
    bySession.set(sessionId, list);
  }

  return tables.map((table) => {
    const seating = table.session;
    const seatingOrders = seating
      ? (bySession.get(seating.id) ?? []).filter(
          (o) => o.restaurant_id === table.restaurant_id && o.dine_in?.table_id === table.id,
        )
      : [];
    const orders = seatingOrders
      .filter((o) => !ENDED_STATUSES.includes(o.status))
      .map(toOverviewOrder)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const active = orders.filter((o) => o.in_progress);
    const recent = seating !== null && !isSessionIdle(seating, now);
    const calls = waiterRequests
      .filter(
        (r) =>
          r.status !== "resolved" &&
          r.restaurant_id === table.restaurant_id &&
          r.table_id === table.id,
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    // A guest who called before ordering is still a guest at the table.
    const calling = recent && calls.some((r) => r.table_session_id === seating?.id);
    const occupied = active.length > 0 || (recent && orders.length > 0) || calling;

    const session = occupied ? seating : null;
    const mode = session?.order_mode ?? table.order_mode;
    const tableOrder = mode === "single" ? (active.at(-1) ?? orders.at(-1) ?? null) : null;
    return {
      table,
      status: occupied ? "occupied" : table.active ? "available" : "inactive",
      mode,
      next_mode: session && session.order_mode !== table.order_mode ? table.order_mode : null,
      session,
      orders: occupied ? orders : [],
      active_orders: occupied ? active : [],
      table_order: occupied ? tableOrder : null,
      item_summary: occupied && tableOrder ? summarizeItems(tableOrder.items) : [],
      guest_count: session ? Object.keys(session.guests).length : 0,
      // Shown whatever the seating, so a call left open after the table was cleared still gets resolved.
      waiter_requests: calls,
    };
  });
}

export function summarizeOverview(entries: TableOverview[]) {
  return {
    tables: entries.length,
    occupied: entries.filter((e) => e.status === "occupied").length,
    available: entries.filter((e) => e.status === "available").length,
    inactive: entries.filter((e) => e.status === "inactive").length,
    active_orders: entries.reduce((sum, e) => sum + e.active_orders.length, 0),
    guests: entries.reduce((sum, e) => sum + e.guest_count, 0),
    waiter_requests: entries.reduce(
      (sum, e) => sum + e.waiter_requests.filter((r) => r.status === "open").length,
      0,
    ),
  };
}
