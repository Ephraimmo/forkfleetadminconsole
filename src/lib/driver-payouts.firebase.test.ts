import { describe, expect, it } from "vitest";
import { computeDriverPayouts, DRIVER_COMMISSION_PER_DELIVERY, summarizeDriverDeliveries } from "./driver-payouts.firebase";
import type { DateRange } from "./finance.firebase";
import type { FirebaseOrder } from "./orders.firebase";

function order(input: {
  id: string;
  status: FirebaseOrder["status"];
  driver_id?: string | null;
  driver_name?: string | null;
  delivery_fee?: number;
  placed_at: string;
  delivered_at?: string | null;
}): FirebaseOrder {
  return {
    id: input.id,
    status: input.status,
    driver_id: input.driver_id ?? null,
    driver_name: input.driver_name ?? null,
    delivery_fee: input.delivery_fee ?? 0,
    placed_at: input.placed_at,
    delivered_at: input.delivered_at ?? null,
  } as FirebaseOrder;
}

const RANGE: DateRange = { start: new Date("2026-09-14T00:00:00.000Z"), end: new Date("2026-09-20T23:59:59.999Z") };

describe("summarizeDriverDeliveries", () => {
  it("only counts delivered orders with a driver, inside the range", () => {
    const orders = [
      order({ id: "o1", status: "delivered", driver_id: "d1", driver_name: "Sipho", delivery_fee: 25, placed_at: "2026-09-16T10:00:00.000Z" }),
      order({ id: "o2", status: "delivered", driver_id: "d1", driver_name: "Sipho", delivery_fee: 30, placed_at: "2026-09-17T10:00:00.000Z" }),
      order({ id: "o3", status: "cancelled", driver_id: "d1", delivery_fee: 30, placed_at: "2026-09-17T10:00:00.000Z" }),
      order({ id: "o4", status: "delivered", driver_id: null, delivery_fee: 30, placed_at: "2026-09-17T10:00:00.000Z" }),
      order({ id: "o5", status: "delivered", driver_id: "d1", delivery_fee: 30, placed_at: "2026-01-01T10:00:00.000Z" }),
    ];
    const rows = summarizeDriverDeliveries(orders, RANGE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ driver_id: "d1", driver_name: "Sipho", deliveries: 2, gross_delivery_fees: 55 });
  });

  it("labels a driver with no denormalised name", () => {
    const orders = [order({ id: "o1", status: "delivered", driver_id: "d1", driver_name: null, delivery_fee: 25, placed_at: "2026-09-16T10:00:00.000Z" })];
    expect(summarizeDriverDeliveries(orders, RANGE)[0]!.driver_name).toBe("Unknown driver");
  });
});

describe("computeDriverPayouts", () => {
  it("pays the driver the delivery fee minus the flat per-delivery commission", async () => {
    const orders = [
      order({ id: "o1", status: "delivered", driver_id: "d1", driver_name: "Sipho", delivery_fee: 25, placed_at: "2026-09-16T10:00:00.000Z" }),
      order({ id: "o2", status: "delivered", driver_id: "d1", driver_name: "Sipho", delivery_fee: 30, placed_at: "2026-09-17T10:00:00.000Z" }),
    ];
    const rows = await computeDriverPayouts(orders, RANGE);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.deliveries).toBe(2);
    expect(row.gross_delivery_fees).toBe(55);
    expect(row.commission).toBe(2 * DRIVER_COMMISSION_PER_DELIVERY);
    expect(row.amount_due).toBe(55 - 2 * DRIVER_COMMISSION_PER_DELIVERY);
    expect(row.status).toBe("pending");
  });

  it("sorts by amount due, descending", async () => {
    const orders = [
      order({ id: "o1", status: "delivered", driver_id: "d1", delivery_fee: 10, placed_at: "2026-09-16T10:00:00.000Z" }),
      order({ id: "o2", status: "delivered", driver_id: "d2", delivery_fee: 100, placed_at: "2026-09-16T10:00:00.000Z" }),
    ];
    const rows = await computeDriverPayouts(orders, RANGE);
    expect(rows[0]!.driver_id).toBe("d2");
  });

  it("returns nothing when no driver completed a delivery in the period", async () => {
    expect(await computeDriverPayouts([], RANGE)).toEqual([]);
  });
});
