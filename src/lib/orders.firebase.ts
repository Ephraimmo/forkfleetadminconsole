// Firebase-backed orders data layer for the Operations Console.
//
// Data shape (shared with the Customer App — do not rename fields):
//   /orders/{orderId}                                  -> Order record
//   /orders/{orderId}/items/{lineId}                   -> OrderLine
//   /orders/{orderId}/timeline/{eventId}               -> TimelineEvent
//
// This module is the single source of truth for reading & mutating orders.
// The customer app writes new orders to /orders/{id} with status "pending";
// the console advances them through accepted -> preparing -> ready ->
// assigned -> picked_up -> on_the_way -> delivered | cancelled | refunded.
//
// IMPORTANT: assigning a driver does NOT change `status` — it stays "ready"
// until the driver app writes `status: "assigned"` (the driver accepting).
// The finer-grained driver-side progress ("arrived at restaurant", "arrived
// at customer") lives ONLY in `driver_status`, never in `status`. See
// docs/ORDER_WORKFLOW_HANDOVER.md for the authoritative driver-app contract.
//
// No demo orders are seeded. Empty DB => empty order book across every page
// (Orders, Kitchen, Dispatch, Dashboard, Live map, Support).

import {
  isFirebaseAvailable,
  fsGet,
  fsSet,
  fsSubscribe,
  fsTransaction,
  type FirestoreValue,
} from "@/lib/firestore";
import type { DineInOrderInfo } from "@/lib/dine-in";
import type { OrderEditRecord } from "@/lib/dine-in-order-edit";

/**
 * The order's overall status, shared with the customer app and restaurant
 * dashboard. These are the ONLY values that may ever be written to `status` —
 * see docs/ORDER_WORKFLOW_HANDOVER.md. There is deliberately no "offered" or
 * "arrived" value: assigning a driver does NOT change `status` (it stays
 * "ready" until the driver accepts), and "arrived at the restaurant" is
 * tracked only via `driver_status`, never by changing `status`.
 *
 * "offered" and "arrived" were briefly written here by an earlier, incorrect
 * version of this console before the real driver-app contract was known.
 * `orderStage()` in dispatch.functions.ts treats any surviving records with
 * those values as their real equivalent, so old in-flight orders keep
 * working correctly without a data migration.
 *
 * "waiting_for_waiter_confirmation" and "waiter_confirmed" are dine-in only:
 * a guest's order waits until a waiter reviews (and may edit) it and confirms
 * it with the table ("waiter_confirmed"), and only the waiter's "Send to
 * kitchen" then moves it to "accepted" and onto the kitchen board. See dine-in.ts.
 */
export type OrderStatus =
  | "pending"
  | "waiting_for_waiter_confirmation"
  | "waiter_confirmed"
  | "accepted"
  | "preparing"
  | "ready"
  | "assigned"
  | "picked_up"
  | "on_the_way"
  | "delivered"
  | "rejected"
  | "cancelled"
  | "refunded";

/**
 * Granular driver-side progress, written by the driver app (the console only
 * writes it via the staff "Mark arrived at restaurant" fallback — see
 * markArrivedAtRestaurant() below). Independent of `status`: e.g. the driver
 * can be "arrived_at_restaurant" while `status` is still "assigned".
 */
export type DriverStatus =
  | "assigned"
  | "arrived_at_restaurant"
  | "picked_up"
  | "on_the_way"
  | "arrived_at_customer"
  | "delivered";

/** How the customer receives the order.
 *  - "delivery": kitchen → dispatch assigns a driver → picked_up → on_the_way → delivered.
 *  - "pickup":   kitchen → ready → customer collects at the counter
 *               (status "picked_up") → staff closes it ("delivered"). No driver.
 *  - "dine_in":  ordered at a table via its QR code (details in `dine_in`,
 *               see dine-in.ts) → kitchen → ready → served ("delivered"). No driver. */
export type OrderType = "delivery" | "pickup" | "dine_in";

export type PaymentMethod = "card" | "cash" | "wallet" | "eft" | "apple_pay" | "google_pay";

export interface DeliveryAddress {
  label: string | null;
  street: string;
  city: string;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
}

