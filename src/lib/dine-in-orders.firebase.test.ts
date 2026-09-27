import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { format } from "date-fns";

// Firestore is replaced by the in-memory fake in src/lib/testing/fake-firestore.ts.
vi.mock("@/lib/firestore", async (importOriginal) =>
  (await import("@/lib/testing/fake-firestore")).fakeFirestoreModule(await importOriginal()),
);

import { fakeDb as db } from "@/lib/testing/fake-firestore";
import {
  dineInStatusLabel,
  isAwaitingWaiterConfirmation,
  normalizeDineIn,
  readyOrderAlerts,
  WAITER_CONFIRMED,
  WAITING_FOR_WAITER_CONFIRMATION,
} from "@/lib/dine-in";
import {
  applyOrderEdit,
  describeAddonChanges,
  describeOrderLine,
  lineTotal,
  normalizeOrderEdits,
  menuItemOptions,
  menuItemPrice,
  modifierAddonId,
  setAddonQuantity,
  toggleModifierChoice,
  withQuantity,
  type OrderEditLine,
} from "@/lib/dine-in-order-edit";
import {
  confirmDineInOrder,
  editDineInOrder,
  markDineInOrderServed,
  sendDineInOrderToKitchen,
} from "@/lib/dine-in-orders.firebase";
import { orderStage } from "@/lib/dispatch.functions";
import { isKitchenStatus, isOnKitchenBoard } from "@/lib/kitchen.functions";
import {
  normalizeMenuItem,
  normalizeMenuModifier,
  normalizeMenuVariant,
  type MenuModifier,
} from "@/lib/menus.firebase";
import {
  createFirebaseOrder,
  rejectFirebaseOrder,
  setFirebaseOrderStatus,
  type OrderLine,
  type OrderLineAddon,
} from "@/lib/orders.firebase";
import { placeDineInOrder, type DineInItemInput } from "@/lib/table-sessions.firebase";
import { buildTableOverview } from "@/lib/table-overview";
import { listTables, saveTable, type RestaurantTable } from "@/lib/tables.firebase";

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

  it("confirming records the waiter, but the order stays out of the kitchen until it's sent", async () => {
    const placed = await place("guest_a", [item("Steak", 1, 189)]);

    await confirmDineInOrder({ order_id: placed.order_id, actor: SAM });

    const order = orderDoc(placed.order_id);
    expect(order["status"]).toBe(WAITER_CONFIRMED);
    expect(isKitchenStatus(order["status"])).toBe(false);
    expect(order["accepted_at"]).toBeNull();
    expect(normalizeDineIn(order["dine_in"])).toMatchObject({
      confirmed_by: "Sam",
      waiter_id: "staff_sam",
      waiter_name: "Sam",
    });
    expect(history(placed.order_id)).toContain("Confirmed with the table by Sam");
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
    expect(
      history(placed.order_id).filter((n) => n?.startsWith("Confirmed with the table by")),
    ).toHaveLength(1);
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
    expect(orderDoc(placed.order_id)["status"]).toBe(WAITER_CONFIRMED);
  });

  it("a dine-in order written as “pending” before the waiter step can still be confirmed", async () => {
    const placed = await place("guest_a", [item("Steak")]);
    orderDoc(placed.order_id)["status"] = "pending";
    expect(isAwaitingWaiterConfirmation("pending")).toBe(true);

    await confirmDineInOrder({ order_id: placed.order_id, actor: SAM });
    expect(orderDoc(placed.order_id)["status"]).toBe(WAITER_CONFIRMED);
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
    expect(history(placed.order_id).at(-1)).toBe(
      "Edited by Sam: Steak: size Large removed; Cooking: Medium removed; Extra cheese ×2 removed",
    );
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
    await sendDineInOrderToKitchen({ order_id: placed.order_id, actor: SAM });
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

/* ----------------------------------------------------- Tasks 11–14 helpers */

const MUSHROOM_SAUCE: OrderLineAddon = {
  id: "addon_mushroom",
  name: "Mushroom Sauce",
  price: 25,
  quantity: 1,
};

/** At a given local time of day, so the history reads e.g. "18:47". */
function at(hours: number, minutes: number) {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 8, 26, hours, minutes) });
}

