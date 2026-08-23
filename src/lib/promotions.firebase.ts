// Firebase-backed Promotions & Loyalty library.
//
// Unified storage for BOTH classic promo-code discounts AND the Points &
// Rewards loyalty programme. Lives under `/promotions` in RTDB so the
// customer app can subscribe to both in one place.
//
// Data shape:
//   /promotions/global/points_config     -> GlobalPointsConfig   (loyalty defaults)
//   /promotions/codes/{promoId}          -> PromoCampaign       (coupon/promo)
//   /promotions/restaurant_points/{rid}  -> RestaurantPointsOverride (optional per-restaurant)
//
// The customer app subscribes to all three and merges them per order.

import {
  isFirebaseAvailable,
  rtdbGet,
  rtdbSet,
  rtdbSubscribe,
  type RTDBValue,
} from "@/lib/firebase";

/* -------------------------------------------------------------- types -- */

export type PromoType = "percent" | "fixed" | "free_delivery" | "bogo";
export type PromoScope = "platform" | "restaurant" | "first_order";

export interface PromoCampaign {
  id: string;
  code: string; // uppercase, unique e.g. "WELCOME20"
  name: string;
  description: string | null;
  type: PromoType;
  value: number; // % or ZAR (ignored for free_delivery/bogo)
  scope: PromoScope;
  /** Legacy single-restaurant field — kept for backward compatibility with
   *  records saved before multi-select. Writes set it only when exactly one
   *  restaurant is selected; new code should read via promoRestaurantIds(). */
  restaurant_id: string | null;
  /** Restaurants this coupon applies to when scope === "restaurant".
   *  null/[] otherwise. */
  restaurant_ids: string[] | null;
  min_order: number;
  max_discount: number | null;
  usage_limit: number | null;
  usage_count: number;
  starts_at: string; // ISO
  expires_at: string; // ISO
  is_active: boolean;
  applies_to: "all" | "orders" | "delivery" | "items";
  created_at: string;
  updated_at: string;
  created_by: string | null;
  [key: string]: string | number | boolean | null | undefined | string[];
}

export interface GlobalPointsConfig {
  enabled: boolean;
  method: "none" | "per_order" | "per_item" | "both";
  points_per_order: number;
  points_per_item_default: number;
  redemption_enabled: boolean;
  points_required: number;
  discount_percent: number;
  updated_at: string;
  updated_by: string | null;
}

/** Restaurants can override the global points earning/redemption rules,
 *  or opt out entirely. Any field left null falls back to the global. */
export interface RestaurantPointsOverride {
  restaurant_id: string;
  enabled: boolean; // false opts this restaurant out of rewards
  method: "none" | "per_order" | "per_item" | "both" | null;
  points_per_order: number | null;
  points_per_item_default: number | null;
  redemption_enabled: boolean | null;
  points_required: number | null;
  discount_percent: number | null;
  updated_at: string;
  updated_by: string | null;
}

export const DEFAULT_POINTS_CONFIG: GlobalPointsConfig = {
  enabled: false,
  method: "both",
  points_per_order: 10,
  points_per_item_default: 5,
  redemption_enabled: false,
  points_required: 500,
  discount_percent: 10,
  updated_at: new Date(0).toISOString(),
  updated_by: null,
};

const w = (v: unknown): RTDBValue => v as RTDBValue;
function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}
function now() {
  return new Date().toISOString();
}

/* --------------------------------------------------------- global cfg -- */

const GLOBAL_PATH = "promotions/global/points_config";

export async function getGlobalPointsConfig(): Promise<GlobalPointsConfig> {
  if (!isFirebaseAvailable()) return DEFAULT_POINTS_CONFIG;
  const snap = await rtdbGet<GlobalPointsConfig>(GLOBAL_PATH);
  if (!snap) {
    await rtdbSet(GLOBAL_PATH, w(DEFAULT_POINTS_CONFIG));
    return DEFAULT_POINTS_CONFIG;
  }
  return { ...DEFAULT_POINTS_CONFIG, ...snap };
}

