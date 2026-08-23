// Firebase-backed menu data layer.
// Data shape (stored under the Realtime Database root):
//   /menus/{restaurantId}/categories/{catId}   -> MenuCategory
//   /menus/{restaurantId}/items/{itemId}       -> MenuItem
//   /menus/{restaurantId}/variants/{varId}     -> MenuVariant
//   /menus/{restaurantId}/addons/{addonId}     -> MenuAddon
//
// No demo data is seeded automatically. Menu management shows exactly what
// has been saved to Firebase — empty menus render as empty until the user
// creates categories and products.

import { isFirebaseAvailable, rtdbGet, rtdbSet, rtdbSubscribe } from "@/lib/firebase";
import type { FirebaseRestaurant } from "@/lib/restaurants.firebase";

export interface MenuCategory {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_available: boolean;
  [key: string]: string | number | boolean | null | undefined;
}
export interface MenuItem {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  category: string;
  name: string;
  description: string | null;
  price: number;
  discount_price: number | null;
  prep_time_minutes: number;
  points_value: number; // loyalty points per unit (consumed by the Customer App rewards system)
  is_available: boolean;
  is_featured: boolean;
  image_url: string | null;
  allergens: string[];
  [key: string]: string | number | boolean | null | undefined | string[];
}
export interface MenuVariant {
  id: string;
  menu_item_id: string;
  name: string;
  price_delta: number;
  is_default: boolean;
  is_available: boolean;
  sort_order?: number;
  [key: string]: string | number | boolean | null | undefined;
}
export interface MenuAddon {
  id: string;
  menu_item_id: string;
  name: string;
  price: number;
  max_quantity: number;
  is_available: boolean;
  [key: string]: string | number | boolean | null | undefined;
}
export interface MenuPayload {
  categories: MenuCategory[];
  items: MenuItem[];
  variants: MenuVariant[];
  addons: MenuAddon[];
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

function base<T>(restaurantId: string, kind: "categories" | "items" | "variants" | "addons") {
  return `menus/${restaurantId}/${kind}`;
}

function toArr<T>(data: Record<string, T> | null): T[] {
  return data ? Object.values(data) : [];
}

export async function getFirebaseMenu(restaurant: FirebaseRestaurant): Promise<MenuPayload> {
  if (!isFirebaseAvailable()) return { categories: [], items: [], variants: [], addons: [] };
  const [cats, its, vars, adds] = await Promise.all([
    rtdbGet<Record<string, MenuCategory>>(base(restaurant.id, "categories")),
    rtdbGet<Record<string, MenuItem>>(base(restaurant.id, "items")),
    rtdbGet<Record<string, MenuVariant>>(base(restaurant.id, "variants")),
    rtdbGet<Record<string, MenuAddon>>(base(restaurant.id, "addons")),
  ]);
  return {
    categories: toArr(cats).sort((a, b) => (a.sort_order as number) - (b.sort_order as number)),
    items: toArr(its),
    variants: toArr(vars),
    addons: toArr(adds),
  };
}

type MenuKind = "categories" | "items" | "variants" | "addons";
function collect(
  cats: Record<string, MenuCategory> | null,
  its: Record<string, MenuItem> | null,
  vars: Record<string, MenuVariant> | null,
  adds: Record<string, MenuAddon> | null,
): MenuPayload {
  return {
    categories: toArr(cats).sort((a, b) => (a.sort_order as number) - (b.sort_order as number)),
    items: toArr(its),
    variants: toArr(vars),
    addons: toArr(adds),
  };
}

export function subscribeFirebaseMenu(
  restaurantId: string,
  cb: (p: MenuPayload) => void,
): () => void {
  if (!isFirebaseAvailable()) {
    cb({ categories: [], items: [], variants: [], addons: [] });
    return () => {};
  }
  let cats: Record<string, MenuCategory> | null = null;
  let its: Record<string, MenuItem> | null = null;
  let vars: Record<string, MenuVariant> | null = null;
  let adds: Record<string, MenuAddon> | null = null;
  const emit = () => {
    if (!cats && !its && !vars && !adds) return;
    cb(collect(cats, its, vars, adds));
  };
  const u1 = rtdbSubscribe<Record<string, MenuCategory>>(base(restaurantId, "categories"), (v) => {
    cats = v;
    emit();
  });
  const u2 = rtdbSubscribe<Record<string, MenuItem>>(base(restaurantId, "items"), (v) => {
    its = v;
    emit();
  });
  const u3 = rtdbSubscribe<Record<string, MenuVariant>>(base(restaurantId, "variants"), (v) => {
    vars = v;
    emit();
  });
  const u4 = rtdbSubscribe<Record<string, MenuAddon>>(base(restaurantId, "addons"), (v) => {
    adds = v;
    emit();
  });
  return () => {
    u1();
    u2();
    u3();
    u4();
  };
}

// --- Mutations ---
export async function saveFirebaseCategory(input: Partial<MenuCategory> & { restaurant_id: string; name: string }) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const id = input.id ?? uid("cat");
  const all = (await rtdbGet<Record<string, MenuCategory>>(base(input.restaurant_id, "categories"))) ?? {};
  const existing = all[id];
  const record: MenuCategory = {
    id,
    restaurant_id: input.restaurant_id,
    name: input.name,
    description: input.description ?? existing?.description ?? null,
    sort_order: input.sort_order ?? existing?.sort_order ?? Object.keys(all).length,
    is_available: input.is_available ?? existing?.is_available ?? true,
  };
  await rtdbSet(`${base(input.restaurant_id, "categories")}/${id}`, record);
  return { id };
}

