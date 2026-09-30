import { describe, expect, it } from "vitest";
import {
  buildTableOverview,
  summarizeItems,
  summarizeOverview,
  type OverviewSourceOrder,
} from "./table-overview";
import type { OrderStatus } from "./orders.firebase";
import {
  SESSION_IDLE_TIMEOUT_MS,
  type RestaurantTable,
  type TableOrderMode,
  type TableSession,
} from "./tables.firebase";

const NOW = Date.parse("2026-09-26T19:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function session(overrides: Partial<TableSession> = {}): TableSession {
  return {
    id: "ses_1",
    opened_at: minutesAgo(40),
    last_activity_at: minutesAgo(10),
    order_mode: "multiple",
    current_order_id: null,
    order_count: 0,
    order_ids: [],
    guests: {},
    waiter_id: null,
    waiter_name: null,
    waiter_assigned_at: null,
    ...overrides,
  };
}

function table(overrides: Partial<RestaurantTable> = {}): RestaurantTable {
  return {
    id: "t12",
    restaurant_id: "rst-1",
    label: "12",
    branch_id: null,
    branch_name: null,
    capacity: 4,
    active: true,
    order_mode: "multiple",
    qr_token: null,
    qr_generated_at: null,
    qr_generated_by: null,
    session: null,
    created_at: "",
    updated_at: "",
    updated_by: null,
    ...overrides,
  };
}

let seq = 0;
function order(
  status: OrderStatus,
  overrides: {
    table_id?: string;
    session_id?: string;
    mode?: TableOrderMode;
    guest?: string;
    items?: [string, number][];
    restaurant_id?: string;
  } = {},
): OverviewSourceOrder {
  seq += 1;
  return {
    id: `ord_${seq}`,
    order_number: `#${1000 + seq}`,
    status,
    order_type: "dine_in",
    restaurant_id: overrides.restaurant_id ?? "rst-1",
    created_at: minutesAgo(60 - seq),
    placed_at: minutesAgo(60 - seq),
    customer_name: overrides.guest ?? `Customer ${seq}`,
    dine_in: {
      table_id: overrides.table_id ?? "t12",
      table_label: "12",
      order_mode: overrides.mode ?? "multiple",
      table_session_id: overrides.session_id ?? "ses_1",
      guest_id: `g${seq}`,
      guest_label: overrides.guest ?? `Customer ${seq}`,
      round: 1,
      contributors: [],
      waiter_id: null,
      waiter_name: null,
      confirmed_at: null,
      confirmed_by: null,
      sent_to_kitchen_at: null,
      sent_to_kitchen_by: null,
      served_at: null,
      served_by: null,
      served_by_id: null,
      paid_at: null,
      paid_by: null,
      paid_by_id: null,
      paid_with: null,
    },
    items: (overrides.items ?? [["Dish", 1]]).map(([item_name, quantity]) => ({
      item_name,
      quantity,
    })),
  };
}

const guests = (n: number) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `g${i}`,
      {
        label: `Customer ${i + 1}`,
        joined_at: minutesAgo(30),
        current_order_id: null,
        order_count: 1,
        waiter_request_id: null,
      },
    ]),
  );

describe("buildTableOverview — multiple orders per table", () => {
  it("shows Table 12 occupied with its three active orders", () => {
    const t = table({ session: session({ guests: guests(4) }) });
    const orders = [
      order("preparing", { guest: "Customer 1" }),
      order("ready", { guest: "Customer 2" }),
      order("waiting_for_waiter_confirmation", { guest: "Customer 3" }),
      order("delivered", { guest: "Customer 4" }),
    ];
    const [entry] = buildTableOverview([t], orders, NOW);

    expect(entry).toMatchObject({ status: "occupied", mode: "multiple", guest_count: 4 });
    expect(
      entry!.active_orders.map((o) => [o.order_number, o.guest_label, o.status_label]),
    ).toEqual([
      [orders[0]!.order_number, "Customer 1", "Preparing"],
      [orders[1]!.order_number, "Customer 2", "Ready"],
      [orders[2]!.order_number, "Customer 3", "Waiting for waiter confirmation"],
    ]);
    expect(entry!.orders).toHaveLength(4);
    expect(entry!.table_order).toBeNull();
  });
});

