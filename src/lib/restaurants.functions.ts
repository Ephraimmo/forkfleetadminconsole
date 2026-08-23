import { audit } from "@/lib/audit";
import {
  branches,
  businessHours,
  delay,
  orders,
  profiles,
  restaurantStaff,
  restaurants,
  slugify,
  uid,
  zones,
  type RestaurantStatusValue,
} from "@/lib/demo-store";

export type RestaurantStatus = RestaurantStatusValue;

export interface RestaurantRow {
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
  delivery_radius_km: number;
  rating: number;
  rating_count: number;
  prep_time_minutes: number;
  opens_at: string;
  closes_at: string;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
}

export interface BranchRow {
  id: string;
  restaurant_id: string;
  name: string;
  code: string | null;
  address: string | null;
  city: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  delivery_radius_km: number;
  status: RestaurantStatus;
  is_active: boolean;
}

export interface ZoneRow {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  name: string;
  radius_km: number;
  base_fee: number;
  min_order: number;
  surcharge: number;
  postal_codes: string[];
  is_active: boolean;
}

export interface HourRow {
  id?: string;
  restaurant_id?: string;
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  is_closed: boolean;
}

export interface RestaurantDetail {
  restaurant: RestaurantRow;
  branches: BranchRow[];
  zones: ZoneRow[];
  hours: HourRow[];
  staff: { id: string; user_id: string; role: string; is_active: boolean; email: string | null; full_name: string | null }[];
  stats: { orders: number; revenue: number; menuItems: number };
}

export async function listRestaurants(
  input?: { search?: string; status?: string },
): Promise<RestaurantRow[]> {
  await delay(70);
  const search = input?.search?.trim().toLowerCase();
  const status = input?.status;
  return restaurants
    .filter((r) => (!search || r.name.toLowerCase().includes(search) || r.cuisine.toLowerCase().includes(search)))
    .filter((r) => (!status || status === "all" || r.status === status))
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 300);
}

export async function getRestaurant(input: { id: string }): Promise<RestaurantDetail> {
  await delay(90);
  const restaurant = restaurants.find((r) => r.id === input.id);
  if (!restaurant) throw new Error("Restaurant not found");
  const restBranches = branches.filter((b) => b.restaurant_id === input.id);
  const restZones = zones.filter((z) => z.restaurant_id === input.id);
  const restHours = businessHours.filter((h) => h.restaurant_id === input.id).sort((a, b) => a.day_of_week - b.day_of_week);
  const staffLinks = restaurantStaff.filter((rs) => rs.restaurant_id === input.id && rs.is_active);
  const profileMap = new Map(profiles.map((p) => [p.user_id, p]));
  const restOrders = orders.filter((o) => o.restaurant_id === input.id);

  return {
    restaurant,
    branches: restBranches,
    zones: restZones,
    hours: restHours,
    staff: staffLinks.map((s) => {
      const p = profileMap.get(s.user_id);
      return {
        id: s.id,
        user_id: s.user_id,
        role: s.role,
        is_active: s.is_active,
        email: p?.email ?? null,
        full_name: p?.full_name ?? null,
      };
    }),
    stats: {
      orders: restOrders.length,
      revenue: restOrders.filter((o) => o.status === "delivered").reduce((sum, o) => sum + Number(o.total ?? 0), 0),
      menuItems: 0,
    },
  };
}

