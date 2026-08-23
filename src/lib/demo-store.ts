/**
 * Static demo data store.
 *
 * The whole console runs on this in-memory dataset — there is no database and no
 * network access. Data is generated deterministically from a fixed seed so every
 * reload shows the same numbers, and mutations (assign driver, advance status,
 * edit menu, invite staff, …) are applied to these arrays for the session.
 */

/* ------------------------------------------------------------------ helpers */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20260804);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
const between = (min: number, max: number) => min + rnd() * (max - min);
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1));
const round2 = (n: number) => Math.round(n * 100) / 100;

let idCounter = 0;
export const uid = (prefix = "id") => `${prefix}-${(++idCounter).toString(36)}-${Date.now().toString(36)}`;

const iso = (d: Date) => d.toISOString();
const minutesAgo = (m: number) => iso(new Date(Date.now() - m * 60_000));

/* -------------------------------------------------------------------- types */

export type OrderStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "assigned"
  | "picked_up"
  | "on_the_way"
  | "delivered"
  | "cancelled"
  | "refunded";

export type DriverStatus = "offline" | "online" | "busy" | "suspended" | "pending";
export type RestaurantStatusValue = "pending" | "approved" | "suspended" | "rejected";

export interface DemoRestaurant {
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
  status: RestaurantStatusValue;
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

export interface DemoCustomer {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  city: string;
  created_at: string;
}

export interface DemoDriver {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  city: string;
  vehicle_type: string;
  vehicle_plate: string | null;
  status: DriverStatus;
  is_verified: boolean;
  rating: number;
  total_deliveries: number;
  wallet_balance: number;
  updated_at: string;
}

export interface DemoOrderItem {
  id: string;
  order_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
}

export interface DemoOrder {
  id: string;
  order_number: string;
  status: OrderStatus;
  placed_at: string;
  delivered_at: string | null;
  cancelled_at: string | null;
  eta_minutes: number | null;
  subtotal: number;
  delivery_fee: number;
  commission: number;
  total: number;
  payment_method: string;
  delivery_address: string | null;
  special_instructions: string | null;
  restaurant_id: string;
  customer_id: string;
  driver_id: string | null;
}

export interface DemoAuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_email: string | null;
  before_value: Record<string, string | number | boolean | null> | null;
  after_value: Record<string, string | number | boolean | null> | null;
  created_at: string;
}

export interface DemoProfile {
  user_id: string;
  email: string;
  full_name: string | null;
  job_title: string | null;
  last_login_at: string | null;
}

/* --------------------------------------------------------------- generation */

const CUISINES = ["Italian", "Japanese", "Mexican", "Indian", "Levantine", "American", "Thai", "Ethiopian"];
const CITIES = ["Cape Town", "Johannesburg", "Durban", "Pretoria"];
const VEHICLES = ["bicycle", "scooter", "motorbike", "car", "van"];
const PAYMENTS = ["card", "cash", "wallet", "eft"];

const RESTAURANT_NAMES = [
  "Nonna's Table",
  "Kaiseki Bar",
  "Casa Verde Taqueria",
  "Spice Route Kitchen",
  "Cedar & Sumac",
  "Union Grill House",
  "Bangkok Lantern",
  "Addis Fire",
];

const FIRST = ["Amara", "Thabo", "Lerato", "Sipho", "Nadia", "Kyle", "Zanele", "Ravi", "Chloe", "Tumi", "Farah", "Dean", "Nomsa", "Jaco", "Aisha", "Lwazi"];
const LAST = ["Mokoena", "Naidoo", "van Wyk", "Dlamini", "Petersen", "Khumalo", "Botha", "Abrahams", "Nkosi", "Fourie", "Sithole", "Meyer"];

const DISHES: Record<string, string[]> = {
  Italian: ["Margherita Pizza", "Tagliatelle Ragù", "Arancini", "Tiramisu", "Focaccia"],
  Japanese: ["Salmon Nigiri Set", "Chicken Katsu", "Miso Ramen", "Gyoza", "Matcha Mochi"],
  Mexican: ["Al Pastor Tacos", "Loaded Nachos", "Chicken Burrito", "Elote", "Churros"],
  Indian: ["Butter Chicken", "Paneer Tikka", "Lamb Rogan Josh", "Garlic Naan", "Gulab Jamun"],
  Levantine: ["Chicken Shawarma", "Falafel Plate", "Lamb Kofta", "Hummus & Pita", "Baklava"],
  American: ["Smash Burger", "Buffalo Wings", "BBQ Brisket", "Truffle Fries", "Cheesecake"],
  Thai: ["Pad Thai", "Green Curry", "Tom Yum", "Spring Rolls", "Mango Sticky Rice"],
  Ethiopian: ["Doro Wat", "Veg Combo", "Kitfo", "Injera Basket", "Ethiopian Coffee"],
};

