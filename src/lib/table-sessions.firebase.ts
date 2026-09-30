// Dine-in ordering at a table: seatings, and how orders attach to them.
//
// A *seating* (TableSession, stored on the table as `session`) groups
// everything ordered at a table from the first order until staff clear the
// table. Every order placed meanwhile is an ordinary /orders/{id} record with
// `order_type: "dine_in"` and `dine_in.table_session_id` set to the seating.
//
// The seating's order mode (fixed for the whole seating) decides where a
// guest's items go:
//   - "single":   the table has one shared order. Every guest's items join the
//                 table's current order while it is still waiting for a waiter
//                 to confirm it. Once a waiter has confirmed it with the table
//                 (and then sent it to the kitchen) — or it was rejected or
//                 cancelled — the next
//                 items start the table's next order (round 2, 3…), which waits
//                 for confirmation in turn. So a single-order table never has
//                 two orders waiting for confirmation at once.
//   - "multiple": each guest has their own orders. A guest's items join *their
//                 own* order waiting for confirmation, or start a new one —
//                 never anyone else's.
//
// Every order starts as "waiting_for_waiter_confirmation" and never enters the
// kitchen by itself: a waiter confirms it with the table, then sends it to the
// kitchen (dine-in-orders.firebase.ts).
//
// placeDineInOrder() is the one way to place a dine-in order. It runs as a
// Firestore transaction, so guests ordering at the same moment can't create
// duplicate table orders or overwrite each other's items.
// See docs/DINE_IN_TABLES_QR_HANDOVER.md.

import {
  fsGet,
  fsTransaction,
  isFirebaseAvailable,
  type FirestoreValue,
  type FsTransaction,
} from "@/lib/firestore";
import type {
  FirebaseOrder,
  OrderLine,
  OrderStatus,
  PaymentMethod,
  TimelineEvent,
} from "@/lib/orders.firebase";
import { dineInError, WAITING_FOR_WAITER_CONFIRMATION, type DineInOrderInfo } from "@/lib/dine-in";
import {
  lineTotal,
  MAX_TEXT,
  priceOrder,
  randomId,
  validateItems,
  type DineInItemInput,
} from "@/lib/dine-in-order-edit";
import {
  isQrToken,
  isSessionIdle,
  normalizeTable,
  tableDisplayName,
  tablePath,
  type RestaurantTable,
  type TableSession,
  type TableSessionGuest,
} from "@/lib/tables.firebase";

export type { DineInErrorCode } from "@/lib/dine-in";
export type { DineInItemInput } from "@/lib/dine-in-order-edit";

/**
 * Statuses in which an order still takes a guest's new items: waiting for a
 * waiter to confirm it (legacy dine-in orders wait as "pending"). Once a
 * waiter has confirmed it with the table it takes nothing more, even before it
 * goes to the kitchen, and the guest's next items start a new order.
 */
export const ADDABLE_STATUSES: OrderStatus[] = [WAITING_FOR_WAITER_CONFIRMATION, "pending"];

export function isOpenForAdditions(status: string): boolean {
  return ADDABLE_STATUSES.includes(status as OrderStatus);
}

