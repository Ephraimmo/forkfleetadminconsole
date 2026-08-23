// Firebase-backed driver fleet layer for the Operations Console.
//
// Drivers are registered by the Driver App under /drivers/{driverId} and must
// appear in the Driver Management page IN REAL TIME. This module replaces the
// in-memory demo driver array for all driver-fleet reads and mutations.
//
// Shared data contract (do not rename fields):
//   /drivers/{driverId}                                -> driver profile
//   /driverAssignments/{driverId}__{restaurantId}__{branchId} -> assignment
//
// No demo drivers are seeded. Empty DB => empty driver list, exactly like the
// orders layer already behaves.

import {
  isFirebaseAvailable,
  rtdbGet,
  rtdbSet,
  rtdbSubscribe,
  rtdbUpdate,
} from "@/lib/firebase";

export type DriverStatus =
  | "offline"
  | "online"
  | "busy"
  | "suspended"
  | "pending"
  | "rejected";

/** Mirrors /drivers/{driverId} as written by the Driver App. */
export interface FirebaseDriver {
  id: string;
  user_id?: string | null;
  full_name?: string;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  status?: DriverStatus | string;
  is_active?: boolean;
  is_deleted?: boolean;
  is_verified?: boolean;
  rating?: number;
  total_deliveries?: number;
  wallet_balance?: number;
  vehicle_type?: string | null;
  vehicle_plate?: string | null;
  license_number?: string | null;
  id_number?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  preferred_language?: string | null;
  verification_submitted_at?: string | null;
  rejection_reason?: string | null;
  current_latitude?: number | null;
  current_longitude?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_online_at?: string | null;
  last_offline_at?: string | null;
}

/** Mirrors /driverAssignments/{driverId}__{restaurantId}__{branchId}. */
export interface DriverAssignment {
  id: string;
  driver_id: string;
  restaurant_id: string;
  branch_id: string;
  restaurant_name?: string | null;
  branch_name?: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  deactivated_at?: string | null;
}

const DRIVERS_PATH = "drivers";
const ASSIGNMENTS_PATH = "driverAssignments";
const nowIso = () => new Date().toISOString();

export function assignmentKey(driverId: string, restaurantId: string, branchId: string): string {
  return `${driverId}__${restaurantId}__${branchId}`;
}

function normalizeDriver(raw: FirebaseDriver | null | undefined, key: string): FirebaseDriver {
  return { ...(raw ?? {}), id: raw?.id ?? key };
}