const namePool = (i: number) => `${FIRST[i % FIRST.length]} ${LAST[(i * 5) % LAST.length]}`;

export const restaurants: DemoRestaurant[] = RESTAURANT_NAMES.map((name, i) => {
  const cuisine = CUISINES[i % CUISINES.length]!;
  const city = CITIES[i % CITIES.length]!;
  return {
    id: `rst-${i + 1}`,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    cuisine,
    email: `orders@${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.demo`,
    phone: `+27 21 ${intBetween(200, 999)} ${intBetween(1000, 9999)}`,
    address: `${intBetween(2, 240)} ${pick(["Long", "Bree", "Kloof", "Church", "Main"])} Street`,
    city,
    country: "ZA",
    currency: "ZAR",
    status: i === 6 ? "pending" : i === 7 ? "suspended" : "approved",
    commission_rate: round2(between(12, 22)),
    delivery_radius_km: intBetween(4, 14),
    rating: round2(between(3.8, 4.9)),
    rating_count: intBetween(80, 1400),
    prep_time_minutes: intBetween(12, 35),
    opens_at: "09:00",
    closes_at: "22:30",
    latitude: round2(-33.9 - between(0, 0.4)),
    longitude: round2(18.4 + between(0, 0.4)),
    created_at: minutesAgo(intBetween(60 * 24 * 60, 60 * 24 * 400)),
  };
});

export const customers: DemoCustomer[] = Array.from({ length: 48 }, (_, i) => ({
  id: `cus-${i + 1}`,
  full_name: namePool(i),
  email: `${namePool(i).toLowerCase().replace(/[^a-z]+/g, ".")}@example.demo`,
  phone: `+27 8${intBetween(1, 4)} ${intBetween(200, 999)} ${intBetween(1000, 9999)}`,
  city: pick(CITIES),
  created_at: minutesAgo(intBetween(60, 60 * 24 * 300)),
}));

export const drivers: DemoDriver[] = Array.from({ length: 14 }, (_, i) => {
  const full_name = namePool(i + 3);
  return {
    id: `drv-${i + 1}`,
    full_name,
    email: `${full_name.toLowerCase().replace(/[^a-z]+/g, ".")}@fleet.demo`,
    phone: `+27 7${intBetween(1, 9)} ${intBetween(200, 999)} ${intBetween(1000, 9999)}`,
    city: pick(CITIES),
    vehicle_type: pick(VEHICLES),
    vehicle_plate: `CA ${intBetween(100, 999)} ${pick(["GP", "WP", "KZN", "MP"])}`,
    status: (i < 6 ? "online" : i < 9 ? "busy" : i < 12 ? "offline" : i === 12 ? "pending" : "suspended") as DriverStatus,
    is_verified: i !== 12,
    rating: round2(between(4.0, 5.0)),
    total_deliveries: intBetween(35, 940),
    wallet_balance: round2(between(120, 4800)),
    updated_at: minutesAgo(intBetween(1, 400)),
  };
});

// Orders are now stored in Firebase Realtime Database under /orders/{id}.
// The arrays below are intentionally empty — all order book reads (Orders page,
// Kitchen, Dispatch, Dashboard, Live map, Support, Customers) go through the
// Firebase layer in src/lib/orders.firebase.ts and its adapters.
export const orders: DemoOrder[] = [];
export const orderItems: DemoOrderItem[] = [];

/* ------------------------------------------------------- staff & access data */

export type StaffRoleValue =
  | "super_admin"
  | "platform_admin"
  | "restaurant_owner"
  | "restaurant_manager"
  | "kitchen_manager"
  | "kitchen_staff"
  | "cashier"
  | "dispatcher"
  | "finance_manager"
  | "customer_support"
  | "marketing_manager"
  | "inventory_manager"
  | "branch_manager"
  | "operations_manager"
  | "auditor";

