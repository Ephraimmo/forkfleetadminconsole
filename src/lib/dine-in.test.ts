import { describe, expect, it } from "vitest";
import {
  customerSessionLabel,
  dineInStatusLabel,
  filterDineInOrders,
  normalizeDineIn,
  type DineInOrderInfo,
} from "./dine-in";
import { orderType, type OrderStatus } from "./orders.firebase";
import { orderStage } from "./dispatch.functions";
import { qrMatrix, qrPath, qrSvg, fileSlug, escapeHtml } from "./qr-code";

function dineIn(partial: Partial<DineInOrderInfo> = {}): DineInOrderInfo {
  return {
    table_id: "t12",
    table_label: "12",
    order_mode: "multiple",
    table_session_id: "ses_1",
    guest_id: null,
    guest_label: null,
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
    ...partial,
  };
}

function order(input: {
  id: string;
  order_type?: string;
  status?: OrderStatus;
  table?: string;
  created_at?: string;
  customer_name?: string;
}) {
  return {
    id: input.id,
    order_type: input.order_type ?? "dine_in",
    status: input.status ?? "pending",
    order_number: `FF-${input.id}`,
    restaurant_id: "rst-1",
    customer_name: input.customer_name ?? "",
    created_at: input.created_at ?? "2026-09-26T10:00:00.000Z",
    placed_at: input.created_at ?? "2026-09-26T10:00:00.000Z",
    dine_in:
      input.order_type && input.order_type !== "dine_in"
        ? null
        : dineIn({ table_label: input.table ?? "12" }),
  };
}

describe("dine-in orders extend the existing order record", () => {
  it("orderType() recognises dine_in and leaves delivery/pickup/legacy exactly as before", () => {
    expect(orderType({ order_type: "dine_in" })).toBe("dine_in");
    expect(orderType({ order_type: "pickup" })).toBe("pickup");
    expect(orderType({ order_type: "delivery" })).toBe("delivery");
    expect(orderType({})).toBe("delivery");
    expect(orderType({ order_type: "something_else" as never })).toBe("delivery");
  });

  it("a ready dine-in order is never routed to driver stages", () => {
    const base = { driver_id: null, driver_status: null, order_type: "dine_in" as const };
    expect(orderStage({ ...base, status: "ready" })).toBe("ready");
    expect(orderStage({ ...base, status: "preparing" })).toBe("preparing");
    expect(orderStage({ ...base, status: "delivered" })).toBe("delivered");
  });

  it("normalizeDineIn needs a table, and defaults a missing order mode to single", () => {
    expect(normalizeDineIn(null)).toBeNull();
    expect(normalizeDineIn({ waiter_name: "Sam" })).toBeNull();
    expect(normalizeDineIn({ table_id: " t5 ", table_label: " 5 " })).toEqual({
      table_id: "t5",
      table_label: "5",
      order_mode: "single",
      table_session_id: null,
      guest_id: null,
      guest_label: null,
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
    });
  });

  it("reads contributors back as a list, in the order guests joined", () => {
    const info = normalizeDineIn({
      table_id: "t10",
      contributors: {
        guest_b: { label: "Customer 2", first_added_at: "2026-09-26T10:05:00Z", item_count: 1 },
        guest_a: { label: "Customer 1", first_added_at: "2026-09-26T10:00:00Z", item_count: 2 },
      },
    });
    expect(info!.contributors.map((c) => [c.guest_id, c.label, c.item_count])).toEqual([
      ["guest_a", "Customer 1", 2],
      ["guest_b", "Customer 2", 1],
    ]);
  });

  it("uses dine-in wording for the shared statuses", () => {
    expect(dineInStatusLabel("waiting_for_waiter_confirmation")).toBe(
      "Waiting for waiter confirmation",
    );
    // Dine-in orders written before the waiter step wait the same way.
    expect(dineInStatusLabel("pending")).toBe("Waiting for waiter confirmation");
    expect(dineInStatusLabel("waiter_confirmed")).toBe("Confirmed — not sent yet");
    expect(dineInStatusLabel("accepted")).toBe("Sent to kitchen");
    expect(dineInStatusLabel("preparing")).toBe("Preparing");
    expect(dineInStatusLabel("ready")).toBe("Ready");
    expect(dineInStatusLabel("delivered")).toBe("Served");
  });

  it("labels a guest's own order by customer and guest", () => {
    expect(
      customerSessionLabel({
        customer_name: "Thandi",
        dine_in: dineIn({ guest_label: "Customer 2" }),
      }),
    ).toEqual({ primary: "Thandi", secondary: "Customer 2" });
    expect(
      customerSessionLabel({
        customer_name: "Customer 2",
        dine_in: dineIn({ guest_label: "Customer 2" }),
      }),
    ).toEqual({ primary: "Customer 2", secondary: null });
    expect(customerSessionLabel({ customer_name: " ", dine_in: dineIn() }).primary).toBe("Guest");
  });

  it("labels a shared table order by everyone who added to it", () => {
    const contributors = ["Thandi", "Customer 2", "Customer 3", "Customer 4"].map((label, i) => ({
      guest_id: `g${i}`,
      label,
      first_added_at: `2026-09-26T10:0${i}:00Z`,
      item_count: 1,
    }));
    expect(
      customerSessionLabel({
        customer_name: "Table 10",
        dine_in: dineIn({ order_mode: "single", contributors }),
      }),
    ).toEqual({
      primary: "Shared table order",
      secondary: "4 guests: Thandi, Customer 2, Customer 3 +1",
    });
  });
});

