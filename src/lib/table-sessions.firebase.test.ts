import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Firestore is replaced by the in-memory fake in src/lib/testing/fake-firestore.ts.
vi.mock("@/lib/firestore", async (importOriginal) =>
  (await import("@/lib/testing/fake-firestore")).fakeFirestoreModule(await importOriginal()),
);

import { fakeDb as db } from "@/lib/testing/fake-firestore";
import { normalizeDineIn, WAITER_CONFIRMED, WAITING_FOR_WAITER_CONFIRMATION } from "@/lib/dine-in";
import {
  confirmDineInOrder,
  markDineInOrderServed,
  sendDineInOrderToKitchen,
} from "@/lib/dine-in-orders.firebase";
import {
  rejectFirebaseOrder,
  setFirebaseOrderStatus,
  type OrderStatus,
} from "@/lib/orders.firebase";
import { buildTableOverview } from "@/lib/table-overview";
import {
  assertGuestOwnsOrder,
  canGuestAddTo,
  closeTableSession,
  placeDineInOrder,
  type DineInItemInput,
} from "@/lib/table-sessions.firebase";
import {
  issueTableQr,
  listTables,
  saveTable,
  SESSION_IDLE_TIMEOUT_MS,
  type RestaurantTable,
  type TableOrderMode,
} from "@/lib/tables.firebase";

const RID = "rst-nonna";
type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const item = (name: string, quantity = 1, unit_price = 50): DineInItemInput => ({
  name,
  quantity,
  unit_price,
});

async function addTable(label: string, order_mode: TableOrderMode, active = true) {
  return saveTable({ restaurant_id: RID, label, capacity: 4, active, order_mode });
}

function place(table: RestaurantTable, guest: number | string, items: DineInItemInput[]) {
  return placeDineInOrder({
    table: { restaurant_id: RID, table_id: table.id },
    guest: { id: typeof guest === "number" ? `guest_${guest}` : guest },
    items,
  });
}

const orderDoc = (id: string) => db.docs.get(`orders/${id}`) as Doc;
const tableDoc = (table: RestaurantTable) =>
  db.docs.get(`restaurants/${RID}/tables/${table.id}`) as Doc;
const ordersAt = (table: RestaurantTable) =>
  [...db.docs.entries()]
    .filter(
      ([path, doc]) => path.startsWith("orders/") && (doc as Doc)["dine_in"]?.table_id === table.id,
    )
    .map(([, doc]) => doc as Doc);
const lineItems = (order: Doc) =>
  Object.values(order["items"] as Record<string, Doc>)
    .map((l) => `${l["name"]} ×${l["quantity"]}`)
    .sort();
const WAITER = { id: "staff_sam", email: "sam@nonna.test", name: "Sam" };
/** A waiter confirms the order with the table, then sends it to the kitchen. */
const confirmAndSend = async (orderId: string) => {
  await confirmDineInOrder({ order_id: orderId, actor: WAITER });
  await sendDineInOrderToKitchen({ order_id: orderId, actor: WAITER });
};
/** …and the kitchen cooks it until it's ready. */
const cookUntilReady = async (orderId: string) => {
  await confirmAndSend(orderId);
  await setFirebaseOrderStatus({ orderId, status: "preparing" });
  await setFirebaseOrderStatus({ orderId, status: "ready" });
};
/** Orders at the table still taking guests' items: waiting for a waiter to confirm them. */
const waitingOrdersAt = (table: RestaurantTable) =>
  ordersAt(table).filter((o) => o["status"] === WAITING_FOR_WAITER_CONFIRMATION);

