// Firebase-backed restaurant data layer.
// The "Restaurants" menu reads/writes to Firebase Realtime Database under
// `/restaurants`. All other modules still use the local demo store so the
// rest of the app is untouched.
//
// On first launch in a browser, if the `/restaurants` node is empty we seed
// three starter restaurants with distinct Unsplash cover images.

import { isFirebaseAvailable, rtdbGet, rtdbSet, rtdbSubscribe } from "@/lib/firebase";

export type RestaurantStatus = "approved" | "pending" | "suspended" | "rejected";

export interface DeliveryTier {
  id: string;
  up_to_km: number;
  fee: number;
  label?: string | null;
  [key: string]: string | number | boolean | null | undefined;
}

export interface FirebaseRestaurant {
  id: string;
  name: string;
  slug: string;
  cuisine: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string;
  country: string;
  currency: string;
  status: RestaurantStatus;
  commission_rate: number;
  delivery_enabled: boolean;
  pickup_enabled: boolean;
  delivery_radius_km: number;
  delivery_tiers: DeliveryTier[];
  rating: number;
  rating_count: number;
  prep_time_minutes: number;
  opens_at: string;
  closes_at: string;
  latitude: number | null;
  longitude: number | null;
  image_url: string | null;
  created_at: string;
  // Index signature so the record satisfies RTDBValue
  [key: string]: string | number | boolean | null | undefined | DeliveryTier[];
}

const RESTAURANTS_PATH = "restaurants";

// Three curated demo restaurants with different Unsplash cover images.
// (Images load from images.unsplash.com with fixed sizes so they're
// fast and reliable for the UI.)
const SEED_RESTAURANTS: FirebaseRestaurant[] = [
  {
    id: "rst-nonna",
    name: "Nonna's Trattoria",
    slug: "nonnas-trattoria",
    cuisine: "Italian",
    email: "bookings@nonnas.co.za",
    phone: "+27 11 447 2200",
    address: "144 Jan Smuts Ave, Parkwood",
    city: "Johannesburg",
    country: "ZA",
    currency: "ZAR",
    status: "approved",
    commission_rate: 18,
    delivery_enabled: true,
    pickup_enabled: true,
    delivery_radius_km: 7,
    delivery_tiers: defaultTiersFor(7),
    rating: 4.7,
    rating_count: 1284,
    prep_time_minutes: 22,
    opens_at: "11:00",
    closes_at: "22:30",
    latitude: -26.1662,
    longitude: 28.0273,
    image_url:
      "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=900&q=70",
    created_at: "2025-01-12T09:00:00.000Z",
  },
  {
    id: "rst-braaishop",
    name: "Braai Shop Co.",
    slug: "braai-shop-co",
    cuisine: "Grill",
    email: "orders@braaishop.co.za",
    phone: "+27 21 201 3344",
    address: "88 Kloof Street, Gardens",
    city: "Cape Town",
    country: "ZA",
    currency: "ZAR",
    status: "approved",
    commission_rate: 15,
    delivery_enabled: true,
    pickup_enabled: true,
    delivery_radius_km: 9,
    delivery_tiers: defaultTiersFor(9),
    rating: 4.5,
    rating_count: 812,
    prep_time_minutes: 18,
    opens_at: "12:00",
    closes_at: "23:00",
    latitude: -33.9275,
    longitude: 18.4098,
    image_url:
      "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=900&q=70",
    created_at: "2025-02-04T11:30:00.000Z",
  },
  {
    id: "rst-ramen",
    name: "Golden Ramen Bar",
    slug: "golden-ramen-bar",
    cuisine: "Japanese",
    email: "hello@goldenramen.co.za",
    phone: "+27 31 561 8877",
    address: "22 Florida Road, Morningside",
    city: "Durban",
    country: "ZA",
    currency: "ZAR",
    status: "pending",
    commission_rate: 16,
    delivery_enabled: true,
    pickup_enabled: true,
    delivery_radius_km: 6,
    delivery_tiers: defaultTiersFor(6),
    rating: 4.3,
    rating_count: 231,
    prep_time_minutes: 16,
    opens_at: "11:30",
    closes_at: "21:30",
    latitude: -29.8316,
    longitude: 31.0173,
    image_url:
      "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=900&q=70",
    created_at: "2025-03-18T14:10:00.000Z",
  },
  {
    id: "rst-curry",
    name: "Bombay Thali",
    slug: "bombay-thali",
    cuisine: "Indian",
    email: "eat@bombaythali.co.za",
    phone: "+27 12 345 1122",
    address: "45 Church Street, Hatfield",
    city: "Pretoria",
    country: "ZA",
    currency: "ZAR",
    status: "approved",
    commission_rate: 15,
    delivery_enabled: true,
    pickup_enabled: true,
    delivery_radius_km: 8,
    delivery_tiers: defaultTiersFor(8),
    rating: 4.6,
    rating_count: 540,
    prep_time_minutes: 20,
    opens_at: "11:00",
    closes_at: "22:00",
    latitude: -25.7461,
    longitude: 28.2294,
    image_url:
      "https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=900&q=70",
    created_at: "2025-04-07T10:00:00.000Z",
  },
  {
    id: "rst-burgerlab",
    name: "Burger Lab",
    slug: "burger-lab",
    cuisine: "Burgers",
    email: "hi@burgerlab.co.za",
    phone: "+27 41 012 3300",
    address: "15 Parliament Street, Central",
    city: "Port Elizabeth",
    country: "ZA",
    currency: "ZAR",
    status: "approved",
    commission_rate: 17,
    delivery_enabled: true,
    pickup_enabled: true,
    delivery_radius_km: 6,
    delivery_tiers: defaultTiersFor(6),
    rating: 4.4,
    rating_count: 378,
    prep_time_minutes: 14,
    opens_at: "10:30",
    closes_at: "23:30",
    latitude: -33.9608,
    longitude: 25.6022,
    image_url:
      "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=70",
    created_at: "2025-05-20T12:15:00.000Z",
  },
];

