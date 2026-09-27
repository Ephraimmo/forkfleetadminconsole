import { beforeEach, describe, expect, it, vi } from "vitest";

// Firestore is replaced by the in-memory fake in src/lib/testing/fake-firestore.ts.
vi.mock("@/lib/firestore", async (importOriginal) =>
  (await import("@/lib/testing/fake-firestore")).fakeFirestoreModule(await importOriginal()),
);

import { fakeDb as db } from "@/lib/testing/fake-firestore";
import {
  isAwaitingWaiterConfirmation,
  normalizeDineIn,
  WAITING_FOR_WAITER_CONFIRMATION,
} from "@/lib/dine-in";
import {
  applyOrderEdit,
  lineTotal,
  menuItemOptions,
  menuItemPrice,
  modifierAddonId,
  setAddonQuantity,
  toggleModifierChoice,
  withQuantity,
  type OrderEditLine,
} from "@/lib/dine-in-order-edit";
import { confirmDineInOrder, editDineInOrder } from "@/lib/dine-in-orders.firebase";
import { orderStage } from "@/lib/dispatch.functions";
import { isKitchenStatus } from "@/lib/kitchen.functions";
import {
  normalizeMenuItem,
  normalizeMenuModifier,
  normalizeMenuVariant,
  type MenuModifier,
} from "@/lib/menus.firebase";
import {
  createFirebaseOrder,
  setFirebaseOrderStatus,
  type OrderLine,
  type OrderLineAddon,
} from "@/lib/orders.firebase";
import { placeDineInOrder, type DineInItemInput } from "@/lib/table-sessions.firebase";
import { saveTable, type RestaurantTable } from "@/lib/tables.firebase";

const RID = "rst-nonna";
type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const SAM = { id: "staff_sam", email: "sam@nonna.test", name: "Sam" };
const LEE = { id: "staff_lee", email: "lee@nonna.test", name: "Lee" };

const COOKING = { id: "mod_cook", name: "Cooking", max_selections: 1 } as const;
const SAUCES = { id: "mod_sauce", name: "Sauce", max_selections: 2 } as const;
const rare = { index: 0, label: "Rare", price: 0 };
const medium = { index: 1, label: "Medium", price: 0 };
const pepper = { index: 0, label: "Pepper", price: 12 };
const mushroom = { index: 1, label: "Mushroom", price: 15 };
const garlic = { index: 2, label: "Garlic", price: 10 };
const cheese = { id: "addon_cheese", name: "Extra cheese", price: 10 };

const cooking = (choice: typeof rare): OrderLineAddon => ({
  id: modifierAddonId(COOKING.id, choice.index),
  name: `Cooking: ${choice.label}`,
  price: choice.price,
  quantity: 1,
});

const item = (
  name: string,
  quantity = 1,
  unit_price = 50,
  extra: Partial<DineInItemInput> = {},
) => ({
  name,
  quantity,
  unit_price,
  ...extra,
});

let table: RestaurantTable;
const place = (guest: string, items: DineInItemInput[], special_instructions?: string) =>
  placeDineInOrder({
    table: { restaurant_id: RID, table_id: table.id },
    guest: { id: guest },
    items,
    ...(special_instructions ? { special_instructions } : {}),
  });

const orderDoc = (id: string) => db.docs.get(`orders/${id}`) as Doc;
const lines = (id: string) => Object.values(orderDoc(id)["items"] as Record<string, OrderLine>);
const lineNamed = (id: string, name: string) => lines(id).find((l) => l.name === name)!;
const history = (id: string) =>
  Object.values(orderDoc(id)["timeline"] as Record<string, Doc>).map((e) => e["note"] as string);

/** The editor's view of the order: every line as-is, which a test then changes. */
function editorLines(id: string): OrderEditLine[] {
  return lines(id).map((l) => ({
    id: l.id,
    item_id: l.item_id,
    name: l.name,
    quantity: l.quantity,
    unit_price: l.unit_price,
    notes: l.notes,
    variant: l.variant,
    addons: l.addons,
  }));
}

function edit(id: string, change: (lines: OrderEditLine[]) => OrderEditLine[], extra = {}) {
  const current = editorLines(id);
  return editDineInOrder({
    order_id: id,
    base_line_ids: current.map((l) => l.id!),
    lines: change(current),
    actor: SAM,
    ...extra,
  });
}