export interface OrderLineVariant {
  id: string;
  name: string;
  price_delta: number;
}

export interface OrderLineAddon {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface OrderLine {
  id: string;
  item_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
  variant: OrderLineVariant | null;
  addons: OrderLineAddon[];
  /** Dine-in only: the guest who added this line and when (a shared table
   *  order collects lines from several guests over time). */
  added_by?: { guest_id: string; label: string } | null;
  added_at?: string | null;
  /** Dine-in only: the staff member who added this line while editing the
   *  order (lines a guest added have `added_by` instead). */
  added_by_staff?: string | null;
  /** Dine-in only: last time a waiter changed this line, and who. */
  edited_at?: string | null;
  edited_by?: string | null;
}

export interface TimelineEvent {
  id: string;
  status: OrderStatus | DriverStatus | "placed" | "note";
  at: string;
  note: string | null;
  actor: string | null;
}

export interface FirebaseOrder {
  id: string;
  order_number: string;
  status: OrderStatus;
  /** Delivery vs customer pickup. Legacy orders without the field are
   *  treated as "delivery" — read via the orderType() helper. */
  order_type: OrderType;
  placed_at: string;
  accepted_at: string | null;
  ready_at: string | null;

  /** Granular driver-side progress — see DriverStatus. Written by the driver
   *  app; the console only writes it via the staff "arrived" fallback. */
  driver_status: DriverStatus | null;
  /** Set when the driver accepts (driver_status/status → "assigned"). */
  assigned_at: string | null;
  /** Set when the driver reaches the restaurant (driver_status only —
   *  `status` stays "assigned" at this point, never becomes "arrived"). */
  arrived_at_restaurant: string | null;
  picked_up_at: string | null;
  on_the_way_at: string | null;
  /** Set when the driver reaches the customer (driver_status only — `status`
   *  stays "on_the_way" at this point). */
  arrived_at_customer: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  eta_minutes: number | null;
  eta_at: string | null;
  subtotal: number;
  delivery_fee: number;
  service_fee: number;
  tax: number;
  discount: number;
  tip: number;
  total: number;
  coupon_code: string | null;
  payment_method: PaymentMethod;
  payment_status: "pending" | "paid" | "failed" | "refunded";
  delivery_address: DeliveryAddress | null;
  special_instructions: string | null;
  scheduled_for: string | null;

  restaurant_id: string;
  restaurant_name: string;
  restaurant_image: string | null;

  /** Branch that is fulfilling the order (required for driver eligibility). */
  branch_id?: string | null;
  branch_name?: string | null;

  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;

  driver_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_photo: string | null;
  driver_rating: number | null;

  rejection_reason: string | null;
  rejected_by: string | null;
  rejected_at: string | null;

  /** Table, order mode, session and waiter — present only when
   *  order_type is "dine_in". */
  dine_in?: DineInOrderInfo | null;
  /** Dine-in only: every change a waiter made to what was ordered, keyed by
   *  edit id (see OrderEditRecord in dine-in-order-edit.ts). */
  edits?: Record<string, OrderEditRecord> | null;

  created_at: string;
  updated_at: string;
}

export interface OrderPayload {
  order: FirebaseOrder;
  items: OrderLine[];
  timeline: TimelineEvent[];
}

const ORDERS_PATH = "orders";

const EMPTY: OrderPayload[] = [];

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

function orderPath(orderId: string, ...tail: string[]) {
  return [ORDERS_PATH, orderId, ...tail].filter(Boolean).join("/");
}

function toArr<T>(data: Record<string, T> | null): T[] {
  return data ? Object.values(data) : [];
}

// Cast a JS value to FirestoreValue at write boundaries. Firebase SDK accepts plain
// objects/arrays/primitives/null; the type system is just strict about index
// signatures so we bypass it here.
const w = (v: unknown): FirestoreValue => v as FirestoreValue;

/* ------------------------------------------------------------ read helpers */

function assemble(
  ordersMap: Record<string, FirebaseOrder> | null,
  itemsMap: Record<string, Record<string, OrderLine>> | null,
  timelineMap: Record<string, Record<string, TimelineEvent>> | null,
): OrderPayload[] {
  if (!ordersMap) return [];
  return Object.values(ordersMap)
    .filter((o): o is FirebaseOrder => Boolean(o))
    .map((o) => ({
      order: o,
      items: toArr((itemsMap?.[o.id] ?? null) as Record<string, OrderLine> | null)
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id)),
      timeline: toArr((timelineMap?.[o.id] ?? null) as Record<string, TimelineEvent> | null)
        .slice()
        .sort((a, b) => a.at.localeCompare(b.at)),
    }));
}

