// Waiter actions on a dine-in order, in the order they happen:
//
//   1. editDineInOrder()          review and change what the guests chose
//   2. confirmDineInOrder()       confirm it with the table ("waiter_confirmed")
//   3. sendDineInOrderToKitchen() only now does the kitchen see it ("accepted")
//      … the kitchen cooks it and marks it "ready", and the waiter is alerted …
//   4. markDineInOrderServed()    served at the table ("delivered")
//
// A guest's order arrives as "waiting_for_waiter_confirmation" and stays out
// of the kitchen until a waiter has confirmed it and sent it. Until it is sent
// the waiter can change anything a guest chose: items, quantities, sizes,
// add-ons and modifiers, item notes and the special instructions, and can
// leave a note on the order's history. Every edit is kept in the order's
// `edits`, with each changed line exactly as it was before and after, so the
// customer's original order is never overwritten without a record. Editing a
// confirmed order withdraws the confirmation: it has to be confirmed again
// before it can be sent. Once confirmed, guests can't add to the order; their
// later items start a new order, which waits for confirmation in turn
// (table-sessions.firebase.ts). Once sent, the order is locked.
//
// setFirebaseOrderStatus() refuses these steps for dine-in orders, so these
// functions are the only way through them, and each records who took it.
// Every action reads and rewrites the order in one transaction, so none of
// them race a guest adding items to the same order and silently drop them.

import {
  fsTransaction,
  isFirebaseAvailable,
  type FirestoreValue,
  type FsTransaction,
} from "@/lib/firestore";
import {
  dineInError,
  isAwaitingWaiterConfirmation,
  isWithWaiter,
  staffActorLabel,
  WAITER_CONFIRMED,
  WAITING_FOR_WAITER_CONFIRMATION,
  type StaffActor,
} from "@/lib/dine-in";
import {
  applyOrderEdit,
  MAX_TEXT,
  priceOrder,
  randomId,
  recountContributors,
  type OrderEdit,
  type OrderEditRecord,
} from "@/lib/dine-in-order-edit";
import {
  orderType,
  type FirebaseOrder,
  type OrderLine,
  type TimelineEvent,
} from "@/lib/orders.firebase";
import { SAFE_ID } from "@/lib/table-sessions.firebase";
import { tableDisplayName } from "@/lib/tables.firebase";

/** An order document as stored: lines and history are maps inside it. */
type StoredOrder = Omit<FirebaseOrder, "dine_in" | "edits"> & {
  items?: Record<string, OrderLine>;
  timeline?: Record<string, TimelineEvent>;
  edits?: Record<string, OrderEditRecord>;
  dine_in?: Record<string, unknown> & {
    table_label?: string;
    waiter_id?: string | null;
    waiter_name?: string | null;
    confirmed_at?: string | null;
    contributors?: Record<string, { label?: string; first_added_at?: string; item_count?: number }>;
  };
};

/** The waiter steps, each allowed from exactly one point in the order's life. */
type WaiterStep = "edit" | "confirm" | "send" | "serve";

const orderPath = (orderId: string) => `orders/${orderId}`;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
// Cast at the write boundary — see the same helper in orders.firebase.ts.
const w = (v: unknown): FirestoreValue => v as FirestoreValue;

function event(
  status: TimelineEvent["status"],
  note: string,
  actor: string,
  at: string,
): TimelineEvent {
  return { id: randomId("tl"), status, at, note, actor };
}

function allows(step: WaiterStep, status: string): boolean {
  switch (step) {
    case "edit":
      return isWithWaiter(status);
    case "confirm":
      return isAwaitingWaiterConfirmation(status);
    case "send":
      return status === WAITER_CONFIRMED;
    case "serve":
      return status === "ready";
  }
}

