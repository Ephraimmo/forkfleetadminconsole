// Firebase-backed menu data layer.
// Data shape (stored under the Realtime Database root):
//   /menus/{restaurantId}/categories/{catId}   -> MenuCategory
//   /menus/{restaurantId}/items/{itemId}       -> MenuItem
//   /menus/{restaurantId}/variants/{varId}     -> MenuVariant
//   /menus/{restaurantId}/addons/{addonId}     -> MenuAddon
//   /menus/{restaurantId}/modifiers/{modId}    -> MenuModifier (choice groups)
//
// Legacy Orderly Hub path /modifiers/{id} is NOT used for new writes.

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

export interface ModifierChoiceConfig {
  selected: boolean;
  price: number;
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
  points_value: number;
  is_available: boolean;
  is_featured: boolean;
  image_url: string | null;
  allergens: string[];
  /** Assigned modifier group IDs (snake_case canonical). */
  modifier_ids: string[];
  /** Per-product choice overrides keyed by modifier id → choice index. */
  modifier_config: Record<string, Record<string, ModifierChoiceConfig>>;
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | string[]
    | Record<string, Record<string, ModifierChoiceConfig>>;
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

export interface MenuModifierChoice {
  label: string;
  price: number;
}

export interface MenuModifier {
  id: string;
  restaurant_id: string;
  name: string;
  type: "option" | "extra";
  required: boolean;
  include_pricing: boolean;
  min_selections: number;
  max_selections: number;
  choices: MenuModifierChoice[];
  sort_order: number;
  is_available: boolean;
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | MenuModifierChoice[];
}

export interface MenuPayload {
  categories: MenuCategory[];
  items: MenuItem[];
  variants: MenuVariant[];
  addons: MenuAddon[];
  modifiers: MenuModifier[];
}

type MenuKind = "categories" | "items" | "variants" | "addons" | "modifiers";
type RawMap = Record<string, unknown>;

const EMPTY: MenuPayload = {
  categories: [],
  items: [],
  variants: [],
  addons: [],
  modifiers: [],
};

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

function base(restaurantId: string, kind: MenuKind): string {
  return `menus/${restaurantId}/${kind}`;
}

function readMenuItemId(raw: RawMap): string {
  const id = raw["menu_item_id"] ?? raw["menuItemId"];
  return typeof id === "string" ? id : "";
}

function readModifierIds(raw: RawMap): string[] {
  const ids = raw["modifier_ids"] ?? raw["modifierIds"];
  if (!Array.isArray(ids)) return [];
  return ids.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function readModifierConfig(raw: RawMap): Record<string, Record<string, ModifierChoiceConfig>> {
  const cfg = raw["modifier_config"] ?? raw["modifierConfig"];
  if (!cfg || typeof cfg !== "object") return {};
  const out: Record<string, Record<string, ModifierChoiceConfig>> = {};
  for (const [modId, choices] of Object.entries(cfg as Record<string, unknown>)) {
    if (!choices || typeof choices !== "object") continue;
    const mapped: Record<string, ModifierChoiceConfig> = {};
    for (const [idx, val] of Object.entries(choices as Record<string, unknown>)) {
      const row = val as RawMap;
      mapped[idx] = {
        selected: row["selected"] === true,
        price: typeof row["price"] === "number" ? row["price"] : Number(row["price"] ?? 0),
      };
    }
    out[modId] = mapped;
  }
  return out;
}

export function normalizeMenuItem(id: string, raw: RawMap, restaurantId: string): MenuItem {
  return {
    id,
    restaurant_id: String(raw["restaurant_id"] ?? raw["restaurantId"] ?? restaurantId),
    category_id:
      raw["category_id"] != null
        ? String(raw["category_id"])
        : raw["categoryId"] != null
          ? String(raw["categoryId"])
          : null,
    category: String(raw["category"] ?? "General"),
    name: String(raw["name"] ?? ""),
    description:
      typeof raw["description"] === "string" ? raw["description"] : (raw["description"] ?? null),
    price: Number(raw["price"] ?? 0),
    discount_price:
      raw["discount_price"] != null
        ? Number(raw["discount_price"])
        : raw["discountPrice"] != null
          ? Number(raw["discountPrice"])
          : null,
    prep_time_minutes: Number(raw["prep_time_minutes"] ?? raw["prepTime"] ?? 15),
    points_value: Math.max(0, Math.round(Number(raw["points_value"] ?? raw["pointsValue"] ?? 5))),
    is_available: raw["is_available"] !== false && raw["available"] !== false,
    is_featured: raw["is_featured"] === true || raw["isFeatured"] === true,
    image_url:
      typeof raw["image_url"] === "string"
        ? raw["image_url"]
        : typeof raw["imageUrl"] === "string"
          ? raw["imageUrl"]
          : null,
    allergens: Array.isArray(raw["allergens"])
      ? (raw["allergens"] as unknown[]).filter((a): a is string => typeof a === "string")
      : [],
    modifier_ids: readModifierIds(raw),
    modifier_config: readModifierConfig(raw),
  };
}

export function normalizeMenuVariant(id: string, raw: RawMap): MenuVariant {
  return {
    id,
    menu_item_id: readMenuItemId(raw),
    name: String(raw["name"] ?? ""),
    price_delta: Number(raw["price_delta"] ?? raw["priceDelta"] ?? 0),
    is_default: raw["is_default"] === true || raw["isDefault"] === true,
    is_available: raw["is_available"] !== false && raw["isAvailable"] !== false,
    sort_order:
      typeof raw["sort_order"] === "number"
        ? raw["sort_order"]
        : typeof raw["sortOrder"] === "number"
          ? raw["sortOrder"]
          : undefined,
  };
}

export function normalizeMenuAddon(id: string, raw: RawMap): MenuAddon {
  return {
    id,
    menu_item_id: readMenuItemId(raw),
    name: String(raw["name"] ?? ""),
    price: Number(raw["price"] ?? 0),
    max_quantity: Math.max(
      1,
      Number(raw["max_quantity"] ?? raw["maxQuantity"] ?? 3) || 3,
    ),
    is_available: raw["is_available"] !== false && raw["isAvailable"] !== false,
  };
}

export function normalizeMenuModifier(id: string, raw: RawMap, restaurantId: string): MenuModifier {
  const choicesRaw = Array.isArray(raw["choices"]) ? raw["choices"] : [];
  const choices: MenuModifierChoice[] = choicesRaw.map((c) => {
    const row = (c ?? {}) as RawMap;
    return {
      label: String(row["label"] ?? ""),
      price: Number(row["price"] ?? 0),
    };
  });
  const type = raw["type"] === "extra" ? "extra" : "option";
  return {
    id,
    restaurant_id: String(raw["restaurant_id"] ?? raw["restaurantId"] ?? restaurantId),
    name: String(raw["name"] ?? ""),
    type,
    required: raw["required"] === true,
    include_pricing:
      raw["include_pricing"] === true ||
      raw["includePricing"] === true,
    min_selections: Number(raw["min_selections"] ?? raw["minSelections"] ?? (type === "option" ? 1 : 0)),
    max_selections: Number(raw["max_selections"] ?? raw["maxSelections"] ?? (type === "option" ? 1 : 3)),
    choices,
    sort_order: Number(raw["sort_order"] ?? raw["sortOrder"] ?? 0),
    is_available: raw["is_available"] !== false && raw["isAvailable"] !== false,
  };
}

/** Variants linked to a product — accepts snake_case and camelCase menu_item_id. */
export function variantsForMenuItem(variants: MenuVariant[], itemId: string): MenuVariant[] {
  return variants
    .filter((v) => v.menu_item_id === itemId)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/** Add-ons linked to a product. */
export function addonsForMenuItem(addons: MenuAddon[], itemId: string): MenuAddon[] {
  return addons.filter((a) => a.menu_item_id === itemId);
}

/** Modifier groups assigned to a product. */
export function modifiersForMenuItem(modifiers: MenuModifier[], item: MenuItem): MenuModifier[] {
  const ids = new Set(item.modifier_ids);
  return modifiers.filter((m) => ids.has(m.id)).sort((a, b) => a.sort_order - b.sort_order);
}

function mapRecord<T>(
  data: Record<string, RawMap> | null,
  mapFn: (id: string, raw: RawMap) => T,
): T[] {
  if (!data) return [];
  return Object.entries(data).map(([id, raw]) => mapFn(id, raw ?? {}));
}

function collect(
  restaurantId: string,
  cats: Record<string, RawMap> | null,
  its: Record<string, RawMap> | null,
  vars: Record<string, RawMap> | null,
  adds: Record<string, RawMap> | null,
  mods: Record<string, RawMap> | null,
): MenuPayload {
  return {
    categories: mapRecord(cats, (id, raw) => ({
      id,
      restaurant_id: String(raw["restaurant_id"] ?? restaurantId),
      name: String(raw["name"] ?? ""),
      description: typeof raw["description"] === "string" ? raw["description"] : null,
      sort_order: Number(raw["sort_order"] ?? 0),
      is_available: raw["is_available"] !== false,
    })).sort((a, b) => a.sort_order - b.sort_order),
    items: mapRecord(its, (id, raw) => normalizeMenuItem(id, raw, restaurantId)),
    variants: mapRecord(vars, (id, raw) => normalizeMenuVariant(id, raw)),
    addons: mapRecord(adds, (id, raw) => normalizeMenuAddon(id, raw)),
    modifiers: mapRecord(mods, (id, raw) => normalizeMenuModifier(id, raw, restaurantId)).sort(
      (a, b) => a.sort_order - b.sort_order,
    ),
  };
}

export async function getFirebaseMenu(restaurant: FirebaseRestaurant): Promise<MenuPayload> {
  if (!isFirebaseAvailable()) return EMPTY;
  const [cats, its, vars, adds, mods] = await Promise.all([
    rtdbGet<Record<string, RawMap>>(base(restaurant.id, "categories")),
    rtdbGet<Record<string, RawMap>>(base(restaurant.id, "items")),
    rtdbGet<Record<string, RawMap>>(base(restaurant.id, "variants")),
    rtdbGet<Record<string, RawMap>>(base(restaurant.id, "addons")),
    rtdbGet<Record<string, RawMap>>(base(restaurant.id, "modifiers")),
  ]);
  return collect(restaurant.id, cats, its, vars, adds, mods);
}

export function subscribeFirebaseMenu(
  restaurantId: string,
  cb: (p: MenuPayload) => void,
): () => void {
  if (!isFirebaseAvailable()) {
    cb(EMPTY);
    return () => {};
  }
  let cats: Record<string, RawMap> | null = null;
  let its: Record<string, RawMap> | null = null;
  let vars: Record<string, RawMap> | null = null;
  let adds: Record<string, RawMap> | null = null;
  let mods: Record<string, RawMap> | null = null;
  const emit = () => {
    if (!cats && !its && !vars && !adds && !mods) return;
    cb(collect(restaurantId, cats, its, vars, adds, mods));
  };
  const u1 = rtdbSubscribe<Record<string, RawMap>>(base(restaurantId, "categories"), (v) => {
    cats = v;
    emit();
  });
  const u2 = rtdbSubscribe<Record<string, RawMap>>(base(restaurantId, "items"), (v) => {
    its = v;
    emit();
  });
  const u3 = rtdbSubscribe<Record<string, RawMap>>(base(restaurantId, "variants"), (v) => {
    vars = v;
    emit();
  });
  const u4 = rtdbSubscribe<Record<string, RawMap>>(base(restaurantId, "addons"), (v) => {
    adds = v;
    emit();
  });
  const u5 = rtdbSubscribe<Record<string, RawMap>>(base(restaurantId, "modifiers"), (v) => {
    mods = v;
    emit();
  });
  return () => {
    u1();
    u2();
    u3();
    u4();
    u5();
  };
}

// --- Mutations ---

export async function saveFirebaseCategory(
  input: Partial<MenuCategory> & { restaurant_id: string; name: string },
) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const id = input.id ?? uid("cat");
  const all =
    (await rtdbGet<Record<string, MenuCategory>>(base(input.restaurant_id, "categories"))) ?? {};
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
  const items = (await rtdbGet<Record<string, MenuItem>>(base(input.restaurant_id, "items"))) ?? {};
  for (const [iid, item] of Object.entries(items)) {
    if (item.category_id === input.id) {
      await rtdbSet(`${base(input.restaurant_id, "items")}/${iid}/category_id`, null);
    }
  }
  await rtdbSet(`${base(input.restaurant_id, "categories")}/${input.id}`, null);
  return { ok: true };
}

export async function saveFirebaseMenuItem(
  input: Partial<MenuItem> & {
    restaurant_id: string;
    name: string;
    price: number;
    category_id: string | null;
    category: string;
  },
) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const id = input.id ?? uid("itm");
  const all = (await rtdbGet<Record<string, RawMap>>(base(input.restaurant_id, "items"))) ?? {};
  const existing = all[id] ? normalizeMenuItem(id, all[id]!, input.restaurant_id) : null;
  const modifierIds = input.modifier_ids ?? existing?.modifier_ids ?? [];
  const modifierConfig = input.modifier_config ?? existing?.modifier_config ?? {};
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
    points_value: Math.max(
      0,
      Math.round(Number(input.points_value ?? existing?.points_value ?? 5)),
    ),
    is_available: input.is_available ?? existing?.is_available ?? true,
    is_featured: input.is_featured ?? existing?.is_featured ?? false,
    image_url: input.image_url ?? existing?.image_url ?? null,
    allergens: input.allergens ?? existing?.allergens ?? [],
    modifier_ids: modifierIds,
    modifier_config: modifierConfig,
  };
  // Write snake_case + camelCase aliases for cross-app compatibility.
  await rtdbSet(`${base(input.restaurant_id, "items")}/${id}`, {
    ...record,
    modifierIds: modifierIds,
    modifierConfig: modifierConfig,
  });
  return { id };
}

