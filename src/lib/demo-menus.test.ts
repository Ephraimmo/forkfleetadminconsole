import { beforeEach, describe, expect, it, vi } from "vitest";

// Firestore is replaced by the in-memory fake in src/lib/testing/fake-firestore.ts.
vi.mock("@/lib/firestore", async (importOriginal) =>
  (await import("@/lib/testing/fake-firestore")).fakeFirestoreModule(await importOriginal()),
);

import { fakeDb as db } from "@/lib/testing/fake-firestore";
import {
  buildDemoMenu,
  demoMenuFor,
  loadDemoMenu,
  planDemoMenuLoad,
  removeDemoMenu,
} from "@/lib/demo-menus";
import { menuItemOptions, menuItemPrice } from "@/lib/dine-in-order-edit";
import {
  getMenuForRestaurant,
  saveFirebaseAddon,
  saveFirebaseCategory,
  saveFirebaseMenuItem,
  type MenuPayload,
} from "@/lib/menus.firebase";

const RID = "rst-nonna";
const demo = buildDemoMenu(demoMenuFor(RID)!, RID);
const byName = (menu: MenuPayload, name: string) => menu.items.find((i) => i.name === name)!;
const sortById = <T extends { id: string }>(list: T[]) =>
  [...list].sort((a, b) => a.id.localeCompare(b.id));

beforeEach(() => {
  db.reset();
});

describe("Nonna's Trattoria demo menu", () => {
  it("is a complete menu with unique ids and product names", () => {
    expect(demo.categories.map((c) => c.name)).toEqual([
      "Antipasti",
      "Pizze",
      "Pasta & Risotto",
      "Secondi",
      "Contorni",
      "Dolci",
      "Bambini",
      "Caffè & Bevande",
      "Vini & Cocktails",
    ]);
    expect(demo.items.length).toBeGreaterThanOrEqual(60);
    for (const kind of ["categories", "items", "variants", "addons", "modifiers"] as const) {
      const ids = demo[kind].map((r) => r.id);
      expect(new Set(ids).size, kind).toBe(ids.length);
    }
    const names = demo.items.map((i) => i.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);

    for (const item of demo.items) {
      expect(item.id).toMatch(/^itm_demo_nonna_[a-z0-9_]+$/);
      expect(item.price, item.name).toBeGreaterThan(0);
      expect(item.description, item.name).toBeTruthy();
      expect(item.image_url, item.name).toMatch(/^https:\/\/images\.unsplash\.com\/photo-/);
      expect(
        demo.categories.some((c) => c.id === item.category_id),
        item.name,
      ).toBe(true);
      const sizes = demo.variants.filter((v) => v.menu_item_id === item.id);
      if (sizes.length > 0)
        expect(
          sizes.filter((v) => v.is_default),
          item.name,
        ).toHaveLength(1);
    }
    // Firestore commits at most 500 writes in one batch.
    const records = Object.values(demo).reduce((sum, list) => sum + list.length, 0);
    expect(records).toBeLessThan(500);
  });

  it("only exists for Nonna's Trattoria", async () => {
    expect(demoMenuFor("rst-ramen")).toBeNull();
    await expect(loadDemoMenu("rst-ramen")).rejects.toThrow("no demo menu");
  });
});