beforeEach(() => {
  db.reset();
  db.docs.set(`restaurants/${RID}`, { id: RID, name: "Nonna's Table" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Task 5 — multiple orders on one table", () => {
  it("gives four guests four independent orders that all belong to the same table session", async () => {
    const table = await addTable("12", "multiple");
    const results = [];
    for (const n of [1, 2, 3, 4]) results.push(await place(table, n, [item(`Dish ${n}`)]));

    expect(new Set(results.map((r) => r.order_id)).size).toBe(4);
    expect(results.every((r) => r.created)).toBe(true);

    const session = tableDoc(table)["session"];
    expect(results.every((r) => r.session_id === session.id)).toBe(true);
    for (const [i, r] of results.entries()) {
      const order = orderDoc(r.order_id);
      expect(order["dine_in"]).toMatchObject({
        table_id: table.id,
        table_label: "12",
        order_mode: "multiple",
        table_session_id: session.id,
        guest_id: `guest_${i + 1}`,
        guest_label: `Customer ${i + 1}`,
      });
      expect(order["customer_name"]).toBe(`Customer ${i + 1}`);
      expect(lineItems(order)).toEqual([`Dish ${i + 1} ×1`]);
    }
    expect(Object.keys(session.guests)).toHaveLength(4);
    expect(session.order_count).toBe(4);
  });

  it("adds a guest's further items to their own open order and never touches anyone else's", async () => {
    const table = await addTable("12", "multiple");
    const first = await place(table, 1, [item("Steak")]);
    const second = await place(table, 2, [item("Burger")]);
    const guestOneBefore = structuredClone(orderDoc(first.order_id));

    const again = await place(table, 2, [item("Coke", 2)]);

    expect(again).toMatchObject({ order_id: second.order_id, created: false });
    expect(lineItems(orderDoc(second.order_id))).toEqual(["Burger ×1", "Coke ×2"]);
    expect(orderDoc(first.order_id)).toEqual(guestOneBefore);
    expect(ordersAt(table)).toHaveLength(2);
  });

  it("keeps each order's progress independent", async () => {
    const table = await addTable("12", "multiple");
    const a = await place(table, 1, [item("Steak")]);
    const b = await place(table, 2, [item("Burger")]);

    await confirmAndSend(a.order_id);
    await setFirebaseOrderStatus({ orderId: a.order_id, status: "preparing" });

    expect(orderDoc(a.order_id)["status"]).toBe("preparing");
    expect(orderDoc(b.order_id)["status"]).toBe(WAITING_FOR_WAITER_CONFIRMATION);
  });

  it("starts a guest's next order once their previous one has left the kitchen", async () => {
    const table = await addTable("12", "multiple");
    const first = await place(table, 1, [item("Steak")]);
    const other = await place(table, 2, [item("Burger")]);
    await cookUntilReady(first.order_id);

    const next = await place(table, 1, [item("Ice cream")]);

    expect(next.created).toBe(true);
    expect(next.order_id).not.toBe(first.order_id);
    expect(next.order_id).not.toBe(other.order_id);
    expect(next.round).toBe(2);
    expect(orderDoc(next.order_id)["dine_in"]).toMatchObject({ guest_id: "guest_1", round: 2 });
    expect(lineItems(orderDoc(other.order_id))).toEqual(["Burger ×1"]);
  });

  it("lands every guest's order when four order at the same moment", async () => {
    const table = await addTable("12", "multiple");
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => place(table, n, [item(`Dish ${n}`)])),
    );

    expect(new Set(results.map((r) => r.order_id)).size).toBe(4);
    expect(new Set(results.map((r) => r.session_id)).size).toBe(1);
    expect(ordersAt(table).map(lineItems).flat().sort()).toEqual([
      "Dish 1 ×1",
      "Dish 2 ×1",
      "Dish 3 ×1",
      "Dish 4 ×1",
    ]);
    expect(Object.keys(tableDoc(table)["session"].guests)).toHaveLength(4);
  });

  it("refuses to add to another guest's order in multiple mode", () => {
    const order = {
      status: "pending" as const,
      order_type: "dine_in" as const,
      restaurant_id: RID,
      dine_in: {
        table_id: "t12",
        table_session_id: "ses_1",
        guest_id: "guest_1",
        order_mode: "multiple" as const,
      },
    };
    const context = {
      restaurant_id: RID,
      table_id: "t12",
      session_id: "ses_1",
      order_mode: "multiple" as const,
    };
    expect(canGuestAddTo(order, { ...context, guest_id: "guest_1" })).toBe(true);
    expect(canGuestAddTo(order, { ...context, guest_id: "guest_2" })).toBe(false);
    expect(() => assertGuestOwnsOrder(order, "guest_2")).toThrow(/another guest/);
    // …and never across tables or seatings, whatever the mode.
    expect(canGuestAddTo(order, { ...context, guest_id: "guest_1", table_id: "t13" })).toBe(false);
    expect(canGuestAddTo(order, { ...context, guest_id: "guest_1", session_id: "ses_2" })).toBe(
      false,
    );
  });
});

