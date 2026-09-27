// Dine-in orders — an extension of the shared order record, not a separate
// order system.
//
// A dine-in order is an ordinary /orders/{orderId} record with
// `order_type: "dine_in"` plus a `dine_in` block (DineInOrderInfo below). It
// uses the shared `status` values plus one of its own:
//   waiting_for_waiter_confirmation -> accepted ("Confirmed", now on the
//   kitchen board) -> preparing -> ready -> delivered (read as "Served")
// A guest's order never reaches the kitchen by itself: a waiter reviews it,
// may edit it, and confirms it (dine-in-orders.firebase.ts). It never involves
// a driver or the dispatch board. See docs/DINE_IN_TABLES_QR_HANDOVER.md.

import type { OrderStatus } from "@/lib/orders.firebase";
import { resolveOrderMode, tableLabelKey, type TableOrderMode } from "@/lib/tables.firebase";

/** Where every new dine-in order starts: out of the kitchen until a waiter confirms it. */
export const WAITING_FOR_WAITER_CONFIRMATION =
  "waiting_for_waiter_confirmation" satisfies OrderStatus;

/**
 * Whether a dine-in order is still waiting for a waiter to confirm it (and so
 * can be edited). Dine-in orders placed before the waiter step existed were
 * written as "pending"; they wait for confirmation in exactly the same way.
 */
export function isAwaitingWaiterConfirmation(status: string): boolean {
  return status === WAITING_FOR_WAITER_CONFIRMATION || status === "pending";
}

export type DineInErrorCode =
  | "dine-in/invalid-code"
  | "dine-in/table-not-found"
  | "dine-in/table-inactive"
  | "dine-in/invalid-guest"
  | "dine-in/invalid-items"
  | "dine-in/not-your-order"
  | "dine-in/order-not-found"
  | "dine-in/order-locked"
  | "dine-in/order-changed"
  | "dine-in/request-not-found"
  | "dine-in/request-closed"
  | "dine-in/request-taken";