/** Whether the kitchen board would show this order. */
const onBoard = (id: string) => isOnKitchenBoard(orderDoc(id) as { status: string });

/** Confirm with the table, send to the kitchen, cook until ready. */
async function throughTheKitchen(id: string) {
  await confirmDineInOrder({ order_id: id, actor: SAM });
  await sendDineInOrderToKitchen({ order_id: id, actor: SAM });
  await setFirebaseOrderStatus({ orderId: id, status: "preparing" });
  await setFirebaseOrderStatus({ orderId: id, status: "ready" });
}

/** Table 12 as the Table overview shows it. */
async function tableTwelve() {
  const orders = [...db.docs.entries()]
    .filter(([path]) => path.startsWith("orders/"))
    .map(([, raw]) => {
      const doc = raw as Doc;
      return {
        id: doc["id"],
        order_number: doc["order_number"],
        status: doc["status"],
        order_type: doc["order_type"],
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
  const entries = buildTableOverview(await listTables(RID), orders);
  return entries.find((e) => e.table.label === "12")!;
}

afterEach(() => {
  vi.useRealTimers();
});

/* ----------------------------------------------------------------- Task 11 */

describe("Task 11 — order edit history", () => {
  it("records the original line, who changed it, what changed and when — never just overwriting it", async () => {
    const placed = await place("guest_a", [item("Steak", 1, 189, { addons: [MUSHROOM_SAUCE] })]);
    const id = placed.order_id;

    at(18, 47);
    await edit(id, ([steak]) => [{ ...steak!, addons: [] }]);

    const [record, ...more] = normalizeOrderEdits(orderDoc(id)["edits"]);
    expect(more).toHaveLength(0);
    expect(record).toMatchObject({
      by: "Sam",
      by_id: "staff_sam",
      summary: "Steak: Mushroom Sauce removed",
      status_before: WAITING_FOR_WAITER_CONFIRMATION,
      total_before: 224.7,
      total_after: 198.45,
      confirmation_withdrawn: false,
    });
    expect(format(new Date(record!.at), "HH:mm")).toBe("18:47");
    expect(record!.lines).toHaveLength(1);
    expect(record!.lines[0]).toMatchObject({
      kind: "changed",
      item_name: "Steak",
      original: "Steak + Mushroom Sauce",
      updated: "Steak",
      changes: ["Mushroom Sauce removed"],
    });
    // The customer's line is kept exactly as ordered, next to what it became.
    expect(record!.lines[0]!.before).toMatchObject({
      name: "Steak",
      addons: [MUSHROOM_SAUCE],
      line_total: 214,
      added_by: { guest_id: "guest_a", label: "Customer 1" },
    });
    expect(record!.lines[0]!.after).toMatchObject({
      addons: [],
      line_total: 189,
      edited_by: "Sam",
    });
    // The order itself now holds the edited line, and its timeline says so.
    expect(lineNamed(id, "Steak").addons).toEqual([]);
    expect(history(id)).toContain("Edited by Sam: Steak: Mushroom Sauce removed");
  });

  it("keeps every edit, with removed and added lines in full", async () => {
    const placed = await place("guest_a", [item("Burger", 2, 100), item("Chips", 1, 30)]);
    const id = placed.order_id;

    await edit(id, (ls) => ls.filter((l) => l.name !== "Chips"));
    await edit(id, (ls) => [
      ...ls.map((l) => withQuantity({ ...l, addons: l.addons ?? [] }, 1)),
      item("Salad", 1, 60),
    ]);

    const edits = normalizeOrderEdits(orderDoc(id)["edits"]);
    expect(edits.map((e) => e.summary)).toEqual([
      "Removed Chips ×1",
      "Burger: ×2 → ×1; Added Salad ×1",
    ]);
    expect(edits[0]!.lines[0]).toMatchObject({
      kind: "removed",
      original: "Chips",
      updated: null,
      after: null,
      before: { name: "Chips", quantity: 1, unit_price: 30, added_by: { guest_id: "guest_a" } },
    });
    expect(edits[1]!.lines.map((l) => [l.kind, l.original, l.updated])).toEqual([
      ["changed", "2× Burger", "Burger"],
      ["added", null, "Salad"],
    ]);
    expect(edits[1]!.lines[1]!.after).toMatchObject({ added_by_staff: "Sam" });
  });

  it("describes add-on, modifier and size changes precisely", () => {
    const cheese1 = { ...cheese, quantity: 1 };
    const cheese2 = { ...cheese, quantity: 2 };
    expect(describeAddonChanges([MUSHROOM_SAUCE], [])).toEqual(["Mushroom Sauce removed"]);
    expect(describeAddonChanges([], [cheese2])).toEqual(["Extra cheese ×2 added"]);
    expect(describeAddonChanges([cheese1], [cheese2])).toEqual(["Extra cheese ×1 → ×2"]);
    expect(describeAddonChanges([cooking(rare)], [cooking(medium)])).toEqual([
      "Cooking: Rare → Medium",
    ]);
    // A modifier's quantity follows the line's — not a change of its own.
    expect(describeAddonChanges([cooking(rare)], [{ ...cooking(rare), quantity: 2 }])).toEqual([]);
    expect(
      describeOrderLine({
        name: "Burger",
        quantity: 2,
        variant: { id: "var_large", name: "Large", price_delta: 40 },
        addons: [cooking(rare), cheese2],
      }),
    ).toBe("2× Burger (Large) + Cooking: Rare + Extra cheese ×2");
  });

  it("saving an unchanged order, or only a note, adds nothing to the edit history", async () => {
    const placed = await place("guest_a", [item("Burger", 1, 100)]);
    await edit(placed.order_id, (ls) => ls);
    await edit(placed.order_id, (ls) => ls, { note: "Window seat" });
    expect(normalizeOrderEdits(orderDoc(placed.order_id)["edits"])).toEqual([]);
  });

  it("the kitchen only ever receives the final confirmed order", async () => {
    const placed = await place("guest_a", [item("Steak", 1, 189, { addons: [MUSHROOM_SAUCE] })]);
    const id = placed.order_id;
    await edit(id, ([steak]) => [{ ...steak!, addons: [] }]);
    expect(onBoard(id)).toBe(false);

    await confirmDineInOrder({ order_id: id, actor: SAM });
    expect(onBoard(id)).toBe(false);
    await sendDineInOrderToKitchen({ order_id: id, actor: SAM });

    expect(onBoard(id)).toBe(true);
    expect(lines(id).map(describeOrderLine)).toEqual(["Steak"]);
    await expect(edit(id, ([s]) => [{ ...s!, addons: [MUSHROOM_SAUCE] }])).rejects.toMatchObject({
      code: "dine-in/order-locked",
    });
  });
});

/* ----------------------------------------------------------------- Task 12 */

describe("Task 12 — confirm the order, then send it to the kitchen", () => {
  it("goes customer order → waiter review → confirmation → kitchen, and never skips a step", async () => {
    const placed = await place("guest_a", [item("Steak", 1, 189)]);
    const id = placed.order_id;

    await expect(sendDineInOrderToKitchen({ order_id: id, actor: SAM })).rejects.toMatchObject({
      code: "dine-in/order-locked",
      message: expect.stringMatching(/confirm it with the table first/),
    });
    // Nor around the waiter with a plain status change.
    for (const status of [
      "waiter_confirmed",
      "accepted",
      "preparing",
      "ready",
      "delivered",
    ] as const) {
      await expect(setFirebaseOrderStatus({ orderId: id, status })).rejects.toThrow();
    }
    expect(orderDoc(id)["status"]).toBe(WAITING_FOR_WAITER_CONFIRMATION);
    expect(onBoard(id)).toBe(false);

    await confirmDineInOrder({ order_id: id, actor: SAM });
    expect(onBoard(id)).toBe(false);
    await expect(setFirebaseOrderStatus({ orderId: id, status: "preparing" })).rejects.toThrow(
      /hasn't been confirmed by a waiter and sent to the kitchen/,
    );

    await sendDineInOrderToKitchen({ order_id: id, actor: LEE });
    const order = orderDoc(id);
    expect(order["status"]).toBe("accepted");
    expect(order["accepted_at"]).toBeTruthy();
    expect(onBoard(id)).toBe(true);
    expect(dineInStatusLabel(order["status"])).toBe("Sent to kitchen");
    expect(normalizeDineIn(order["dine_in"])).toMatchObject({
      confirmed_by: "Sam",
      sent_to_kitchen_by: "Lee",
      waiter_name: "Sam",
    });
    expect(history(id)).toEqual(
      expect.arrayContaining(["Confirmed with the table by Sam", "Sent to the kitchen by Lee"]),
    );
    await expect(sendDineInOrderToKitchen({ order_id: id, actor: SAM })).rejects.toMatchObject({
      code: "dine-in/order-locked",
      message: expect.stringMatching(/already been sent/),
    });
  });

  it("a confirmed order takes no more items from guests — they start the table's next order", async () => {
    const first = await place("guest_a", [item("Steak")]);
    await confirmDineInOrder({ order_id: first.order_id, actor: SAM });

    const late = await place("guest_b", [item("Coke")]);

    expect(late).toMatchObject({ created: true, round: 2 });
    expect(lines(first.order_id).map((l) => l.name)).toEqual(["Steak"]);
    expect(orderDoc(late.order_id)["status"]).toBe(WAITING_FOR_WAITER_CONFIRMATION);
  });

  it("changing a confirmed order withdraws the confirmation — a note alone doesn't", async () => {
    const placed = await place("guest_a", [item("Burger", 1, 100)]);
    const id = placed.order_id;
    await confirmDineInOrder({ order_id: id, actor: SAM });

    await edit(id, (ls) => ls, { note: "Birthday table" });
    expect(orderDoc(id)["status"]).toBe(WAITER_CONFIRMED);

    const result = await edit(id, ([b]) => [{ ...b!, quantity: 2 }]);
    expect(result.confirmation_withdrawn).toBe(true);
    expect(orderDoc(id)["status"]).toBe(WAITING_FOR_WAITER_CONFIRMATION);
    expect(normalizeDineIn(orderDoc(id)["dine_in"])!.confirmed_at).toBeNull();
    expect(normalizeOrderEdits(orderDoc(id)["edits"])[0]).toMatchObject({
      status_before: WAITER_CONFIRMED,
      confirmation_withdrawn: true,
    });
    await expect(sendDineInOrderToKitchen({ order_id: id, actor: SAM })).rejects.toMatchObject({
      code: "dine-in/order-locked",
    });

    await confirmDineInOrder({ order_id: id, actor: SAM });
    await sendDineInOrderToKitchen({ order_id: id, actor: SAM });
    expect(orderDoc(id)["status"]).toBe("accepted");
  });

  it("a confirmed order can still be rejected before it goes to the kitchen", async () => {
    const placed = await place("guest_a", [item("Burger")]);
    await confirmDineInOrder({ order_id: placed.order_id, actor: SAM });
    await rejectFirebaseOrder({ orderId: placed.order_id, reason: "Kitchen closed" });
    expect(orderDoc(placed.order_id)["status"]).toBe("rejected");
  });

  it("the kitchen board never shows a dine-in order no waiter has confirmed", () => {
    const board = (status: string, order_type: string, confirmed_at: string | null) =>
      isOnKitchenBoard({ status, order_type, dine_in: { confirmed_at } });
    expect(board("accepted", "dine_in", null)).toBe(false);
    expect(board("preparing", "dine_in", null)).toBe(false);
    expect(board("accepted", "dine_in", "2026-09-26T18:47:00Z")).toBe(true);
    expect(board(WAITER_CONFIRMED, "dine_in", "2026-09-26T18:47:00Z")).toBe(false);
    expect(isOnKitchenBoard({ status: "accepted", order_type: "delivery" })).toBe(true);
  });
});

/* ----------------------------------------------------------------- Task 13 */

describe("Task 13 — the waiter hears when the kitchen marks an order ready", () => {
  const row = (id: string, status: string, order_type = "dine_in") => ({ id, status, order_type });

  it("alerts once per order, only when it turns ready, and clears when it's served", () => {
    // The first look only takes stock: orders already ready raise no alert.
    let r = readyOrderAlerts(null, [row("a", "ready"), row("b", "preparing")]);
    expect(r.alerts).toEqual([]);
    expect([...r.ready]).toEqual(["a"]);

    r = readyOrderAlerts(r.ready, [row("a", "ready"), row("b", "ready")]);
    expect(r.alerts.map((o) => o.id)).toEqual(["b"]);

    r = readyOrderAlerts(r.ready, [row("a", "ready"), row("b", "ready")]);
    expect(r.alerts).toEqual([]);

    r = readyOrderAlerts(r.ready, [row("a", "delivered"), row("b", "ready")]);
    expect(r.cleared).toEqual(["a"]);
    expect(r.alerts).toEqual([]);
  });

  it("never alerts waiters about delivery or pickup orders", () => {
    const r = readyOrderAlerts(new Set(), [
      row("c", "ready", "delivery"),
      row("d", "ready", "pickup"),
    ]);
    expect(r.alerts).toEqual([]);
  });

  it("the alert carries the table and order number once the kitchen marks it ready", async () => {
    const placed = await place("guest_a", [item("Steak")]);
    const id = placed.order_id;
    const snapshot = () => [
      orderDoc(id) as Doc & { id: string; status: string; order_type: string },
    ];
    const before = readyOrderAlerts(null, snapshot());

    await throughTheKitchen(id);

    const [alert] = readyOrderAlerts(before.ready, snapshot()).alerts;
    expect(alert!["dine_in"].table_label).toBe("12");
    expect(alert!["order_number"]).toBe(placed.order_number);
  });
});

/* ----------------------------------------------------------------- Task 14 */

describe("Task 14 — mark the order served", () => {
  it("records the order, table, waiter and time served, and updates the order and table", async () => {
    const placed = await place("guest_a", [item("Steak")]);
    const id = placed.order_id;
    await expect(markDineInOrderServed({ order_id: id, actor: LEE })).rejects.toMatchObject({
      code: "dine-in/order-locked",
      message: expect.stringMatching(/hasn't marked it ready/),
    });

    await throughTheKitchen(id);
    let entry = await tableTwelve();
    expect(entry).toMatchObject({ status: "occupied", service: "ready_to_serve" });
    expect(entry.ready_orders.map((o) => o.id)).toEqual([id]);
    // A plain status change can't do it — it wouldn't record the waiter.
    await expect(setFirebaseOrderStatus({ orderId: id, status: "delivered" })).rejects.toThrow(
      /Mark as served/,
    );

    at(19, 5);
    const served = await markDineInOrderServed({ order_id: id, actor: LEE });

    expect(served).toMatchObject({
      order_id: id,
      order_number: placed.order_number,
      table_label: "12",
      served_by: "Lee",
    });
    expect(format(new Date(served.served_at), "HH:mm")).toBe("19:05");
    const order = orderDoc(id);
    expect(order["status"]).toBe("delivered");
    expect(dineInStatusLabel(order["status"])).toBe("Served");
    expect(order["delivered_at"]).toBe(served.served_at);
    expect(normalizeDineIn(order["dine_in"])).toMatchObject({
      table_label: "12",
      served_at: served.served_at,
      served_by: "Lee",
      served_by_id: "staff_lee",
      waiter_name: "Sam", // the waiter who confirmed it stays the order's waiter
    });
    expect(history(id)).toContain("Served at Table 12 by Lee");

    // The table: nothing left in progress, everything served, guests still seated.
    entry = await tableTwelve();
    expect(entry).toMatchObject({ status: "occupied", service: "served", ready_orders: [] });
    expect(entry.active_orders).toEqual([]);

    await expect(markDineInOrderServed({ order_id: id, actor: LEE })).rejects.toMatchObject({
      message: expect.stringMatching(/already been served/),
    });
  });

  it("an order the kitchen hasn't finished can't be served", async () => {
    const placed = await place("guest_a", [item("Steak")]);
    await confirmDineInOrder({ order_id: placed.order_id, actor: SAM });
    await expect(
      markDineInOrderServed({ order_id: placed.order_id, actor: SAM }),
    ).rejects.toMatchObject({ code: "dine-in/order-locked" });
    expect(orderDoc(placed.order_id)["status"]).toBe(WAITER_CONFIRMED);
  });
});
