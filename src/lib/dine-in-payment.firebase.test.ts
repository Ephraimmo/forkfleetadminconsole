import { beforeEach, describe, expect, it, vi } from "vitest";

// Firestore is replaced by the in-memory fake in src/lib/testing/fake-firestore.ts.
vi.mock("@/lib/firestore", async (importOriginal) =>
  (await import("@/lib/testing/fake-firestore")).fakeFirestoreModule(await importOriginal()),
);

import { fakeDb as db } from "@/lib/testing/fake-firestore";
import { canTakeDineInPayment, normalizeDineIn } from "@/lib/dine-in";
import {
  confirmDineInOrder,
  confirmDineInPayment,
  editDineInOrder,
  markDineInOrderServed,
  sendDineInOrderToKitchen,
} from "@/lib/dine-in-orders.firebase";
import { setFirebaseOrderStatus } from "@/lib/orders.firebase";
import { placeDineInOrder } from "@/lib/table-sessions.firebase";
import { saveTable } from "@/lib/tables.firebase";

const RID = "rst-nonna";
const SIPHO = { id: "w_sipho", email: "sipho@nonna.test", name: "Sipho" };
type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const orderDoc = (id: string) => db.docs.get(`orders/${id}`) as Doc;

async function placeOrder() {
  const table = await saveTable({
    restaurant_id: RID,
    label: "12",
    capacity: 4,
    active: true,
    order_mode: "single",
  });
  const placed = await placeDineInOrder({
    table: { restaurant_id: RID, table_id: table.id },
    guest: { id: "guest_1" },
    items: [
      { name: "Steak", quantity: 2, unit_price: 189 },
      { name: "Coke", quantity: 3, unit_price: 25 },
    ],
  });
  return placed.order_id;
}

beforeEach(() => {
  db.reset();
  db.docs.set(`restaurants/${RID}`, { id: RID, name: "Nonna's Trattoria" });
});

describe("confirmDineInPayment", () => {
  it("can't be taken before the waiter has confirmed the order with the table", async () => {
    const id = await placeOrder();
    await expect(
      confirmDineInPayment({ order_id: id, method: "cash", actor: SIPHO }),
    ).rejects.toThrow(/Confirm order .* with the table before taking payment/);
    expect(orderDoc(id)["payment_status"]).toBe("pending");
  });

  it("records the payment once the order is confirmed — before it even goes to the kitchen", async () => {
    const id = await placeOrder();
    await confirmDineInOrder({ order_id: id, actor: SIPHO });

    const paid = await confirmDineInPayment({ order_id: id, method: "card", actor: SIPHO });

    const order = orderDoc(id);
    expect(paid.amount).toBe(order["total"]);
    expect(order).toMatchObject({ payment_status: "paid", payment_method: "card" });
    expect(order["payment"]).toMatchObject({
      status: "paid",
      method: "card",
      amount: order["total"],
      recorded_by: "Sipho",
      receipt_number: `R-${order["order_number"]}`,
    });
    expect(normalizeDineIn(order["dine_in"])).toMatchObject({
      paid_by: "Sipho",
      paid_by_id: "w_sipho",
      paid_with: "card",
    });
    const note = `Paid R ${Number(order["total"]).toFixed(2)} by card — taken by Sipho`;
    expect(Object.values(order["timeline"] as Record<string, Doc>).map((e) => e["note"])).toContain(
      note,
    );
  });

  it("can be taken at any later step: in the kitchen, ready, or served", async () => {
    for (const stage of ["kitchen", "ready", "served"] as const) {
      db.reset();
      db.docs.set(`restaurants/${RID}`, { id: RID, name: "Nonna's Trattoria" });
      const id = await placeOrder();
      await confirmDineInOrder({ order_id: id, actor: SIPHO });
      await sendDineInOrderToKitchen({ order_id: id, actor: SIPHO });
      if (stage !== "kitchen") await setFirebaseOrderStatus({ orderId: id, status: "ready" });
      if (stage === "served") await markDineInOrderServed({ order_id: id, actor: SIPHO });

      await confirmDineInPayment({ order_id: id, method: "cash", actor: SIPHO });
      expect(orderDoc(id)["payment_status"]).toBe("paid");
    }
  });

  it("is taken once, and a paid order can't be edited", async () => {
    const id = await placeOrder();
    await confirmDineInOrder({ order_id: id, actor: SIPHO });
    await confirmDineInPayment({ order_id: id, method: "cash", actor: SIPHO });

    await expect(
      confirmDineInPayment({ order_id: id, method: "cash", actor: SIPHO }),
    ).rejects.toThrow(/already been paid/);
    await expect(
      editDineInOrder({
        order_id: id,
        base_line_ids: [],
        lines: [],
        note: "Extra napkins",
        actor: SIPHO,
      }),
    ).rejects.toThrow(/already paid/);
  });

  it("isn't offered for rejected orders", () => {
    const base = {
      order_type: "dine_in",
      payment_status: "pending",
      dine_in: { confirmed_at: "x" },
    };
    expect(canTakeDineInPayment({ ...base, status: "waiter_confirmed" })).toBe(true);
    expect(canTakeDineInPayment({ ...base, status: "delivered" })).toBe(true);
    expect(canTakeDineInPayment({ ...base, status: "rejected" })).toBe(false);
    expect(canTakeDineInPayment({ ...base, status: "waiting_for_waiter_confirmation" })).toBe(
      false,
    );
    expect(canTakeDineInPayment({ ...base, status: "ready", payment_status: "paid" })).toBe(false);
    expect(
      canTakeDineInPayment({ ...base, status: "ready", dine_in: { confirmed_at: null } }),
    ).toBe(false);
  });
});