/** Why `step` can't be taken on this order right now, in the waiter's words. */
function lockedReason(order: StoredOrder, step: WaiterStep): string {
  const n = order.order_number;
  const s = order.status as string;
  if (s === "rejected" || s === "cancelled" || s === "refunded") {
    const verb = { edit: "edited", confirm: "confirmed", send: "sent", serve: "served" }[step];
    return `Order ${n} can't be ${verb} — it was ${s}.`;
  }
  switch (step) {
    case "edit":
      return `Order ${n} can't be edited — it has already been sent to the kitchen.`;
    case "confirm":
      return s === WAITER_CONFIRMED
        ? `Order ${n} has already been confirmed.`
        : `Order ${n} can't be confirmed — it has already been sent to the kitchen.`;
    case "send":
      return isAwaitingWaiterConfirmation(s)
        ? `Order ${n} can't go to the kitchen yet — confirm it with the table first.`
        : `Order ${n} has already been sent to the kitchen.`;
    case "serve":
      return s === "delivered"
        ? `Order ${n} has already been served.`
        : `Order ${n} can't be served yet — the kitchen hasn't marked it ready.`;
  }
}

/** Read a dine-in order `step` may be taken on, or explain why it can't. */
async function readForStep(
  tx: FsTransaction,
  orderId: string,
  step: WaiterStep,
): Promise<StoredOrder> {
  if (!SAFE_ID.test(orderId)) {
    throw dineInError("dine-in/order-not-found", "That order doesn't exist.");
  }
  const order = await tx.get<StoredOrder>(orderPath(orderId));
  if (!order) throw dineInError("dine-in/order-not-found", "That order doesn't exist.");
  if (orderType(order) !== "dine_in") {
    throw dineInError(
      "dine-in/order-locked",
      "Only dine-in orders wait for a waiter's confirmation.",
    );
  }
  if (!allows(step, order.status)) {
    throw dineInError("dine-in/order-locked", lockedReason(order, step));
  }
  return order;
}

/** The order's waiter: kept when already set, otherwise whoever is acting on it now. */
function waiterFields(dineIn: NonNullable<StoredOrder["dine_in"]>, actor: StaffActor) {
  return {
    waiter_id: str(dineIn.waiter_id) || str(actor.id) || str(actor.email) || null,
    waiter_name: str(dineIn.waiter_name) || staffActorLabel(actor),
  };
}

/**
 * Confirm a dine-in order with the table ("waiter_confirmed"). It does NOT go
 * to the kitchen yet — that takes sendDineInOrderToKitchen(). From here on
 * guests can't add to it (their next items start a new order).
 *
 * Pass `reviewed_line_ids` — the lines the waiter was looking at — and the
 * confirmation is refused if a guest has added anything since, so a waiter
 * never confirms items they haven't seen. The confirming waiter becomes the
 * order's waiter unless one is already set.
 */
export async function confirmDineInOrder(input: {
  order_id: string;
  reviewed_line_ids?: string[] | null;
  actor: StaffActor;
}): Promise<{ order_number: string }> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  return fsTransaction(async (tx) => {
    const order = await readForStep(tx, input.order_id, "confirm");
    const lineIds = Object.keys(order.items ?? {});
    if (lineIds.length === 0) {
      throw dineInError("dine-in/invalid-items", "This order has no items to confirm.");
    }
    if (input.reviewed_line_ids) {
      const reviewed = new Set(input.reviewed_line_ids);
      if (lineIds.some((id) => !reviewed.has(id))) {
        throw dineInError(
          "dine-in/order-changed",
          "A guest just added to this order — review the new items, then confirm.",
        );
      }
    }

    const ts = new Date().toISOString();
    const who = staffActorLabel(input.actor);
    const dineIn = order.dine_in ?? {};
    const confirmed = event(WAITER_CONFIRMED, `Confirmed with the table by ${who}`, who, ts);
    tx.set(
      orderPath(order.id),
      w({
        ...order,
        status: WAITER_CONFIRMED,
        updated_at: ts,
        dine_in: {
          ...dineIn,
          confirmed_at: ts,
          confirmed_by: who,
          ...waiterFields(dineIn, input.actor),
        },
        timeline: { ...(order.timeline ?? {}), [confirmed.id]: confirmed },
      }),
    );
    return { order_number: order.order_number };
  });
}

