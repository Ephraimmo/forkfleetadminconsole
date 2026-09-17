import { describe, expect, it } from "vitest";
import { orderStage, type OrderStage } from "./dispatch.functions";
import type { DriverStatus, OrderStatus, OrderType } from "./orders.firebase";

/** Minimal order shape orderStage() actually reads. */
function order(input: {
  status: OrderStatus | "offered" | "arrived";
  order_type?: OrderType;
  driver_id?: string | null;
  driver_status?: DriverStatus | null;
}) {
  return {
    status: input.status as OrderStatus,
    order_type: input.order_type ?? "delivery",
    driver_id: input.driver_id ?? null,
    driver_status: input.driver_status ?? null,
  };
}

describe("orderStage — delivery orders", () => {
  it("passes kitchen statuses through unchanged", () => {
    const cases: OrderStatus[] = ["pending", "accepted", "preparing"];
    for (const status of cases) {
      expect(orderStage(order({ status }))).toBe(status as OrderStage);
    }
  });

  it("'ready' with no driver is unassigned", () => {
    expect(orderStage(order({ status: "ready", driver_id: null }))).toBe("unassigned");
  });

  it("'ready' with a driver picked is waiting_accept — assigning never changes `status`", () => {
    expect(orderStage(order({ status: "ready", driver_id: "drv-1" }))).toBe("waiting_accept");
  });

  it("'assigned' with no driver_status yet is heading_to_restaurant", () => {
    expect(
      orderStage(order({ status: "assigned", driver_id: "drv-1", driver_status: "assigned" })),
    ).toBe("heading_to_restaurant");
  });

  it("'assigned' + driver_status arrived_at_restaurant is at_restaurant — `status` itself never becomes \"arrived\"", () => {
    expect(
      orderStage(
        order({ status: "assigned", driver_id: "drv-1", driver_status: "arrived_at_restaurant" }),
      ),
    ).toBe("at_restaurant");
  });

  it("'picked_up' is its own stage", () => {
    expect(orderStage(order({ status: "picked_up" }))).toBe("picked_up");
  });

  it("'on_the_way' with no driver_status yet is on_the_way", () => {
    expect(orderStage(order({ status: "on_the_way", driver_status: "on_the_way" }))).toBe(
      "on_the_way",
    );
  });

  it("'on_the_way' + driver_status arrived_at_customer is at_customer", () => {
    expect(
      orderStage(order({ status: "on_the_way", driver_status: "arrived_at_customer" })),
    ).toBe("at_customer");
  });

  it("passes terminal statuses through unchanged", () => {
    const cases: OrderStatus[] = ["delivered", "rejected", "cancelled", "refunded"];
    for (const status of cases) {
      expect(orderStage(order({ status }))).toBe(status as OrderStage);
    }
  });
});

describe("orderStage — legacy 'offered'/'arrived' status values", () => {
  it("legacy 'offered' with no driver behaves like unassigned 'ready'", () => {
    expect(orderStage(order({ status: "offered", driver_id: null }))).toBe("unassigned");
  });

  it("legacy 'offered' with a driver behaves like waiting_accept", () => {
    expect(orderStage(order({ status: "offered", driver_id: "drv-1" }))).toBe("waiting_accept");
  });

  it("legacy 'arrived' always resolves to at_restaurant, even with no driver_status", () => {
    expect(orderStage(order({ status: "arrived", driver_id: "drv-1", driver_status: null }))).toBe(
      "at_restaurant",
    );
  });
});

describe("orderStage — pickup orders never involve a driver", () => {
  it("'ready' stays 'ready' regardless of driver_id (which pickup orders never set)", () => {
    expect(orderStage(order({ status: "ready", order_type: "pickup" }))).toBe("ready");
  });

  it("'picked_up' (customer collected) and 'delivered' pass through unchanged", () => {
    expect(orderStage(order({ status: "picked_up", order_type: "pickup" }))).toBe("picked_up");
    expect(orderStage(order({ status: "delivered", order_type: "pickup" }))).toBe("delivered");
  });
});