beforeEach(async () => {
  db.reset();
  db.docs.set(`restaurants/${RID}`, { id: RID, name: "Nonna's Table" });
  table = await saveTable({
    restaurant_id: RID,
    label: "12",
    capacity: 4,
    active: true,
    order_mode: "single",
  });
});

/* ------------------------------------------------------------------ Task 9 */

describe("Task 9 — orders wait for a waiter's confirmation", () => {
  it("a guest's completed order arrives as WAITING_FOR_WAITER_CONFIRMATION and stays out of the kitchen", async () => {
    const placed = await place("guest_a", [item("Steak", 1, 189)]);
    const order = orderDoc(placed.order_id);

    expect(order["status"]).toBe("waiting_for_waiter_confirmation");
    expect(WAITING_FOR_WAITER_CONFIRMATION).toBe("waiting_for_waiter_confirmation");
    expect(isKitchenStatus(order["status"])).toBe(false);
    expect(order["accepted_at"]).toBeNull();
    // Staff see it by table and order number, as waiting for the waiter.
    expect(order["dine_in"].table_label).toBe("12");
    expect(order["order_number"]).toMatch(/^FF-\d{6}$/);
    expect(orderStage({ ...order, driver_id: null, driver_status: null } as never)).toBe(
      "waiting_for_waiter_confirmation",
    );
  });

  it("confirming sends it to the kitchen and records the waiter", async () => {
    const placed = await place("guest_a", [item("Steak", 1, 189)]);

    await confirmDineInOrder({ order_id: placed.order_id, actor: SAM });

    const order = orderDoc(placed.order_id);
    expect(order["status"]).toBe("accepted");
    expect(isKitchenStatus(order["status"])).toBe(true);
    expect(order["accepted_at"]).toBeTruthy();
    expect(normalizeDineIn(order["dine_in"])).toMatchObject({
      confirmed_by: "Sam",
      waiter_id: "staff_sam",
      waiter_name: "Sam",
    });
    expect(history(placed.order_id)).toContain("Confirmed by Sam — sent to the kitchen");
  });

  it("keeps a waiter who is already set", async () => {
    const placed = await place("guest_a", [item("Steak")]);
    const doc = orderDoc(placed.order_id);
    doc["dine_in"].waiter_id = "staff_lee";
    doc["dine_in"].waiter_name = "Lee";

    await confirmDineInOrder({ order_id: placed.order_id, actor: SAM });

    expect(orderDoc(placed.order_id)["dine_in"]).toMatchObject({
      waiter_name: "Lee",
      confirmed_by: "Sam",
    });
  });

  it("an order can only be confirmed once", async () => {
    const placed = await place("guest_a", [item("Steak")]);
    const both = await Promise.allSettled([
      confirmDineInOrder({ order_id: placed.order_id, actor: SAM }),
      confirmDineInOrder({ order_id: placed.order_id, actor: LEE }),
    ]);

    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (both.find((r) => r.status === "rejected") as PromiseRejectedResult).reason,
    ).toMatchObject({
      code: "dine-in/order-locked",
    });
    expect(history(placed.order_id).filter((n) => n?.startsWith("Confirmed by"))).toHaveLength(1);
  });

  it("won't send the kitchen items the waiter hasn't seen", async () => {
    const placed = await place("guest_a", [item("Steak")]);
    const seen = lines(placed.order_id).map((l) => l.id);
    await place("guest_b", [item("Coke", 2, 25)]);

    await expect(
      confirmDineInOrder({ order_id: placed.order_id, reviewed_line_ids: seen, actor: SAM }),
    ).rejects.toMatchObject({ code: "dine-in/order-changed" });
    expect(orderDoc(placed.order_id)["status"]).toBe(WAITING_FOR_WAITER_CONFIRMATION);

    await confirmDineInOrder({
      order_id: placed.order_id,
      reviewed_line_ids: lines(placed.order_id).map((l) => l.id),
      actor: SAM,
    });
    expect(orderDoc(placed.order_id)["status"]).toBe("accepted");
  });

  it("a dine-in order written as “pending” before the waiter step can still be confirmed", async () => {
    const placed = await place("guest_a", [item("Steak")]);
    orderDoc(placed.order_id)["status"] = "pending";
    expect(isAwaitingWaiterConfirmation("pending")).toBe(true);

    await confirmDineInOrder({ order_id: placed.order_id, actor: SAM });
    expect(orderDoc(placed.order_id)["status"]).toBe("accepted");
  });

  it("only dine-in orders wait for a waiter", async () => {
    const id = await createFirebaseOrder({
      restaurant_id: RID,
      restaurant_name: "Nonna's Table",
      customer_name: "Thandi",
      items: [{ name: "Pizza", quantity: 1, unit_price: 120 }],
    });
    await expect(
      setFirebaseOrderStatus({ orderId: id, status: "waiting_for_waiter_confirmation" }),
    ).rejects.toThrow(/Only dine-in orders/);
    await expect(confirmDineInOrder({ order_id: id, actor: SAM })).rejects.toMatchObject({
      code: "dine-in/order-locked",
    });
  });
});

