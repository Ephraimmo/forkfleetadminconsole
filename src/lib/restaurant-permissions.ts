// Permission catalog for the Restaurant Management application.
// These codes are stored on /restaurantUsers/{uid}/permissions and consumed
// by the separate Restaurant Management app in Step 2.

export type RestaurantRole =
  | "restaurant_owner"
  | "restaurant_manager"
  | "branch_manager"
  | "kitchen_manager"
  | "kitchen_staff"
  | "cashier"
  | "inventory_manager";

export const RESTAURANT_ROLES: RestaurantRole[] = [
  "restaurant_owner",
  "restaurant_manager",
  "branch_manager",
  "kitchen_manager",
  "kitchen_staff",
  "cashier",
  "inventory_manager",
];

export interface RestaurantPermission {
  code: string;
  module: string;
  description: string;
  actions: ("view" | "create" | "edit" | "delete" | "manage")[];
}

/** Modules that exist in the Restaurant Management application. */
export const RESTAURANT_PERMISSIONS: RestaurantPermission[] = [
  {
    code: "rm.dashboard.view",
    module: "dashboard",
    description: "View restaurant dashboard and KPIs",
    actions: ["view"],
  },
  {
    code: "rm.profile.view",
    module: "profile",
    description: "View restaurant profile and branding",
    actions: ["view"],
  },
  {
    code: "rm.profile.manage",
    module: "profile",
    description: "Edit restaurant profile, hours and contact details",
    actions: ["edit", "manage"],
  },
  {
    code: "rm.menu.view",
    module: "menu",
    description: "View menu categories, products and pricing",
    actions: ["view"],
  },
  {
    code: "rm.menu.manage",
    module: "menu",
    description: "Create and edit menu categories and products",
    actions: ["create", "edit", "delete", "manage"],
  },
  {
    code: "rm.orders.view",
    module: "orders",
    description: "View incoming and historical orders",
    actions: ["view"],
  },
  {
    code: "rm.orders.manage",
    module: "orders",
    description: "Accept, advance and cancel orders",
    actions: ["edit", "manage"],
  },
  {
    code: "rm.kitchen.view",
    module: "kitchen",
    description: "View the kitchen preparation queue",
    actions: ["view"],
  },
  {
    code: "rm.kitchen.manage",
    module: "kitchen",
    description: "Mark items prepared and manage kitchen flow",
    actions: ["edit", "manage"],
  },
  {
    code: "rm.tables.view",
    module: "tables",
    description: "View table layout and seating status",
    actions: ["view"],
  },
  {
    code: "rm.tables.manage",
    module: "tables",
    description: "Manage table assignments and reservations",
    actions: ["create", "edit", "delete", "manage"],
  },
  {
    code: "rm.customers.view",
    module: "customers",
    description: "View customer directory for this restaurant",
    actions: ["view"],
  },
  {
    code: "rm.customers.manage",
    module: "customers",
    description: "Edit customer records and loyalty data",
    actions: ["edit", "manage"],
  },
  {
    code: "rm.inventory.view",
    module: "inventory",
    description: "View stock levels and ingredients",
    actions: ["view"],
  },
  {
    code: "rm.inventory.manage",
    module: "inventory",
    description: "Adjust stock and manage inventory items",
    actions: ["create", "edit", "delete", "manage"],
  },
  {
    code: "rm.delivery.view",
    module: "delivery",
    description: "View delivery orders and dispatch board",
    actions: ["view"],
  },
  {
    code: "rm.delivery.manage",
    module: "delivery",
    description: "Assign drivers and manage deliveries",
    actions: ["edit", "manage"],
  },
  {
    code: "rm.drivers.view",
    module: "drivers",
    description: "View assigned drivers for this restaurant",
    actions: ["view"],
  },
  {
    code: "rm.drivers.manage",
    module: "drivers",
    description: "Manage driver assignments for this restaurant",
    actions: ["edit", "manage"],
  },
  {
    code: "rm.payments.view",
    module: "payments",
    description: "View payment methods and transaction history",
    actions: ["view"],
  },
  {
    code: "rm.payments.manage",
    module: "payments",
    description: "Configure payment methods and reconcile",
    actions: ["edit", "manage"],
  },
  {
    code: "rm.promotions.view",
    module: "promotions",
    description: "View promotions and discount codes",
    actions: ["view"],
  },
  {
    code: "rm.promotions.manage",
    module: "promotions",
    description: "Create and publish restaurant promotions",
    actions: ["create", "edit", "delete", "manage"],
  },
  {
    code: "rm.reports.view",
    module: "reports",
    description: "View operational and sales reports",
    actions: ["view"],
  },
  {
    code: "rm.support.view",
    module: "support",
    description: "View support inquiries for this restaurant",
    actions: ["view"],
  },
  {
    code: "rm.support.manage",
    module: "support",
    description: "Reply to and resolve support inquiries for this restaurant",
    actions: ["edit", "manage"],
  },
  {
    code: "rm.settings.view",
    module: "settings",
    description: "View restaurant settings",
    actions: ["view"],
  },
  {
    code: "rm.settings.manage",
    module: "settings",
    description: "Configure restaurant settings and integrations",
    actions: ["edit", "manage"],
  },
];

