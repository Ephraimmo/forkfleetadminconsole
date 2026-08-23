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
// No demo orders are seeded. Empty DB => empty order book across every page
// (Orders, Kitchen, Dispatch, Dashboard, Live map, Support).

import {
  isFirebaseAvailable,
  rtdbGet,
  rtdbSet,
  rtdbSubscribe,
  type RTDBValue,
} from "@/lib/firebase";

export type OrderStatus =
  | "pending"
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

/** How the customer receives the order.
 *  - "delivery": kitchen → dispatch assigns a driver → picked_up → on_the_way → delivered.
 *  - "pickup":   kitchen → ready → customer collects at the counter
 *               (status "picked_up") → staff closes it ("delivered"). No driver. */
export type OrderType = "delivery" | "pickup";

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
}

export interface TimelineEvent {
  id: string;
  status: OrderStatus | "placed" | "note";
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
  picked_up_at: string | null;
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

// Cast a JS value to RTDBValue at write boundaries. Firebase SDK accepts plain
// objects/arrays/primitives/null; the type system is just strict about index
// signatures so we bypass it here.
const w = (v: unknown): RTDBValue => v as RTDBValue;

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
  const ordersSnap = await rtdbGet<Record<string, FirebaseOrder>>(ORDERS_PATH);
  if (!ordersSnap) return [];
  const ids = Object.keys(ordersSnap);
  const itemsByOrder: Record<string, Record<string, OrderLine>> = {};
  const timelineByOrder: Record<string, Record<string, TimelineEvent>> = {};
  await Promise.all(
    ids.map(async (id) => {
      const [items, tl] = await Promise.all([
        rtdbGet<Record<string, OrderLine>>(orderPath(id, "items")),
        rtdbGet<Record<string, TimelineEvent>>(orderPath(id, "timeline")),
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
          rtdbSubscribe<Record<string, OrderLine>>(orderPath(id, "items"), (v) => {
            if (v) itemsMap[id] = v;
            else delete itemsMap[id];
            emit();
          }),
        );
      }
      if (!watchedTl.has(id)) {
        watchedTl.add(id);
        unsubs.push(
          rtdbSubscribe<Record<string, TimelineEvent>>(orderPath(id, "timeline"), (v) => {
            if (v) tlMap[id] = v;
            else delete tlMap[id];
            emit();
          }),
        );
      }
    }
  };

  const mainUnsub = rtdbSubscribe<Record<string, FirebaseOrder>>(ORDERS_PATH, (v) => {
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
    rtdbGet<FirebaseOrder>(orderPath(orderId)),
    rtdbGet<Record<string, OrderLine>>(orderPath(orderId, "items")),
    rtdbGet<Record<string, TimelineEvent>>(orderPath(orderId, "timeline")),
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
  await rtdbSet(orderPath(orderId, "timeline", id), w(record));
  return record;
}

/** Canonical read of an order's fulfilment type (legacy records default to delivery). */
export function orderType(o: { order_type?: OrderType | null }): OrderType {
  return o.order_type === "pickup" ? "pickup" : "delivery";
}

const DELIVERY_ONLY_STATUSES: OrderStatus[] = ["assigned", "on_the_way"];

export async function setFirebaseOrderStatus(input: {
  orderId: string;
  status: OrderStatus;
  etaMinutes?: number | null;
  note?: string | null;
  actor?: string | null;
}): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const order = await rtdbGet<FirebaseOrder>(orderPath(input.orderId));
  if (!order) throw new Error("Order not found");

  if (DELIVERY_ONLY_STATUSES.includes(input.status) && orderType(order) === "pickup") {
    throw new Error(
      `Customer pickup orders never go through "${input.status.replace("_", " ")}" — mark collected, then complete.`,
    );
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
      // Kitchen may move to "assigned" before a driver is chosen; dispatch will
      // attach driver details when they claim the order.
      break;
    case "picked_up":
      patch.picked_up_at = ts;
      break;
    case "delivered":
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

  await rtdbSet(orderPath(input.orderId), w({ ...order, ...patch }));
  await appendTimeline(input.orderId, {
    status: input.status,
    note: input.note ?? null,
    actor: input.actor ?? null,
  });
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
  const order = await rtdbGet<FirebaseOrder>(orderPath(input.orderId));
  if (!order) throw new Error("Order not found");
  if (orderType(order) === "pickup") {
    throw new Error(
      "Customer pickup orders don't take drivers — the customer collects at the counter.",
    );
  }
  if (!["accepted", "preparing", "ready", "assigned"].includes(order.status)) {
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
    status: "assigned",
    updated_at: ts,
    eta_minutes: eta,
    eta_at: new Date(Date.now() + eta * 60_000).toISOString(),
  };
  await rtdbSet(orderPath(input.orderId), w({ ...order, ...patch }));
  await appendTimeline(input.orderId, {
    status: "assigned",
    note: `Driver assigned: ${input.driverName ?? input.driverId}`,
    actor: null,
  });
}

export async function unassignFirebaseDriver(orderId: string): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const order = await rtdbGet<FirebaseOrder>(orderPath(orderId));
  if (!order) throw new Error("Order not found");
  await rtdbSet(
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
 * while the order is still "pending"; once accepted it must be cancelled
 * through the normal cancellation flow.
 */
export async function rejectFirebaseOrder(input: {
  orderId: string;
  reason: string;
  actor?: string | null;
}): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const order = await rtdbGet<FirebaseOrder>(orderPath(input.orderId));
  if (!order) throw new Error("Order not found");
  if (order.status !== "pending") {
    throw new Error(`Cannot reject an order that is already ${order.status.replace("_", " ")}`);
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
  await rtdbSet(orderPath(input.orderId), w({ ...order, ...patch }));
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
  const order = await rtdbGet<FirebaseOrder>(orderPath(orderId));
  if (!order) throw new Error("Order not found");
  await rtdbSet(orderPath(orderId, "updated_at"), w(now()));
  await appendTimeline(orderId, { status: "note", note, actor: actor ?? null });
}

export async function createFirebaseOrder(input: {
  order_number?: string;
  order_type?: OrderType; // default "delivery"; pickup orders skip driver flow
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
    picked_up_at: null,
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

  await rtdbSet(orderPath(id), w(order));
  await rtdbSet(orderPath(id, "items"), w(lines));
  await appendTimeline(id, { status: "placed", note: "Order created", actor: null });
  return id;
}