/* ----------------------------------------------------------------- Task 10 */

describe("Task 10 — the waiter edits an order before confirming it", () => {
  it("adds and removes items and changes quantities, repricing the order", async () => {
    const placed = await place("guest_a", [item("Burger", 1, 100), item("Chips", 1, 30)]);
    await place("guest_b", [item("Coke", 2, 25)]);

    const result = await edit(placed.order_id, (ls) => [
      ...ls
        .filter((l) => l.name !== "Chips")
        .map((l) => (l.name === "Burger" ? withQuantity({ ...l, addons: l.addons ?? [] }, 2) : l)),
      item("Salad", 1, 60, { item_id: "menu_salad" }),
    ]);

    const order = orderDoc(placed.order_id);
    expect(
      lines(placed.order_id)
        .map((l) => `${l.name} ×${l.quantity}`)
        .sort(),
    ).toEqual(["Burger ×2", "Coke ×2", "Salad ×1"]);
    expect(order["subtotal"]).toBe(200 + 50 + 60);
    expect(order["service_fee"]).toBe(15.5);
    expect(order["total"]).toBe(325.5);
    expect(result.changes).toEqual(["Burger: ×1 → ×2", "Removed Chips ×1", "Added Salad ×1"]);
    expect(history(placed.order_id)).toContain(
      "Edited by Sam: Burger: ×1 → ×2; Removed Chips ×1; Added Salad ×1",
    );
    // The waiter's line is theirs; the guests' counts follow the edit.
    expect(lineNamed(placed.order_id, "Salad")).toMatchObject({
      added_by: null,
      added_by_staff: "Sam",
      item_id: "menu_salad",
    });
    expect(lineNamed(placed.order_id, "Burger")).toMatchObject({
      edited_by: "Sam",
      added_by: { guest_id: "guest_a" },
    });
    expect(
      normalizeDineIn(order["dine_in"])!.contributors.map((c) => [c.label, c.item_count]),
    ).toEqual([
      ["Customer 1", 2],
      ["Customer 2", 2],
    ]);
    // Still out of the kitchen until confirmed.
    expect(order["status"]).toBe(WAITING_FOR_WAITER_CONFIRMATION);
  });

  it("adds, changes and removes modifiers, and changes the size", async () => {
    const placed = await place("guest_a", [
      item("Steak", 1, 200, { item_id: "menu_steak", addons: [cooking(rare)] }),
    ]);
    const large = { id: "var_large", name: "Large", price_delta: 40 };

    await edit(placed.order_id, ([steak]) => {
      let addons = steak!.addons ?? [];
      addons = toggleModifierChoice({ quantity: 1, addons }, COOKING, medium); // Rare -> Medium
      addons = setAddonQuantity(addons, cheese, 2); // add an add-on
      return [{ ...steak!, variant: large, addons }];
    });

    let steak = lineNamed(placed.order_id, "Steak");
    expect(steak.variant).toEqual(large);
    expect(steak.addons.map((a) => [a.name, a.quantity])).toEqual([
      ["Cooking: Medium", 1],
      ["Extra cheese", 2],
    ]);
    expect(steak.line_total).toBe(200 + 40 + 20);
    expect(orderDoc(placed.order_id)["subtotal"]).toBe(260);

    await edit(placed.order_id, ([s]) => [{ ...s!, addons: [], variant: null }]);
    steak = lineNamed(placed.order_id, "Steak");
    expect(steak.addons).toEqual([]);
    expect(steak.line_total).toBe(200);
    expect(history(placed.order_id).at(-1)).toBe("Edited by Sam: Steak: no size; extras removed");
  });

  it("changes item notes and special instructions, and adds a note to the history", async () => {
    const placed = await place("guest_a", [item("Burger", 1, 100)], "No rush");
    const from = orderDoc(placed.order_id)["special_instructions"];
    expect(from).toBe("Customer 1: No rush");

    const result = await edit(placed.order_id, ([burger]) => [{ ...burger!, notes: "No onions" }], {
      special_instructions: { from, to: "Nut allergy at this table" },
      note: "Guests are celebrating a birthday",
    });

    const order = orderDoc(placed.order_id);
    expect(lineNamed(placed.order_id, "Burger").notes).toBe("No onions");
    expect(order["special_instructions"]).toBe("Nut allergy at this table");
    expect(result).toMatchObject({ noted: true });
    expect(result.changes).toEqual([
      'Burger: note "No onions"',
      "Updated the special instructions",
    ]);
    expect(history(placed.order_id)).toContain("Note from Sam: Guests are celebrating a birthday");
  });

  it("can add just a note without changing the order", async () => {
    const placed = await place("guest_a", [item("Burger", 1, 100)]);
    const before = structuredClone(orderDoc(placed.order_id)["items"]);

    const result = await edit(placed.order_id, (ls) => ls, { note: "Seated by the window" });

    expect(result).toMatchObject({ changes: [], noted: true });
    expect(orderDoc(placed.order_id)["items"]).toEqual(before);
    expect(history(placed.order_id)).toContain("Note from Sam: Seated by the window");
  });

  it("saving an unchanged order writes nothing", async () => {
    const placed = await place("guest_a", [item("Burger", 1, 100)]);
    const version = db.versions.get(`orders/${placed.order_id}`);

    const result = await edit(placed.order_id, (ls) => ls);

    expect(result.changes).toEqual([]);
    expect(db.versions.get(`orders/${placed.order_id}`)).toBe(version);
  });

  it("keeps items a guest adds while the waiter is editing", async () => {
    const placed = await place("guest_a", [item("Burger", 1, 100)]);
    const snapshot = editorLines(placed.order_id);
    await place("guest_b", [item("Coke", 1, 25)]); // lands while the editor is open

    await editDineInOrder({
      order_id: placed.order_id,
      base_line_ids: snapshot.map((l) => l.id!),
      lines: [{ ...snapshot[0]!, quantity: 3 }],
      actor: SAM,
    });

    expect(
      lines(placed.order_id)
        .map((l) => `${l.name} ×${l.quantity}`)
        .sort(),
    ).toEqual(["Burger ×3", "Coke ×1"]);
    expect(orderDoc(placed.order_id)["subtotal"]).toBe(325);
  });

  it("won't overwrite special instructions a guest added while the waiter was editing", async () => {
    const placed = await place("guest_a", [item("Burger", 1, 100)]);
    const snapshot = editorLines(placed.order_id);
    await place("guest_b", [item("Coke")], "Extra ice please");

    await expect(
      editDineInOrder({
        order_id: placed.order_id,
        base_line_ids: snapshot.map((l) => l.id!),
        lines: snapshot,
        special_instructions: { from: null, to: "Serve together" },
        actor: SAM,
      }),
    ).rejects.toMatchObject({ code: "dine-in/order-changed" });
    expect(orderDoc(placed.order_id)["special_instructions"]).toBe("Customer 2: Extra ice please");
  });

  it("can't be edited once it has been sent to the kitchen", async () => {
    const placed = await place("guest_a", [item("Burger", 1, 100)]);
    await confirmDineInOrder({ order_id: placed.order_id, actor: SAM });
    const before = structuredClone(orderDoc(placed.order_id));

    await expect(edit(placed.order_id, ([b]) => [{ ...b!, quantity: 5 }])).rejects.toMatchObject({
      code: "dine-in/order-locked",
    });
    expect(orderDoc(placed.order_id)).toEqual(before);
  });

  it("won't leave an order empty — reject it instead", async () => {
    const placed = await place("guest_a", [item("Burger", 1, 100)]);
    await expect(edit(placed.order_id, () => [])).rejects.toMatchObject({
      code: "dine-in/invalid-items",
    });
    expect(lines(placed.order_id)).toHaveLength(1);
  });

  it("validates what the waiter enters", async () => {
    const placed = await place("guest_a", [item("Burger", 1, 100)]);
    for (const bad of [
      (ls: OrderEditLine[]) => [{ ...ls[0]!, quantity: 0 }],
      (ls: OrderEditLine[]) => [{ ...ls[0]!, quantity: 100 }],
      (ls: OrderEditLine[]) => [...ls, item("Free lunch", 1, -1)],
      (ls: OrderEditLine[]) => [...ls, { ...ls[0]! }], // the same line twice
      (ls: OrderEditLine[]) => [{ ...ls[0]!, id: "ln_not_on_this_order" }],
    ]) {
      await expect(edit(placed.order_id, bad)).rejects.toMatchObject({
        code: "dine-in/invalid-items",
      });
    }
  });

  it("keeps the stored name and price of an existing line", () => {
    const stored: OrderLine = {
      id: "ln_1",
      item_id: "menu_burger",
      name: "Burger",
      quantity: 1,
      unit_price: 100,
      line_total: 100,
      notes: null,
      variant: null,
      addons: [],
    };
    const applied = applyOrderEdit(
      { items: { ln_1: stored }, special_instructions: null },
      {
        base_line_ids: ["ln_1"],
        lines: [{ id: "ln_1", name: "Free burger", unit_price: 0, quantity: 2 }],
      },
      { at: "2026-09-27T10:00:00Z", editor: "Sam" },
    );
    expect(applied.items["ln_1"]).toMatchObject({
      name: "Burger",
      unit_price: 100,
      line_total: 200,
    });
  });
});