export const RESTAURANT_PERMISSION_CODES = RESTAURANT_PERMISSIONS.map((p) => p.code);

export interface RestaurantRolePermission {
  role: RestaurantRole;
  permission_code: string;
}

const grant = (role: RestaurantRole, codes: string[]) => {
  for (const code of codes) entries.push({ role, permission_code: code });
};

const entries: RestaurantRolePermission[] = [];

grant("restaurant_owner", RESTAURANT_PERMISSION_CODES);
grant("restaurant_manager", [
  "rm.dashboard.view",
  "rm.profile.view",
  "rm.profile.manage",
  "rm.menu.view",
  "rm.menu.manage",
  "rm.orders.view",
  "rm.orders.manage",
  "rm.kitchen.view",
  "rm.kitchen.manage",
  "rm.tables.view",
  "rm.tables.manage",
  "rm.customers.view",
  "rm.customers.manage",
  "rm.inventory.view",
  "rm.inventory.manage",
  "rm.delivery.view",
  "rm.delivery.manage",
  "rm.drivers.view",
  "rm.promotions.view",
  "rm.reports.view",
  "rm.support.view",
  "rm.support.manage",
  "rm.settings.view",
]);
grant("branch_manager", [
  "rm.dashboard.view",
  "rm.profile.view",
  "rm.orders.view",
  "rm.orders.manage",
  "rm.kitchen.view",
  "rm.kitchen.manage",
  "rm.tables.view",
  "rm.tables.manage",
  "rm.customers.view",
  "rm.inventory.view",
  "rm.reports.view",
  "rm.support.view",
]);
grant("kitchen_manager", [
  "rm.orders.view",
  "rm.orders.manage",
  "rm.kitchen.view",
  "rm.kitchen.manage",
  "rm.menu.view",
  "rm.inventory.view",
  "rm.inventory.manage",
]);
grant("kitchen_staff", ["rm.orders.view", "rm.kitchen.view", "rm.kitchen.manage"]);
grant("cashier", [
  "rm.orders.view",
  "rm.orders.manage",
  "rm.tables.view",
  "rm.tables.manage",
  "rm.customers.view",
  "rm.promotions.view",
]);
grant("inventory_manager", [
  "rm.menu.view",
  "rm.inventory.view",
  "rm.inventory.manage",
  "rm.reports.view",
  "rm.orders.view",
]);

export const RESTAURANT_ROLE_PERMISSIONS: RestaurantRolePermission[] = entries;

export function isRestaurantRole(value: string): value is RestaurantRole {
  return (RESTAURANT_ROLES as string[]).includes(value);
}

export function isRestaurantPermission(value: string): boolean {
  return RESTAURANT_PERMISSION_CODES.includes(value);
}

export function getDefaultPermissionsForRole(role: RestaurantRole): string[] {
  return RESTAURANT_ROLE_PERMISSIONS.filter((rp) => rp.role === role).map(
    (rp) => rp.permission_code,
  );
}

/**
 * Firebase RTDB object keys cannot contain ".", "#", "$", "/", "[", or "]".
 * Permission codes like "rm.dashboard.view" must be encoded before map storage.
 */
export function encodePermissionKeyForRtdb(code: string): string {
  return code.replace(/\./g, "_");
}

export function decodePermissionKeyFromRtdb(key: string): string {
  if (key.includes(".")) return key;
  if (!key.startsWith("rm_")) return key;
  return key.split("_").join(".");
}

/** Returns true when every key is safe for Firebase RTDB object maps. */
export function isRtdbSafePermissionMap(map: Record<string, boolean>): boolean {
  return Object.keys(map).every(
    (key) => key.length > 0 && !/[.#$/[\]]/.test(key),
  );
}

export function permissionsToMap(codes: string[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const code of codes.filter(isRestaurantPermission)) {
    map[encodePermissionKeyForRtdb(code)] = true;
  }
  return map;
}

export function mapToPermissions(map: Record<string, boolean> | null | undefined): string[] {
  return Object.entries(map ?? {})
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => decodePermissionKeyFromRtdb(key))
    .filter(isRestaurantPermission);
}

export const RESTAURANT_ROLE_LABELS: Record<RestaurantRole, string> = {
  restaurant_owner: "Restaurant Owner",
  restaurant_manager: "Restaurant Manager",
  branch_manager: "Branch Manager",
  kitchen_manager: "Kitchen Manager",
  kitchen_staff: "Kitchen Staff",
  cashier: "Cashier",
  inventory_manager: "Inventory Manager",
};

export function restaurantRoleLabel(role: RestaurantRole): string {
  return RESTAURANT_ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}
