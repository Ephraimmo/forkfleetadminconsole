// Compatibility adapter: exposes the same DispatchOrder / listOrders / assignDriver
// / advanceDelivery surface the rest of the console uses, but backed by Firebase
// Realtime Database instead of the in-memory demo store. Drivers are still sourced
// from the local demo drivers array because the driver fleet module hasn't been
// moved to Firebase yet — driver id/name/phone are joined in from the order's
// persisted driver_* fields when present.
//
// Lifecycle enforced here — see docs/ORDER_WORKFLOW_HANDOVER.md for the
// authoritative driver-app contract this is built against:
//   pending      -> accept (Orders page) or reject (Orders page, with reason)
//   accepted     -> kitchen starts cooking   (Orders page "Send to kitchen" or auto)
//   preparing    -> kitchen marks ready
//   ready        -> dispatcher assigns a driver (`driver_id` only — `status`
//                   does NOT change; it stays "ready" until the driver
//                   accepts). Staff may re-pick a different driver as many
//                   times as they like while `status` is still "ready".
//   ready + driver_id set, not yet accepted -> driver app: driver accepts,
//                   writing `status: "assigned"`. No staff override exists
//                   to force this — only reassignment (above).
//   assigned     -> driver app writes `driver_status: "arrived_at_restaurant"`
//                   when the driver reaches the restaurant (`status` stays
//                   "assigned" — it is NOT a `status` value). No staff
//                   override in the UI (removed 2026-09-17) — the console
//                   still exposes markArrivedAtRestaurant() below as a
//                   fallback mutation, but nothing currently calls it.
//   assigned + driver_status "arrived_at_restaurant" -> normally the driver
//                   verifies a pickup code and taps "Picked up" in their own
//                   app, writing `status: "picked_up"`. Staff also have a
//                   manual "Mark picked up" fallback for this step (re-added
//                   2026-09-17), shown only once the order has reached this
//                   exact stage — not before.
//   picked_up    -> driver marks on the way (`status: "on_the_way"`) — no
//                   staff override; view + cancel only from here on.
//   on_the_way   -> driver marks delivered (`status: "delivered"`) — no
//                   staff override.
//   delivered / rejected / cancelled / refunded are terminal.
//
// Orders never store a `status` of "offered" or "arrived" going forward —
// those were written by an earlier, incorrect build of this console.
// orderStage() below treats any such surviving records as their real
// equivalent, so old in-flight orders keep working without a migration.

import {
  assignFirebaseDriver,
  markArrivedAtRestaurant as markArrivedAtRestaurantFb,
  orderType,
  rejectFirebaseOrder,
  setFirebaseOrderStatus,
  subscribeFirebaseOrders,
  type DriverStatus as OrderDriverStatus,
  type FirebaseOrder,
  type OrderLine,
  type OrderPayload,
  type OrderStatus,
  type OrderType,
} from "@/lib/orders.firebase";
import {
  getFirebaseDriver,
  isDriverEligibleForBranch,
} from "@/lib/drivers.firebase";
import {
  auditLogs,
  drivers,
  logAudit,
  profiles,
  unwrap,
  uid,
  type DriverStatus as StoreDriverStatus,
} from "@/lib/demo-store";

export type { OrderStatus };
/** A driver's own online/offline/busy/etc profile status — NOT to be
 *  confused with `OrderDriverStatus` (an order's driver-side progress). */
export type DriverStatus = StoreDriverStatus;

export interface DispatchOrder {
  id: string;
  order_number: string;
  status: OrderStatus;
  /** "delivery" needs a driver; "pickup" is collected by the customer. */
  order_type: OrderType;
  placed_at: string;
  driver_status: OrderDriverStatus | null;
  assigned_at: string | null;
  arrived_at_restaurant: string | null;
  on_the_way_at: string | null;
  arrived_at_customer: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  eta_minutes: number | null;
  total: number;
  subtotal: number;
  delivery_fee: number;
  tip: number;
  discount: number;
  payment_method: string;
  payment_status: string;
  delivery_address: string | null;
  delivery_notes: string | null;
  special_instructions: string | null;
  restaurant_id: string;
  restaurant_name: string;
  restaurant_image: string | null;
  branch_id: string | null;
  branch_name: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  driver_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_photo: string | null;
  customer_id: string | null;
  items: {
    id: string;
    item_name: string;
    quantity: number;
    notes: string | null;
    unit_price: number;
    line_total: number;
  }[];
  timeline: { status: string; at: string; note: string | null }[];
  created_at: string;
  updated_at: string;
}