export function subscribeGlobalPointsConfig(cb: (cfg: GlobalPointsConfig) => void): () => void {
  if (!isFirebaseAvailable()) {
    cb(DEFAULT_POINTS_CONFIG);
    return () => {};
  }
  let seeded = false;
  return rtdbSubscribe<GlobalPointsConfig>(GLOBAL_PATH, async (v) => {
    if (!v && !seeded) {
      seeded = true;
      try {
        await rtdbSet(GLOBAL_PATH, w(DEFAULT_POINTS_CONFIG));
      } catch {
        /* ignore */
      }
      cb(DEFAULT_POINTS_CONFIG);
      return;
    }
    cb(v ? { ...DEFAULT_POINTS_CONFIG, ...v } : DEFAULT_POINTS_CONFIG);
  });
}

export async function saveGlobalPointsConfig(
  patch: Partial<Omit<GlobalPointsConfig, "updated_at">>,
  actor?: string | null,
): Promise<GlobalPointsConfig> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const current = await getGlobalPointsConfig();
  const next: GlobalPointsConfig = {
    ...current,
    ...patch,
    points_per_order: Math.max(
      0,
      Math.round(Number(patch.points_per_order ?? current.points_per_order) || 0),
    ),
    points_per_item_default: Math.max(
      0,
      Math.round(Number(patch.points_per_item_default ?? current.points_per_item_default) || 0),
    ),
    points_required: Math.max(
      1,
      Math.round(Number(patch.points_required ?? current.points_required) || 1),
    ),
    discount_percent: Math.min(
      100,
      Math.max(0, Number(patch.discount_percent ?? current.discount_percent) || 0),
    ),
    updated_at: now(),
    updated_by: actor ?? null,
  };
  if (!next.enabled) next.redemption_enabled = false;
  await rtdbSet(GLOBAL_PATH, w(next));
  return next;
}

/* ---------------------------------------------------- promo campaigns -- */

const PROMOS_PATH = "promotions/codes";

function promoPath(id?: string) {
  return id ? `${PROMOS_PATH}/${id}` : PROMOS_PATH;
}