export const ALL_ROLES: StaffRoleValue[] = [
  "super_admin",
  "platform_admin",
  "operations_manager",
  "restaurant_owner",
  "restaurant_manager",
  "branch_manager",
  "kitchen_manager",
  "kitchen_staff",
  "cashier",
  "dispatcher",
  "finance_manager",
  "customer_support",
  "marketing_manager",
  "inventory_manager",
  "auditor",
];

export const permissions: { code: string; module: string; description: string }[] = [
  { code: "dashboard.view", module: "dashboard", description: "View platform dashboard and KPIs" },
  { code: "restaurants.view", module: "restaurants", description: "View restaurants and branches" },
  { code: "restaurants.manage", module: "restaurants", description: "Create, edit and approve restaurants" },
  { code: "menus.view", module: "menus", description: "View menus, variants and add-ons" },
  { code: "menus.manage", module: "menus", description: "Edit menus, pricing and availability" },
  { code: "orders.view", module: "orders", description: "View the order book" },
  { code: "orders.manage", module: "orders", description: "Advance kitchen and order statuses" },
  { code: "dispatch.manage", module: "dispatch", description: "Assign drivers and manage deliveries" },
  { code: "drivers.view", module: "drivers", description: "View the driver fleet" },
  { code: "drivers.manage", module: "drivers", description: "Manage driver availability and verification" },
  { code: "customers.view", module: "customers", description: "View customer directory and segments" },
  { code: "customers.manage", module: "customers", description: "Edit customers, issue credits and tags" },
  { code: "finance.view", module: "finance", description: "View payouts, settlements and payment analytics" },
  { code: "finance.manage", module: "finance", description: "Initiate payouts, approve refunds, reconcile batches" },
  { code: "users.view", module: "access", description: "View staff, roles and invitations" },
  { code: "users.manage", module: "access", description: "Invite staff and change roles" },
  { code: "support.view", module: "support", description: "View customer support tickets and chats" },
  { code: "support.manage", module: "support", description: "Reply to tickets, issue refunds and credits" },
  { code: "audit.view", module: "audit", description: "View the audit trail" },
  { code: "settings.manage", module: "settings", description: "Configure organisation, branding, security and integrations" },
  { code: "inventory.view", module: "inventory", description: "View inventory, customs and stock" },
  { code: "inventory.manage", module: "inventory", description: "Edit stock levels and customs data" },
  { code: "reports.view", module: "reports", description: "Run and export operational reports" },
  { code: "promotions.view", module: "promotions", description: "View promotions and promo codes" },
  { code: "promotions.manage", module: "promotions", description: "Create and publish promotions" },
  { code: "notifications.manage", module: "notifications", description: "Configure notification triggers" },
];

const ALL_CODES = permissions.map((p) => p.code);

export const rolePermissions: { role: StaffRoleValue; permission_code: string }[] = [];
const grant = (role: StaffRoleValue, codes: string[]) => {
  for (const code of codes) rolePermissions.push({ role, permission_code: code });
};

grant("super_admin", ALL_CODES);
grant("platform_admin", ALL_CODES);
grant("operations_manager", ALL_CODES.filter((c) => c !== "users.manage"));
grant("restaurant_owner", ["dashboard.view", "restaurants.view", "restaurants.manage", "menus.view", "menus.manage", "orders.view", "orders.manage", "finance.view", "users.view", "inventory.view", "inventory.manage", "reports.view", "promotions.view", "notifications.manage", "customers.view", "support.view", "audit.view"]);
grant("restaurant_manager", ["dashboard.view", "restaurants.view", "menus.view", "menus.manage", "orders.view", "orders.manage", "inventory.view", "inventory.manage", "reports.view", "customers.view", "support.view"]);
grant("branch_manager", ["dashboard.view", "restaurants.view", "orders.view", "orders.manage", "inventory.view", "reports.view", "customers.view", "support.view"]);
grant("kitchen_manager", ["orders.view", "orders.manage", "menus.view", "inventory.view", "inventory.manage"]);
grant("kitchen_staff", ["orders.view", "orders.manage"]);
grant("cashier", ["orders.view", "promotions.view", "customers.view"]);
grant("dispatcher", ["orders.view", "dispatch.manage", "drivers.view", "drivers.manage", "reports.view", "customers.view", "support.view"]);
grant("finance_manager", ["dashboard.view", "finance.view", "finance.manage", "orders.view", "audit.view", "reports.view", "promotions.view", "promotions.manage", "customers.view"]);
grant("customer_support", ["orders.view", "restaurants.view", "drivers.view", "notifications.manage", "customers.view", "customers.manage", "support.view", "support.manage", "finance.view"]);
grant("marketing_manager", ["dashboard.view", "menus.view", "restaurants.view", "promotions.view", "promotions.manage", "reports.view", "customers.view"]);
grant("inventory_manager", ["menus.view", "menus.manage", "restaurants.view", "inventory.view", "inventory.manage", "reports.view", "orders.view"]);
grant("auditor", ["dashboard.view", "audit.view", "orders.view", "finance.view", "restaurants.view", "reports.view", "customers.view", "support.view"]);