export async function deleteFirebaseMenuItem(input: { restaurant_id: string; id: string }) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const vars =
    (await rtdbGet<Record<string, MenuVariant>>(base(input.restaurant_id, "variants"))) ?? {};
  for (const [vid, variant] of Object.entries(vars)) {
    if (variant.menu_item_id === input.id) {
      await rtdbSet(`${base(input.restaurant_id, "variants")}/${vid}`, null);
    }
  }
  const adds =
    (await rtdbGet<Record<string, MenuAddon>>(base(input.restaurant_id, "addons"))) ?? {};
  for (const [aid, addon] of Object.entries(adds)) {
    if (addon.menu_item_id === input.id) {
      await rtdbSet(`${base(input.restaurant_id, "addons")}/${aid}`, null);
    }
  }
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

export async function saveFirebaseVariant(
  input: Partial<MenuVariant> & {
    menu_item_id: string;
    restaurant_id: string;
    name: string;
    price_delta: number;
  },
) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const id = input.id ?? uid("var");
  const all =
    (await rtdbGet<Record<string, MenuVariant>>(base(input.restaurant_id, "variants"))) ?? {};
  const existing = all[id];
  const record: MenuVariant = {
    id,
    menu_item_id: input.menu_item_id,
    name: input.name,
    price_delta: input.price_delta,
    is_default: input.is_default ?? existing?.is_default ?? false,
    is_available: input.is_available ?? existing?.is_available ?? true,
    sort_order:
      existing?.sort_order ??
      Object.values(all).filter((v) => v.menu_item_id === input.menu_item_id).length,
  };
  await rtdbSet(`${base(input.restaurant_id, "variants")}/${id}`, {
    ...record,
    menuItemId: record.menu_item_id,
    priceDelta: record.price_delta,
    isDefault: record.is_default,
    isAvailable: record.is_available,
  });
  return { id };
}