export async function listPromoCampaigns(): Promise<PromoCampaign[]> {
  if (!isFirebaseAvailable()) return [];
  const snap = await rtdbGet<Record<string, PromoCampaign>>(PROMOS_PATH);
  if (!snap) return [];
  return Object.values(snap).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function subscribePromoCampaigns(cb: (list: PromoCampaign[]) => void): () => void {
  if (!isFirebaseAvailable()) {
    cb([]);
    return () => {};
  }
  return rtdbSubscribe<Record<string, PromoCampaign>>(PROMOS_PATH, (v) => {
    cb(v ? Object.values(v).sort((a, b) => b.created_at.localeCompare(a.created_at)) : []);
  });
}

/** Restaurants a coupon applies to (scope === "restaurant"), tolerating
 *  legacy records that only carry the single `restaurant_id` field. */
export function promoRestaurantIds(
  p: Pick<PromoCampaign, "scope"> & Partial<PromoCampaign>,
): string[] {
  if (p.scope !== "restaurant") return [];
  if (Array.isArray(p.restaurant_ids)) return p.restaurant_ids;
  return p.restaurant_id ? [p.restaurant_id] : [];
}

export async function savePromoCampaign(
  input: Partial<PromoCampaign> &
    Pick<PromoCampaign, "code" | "name" | "type" | "scope" | "starts_at" | "expires_at">,
): Promise<{ id: string }> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const id = input.id ?? uid("pro");
  const all = (await rtdbGet<Record<string, PromoCampaign>>(PROMOS_PATH)) ?? {};
  // Enforce uppercase + unique code
  const code = input.code.trim().toUpperCase();
  const duplicate = Object.values(all).find((p) => p.code === code && p.id !== id);
  if (duplicate) throw new Error(`A promo with code "${code}" already exists.`);
  const existing = all[id];
  const ts = now();
  // Build the restaurant allow-list for scope === "restaurant". The editor
  // sends `restaurant_ids` (multi-select); legacy payloads may send only the
  // single `restaurant_id`, and edits that don't touch the list inherit it.
  const scopedIds =
    input.scope === "restaurant"
      ? Array.from(
          new Set(
            input.restaurant_ids ??
              (input.restaurant_id
                ? [input.restaurant_id]
                : existing
                  ? promoRestaurantIds(existing)
                  : []),
          ),
        ).sort()
      : null;
  if (input.scope === "restaurant" && (!scopedIds || scopedIds.length === 0)) {
    throw new Error(
      'Check at least one restaurant this coupon applies to, or use scope "All restaurants".',
    );
  }
  const record: PromoCampaign = {
    id,
    code,
    name: input.name,
    description: input.description ?? existing?.description ?? null,
    type: input.type,
    value: Math.max(0, Number(input.value ?? existing?.value ?? 0)),
    scope: input.scope,
    // Keep the legacy single field in sync for old readers: exact id when
    // exactly one restaurant is selected, otherwise null.
    restaurant_id: scopedIds && scopedIds.length === 1 ? scopedIds[0]! : null,
    restaurant_ids: scopedIds,
    min_order: Math.max(0, Number(input.min_order ?? existing?.min_order ?? 0)),
    max_discount:
      input.max_discount == null
        ? (existing?.max_discount ?? null)
        : Number(input.max_discount) || null,
    usage_limit:
      input.usage_limit == null
        ? (existing?.usage_limit ?? null)
        : Number(input.usage_limit) || null,
    usage_count: existing?.usage_count ?? 0,
    starts_at: input.starts_at,
    expires_at: input.expires_at,
    is_active: input.is_active ?? existing?.is_active ?? true,
    applies_to: input.applies_to ?? existing?.applies_to ?? "all",
    created_at: existing?.created_at ?? ts,
    updated_at: ts,
    created_by: existing?.created_by ?? null,
  };
  await rtdbSet(promoPath(id), w(record));
  return { id };
}

export async function togglePromoCampaign(id: string, isActive: boolean): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const all = (await rtdbGet<Record<string, PromoCampaign>>(PROMOS_PATH)) ?? {};
  const p = all[id];
  if (!p) throw new Error("Promo not found");
  await rtdbSet(promoPath(id), w({ ...p, is_active: isActive, updated_at: now() }));
}

export async function deletePromoCampaign(id: string): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  await rtdbSet(promoPath(id), null);
}

/* ------------------------------------------- per-restaurant overrides -- */

const REST_POINTS_PATH = "promotions/restaurant_points";
function restPath(id?: string) {
  return id ? `${REST_POINTS_PATH}/${id}` : REST_POINTS_PATH;
}

export async function getRestaurantPointsOverride(
  restaurantId: string,
): Promise<RestaurantPointsOverride | null> {
  if (!isFirebaseAvailable()) return null;
  return rtdbGet<RestaurantPointsOverride>(restPath(restaurantId));
}

export async function listRestaurantPointsOverrides(): Promise<RestaurantPointsOverride[]> {
  if (!isFirebaseAvailable()) return [];
  const snap = await rtdbGet<Record<string, RestaurantPointsOverride>>(REST_POINTS_PATH);
  return snap ? Object.values(snap) : [];
}

/** Live-subscribe to one restaurant's override (null when none exists). */
export function subscribeRestaurantPointsOverride(
  restaurantId: string,
  cb: (row: RestaurantPointsOverride | null) => void,
): () => void {
  if (!isFirebaseAvailable()) {
    cb(null);
    return () => {};
  }
  return rtdbSubscribe<RestaurantPointsOverride>(restPath(restaurantId), (v) => cb(v ?? null));
}