export async function saveRestaurant(input: {
  id?: string;
  name: string;
  cuisine: string;
  email?: string;
  phone?: string;
  address?: string;
  city: string;
  commission_rate: number;
  delivery_radius_km: number;
  prep_time_minutes: number;
  opens_at: string;
  closes_at: string;
  latitude?: number | null;
  longitude?: number | null;
  status?: RestaurantStatus;
}) {
  await delay(80);
  if (input.id) {
    const existing = restaurants.find((r) => r.id === input.id);
    if (!existing) throw new Error("Restaurant not found");
    Object.assign(existing, {
      name: input.name,
      slug: slugify(input.name),
      cuisine: input.cuisine,
      email: input.email ?? existing.email,
      phone: input.phone ?? existing.phone,
      address: input.address ?? existing.address,
      city: input.city,
      commission_rate: input.commission_rate,
      delivery_radius_km: input.delivery_radius_km,
      prep_time_minutes: input.prep_time_minutes,
      opens_at: input.opens_at,
      closes_at: input.closes_at,
      latitude: input.latitude !== undefined ? (input.latitude ?? null) : existing.latitude,
      longitude: input.longitude !== undefined ? (input.longitude ?? null) : existing.longitude,
      status: input.status ?? existing.status,
    });
    audit({
      action: "restaurant.updated",
      entityType: "restaurant",
      entityId: existing.id,
      after: { name: input.name, status: existing.status },
    });
    return { id: existing.id };
  }

  const id = uid("rst");
  const now = new Date().toISOString();
  const created = {
    id,
    name: input.name,
    slug: slugify(input.name),
    cuisine: input.cuisine,
    email: input.email ?? null,
    phone: input.phone ?? null,
    address: input.address ?? null,
    city: input.city,
    country: "ZA",
    currency: "ZAR",
    status: (input.status ?? "pending") as RestaurantStatus,
    commission_rate: input.commission_rate,
    delivery_radius_km: input.delivery_radius_km,
    rating: 0,
    rating_count: 0,
    prep_time_minutes: input.prep_time_minutes,
    opens_at: input.opens_at,
    closes_at: input.closes_at,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    created_at: now,
  };
  restaurants.push(created);
  for (let d = 0; d < 7; d++) {
    businessHours.push({
      id: `hr-${id}-${d}`,
      restaurant_id: id,
      day_of_week: d,
      opens_at: input.opens_at,
      closes_at: input.closes_at,
      is_closed: false,
    });
  }
  audit({
    action: "restaurant.registered",
    entityType: "restaurant",
    entityId: id,
    after: { name: input.name },
  });
  return { id };
}

export async function setRestaurantStatus(input: { id: string; status: RestaurantStatus; reason?: string }) {
  await delay(50);
  const r = restaurants.find((x) => x.id === input.id);
  if (!r) throw new Error("Restaurant not found");
  r.status = input.status;
  audit({
    action: `restaurant.${input.status}`,
    entityType: "restaurant",
    entityId: input.id,
    after: { status: input.status, reason: input.reason ?? null },
  });
  return { ok: true };
}

export async function saveBusinessHours(input: { restaurantId: string; hours: HourRow[] }) {
  await delay(60);
  for (let i = businessHours.length - 1; i >= 0; i--) {
    if (businessHours[i]!.restaurant_id === input.restaurantId) businessHours.splice(i, 1);
  }
  for (const h of input.hours) {
    businessHours.push({
      id: uid("hr"),
      restaurant_id: input.restaurantId,
      day_of_week: h.day_of_week,
      opens_at: h.opens_at,
      closes_at: h.closes_at,
      is_closed: h.is_closed,
    });
  }
  return { ok: true };
}

export async function saveBranch(input: Partial<BranchRow> & { restaurant_id: string; name: string }) {
  await delay(60);
  if (input.id) {
    const b = branches.find((x) => x.id === input.id);
    if (!b) throw new Error("Branch not found");
    Object.assign(b, input);
  } else {
    branches.push({
      id: uid("brn"),
      restaurant_id: input.restaurant_id,
      name: input.name,
      code: input.code ?? null,
      address: input.address ?? null,
      city: input.city ?? "Johannesburg",
      phone: input.phone ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      delivery_radius_km: input.delivery_radius_km ?? 6,
      status: (input.status ?? "approved") as RestaurantStatus,
      is_active: input.is_active ?? true,
    });
  }
  return { ok: true };
}

export async function deleteBranch(input: { id: string }) {
  await delay(40);
  const idx = branches.findIndex((b) => b.id === input.id);
  if (idx >= 0) branches.splice(idx, 1);
  return { ok: true };
}

export async function saveZone(input: Partial<ZoneRow> & { restaurant_id: string; name: string }) {
  await delay(60);
  if (input.id) {
    const z = zones.find((x) => x.id === input.id);
    if (!z) throw new Error("Zone not found");
    Object.assign(z, input);
  } else {
    zones.push({
      id: uid("zn"),
      restaurant_id: input.restaurant_id,
      branch_id: input.branch_id ?? null,
      name: input.name,
      radius_km: input.radius_km ?? 5,
      base_fee: input.base_fee ?? 20,
      min_order: input.min_order ?? 100,
      surcharge: input.surcharge ?? 0,
      postal_codes: input.postal_codes ?? [],
      is_active: input.is_active ?? true,
    });
  }
  return { ok: true };
}

export async function deleteZone(input: { id: string }) {
  await delay(40);
  const idx = zones.findIndex((z) => z.id === input.id);
  if (idx >= 0) zones.splice(idx, 1);
  return { ok: true };
}