export const DEMO_USER_ID = "usr-1";

export const profiles: DemoProfile[] = [
  { user_id: DEMO_USER_ID, email: "avery.cole@forkfleet.demo", full_name: "Avery Cole", job_title: "Head of Operations", last_login_at: minutesAgo(2) },
  { user_id: "usr-2", email: "dispatch.lead@forkfleet.demo", full_name: "Sipho Dlamini", job_title: "Dispatch Lead", last_login_at: minutesAgo(24) },
  { user_id: "usr-3", email: "kitchen.lead@forkfleet.demo", full_name: "Nadia Petersen", job_title: "Kitchen Manager", last_login_at: minutesAgo(96) },
  { user_id: "usr-4", email: "finance@forkfleet.demo", full_name: "Ravi Naidoo", job_title: "Finance Manager", last_login_at: minutesAgo(300) },
  { user_id: "usr-5", email: "support@forkfleet.demo", full_name: "Zanele Nkosi", job_title: "Support Specialist", last_login_at: minutesAgo(640) },
  { user_id: "usr-6", email: "owner.nonnas@forkfleet.demo", full_name: "Chloe Meyer", job_title: "Restaurant Owner", last_login_at: minutesAgo(1500) },
];

export const userRoles: { user_id: string; role: StaffRoleValue }[] = [
  { user_id: DEMO_USER_ID, role: "super_admin" },
  { user_id: DEMO_USER_ID, role: "operations_manager" },
  { user_id: "usr-2", role: "dispatcher" },
  { user_id: "usr-3", role: "kitchen_manager" },
  { user_id: "usr-4", role: "finance_manager" },
  { user_id: "usr-5", role: "customer_support" },
  { user_id: "usr-6", role: "restaurant_owner" },
];

export const restaurantStaff: { id: string; restaurant_id: string; user_id: string; role: StaffRoleValue; is_active: boolean }[] = [
  { id: "rs-1", restaurant_id: "rst-1", user_id: "usr-6", role: "restaurant_owner", is_active: true },
  { id: "rs-2", restaurant_id: "rst-1", user_id: "usr-3", role: "kitchen_manager", is_active: true },
  { id: "rs-3", restaurant_id: "rst-2", user_id: "usr-3", role: "kitchen_manager", is_active: true },
  { id: "rs-4", restaurant_id: "rst-3", user_id: "usr-5", role: "customer_support", is_active: true },
];

export interface DemoInvitation {
  id: string;
  email: string;
  role: StaffRoleValue;
  restaurant_id: string | null;
  status: string;
  message: string | null;
  expires_at: string;
  created_at: string;
}

export const invitations: DemoInvitation[] = [
  {
    id: "inv-1",
    email: "new.dispatcher@forkfleet.demo",
    role: "dispatcher",
    restaurant_id: null,
    status: "pending",
    message: "Night shift dispatch cover.",
    expires_at: iso(new Date(Date.now() + 5 * 86_400_000)),
    created_at: minutesAgo(320),
  },
  {
    id: "inv-2",
    email: "chef.kaiseki@forkfleet.demo",
    role: "kitchen_staff",
    restaurant_id: "rst-2",
    status: "pending",
    message: null,
    expires_at: iso(new Date(Date.now() + 2 * 86_400_000)),
    created_at: minutesAgo(900),
  },
  {
    id: "inv-3",
    email: "audit.partner@forkfleet.demo",
    role: "auditor",
    restaurant_id: null,
    status: "accepted",
    message: "Quarterly review access.",
    expires_at: iso(new Date(Date.now() - 86_400_000)),
    created_at: minutesAgo(4000),
  },
];

/* ------------------------------------------- branches, zones, business hours */