/**
 * Send a confirmed dine-in order to the kitchen ("accepted" — the first
 * column of the kitchen board). Refused unless a waiter has confirmed it, so
 * an unconfirmed order never reaches the kitchen.
 */
export async function sendDineInOrderToKitchen(input: {
  order_id: string;
  actor: StaffActor;
}): Promise<{ order_number: string }> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  return fsTransaction(async (tx) => {
    const order = await readForStep(tx, input.order_id, "send");
    const dineIn = order.dine_in ?? {};
    if (!str(dineIn.confirmed_at)) {
      throw dineInError(
        "dine-in/order-locked",
        lockedReason({ ...order, status: "pending" }, "send"),
      );
    }
    if (Object.keys(order.items ?? {}).length === 0) {
      throw dineInError("dine-in/invalid-items", "This order has no items to send to the kitchen.");
    }

    const ts = new Date().toISOString();
    const who = staffActorLabel(input.actor);
    const sent = event("accepted", `Sent to the kitchen by ${who}`, who, ts);
    tx.set(
      orderPath(order.id),
      w({
        ...order,
        status: "accepted",
        accepted_at: ts,
        updated_at: ts,
        dine_in: { ...dineIn, sent_to_kitchen_at: ts, sent_to_kitchen_by: who },
        timeline: { ...(order.timeline ?? {}), [sent.id]: sent },
      }),
    );
    return { order_number: order.order_number };
  });
}

export interface ServedDineInOrder {
  order_id: string;
  order_number: string;
  table_label: string;
  served_at: string;
  served_by: string;
}

/**
 * Mark a dine-in order the kitchen has finished as served at the table
 * ("delivered", read as "Served"). Records the order, its table, the waiter
 * who served it and when. The waiter becomes the order's waiter unless one
 * is already set.
 */
export async function markDineInOrderServed(input: {
  order_id: string;
  actor: StaffActor;
}): Promise<ServedDineInOrder> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  return fsTransaction(async (tx) => {
    const order = await readForStep(tx, input.order_id, "serve");
    const ts = new Date().toISOString();
    const who = staffActorLabel(input.actor);
    const dineIn = order.dine_in ?? {};
    const tableLabel = str(dineIn.table_label);
    const served = event(
      "delivered",
      `Served at ${tableDisplayName(tableLabel || "—")} by ${who}`,
      who,
      ts,
    );
    tx.set(
      orderPath(order.id),
      w({
        ...order,
        status: "delivered",
        delivered_at: ts,
        eta_minutes: 0,
        eta_at: null,
        updated_at: ts,
        dine_in: {
          ...dineIn,
          served_at: ts,
          served_by: who,
          served_by_id: str(input.actor.id) || str(input.actor.email) || null,
          ...waiterFields(dineIn, input.actor),
        },
        timeline: { ...(order.timeline ?? {}), [served.id]: served },
      }),
    );
    return {
      order_id: order.id,
      order_number: order.order_number,
      table_label: tableLabel,
      served_at: ts,
      served_by: who,
    };
  });
}

export interface EditDineInOrderResult {
  /** What changed, in words (also written to the order's history). */
  changes: string[];
  /** Whether a note was added to the order's history. */
  noted: boolean;
  /** Every line on the order afterwards (confirm with these to confirm exactly what was saved). */
  line_ids: string[];
  /** The record added to the order's edit history (null when nothing on the order changed). */
  edit: OrderEditRecord | null;
  /** The order had been confirmed, and now has to be confirmed again. */
  confirmation_withdrawn: boolean;
}