describe("filterDineInOrders", () => {
  const rows = [
    order({ id: "1001", table: "12", status: "pending", created_at: "2026-09-26T10:00:00.000Z" }),
    order({ id: "1002", table: "5", status: "preparing", created_at: "2026-09-26T10:05:00.000Z" }),
    order({ id: "1003", table: "12", status: "ready", created_at: "2026-09-26T10:10:00.000Z" }),
    order({
      id: "1004",
      table: "112",
      status: "delivered",
      created_at: "2026-09-26T09:00:00.000Z",
    }),
    order({ id: "2001", order_type: "delivery", status: "pending" }),
    order({ id: "2002", order_type: "pickup", status: "ready" }),
  ];

  it("lists only dine-in orders, newest first", () => {
    expect(filterDineInOrders(rows).map((o) => o.id)).toEqual(["1003", "1002", "1001", "1004"]);
  });

  it("filters to open orders or a single status", () => {
    expect(filterDineInOrders(rows, { status: "open" }).map((o) => o.id)).toEqual([
      "1003",
      "1002",
      "1001",
    ]);
    expect(filterDineInOrders(rows, { status: "ready" }).map((o) => o.id)).toEqual(["1003"]);
  });

  it("finds a table by its exact number, typed either way", () => {
    expect(filterDineInOrders(rows, { search: "Table 12" }).map((o) => o.id)).toEqual([
      "1003",
      "1001",
    ]);
    expect(filterDineInOrders(rows, { search: "112" }).map((o) => o.id)).toEqual(["1004"]);
  });
});

describe("QR rendering", () => {
  const link = "https://order.example.com/dine-in/AbCdEfGhIjKlMnOpQrStUvWxYz012345";

  it("produces a valid QR matrix with finder patterns in three corners", () => {
    const { size, isDark } = qrMatrix(link);
    expect((size - 21) % 4).toBe(0);
    for (const [r, c] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ] as const) {
      for (let i = 0; i < 7; i++) {
        expect(isDark(r, c + i)).toBe(true); // top edge of the finder square
        expect(isDark(r + i, c)).toBe(true); // left edge
      }
      expect(isDark(r + 1, c + 1)).toBe(false); // light ring
      expect(isDark(r + 3, c + 3)).toBe(true); // dark centre
    }
  });

  it("draws the same code every time, with a 4-module quiet zone", () => {
    const { size } = qrMatrix(link);
    const path = qrPath(link);
    expect(path.dimension).toBe(size + 8);
    expect(qrPath(link)).toEqual(path);
    expect(qrSvg(link)).toContain(`viewBox="0 0 ${path.dimension} ${path.dimension}"`);
  });

  it("escapes names printed on the card and makes safe file names", () => {
    expect(escapeHtml(`<Nonna's & "Co">`)).toBe("&lt;Nonna&#39;s &amp; &quot;Co&quot;&gt;");
    expect(fileSlug("Nonna's Trattoria — Table 12")).toBe("nonna-s-trattoria-table-12");
  });
});
