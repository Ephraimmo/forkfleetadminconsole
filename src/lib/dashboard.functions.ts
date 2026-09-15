// Dashboard aggregator. Orders come from Firebase; restaurants, drivers and
// customers still come from the local demo store (those modules haven't been
// migrated yet — only the order pipeline is Firebase-backed per scope).

import { listFirebaseOrders, type OrderPayload } from "@/lib/orders.firebase";
import {
  auditLogs,
  customers,
  delay,
  drivers,
  restaurants,
} from "@/lib/demo-store";
import { listFirebaseRestaurants } from "@/lib/restaurants.firebase";

export interface DashboardMetrics {
  today_orders: number;
  today_revenue: number;
  week_revenue: number;
  month_revenue: number;
  total_revenue: number;
  commission_earned: number;
  avg_order_value: number;
  status_counts: Record<string, number>;
  restaurants_total: number;
  restaurants_pending: number;
  drivers_total: number;
  drivers_online: number;
  customers_total: number;
  customers_new_30d: number;
}

export interface TrendPoint {
  day: string;
  revenue: number;
  orders: number;
}

export interface TopRestaurant {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  orders: number;
  revenue: number;
}

export interface TopMenuItem {
  name: string;
  units: number;
  revenue: number;
}

export interface BestCustomer {
  id: string;
  full_name: string;
  email: string;
  orders: number;
  spend: number;
}

export interface DriverPerformance {
  id: string;
  full_name: string;
  status: string;
  rating: number;
  deliveries: number;
  earnings: number;
}

export interface LiveOrder {
  id: string;
  order_number: string;
  status: string;
  total: number;
  placed_at: string;
  eta_minutes: number | null;
  restaurant: string;
  customer: string;
  driver: string | null;
}

export interface ActivityEntry {
  id: string;
  action: string;
  entity_type: string;
  actor_email: string | null;
  created_at: string;
}