export interface DriverRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  city: string;
  vehicle_type: string;
  vehicle_plate: string | null;
  status: DriverStatus;
  is_verified: boolean;
  rating: number;
  total_deliveries: number;
  wallet_balance: number;
  active_orders: number;
  updated_at: string;
}

export interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_email: string | null;
  before_value: Record<string, string | number | boolean | null> | null;
  after_value: Record<string, string | number | boolean | null> | null;
  created_at: string;
}

/**
 * The admin-facing lifecycle stage — finer-grained than `status` alone, per
 * docs/ORDER_WORKFLOW_HANDOVER.md section 2. `status` can't tell "waiting for
 * a driver to accept" apart from "no driver picked yet" (both are `status:
 * "ready"`), or "heading to the restaurant" apart from "at the restaurant"
 * (both are `status: "assigned"`) — those need `driver_id` / `driver_status`
 * too.
 */
export type OrderStage =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready" // pickup orders only — waiting for the customer to collect
  | "unassigned" // delivery, "ready", no driver picked yet
  | "waiting_accept" // delivery, driver picked, hasn't accepted yet
  | "heading_to_restaurant" // delivery, driver accepted, not yet at the restaurant
  | "at_restaurant" // delivery, driver at the restaurant
  | "picked_up"
  | "on_the_way"
  | "at_customer" // delivery, driver at the customer's door
  | "delivered"
  | "rejected"
  | "cancelled"
  | "refunded";

/** Human copy for each stage — lifted straight from the handover doc's
 *  suggested admin status labels. */