/* -------------------------------------------------------------- modifiers */

describe("modifiers and pricing", () => {
  it("a choose-one group swaps the choice; a multi-choice group stops at its maximum", () => {
    let addons: OrderLineAddon[] = [];
    addons = toggleModifierChoice({ quantity: 1, addons }, COOKING, rare);
    addons = toggleModifierChoice({ quantity: 1, addons }, COOKING, medium);
    expect(addons.map((a) => a.name)).toEqual(["Cooking: Medium"]);

    addons = toggleModifierChoice({ quantity: 1, addons }, SAUCES, pepper);
    addons = toggleModifierChoice({ quantity: 1, addons }, SAUCES, mushroom);
    addons = toggleModifierChoice({ quantity: 1, addons }, SAUCES, garlic); // over the max of 2
    expect(addons.map((a) => a.name)).toEqual([
      "Cooking: Medium",
      "Sauce: Pepper",
      "Sauce: Mushroom",
    ]);

    addons = toggleModifierChoice({ quantity: 1, addons }, SAUCES, pepper); // unpick
    expect(addons.map((a) => a.name)).toEqual(["Cooking: Medium", "Sauce: Mushroom"]);
  });

  it("priced choices follow the line's quantity; plain add-ons keep their own", () => {
    let line = { unit_price: 100, quantity: 1, variant: null, addons: [] as OrderLineAddon[] };
    line = { ...line, addons: toggleModifierChoice(line, SAUCES, pepper) };
    line = { ...line, addons: setAddonQuantity(line.addons, cheese, 1) };
    line = withQuantity(line, 3);

    expect(line.addons.map((a) => [a.name, a.quantity])).toEqual([
      ["Sauce: Pepper", 3],
      ["Extra cheese", 1],
    ]);
    expect(lineTotal(line)).toBe(300 + 36 + 10);
    expect(setAddonQuantity(line.addons, cheese, 0).map((a) => a.name)).toEqual(["Sauce: Pepper"]);
  });

  it("offers the choices ticked for this product, at the product's price", () => {
    const sauce: MenuModifier = normalizeMenuModifier(
      "mod_sauce",
      {
        name: "Sauce",
        type: "extra",
        include_pricing: true,
        max_selections: 2,
        choices: [
          { label: "Pepper", price: 12 },
          { label: "Mushroom", price: 15 },
          { label: "Garlic", price: 10 },
        ],
      },
      RID,
    );
    const steak = normalizeMenuItem(
      "menu_steak",
      {
        name: "Steak",
        price: 200,
        discount_price: 180,
        modifier_ids: ["mod_sauce"],
        modifier_config: {
          mod_sauce: { "0": { selected: true, price: 20 }, "2": { selected: true, price: 10 } },
        },
      },
      RID,
    );
    const options = menuItemOptions(
      {
        variants: [
          normalizeMenuVariant("var_large", { menu_item_id: "menu_steak", name: "Large" }),
          normalizeMenuVariant("var_other", { menu_item_id: "menu_other", name: "Other" }),
        ],
        addons: [],
        modifiers: [sauce],
      },
      steak,
    );

    expect(options.variants.map((v) => v.name)).toEqual(["Large"]);
    expect(options.modifiers[0]!.choices).toEqual([
      { index: 0, label: "Pepper", price: 20 },
      { index: 2, label: "Garlic", price: 10 },
    ]);
    expect(menuItemPrice(steak)).toBe(180);
  });
});