export async function listFirebaseOrders(): Promise<OrderPayload[]> {
  if (!isFirebaseAvailable()) return EMPTY;
  const ordersSnap = await fsGet<Record<string, FirebaseOrder>>(ORDERS_PATH);
  if (!ordersSnap) return [];
  const ids = Object.keys(ordersSnap);
  const itemsByOrder: Record<string, Record<string, OrderLine>> = {};
  const timelineByOrder: Record<string, Record<string, TimelineEvent>> = {};
  await Promise.all(
    ids.map(async (id) => {
      const [items, tl] = await Promise.all([
        fsGet<Record<string, OrderLine>>(orderPath(id, "items")),
        fsGet<Record<string, TimelineEvent>>(orderPath(id, "timeline")),
      ]);
      if (items) itemsByOrder[id] = items;
      if (tl) timelineByOrder[id] = tl;
    }),
  );
  return assemble(ordersSnap, itemsByOrder, timelineByOrder);
}

export function subscribeFirebaseOrders(cb: (rows: OrderPayload[]) => void): () => void {
  if (!isFirebaseAvailable()) {
    cb(EMPTY);
    return () => {};
  }

  let ordersMap: Record<string, FirebaseOrder> | null = null;
  const itemsMap: Record<string, Record<string, OrderLine>> = {};
  const tlMap: Record<string, Record<string, TimelineEvent>> = {};
  let haveOrders = false;
  const watchedItems = new Set<string>();
  const watchedTl = new Set<string>();
  const unsubs: Array<() => void> = [];

  const emit = () => {
    if (!haveOrders) return;
    cb(assemble(ordersMap, itemsMap, tlMap));
  };

  const watchOrderChildren = (ids: string[]) => {
    for (const id of ids) {
      if (!watchedItems.has(id)) {
        watchedItems.add(id);
        unsubs.push(
          fsSubscribe<Record<string, OrderLine>>(orderPath(id, "items"), (v) => {
            if (v) itemsMap[id] = v;
            else delete itemsMap[id];
            emit();
          }),
        );
      }
      if (!watchedTl.has(id)) {
        watchedTl.add(id);
        unsubs.push(
          fsSubscribe<Record<string, TimelineEvent>>(orderPath(id, "timeline"), (v) => {
            if (v) tlMap[id] = v;
            else delete tlMap[id];
            emit();
          }),
        );
      }
    }
  };

  const mainUnsub = fsSubscribe<Record<string, FirebaseOrder>>(ORDERS_PATH, (v) => {
    ordersMap = v;
    haveOrders = true;
    if (v) watchOrderChildren(Object.keys(v));
    emit();
  });

  return () => {
    mainUnsub();
    unsubs.forEach((u) => u());
  };
}

export async function getFirebaseOrder(orderId: string): Promise<OrderPayload | null> {
  if (!isFirebaseAvailable()) return null;
  const [order, items, tl] = await Promise.all([
    fsGet<FirebaseOrder>(orderPath(orderId)),
    fsGet<Record<string, OrderLine>>(orderPath(orderId, "items")),
    fsGet<Record<string, TimelineEvent>>(orderPath(orderId, "timeline")),
  ]);
  if (!order) return null;
  return {
    order,
    items: toArr(items),
    timeline: toArr(tl).sort((a, b) => a.at.localeCompare(b.at)),
  };
}

/* ----------------------------------------------------------- mutations ---- */

function now() {
  return new Date().toISOString();
}