/** Errors carry a `code`, which survives the Firestore error wrapper. */
export function dineInError(code: DineInErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** The signed-in staff member doing something (confirming, editing, answering a call). */
export interface StaffActor {
  id?: string | null;
  email: string | null;
  name?: string | null;
}

/** How a staff member is named on orders and requests: their name, else their email. */
export function staffActorLabel(actor: StaffActor | null | undefined): string {
  return (actor?.name ?? "").trim() || (actor?.email ?? "").trim() || "Staff";
}

/**
 * `orders/{id}.dine_in` — written by placeDineInOrder() (table-sessions.firebase.ts).
 *
 * Every order placed during one seating shares `table_session_id`. In
 * "multiple" mode each order belongs to exactly one guest (`guest_id`); in
 * "single" mode the table's one order collects every guest's items and lists
 * them as `contributors`.
 */
export interface DineInOrderInfo {
  table_id: string;
  /** Denormalised table number/name at the time of ordering, e.g. "12". */
  table_label: string;
  /** The seating's order mode when the order was placed (a snapshot). */
  order_mode: TableOrderMode;
  /** The seating this order belongs to. */
  table_session_id: string | null;
  /** Multiple mode: the guest who owns this order. Single mode: who started it. */
  guest_id: string | null;
  /** "Customer 2", or the guest's name when known. */
  guest_label: string | null;
  /** 1 for the first order of the table (single) or of the guest (multiple) in the seating, then 2… */
  round: number;
  /** Everyone who has added items to this order, in the order they first did. */
  contributors: DineInContributor[];
  waiter_id: string | null;
  waiter_name: string | null;
  /** When a waiter confirmed the order and sent it to the kitchen, and who. */
  confirmed_at: string | null;
  confirmed_by: string | null;
}

export interface DineInContributor {
  guest_id: string;
  label: string;
  first_added_at: string;
  /** Total quantity this guest has added. */
  item_count: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Normalise a stored `dine_in` block; null when it can't identify a table. */
export function normalizeDineIn(raw: unknown): DineInOrderInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tableId = str(r["table_id"]);
  const tableLabel = str(r["table_label"]);
  if (!tableId && !tableLabel) return null;
  const round = Number(r["round"]);
  return {
    table_id: tableId,
    table_label: tableLabel || tableId,
    order_mode: resolveOrderMode(r["order_mode"]),
    table_session_id: str(r["table_session_id"]) || null,
    guest_id: str(r["guest_id"]) || null,
    guest_label: str(r["guest_label"]) || null,
    round: Number.isInteger(round) && round > 0 ? round : 1,
    contributors: normalizeContributors(r["contributors"]),
    waiter_id: str(r["waiter_id"]) || null,
    waiter_name: str(r["waiter_name"]) || null,
    confirmed_at: str(r["confirmed_at"]) || null,
    confirmed_by: str(r["confirmed_by"]) || null,
  };
}

/** Stored as a map keyed by guest id; read as a list in the order guests joined. */
function normalizeContributors(raw: unknown): DineInContributor[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter((entry): entry is [string, Record<string, unknown>] =>
      Boolean(entry[1] && typeof entry[1] === "object"),
    )
    .map(([guestId, c]) => ({
      guest_id: guestId,
      label: str(c["label"]) || "Guest",
      first_added_at: str(c["first_added_at"]),
      item_count: Math.max(0, Math.floor(Number(c["item_count"]) || 0)),
    }))
    .sort((a, b) => a.first_added_at.localeCompare(b.first_added_at));
}

/** Dine-in wording for the shared order statuses. assigned / picked_up /
 *  on_the_way are driver steps a dine-in order never takes (setFirebaseOrderStatus
 *  refuses them); they're labelled only so a bad record still reads sensibly. */
export const DINE_IN_STATUS_LABEL: Record<OrderStatus, string> = {
  waiting_for_waiter_confirmation: "Waiting for waiter confirmation",
  // Legacy dine-in orders written before the waiter step (see isAwaitingWaiterConfirmation).
  pending: "Waiting for waiter confirmation",
  accepted: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  assigned: "Assigned",
  picked_up: "Picked up",
  on_the_way: "On the way",
  delivered: "Served",
  rejected: "Rejected",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/** Statuses a dine-in order is still open in (a guest is waiting on something). */
export const OPEN_DINE_IN_STATUSES: OrderStatus[] = [
  WAITING_FOR_WAITER_CONFIRMATION,
  "pending",
  "accepted",
  "preparing",
  "ready",
];

export function dineInStatusLabel(status: string): string {
  return DINE_IN_STATUS_LABEL[status as OrderStatus] ?? status.replace(/_/g, " ");
}

/**
 * Who a dine-in order belongs to. A multiple-mode order is one guest's; a
 * single-mode order is the whole table's, so it lists its contributors.
 */
export function customerSessionLabel(order: {
  customer_name: string | null | undefined;
  dine_in: Pick<DineInOrderInfo, "order_mode" | "guest_label" | "contributors"> | null;
}): { primary: string; secondary: string | null } {
  const dineIn = order.dine_in;
  if (dineIn?.order_mode === "single") {
    const names = dineIn.contributors.map((c) => c.label);
    const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
    return {
      primary: "Shared table order",
      secondary:
        names.length > 0 ? `${names.length} guest${names.length === 1 ? "" : "s"}: ${shown}` : null,
    };
  }
  const name = (order.customer_name ?? "").trim();
  const guest = dineIn?.guest_label ?? null;
  if (name && guest && name !== guest) return { primary: name, secondary: guest };
  return { primary: name || guest || "Guest", secondary: null };
}

export interface DineInFilters {
  restaurantId?: string;
  /** "all", "open", or a specific status ("waiting_for_waiter_confirmation" includes legacy "pending"). */
  status?: string;
  search?: string;
}

type FilterableOrder = {
  order_type: string;
  status: OrderStatus;
  order_number: string;
  restaurant_id: string;
  customer_name: string;
  created_at: string;
  placed_at: string;
  dine_in: DineInOrderInfo | null;
};

/** Dine-in orders matching the filters, newest first. */
export function filterDineInOrders<T extends FilterableOrder>(
  rows: T[],
  filters: DineInFilters = {},
): T[] {
  const search = filters.search?.trim().toLowerCase() ?? "";
  // "12" or "Table 12" finds table 12 exactly (not 1, 12A, 112…); words like
  // "patio" also match inside names such as "Patio 3".
  const tableQuery = tableLabelKey(search);
  const tableMatches = (label: string) => {
    const key = tableLabelKey(label);
    return key === tableQuery || (/[a-z]/.test(tableQuery) && key.includes(tableQuery));
  };
  const status = filters.status ?? "all";
  return rows
    .filter((o) => o.order_type === "dine_in")
    .filter(
      (o) =>
        !filters.restaurantId ||
        filters.restaurantId === "all" ||
        o.restaurant_id === filters.restaurantId,
    )
    .filter((o) =>
      status === "all"
        ? true
        : status === "open"
          ? OPEN_DINE_IN_STATUSES.includes(o.status)
          : status === WAITING_FOR_WAITER_CONFIRMATION
            ? isAwaitingWaiterConfirmation(o.status)
            : o.status === status,
    )
    .filter(
      (o) =>
        !search ||
        o.order_number.toLowerCase().includes(search) ||
        o.customer_name.toLowerCase().includes(search) ||
        (o.dine_in !== null && tableMatches(o.dine_in.table_label)) ||
        (o.dine_in?.guest_label ?? "").toLowerCase().includes(search) ||
        (o.dine_in?.contributors ?? []).some((c) => c.label.toLowerCase().includes(search)),
    )
    .sort((a, b) => (b.created_at || b.placed_at).localeCompare(a.created_at || a.placed_at));
}