let seeded = false;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

/** Build simple default tier bands: 0-3km R15, then +R10 every 5km up to the radius. */
function defaultTiersFor(radiusKm: number): DeliveryTier[] {
  const bands: { up: number; fee: number }[] = [{ up: Math.min(3, radiusKm), fee: 15 }];
  let up = 5;
  let fee = 25;
  while (up < radiusKm) {
    bands.push({ up, fee });
    up += 5;
    fee += 10;
  }
  bands.push({ up: radiusKm, fee });
  // Dedupe by distance (keep last), clamp to radius.
  const seen = new Map<number, number>();
  for (const b of bands) {
    const clamped = Math.min(Math.max(1, Math.round(b.up * 10) / 10), radiusKm);
    seen.set(clamped, b.fee);
  }
  return [...seen.entries()]
    .sort(([a], [b]) => a - b)
    .map(([up, fee], i) => ({
      id: `tier_seed_${i}`,
      up_to_km: up,
      fee,
      label: null,
    }));
}

/** Compute the delivery fee in ZAR for a given distance using the restaurant's tiers.
 *  Tiers are interpreted as "up to X km" bands sorted ascending; the first tier
 *  whose up_to_km >= distanceKm wins. Returns null for out-of-range. */
export function feeForDistance(tiers: DeliveryTier[] | null | undefined, distanceKm: number): number | null {
  const sorted = (tiers ?? []).slice().sort((a, b) => a.up_to_km - b.up_to_km);
  if (!sorted.length) return null;
  for (const t of sorted) {
    if (distanceKm <= t.up_to_km) return Number(t.fee);
  }
  return null;
}

/** Build tier bands from a simple fee rule:
 *   base_fee for the first `step_km` km, then +fee_per_step every extra `step_km`
 *   up to (and covering) `radius_km`.
 *  Example: base=10, step=5, perStep=10, radius=15 →
 *    0–5 km = R10, 5–10 km = R20, 10–15 km = R30.
 *  Radius is rounded UP to the next full step so the top band always covers it. */
export function buildTiersFromRule(input: {
  base_fee: number;
  step_km: number;
  fee_per_step: number;
  radius_km: number;
}): { tiers: DeliveryTier[]; effectiveRadius: number } {
  const base = Math.max(0, Math.round(input.base_fee * 100) / 100);
  const step = Math.max(0.5, Math.round(input.step_km * 10) / 10);
  const inc = Math.max(0, Math.round(input.fee_per_step * 100) / 100);
  const radius = Math.max(step, Number(input.radius_km) || step);
  // Number of increments needed so the final band covers the radius.
  const stepsNeeded = Math.max(1, Math.ceil(radius / step));
  const effectiveRadius = Math.round(step * stepsNeeded * 10) / 10;
  const tiers: DeliveryTier[] = [];
  for (let i = 0; i < stepsNeeded; i++) {
    tiers.push({
      id: `tier_auto_${i}`,
      up_to_km: Math.round(step * (i + 1) * 10) / 10,
      fee: Math.round((base + inc * i) * 100) / 100,
      label: null,
    });
  }
  return { tiers, effectiveRadius };
}