async function appendTimeline(
  orderId: string,
  event: Omit<TimelineEvent, "id" | "at"> & { at?: string },
) {
  const id = uid("tl");
  const record: TimelineEvent = {
    id,
    at: event.at ?? now(),
    note: event.note ?? null,
    status: event.status,
    actor: event.actor ?? null,
  };
  await fsSet(orderPath(orderId, "timeline", id), w(record));
  return record;
}

/** Canonical read of an order's fulfilment type (legacy records default to delivery). */
export function orderType(o: { order_type?: OrderType | null }): OrderType {
  if (o.order_type === "pickup" || o.order_type === "dine_in") return o.order_type;
  return "delivery";
}

const DELIVERY_ONLY_STATUSES: OrderStatus[] = ["assigned", "on_the_way"];
// Dine-in orders are served at the table — no driver, and no counter collection.
const NOT_FOR_DINE_IN_STATUSES: OrderStatus[] = ["assigned", "picked_up", "on_the_way"];
// Only a dine-in order waits for a waiter.
const DINE_IN_ONLY_STATUSES: OrderStatus[] = [
  "waiting_for_waiter_confirmation",
  "waiter_confirmed",
];
// Statuses an order can still be rejected from (before anyone has accepted it).
const REJECTABLE_STATUSES: OrderStatus[] = [
  "pending",
  "waiting_for_waiter_confirmation",
  "waiter_confirmed",
];
// A dine-in order only takes these steps through the waiter's own actions in
// dine-in-orders.firebase.ts, which also record who took them — never through
// a plain status change. So nothing can put an order in front of the kitchen
// that a waiter hasn't confirmed and sent, or mark it served without saying who.
const DINE_IN_WAITER_STEPS: Partial<Record<OrderStatus, string>> = {
  waiter_confirmed: "Confirm order",
  accepted: "Send to kitchen",
  delivered: "Mark as served",
};
const KITCHEN_BOARD_STATUSES: OrderStatus[] = ["accepted", "preparing", "ready"];

function assertDineInStatusChange(order: FirebaseOrder, next: OrderStatus): void {
  const step = DINE_IN_WAITER_STEPS[next];
  if (step) {
    throw new Error(
      `Use "${step}" on the Dine-in orders page for dine-in order ${order.order_number}, so the waiter is recorded.`,
    );
  }
  if (
    (next === "preparing" || next === "ready") &&
    !KITCHEN_BOARD_STATUSES.includes(order.status)
  ) {
    throw new Error(
      `Dine-in order ${order.order_number} hasn't been confirmed by a waiter and sent to the kitchen yet.`,
    );
  }
}

export async function setFirebaseOrderStatus(input: {
  orderId: string;
  status: OrderStatus;
  etaMinutes?: number | null;
  note?: string | null;
  actor?: string | null;
}): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  // Read and rewrite the order in one transaction: this writes the whole
  // document back, so it must never race a guest adding items to a dine-in
  // table order (see table-sessions.firebase.ts) and silently drop them.
  await fsTransaction(async (tx) => {
    const order = await tx.get<FirebaseOrder>(orderPath(input.orderId));
    if (!order) throw new Error("Order not found");
    tx.set(orderPath(input.orderId), w({ ...order, ...statusChangePatch(order, input) }));
  });
  await appendTimeline(input.orderId, {
    status: input.status,
    note: input.note ?? null,
    actor: input.actor ?? null,
  });
}