describe("Task 6 — single order per table", () => {
  it("collects every guest's items into the table's one order", async () => {
    const table = await addTable("10", "single");
    const a = await place(table, 1, [item("Steak", 1, 189)]);
    const b = await place(table, 2, [item("Steak", 1, 189), item("Burger", 1, 129)]);
    const c = await place(table, 3, [item("Coke", 3, 25)]);

    expect([a.created, b.created, c.created]).toEqual([true, false, false]);
    expect(new Set([a.order_id, b.order_id, c.order_id]).size).toBe(1);
    expect(ordersAt(table)).toHaveLength(1);

    const order = orderDoc(a.order_id);
    expect(order["customer_name"]).toBe("Table 10");
    expect(order["subtotal"]).toBe(189 + 189 + 129 + 75);
    expect(
      normalizeDineIn(order["dine_in"])!.contributors.map((g) => [g.label, g.item_count]),
    ).toEqual([
      ["Customer 1", 1],
      ["Customer 2", 2],
      ["Customer 3", 3],
    ]);
    expect(
      Object.values(order["items"] as Record<string, Doc>).map((l) => l["added_by"].label),
    ).toEqual(["Customer 1", "Customer 2", "Customer 2", "Customer 3"]);
  });

  it("regression: guests ordering at the same moment never create a second table order", async () => {
    const table = await addTable("10", "single");
    const results = await Promise.all([
      place(table, 1, [item("Steak", 2)]),
      place(table, 2, [item("Burger")]),
      place(table, 3, [item("Coke", 3)]),
      place(table, 4, [item("Salad")]),
    ]);

    expect(new Set(results.map((r) => r.order_id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(ordersAt(table)).toHaveLength(1);
    expect(lineItems(ordersAt(table)[0]!)).toEqual([
      "Burger ×1",
      "Coke ×3",
      "Salad ×1",
      "Steak ×2",
    ]);
  });

  it("regression: the same guest ordering again still uses the table order", async () => {
    const table = await addTable("10", "single");
    const first = await place(table, 1, [item("Steak")]);
    const again = await place(table, 1, [item("Coke")]);
    expect(again).toMatchObject({ order_id: first.order_id, created: false });
    expect(ordersAt(table)).toHaveLength(1);
  });

  it("Task 9: once a waiter has sent the table order to the kitchen, later items wait in the table's next order", async () => {
    const table = await addTable("10", "single");
    const first = await place(table, 1, [item("Steak")]);
    await confirmAndSend(first.order_id);
    await setFirebaseOrderStatus({ orderId: first.order_id, status: "preparing" });

    const late = await place(table, 2, [item("Coke")]);
    const more = await place(table, 3, [item("Chips")]);

    // Nothing reaches the kitchen without a waiter: the kitchen's order is untouched...
    expect(orderDoc(first.order_id)["status"]).toBe("preparing");
    expect(lineItems(orderDoc(first.order_id))).toEqual(["Steak ×1"]);
    // ...and the new items share the table's next order, waiting for confirmation.
    expect(late).toMatchObject({ created: true, round: 2, session_id: first.session_id });
    expect(more).toMatchObject({ order_id: late.order_id, created: false });
    expect(orderDoc(late.order_id)["status"]).toBe(WAITING_FOR_WAITER_CONFIRMATION);
    expect(lineItems(orderDoc(late.order_id))).toEqual(["Chips ×1", "Coke ×1"]);
    expect(waitingOrdersAt(table)).toHaveLength(1);
  });

  it("regression: after the kitchen finishes the table order, the next items start one new order — never two open at once", async () => {
    const table = await addTable("10", "single");
    const first = await place(table, 1, [item("Steak")]);
    await cookUntilReady(first.order_id);

    const dessert = await Promise.all([
      place(table, 2, [item("Ice cream")]),
      place(table, 3, [item("Coffee")]),
    ]);

    expect(new Set(dessert.map((r) => r.order_id)).size).toBe(1);
    expect(dessert[0]!.order_id).not.toBe(first.order_id);
    expect(orderDoc(dessert[0]!.order_id)["dine_in"].round).toBe(2);
    expect(waitingOrdersAt(table)).toHaveLength(1);
    expect(lineItems(orderDoc(first.order_id))).toEqual(["Steak ×1"]);
    expect(dessert.every((r) => r.session_id === first.session_id)).toBe(true);
  });

  it("regression: a rejected table order is replaced by exactly one fresh order", async () => {
    const table = await addTable("10", "single");
    const first = await place(table, 1, [item("Steak")]);
    await setFirebaseOrderStatus({ orderId: first.order_id, status: "rejected" });

    const retries = await Promise.all([
      place(table, 1, [item("Steak")]),
      place(table, 2, [item("Burger")]),
    ]);

    expect(new Set(retries.map((r) => r.order_id)).size).toBe(1);
    expect(waitingOrdersAt(table)).toHaveLength(1);
  });

  it("regression: switching the table to multiple mid-meal doesn't split the table order", async () => {
    const table = await addTable("10", "single");
    const first = await place(table, 1, [item("Steak")]);
    await saveTable({ ...table, order_mode: "multiple", restaurant_id: RID, id: table.id });

    const second = await place(table, 2, [item("Burger")]);
    expect(second).toMatchObject({ order_id: first.order_id, created: false });

    // The new mode takes over from the next seating.
    await closeTableSession({
      restaurant_id: RID,
      table_id: table.id,
      session_id: first.session_id,
    });
    const next = await place(table, 2, [item("Coffee")]);
    expect(next.created).toBe(true);
    expect(orderDoc(next.order_id)["dine_in"].order_mode).toBe("multiple");
  });

  /** Land a guest's addition in the middle of a write to the table order —
   *  after it has read the order, just before it writes the order back. */
  function slipInAddition(table: RestaurantTable, orderId: string, status: string) {
    const state = { slipped: false };
    db.beforeCommit = async (writes) => {
      const isTheWrite = writes.some(
        (w) =>
          w.kind === "set" &&
          w.path === `orders/${orderId}` &&
          (w.value as Doc | null)?.["status"] === status,
      );
      if (state.slipped || !isTheWrite) return;
      state.slipped = true;
      await place(table, 2, [item("Coke", 3)]);
    };
    return state;
  }

  it("regression: a guest adding items while the waiter confirms never loses them — or sends them unseen", async () => {
    const table = await addTable("10", "single");
    const first = await place(table, 1, [item("Steak")]);
    const reviewed = Object.keys(orderDoc(first.order_id)["items"]);

    const race = slipInAddition(table, first.order_id, WAITER_CONFIRMED);
    await expect(
      confirmDineInOrder({ order_id: first.order_id, reviewed_line_ids: reviewed, actor: WAITER }),
    ).rejects.toMatchObject({ code: "dine-in/order-changed" });

    expect(race.slipped).toBe(true);
    const order = orderDoc(first.order_id);
    expect(order["status"]).toBe(WAITING_FOR_WAITER_CONFIRMATION);
    expect(lineItems(order)).toEqual(["Coke ×3", "Steak ×1"]);
  });

  it("regression: rejecting the table order while a guest adds to it never loses the added items", async () => {
    const table = await addTable("10", "single");
    const first = await place(table, 1, [item("Steak")]);

    const race = slipInAddition(table, first.order_id, "rejected");
    await rejectFirebaseOrder({ orderId: first.order_id, reason: "Out of steak" });

    expect(race.slipped).toBe(true);
    const order = orderDoc(first.order_id);
    expect(order["status"]).toBe("rejected");
    expect(lineItems(order)).toEqual(["Coke ×3", "Steak ×1"]);
  });
});

describe("seatings", () => {
  it("writes the table back untouched apart from its seating", async () => {
    const table = await addTable("10", "single");
    db.docs.set(`restaurants/${RID}/tables/${table.id}`, { ...tableDoc(table), section: "patio" });
    await issueTableQr({ restaurant_id: RID, table_id: table.id });
    const before = structuredClone(tableDoc(table));

    await place(table, 1, [item("Steak")]);

    const { session, ...rest } = tableDoc(table);
    expect(rest).toEqual(
      Object.fromEntries(Object.entries(before).filter(([k]) => k !== "session")),
    );
    expect(session.order_mode).toBe("single");
  });

  it("clearing the table ends the seating; the next guest starts a new one", async () => {
    const table = await addTable("10", "single");
    const first = await place(table, 1, [item("Steak")]);

    expect(
      await closeTableSession({
        restaurant_id: RID,
        table_id: table.id,
        session_id: first.session_id,
      }),
    ).toBe(true);
    expect(tableDoc(table)["session"]).toBeNull();
    expect(tableDoc(table)["last_session"]).toMatchObject({ id: first.session_id });

    const next = await place(table, 2, [item("Burger")]);
    expect(next.session_id).not.toBe(first.session_id);
    expect(next.order_id).not.toBe(first.order_id);
    expect(orderDoc(first.order_id)["dine_in"].table_session_id).toBe(first.session_id);
  });

  it("only clears the seating the caller was looking at", async () => {
    const table = await addTable("10", "single");
    const first = await place(table, 1, [item("Steak")]);
    await closeTableSession({
      restaurant_id: RID,
      table_id: table.id,
      session_id: first.session_id,
    });
    const current = await place(table, 2, [item("Burger")]);

    expect(
      await closeTableSession({
        restaurant_id: RID,
        table_id: table.id,
        session_id: first.session_id,
      }),
    ).toBe(false);
    expect(tableDoc(table)["session"].id).toBe(current.session_id);
  });

  it("starts a fresh seating when the last one went idle, even if nobody cleared the table", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    const table = await addTable("10", "single");
    const lunch = await place(table, 1, [item("Steak")]);

    vi.setSystemTime(
      new Date(Date.parse("2026-09-26T12:00:00Z") + SESSION_IDLE_TIMEOUT_MS + 60_000),
    );
    const dinner = await place(table, 2, [item("Burger")]);

    expect(dinner.session_id).not.toBe(lunch.session_id);
    expect(dinner.order_id).not.toBe(lunch.order_id);
    expect(dinner.guest_label).toBe("Customer 1");
  });
});

describe("placement guards", () => {
  it("refuses an inactive table and writes nothing", async () => {
    const table = await addTable("9", "single", false);
    await expect(place(table, 1, [item("Steak")])).rejects.toMatchObject({
      code: "dine-in/table-inactive",
    });
    expect(ordersAt(table)).toHaveLength(0);
    expect(tableDoc(table)["session"]).toBeNull();
  });

  it("orders by QR token, and refuses a code that has been regenerated", async () => {
    const table = await addTable("12", "multiple");
    const { qr_token: oldToken } = await issueTableQr({ restaurant_id: RID, table_id: table.id });
    const placed = await placeDineInOrder({
      table: { token: oldToken! },
      guest: { id: "guest_1" },
      items: [item("Steak")],
    });
    expect(orderDoc(placed.order_id)["dine_in"].table_id).toBe(table.id);

    await issueTableQr({ restaurant_id: RID, table_id: table.id });
    await expect(
      placeDineInOrder({
        table: { token: oldToken! },
        guest: { id: "guest_2" },
        items: [item("Steak")],
      }),
    ).rejects.toMatchObject({ code: "dine-in/invalid-code" });
  });

  it("rejects unknown tables, unsafe guest ids and invalid items", async () => {
    const table = await addTable("12", "multiple");
    await expect(
      placeDineInOrder({
        table: { restaurant_id: RID, table_id: "nope" },
        guest: { id: "g1" },
        items: [item("Steak")],
      }),
    ).rejects.toMatchObject({ code: "dine-in/table-not-found" });
    await expect(place(table, "../orders/x", [item("Steak")])).rejects.toMatchObject({
      code: "dine-in/invalid-guest",
    });
    await expect(place(table, 1, [])).rejects.toMatchObject({ code: "dine-in/invalid-items" });
    await expect(place(table, 1, [item("Steak", 0)])).rejects.toMatchObject({
      code: "dine-in/invalid-items",
    });
    await expect(place(table, 1, [item("Steak", 1, -5)])).rejects.toMatchObject({
      code: "dine-in/invalid-items",
    });
    expect(ordersAt(table)).toHaveLength(0);
  });
});

describe("Task 7 — the table overview reflects placed orders", () => {
  it("shows each table's orders and status as they change", async () => {
    const twelve = await addTable("12", "multiple");
    const ten = await addTable("10", "single");
    await addTable("3", "single");
    const [a] = await Promise.all([
      place(twelve, 1, [item("Steak")]),
      place(twelve, 2, [item("Burger")]),
      place(twelve, 3, [item("Salad")]),
    ]);
    const shared = await place(ten, 7, [item("Steak", 2)]);
    await place(ten, 8, [item("Burger")]);
    await place(ten, 9, [item("Coke", 3)]);

    const overview = () => {
      const orders = [...db.docs.entries()]
        .filter(([path]) => path.startsWith("orders/"))
        .map(([, o]) => {
          const doc = o as Doc;
          return {
            ...(doc as {
              id: string;
              order_number: string;
              status: OrderStatus;
              order_type: string;
            }),
            restaurant_id: doc["restaurant_id"],
            created_at: doc["created_at"],
            placed_at: doc["placed_at"],
            customer_name: doc["customer_name"],
            dine_in: normalizeDineIn(doc["dine_in"]),
            items: Object.values(doc["items"] as Record<string, Doc>).map((l) => ({
              item_name: l["name"] as string,
              quantity: l["quantity"] as number,
            })),
          };
        });
      return listTables(RID).then((tables) => {
        const entries = buildTableOverview(tables, orders);
        const byLabel = (label: string) => entries.find((e) => e.table.label === label)!;
        return { t3: byLabel("3"), t10: byLabel("10"), t12: byLabel("12") };
      });
    };

    const first = await overview();
    let { t10, t12 } = first;
    expect(t12).toMatchObject({ status: "occupied", mode: "multiple" });
    expect(t12.active_orders.map((o) => o.guest_label)).toEqual([
      "Customer 1",
      "Customer 2",
      "Customer 3",
    ]);
    expect(t10).toMatchObject({ status: "occupied", mode: "single" });
    expect(t10.table_order?.id).toBe(shared.order_id);
    expect(t10.item_summary).toEqual([
      { item_name: "Steak", quantity: 2 },
      { item_name: "Burger", quantity: 1 },
      { item_name: "Coke", quantity: 3 },
    ]);
    expect(first.t3.status).toBe("available");

    await cookUntilReady(a.order_id);
    await markDineInOrderServed({ order_id: a.order_id, actor: WAITER });
    ({ t10, t12 } = await overview());
    expect(t12.active_orders).toHaveLength(2);
    expect(t12.status).toBe("occupied");

    await closeTableSession({
      restaurant_id: RID,
      table_id: ten.id,
      session_id: shared.session_id,
    });
    ({ t10 } = await overview());
    expect(t10.status).toBe("available");
    expect(t10.table_order).toBeNull();
  });
});