export function subscribeRestaurantPointsOverrides(
  cb: (rows: RestaurantPointsOverride[]) => void,
): () => void {
  if (!isFirebaseAvailable()) {
    cb([]);
    return () => {};
  }
  return rtdbSubscribe<Record<string, RestaurantPointsOverride>>(REST_POINTS_PATH, (v) => {
    cb(v ? Object.values(v) : []);
  });
}

export async function saveRestaurantPointsOverride(
  input: Partial<Omit<RestaurantPointsOverride, "enabled" | "redemption_enabled">> & {
    restaurant_id: string;
    enabled?: boolean | null | undefined;
    redemption_enabled?: boolean | null | undefined;
  },
): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const existing = await getRestaurantPointsOverride(input.restaurant_id);
  const toBool = (v: boolean | null | undefined): boolean | null => {
    if (v === undefined) return existing?.redemption_enabled ?? null;
    return v == null ? null : Boolean(v);
  };
  const toEnabled = (v: boolean | null | undefined): boolean => {
    if (v === undefined || v === null) return existing?.enabled ?? true;
    return Boolean(v);
  };
  const record: RestaurantPointsOverride = {
    restaurant_id: input.restaurant_id,
    enabled: toEnabled(input.enabled),
    method: input.method === undefined ? (existing?.method ?? null) : (input.method ?? null),
    points_per_order:
      input.points_per_order === undefined
        ? (existing?.points_per_order ?? null)
        : input.points_per_order == null
          ? null
          : Math.max(0, Math.round(Number(input.points_per_order) || 0)),
    points_per_item_default:
      input.points_per_item_default === undefined
        ? (existing?.points_per_item_default ?? null)
        : input.points_per_item_default == null
          ? null
          : Math.max(0, Math.round(Number(input.points_per_item_default) || 0)),
    redemption_enabled: toBool(input.redemption_enabled),
    points_required:
      input.points_required === undefined
        ? (existing?.points_required ?? null)
        : input.points_required == null
          ? null
          : Math.max(1, Math.round(Number(input.points_required) || 1)),
    discount_percent:
      input.discount_percent === undefined
        ? (existing?.discount_percent ?? null)
        : input.discount_percent == null
          ? null
          : Math.min(100, Math.max(0, Number(input.discount_percent) || 0)),
    updated_at: now(),
    updated_by: input.updated_by ?? null,
  };
  // If everything is null / default, prune the record so globals apply cleanly.
  const allDefault =
    record.enabled === true &&
    record.method === null &&
    record.points_per_order === null &&
    record.points_per_item_default === null &&
    record.redemption_enabled === null &&
    record.points_required === null &&
    record.discount_percent === null;
  if (allDefault && !existing) return; // nothing to save
  if (allDefault) {
    await rtdbSet(restPath(input.restaurant_id), null);
    return;
  }
  await rtdbSet(restPath(input.restaurant_id), w(record));
}

export async function deleteRestaurantPointsOverride(restaurantId: string): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  await rtdbSet(restPath(restaurantId), null);
}

/** Resolve the effective points config for a specific restaurant by merging
 *  the global defaults with any per-restaurant override. Customer app uses
 *  this exact merge so behaviour is deterministic. */
export function resolveEffectivePointsConfig(
  global: GlobalPointsConfig,
  override: RestaurantPointsOverride | null,
): GlobalPointsConfig & { rewards_disabled_for_restaurant: boolean } {
  if (!override) {
    return { ...global, rewards_disabled_for_restaurant: false };
  }
  return {
    enabled: global.enabled && override.enabled,
    method: override.method ?? global.method,
    points_per_order: override.points_per_order ?? global.points_per_order,
    points_per_item_default: override.points_per_item_default ?? global.points_per_item_default,
    redemption_enabled:
      global.redemption_enabled &&
      override.redemption_enabled !== false &&
      (override.redemption_enabled === true || global.redemption_enabled),
    points_required: override.points_required ?? global.points_required,
    discount_percent: override.discount_percent ?? global.discount_percent,
    updated_at: override.updated_at ?? global.updated_at,
    updated_by: override.updated_by ?? global.updated_by,
    rewards_disabled_for_restaurant: !override.enabled,
  };
}