/** Validate a status change for this order and build the fields it sets. */
function statusChangePatch(
  order: FirebaseOrder,
  input: Parameters<typeof setFirebaseOrderStatus>[0],
): Partial<FirebaseOrder> {
  if (DELIVERY_ONLY_STATUSES.includes(input.status) && orderType(order) === "pickup") {
    throw new Error(
      `Customer pickup orders never go through "${input.status.replace("_", " ")}" — mark collected, then complete.`,
    );
  }
  if (NOT_FOR_DINE_IN_STATUSES.includes(input.status) && orderType(order) === "dine_in") {
    throw new Error(
      `Dine-in orders never go through "${input.status.replace("_", " ")}" — they're served at the table.`,
    );
  }
  if (orderType(order) === "dine_in") assertDineInStatusChange(order, input.status);
  if (DINE_IN_ONLY_STATUSES.includes(input.status) && orderType(order) !== "dine_in") {
    throw new Error("Only dine-in orders wait for a waiter's confirmation.");
  }

  const ts = now();
  const patch: Partial<FirebaseOrder> = { status: input.status, updated_at: ts };
  switch (input.status) {
    case "accepted":
      patch.accepted_at = ts;
      break;
    case "ready":
      patch.ready_at = ts;
      if (input.etaMinutes != null) patch.eta_minutes = input.etaMinutes;
      break;
    case "assigned":
      // The driver app writes this directly to Firestore when the driver
      // accepts an offered job — this console has no staff-facing action for it.
      patch.driver_status = "assigned";
      patch.assigned_at = ts;
      break;
    case "picked_up":
      patch.driver_status = "picked_up";
      patch.picked_up_at = ts;
      break;
    case "on_the_way":
      patch.driver_status = "on_the_way";
      patch.on_the_way_at = ts;
      break;
    case "delivered":
      patch.driver_status = "delivered";
      patch.delivered_at = ts;
      patch.eta_minutes = 0;
      patch.eta_at = null;
      break;
    case "rejected":
      patch.rejected_at = ts;
      patch.cancelled_at = ts;
      patch.driver_id = null;
      patch.driver_name = null;
      patch.driver_phone = null;
      patch.driver_photo = null;
      patch.driver_rating = null;
      break;
    case "cancelled":
      patch.cancelled_at = ts;
      break;
    case "refunded":
      patch.cancelled_at = order.cancelled_at ?? ts;
      break;
  }
  if (input.etaMinutes != null && input.status !== "delivered")
    patch.eta_minutes = input.etaMinutes;
  if (patch.eta_minutes != null && patch.eta_minutes > 0) {
    patch.eta_at = new Date(Date.now() + patch.eta_minutes * 60_000).toISOString();
  }
  return patch;
}

export async function assignFirebaseDriver(input: {
  orderId: string;
  driverId: string;
  driverName: string | null;
  driverPhone?: string | null;
  driverPhoto?: string | null;
  driverRating?: number | null;
  etaMinutes?: number;
}): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const order = await fsGet<FirebaseOrder>(orderPath(input.orderId));
  if (!order) throw new Error("Order not found");
  if (orderType(order) === "pickup") {
    throw new Error(
      "Customer pickup orders don't take drivers — the customer collects at the counter.",
    );
  }
  if (orderType(order) === "dine_in") {
    throw new Error("Dine-in orders don't take drivers — they're served at the table.");
  }
  // Assigning/reassigning is only valid while `status` is still "ready" —
  // per the real driver-app contract, picking a driver does NOT change
  // `status` at all (it stays "ready" until the driver accepts). Staff may
  // re-pick a different driver as many times as they like while it's still
  // "ready" and unaccepted; once the driver accepts (status → "assigned"),
  // staff can no longer swap them out through this flow.
  // "offered" is a legacy value an earlier console build wrote in place of
  // "ready" — treat it the same for orders still carrying it.
  if (!["accepted", "preparing", "ready", "offered"].includes(order.status)) {
    throw new Error(`Cannot assign a driver while order is ${order.status}`);
  }
  const ts = now();
  const eta = input.etaMinutes ?? order.eta_minutes ?? 30;
  const patch: Partial<FirebaseOrder> = {
    driver_id: input.driverId,
    driver_name: input.driverName,
    driver_phone: input.driverPhone ?? null,
    driver_photo: input.driverPhoto ?? null,
    driver_rating: input.driverRating ?? null,
    updated_at: ts,
    eta_minutes: eta,
    eta_at: new Date(Date.now() + eta * 60_000).toISOString(),
  };
  await fsSet(orderPath(input.orderId), w({ ...order, ...patch }));
  await appendTimeline(input.orderId, {
    status: order.status,
    note: `Driver offered: ${input.driverName ?? input.driverId}`,
    actor: null,
  });
}

