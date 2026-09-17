// Kitchen queue — reads from Firebase orders; exposes the same shape the
// Kitchen page uses for its Kanban board.

import {
  orderType,
  setFirebaseOrderStatus,
  subscribeFirebaseOrders,
  type OrderPayload,
  type OrderStatus,
  type OrderType,
} from "@/lib/orders.firebase";
import { audit } from "@/lib/audit";
import { profiles } from "@/lib/demo-store";

export type KitchenStatus = "accepted" | "preparing" | "ready" | "assigned" | "picked_up";

export interface KitchenOrder {
  id: string;
  order_number: string;
  status: OrderStatus;
  /** "delivery" (goes to a driver) vs "pickup" (customer collects at the counter). */
  order_type: OrderType;
  placed_at: string;
  eta_minutes: number | null;
  total: number;
  special_instructions: string | null;
  delivery_notes: string | null;
  restaurant_id: string;
  restaurant_name: string;
  customer_name: string;
  items: { id: string; item_name: string; quantity: number; notes: string | null }[];
}

// Kitchen only sees orders once they've been accepted on the Orders page.
// The Incoming column on Orders is where new customer orders land; kitchen
// starts from "accepted" (chef accepts it onto the pass) → preparing → ready.
const KITCHEN_STATUSES: OrderStatus[] = ["accepted", "preparing", "ready"];

let cached: KitchenOrder[] = [];
const subs = new Set<(rows: KitchenOrder[]) => void>();
let unsub: (() => void) | null = null;

function toKitchen(p: OrderPayload): KitchenOrder {
  const o = p.order;
  return {
    id: o.id,
    order_number: o.order_number,
    status: o.status,
    order_type: orderType(o),
    placed_at: o.placed_at,
    eta_minutes: o.eta_minutes,
    total: Number(o.total ?? 0),
    special_instructions: o.special_instructions,
    delivery_notes: o.delivery_address?.notes ?? null,
    restaurant_id: o.restaurant_id,
    restaurant_name: o.restaurant_name,
    customer_name: o.customer_name,
    items: p.items.map((l) => ({
      id: l.id,
      item_name: [l.variant?.name, l.name].filter(Boolean).join(" — "),
      quantity: l.quantity,
      notes: l.notes,
    })),
  };
}

function ensureSubscribed() {
  if (unsub) return;
  unsub = subscribeFirebaseOrders((rows) => {
    cached = rows.map(toKitchen);
    subs.forEach((cb) => {
      try {
        cb(cached);
      } catch (e) {
        console.warn(e);
      }
    });
  });
}

function getCached(): KitchenOrder[] {
  ensureSubscribed();
  return cached;
}

export function onKitchenChanged(cb: (rows: KitchenOrder[]) => void): () => void {
  ensureSubscribed();
  subs.add(cb);
  cb(cached);
  return () => {
    subs.delete(cb);
  };
}

const NEXT_STATUS: Record<OrderStatus, OrderStatus | undefined> = {
  pending: undefined, // must be accepted on the Orders page, not in kitchen
  accepted: "preparing",
  preparing: "ready",
  ready: undefined, // dispatch picks up from here
  assigned: undefined,
  picked_up: undefined,
  on_the_way: undefined,
  delivered: undefined,
  cancelled: undefined,
  rejected: undefined,
  refunded: undefined,
};

export async function getKitchenQueue(
  input: { restaurantId?: string } | undefined,
): Promise<KitchenOrder[]> {
  const rid = input?.restaurantId;
  return getCached()
    .filter((o) => KITCHEN_STATUSES.includes(o.status))
    .filter((o) => !rid || rid === "all" || o.restaurant_id === rid)
    .slice()
    .sort((a, b) => a.placed_at.localeCompare(b.placed_at))
    .slice(0, 120);
}

export async function advanceOrder(input: { orderId: string; nextStatus: string }) {
  const order = getCached().find((o) => o.id === input.orderId);
  if (!order) throw new Error("Order not found");
  const expected = NEXT_STATUS[order.status];
  if (!expected || expected !== input.nextStatus) {
    throw new Error(`Cannot move order from ${order.status} to ${input.nextStatus}`);
  }

  await setFirebaseOrderStatus({
    orderId: order.id,
    status: expected,
    etaMinutes: expected === "ready" ? Math.max(5, order.eta_minutes ?? 15) : null,
    actor: profiles[0]?.email ?? null,
  });

  audit({
    action: "order.advance",
    entityType: "order",
    entityId: order.id,
    after: { status: expected },
  });
  return { ok: true };
}

/**
 * Hand a finished pickup order to the customer at the counter. Only valid for
 * order_type === "pickup" in status "ready" — there is no driver to assign.
 * After collection the order leaves the kitchen board; staff close it from the
 * Dispatch board (Customer pickups lane) or the Orders page.
 */
export async function markCustomerCollected(input: { orderId: string }) {
  const order = getCached().find((o) => o.id === input.orderId);
  if (!order) throw new Error("Order not found");
  if (order.order_type !== "pickup") {
    throw new Error("Only customer pickup orders can be marked collected");
  }
  if (order.status !== "ready") {
    throw new Error("Order must be ready before it can be handed to the customer");
  }

  await setFirebaseOrderStatus({
    orderId: order.id,
    status: "picked_up",
    note: "Customer collected at the counter",
    actor: profiles[0]?.email ?? null,
  });

  audit({
    action: "order.customer_collected",
    entityType: "order",
    entityId: order.id,
    after: { status: "picked_up" },
  });
  return { ok: true };
}