/**
 * Apply a waiter's edit to a dine-in order that hasn't gone to the kitchen:
 * add, remove and change lines (quantity, size, add-ons and modifiers,
 * notes), change the special instructions, and/or add a note to the order's
 * history. Totals are recalculated, and the change is kept in the order's
 * `edits` — each changed line as it was and as it became, who changed it and
 * when. Items a guest added while the waiter was editing are kept. See
 * applyOrderEdit() for the rules.
 *
 * Editing a confirmed order puts it back to waiting for confirmation.
 */
export async function editDineInOrder(
  input: OrderEdit & {
    order_id: string;
    /** Optional note for the order's history (staff only; not shown to the kitchen). */
    note?: string | null;
    actor: StaffActor;
  },
): Promise<EditDineInOrderResult> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const note = str(input.note).slice(0, MAX_TEXT) || null;
  return fsTransaction(async (tx) => {
    const order = await readForStep(tx, input.order_id, "edit");
    const ts = new Date().toISOString();
    const who = staffActorLabel(input.actor);
    const applied = applyOrderEdit(
      { items: order.items, special_instructions: order.special_instructions },
      input,
      { at: ts, editor: who },
    );
    const lineIds = Object.keys(applied.items);
    const changed = applied.changes.length > 0;
    if (!changed && !note) {
      return {
        changes: [],
        noted: false,
        line_ids: lineIds,
        edit: null,
        confirmation_withdrawn: false,
      };
    }

    const withdrawn = changed && order.status === WAITER_CONFIRMED;
    const price = priceOrder(Object.values(applied.items), {
      delivery_fee: Number(order.delivery_fee) || 0,
      tax: Number(order.tax) || 0,
      tip: Number(order.tip) || 0,
      discount: Number(order.discount) || 0,
    });
    const history: Record<string, TimelineEvent> = { ...(order.timeline ?? {}) };
    const edits: Record<string, OrderEditRecord> = { ...(order.edits ?? {}) };
    let record: OrderEditRecord | null = null;
    if (changed) {
      const summary = applied.changes.join("; ");
      const edited = event(
        "note",
        `Edited by ${who}: ${summary}${withdrawn ? " — confirmation withdrawn, confirm the order again" : ""}`,
        who,
        ts,
      );
      history[edited.id] = edited;
      const before = order.special_instructions ?? null;
      record = {
        id: randomId("ed"),
        at: ts,
        by: who,
        by_id: str(input.actor.id) || str(input.actor.email) || null,
        status_before: order.status,
        lines: applied.line_changes,
        special_instructions:
          before !== applied.special_instructions
            ? { from: before, to: applied.special_instructions }
            : null,
        summary,
        total_before: Number(order.total) || 0,
        total_after: price.total,
        confirmation_withdrawn: withdrawn,
      };
      edits[record.id] = record;
    }
    if (note) {
      const noted = event("note", `Note from ${who}: ${note}`, who, ts);
      history[noted.id] = noted;
    }
    const dineIn = order.dine_in ?? {};
    tx.set(
      orderPath(order.id),
      w({
        ...order,
        ...price,
        status: withdrawn ? WAITING_FOR_WAITER_CONFIRMATION : order.status,
        items: applied.items,
        special_instructions: applied.special_instructions,
        dine_in: {
          ...dineIn,
          contributors: recountContributors(dineIn.contributors, applied.items),
          ...(withdrawn ? { confirmed_at: null, confirmed_by: null } : {}),
        },
        timeline: history,
        edits,
        updated_at: ts,
      }),
    );
    return {
      changes: applied.changes,
      noted: Boolean(note),
      line_ids: lineIds,
      edit: record,
      confirmation_withdrawn: withdrawn,
    };
  });
}

/** "Table 12 · FF-123456" — how a dine-in order is named in toasts. */
export function dineInOrderName(order: {
  order_number: string;
  dine_in?: { table_label?: string | null } | null;
}): string {
  const table = str(order.dine_in?.table_label);
  return table ? `${tableDisplayName(table)} · ${order.order_number}` : order.order_number;
}
