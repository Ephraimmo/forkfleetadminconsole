import {
  logAudit,
  permissions as allPermissions,
  rolePermissions,
} from "@/lib/demo-store";

export type StaffRole =
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

export interface StaffSession {
  userId: string;
  email: string;
  fullName: string | null;
  jobTitle: string | null;
  roles: StaffRole[];
  permissions: string[];
}

/** Every grantable staff role on the platform. */
export const STAFF_ROLES: StaffRole[] = [
  "super_admin",
  "platform_admin",
  "restaurant_owner",
  "restaurant_manager",
  "kitchen_manager",
  "kitchen_staff",
  "cashier",
  "dispatcher",
  "finance_manager",
  "customer_support",
  "marketing_manager",
  "inventory_manager",
  "branch_manager",
  "operations_manager",
  "auditor",
];

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as string[]).includes(value);
}

const FIREBASE_SESSION_KEY = "forkfleet.firebase.session";

function readLS(key: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

function writeLS(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
}

/* --------------------------------------------- Firebase session persistence */

/** Reads the cached Firebase-authenticated staff session (null when none). */
export function readStoredFirebaseSession(): StaffSession | null {
  const raw = readLS(FIREBASE_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StaffSession;
    return typeof parsed.userId === "string" && Array.isArray(parsed.roles) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredFirebaseSession(session: StaffSession): void {
  writeLS(FIREBASE_SESSION_KEY, JSON.stringify(session));
}

export function clearStoredFirebaseSession(): void {
  writeLS(FIREBASE_SESSION_KEY, null);
}

/** Builds a console session from an explicit role set (Firebase-provisioned users).
 *  `grantAll` unions every platform permission code — used for the platform owner. */
export function buildSessionForRoles(input: {
  userId: string;
  email: string;
  fullName: string | null;
  jobTitle: string | null;
  roles: StaffRole[];
  grantAll?: boolean;
}): StaffSession {
  const codes = new Set(
    rolePermissions
      .filter((rp) => input.roles.includes(rp.role as StaffRole))
      .map((rp) => rp.permission_code),
  );
  if (input.grantAll) {
    for (const permission of allPermissions) codes.add(permission.code);
  }
  return {
    userId: input.userId,
    email: input.email,
    fullName: input.fullName,
    jobTitle: input.jobTitle,
    roles: input.roles,
    permissions: Array.from(codes),
  };
}

/** True when a Firebase-authenticated operator session exists on this device. */
export function isSignedInLocally(): boolean {
  return readStoredFirebaseSession() !== null;
}

/** Synchronous session used for the initial React render (no await) so that
 *  the sidebar already has permissions on first paint — avoids the "empty
 *  menu" flash while the async query resolves. The async getStaffSession()
 *  re-validates the cached session against Firestore. */
export function getStoredSessionSync(): StaffSession | null {
  return readStoredFirebaseSession();
}

/** Resolves the currently signed-in staff session. Sessions are refreshed
 *  live from staffUsers/{uid} so role changes, suspensions and removals apply
 *  without waiting for a fresh sign-in. */
export async function getStaffSession(): Promise<StaffSession | null> {
  const stored = readStoredFirebaseSession();
  if (!stored) return null;
  try {
    const { refreshFirebaseSession } = await import("@/lib/auth.firebase");
    return await refreshFirebaseSession(stored);
  } catch {
    return stored; // database unreachable — keep the cached session rather than locking the operator out
  }
}

export async function recordAuditEvent(input: {
  action: string;
  entityType: string;
  entityId?: string;
  after?: unknown;
}) {
  logAudit({
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    after: (input.after ?? null) as Record<string, string | number | boolean | null> | null,
  });
  return { ok: true };
}
