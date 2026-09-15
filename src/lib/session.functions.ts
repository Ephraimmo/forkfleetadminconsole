import {
  delay,
  logAudit,
  permissions as allPermissions,
  profiles,
  rolePermissions,
  userRoles,
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

const DEMO_KEY = "forkfleet.demo.session";
const DEMO_USER_ID_KEY = `${DEMO_KEY}.user_id`;
const DEMO_EMAIL_KEY = `${DEMO_KEY}.email`;
const FIREBASE_SESSION_KEY = "forkfleet.firebase.session";
const DEFAULT_DEMO_USER_ID = "usr-1";

/** Pre-seeded static credentials used by the /auth screen. Passwords are demo-only. */
export interface DemoCredential {
  email: string;
  password: string;
  label: string;
  rolePreview: string;
}

export const DEMO_CREDENTIALS: DemoCredential[] = [
  {
    email: "karaboephraim2@gmail.com",
    password: "Ephraim@217377781",
    label: "Super Admin",
    rolePreview: "Super Admin - Full Access",
  },
];

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

/** Builds a console session from an explicit role set (Firebase-provisioned users). */
export function buildSessionForRoles(input: {
  userId: string;
  email: string;
  fullName: string | null;
  jobTitle: string | null;
  roles: StaffRole[];
}): StaffSession {
  const codes = new Set(
    rolePermissions
      .filter((rp) => input.roles.includes(rp.role as StaffRole))
      .map((rp) => rp.permission_code),
  );
  return {
    userId: input.userId,
    email: input.email,
    fullName: input.fullName,
    jobTitle: input.jobTitle,
    roles: input.roles,
    permissions: Array.from(codes),
  };
}

/** True when the operator has "signed in" (demo quick account or Firebase account). */
export function isDemoSignedIn(): boolean {
  return readLS(DEMO_KEY) === "1" || readStoredFirebaseSession() !== null;
}

/** Return the signed-in demo user id (or the default Super Admin id if none set). */
export function getDemoUserId(): string {
  return readLS(DEMO_USER_ID_KEY) ?? DEFAULT_DEMO_USER_ID;
}

/** Return the signed-in demo email override (or null). */
export function getDemoEmailOverride(): string | null {
  return readLS(DEMO_EMAIL_KEY);
}

export interface DemoSignInResult {
  ok: boolean;
  error?: "invalid_credentials";
  session?: StaffSession;
}

export async function signInDemoWithCredentials(input: {
  email: string;
  password: string;
}): Promise<DemoSignInResult> {
  await delay(250);
  const normalizedEmail = input.email.trim().toLowerCase();
  const match = DEMO_CREDENTIALS.find((c) => c.email.toLowerCase() === normalizedEmail);
  if (!match || input.password !== match.password) {
    return { ok: false, error: "invalid_credentials" };
  }
  const profile = profiles.find((p) => p.email.toLowerCase() === normalizedEmail);
  if (!profile) return { ok: false, error: "invalid_credentials" };

  writeLS(DEMO_KEY, "1");
  writeLS(DEMO_USER_ID_KEY, profile.user_id);
  writeLS(DEMO_EMAIL_KEY, profile.email);

  logAudit({
    action: "auth.sign_in",
    entityType: "staff",
    entityId: profile.user_id,
    after: { email: profile.email },
  });

  return { ok: true, session: buildSessionForProfile(profile) };
}

export function signInDemoAs(userId: string) {
  const profile = profiles.find((p) => p.user_id === userId);
  if (!profile) return;
  writeLS(DEMO_KEY, "1");
  writeLS(DEMO_USER_ID_KEY, profile.user_id);
  writeLS(DEMO_EMAIL_KEY, profile.email);
}

export function signOutDemo() {
  writeLS(DEMO_KEY, null);
  writeLS(DEMO_USER_ID_KEY, null);
  writeLS(DEMO_EMAIL_KEY, null);
}

function buildSessionForProfile(profile: (typeof profiles)[number]): StaffSession {
  const roles = userRoles
    .filter((r) => r.user_id === profile.user_id)
    .map((r) => r.role as StaffRole);
  const codes = new Set(
    rolePermissions
      .filter((rp) => roles.includes(rp.role as StaffRole))
      .map((rp) => rp.permission_code),
  );
  return {
    userId: profile.user_id,
    email: profile.email,
    fullName: profile.full_name,
    jobTitle: profile.job_title,
    roles,
    permissions: codes.size > 0 ? Array.from(codes) : allPermissions.map((p) => p.code),
  };
}

/** Synchronous session used for the initial React render (no await) so that
 *  the sidebar already has permissions on first paint — avoids the "empty
 *  menu" flash while the async query resolves. Firebase sessions are cached
 *  locally; the async getStaffSession() re-validates them against the database. */
export function buildDemoSessionSync(): StaffSession | null {
  if (!isDemoSignedIn()) return null;
  const firebaseSession = readStoredFirebaseSession();
  if (firebaseSession) return firebaseSession;
  const userId = getDemoUserId();
  const emailOverride = getDemoEmailOverride();
  const profile =
    profiles.find((p) => p.user_id === userId) ??
    (emailOverride ? profiles.find((p) => p.email === emailOverride) : undefined) ??
    profiles.find((p) => p.user_id === DEFAULT_DEMO_USER_ID);
  if (!profile) return null;
  return buildSessionForProfile(profile);
}

/** Resolves the currently signed-in staff session. Firebase sessions are
 *  refreshed live from /staffUsers/{uid} so role changes, suspensions and
 *  removals apply without waiting for a fresh sign-in. */
export async function getStaffSession(): Promise<StaffSession | null> {
  await delay(40);
  const firebaseSession = readStoredFirebaseSession();
  if (firebaseSession) {
    try {
      const { refreshFirebaseSession } = await import("@/lib/auth.firebase");
      return await refreshFirebaseSession(firebaseSession);
    } catch {
      return firebaseSession;
    }
  }
  if (!readLS(DEMO_KEY)) return null;
  const userId = getDemoUserId();
  const emailOverride = getDemoEmailOverride();
  const profile =
    profiles.find((p) => p.user_id === userId) ??
    (emailOverride ? profiles.find((p) => p.email === emailOverride) : undefined) ??
    profiles.find((p) => p.user_id === DEFAULT_DEMO_USER_ID)!;
  return buildSessionForProfile(profile);
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