describe("buildTableOverview — single order per table", () => {
  it("shows Table 10's one active order with its items added up", () => {
    const t = table({
      id: "t10",
      label: "10",
      order_mode: "single",
      session: session({ order_mode: "single" }),
    });
    const shared = order("preparing", {
      table_id: "t10",
      mode: "single",
      guest: "Table 10",
      items: [
        ["Steak", 1],
        ["Burger", 1],
        ["Steak", 1],
        ["Coke", 3],
      ],
    });
    const [entry] = buildTableOverview([t], [shared], NOW);

    expect(entry).toMatchObject({ status: "occupied", mode: "single" });
    expect(entry!.table_order?.id).toBe(shared.id);
    expect(entry!.item_summary).toEqual([
      { item_name: "Steak", quantity: 2 },
      { item_name: "Burger", quantity: 1 },
      { item_name: "Coke", quantity: 3 },
    ]);
  });

  it("prefers the table's open order over an earlier, served one", () => {
    const t = table({ order_mode: "single", session: session({ order_mode: "single" }) });
    const served = order("delivered", { mode: "single" });
    const open = order("pending", { mode: "single" });
    const [entry] = buildTableOverview([t], [served, open], NOW);
    expect(entry!.table_order?.id).toBe(open.id);
    expect(entry!.active_orders.map((o) => o.id)).toEqual([open.id]);
  });
});

describe("buildTableOverview — status", () => {
  it("is Available with no seating, and Inactive when the free table is switched off", () => {
    const [free, off] = buildTableOverview(
      [table(), table({ id: "t13", label: "13", active: false })],
      [],
      NOW,
    );
    expect(free).toMatchObject({
      status: "available",
      session: null,
      orders: [],
      active_orders: [],
    });
    expect(off!.status).toBe("inactive");
  });

  it("updates when an order changes", () => {
    const t = table({ session: session() });
    const placed = order("pending");
    expect(buildTableOverview([t], [placed], NOW)[0]!.status).toBe("occupied");
    expect(buildTableOverview([t], [{ ...placed, status: "cancelled" }], NOW)[0]!.status).toBe(
      "available",
    );
  });

  it("stays Occupied while guests eat, until the seating goes idle", () => {
    const served = [order("delivered")];
    const recent = table({ session: session() });
    const idle = table({
      session: session({
        last_activity_at: new Date(NOW - SESSION_IDLE_TIMEOUT_MS - 60_000).toISOString(),
      }),
    });
    expect(buildTableOverview([recent], served, NOW)[0]!.status).toBe("occupied");
    expect(buildTableOverview([idle], served, NOW)[0]!.status).toBe("available");
  });

  it("stays Occupied while anything is still in progress, however long ago the last order was", () => {
    const idle = table({
      session: session({
        last_activity_at: new Date(NOW - 2 * SESSION_IDLE_TIMEOUT_MS).toISOString(),
      }),
    });
    expect(buildTableOverview([idle], [order("preparing")], NOW)[0]!.status).toBe("occupied");
  });

  it("an inactive table still shows its guests' orders until they're done", () => {
    const t = table({ active: false, session: session() });
    expect(buildTableOverview([t], [order("preparing")], NOW)[0]!.status).toBe("occupied");
  });

  it("only counts orders from this table's current seating", () => {
    const t = table({ session: session() });
    const strays = [
      order("pending", { table_id: "t13" }),
      order("pending", { session_id: "ses_old" }),
      order("pending", { restaurant_id: "rst-2" }),
      { ...order("pending"), order_type: "delivery" },
    ];
    expect(buildTableOverview([t], strays, NOW)[0]).toMatchObject({
      status: "available",
      orders: [],
    });
  });

  it("flags a mode change that will apply once the table is cleared", () => {
    const t = table({ order_mode: "multiple", session: session({ order_mode: "single" }) });
    const [entry] = buildTableOverview([t], [order("pending", { mode: "single" })], NOW);
    expect(entry).toMatchObject({ mode: "single", next_mode: "multiple" });
  });
});

describe("summaries", () => {
  it("adds up identical items", () => {
    expect(
      summarizeItems([
        { item_name: "Coke", quantity: 1 },
        { item_name: "Coke", quantity: 2 },
      ]),
    ).toEqual([{ item_name: "Coke", quantity: 3 }]);
  });

  it("counts tables by status and their active orders", () => {
    const entries = buildTableOverview(
      [
        table({ session: session({ guests: guests(3) }) }),
        table({ id: "t13", label: "13" }),
        table({ id: "t14", label: "14", active: false }),
      ],
      [order("pending"), order("ready"), order("delivered")],
      NOW,
    );
    expect(summarizeOverview(entries)).toEqual({
      tables: 3,
      occupied: 1,
      available: 1,
      inactive: 1,
      active_orders: 2,
      guests: 3,
      waiter_requests: 0,
    });
  });
});