/**
 * Fallback for "the driver has reached the restaurant" — mirrors what the
 * driver app itself writes on its "Arrived at restaurant" action. Deliberately
 * does NOT touch `status` (stays "assigned"), matching the real contract:
 * only `driver_status` and `arrived_at_restaurant` change here.
 *
 * Not currently exposed as a staff-facing button anywhere in the console
 * (removed 2026-09-17) — kept for callers that may need it later.
 */
export async function markArrivedAtRestaurant(input: {
  orderId: string;
  actor?: string | null;
}): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const order = await fsGet<FirebaseOrder>(orderPath(input.orderId));
  if (!order) throw new Error("Order not found");
  if (order.status !== "assigned") {
    throw new Error(`Cannot mark arrived while order is ${order.status}`);
  }
  const ts = now();
  await fsSet(
    orderPath(input.orderId),
    w({ ...order, driver_status: "arrived_at_restaurant", arrived_at_restaurant: ts, updated_at: ts }),
  );
  await appendTimeline(input.orderId, {
    status: "arrived_at_restaurant",
    note: "Marked arrived at restaurant (staff)",
    actor: input.actor ?? null,
  });
}

export async function unassignFirebaseDriver(orderId: string): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const order = await fsGet<FirebaseOrder>(orderPath(orderId));
  if (!order) throw new Error("Order not found");
  await fsSet(
    orderPath(orderId),
    w({
      ...order,
      driver_id: null,
      driver_name: null,
      driver_phone: null,
      driver_photo: null,
      driver_rating: null,
      status: order.status === "assigned" ? "ready" : order.status,
      updated_at: now(),
    }),
  );
}

/**
 * Reject a pending order with a reason (visible to the customer). Only valid
 * while the order is still "pending" (or, dine-in, waiting for a waiter's
 * confirmation); once accepted it must be cancelled through the normal
 * cancellation flow.
 */
export async function rejectFirebaseOrder(input: {
  orderId: string;
  reason: string;
  actor?: string | null;
}): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  // One transaction, like setFirebaseOrderStatus: never drops items a dine-in
  // guest adds while the order is being rejected.
  await fsTransaction(async (tx) => {
    const order = await tx.get<FirebaseOrder>(orderPath(input.orderId));
    if (!order) throw new Error("Order not found");
    if (!REJECTABLE_STATUSES.includes(order.status)) {
      throw new Error(`Cannot reject an order that is already ${order.status.replace(/_/g, " ")}`);
    }
    const ts = now();
    const patch: Partial<FirebaseOrder> = {
      status: "rejected",
      rejection_reason: input.reason.trim() || "No reason provided",
      rejected_by: input.actor ?? null,
      rejected_at: ts,
      cancelled_at: ts,
      driver_id: null,
      driver_name: null,
      driver_phone: null,
      driver_photo: null,
      driver_rating: null,
      updated_at: ts,
    };
    tx.set(orderPath(input.orderId), w({ ...order, ...patch }));
  });
  await appendTimeline(input.orderId, {
    status: "rejected",
    note: `Rejected: ${input.reason.trim() || "No reason provided"}`,
    actor: input.actor ?? null,
  });
}

export async function addFirebaseOrderNote(
  orderId: string,
  note: string,
  actor?: string | null,
): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const order = await fsGet<FirebaseOrder>(orderPath(orderId));
  if (!order) throw new Error("Order not found");
  await fsSet(orderPath(orderId, "updated_at"), w(now()));
  await appendTimeline(orderId, { status: "note", note, actor: actor ?? null });
}

