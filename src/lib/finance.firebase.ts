// Live revenue & restaurant-settlement reporting, computed directly from
// real orders — no demo data. Pure functions: callers fetch orders/restaurants
// once (e.g. via listFirebaseOrders()/listFirebaseRestaurants()) and pass the
// arrays in, so the Payments page can reuse one fetch across every tab.
//
// "Revenue" means completed orders only (status "delivered" — both delivery
// and customer-pickup orders reach that terminal status, see
// docs/ORDER_WORKFLOW_HANDOVER.md), bucketed by delivered_at (falling back to
// placed_at for legacy rows written before that field existed).

import type { FirebaseOrder } from "@/lib/orders.firebase";
import type { FirebaseRestaurant } from "@/lib/restaurants.firebase";

export type PeriodGranularity = "day" | "week" | "month" | "custom";

export interface DateRange {
  start: Date;
  end: Date;
}

export const PERIOD_LABEL: Record<PeriodGranularity, string> = {
  day: "Today",
  week: "This week",
  month: "This month",
  custom: "Custom range",
};

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

/** Monday-start week. */
function startOfWeek(d: Date): Date {
  const c = startOfDay(d);
  const day = c.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  c.setDate(c.getDate() + diff);
  return c;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** Resolve a named granularity (relative to `reference`, default now) into a
 *  concrete date range. "custom" requires `custom` to be supplied. */
export function resolvePeriodRange(
  granularity: PeriodGranularity,
  custom?: DateRange,
  reference: Date = new Date(),
): DateRange {
  switch (granularity) {
    case "day":
      return { start: startOfDay(reference), end: endOfDay(reference) };
    case "week": {
      const start = startOfWeek(reference);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return { start, end: endOfDay(end) };
    }
    case "month":
      return { start: startOfMonth(reference), end: endOfMonth(reference) };
    case "custom": {
      if (!custom) throw new Error("Custom period requires a date range");
      return { start: startOfDay(custom.start), end: endOfDay(custom.end) };
    }
  }
}

function inRange(iso: string, range: DateRange): boolean {
  const t = new Date(iso).getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
}

/** Orders that count as realised revenue for the period. */
function completedOrdersIn(orders: FirebaseOrder[], range: DateRange): FirebaseOrder[] {
  return orders.filter(
    (o) => o.status === "delivered" && inRange(o.delivered_at ?? o.placed_at, range),
  );
}

export interface RevenueByRestaurant {
  restaurant_id: string;
  restaurant_name: string;
  revenue: number;
  orders: number;
}

export interface RevenueByDay {
  date: string; // YYYY-MM-DD
  revenue: number;
  orders: number;
}

export interface RevenueByMethod {
  method: string;
  revenue: number;
  orders: number;
}

export interface RevenueSummary {
  range: DateRange;
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  deliveryFees: number;
  byRestaurant: RevenueByRestaurant[];
  byDay: RevenueByDay[];
  byMethod: RevenueByMethod[];
}

/** Revenue actually made — completed orders only, grouped by restaurant, by
 *  day and by payment method for the given period. */
export function summarizeRevenue(orders: FirebaseOrder[], range: DateRange): RevenueSummary {
  const completed = completedOrdersIn(orders, range);

  const totalRevenue = completed.reduce((s, o) => s + o.total, 0);
  const totalOrders = completed.length;
  const deliveryFees = completed.reduce((s, o) => s + o.delivery_fee, 0);

  const byRestaurantMap = new Map<string, RevenueByRestaurant>();
  for (const o of completed) {
    const key = o.restaurant_id || o.restaurant_name;
    const entry = byRestaurantMap.get(key) ?? {
      restaurant_id: o.restaurant_id,
      restaurant_name: o.restaurant_name,
      revenue: 0,
      orders: 0,
    };
    entry.revenue += o.total;
    entry.orders += 1;
    byRestaurantMap.set(key, entry);
  }
  const byRestaurant = Array.from(byRestaurantMap.values()).sort((a, b) => b.revenue - a.revenue);

  const byDayMap = new Map<string, RevenueByDay>();
  for (const o of completed) {
    const key = (o.delivered_at ?? o.placed_at).slice(0, 10);
    const entry = byDayMap.get(key) ?? { date: key, revenue: 0, orders: 0 };
    entry.revenue += o.total;
    entry.orders += 1;
    byDayMap.set(key, entry);
  }
  const byDay = Array.from(byDayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const byMethodMap = new Map<string, RevenueByMethod>();
  for (const o of completed) {
    const entry = byMethodMap.get(o.payment_method) ?? {
      method: o.payment_method,
      revenue: 0,
      orders: 0,
    };
    entry.revenue += o.total;
    entry.orders += 1;
    byMethodMap.set(o.payment_method, entry);
  }
  const byMethod = Array.from(byMethodMap.values()).sort((a, b) => b.revenue - a.revenue);

  return {
    range,
    totalRevenue,
    totalOrders,
    averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    deliveryFees,
    byRestaurant,
    byDay,
    byMethod,
  };
}

export interface RestaurantSettlementRow {
  restaurant_id: string;
  restaurant_name: string;
  orders: number;
  revenue: number;
  commission_rate: number;
  commission: number;
  amount_owed: number;
}

const DEFAULT_COMMISSION_RATE = 15;

/** What each restaurant is owed for the period — revenue from completed
 *  orders minus the platform's commission (FirebaseRestaurant.commission_rate).
 *  Informational only: there is no paid/unpaid ledger for restaurants, unlike
 *  driver payouts — see driver-payouts.firebase.ts. */
export function summarizeRestaurantSettlements(
  orders: FirebaseOrder[],
  restaurants: FirebaseRestaurant[],
  range: DateRange,
): RestaurantSettlementRow[] {
  const rateById = new Map(restaurants.map((r) => [r.id, r.commission_rate]));
  const completed = completedOrdersIn(orders, range);

  const map = new Map<string, RestaurantSettlementRow>();
  for (const o of completed) {
    const key = o.restaurant_id || o.restaurant_name;
    const rate = rateById.get(o.restaurant_id) ?? DEFAULT_COMMISSION_RATE;
    const entry = map.get(key) ?? {
      restaurant_id: o.restaurant_id,
      restaurant_name: o.restaurant_name,
      orders: 0,
      revenue: 0,
      commission_rate: rate,
      commission: 0,
      amount_owed: 0,
    };
    entry.orders += 1;
    entry.revenue += o.total;
    map.set(key, entry);
  }
  for (const entry of map.values()) {
    entry.commission = Math.round(entry.revenue * (entry.commission_rate / 100) * 100) / 100;
    entry.amount_owed = Math.round((entry.revenue - entry.commission) * 100) / 100;
  }
  return Array.from(map.values()).sort((a, b) => b.amount_owed - a.amount_owed);
}