/** Best-effort "reverse engineer" of the rule from existing tiers, used when
 *  loading saved data back into the simple form. Returns null if tiers don't
 *  fit a clean arithmetic progression (user set custom bands). */
export function extractRuleFromTiers(tiers: DeliveryTier[] | null | undefined): {
  base_fee: number;
  step_km: number;
  fee_per_step: number;
} | null {
  const sorted = (tiers ?? []).slice().sort((a, b) => a.up_to_km - b.up_to_km);
  if (sorted.length === 0) return { base_fee: 10, step_km: 5, fee_per_step: 10 };
  if (sorted.length === 1) {
    return { base_fee: Number(sorted[0]!.fee) || 0, step_km: Number(sorted[0]!.up_to_km) || 5, fee_per_step: 10 };
  }
  const step = Number(sorted[0]!.up_to_km);
  const inc = Number(sorted[1]!.fee) - Number(sorted[0]!.fee);
  if (!Number.isFinite(step) || step <= 0) return null;
  if (!Number.isFinite(inc) || inc < 0) return null;
  // Check every band matches step*i, fee = base + inc*i.
  for (let i = 0; i < sorted.length; i++) {
    const expectedUp = Math.round(step * (i + 1) * 100) / 100;
    const expectedFee = Math.round((Number(sorted[0]!.fee) + inc * i) * 100) / 100;
    if (Math.abs(Number(sorted[i]!.up_to_km) - expectedUp) > 0.01) return null;
    if (Math.abs(Number(sorted[i]!.fee) - expectedFee) > 0.01) return null;
  }
  return { base_fee: Number(sorted[0]!.fee) || 0, step_km: step, fee_per_step: inc };
}

/** Validate & normalise tiers: sort ascending, drop invalid rows, auto-assign ids. */
export function normaliseTiers(
  input: { up_to_km: number | string; fee: number | string; label?: string | null; id?: string }[],
  radiusKm: number,
): { tiers: DeliveryTier[]; warnings: string[] } {
  const warnings: string[] = [];
  const map = new Map<number, DeliveryTier>();
  for (const row of input) {
    const up = typeof row.up_to_km === "string" ? Number(row.up_to_km) : row.up_to_km;
    const fee = typeof row.fee === "string" ? Number(row.fee) : row.fee;
    if (!Number.isFinite(up) || up <= 0) continue;
    if (!Number.isFinite(fee) || fee < 0) continue;
    const key = Math.round(up * 10) / 10;
    map.set(key, {
      id: row.id && row.id.startsWith("tier_") ? row.id : uid("tier"),
      up_to_km: key,
      fee: Math.round(fee * 100) / 100,
      label: (row.label ?? null) as string | null,
    });
  }
  const tiers = [...map.values()].sort((a, b) => a.up_to_km - b.up_to_km);
  if (tiers.length === 0) warnings.push("Add at least one distance tier.");
  else {
    const last = tiers[tiers.length - 1]!;
    if (last.up_to_km < radiusKm) {
      warnings.push(
        `Largest tier (${last.up_to_km} km) is shorter than the restaurant's ${radiusKm} km radius — distances beyond ${last.up_to_km} km will show as "out of range".`,
      );
    }
  }
  return { tiers, warnings };
}

/** If the restaurant node is empty, write the seed restaurants.
 *  Also ensures any new seed restaurants introduced by code updates get
 *  added (by id) without touching user-created records. */
export async function ensureSeeded(): Promise<boolean> {
  if (seeded) return false;
  if (!isFirebaseAvailable()) return false;
  try {
    const existing = (await rtdbGet<Record<string, FirebaseRestaurant>>(RESTAURANTS_PATH)) ?? {};
    let changed = false;
    const payload = { ...existing };
    for (const r of SEED_RESTAURANTS) {
      if (!payload[r.id]) {
        payload[r.id] = r;
        changed = true;
      }
    }
    if (changed) {
      await rtdbSet(RESTAURANTS_PATH, payload);
    }
    seeded = true;
    void backfillTiers();
    return changed;
  } catch (err) {
    console.warn("[restaurants:firebase] seed failed, falling back locally:", err);
    return false;
  }
}

function toArray(data: Record<string, FirebaseRestaurant> | null): FirebaseRestaurant[] {
  if (!data) return [];
  return Object.values(data);
}