export interface DemoBranch {
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
  status: RestaurantStatusValue;
  is_active: boolean;
}

export interface DemoZone {
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

export interface DemoHour {
  id: string;
  restaurant_id: string;
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  is_closed: boolean;
}

export const branches: DemoBranch[] = [];
export const zones: DemoZone[] = [];
export const businessHours: DemoHour[] = [];

restaurants.forEach((restaurant, ri) => {
  const branchCount = ri < 4 ? 2 : 1;
  for (let b = 0; b < branchCount; b++) {
    branches.push({
      id: `brn-${ri + 1}-${b + 1}`,
      restaurant_id: restaurant.id,
      name: b === 0 ? `${restaurant.name} — Flagship` : `${restaurant.name} — ${pick(["Waterfront", "Northside", "Mall", "Airport"])}`,
      code: `B${ri + 1}${b + 1}`,
      address: `${intBetween(2, 220)} ${pick(["Long", "Bree", "Kloof", "Main"])} Street`,
      city: restaurant.city,
      phone: `+27 21 ${intBetween(200, 999)} ${intBetween(1000, 9999)}`,
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
      delivery_radius_km: intBetween(4, 12),
      status: "approved",
      is_active: true,
    });
  }
  ["Inner city", "Suburbs", "Outer ring"].slice(0, ri < 4 ? 3 : 2).forEach((name, zi) => {
    zones.push({
      id: `zn-${ri + 1}-${zi + 1}`,
      restaurant_id: restaurant.id,
      branch_id: null,
      name,
      radius_km: 3 + zi * 4,
      base_fee: round2(20 + zi * 12),
      min_order: round2(80 + zi * 40),
      surcharge: round2(zi * 8),
      postal_codes: [`${intBetween(7000, 8999)}`],
      is_active: true,
    });
  });
  for (let d = 0; d < 7; d++) {
    businessHours.push({
      id: `hr-${ri + 1}-${d}`,
      restaurant_id: restaurant.id,
      day_of_week: d,
      opens_at: d === 0 ? "10:00" : restaurant.opens_at,
      closes_at: d >= 5 ? "23:30" : restaurant.closes_at,
      is_closed: d === 1 && ri === 7,
    });
  }
});

/* ---------------------------------------------------------------- audit logs */

export const auditLogs: DemoAuditLog[] = [];

const SEED_AUDIT: [string, string, string][] = [
  ["order.status.delivered", "order", "Delivery completed"],
  ["order.driver.assigned", "order", "Driver assigned"],
  ["driver.status.online", "driver", "Driver came online"],
  ["restaurant.approved", "restaurant", "Restaurant approved"],
  ["menu.item.updated", "menu_item", "Menu item updated"],
  ["staff.invited", "staff_invitation", "Staff invited"],
  ["role.granted", "user_role", "Role granted"],
];

SEED_AUDIT.forEach(([action, entity_type], i) => {
  auditLogs.push({
    id: `aud-${i + 1}`,
    action,
    entity_type,
    entity_id: entity_type === "driver" ? drivers[i]?.id ?? null : null,
    actor_email: profiles[i % profiles.length]!.email,
    before_value: null,
    after_value: { note: "seeded demo activity" },
    created_at: minutesAgo(intBetween(5, 2000)),
  });
});

/** Prepends a demo audit entry (most recent first). */
export function logAudit(entry: {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, string | number | boolean | null> | null;
  after?: Record<string, string | number | boolean | null> | null;
  actorEmail?: string | null;
}) {
  auditLogs.unshift({
    id: uid("aud"),
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    actor_email: entry.actorEmail ?? profiles[0]!.email,
    before_value: entry.before ?? null,
    after_value: entry.after ?? null,
    created_at: iso(new Date()),
  });
  return auditLogs[0]!;
}

/* -------------------------------------------------- notifications & alerts */

export type NotificationChannel = "in_app" | "email" | "sms" | "push";
export type NotificationSeverity = "info" | "success" | "warning" | "critical";

export interface DemoNotificationPreference {
  id: string;
  trigger: string;
  label: string;
  description: string;
  enabled: boolean;
  channels: NotificationChannel[];
  minSeverity: NotificationSeverity;
  roles: StaffRoleValue[];
}

export interface DemoNotification {
  id: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  trigger: string;
  created_at: string;
  read_at: string | null;
  link: string | null;
}

export const notificationPreferences: DemoNotificationPreference[] = [
  {
    id: "np-1",
    trigger: "order.delayed",
    label: "Order running late",
    description: "An order's ETA slipped by more than 10 minutes.",
    enabled: true,
    channels: ["in_app", "push"],
    minSeverity: "warning",
    roles: ["dispatcher", "operations_manager", "restaurant_manager"],
  },
  {
    id: "np-2",
    trigger: "driver.offline",
    label: "Driver went offline mid-delivery",
    description: "Fires when an active driver drops offline while assigned.",
    enabled: true,
    channels: ["in_app"],
    minSeverity: "critical",
    roles: ["dispatcher"],
  },
  {
    id: "np-3",
    trigger: "inventory.low",
    label: "Low inventory",
    description: "Stock level falls below the reorder threshold.",
    enabled: true,
    channels: ["in_app", "email"],
    minSeverity: "warning",
    roles: ["kitchen_manager", "restaurant_manager", "inventory_manager"],
  },
  {
    id: "np-4",
    trigger: "inventory.customs_held",
    label: "Customs hold",
    description: "An import shipment has been held by customs.",
    enabled: true,
    channels: ["in_app", "email"],
    minSeverity: "critical",
    roles: ["inventory_manager", "restaurant_owner", "operations_manager"],
  },
  {
    id: "np-5",
    trigger: "restaurant.pending",
    label: "New restaurant awaiting approval",
    description: "A new restaurant partner has signed up.",
    enabled: false,
    channels: ["in_app"],
    minSeverity: "info",
    roles: ["platform_admin", "operations_manager"],
  },
  {
    id: "np-6",
    trigger: "refund.requested",
    label: "Refund request",
    description: "A customer has requested a refund.",
    enabled: true,
    channels: ["in_app"],
    minSeverity: "warning",
    roles: ["customer_support", "finance_manager"],
  },
];

export const notifications: DemoNotification[] = [
  {
    id: "ntf-1",
    title: "Order #FF-1042 is running 12 minutes late",
    body: "Driver is stuck in traffic on the N1. ETA has been recalculated.",
    severity: "warning",
    trigger: "order.delayed",
    created_at: minutesAgo(4),
    read_at: null,
    link: "/orders?status=on_the_way",
  },
  {
    id: "ntf-2",
    title: "Margherita Pizza below reorder level at Nonna's Table",
    body: "Only 3 portions left. Trigger a stock transfer or place an order.",
    severity: "warning",
    trigger: "inventory.low",
    created_at: minutesAgo(22),
    read_at: null,
    link: "/inventory?restaurant=rst-1",
  },
  {
    id: "ntf-3",
    title: "Shipment SA-IMP-0087 held at customs",
    body: "Documentation missing for Japanese ingredients. HS code requires SADC certificate.",
    severity: "critical",
    trigger: "inventory.customs_held",
    created_at: minutesAgo(70),
    read_at: minutesAgo(55),
    link: "/inventory/customs",
  },
  {
    id: "ntf-4",
    title: "Weekly payouts reconciled",
    body: "R 184 204.50 ready to settle across 8 restaurants.",
    severity: "success",
    trigger: "finance.reconciled",
    created_at: minutesAgo(180),
    read_at: null,
    link: "/reports?kind=payouts",
  },
];

/* ---------------------------------------------------- inventory & customs */

export type InventoryUnit = "kg" | "g" | "l" | "ml" | "unit" | "case" | "bottle" | "box";

export interface DemoInventoryItem {
  id: string;
  restaurant_id: string;
  sku: string;
  name: string;
  category: string;
  unit: InventoryUnit;
  quantity_on_hand: number;
  reorder_level: number;
  ideal_stock: number;
  unit_cost: number;
  supplier: string;
  is_perishable: boolean;
  shelf_life_days: number | null;
  last_counted_at: string;
  is_imported: boolean;
  country_of_origin: string | null;
}

export interface DemoCustomsEntry {
  id: string;
  item_id: string;
  shipment_ref: string;
  hs_code: string;
  country_of_origin: string;
  port_of_entry: string;
  incoterm: "FOB" | "CIF" | "DDP" | "EXW";
  declared_value: number;
  currency: "ZAR" | "USD" | "EUR";
  import_duty_pct: number;
  vat_pct: number;
  excise_pct: number;
  total_landed_cost: number;
  status: "draft" | "submitted" | "inspection" | "held" | "cleared" | "rejected";
  documents: { name: string; status: "present" | "missing" }[];
  eta: string;
  arrived_at: string | null;
  cleared_at: string | null;
  notes: string | null;
}

const INV_CATEGORIES = ["Produce", "Proteins", "Dairy", "Dry goods", "Beverages", "Packaging"];
const UNITS: InventoryUnit[] = ["kg", "g", "l", "ml", "unit", "case", "bottle", "box"];
const SUPPLIERS = ["Cape Harvest Co.", "Jozi Fresh", "SADC Imports", "Marco Foods", "EcoPack SA"];
const COUNTRIES = ["South Africa", "Italy", "Japan", "Thailand", "India", "Mexico", "Ethiopia"];
const HS_SAMPLES = ["0805.10", "0904.11", "2202.10", "1905.31", "1602.50", "2005.20"];
const PORTS = ["Cape Town Harbour", "Durban Port", "OR Tambo Air Cargo", "Port Elizabeth", "Beit Bridge"];

export const inventory: DemoInventoryItem[] = [];
export const customsEntries: DemoCustomsEntry[] = [];

restaurants.forEach((r, ri) => {
  const itemCount = 14 + (ri % 4);
  for (let k = 0; k < itemCount; k++) {
    const category = INV_CATEGORIES[(ri + k) % INV_CATEGORIES.length]!;
    const unit = UNITS[(ri + k) % UNITS.length]!;
    const ideal = intBetween(40, 220);
    const qty = intBetween(0, Math.round(ideal * 1.1));
    const isImported = k % 5 === 0;
    const id = `inv-${r.id}-${k + 1}`;
    const item: DemoInventoryItem = {
      id,
      restaurant_id: r.id,
      sku: `SKU-${r.id.slice(-3).toUpperCase()}-${(k + 1).toString().padStart(3, "0")}`,
      name: `${pick(["Fresh", "Frozen", "Dried", "Canned", "Bulk"])} ${pick(["Tomatoes", "Mozzarella", "Basil", "Chicken", "Salmon", "Rice", "Noodles", "Tortillas", "Avocado", "Coffee Beans", "Chocolate", "Spice Mix", "Cooking Oil", "Packaging Box"])}`,
      category,
      unit,
      quantity_on_hand: qty,
      reorder_level: Math.round(ideal * 0.25),
      ideal_stock: ideal,
      unit_cost: round2(between(8, 320)),
      supplier: SUPPLIERS[(ri + k) % SUPPLIERS.length]!,
      is_perishable: ["Produce", "Proteins", "Dairy"].includes(category),
      shelf_life_days: ["Produce", "Proteins", "Dairy"].includes(category) ? intBetween(2, 12) : null,
      last_counted_at: minutesAgo(intBetween(300, 8000)),
      is_imported: isImported,
      country_of_origin: isImported ? COUNTRIES[(ri + k) % (COUNTRIES.length - 1) + 1]! : "South Africa",
    };
    inventory.push(item);

    if (isImported && k < 3) {
      const declared = round2(between(8000, 85000));
      const duty = round2(between(5, 20));
      const vat = 15;
      const excise = k % 6 === 0 ? round2(between(2, 8)) : 0;
      const statuses: DemoCustomsEntry["status"][] = ["draft", "submitted", "inspection", "held", "cleared", "rejected"];
      customsEntries.push({
        id: `cs-${id}`,
        item_id: id,
        shipment_ref: `SA-IMP-${(ri * 100 + k + 1).toString().padStart(4, "0")}`,
        hs_code: HS_SAMPLES[k % HS_SAMPLES.length]!,
        country_of_origin: item.country_of_origin ?? "Italy",
        port_of_entry: PORTS[ri % PORTS.length]!,
        incoterm: (["FOB", "CIF", "DDP", "EXW"] as const)[k % 4]!,
        declared_value: declared,
        currency: "ZAR",
        import_duty_pct: duty,
        vat_pct: vat,
        excise_pct: excise,
        total_landed_cost: round2(declared * (1 + duty / 100 + vat / 100 + excise / 100) + 450),
        status: statuses[k % statuses.length]!,
        documents: [
          { name: "Commercial invoice", status: "present" },
          { name: "Packing list", status: "present" },
          { name: "SADC certificate", status: k % 3 === 0 ? "missing" : "present" },
          { name: "Health certificate", status: k % 4 === 0 ? "missing" : "present" },
        ],
        eta: iso(new Date(Date.now() + between(1, 10) * 86_400_000)),
        arrived_at: k % 5 === 0 ? minutesAgo(intBetween(60, 4000)) : null,
        cleared_at: k % 6 === 0 ? minutesAgo(intBetween(60, 4000)) : null,
        notes: k % 3 === 0 ? "Awaiting SADC certificate before release." : null,
      });
    }
  }
});

/* ------------------------------------------------ promotions & promo codes */

export type PromoType = "percent" | "fixed" | "free_delivery" | "bogo";
export type PromoScope = "platform" | "restaurant" | "first_order";

export interface DemoPromotion {
  id: string;
  code: string;
  name: string;
  description: string;
  type: PromoType;
  value: number;
  scope: PromoScope;
  restaurant_id: string | null;
  min_order: number;
  max_discount: number | null;
  usage_limit: number | null;
  usage_count: number;
  starts_at: string;
  expires_at: string;
  is_active: boolean;
  created_at: string;
}

export const promotions: DemoPromotion[] = [
  {
    id: "pr-1",
    code: "WELCOME20",
    name: "First-order 20% off",
    description: "20% off for every new customer, capped at R80.",
    type: "percent",
    value: 20,
    scope: "first_order",
    restaurant_id: null,
    min_order: 0,
    max_discount: 80,
    usage_limit: null,
    usage_count: 412,
    starts_at: minutesAgo(60 * 24 * 60),
    expires_at: iso(new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)),
    is_active: true,
    created_at: minutesAgo(60 * 24 * 90),
  },
  {
    id: "pr-2",
    code: "FREESHIP",
    name: "Free delivery Friday",
    description: "Waives the delivery fee on orders over R120 sitewide.",
    type: "free_delivery",
    value: 0,
    scope: "platform",
    restaurant_id: null,
    min_order: 120,
    max_discount: null,
    usage_limit: 5000,
    usage_count: 3270,
    starts_at: minutesAgo(60 * 24 * 30),
    expires_at: iso(new Date(Date.now() + 60 * 24 * 14 * 60 * 1000)),
    is_active: true,
    created_at: minutesAgo(60 * 24 * 30),
  },
  {
    id: "pr-3",
    code: "NONNAS50",
    name: "R50 off at Nonna's Table",
    description: "R50 off any order of R250 or more from Nonna's Table.",
    type: "fixed",
    value: 50,
    scope: "restaurant",
    restaurant_id: "rst-1",
    min_order: 250,
    max_discount: null,
    usage_limit: 200,
    usage_count: 86,
    starts_at: minutesAgo(60 * 24 * 7),
    expires_at: iso(new Date(Date.now() + 60 * 24 * 3 * 60 * 1000)),
    is_active: true,
    created_at: minutesAgo(60 * 24 * 8),
  },
  {
    id: "pr-4",
    code: "BOGO-TACO",
    name: "Buy-one-get-one tacos",
    description: "Buy one taco plate, get a second free at Casa Verde.",
    type: "bogo",
    value: 100,
    scope: "restaurant",
    restaurant_id: "rst-3",
    min_order: 0,
    max_discount: null,
    usage_limit: 150,
    usage_count: 150,
    starts_at: minutesAgo(60 * 24 * 21),
    expires_at: minutesAgo(60 * 24 * 2),
    is_active: false,
    created_at: minutesAgo(60 * 24 * 22),
  },
];

/* --------------------------------------------------------------- accessors */

export const findRestaurant = (id: string) => restaurants.find((r) => r.id === id);
export const findDriver = (id: string) => drivers.find((d) => d.id === id);
export const findCustomer = (id: string) => customers.find((c) => c.id === id);
export const findOrder = (id: string) => orders.find((o) => o.id === id);
export const itemsForOrder = (orderId: string) => orderItems.filter((i) => i.order_id === orderId);

/** Simulates a tiny amount of latency so loading states stay visible. */
export const delay = (ms = 90) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const slugify = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/**
 * Callers were written against server functions, which take `{ data: input }`.
 * The demo functions accept either shape.
 */
export function unwrap<T>(arg: T | { data: T } | undefined): T | undefined {
  if (arg && typeof arg === "object" && "data" in (arg as Record<string, unknown>)) {
    return (arg as { data: T }).data;
  }
  return arg as T | undefined;
}