export interface DineInGuest {
  /** Stable id for this guest — e.g. their Firebase Auth uid (anonymous auth is fine). */
  id: string;
  name?: string | null;
  customer_id?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** Which table: the scanned QR token (guests), or the table's ids (staff, tests). */
export type DineInTableRef = { token: string } | { restaurant_id: string; table_id: string };

export interface PlaceDineInOrderResult {
  order_id: string;
  order_number: string;
  /** true when a new order was started, false when the items joined an existing one. */
  created: boolean;
  session_id: string;
  guest_label: string;
  round: number;
}

/** `dine_in` as stored: contributors are a map keyed by guest id (normalizeDineIn() lists them). */
type StoredDineIn = {
  round?: number;
  contributors?: Record<string, { label?: string; first_added_at?: string; item_count?: number }>;
};

export const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const orderPath = (orderId: string) => `orders/${orderId}`;
// Cast at the write boundary — see the same helper in orders.firebase.ts.
const w = (v: unknown): FirestoreValue => v as FirestoreValue;

/** "FF-" plus six random digits — random rather than time-based, so orders
 *  placed in the same instant at one table never share a number. */
function newOrderNumber(): string {
  const bytes = new Uint32Array(1);
  globalThis.crypto.getRandomValues(bytes);
  return `FF-${String(bytes[0]! % 1_000_000).padStart(6, "0")}`;
}

/* ------------------------------------------------------------- validation */

export function validateGuest(guest: DineInGuest): { id: string; name: string | null } {
  const id = str(guest?.id);
  if (!SAFE_ID.test(id)) {
    throw dineInError("dine-in/invalid-guest", "A dine-in order needs a valid guest id.");
  }
  const name = str(guest.name).slice(0, 60) || null;
  return { id, name };
}

/* ---------------------------------------------------------------- pricing */

function buildLines(
  items: DineInItemInput[],
  guest: { guest_id: string; label: string },
  at: string,
): Record<string, OrderLine> {
  const lines: Record<string, OrderLine> = {};
  for (const item of items) {
    const id = randomId("ln");
    lines[id] = {
      id,
      item_id: str(item.item_id) || id,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: lineTotal(item),
      notes: item.notes ?? null,
      variant: item.variant ?? null,
      addons: item.addons ?? [],
      added_by: guest,
      added_at: at,
    };
  }
  return lines;
}

function describeItems(items: DineInItemInput[]): string {
  return items.map((i) => `${i.name} ×${i.quantity}`).join(", ");
}

/* ----------------------------------------------------------------- guards */

/**
 * Whether `guestId` may add items to `order` in this seating. A dine-in order
 * only ever takes items from its own table and seating, only while it's open
 * for additions — and, in multiple mode, only from the guest who owns it.
 */
export function canGuestAddTo(
  order: Pick<FirebaseOrder, "status" | "order_type" | "restaurant_id"> & {
    dine_in?: Partial<Pick<DineInOrderInfo, "table_id" | "table_session_id" | "guest_id">> | null;
  },
  context: {
    restaurant_id: string;
    table_id: string;
    session_id: string;
    order_mode: "single" | "multiple";
    guest_id: string;
  },
): boolean {
  if (order.order_type !== "dine_in" || !order.dine_in) return false;
  if (order.restaurant_id !== context.restaurant_id) return false;
  if (order.dine_in.table_id !== context.table_id) return false;
  if (order.dine_in.table_session_id !== context.session_id) return false;
  if (!isOpenForAdditions(order.status)) return false;
  if (context.order_mode === "multiple" && order.dine_in.guest_id !== context.guest_id)
    return false;
  return true;
}

/** Throws unless the guest owns this multiple-mode order (see canGuestAddTo). */
export function assertGuestOwnsOrder(
  order: { dine_in?: Partial<Pick<DineInOrderInfo, "order_mode" | "guest_id">> | null },
  guestId: string,
): void {
  if (order.dine_in?.order_mode === "multiple" && order.dine_in.guest_id !== guestId) {
    throw dineInError(
      "dine-in/not-your-order",
      "That order belongs to another guest at this table.",
    );
  }
}

/* -------------------------------------------------------------- placement */

/** Resolve a table reference (a scanned token, or ids) to its restaurant + table. */
export async function resolveTableRef(
  ref: DineInTableRef,
): Promise<{ restaurant_id: string; table_id: string; token: string | null }> {
  if ("token" in ref) {
    if (!isQrToken(ref.token)) {
      throw dineInError("dine-in/invalid-code", "This table code isn't valid.");
    }
    const record = await fsGet<Record<string, unknown>>(`tableQrTokens/${ref.token}`);
    const restaurantId = str(record?.["restaurant_id"]);
    const tableId = str(record?.["table_id"]);
    if (!SAFE_ID.test(restaurantId) || !SAFE_ID.test(tableId)) {
      throw dineInError("dine-in/invalid-code", "This table code isn't valid.");
    }
    return { restaurant_id: restaurantId, table_id: tableId, token: ref.token };
  }
  if (!SAFE_ID.test(ref.restaurant_id) || !SAFE_ID.test(ref.table_id)) {
    throw dineInError("dine-in/table-not-found", "That table doesn't exist.");
  }
  return { restaurant_id: ref.restaurant_id, table_id: ref.table_id, token: null };
}

/**
 * Place a guest's items at a table. Depending on the seating's order mode the
 * items join an existing order or start a new one (see the header comment).
 * Everything — the order, the items, and the seating on the table — is read
 * and written in one transaction.
 */
export async function placeDineInOrder(input: {
  table: DineInTableRef;
  guest: DineInGuest;
  items: DineInItemInput[];
  special_instructions?: string | null;
  payment_method?: PaymentMethod;
}): Promise<PlaceDineInOrderResult> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const guestIdentity = validateGuest(input.guest);
  const items = validateItems(input.items);
  const instructions = str(input.special_instructions).slice(0, MAX_TEXT) || null;
  const ref = await resolveTableRef(input.table);