export async function createFirebaseOrder(input: {
  order_number?: string;
  // default "delivery"; pickup orders skip driver flow. Dine-in orders are
  // only ever placed by the customer app from a table QR code.
  order_type?: Exclude<OrderType, "dine_in">;
  restaurant_id: string;
  restaurant_name: string;
  restaurant_image?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  customer_name: string;
  customer_phone?: string | null;
  customer_email?: string | null;
  customer_id?: string | null;
  delivery_address?: DeliveryAddress | null;
  special_instructions?: string | null;
  payment_method?: PaymentMethod;
  items: Array<{
    item_id?: string;
    name: string;
    quantity: number;
    unit_price: number;
    notes?: string | null;
    variant?: OrderLineVariant | null;
    addons?: OrderLineAddon[];
  }>;
  delivery_fee?: number;
  subtotal?: number;
  tip?: number;
  discount?: number;
  service_fee?: number;
  tax?: number;
  eta_minutes?: number;
  coupon_code?: string | null;
}): Promise<string> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const id = uid("ord");
  const orderNumber = input.order_number ?? `FF-${Date.now().toString().slice(-6)}`;
  const addonsArr = input.items.map((it) => it.addons ?? []);
  const variantsArr = input.items.map((it) => it.variant ?? null);
  const computedSubtotal =
    input.subtotal ??
    input.items.reduce((s, it, idx) => {
      const addonTotal = addonsArr[idx]!.reduce((as, a) => as + a.price * a.quantity, 0);
      const variantDelta = (variantsArr[idx]?.price_delta ?? 0) * it.quantity;
      return s + it.unit_price * it.quantity + addonTotal + variantDelta;
    }, 0);
  const subtotal = Math.round(computedSubtotal * 100) / 100;
  const order_type: OrderType = input.order_type === "pickup" ? "pickup" : "delivery";
  // Pickup orders never have a delivery fee (unless explicitly overridden).
  const delivery_fee = input.delivery_fee ?? (order_type === "pickup" ? 0 : 25);
  const service_fee = input.service_fee ?? Math.round(subtotal * 0.05 * 100) / 100;
  const tax = input.tax ?? 0;
  const tip = input.tip ?? 0;
  const discount = input.discount ?? 0;
  const total =
    Math.round((subtotal + delivery_fee + service_fee + tax + tip - discount) * 100) / 100;
  const ts = now();
  const order: FirebaseOrder = {
    id,
    order_number: orderNumber,
    status: "pending",
    order_type,
    placed_at: ts,
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
    eta_minutes: input.eta_minutes ?? null,
    eta_at: input.eta_minutes
      ? new Date(Date.now() + input.eta_minutes * 60_000).toISOString()
      : null,
    subtotal,
    delivery_fee,
    service_fee,
    tax,
    discount,
    tip,
    total,
    coupon_code: input.coupon_code ?? null,
    payment_method: input.payment_method ?? "card",
    payment_status: "pending",
    // A pickup order has no destination address.
    delivery_address: order_type === "pickup" ? null : (input.delivery_address ?? null),
    special_instructions: input.special_instructions ?? null,
    scheduled_for: null,
    restaurant_id: input.restaurant_id,
    restaurant_name: input.restaurant_name,
    restaurant_image: input.restaurant_image ?? null,
    branch_id: input.branch_id ?? null,
    branch_name: input.branch_name ?? null,
    customer_id: input.customer_id ?? null,
    customer_name: input.customer_name,
    customer_phone: input.customer_phone ?? null,
    customer_email: input.customer_email ?? null,
    driver_id: null,
    driver_name: null,
    driver_phone: null,
    driver_photo: null,
    driver_rating: null,
    rejection_reason: null,
    rejected_by: null,
    rejected_at: null,
    created_at: ts,
    updated_at: ts,
  };

  const lines: Record<string, OrderLine> = {};
  input.items.forEach((partial, idx) => {
    const lineId = uid("ln");
    const addons = addonsArr[idx]!;
    const variant = variantsArr[idx];
    const addonTotal = addons.reduce((s, a) => s + a.price * a.quantity, 0);
    const variantDelta = (variant?.price_delta ?? 0) * partial.quantity;
    const line_total =
      Math.round((partial.unit_price * partial.quantity + addonTotal + variantDelta) * 100) / 100;
    lines[lineId] = {
      id: lineId,
      item_id: partial.item_id ?? lineId,
      name: partial.name,
      quantity: partial.quantity,
      unit_price: partial.unit_price,
      line_total,
      notes: partial.notes ?? null,
      variant: variant ?? null,
      addons,
    };
  });

  await fsSet(orderPath(id), w(order));
  await fsSet(orderPath(id, "items"), w(lines));
  await appendTimeline(id, { status: "placed", note: "Order created", actor: null });
  return id;
}
