import { describe, expect, it } from "vitest";
import {
  resolvePeriodRange,
  summarizeRestaurantSettlements,
  summarizeRevenue,
  type DateRange,
} from "./finance.firebase";
import type { FirebaseOrder } from "./orders.firebase";
import type { FirebaseRestaurant } from "./restaurants.firebase";

/** Minimal order shape the summarizers actually read. */
function order(input: {
  id: string;
  status: FirebaseOrder["status"];
  total: number;
  delivery_fee?: number;
  placed_at: string;
  delivered_at?: string | null;
  restaurant_id?: string;
  restaurant_name?: string;
  payment_method?: FirebaseOrder["payment_method"];
}): FirebaseOrder {
  return {
    id: input.id,
    status: input.status,
    total: input.total,
    delivery_fee: input.delivery_fee ?? 0,
    placed_at: input.placed_at,
    delivered_at: input.delivered_at ?? null,
    restaurant_id: input.restaurant_id ?? "r1",
    restaurant_name: input.restaurant_name ?? "Restaurant One",
    payment_method: input.payment_method ?? "card",
  } as FirebaseOrder;
}

const RANGE: DateRange = { start: new Date("2026-09-14T00:00:00.000Z"), end: new Date("2026-09-20T23:59:59.999Z") };

describe("resolvePeriodRange", () => {
  it("day resolves to the start/end of the reference date", () => {
    const range = resolvePeriodRange("day", undefined, new Date("2026-09-17T10:00:00.000Z"));
    expect(range.start.getDate()).toBe(range.end.getDate());
  });

  it("week starts on Monday", () => {
    // 2026-09-17 is a Thursday.
    const range = resolvePeriodRange("week", undefined, new Date("2026-09-17T10:00:00.000Z"));
    expect(range.start.getDay()).toBe(1);
  });

  it("custom throws without a range", () => {
    expect(() => resolvePeriodRange("custom")).toThrow();
  });

  it("custom uses the supplied range", () => {
    const custom = { start: new Date("2026-01-01"), end: new Date("2026-01-31") };
    const range = resolvePeriodRange("custom", custom);
    expect(range.start.getMonth()).toBe(0);
    expect(range.end.getDate()).toBe(31);
  });
});

describe("summarizeRevenue", () => {
  const orders = [
    order({ id: "o1", status: "delivered", total: 100, delivery_fee: 20, placed_at: "2026-09-16T10:00:00.000Z", restaurant_id: "r1", restaurant_name: "A", payment_method: "card" }),
    order({ id: "o2", status: "delivered", total: 50, delivery_fee: 10, placed_at: "2026-09-17T10:00:00.000Z", restaurant_id: "r2", restaurant_name: "B", payment_method: "eft" }),
    order({ id: "o3", status: "cancelled", total: 999, placed_at: "2026-09-17T10:00:00.000Z" }),
    order({ id: "o4", status: "delivered", total: 30, placed_at: "2026-01-01T10:00:00.000Z" }), // outside range
  ];

  it("only counts delivered orders inside the range", () => {
    const summary = summarizeRevenue(orders, RANGE);
    expect(summary.totalOrders).toBe(2);
    expect(summary.totalRevenue).toBe(150);
  });

  it("computes average order value", () => {
    const summary = summarizeRevenue(orders, RANGE);
    expect(summary.averageOrderValue).toBe(75);
  });

  it("groups by restaurant, day and payment method", () => {
    const summary = summarizeRevenue(orders, RANGE);
    expect(summary.byRestaurant).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ restaurant_id: "r1", revenue: 100 }),
        expect.objectContaining({ restaurant_id: "r2", revenue: 50 }),
      ]),
    );
    expect(summary.byDay).toHaveLength(2);
    expect(summary.byMethod).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "card", revenue: 100 }),
        expect.objectContaining({ method: "eft", revenue: 50 }),
      ]),
    );
  });

  it("returns zeroed totals with no matching orders", () => {
    const summary = summarizeRevenue([], RANGE);
    expect(summary.totalRevenue).toBe(0);
    expect(summary.totalOrders).toBe(0);
    expect(summary.averageOrderValue).toBe(0);
  });
});

describe("summarizeRestaurantSettlements", () => {
  const restaurants = [
    { id: "r1", commission_rate: 20 } as FirebaseRestaurant,
    { id: "r2", commission_rate: 10 } as FirebaseRestaurant,
  ];

  it("deducts each restaurant's own commission rate from its revenue", () => {
    const orders = [
      order({ id: "o1", status: "delivered", total: 100, placed_at: "2026-09-16T10:00:00.000Z", restaurant_id: "r1" }),
      order({ id: "o2", status: "delivered", total: 200, placed_at: "2026-09-16T10:00:00.000Z", restaurant_id: "r2" }),
    ];
    const rows = summarizeRestaurantSettlements(orders, restaurants, RANGE);
    const r1 = rows.find((r) => r.restaurant_id === "r1")!;
    const r2 = rows.find((r) => r.restaurant_id === "r2")!;
    expect(r1.commission).toBe(20);
    expect(r1.amount_owed).toBe(80);
    expect(r2.commission).toBe(20);
    expect(r2.amount_owed).toBe(180);
  });

  it("falls back to the default rate when the restaurant isn't in the lookup", () => {
    const orders = [order({ id: "o1", status: "delivered", total: 100, placed_at: "2026-09-16T10:00:00.000Z", restaurant_id: "unknown" })];
    const rows = summarizeRestaurantSettlements(orders, restaurants, RANGE);
    expect(rows[0]!.commission_rate).toBe(15);
  });

  it("sorts by amount owed, descending", () => {
    const orders = [
      order({ id: "o1", status: "delivered", total: 50, placed_at: "2026-09-16T10:00:00.000Z", restaurant_id: "r1" }),
      order({ id: "o2", status: "delivered", total: 500, placed_at: "2026-09-16T10:00:00.000Z", restaurant_id: "r2" }),
    ];
    const rows = summarizeRestaurantSettlements(orders, restaurants, RANGE);
    expect(rows[0]!.restaurant_id).toBe("r2");
  });
});