function toDriverList(map: Record<string, FirebaseDriver> | null): FirebaseDriver[] {
  if (!map) return [];
  return Object.entries(map)
    .filter(([key]) => key !== "live") // skip /drivers/live (GPS tracking)
    .map(([key, value]) => normalizeDriver(value, key))
    .filter((d) => d.is_deleted !== true)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

/** One-shot read (used by server-side fallbacks / non-reactive consumers). */
export async function listFirebaseDrivers(): Promise<FirebaseDriver[]> {
  if (!isFirebaseAvailable()) return [];
  return toDriverList(await rtdbGet<Record<string, FirebaseDriver>>(DRIVERS_PATH));
}

/** One-shot read of a single driver profile. Returns null when Firebase is unavailable. */
export async function getFirebaseDriver(driverId: string): Promise<FirebaseDriver | null> {
  if (!isFirebaseAvailable()) return null;
  const raw = await rtdbGet<FirebaseDriver>(`${DRIVERS_PATH}/${driverId}`);
  return raw ? normalizeDriver(raw, driverId) : null;
}

/** Real-time driver list. New registrations appear immediately. */
export function subscribeFirebaseDrivers(cb: (rows: FirebaseDriver[]) => void): () => void {
  if (!isFirebaseAvailable()) {
    cb([]);
    return () => {};
  }
  return rtdbSubscribe<Record<string, FirebaseDriver>>(DRIVERS_PATH, (val) => cb(toDriverList(val)));
}

function assertFirebase(): void {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
}

/* ------------------------------------------------------ approval actions */

/** Approve a self-registered driver: offline, verified and active. */
export async function approveDriver(driverId: string): Promise<void> {
  assertFirebase();
  await rtdbUpdate(`${DRIVERS_PATH}/${driverId}`, {
    status: "offline",
    is_verified: true,
    is_active: true,
    updated_at: nowIso(),
  });
}

/** Decline a registration. Driver stays inactive and cannot go online. */
export async function rejectDriver(driverId: string, reason?: string): Promise<void> {
  assertFirebase();
  const patch: Record<string, string | boolean | null> = {
    status: "rejected",
    is_active: false,
    updated_at: nowIso(),
  };
  if (reason) patch["rejection_reason"] = reason;
  await rtdbUpdate(`${DRIVERS_PATH}/${driverId}`, patch);
}

/** Suspend a driver: blocks new order offers immediately. */
export async function suspendDriver(driverId: string): Promise<void> {
  assertFirebase();
  await rtdbUpdate(`${DRIVERS_PATH}/${driverId}`, {
    status: "suspended",
    is_active: false,
    updated_at: nowIso(),
  });
}

/** Re-activate a suspended driver (they must go online again). */
export async function reactivateDriver(driverId: string): Promise<void> {
  assertFirebase();
  await rtdbUpdate(`${DRIVERS_PATH}/${driverId}`, {
    status: "offline",
    is_active: true,
    updated_at: nowIso(),
  });
}

/* ------------------------------------------------------ branch assignment */

/** Active assignments for one driver, in real time. */
export function subscribeDriverAssignments(
  driverId: string,
  cb: (rows: DriverAssignment[]) => void,
): () => void {
  if (!isFirebaseAvailable()) {
    cb([]);
    return () => {};
  }
  return rtdbSubscribe<Record<string, DriverAssignment>>(ASSIGNMENTS_PATH, (val) => {
    const rows = Object.entries(val ?? {})
      .filter(([, a]) => !!a && a.driver_id === driverId && a.is_active === true)
      .map(([key, a]) => ({ ...a, id: a.id || key }));
    cb(rows);
  });
}

/** ALL assignments for one driver (active + history), in real time. */
export function subscribeDriverAssignmentsHistory(
  driverId: string,
  cb: (rows: DriverAssignment[]) => void,
): () => void {
  if (!isFirebaseAvailable()) {
    cb([]);
    return () => {};
  }
  return rtdbSubscribe<Record<string, DriverAssignment>>(ASSIGNMENTS_PATH, (val) => {
    const rows = Object.entries(val ?? {})
      .filter(([, a]) => !!a && a.driver_id === driverId)
      .map(([key, a]) => ({ ...a, id: a.id || key }));
    cb(rows.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))));
  });
}

/** ALL active assignments (every driver), in real time. */
export function subscribeActiveAssignments(cb: (rows: DriverAssignment[]) => void): () => void {
  if (!isFirebaseAvailable()) {
    cb([]);
    return () => {};
  }
  return rtdbSubscribe<Record<string, DriverAssignment>>(ASSIGNMENTS_PATH, (val) => {
    const rows = Object.entries(val ?? {})
      .filter(([, a]) => !!a && a.is_active === true)
      .map(([key, a]) => ({ ...a, id: a.id || key }));
    cb(rows);
  });
}

/**
 * Normalize a branch id for comparison. Branch keys are written inconsistently
 * across the ecosystem (e.g. "main" vs "brn-main"), so compare on a canonical
 * form: lowercase, trimmed, with a leading "brn-"/"branch-" prefix removed.
 */