export async function listFirebaseRestaurants(input?: {
  search?: string;
  status?: string;
}): Promise<FirebaseRestaurant[]> {
  if (!isFirebaseAvailable()) return SEED_RESTAURANTS;
  await ensureSeeded();
  const search = input?.search?.trim().toLowerCase();
  const status = input?.status;
  const data = await rtdbGet<Record<string, FirebaseRestaurant>>(RESTAURANTS_PATH);
  const rows = toArray(data).filter(
    (r) =>
      (!search ||
        r.name.toLowerCase().includes(search) ||
        r.cuisine.toLowerCase().includes(search)) &&
      (!status || status === "all" || r.status === status),
  );
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return rows;
}

export type RestaurantInput = {
  id?: string | undefined;
  slug?: string | undefined;
  name: string;
  cuisine: string;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  address?: string | null | undefined;
  city: string;
  country?: string | undefined;
  currency?: string | undefined;
  commission_rate?: number | undefined;
  delivery_enabled?: boolean | undefined;
  pickup_enabled?: boolean | undefined;
  delivery_radius_km?: number | undefined;
  delivery_tiers?: DeliveryTier[] | undefined;
  rating?: number | undefined;
  rating_count?: number | undefined;
  prep_time_minutes?: number | undefined;
  opens_at?: string | undefined;
  closes_at?: string | undefined;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  image_url?: string | null | undefined;
  status?: RestaurantStatus | undefined;
  created_at?: string | undefined;
};

export async function saveFirebaseRestaurant(input: RestaurantInput): Promise<{ id: string }> {
  if (!isFirebaseAvailable()) {
    throw new Error("Firebase is unavailable right now. Check your connection and try again.");
  }
  await ensureSeeded();
  const data = (await rtdbGet<Record<string, FirebaseRestaurant>>(RESTAURANTS_PATH)) ?? {};
  const id = input.id ?? uid("rst");
  const existing = data[id];
  const record: FirebaseRestaurant = {
    id,
    slug: slugify(input.name),
    name: input.name,
    cuisine: input.cuisine,
    email: input.email ?? null,
    phone: input.phone ?? null,
    address: input.address ?? null,
    city: input.city,
    country: "ZA",
    currency: "ZAR",
    status: input.status ?? existing?.status ?? "pending",
    commission_rate: input.commission_rate ?? existing?.commission_rate ?? 15,
    delivery_enabled: input.delivery_enabled ?? existing?.delivery_enabled ?? true,
    pickup_enabled: input.pickup_enabled ?? existing?.pickup_enabled ?? true,
    delivery_radius_km: input.delivery_radius_km ?? existing?.delivery_radius_km ?? 8,
    delivery_tiers:
      input.delivery_tiers ??
      existing?.delivery_tiers ??
      defaultTiersFor(input.delivery_radius_km ?? existing?.delivery_radius_km ?? 8),
    rating: existing?.rating ?? 0,
    rating_count: existing?.rating_count ?? 0,
    prep_time_minutes: input.prep_time_minutes ?? existing?.prep_time_minutes ?? 20,
    opens_at: input.opens_at ?? existing?.opens_at ?? "08:00",
    closes_at: input.closes_at ?? existing?.closes_at ?? "22:00",
    latitude: input.latitude ?? existing?.latitude ?? null,
    longitude: input.longitude ?? existing?.longitude ?? null,
    image_url: input.image_url ?? existing?.image_url ?? null,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };
  await rtdbSet(`${RESTAURANTS_PATH}/${id}`, record);
  return { id };
}

export async function setFirebaseRestaurantStatus(input: {
  id: string;
  status: RestaurantStatus;
}): Promise<{ ok: true }> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable.");
  await ensureSeeded();
  const data = (await rtdbGet<Record<string, FirebaseRestaurant>>(RESTAURANTS_PATH)) ?? {};
  const current = data[input.id];
  if (!current) throw new Error("Restaurant not found");
  await rtdbSet(`${RESTAURANTS_PATH}/${input.id}/status`, input.status);
  return { ok: true };
}

/** Persist delivery-fee tiers for a restaurant. Also auto-extends the radius
 *  to cover the largest tier so orders never fall outside service range silently. */