export async function deleteFirebaseCategory(input: { restaurant_id: string; id: string }) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  // Cascade: delete the category, null out its items' category_id.
  const items = (await rtdbGet<Record<string, MenuItem>>(base(input.restaurant_id, "items"))) ?? {};
  for (const [iid, item] of Object.entries(items)) {
    if (item.category_id === input.id) {
      await rtdbSet(`${base(input.restaurant_id, "items")}/${iid}/category_id`, null);
    }
  }
  await rtdbSet(`${base(input.restaurant_id, "categories")}/${input.id}`, null);
  return { ok: true };
}

export async function saveFirebaseMenuItem(input: Partial<MenuItem> & {
  restaurant_id: string;
  name: string;
  price: number;
  category_id: string | null;
  category: string;
}) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const id = input.id ?? uid("itm");
  const all = (await rtdbGet<Record<string, MenuItem>>(base(input.restaurant_id, "items"))) ?? {};
  const existing = all[id];
  const record: MenuItem = {
    id,
    restaurant_id: input.restaurant_id,
    name: input.name,
    category_id: input.category_id ?? existing?.category_id ?? null,
    category: input.category,
    description: input.description ?? existing?.description ?? null,
    price: input.price,
    discount_price: input.discount_price ?? existing?.discount_price ?? null,
    prep_time_minutes: input.prep_time_minutes ?? existing?.prep_time_minutes ?? 15,
    points_value: Math.max(0, Math.round(Number(input.points_value ?? existing?.points_value ?? 5))),
    is_available: input.is_available ?? existing?.is_available ?? true,
    is_featured: input.is_featured ?? existing?.is_featured ?? false,
    image_url: input.image_url ?? existing?.image_url ?? null,
    allergens: input.allergens ?? existing?.allergens ?? [],
  };
  await rtdbSet(`${base(input.restaurant_id, "items")}/${id}`, record);
  return { id };
}

export async function deleteFirebaseMenuItem(input: { restaurant_id: string; id: string }) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  // Cascade variants + addons.
  const vars = (await rtdbGet<Record<string, MenuVariant>>(base(input.restaurant_id, "variants"))) ?? {};
  for (const vid of Object.keys(vars)) if (vars[vid]!.menu_item_id === input.id) await rtdbSet(`${base(input.restaurant_id, "variants")}/${vid}`, null);
  const adds = (await rtdbGet<Record<string, MenuAddon>>(base(input.restaurant_id, "addons"))) ?? {};
  for (const aid of Object.keys(adds)) if (adds[aid]!.menu_item_id === input.id) await rtdbSet(`${base(input.restaurant_id, "addons")}/${aid}`, null);
  await rtdbSet(`${base(input.restaurant_id, "items")}/${input.id}`, null);
  return { ok: true };
}

export async function toggleFirebaseMenuItem(input: {
  restaurant_id: string;
  id: string;
  is_available: boolean;
}) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  await rtdbSet(`${base(input.restaurant_id, "items")}/${input.id}/is_available`, input.is_available);
  return { ok: true };
}

export async function saveFirebaseVariant(input: Partial<MenuVariant> & {
  menu_item_id: string;
  restaurant_id: string;
  name: string;
  price_delta: number;
}) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const id = input.id ?? uid("var");
  const all = (await rtdbGet<Record<string, MenuVariant>>(base(input.restaurant_id, "variants"))) ?? {};
  const existing = all[id];
  const record: MenuVariant = {
    id,
    menu_item_id: input.menu_item_id,
    name: input.name,
    price_delta: input.price_delta,
    is_default: input.is_default ?? existing?.is_default ?? false,
    is_available: input.is_available ?? existing?.is_available ?? true,
    sort_order: existing?.sort_order ?? Object.values(all).filter((v) => v.menu_item_id === input.menu_item_id).length,
  };
  await rtdbSet(`${base(input.restaurant_id, "variants")}/${id}`, record);
  return { id };
}

export async function saveFirebaseAddon(input: Partial<MenuAddon> & {
  menu_item_id: string;
  restaurant_id: string;
  name: string;
  price: number;
}) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const id = input.id ?? uid("add");
  const existing = (await rtdbGet<Record<string, MenuAddon>>(base(input.restaurant_id, "addons")))?.[id];
  const record: MenuAddon = {
    id,
    menu_item_id: input.menu_item_id,
    name: input.name,
    price: input.price,
    max_quantity: input.max_quantity ?? existing?.max_quantity ?? 3,
    is_available: input.is_available ?? existing?.is_available ?? true,
  };
  await rtdbSet(`${base(input.restaurant_id, "addons")}/${id}`, record);
  return { id };
}

export async function deleteFirebaseMenuChild(input: {
  restaurant_id: string;
  id: string;
  kind: "variant" | "addon";
}) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const kindPath = input.kind === "variant" ? "variants" : "addons";
  await rtdbSet(`${base(input.restaurant_id, kindPath)}/${input.id}`, null);
  return { ok: true };
}