describe("loadDemoMenu", () => {
  it("writes the whole demo in the shape the Menus page and other apps read", async () => {
    const plan = await loadDemoMenu(RID);
    expect(plan.add.items).toHaveLength(demo.items.length);
    expect(plan.skipped).toEqual([]);

    const menu = await getMenuForRestaurant(RID);
    for (const kind of ["categories", "items", "variants", "addons", "modifiers"] as const) {
      expect(sortById<{ id: string }>(menu[kind]), kind).toEqual(
        sortById<{ id: string }>(demo[kind]),
      );
    }
    // camelCase aliases, as saveFirebase* writes them.
    const raw = db.docs;
    expect(raw.get(`menus/${RID}/items/itm_demo_nonna_margherita`)).toMatchObject({
      modifierIds: ["mod_demo_nonna_pizza_base"],
    });
    expect(raw.get(`menus/${RID}/variants/var_demo_nonna_margherita_large_40cm`)).toMatchObject({
      menuItemId: "itm_demo_nonna_margherita",
      priceDelta: 60,
      isDefault: false,
    });
    expect(raw.get(`menus/${RID}/addons/add_demo_nonna_margherita_parma_ham`)).toMatchObject({
      menuItemId: "itm_demo_nonna_margherita",
      maxQuantity: 3,
    });
    expect(raw.get(`menus/${RID}/modifiers/mod_demo_nonna_steak_sauce`)).toMatchObject({
      includePricing: true,
      minSelections: 0,
      maxSelections: 2,
    });
  });

  it("gives waiters the sizes, add-ons and choices to order with", async () => {
    await loadDemoMenu(RID);
    const menu = await getMenuForRestaurant(RID);

    const margherita = menuItemOptions(menu, byName(menu, "Margherita"));
    expect(margherita.variants.map((v) => [v.name, v.price_delta])).toEqual([
      ["Regular 30cm", 0],
      ["Large 40cm", 60],
    ]);
    expect(margherita.addons.map((a) => a.name)).toContain("Parma ham");
    expect(margherita.modifiers).toHaveLength(1);
    expect(margherita.modifiers[0]!.choices.map((c) => [c.label, c.price])).toEqual([
      ["Classic Neapolitan", 0],
      ["Thin & crispy", 0],
      ["Gluten-free", 35],
    ]);

    const steak = menuItemOptions(menu, byName(menu, "Bistecca alla Griglia"));
    expect(steak.modifiers.map((m) => m.group.name)).toEqual([
      "Steak cooking",
      "Side",
      "Steak sauce",
    ]);
    expect(steak.modifiers[0]!.choices.every((c) => c.price === 0)).toBe(true);

    expect(menuItemPrice(byName(menu, "Vegetariana"))).toBe(115);
  });

  it("is safe to run again: nothing is rewritten and edits to demo products survive", async () => {
    await loadDemoMenu(RID);
    const path = `menus/${RID}/items/itm_demo_nonna_margherita`;
    db.docs.set(path, { ...db.docs.get(path), price: 99 });
    const versions = new Map(db.versions);

    const again = await loadDemoMenu(RID);
    expect(again.add.items).toEqual([]);
    expect(again.already_loaded).toBe(demo.items.length);
    expect(db.versions).toEqual(versions);
    expect(db.docs.get(path)).toMatchObject({ price: 99 });
  });

  it("keeps the restaurant's own products and reuses its categories", async () => {
    const { id: ownPizze } = await saveFirebaseCategory({ restaurant_id: RID, name: "pizze" });
    const { id: ownMargherita } = await saveFirebaseMenuItem({
      restaurant_id: RID,
      name: "Margherita ",
      price: 99,
      category_id: ownPizze,
      category: "pizze",
    });

    const plan = await loadDemoMenu(RID);
    expect(plan.skipped).toEqual(["Margherita"]);

    const menu = await getMenuForRestaurant(RID);
    expect(menu.categories.filter((c) => c.name.toLowerCase() === "pizze")).toHaveLength(1);
    expect(menu.items.filter((i) => i.name.trim() === "Margherita")).toEqual([
      expect.objectContaining({ id: ownMargherita, price: 99 }),
    ]);
    // The skipped product's sizes and add-ons aren't written either.
    expect(menu.variants.some((v) => v.menu_item_id === "itm_demo_nonna_margherita")).toBe(false);
    expect(menu.addons.some((a) => a.menu_item_id === "itm_demo_nonna_margherita")).toBe(false);
    // The other demo pizzas join the restaurant's own category.
    expect(byName(menu, "Diavola")).toMatchObject({ category_id: ownPizze, category: "pizze" });
    // New demo categories come after the restaurant's own.
    expect(menu.categories.map((c) => c.name)[0]).toBe("pizze");
  });

  it("puts back a deleted demo product, but not a size deleted from a kept one", async () => {
    await loadDemoMenu(RID);
    db.docs.delete(`menus/${RID}/items/itm_demo_nonna_tiramisu`);
    db.docs.delete(`menus/${RID}/variants/var_demo_nonna_diavola_large_40cm`);

    const plan = await loadDemoMenu(RID);
    expect(plan.add.items.map((i) => i.name)).toEqual(["Tiramisù della Nonna"]);

    const menu = await getMenuForRestaurant(RID);
    expect(byName(menu, "Tiramisù della Nonna")).toBeTruthy();
    const diavola = byName(menu, "Diavola");
    expect(menu.variants.filter((v) => v.menu_item_id === diavola.id).map((v) => v.name)).toEqual([
      "Regular 30cm",
    ]);
  });
});

describe("removeDemoMenu", () => {
  it("deletes only what the demo added, and what was added to demo products", async () => {
    const { id: ownItem } = await saveFirebaseMenuItem({
      restaurant_id: RID,
      name: "Nonna's Meatball Sub",
      price: 120,
      category_id: null,
      category: "General",
    });
    await loadDemoMenu(RID);
    // An admin moves their product into a demo category and adds an add-on to a demo product.
    await saveFirebaseMenuItem({
      ...(await getMenuForRestaurant(RID)).items.find((i) => i.id === ownItem)!,
      category_id: "cat_demo_nonna_antipasti",
      category: "Antipasti",
    });
    const { id: extraAddon } = await saveFirebaseAddon({
      restaurant_id: RID,
      menu_item_id: "itm_demo_nonna_margherita",
      name: "Truffle oil",
      price: 30,
    });

    const plan = await removeDemoMenu(RID);
    expect(plan.remove.items).toHaveLength(demo.items.length);
    expect(plan.remove.addons).toContain(extraAddon);
    expect(plan.uncategorise).toEqual([ownItem]);

    const menu = await getMenuForRestaurant(RID);
    expect(menu).toEqual({
      categories: [],
      items: [expect.objectContaining({ id: ownItem, category_id: null })],
      variants: [],
      addons: [],
      modifiers: [],
    });
  });

  it("previews against the live menu before anything is written", () => {
    const empty: MenuPayload = {
      categories: [],
      items: [],
      variants: [],
      addons: [],
      modifiers: [],
    };
    const plan = planDemoMenuLoad(demo, empty);
    expect(plan.add).toEqual(demo);
    expect(planDemoMenuLoad(demo, demo).add).toEqual(empty);
  });
});