export async function saveFirebaseDeliveryTiers(input: {
  id: string;
  tiers: DeliveryTier[];
}): Promise<{ ok: true; radius: number; tiers: DeliveryTier[] }> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable.");
  await ensureSeeded();
  const data = (await rtdbGet<Record<string, FirebaseRestaurant>>(RESTAURANTS_PATH)) ?? {};
  const current = data[input.id];
  if (!current) throw new Error("Restaurant not found");
  const sorted = input.tiers.slice().sort((a, b) => a.up_to_km - b.up_to_km);
  const radius = Math.max(Number(current.delivery_radius_km) ?? 0, sorted[sorted.length - 1]?.up_to_km ?? 0);
  await rtdbSet(`${RESTAURANTS_PATH}/${input.id}/delivery_tiers`, sorted as unknown as import("@/lib/firebase").RTDBValue);
  if (radius > (Number(current.delivery_radius_km) ?? 0)) {
    await rtdbSet(`${RESTAURANTS_PATH}/${input.id}/delivery_radius_km`, radius);
  }
  return { ok: true, radius, tiers: sorted };
}

/** Best-effort one-shot migration:
 *  1. Adds delivery_tiers to any restaurant missing them.
 *  2. Sets delivery_enabled=true / pickup_enabled=true for any restaurant
 *     missing those flags (so the customer app sees delivery on).
 *  3. Repairs obviously-bad test data (radius > 50 km or > 20 tiers from an
 *     earlier bug) by resetting tiers/radius to sane defaults.
 *  Runs lazily on list/subscribe so existing Firebase data is repaired
 *  without a destructive reset. */
async function backfillTiers() {
  if (!isFirebaseAvailable()) return;
  try {
    const data = (await rtdbGet<Record<string, FirebaseRestaurant>>(RESTAURANTS_PATH)) ?? {};
    let tierWrites = 0;
    let flagWrites = 0;
    let repairWrites = 0;
    for (const r of Object.values(data)) {
      if (!r) continue;
      const radius = Number(r.delivery_radius_km) || 0;
      const existing = (r.delivery_tiers as unknown as DeliveryTier[] | undefined) ?? [];
      const needsRepair = radius > 50 || (Array.isArray(existing) && existing.length > 20);
      const missingTiers = !Array.isArray(existing) || existing.length === 0;

      if (needsRepair) {
        const saneRadius = Math.max(5, Math.min(15, Math.round((Number(r.commission_rate) ? 10 : 10))));
        const tiers = defaultTiersFor(saneRadius);
        await rtdbSet(
          `${RESTAURANTS_PATH}/${r.id}/delivery_tiers`,
          tiers as unknown as import("@/lib/firebase").RTDBValue,
        );
        await rtdbSet(`${RESTAURANTS_PATH}/${r.id}/delivery_radius_km`, saneRadius);
        repairWrites++;
      } else if (missingTiers) {
        const tiers = defaultTiersFor(radius || 8);
        await rtdbSet(
          `${RESTAURANTS_PATH}/${r.id}/delivery_tiers`,
          tiers as unknown as import("@/lib/firebase").RTDBValue,
        );
        tierWrites++;
      }

      // Fill in missing boolean flags (default: both delivery and pickup on).
      const patches: Record<string, boolean> = {};
      const rec = r as Record<string, unknown>;
      if (typeof rec["delivery_enabled"] !== "boolean") {
        patches["delivery_enabled"] = true;
      }
      if (typeof rec["pickup_enabled"] !== "boolean") {
        patches["pickup_enabled"] = true;
      }
      if (Object.keys(patches).length > 0) {
        for (const [k, v] of Object.entries(patches)) {
          await rtdbSet(`${RESTAURANTS_PATH}/${r.id}/${k}`, v);
        }
        flagWrites++;
      }
    }
    if (tierWrites + flagWrites + repairWrites > 0) {
      console.info(
        `[restaurants:firebase] backfill complete: ${tierWrites} tier sets, ${flagWrites} flag sets, ${repairWrites} repairs`,
      );
    }
  } catch (e) {
    console.warn("[restaurants:firebase] backfill failed", e);
  }
}

export function subscribeRestaurants(
  callback: (rows: FirebaseRestaurant[]) => void,
): () => void {
  if (!isFirebaseAvailable()) {
    callback(SEED_RESTAURANTS);
    return () => {};
  }
  // Make sure the seed is in place before subscribing so we don't
  // overwrite user data.
  void ensureSeeded();
  return rtdbSubscribe<Record<string, FirebaseRestaurant>>(RESTAURANTS_PATH, (val) => {
    callback(toArray(val).sort((a, b) => b.created_at.localeCompare(a.created_at)));
  });
}

export { SEED_RESTAURANTS as FALLBACK_RESTAURANTS };