export const STAGE_LABEL: Record<OrderStage, string> = {
  pending: "Pending",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready for pickup",
  unassigned: "Unassigned",
  waiting_accept: "Waiting for driver to accept",
  heading_to_restaurant: "Waiting for driver to get to the restaurant",
  at_restaurant: "Driver at restaurant — picking up order",
  picked_up: "Order picked up — driver en route",
  on_the_way: "On the way to customer",
  at_customer: "Driver at customer's door",
  delivered: "Delivered",
  rejected: "Rejected",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/**
 * Computes the admin lifecycle stage for a delivery or pickup order.
 * Also normalizes the legacy "offered"/"arrived" `status` values an earlier,
 * incorrect console build wrote, so old in-flight orders keep resolving to
 * the right stage without a data migration.
 */
export function orderStage(o: {
  status: OrderStatus;
  order_type: OrderType;
  driver_id: string | null;
  driver_status: OrderDriverStatus | null;
}): OrderStage {
  const raw = o.status as string;

  if (o.order_type === "pickup") {
    // No driver is ever involved for pickup orders — the stage is the raw status.
    return raw as OrderStage;
  }

  if (raw === "ready" || raw === "offered") {
    return o.driver_id ? "waiting_accept" : "unassigned";
  }
  if (raw === "assigned" || raw === "arrived") {
    return raw === "arrived" || o.driver_status === "arrived_at_restaurant"
      ? "at_restaurant"
      : "heading_to_restaurant";
  }
  if (raw === "on_the_way") {
    return o.driver_status === "arrived_at_customer" ? "at_customer" : "on_the_way";
  }
  // pending, accepted, preparing, picked_up, delivered, rejected, cancelled, refunded
  return raw as OrderStage;
}

// Orders that show on the Dispatch board (ready-for-pickup + in-flight).
// "ready" covers both "unassigned" and "waiting to accept" — they share the
// same raw `status`; the dispatch board tells them apart via orderStage().
// "offered"/"arrived" are legacy raw-status values still handled for
// backward compatibility with orders an earlier console build wrote.
const DISPATCH_STATUSES: OrderStatus[] = [
  "ready",
  "assigned",
  "picked_up",
  "on_the_way",
];
const LEGACY_DISPATCH_STATUSES = ["offered", "arrived"];
// A driver "has" an order (counts against their active load) for any of these.
const ACTIVE_STATUSES: OrderStatus[] = ["ready", "assigned", "picked_up", "on_the_way"];
const LEGACY_ACTIVE_STATUSES = ["offered", "arrived"];
// Terminal statuses that should never be acted on
const TERMINAL_STATUSES: OrderStatus[] = ["delivered", "rejected", "cancelled", "refunded"];

function toDispatchOrder(p: OrderPayload): DispatchOrder {
  const o = p.order;
  return {
    id: o.id,
    order_number: o.order_number,
    status: o.status,
    order_type: orderType(o),
    placed_at: o.placed_at,
    driver_status: o.driver_status,
    assigned_at: o.assigned_at,
    arrived_at_restaurant: o.arrived_at_restaurant,
    on_the_way_at: o.on_the_way_at,
    arrived_at_customer: o.arrived_at_customer,
    delivered_at: o.delivered_at,
    cancelled_at: o.cancelled_at,
    rejected_at: o.rejected_at ?? null,
    rejection_reason: o.rejection_reason ?? null,
    eta_minutes: o.eta_minutes,
    total: o.total,
    subtotal: o.subtotal,
    delivery_fee: o.delivery_fee,
    tip: o.tip,
    discount: o.discount,
    payment_method: o.payment_method,
    payment_status: o.payment_status,
    delivery_address: o.delivery_address ? formatAddress(o.delivery_address) : null,
    delivery_notes: o.delivery_address?.notes ?? null,
    special_instructions: o.special_instructions,
    restaurant_id: o.restaurant_id,
    restaurant_name: o.restaurant_name,
    restaurant_image: o.restaurant_image,
    branch_id: o.branch_id ?? null,
    branch_name: o.branch_name ?? null,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    customer_email: o.customer_email,
    driver_id: o.driver_id,
    driver_name: o.driver_name,
    driver_phone: o.driver_phone,
    driver_photo: o.driver_photo,
    customer_id: o.customer_id,
    items: p.items.map(lineToItem),
    timeline: p.timeline.map((t) => ({ status: t.status, at: t.at, note: t.note })),
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
}

function lineToItem(l: OrderLine): DispatchOrder["items"][number] {
  return {
    id: l.id,
    item_name: [l.variant?.name, l.name].filter(Boolean).join(" — "),
    quantity: l.quantity,
    notes: l.notes,
    unit_price: l.unit_price + (l.variant?.price_delta ?? 0),
    line_total: l.line_total,
  };
}

function formatAddress(a: NonNullable<FirebaseOrder["delivery_address"]>): string {
  const parts = [a.street, a.city, a.postal_code].filter(Boolean) as string[];
  if (a.label) parts.unshift(a.label);
  return parts.join(", ");
}

let cachedRows: DispatchOrder[] = [];
const subscribers = new Set<(rows: DispatchOrder[]) => void>();
let unsub: (() => void) | null = null;

function currentActor(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("forkfleet.session");
    if (!raw) return profiles[0]?.email ?? null;
    const parsed = JSON.parse(raw) as { email?: string } | null;
    return parsed?.email ?? profiles[0]?.email ?? null;
  } catch {
    return profiles[0]?.email ?? null;
  }
}

function ensureSubscribed() {
  if (unsub) return;
  unsub = subscribeFirebaseOrders((payloads) => {
    cachedRows = payloads.map(toDispatchOrder);
    subscribers.forEach((cb) => {
      try {
        cb(cachedRows);
      } catch (e) {
        console.warn(e);
      }
    });
  });
}

function getCached(): DispatchOrder[] {
  ensureSubscribed();
  return cachedRows;
}

export function onOrdersChanged(cb: (rows: DispatchOrder[]) => void): () => void {
  ensureSubscribed();
  subscribers.add(cb);
  cb(cachedRows);
  return () => {
    subscribers.delete(cb);
  };
}

/* ------------------------------------------------------------- queries --- */

export async function getDispatchBoard(
  arg?: { restaurantId?: string } | { data: { restaurantId?: string } },
): Promise<DispatchOrder[]> {
  const input = unwrap(arg);
  const restaurantId = input?.restaurantId;
  return getCached()
    .filter(
      (o) =>
        DISPATCH_STATUSES.includes(o.status) || LEGACY_DISPATCH_STATUSES.includes(o.status),
    )
    .filter((o) => !restaurantId || restaurantId === "all" || o.restaurant_id === restaurantId)
    .sort((a, b) => new Date(a.placed_at).getTime() - new Date(b.placed_at).getTime())
    .slice(0, 150);
}

type OrderFilters = { search?: string; status?: string; restaurantId?: string; driverId?: string };

export async function listOrders(
  arg?: OrderFilters | { data: OrderFilters },
): Promise<DispatchOrder[]> {
  const input = unwrap(arg);
  const search = input?.search?.trim().toLowerCase();
  return getCached()
    .filter((o) => !input?.status || input.status === "all" || o.status === input.status)
    .filter(
      (o) =>
        !input?.restaurantId ||
        input.restaurantId === "all" ||
        o.restaurant_id === input.restaurantId,
    )
    .filter((o) => !input?.driverId || input.driverId === "all" || o.driver_id === input.driverId)
    .filter(
      (o) =>
        !search ||
        o.order_number.toLowerCase().includes(search) ||
        o.customer_name.toLowerCase().includes(search),
    )
    .sort((a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime())
    .slice(0, 500);
}

export async function listDrivers(
  arg?: { search?: string; status?: string } | { data: { search?: string; status?: string } },
): Promise<DriverRow[]> {
  const input = unwrap(arg);
  const search = input?.search?.trim().toLowerCase();
  const counts: Record<string, number> = {};
  for (const order of getCached()) {
    if (
      order.driver_id &&
      (ACTIVE_STATUSES.includes(order.status) || LEGACY_ACTIVE_STATUSES.includes(order.status))
    ) {
      counts[order.driver_id] = (counts[order.driver_id] ?? 0) + 1;
    }
  }
  return drivers
    .filter((d) => !input?.status || input.status === "all" || d.status === input.status)
    .filter((d) => !search || d.full_name.toLowerCase().includes(search))
    .slice()
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map((d) => ({ ...d, active_orders: counts[d.id] ?? 0 }));
}

/* ------------------------------------------------------------ mutations --- */

/** Accept a pending order (moves it from Incoming to the kitchen queue). */
export async function acceptOrder(arg: { orderId: string } | { data: { orderId: string } }) {
  const input = unwrap(arg)!;
  const order = getCached().find((o) => o.id === input.orderId);
  if (!order) throw new Error("Order not found");
  if (order.status !== "pending")
    throw new Error(`Cannot accept an order that is ${order.status.replace("_", " ")}`);
  await setFirebaseOrderStatus({ orderId: order.id, status: "accepted", actor: currentActor() });
  logAudit({
    action: "order.status.accepted",
    entityType: "order",
    entityId: order.id,
    before: { status: "pending" },
    after: { status: "accepted" },
    actorEmail: currentActor(),
  });
  return { ok: true };
}

/** Reject a pending order with a mandatory reason (shown to the customer). */
export async function rejectOrder(
  arg: { orderId: string; reason: string } | { data: { orderId: string; reason: string } },
) {
  const input = unwrap(arg)!;
  const reason = (input.reason ?? "").trim();
  if (!reason) throw new Error("A rejection reason is required.");
  const order = getCached().find((o) => o.id === input.orderId);
  if (!order) throw new Error("Order not found");
  if (order.status !== "pending") {
    throw new Error(`Cannot reject an order that is already ${order.status.replace("_", " ")}`);
  }
  await rejectFirebaseOrder({ orderId: order.id, reason, actor: currentActor() });
  logAudit({
    action: "order.status.rejected",
    entityType: "order",
    entityId: order.id,
    before: { status: "pending" },
    after: { status: "rejected", reason },
    actorEmail: currentActor(),
  });
  return { ok: true };
}

type AssignInput = { orderId: string; driverId: string; etaMinutes?: number };

export async function assignDriver(arg: AssignInput | { data: AssignInput }) {
  const input = unwrap(arg)!;
  const order = getCached().find((o) => o.id === input.orderId);
  if (!order) throw new Error("Order not found");
  // Ready orders can be offered a driver for the first time; a legacy
  // "offered" order (from an earlier console build) can be re-offered to a
  // different driver while the current one hasn't accepted yet. Once
  // "assigned" (accepted), staff can no longer swap drivers through this flow.
  const rawStatus = order.status as string;
  if (rawStatus !== "ready" && rawStatus !== "offered") {
    throw new Error(
      `You can only assign a driver when the order is ready for delivery or waiting for a driver to accept (currently ${order.status.replace("_", " ")}).`,
    );
  }

  // Authoritative eligibility: approved (verified + active) driver with an
  // active assignment for the order's exact restaurant and branch.
  const fbDriver = await getFirebaseDriver(input.driverId);
  if (fbDriver) {
    const eligibility = await isDriverEligibleForBranch(
      input.driverId,
      order.restaurant_id,
      order.branch_id,
    );
    if (!eligibility.eligible) {
      throw new Error(eligibility.reason ?? "This driver is not eligible for this order.");
    }
  } else {
    // Firebase unavailable — fall back to the local driver model (preview only).
    const driver = drivers.find((d) => d.id === input.driverId);
    if (!driver) throw new Error("Driver not found");
    if (driver.is_verified !== true) throw new Error("This driver is not approved.");
  }

  let driverName = fbDriver?.full_name ?? null;
  let driverPhone = fbDriver?.phone ?? null;
  if (!fbDriver) {
    const demo = drivers.find((d) => d.id === input.driverId);
    driverName = demo?.full_name ?? input.driverId;
    driverPhone = demo?.phone ?? null;
  }

  await assignFirebaseDriver({
    orderId: input.orderId,
    driverId: input.driverId,
    driverName,
    driverPhone,
    etaMinutes: input.etaMinutes ?? 30,
  });

  if (fbDriver) {
    // Mutating the in-memory demo copy is irrelevant for Firebase-backed drivers.
  } else {
    const demo = drivers.find((d) => d.id === input.driverId);
    if (demo) {
      if (demo.status === "online") demo.status = "busy";
      demo.updated_at = new Date().toISOString();
    }
  }

  logAudit({
    action: "order.driver.assigned",
    entityType: "order",
    entityId: input.orderId,
    after: { driver_id: input.driverId },
    actorEmail: currentActor(),
  });
  return { ok: true };
}

/**
 * Fallback mutation: mark the driver as having reached the restaurant.
 * Mirrors exactly what the driver app itself would write — see
 * markArrivedAtRestaurant() in orders.firebase.ts. `status` is untouched.
 *
 * Not currently wired to any UI button (removed 2026-09-17) — kept in case
 * a staff-facing trigger is reinstated later.
 */
export async function markArrivedAtRestaurant(
  arg: { orderId: string } | { data: { orderId: string } },
) {
  const input = unwrap(arg)!;
  const existing = getCached().find((o) => o.id === input.orderId);
  if (!existing) throw new Error("Order not found");
  await markArrivedAtRestaurantFb({ orderId: input.orderId, actor: currentActor() });
  logAudit({
    action: "order.driver_status.arrived_at_restaurant",
    entityType: "order",
    entityId: input.orderId,
    before: { driver_status: existing.driver_status ?? null },
    after: { driver_status: "arrived_at_restaurant" },
    actorEmail: currentActor(),
  });
  return { ok: true };
}

type AdvanceInput = { orderId: string; nextStatus: OrderStatus; etaMinutes?: number };

// Pickup orders have no driver at all — staff drive the whole flow manually:
// ready → picked_up (customer collected) → delivered (closed), or cancelled.
const PICKUP_TRANSITIONS: OrderStatus[] = ["picked_up", "delivered", "cancelled"];
// Delivery orders: per docs/ORDER_WORKFLOW_HANDOVER.md, pickup normally
// requires the driver to verify a PIN in their own app — but staff also have
// a manual "Mark picked up" fallback for when the driver is at the
// restaurant and hasn't (yet) done that (re-added 2026-09-17). Everything
// after pickup (on the way, delivered) stays driver-app-only.
const DELIVERY_TRANSITIONS: OrderStatus[] = ["picked_up", "cancelled"];

export async function advanceDelivery(arg: AdvanceInput | { data: AdvanceInput }) {
  const input = unwrap(arg)!;
  const existing = getCached().find((o) => o.id === input.orderId);
  if (!existing) throw new Error("Order not found");
  const isPickup = existing.order_type === "pickup";
  const allowed = isPickup ? PICKUP_TRANSITIONS : DELIVERY_TRANSITIONS;
  if (!allowed.includes(input.nextStatus)) {
    throw new Error(
      isPickup
        ? "Pickup orders can only be marked collected, completed or cancelled"
        : "Delivery orders can only be marked picked up or cancelled from this screen — on the way and delivered are written by the driver app",
    );
  }
  if (input.nextStatus !== "cancelled" && !existing.driver_id && !isPickup) {
    throw new Error("Assign a driver before moving the delivery forward");
  }
  if (TERMINAL_STATUSES.includes(existing.status)) {
    throw new Error(`Order is already ${existing.status.replace("_", " ")}`);
  }

  await setFirebaseOrderStatus({
    orderId: input.orderId,
    status: input.nextStatus,
    etaMinutes: input.etaMinutes ?? null,
    actor: currentActor(),
  });

  if (
    existing.driver_id &&
    (input.nextStatus === "delivered" || input.nextStatus === "cancelled")
  ) {
    const driver = drivers.find((d) => d.id === existing.driver_id);
    if (driver) {
      if (input.nextStatus === "delivered") driver.total_deliveries += 1;
      if (driver.status === "busy") driver.status = "online";
      driver.updated_at = new Date().toISOString();
    }
  }

  logAudit({
    action: `order.status.${input.nextStatus}`,
    entityType: "order",
    entityId: input.orderId,
    before: { status: existing.status },
    after: { status: input.nextStatus, driver_id: existing.driver_id ?? null },
    actorEmail: currentActor(),
  });
  return { ok: true };
}

export async function setDriverStatus(
  arg:
    | { driverId: string; status: DriverStatus }
    | { data: { driverId: string; status: DriverStatus } },
) {
  const input = unwrap(arg)!;
  const driver = drivers.find((d) => d.id === input.driverId);
  if (!driver) throw new Error("Driver not found");
  const previous = driver.status;
  driver.status = input.status;
  driver.updated_at = new Date().toISOString();
  logAudit({
    action: `driver.status.${input.status}`,
    entityType: "driver",
    entityId: driver.id,
    before: { status: previous },
    after: { status: input.status },
    actorEmail: currentActor(),
  });
  return { ok: true };
}

type AuditInput = { entityType: string; entityId?: string; limit?: number };

export async function getAuditTrail(arg?: AuditInput | { data: AuditInput }): Promise<AuditRow[]> {
  const input = unwrap(arg);
  const entityType = input?.entityType ?? "order";
  const entityId = input?.entityId;

  const fromTimeline: AuditRow[] = [];
  if (entityType === "order" && entityId) {
    const order = getCached().find((o) => o.id === entityId);
    if (order) {
      for (const t of order.timeline) {
        fromTimeline.push({
          id: `fb-${uid("atl")}`,
          action: `order.status.${t.status}`,
          entity_type: "order",
          entity_id: entityId,
          actor_email: null,
          before_value: null,
          after_value: { status: t.status, note: t.note ?? null },
          created_at: t.at,
        });
      }
    }
  }

  const fromStore = auditLogs
    .filter((a) => a.entity_type === entityType)
    .filter((a) => !entityId || a.entity_id === entityId);

  return [...fromTimeline, ...fromStore]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, input?.limit ?? 50);
}