export function normalizeBranchKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^brn[-_]/, "")
    .replace(/^branch[-_ ]?/, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Normalize a restaurant id for comparison. Restaurant ids are written
 * inconsistently across the ecosystem (e.g. "rst-burgerlab" vs "burgerlab"),
 * so compare on a canonical form: lowercase, trimmed, with a leading
 * "rst-"/"restaurant-"/"r-" prefix removed and separators collapsed.
 */
export function normalizeRestaurantKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^rst-/, "")
    .replace(/^restaurant-/, "")
    .replace(/^r-/, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * "Fully approved" means verified AND not pending/suspended/rejected. Status
 * online/offline is irrelevant to approval — a freshly approved driver is
 * "offline" and must still be assignable from the console.
 */
export function isApprovedDriver(d: {
  is_verified?: boolean | null;
  status?: string | null;
}): boolean {
  if (d.is_verified !== true) return false;
  const s = String(d.status ?? "").toLowerCase();
  return !["pending", "suspended", "rejected"].includes(s);
}

/**
 * Pure check: does the driver hold an active assignment for this restaurant and
 * branch? When the order has no branch (legacy), any active branch of the
 * restaurant satisfies the match. Branch ids are compared on their normalized
 * form so "main" and "brn-main" match.
 */
export function hasActiveAssignment(
  rows: DriverAssignment[],
  driverId: string,
  restaurantId: string | null | undefined,
  branchId: string | null | undefined,
): boolean {
  if (!restaurantId) return false;
  const branchKey = normalizeBranchKey(branchId);
  const restaurantKey = normalizeRestaurantKey(restaurantId);
  return rows.some((a) => {
    if (!a || a.is_active !== true || a.driver_id !== driverId) return false;
    if (normalizeRestaurantKey(a.restaurant_id) !== restaurantKey) return false;
    if (!branchKey) return true; // legacy order without a branch
    return normalizeBranchKey(a.branch_id) === branchKey;
  });
}

/**
 * Authoritative eligibility check used to guard order assignment: the driver
 * must be approved (verified + not pending/suspended/rejected) and hold an
 * active assignment for the order's exact restaurant and branch.
 */
export async function isDriverEligibleForBranch(
  driverId: string,
  restaurantId: string | null | undefined,
  branchId: string | null | undefined,
): Promise<{ eligible: boolean; reason?: string }> {
  if (!isFirebaseAvailable()) {
    return { eligible: false, reason: "Firebase unavailable" };
  }
  if (!restaurantId) {
    return { eligible: false, reason: "Order has no authoritative restaurant." };
  }
  const driver = await getFirebaseDriver(driverId);
  if (!driver) return { eligible: false, reason: "Driver not found." };
  if (!isApprovedDriver(driver)) {
    return { eligible: false, reason: "This driver is not approved and active." };
  }
  const assignments = await rtdbGet<Record<string, DriverAssignment>>(ASSIGNMENTS_PATH);
  const rows = Object.values(assignments ?? {}).filter((a) => !!a && a.is_active === true);
  if (!hasActiveAssignment(rows, driverId, restaurantId, branchId)) {
    return {
      eligible: false,
      reason: "This driver is not assigned to the order's restaurant and branch.",
    };
  }
  return { eligible: true };
}

/** Grant one exact (driver, restaurant, branch) tuple. */
export async function assignDriverToBranch(
  driverId: string,
  restaurantId: string,
  branchId: string,
  names: { restaurant_name?: string; branch_name?: string } = {},
): Promise<void> {
  assertFirebase();
  const key = assignmentKey(driverId, restaurantId, branchId);
  await rtdbSet(`${ASSIGNMENTS_PATH}/${key}`, {
    id: key,
    driver_id: driverId,
    restaurant_id: restaurantId,
    branch_id: branchId,
    restaurant_name: names.restaurant_name ?? restaurantId,
    branch_name: names.branch_name ?? branchId,
    is_active: true,
    created_at: nowIso(),
    updated_at: nowIso(),
    deactivated_at: null,
  });
}

/** "All branches" expands to one concrete assignment per branch — never store "*". */
export async function assignDriverToAllBranches(
  driverId: string,
  restaurantId: string,
  branches: { id: string; name?: string }[],
  restaurantName?: string,
): Promise<void> {
  for (const branch of branches) {
    const names: { restaurant_name?: string; branch_name?: string } = {};
    if (restaurantName) names.restaurant_name = restaurantName;
    if (branch.name) names.branch_name = branch.name;
    await assignDriverToBranch(driverId, restaurantId, branch.id, names);
  }
}

/** Removing a branch sets is_active=false and preserves history (never deletes). */
export async function removeDriverBranch(key: string): Promise<void> {
  assertFirebase();
  await rtdbUpdate(`${ASSIGNMENTS_PATH}/${key}`, {
    is_active: false,
    deactivated_at: nowIso(),
    updated_at: nowIso(),
  });
}