/* ------------------------------------------------------- combo deals -- */

export type ComboKind = "bundle" | "multibuy";
export type ComboDiscountType = "percent" | "fixed";

/** A combo deal belongs to ONE restaurant and comes in two kinds:
 *
 *  - "bundle":   a named set of *different* menu items. Buying the bundle
 *                gives a discount off its total — a percentage or a fixed
 *                rand amount (discount_type/discount_value).
 *  - "multibuy": several units of the *same* menu item. The customer gets
 *                `buy_qty` items but only pays for `pay_qty` (e.g. 3 for 2,
 *                item_ids holds the single item).
 *
 * Records saved before kinds existed default to "bundle". */
export interface ComboDeal {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  kind: ComboKind;
  item_ids: string[]; // bundle: 2+ items · multibuy: exactly 1 item
  discount_type: ComboDiscountType | null; // bundle only
  discount_value: number | null; // bundle only
  buy_qty: number | null; // multibuy only: units the customer receives
  pay_qty: number | null; // multibuy only: units the customer pays for
  is_active: boolean;
  starts_at: string; // ISO
  expires_at: string; // ISO
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

/** Kind of a deal, tolerating legacy records that predate the field. */
export function comboKind(deal: Pick<ComboDeal, "kind">): ComboKind {
  return deal.kind === "multibuy" ? "multibuy" : "bundle";
}

const COMBOS_PATH = "promotions/combos";
const comboPath = (id?: string) => (id ? `${COMBOS_PATH}/${id}` : COMBOS_PATH);

export async function listComboDeals(): Promise<ComboDeal[]> {
  if (!isFirebaseAvailable()) return [];
  const snap = await rtdbGet<Record<string, ComboDeal>>(COMBOS_PATH);
  if (!snap) return [];
  return Object.values(snap).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function subscribeComboDeals(cb: (list: ComboDeal[]) => void): () => void {
  if (!isFirebaseAvailable()) {
    cb([]);
    return () => {};
  }
  return rtdbSubscribe<Record<string, ComboDeal>>(COMBOS_PATH, (v) => {
    cb(v ? Object.values(v).sort((a, b) => b.created_at.localeCompare(a.created_at)) : []);
  });
}

export async function saveComboDeal(
  input: Partial<ComboDeal> & Pick<ComboDeal, "restaurant_id" | "name" | "item_ids">,
): Promise<{ id: string }> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const id = input.id ?? uid("cmb");
  const all = (await rtdbGet<Record<string, ComboDeal>>(COMBOS_PATH)) ?? {};
  const existing = all[id];
  const kind: ComboKind = input.kind ?? existing?.kind ?? "bundle";
  const itemIds = Array.from(new Set((input.item_ids ?? []).filter(Boolean)));
  if (!input.name.trim()) throw new Error("Combo name is required");

  let discountType: ComboDiscountType | null = null;
  let discountValue: number | null = null;
  let buyQty: number | null = null;
  let payQty: number | null = null;

  if (kind === "multibuy") {
    // --- N of the same item for the price of M ---
    if (itemIds.length !== 1) {
      throw new Error("Pick the one menu item this multi-buy deal applies to");
    }
    buyQty = Math.floor(Number(input.buy_qty ?? existing?.buy_qty ?? NaN));
    payQty = Math.floor(Number(input.pay_qty ?? existing?.pay_qty ?? NaN));
    if (!Number.isInteger(buyQty) || buyQty < 2) {
      throw new Error("The customer must receive at least 2 items");
    }
    if (!Number.isInteger(payQty) || payQty < 1 || payQty >= buyQty) {
      throw new Error('"Pay for" must be at least 1 and less than the quantity the customer gets');
    }
  } else {
    // --- different items bundled at a discount ---
    if (itemIds.length < 2) throw new Error("A bundle needs at least two menu items");
    discountType = input.discount_type ?? existing?.discount_type ?? "percent";
    discountValue = Number(input.discount_value ?? existing?.discount_value);
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      throw new Error("Discount must be greater than zero");
    }
    if (discountType === "percent" && discountValue > 100) {
      throw new Error("Percent discount cannot exceed 100");
    }
  }

