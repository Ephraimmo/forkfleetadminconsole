// Waiter actions on a dine-in order: edit it while it waits for confirmation,
// then confirm it, which sends it to the kitchen.
//
// A guest's order arrives as "waiting_for_waiter_confirmation" and stays out
// of the kitchen until a waiter confirms it here ("accepted" — the kitchen
// board's first column). Until then the waiter can change anything a guest
// chose: items, quantities, sizes, add-ons and modifiers, item notes and the
// special instructions, and can leave a note on the order's history. Once
// confirmed, the order is locked; later items from the table start a new
// order, which waits for confirmation in turn (table-sessions.firebase.ts).
//
// Both actions read and rewrite the order in one transaction, so they never
// race a guest adding items to the same order and silently drop them.

import {
  fsTransaction,
  isFirebaseAvailable,
  type FirestoreValue,
  type FsTransaction,
} from "@/lib/firestore";
import {
  dineInError,
  isAwaitingWaiterConfirmation,
  staffActorLabel,
  type StaffActor,
} from "@/lib/dine-in";
import {
  applyOrderEdit,
  MAX_TEXT,
  priceOrder,
  randomId,
  recountContributors,
  type OrderEdit,
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
type StoredOrder = Omit<FirebaseOrder, "dine_in"> & {
  items?: Record<string, OrderLine>;
  timeline?: Record<string, TimelineEvent>;
  dine_in?: Record<string, unknown> & {
    table_label?: string;
    waiter_id?: string | null;
    waiter_name?: string | null;
    contributors?: Record<string, { label?: string; first_added_at?: string; item_count?: number }>;
  };
};

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

/** Read a dine-in order that is still waiting for confirmation, or explain why it can't be changed. */
async function readAwaitingOrder(
  tx: FsTransaction,
  orderId: string,
  action: "edit" | "confirm",
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
  if (!isAwaitingWaiterConfirmation(order.status)) {
    const why =
      order.status === "rejected" || order.status === "cancelled" || order.status === "refunded"
        ? `it was ${order.status}`
        : "it has already been confirmed and sent to the kitchen";
    throw dineInError(
      "dine-in/order-locked",
      action === "edit"
        ? `Order ${order.order_number} can't be edited — ${why}.`
        : `Order ${order.order_number} can't be confirmed — ${why}.`,
    );
  }
  return order;
}

/**
 * Confirm a dine-in order and send it to the kitchen ("accepted").
 *
 * Pass `reviewed_line_ids` — the lines the waiter was looking at — and the
 * confirmation is refused if a guest has added anything since, so a waiter
 * never sends the kitchen items they haven't seen. The confirming waiter
 * becomes the order's waiter unless one is already set.
 */
export async function confirmDineInOrder(input: {
  order_id: string;
  reviewed_line_ids?: string[] | null;
  actor: StaffActor;
}): Promise<{ order_number: string }> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  return fsTransaction(async (tx) => {
    const order = await readAwaitingOrder(tx, input.order_id, "confirm");
    const lineIds = Object.keys(order.items ?? {});
    if (lineIds.length === 0) {
      throw dineInError("dine-in/invalid-items", "This order has no items to send to the kitchen.");
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
    const confirmed = event("accepted", `Confirmed by ${who} — sent to the kitchen`, who, ts);
    tx.set(
      orderPath(order.id),
      w({
        ...order,
        status: "accepted",
        accepted_at: ts,
        updated_at: ts,
        dine_in: {
          ...dineIn,
          confirmed_at: ts,
          confirmed_by: who,
          waiter_id: str(dineIn.waiter_id) || str(input.actor.id) || str(input.actor.email) || null,
          waiter_name: str(dineIn.waiter_name) || who,
        },
        timeline: { ...(order.timeline ?? {}), [confirmed.id]: confirmed },
      }),
    );
    return { order_number: order.order_number };
  });
}

export interface EditDineInOrderResult {
  /** What changed, in words (also written to the order's history). */
  changes: string[];
  /** Whether a note was added to the order's history. */
  noted: boolean;
  /** Every line on the order afterwards (confirm with these to send exactly what was saved). */
  line_ids: string[];
}

/**
 * Apply a waiter's edit to a dine-in order that is still waiting for
 * confirmation: add, remove and change lines (quantity, size, add-ons and
 * modifiers, notes), change the special instructions, and/or add a note to
 * the order's history. Totals are recalculated. Items a guest added while the
 * waiter was editing are kept. See applyOrderEdit() for the rules.
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
    const order = await readAwaitingOrder(tx, input.order_id, "edit");
    const ts = new Date().toISOString();
    const who = staffActorLabel(input.actor);
    const applied = applyOrderEdit(
      { items: order.items, special_instructions: order.special_instructions },
      input,
      { at: ts, editor: who },
    );
    const lineIds = Object.keys(applied.items);
    if (applied.changes.length === 0 && !note) {
      return { changes: [], noted: false, line_ids: lineIds };
    }

    const history: Record<string, TimelineEvent> = { ...(order.timeline ?? {}) };
    if (applied.changes.length > 0) {
      const edited = event("note", `Edited by ${who}: ${applied.changes.join("; ")}`, who, ts);
      history[edited.id] = edited;
    }
    if (note) {
      const noted = event("note", `Note from ${who}: ${note}`, who, ts);
      history[noted.id] = noted;
    }
    const price = priceOrder(Object.values(applied.items), {
      delivery_fee: Number(order.delivery_fee) || 0,
      tax: Number(order.tax) || 0,
      tip: Number(order.tip) || 0,
      discount: Number(order.discount) || 0,
    });
    const dineIn = order.dine_in ?? {};
    tx.set(
      orderPath(order.id),
      w({
        ...order,
        ...price,
        items: applied.items,
        special_instructions: applied.special_instructions,
        dine_in: {
          ...dineIn,
          contributors: recountContributors(dineIn.contributors, applied.items),
        },
        timeline: history,
        updated_at: ts,
      }),
    );
    return { changes: applied.changes, noted: Boolean(note), line_ids: lineIds };
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