  // Display-only restaurant fields, read once outside the transaction.
  const restaurant = await fsGet<Record<string, unknown>>(`restaurants/${ref.restaurant_id}`);
  const restaurantName = str(restaurant?.["name"]) || "Restaurant";
  const restaurantImage = str(restaurant?.["image_url"]) || null;

  return fsTransaction((tx) =>
    placeInTransaction(tx, {
      ref,
      guest: { ...input.guest, ...guestIdentity },
      items,
      instructions,
      paymentMethod: input.payment_method ?? "card",
      restaurantName,
      restaurantImage,
    }),
  );
}

async function placeInTransaction(
  tx: FsTransaction,
  input: {
    ref: { restaurant_id: string; table_id: string; token: string | null };
    guest: DineInGuest & { id: string; name: string | null };
    items: DineInItemInput[];
    instructions: string | null;
    paymentMethod: PaymentMethod;
    restaurantName: string;
    restaurantImage: string | null;
  },
): Promise<PlaceDineInOrderResult> {
  const { ref, guest, items } = input;

  // ---- Reads (Firestore requires every read before the first write) ----
  const { raw: tableRaw, table } = await readActiveTable(tx, ref);

  const now = Date.now();
  const ts = new Date(now).toISOString();
  const { session, seat } = joinSeating(table, guest, now);
  const mode = session.order_mode;

  // Single mode looks at the table's current order; multiple mode only ever
  // at this guest's own.
  const candidateId = mode === "single" ? session.current_order_id : seat.current_order_id;
  const candidate = candidateId
    ? await tx.get<FirebaseOrder & { items?: Record<string, OrderLine> }>(orderPath(candidateId))
    : null;
  const target =
    candidate &&
    canGuestAddTo(candidate, {
      restaurant_id: ref.restaurant_id,
      table_id: table.id,
      session_id: session.id,
      order_mode: mode,
      guest_id: guest.id,
    })
      ? candidate
      : null;

  // ---- Writes ----
  const contributor = { guest_id: guest.id, label: seat.label };
  const lines = buildLines(items, contributor, ts);
  const added = items.reduce((sum, i) => sum + i.quantity, 0);
  let result: PlaceDineInOrderResult;

  if (target) {
    const allLines = [...Object.values(target.items ?? {}), ...Object.values(lines)];
    const price = priceOrder(allLines, {
      delivery_fee: Number(target.delivery_fee) || 0,
      tax: Number(target.tax) || 0,
      tip: Number(target.tip) || 0,
      discount: Number(target.discount) || 0,
    });
    const stored = target.dine_in as unknown as StoredDineIn | null;
    const existing = stored?.contributors?.[guest.id];
    const event = timelineEvent(
      "note",
      `${seat.label} added ${describeItems(items)}`,
      seat.label,
      ts,
    );
    const patch: Record<string, FirestoreValue> = {
      ...Object.fromEntries(Object.entries(lines).map(([id, line]) => [`items/${id}`, w(line)])),
      [`timeline/${event.id}`]: w(event),
      [`dine_in/contributors/${guest.id}`]: {
        label: seat.label,
        first_added_at: existing?.first_added_at ?? ts,
        item_count: (Number(existing?.item_count) || 0) + added,
      },
      ...price,
      updated_at: ts,
    };
    if (input.instructions) {
      patch["special_instructions"] = [
        target.special_instructions,
        `${seat.label}: ${input.instructions}`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    tx.update(orderPath(target.id), patch);
    result = {
      order_id: target.id,
      order_number: target.order_number,
      created: false,
      session_id: session.id,
      guest_label: seat.label,
      round: Number(stored?.round) || 1,
    };
  } else {
    const round = (mode === "single" ? session.order_count : seat.order_count) + 1;
    const order = newDineInOrder({
      table,
      session,
      mode,
      guest,
      seat,
      round,
      lines,
      added,
      instructions: input.instructions,
      paymentMethod: input.paymentMethod,
      restaurantName: input.restaurantName,
      restaurantImage: input.restaurantImage,
      at: ts,
    });
    tx.set(orderPath(order.id), w(order));
    session.order_count += 1;
    session.order_ids = [...session.order_ids, order.id];
    seat.order_count += 1;
    if (mode === "single") session.current_order_id = order.id;
    else seat.current_order_id = order.id;
    result = {
      order_id: order.id,
      order_number: order.order_number,
      created: true,
      session_id: session.id,
      guest_label: seat.label,
      round,
    };
  }

  session.guests[guest.id] = seat;
  session.last_activity_at = ts;
  // Write the table back exactly as read, with only its seating changed.
  tx.set(tablePath(ref.restaurant_id, ref.table_id), w({ ...tableRaw, session }));
  return result;
}

/**
 * Read the table a guest is at, inside a transaction, and check it can take
 * them: a scanned token must still be the table's current one, and the table
 * must exist and be active. Returns the stored record and its normalised form.
 */
export async function readActiveTable(
  tx: FsTransaction,
  ref: { restaurant_id: string; table_id: string; token: string | null },
): Promise<{ raw: Record<string, unknown>; table: RestaurantTable }> {
  if (ref.token) {
    const record = await tx.get<Record<string, unknown>>(`tableQrTokens/${ref.token}`);
    if (str(record?.["table_id"]) !== ref.table_id) {
      throw dineInError("dine-in/invalid-code", "This table code is no longer valid.");
    }
  }
  const raw = await tx.get<Record<string, unknown>>(tablePath(ref.restaurant_id, ref.table_id));
  const table = normalizeTable(ref.restaurant_id, ref.table_id, raw);
  if (!raw || !table) throw dineInError("dine-in/table-not-found", "That table doesn't exist.");
  if (ref.token && table.qr_token !== ref.token) {
    throw dineInError("dine-in/invalid-code", "This table code is no longer valid.");
  }
  if (!table.active) {
    throw dineInError(
      "dine-in/table-inactive",
      `${tableDisplayName(table.label)} isn't taking orders right now.`,
    );
  }
  return { raw, table };
}

/**
 * The seating a guest joins right now, and their seat in it (copies — the
 * caller changes and writes them back). A table with no seating, or one that
 * has gone idle, starts a new seating in the table's current mode. A guest new
 * to the seating is "Customer N" unless their name is known.
 */
export function joinSeating(
  table: Pick<RestaurantTable, "session" | "order_mode">,
  guest: { id: string; name: string | null },
  now: number,
): { session: TableSession; seat: TableSessionGuest } {
  const ts = new Date(now).toISOString();
  const session: TableSession =
    table.session && !isSessionIdle(table.session, now)
      ? structuredClone(table.session)
      : {
          id: randomId("ses"),
          opened_at: ts,
          last_activity_at: ts,
          order_mode: table.order_mode,
          current_order_id: null,
          order_count: 0,
          order_ids: [],
          guests: {},
        };
  const seat: TableSessionGuest = session.guests[guest.id] ?? {
    label: guest.name ?? `Customer ${Object.keys(session.guests).length + 1}`,
    joined_at: ts,
    current_order_id: null,
    order_count: 0,
    waiter_request_id: null,
  };
  return { session, seat };
}

function timelineEvent(
  status: TimelineEvent["status"],
  note: string,
  actor: string,
  at: string,
): TimelineEvent {
  return { id: randomId("tl"), status, at, note, actor };
}

function newDineInOrder(input: {
  table: { id: string; restaurant_id: string; label: string };
  session: TableSession;
  mode: "single" | "multiple";
  guest: DineInGuest & { id: string; name: string | null };
  seat: TableSessionGuest;
  round: number;
  lines: Record<string, OrderLine>;
  added: number;
  instructions: string | null;
  paymentMethod: PaymentMethod;
  restaurantName: string;
  restaurantImage: string | null;
  at: string;
}) {
  const { table, session, mode, guest, seat, at } = input;
  const perGuest = mode === "multiple";
  const tableName = tableDisplayName(table.label);
  const price = priceOrder(Object.values(input.lines), {
    delivery_fee: 0,
    tax: 0,
    tip: 0,
    discount: 0,
  });
  const placed = timelineEvent(
    "placed",
    `Ordered at ${tableName} by ${seat.label}`,
    seat.label,
    at,
  );
  const order: FirebaseOrder = {
    id: randomId("ord"),
    order_number: newOrderNumber(),
    // Out of the kitchen until a waiter confirms it.
    status: WAITING_FOR_WAITER_CONFIRMATION,
    order_type: "dine_in",
    placed_at: at,
    accepted_at: null,
    ready_at: null,
    driver_status: null,
    assigned_at: null,
    arrived_at_restaurant: null,
    picked_up_at: null,
    on_the_way_at: null,
    arrived_at_customer: null,
    delivered_at: null,
    cancelled_at: null,
    eta_minutes: null,
    eta_at: null,
    ...price,
    delivery_fee: 0,
    tax: 0,
    discount: 0,
    tip: 0,
    coupon_code: null,
    payment_method: input.paymentMethod,
    payment_status: "pending",
    delivery_address: null,
    special_instructions: input.instructions ? `${seat.label}: ${input.instructions}` : null,
    scheduled_for: null,
    restaurant_id: table.restaurant_id,
    restaurant_name: input.restaurantName,
    restaurant_image: input.restaurantImage,
    branch_id: null,
    branch_name: null,
    // A multiple-mode order is one guest's; a single-mode order is the table's.
    customer_id: perGuest ? str(guest.customer_id) || null : null,
    customer_name: perGuest ? seat.label : tableName,
    customer_phone: perGuest ? str(guest.phone) || null : null,
    customer_email: perGuest ? str(guest.email) || null : null,
    driver_id: null,
    driver_name: null,
    driver_phone: null,
    driver_photo: null,
    driver_rating: null,
    rejection_reason: null,
    rejected_by: null,
    rejected_at: null,
    created_at: at,
    updated_at: at,
  };
  return {
    ...order,
    // Stored as maps here; normalizeDineIn() reads contributors back as a list.
    dine_in: {
      table_id: table.id,
      table_label: table.label,
      order_mode: mode,
      table_session_id: session.id,
      guest_id: guest.id,
      guest_label: seat.label,
      round: input.round,
      contributors: {
        [guest.id]: { label: seat.label, first_added_at: at, item_count: input.added },
      },
      waiter_id: null,
      waiter_name: null,
      confirmed_at: null,
      confirmed_by: null,
    },
    items: input.lines,
    timeline: { [placed.id]: placed },
  };
}

/* ----------------------------------------------------------- clear table */

/**
 * End a seating ("Clear table"). Orders placed during it are untouched; the
 * next guest to order starts a fresh seating in the table's current mode.
 * Only clears the seating the caller was looking at — if a newer one has
 * started meanwhile it is left alone. Returns whether anything was cleared.
 */
export async function closeTableSession(input: {
  restaurant_id: string;
  table_id: string;
  session_id: string;
  actor?: string | null;
}): Promise<boolean> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  return fsTransaction(async (tx) => {
    const raw = await tx.get<Record<string, unknown>>(
      tablePath(input.restaurant_id, input.table_id),
    );
    const table = normalizeTable(input.restaurant_id, input.table_id, raw);
    if (!raw || !table) throw dineInError("dine-in/table-not-found", "That table doesn't exist.");
    if (!table.session || table.session.id !== input.session_id) return false;
    tx.set(
      tablePath(input.restaurant_id, input.table_id),
      w({
        ...raw,
        session: null,
        last_session: {
          id: table.session.id,
          opened_at: table.session.opened_at,
          closed_at: new Date().toISOString(),
          closed_by: input.actor ?? null,
          order_count: table.session.order_count,
        },
      }),
    );
    return true;
  });
}