  const ts = now();
  const record: ComboDeal = {
    id,
    restaurant_id: input.restaurant_id,
    name: input.name.trim(),
    description: input.description ?? existing?.description ?? null,
    kind,
    item_ids: itemIds,
    discount_type: discountType,
    discount_value: discountValue,
    buy_qty: buyQty,
    pay_qty: payQty,
    is_active: input.is_active ?? existing?.is_active ?? true,
    starts_at: input.starts_at ?? existing?.starts_at ?? ts,
    expires_at:
      input.expires_at ?? existing?.expires_at ?? new Date(Date.now() + 90 * 864e5).toISOString(),
    created_at: existing?.created_at ?? ts,
    updated_at: ts,
  };
  await rtdbSet(comboPath(id), w(record));
  return { id };
}

export async function toggleComboDeal(id: string, isActive: boolean): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const existing = (await rtdbGet<Record<string, ComboDeal>>(COMBOS_PATH))?.[id];
  if (!existing) throw new Error("Combo deal not found");
  await rtdbSet(comboPath(id), w({ ...existing, is_active: isActive, updated_at: now() }));
}

export async function deleteComboDeal(id: string): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  await rtdbSet(comboPath(id), null);
}

/** Bundle price math: given the bundle subtotal, returns the discount and
 *  the final price customers pay. */
export function comboPricing(
  subtotal: number,
  deal: { discount_type: ComboDiscountType | null; discount_value: number | null },
): { discount: number; final: number } {
  const value = Number(deal.discount_value) || 0;
  const off =
    deal.discount_type === "fixed"
      ? Math.max(0, value)
      : subtotal * (Math.min(100, Math.max(0, value)) / 100);
  const discount = Math.min(subtotal, off);
  return { discount, final: subtotal - discount };
}

/** Multi-buy price math: `buyQty` units at `unitPrice`, paying for `payQty`.
 *  e.g. 3× a R50 item paying for 2 → subtotal 150, final 100, save 50. */
export function multibuyPricing(
  unitPrice: number,
  buyQty: number,
  payQty: number,
): { subtotal: number; final: number; discount: number; freeQty: number } {
  const buy = Math.max(0, Math.floor(buyQty));
  const pay = Math.max(0, Math.floor(payQty));
  const subtotal = buy * unitPrice;
  const final = Math.min(buy, pay) * unitPrice;
  return {
    subtotal,
    final,
    discount: subtotal - final,
    freeQty: Math.max(0, buy - pay),
  };
}

/** One-line label for a deal: "3 for 2" (multibuy) or "-15%" / "R 20 off" (bundle). */
export function comboDealLabel(
  deal: Pick<ComboDeal, "kind" | "buy_qty" | "pay_qty" | "discount_type" | "discount_value">,
): string {
  if (comboKind(deal) === "multibuy") {
    return `${deal.buy_qty ?? "?"} for ${deal.pay_qty ?? "?"}`;
  }
  return comboDiscountLabel(deal);
}

/** One-line label for a bundle's discount, e.g. "-15%" or "R 20 off". */
export function comboDiscountLabel(
  deal: Pick<ComboDeal, "discount_type" | "discount_value">,
): string {
  const value = Number(deal.discount_value) || 0;
  return deal.discount_type === "fixed" ? `R ${value} off` : `-${value}%`;
}