export interface DashboardPayload {
  metrics: DashboardMetrics;
  trend: TrendPoint[];
  topRestaurants: TopRestaurant[];
  topItems: TopMenuItem[];
  bestCustomers: BestCustomer[];
  driverPerformance: DriverPerformance[];
  liveOrders: LiveOrder[];
  activity: ActivityEntry[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const ms = (days: number) => days * 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const IN_FLIGHT = ["pending", "accepted", "preparing", "ready", "assigned", "picked_up", "on_the_way"];
const SETTLED = ["delivered", "refunded"];

function pluck<T extends object, K extends keyof T>(arr: T[], key: K): Array<T[K]> {
  return arr.map((o) => o[key]);
}

/** Aggregates Firebase orders (+ local demo drivers/customers/restaurants) into dashboard payload. */
export async function getDashboard(): Promise<DashboardPayload> {
  await delay(30);
  const payloads = await listFirebaseOrders();
  type FbOrder = OrderPayload["order"];
  type AugOrder = FbOrder & { _items: OrderPayload["items"] };
  const ordersList: AugOrder[] = payloads.map((p) => ({
    ...p.order,
    _items: p.items,
  }));
  // Treat Firebase restaurants list first; fall back to demo restaurant rows for
  // counts if Firebase hasn't loaded on SSR.
  let restList: Array<{ id: string; name: string; cuisine: string; rating: number; status: string }> = restaurants;
  try {
    const fbR = await listFirebaseRestaurants();
    if (fbR.length > 0) restList = fbR;
  } catch { /* keep demo fallback */ }

  const now = Date.now();
  const today = startOfDay(new Date());

  const delivered = ordersList.filter((o) => o.status === "delivered");
  const since = (from: number) => ordersList.filter((o) => new Date(o.placed_at).getTime() >= from);

  const statusCounts: Record<string, number> = {};
  for (const o of ordersList) statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;

  const sumField = (list: typeof ordersList, key: "total" | "delivery_fee" | "subtotal" | "discount" | "tip") =>
    round2(list.reduce((acc, o) => acc + Number(o[key] ?? 0), 0));

  const commissionTotal = round2(
    delivered.reduce((acc, o) => {
      // commission ≈ 18% of (subtotal - discount) as a reasonable default since
      // Firebase orders do not carry a per-order commission field yet.
      return acc + Math.max(0, (o.subtotal - o.discount)) * 0.18;
    }, 0),
  );

  const metrics: DashboardMetrics = {
    today_orders: ordersList.filter((o) => new Date(o.placed_at).getTime() >= today).length,
    today_revenue: sumField(since(today).filter((o) => SETTLED.includes(o.status)), "total"),
    week_revenue: sumField(since(now - ms(7)).filter((o) => SETTLED.includes(o.status)), "total"),
    month_revenue: sumField(since(now - ms(30)).filter((o) => SETTLED.includes(o.status)), "total"),
    total_revenue: sumField(delivered, "total"),
    commission_earned: commissionTotal,
    avg_order_value: delivered.length ? round2(sumField(delivered, "total") / delivered.length) : 0,
    status_counts: statusCounts,
    restaurants_total: restList.length,
    restaurants_pending: restList.filter((r) => r.status === "pending").length,
    drivers_total: drivers.length,
    drivers_online: drivers.filter((d) => d.status === "online" || d.status === "busy").length,
    customers_total: customers.length,
    customers_new_30d: customers.filter((c) => new Date(c.created_at).getTime() >= now - ms(30)).length,
  };

  const trend: TrendPoint[] = Array.from({ length: 14 }, (_, i) => {
    const dayStart = startOfDay(new Date(now - ms(13 - i)));
    const dayEnd = dayStart + ms(1);
    const dayOrders = ordersList.filter((o) => {
      const t = new Date(o.placed_at).getTime();
      return t >= dayStart && t < dayEnd;
    });
    return {
      day: new Date(dayStart).toISOString().slice(0, 10),
      revenue: sumField(dayOrders.filter((o) => o.status === "delivered"), "total"),
      orders: dayOrders.length,
    };
  });

  const restNameById = new Map(restList.map((r) => [r.id, { name: r.name, cuisine: r.cuisine, rating: Number(r.rating) }]));
  const topRestaurants: TopRestaurant[] = Array.from(
    ordersList.reduce((acc, o) => {
      const key = o.restaurant_id;
      const row = acc.get(key) ?? { orders: 0, revenue: 0 };
      row.orders += 1;
      if (o.status === "delivered") row.revenue += o.total;
      acc.set(key, row);
      return acc;
    }, new Map<string, { orders: number; revenue: number }>()).entries(),
  )
    .map(([id, v]) => {
      const r = restNameById.get(id);
      const anyOrder = ordersList.find((o) => o.restaurant_id === id);
      return {
        id,
        name: r?.name ?? anyOrder?.restaurant_name ?? id,
        cuisine: r?.cuisine ?? "—",
        rating: r?.rating ?? 0,
        orders: v.orders,
        revenue: round2(v.revenue),
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 6);

  const itemTotals = new Map<string, { units: number; revenue: number }>();
  for (const p of payloads) {
    for (const line of p.items) {
      const key = line.name;
      const cur = itemTotals.get(key) ?? { units: 0, revenue: 0 };
      cur.units += line.quantity;
      cur.revenue += line.line_total;
      itemTotals.set(key, cur);
    }
  }
  const topItems: TopMenuItem[] = Array.from(itemTotals.entries())
    .map(([name, v]) => ({ name, units: v.units, revenue: round2(v.revenue) }))
    .sort((a, b) => b.units - a.units)
    .slice(0, 6);

  // Customer and driver breakdowns fall back to demo customer/driver IDs when
  // Firebase orders carry those ids; otherwise they show against the customer
  // name stored on the order itself.
  const custSpend = new Map<string, { orders: number; spend: number }>();
  for (const o of ordersList) {
    const key = o.customer_id ?? `guest:${o.customer_name}`;
    const cur = custSpend.get(key) ?? { orders: 0, spend: 0 };
    cur.orders += 1;
    if (o.status === "delivered") cur.spend += o.total;
    custSpend.set(key, cur);
  }
  const bestCustomers: BestCustomer[] = Array.from(custSpend.entries())
    .map(([key, v]) => {
      const c = customers.find((cu) => cu.id === key);
      const guestOrder = ordersList.find((o) => (o.customer_id ?? `guest:${o.customer_name}`) === key);
      return {
        id: key,
        full_name: c?.full_name ?? guestOrder?.customer_name ?? "Guest",
        email: c?.email ?? "",
        orders: v.orders,
        spend: round2(v.spend),
      };
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 6);

  const driverPerf = new Map<string, { deliveries: number; earnings: number }>();
  for (const o of ordersList) {
    if (!o.driver_id || o.status !== "delivered") continue;
    const cur = driverPerf.get(o.driver_id) ?? { deliveries: 0, earnings: 0 };
    cur.deliveries += 1;
    cur.earnings += o.delivery_fee + o.tip;
    driverPerf.set(o.driver_id, cur);
  }
  const driverPerformance: DriverPerformance[] = drivers
    .map((d) => {
      const s = driverPerf.get(d.id) ?? { deliveries: 0, earnings: 0 };
      return {
        id: d.id,
        full_name: d.full_name,
        status: d.status,
        rating: d.rating,
        deliveries: s.deliveries,
        earnings: round2(s.earnings),
      };
    })
    .sort((a, b) => b.deliveries - a.deliveries)
    .slice(0, 6);

  const liveOrders: LiveOrder[] = ordersList
    .filter((o) => IN_FLIGHT.includes(o.status))
    .sort((a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime())
    .slice(0, 12)
    .map((o) => ({
      id: o.id,
      order_number: o.order_number,
      status: o.status,
      total: o.total,
      placed_at: o.placed_at,
      eta_minutes: o.eta_minutes,
      restaurant: o.restaurant_name,
      customer: o.customer_name,
      driver: o.driver_name,
    }));

  // Merge Firebase order timeline events into the activity feed
  const fbActivity: ActivityEntry[] = [];
  for (const p of payloads.slice(0, 20)) {
    for (const t of p.timeline.slice(-2)) {
      fbActivity.push({
        id: `fb-${p.order.id}-${t.id}`,
        action: `order.status.${t.status}`,
        entity_type: "order",
        actor_email: t.actor,
        created_at: t.at,
      });
    }
  }
  const localActivity: ActivityEntry[] = auditLogs.slice(0, 8).map((a) => ({
    id: a.id,
    action: a.action,
    entity_type: a.entity_type,
    actor_email: a.actor_email,
    created_at: a.created_at,
  }));
  const activity = [...fbActivity, ...localActivity]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8);

  return { metrics, trend, topRestaurants, topItems, bestCustomers, driverPerformance, liveOrders, activity };
}