export async function saveFirebaseAddon(
  input: Partial<MenuAddon> & {
    menu_item_id: string;
    restaurant_id: string;
    name: string;
    price: number;
  },
) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const id = input.id ?? uid("add");
  const existing = (await rtdbGet<Record<string, MenuAddon>>(base(input.restaurant_id, "addons")))?.[
    id
  ];
  const record: MenuAddon = {
    id,
    menu_item_id: input.menu_item_id,
    name: input.name,
    price: input.price,
    max_quantity: input.max_quantity ?? existing?.max_quantity ?? 3,
    is_available: input.is_available ?? existing?.is_available ?? true,
  };
  await rtdbSet(`${base(input.restaurant_id, "addons")}/${id}`, {
    ...record,
    menuItemId: record.menu_item_id,
    maxQuantity: record.max_quantity,
    isAvailable: record.is_available,
  });
  return { id };
}

export async function saveFirebaseModifier(
  input: Partial<MenuModifier> & {
    restaurant_id: string;
    name: string;
    type: "option" | "extra";
    choices: MenuModifierChoice[];
  },
) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const id = input.id ?? uid("mod");
  const all =
    (await rtdbGet<Record<string, RawMap>>(base(input.restaurant_id, "modifiers"))) ?? {};
  const existing = all[id]
    ? normalizeMenuModifier(id, all[id]!, input.restaurant_id)
    : null;
  const includePricing = input.include_pricing ?? existing?.include_pricing ?? false;
  const record: MenuModifier = {
    id,
    restaurant_id: input.restaurant_id,
    name: input.name.trim(),
    type: input.type,
    required: input.required ?? existing?.required ?? input.type === "option",
    include_pricing: includePricing,
    min_selections:
      input.min_selections ??
      existing?.min_selections ??
      (input.type === "option" ? 1 : 0),
    max_selections:
      input.max_selections ??
      existing?.max_selections ??
      (input.type === "option" ? 1 : 3),
    choices: input.choices.map((c) => ({
      label: c.label.trim(),
      price: includePricing ? Number(c.price) || 0 : 0,
    })),
    sort_order: input.sort_order ?? existing?.sort_order ?? Object.keys(all).length,
    is_available: input.is_available ?? existing?.is_available ?? true,
  };
  await rtdbSet(`${base(input.restaurant_id, "modifiers")}/${id}`, {
    ...record,
    includePricing: record.include_pricing,
    minSelections: record.min_selections,
    maxSelections: record.max_selections,
  });
  return { id };
}

export async function deleteFirebaseMenuChild(input: {
  restaurant_id: string;
  id: string;
  kind: "variant" | "addon" | "modifier";
}) {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const kindPath =
    input.kind === "variant" ? "variants" : input.kind === "addon" ? "addons" : "modifiers";
  await rtdbSet(`${base(input.restaurant_id, kindPath)}/${input.id}`, null);
  return { ok: true };
}
