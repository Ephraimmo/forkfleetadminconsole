// Firebase-backed Restaurant Management user provisioning.
//
// Wire-up:
//   Firebase Auth (Email/Password)  -> shared credential store
//   /restaurantUsers/{uid}          -> profile, restaurant assignment, role, permissions
//   /restaurantUserAudit/{id}       -> append-only audit trail
//
// Restaurant Management users are distinct from platform staff (/staffUsers).
// A user belongs to exactly one restaurant; assignment is set by Super Admin.

import { generateStaffPassword } from "@/lib/auth.firebase";
import {
  FIREBASE_CONFIG,
  isFirebaseAvailable,
  rtdbGet,
  rtdbGetWithApp,
  rtdbPush,
  rtdbSetWithApp,
  rtdbSubscribe,
  rtdbUpdate,
} from "@/lib/firebase";
import {
  getDefaultPermissionsForRole,
  isRestaurantPermission,
  isRestaurantRole,
  mapToPermissions,
  permissionsToMap,
  type RestaurantRole,
} from "@/lib/restaurant-permissions";

export type RestaurantUserStatus = "active" | "suspended";

export { generateStaffPassword as generateRestaurantUserPassword };

/** Wire shape persisted at /restaurantUsers/{uid}. */
interface RestaurantUserRaw {
  uid?: string;
  email?: string;
  full_name?: string | null;
  job_title?: string | null;
  phone?: string | null;
  restaurant_id?: string | null;
  role?: string | null;
  permissions?: Record<string, boolean> | null;
  status?: string | null;
  is_deleted?: boolean | null;
  created_at?: string | null;
  created_by?: string | null;
  updated_at?: string | null;
  last_login_at?: string | null;
}

/** Normalised record surfaced to the Access Control UI. */
export interface RestaurantUserRecord {
  uid: string;
  email: string;
  full_name: string;
  job_title: string | null;
  phone: string | null;
  restaurant_id: string;
  role: RestaurantRole;
  permissions: string[];
  status: RestaurantUserStatus;
  created_at: string;
  created_by: string | null;
  last_login_at: string | null;
}

/** Session payload the Restaurant Management app will consume in Step 2. */
export interface RestaurantUserSession {
  userId: string;
  email: string;
  fullName: string | null;
  jobTitle: string | null;
  phone: string | null;
  restaurantId: string;
  role: RestaurantRole;
  permissions: string[];
}

export const RESTAURANT_USERS_PATH = "restaurantUsers";
const RESTAURANT_USER_AUDIT_PATH = "restaurantUserAudit";
const PROVISIONER_APP_NAME = "forkfleet-provisioner";
const MAIN_APP_NAME = "forkfleet-main";

const nowIso = () => new Date().toISOString();

type FirebaseApp = Awaited<ReturnType<typeof import("firebase/app").initializeApp>>;
type FirebaseAuth = Awaited<ReturnType<typeof import("firebase/auth").getAuth>>;

function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string } | null | undefined)?.code ?? "";
  switch (code) {
    case "auth/email-already-in-use":
      return "That email is already registered. If a previous attempt failed part-way, try the same email and password again — the system will complete the profile.";
    case "auth/invalid-email":
      return "That email address doesn't look valid.";
    case "auth/weak-password":
      return "Password is too weak — use at least 8 characters with letters and numbers.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error — check the connection and try again.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    default:
      return err instanceof Error && err.message ? err.message : "Unexpected Firebase error.";
  }
}

function friendlyRtdbError(err: unknown): string {
  const code = (err as { code?: string } | null | undefined)?.code ?? "";
  if (code === "PERMISSION_DENIED") {
    return "Database permission denied. Deploy the updated database.rules.json from this project, or ensure Realtime Database rules allow provisioning.";
  }
  return err instanceof Error && err.message ? err.message : "Failed to save user profile.";
}

async function writeRestaurantUserProfile(
  uid: string,
  record: RestaurantUserRecord,
): Promise<void> {
  await rtdbSetWithApp(
    PROVISIONER_APP_NAME,
    `${RESTAURANT_USERS_PATH}/${uid}`,
    toRawRestaurantUser(record),
  );
}

async function getMainApp(): Promise<FirebaseApp> {
  const { getApps, initializeApp } = await import("firebase/app");
  const existing = getApps().find((app) => app.name === MAIN_APP_NAME);
  return existing ?? initializeApp(FIREBASE_CONFIG, MAIN_APP_NAME);
}

async function getProvisionerAuth(): Promise<FirebaseAuth> {
  const { getApps, initializeApp } = await import("firebase/app");
  const { getAuth } = await import("firebase/auth");
  const existing = getApps().find((app) => app.name === PROVISIONER_APP_NAME);
  const app = existing ?? initializeApp(FIREBASE_CONFIG, PROVISIONER_APP_NAME);
  return getAuth(app);
}

async function writeRestaurantUserAudit(entry: {
  action: string;
  actor_email: string | null;
  target_email: string | null;
  detail?: string | null;
}): Promise<void> {
  if (!isFirebaseAvailable()) return;
  try {
    await rtdbPush(RESTAURANT_USER_AUDIT_PATH, {
      action: entry.action,
      actor_email: entry.actor_email,
      target_email: entry.target_email,
      detail: entry.detail ?? null,
      created_at: nowIso(),
    });
  } catch (err) {
    console.warn("[restaurant-users] audit write failed", err);
  }
}

export function normalizeRestaurantUser(
  raw: RestaurantUserRaw | null | undefined,
  uid: string,
): RestaurantUserRecord | null {
  if (!raw || raw.is_deleted === true) return null;
  const email = String(raw.email ?? "").trim();
  const restaurantId = String(raw.restaurant_id ?? "").trim();
  const role = raw.role ?? "";
  if (!email || !restaurantId || !isRestaurantRole(role)) return null;
  return {
    uid: raw.uid ?? uid,
    email,
    full_name: String(raw.full_name ?? "").trim(),
    job_title: raw.job_title ?? null,
    phone: raw.phone ?? null,
    restaurant_id: restaurantId,
    role,
    permissions: mapToPermissions(raw.permissions),
    status: raw.status === "suspended" ? "suspended" : "active",
    created_at: raw.created_at ?? nowIso(),
    created_by: raw.created_by ?? null,
    last_login_at: raw.last_login_at ?? null,
  };
}

function toRawRestaurantUser(record: RestaurantUserRecord): Record<string, import("./firebase").RTDBValue> {
  return {
    uid: record.uid,
    email: record.email,
    full_name: record.full_name,
    job_title: record.job_title,
    phone: record.phone,
    restaurant_id: record.restaurant_id,
    role: record.role,
    permissions: permissionsToMap(record.permissions),
    status: record.status,
    is_deleted: false,
    created_at: record.created_at,
    created_by: record.created_by,
    last_login_at: record.last_login_at,
  };
}

function toRestaurantUserList(map: Record<string, RestaurantUserRaw> | null): RestaurantUserRecord[] {
  return Object.entries(map ?? {})
    .map(([uid, raw]) => normalizeRestaurantUser(raw, uid))
    .filter((row): row is RestaurantUserRecord => row !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function buildRestaurantUserSession(record: RestaurantUserRecord): RestaurantUserSession {
  return {
    userId: record.uid,
    email: record.email,
    fullName: record.full_name || null,
    jobTitle: record.job_title,
    phone: record.phone,
    restaurantId: record.restaurant_id,
    role: record.role,
    permissions: record.permissions,
  };
}

/* ------------------------------------------------------------- provisioning */

export interface CreateRestaurantUserInput {
  email: string;
  password: string;
  fullName: string;
  jobTitle: string | null;
  phone: string | null;
  restaurantId: string;
  role: RestaurantRole;
  permissions?: string[];
  actorEmail: string | null;
}

export type CreateRestaurantUserResult =
  | { ok: true; user: RestaurantUserRecord }
  | { ok: false; error: string };

export async function createRestaurantUser(
  input: CreateRestaurantUserInput,
): Promise<CreateRestaurantUserResult> {
  if (!isFirebaseAvailable()) {
    return { ok: false, error: "Firebase is only available in the browser." };
  }
  const email = input.email.trim().toLowerCase();
  const restaurantId = input.restaurantId.trim();
  if (!restaurantId) return { ok: false, error: "Select a restaurant for this user." };
  if (!isRestaurantRole(input.role)) return { ok: false, error: "Select a valid role." };

  const permissions =
    input.permissions && input.permissions.length > 0
      ? input.permissions.filter(isRestaurantPermission)
      : getDefaultPermissionsForRole(input.role);
  if (permissions.length === 0) {
    return { ok: false, error: "Grant at least one permission." };
  }

  let auth: FirebaseAuth | null = null;
  try {
    const { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } =
      await import("firebase/auth");
    auth = await getProvisionerAuth();

    let uid: string;
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, input.password);
      uid = credential.user.uid;
    } catch (err) {
      const code = (err as { code?: string } | null | undefined)?.code ?? "";
      if (code !== "auth/email-already-in-use") {
        return { ok: false, error: friendlyAuthError(err) };
      }
      // Recover orphaned Auth accounts where profile write failed on a prior attempt.
      const recovered = await signInWithEmailAndPassword(auth, email, input.password);
      uid = recovered.user.uid;
      const existing = normalizeRestaurantUser(
        await rtdbGetWithApp<RestaurantUserRaw>(PROVISIONER_APP_NAME, `${RESTAURANT_USERS_PATH}/${uid}`),
        uid,
      );
      if (existing) {
        return {
          ok: false,
          error: "That email already has Restaurant Management access. Edit the existing user instead.",
        };
      }
    }

    const record: RestaurantUserRecord = {
      uid,
      email,
      full_name: input.fullName.trim(),
      job_title: input.jobTitle?.trim() ? input.jobTitle.trim() : null,
      phone: input.phone?.trim() ? input.phone.trim() : null,
      restaurant_id: restaurantId,
      role: input.role,
      permissions,
      status: "active",
      created_at: nowIso(),
      created_by: input.actorEmail,
      last_login_at: null,
    };

    try {
      await writeRestaurantUserProfile(uid, record);
    } catch (err) {
      return { ok: false, error: friendlyRtdbError(err) };
    }

    await writeRestaurantUserAudit({
      action: "restaurant_user.created",
      actor_email: input.actorEmail,
      target_email: email,
      detail: `restaurant: ${restaurantId}, role: ${input.role}`,
    });
    return { ok: true, user: record };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  } finally {
    if (auth) {
      try {
        const { signOut } = await import("firebase/auth");
        await signOut(auth);
      } catch {
        /* best-effort */
      }
    }
  }
}

export async function updateRestaurantUserProfile(input: {
  uid: string;
  fullName: string;
  jobTitle: string | null;
  phone: string | null;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    await rtdbUpdate(`${RESTAURANT_USERS_PATH}/${input.uid}`, {
      full_name: input.fullName.trim(),
      job_title: input.jobTitle?.trim() ? input.jobTitle.trim() : null,
      phone: input.phone?.trim() ? input.phone.trim() : null,
      updated_at: nowIso(),
    });
    await writeRestaurantUserAudit({
      action: "restaurant_user.profile_updated",
      actor_email: input.actorEmail,
      target_email: null,
      detail: `uid: ${input.uid}`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update profile." };
  }
}

export async function updateRestaurantUserAssignment(input: {
  uid: string;
  restaurantId: string;
  role: RestaurantRole;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  const restaurantId = input.restaurantId.trim();
  if (!restaurantId) return { ok: false, error: "Select a restaurant." };
  if (!isRestaurantRole(input.role)) return { ok: false, error: "Select a valid role." };
  try {
    await rtdbUpdate(`${RESTAURANT_USERS_PATH}/${input.uid}`, {
      restaurant_id: restaurantId,
      role: input.role,
      updated_at: nowIso(),
    });
    await writeRestaurantUserAudit({
      action: "restaurant_user.assignment_updated",
      actor_email: input.actorEmail,
      target_email: null,
      detail: `uid: ${input.uid} -> restaurant: ${restaurantId}, role: ${input.role}`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update assignment." };
  }
}

export async function updateRestaurantUserPermissions(input: {
  uid: string;
  permissions: string[];
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  const permissions = input.permissions.filter(isRestaurantPermission);
  if (permissions.length === 0) {
    return { ok: false, error: "Grant at least one permission." };
  }
  try {
    await rtdbUpdate(`${RESTAURANT_USERS_PATH}/${input.uid}`, {
      permissions: permissionsToMap(permissions),
      updated_at: nowIso(),
    });
    await writeRestaurantUserAudit({
      action: "restaurant_user.permissions_updated",
      actor_email: input.actorEmail,
      target_email: null,
      detail: `uid: ${input.uid} -> ${permissions.join(", ")}`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update permissions." };
  }
}

export async function setRestaurantUserStatus(input: {
  uid: string;
  status: RestaurantUserStatus;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    await rtdbUpdate(`${RESTAURANT_USERS_PATH}/${input.uid}`, {
      status: input.status,
      updated_at: nowIso(),
    });
    await writeRestaurantUserAudit({
      action: input.status === "suspended" ? "restaurant_user.suspended" : "restaurant_user.reactivated",
      actor_email: input.actorEmail,
      target_email: null,
      detail: `uid: ${input.uid}`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update status." };
  }
}

export async function removeRestaurantUser(input: {
  uid: string;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    await rtdbUpdate(`${RESTAURANT_USERS_PATH}/${input.uid}`, {
      is_deleted: true,
      status: "suspended",
      removed_at: nowIso(),
      removed_by: input.actorEmail,
    });
    await writeRestaurantUserAudit({
      action: "restaurant_user.removed",
      actor_email: input.actorEmail,
      target_email: null,
      detail: `uid: ${input.uid}`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to remove user." };
  }
}

export async function sendRestaurantUserPasswordReset(input: {
  email: string;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    const { sendPasswordResetEmail } = await import("firebase/auth");
    const auth = await getProvisionerAuth();
    await sendPasswordResetEmail(auth, input.email.trim().toLowerCase());
    await writeRestaurantUserAudit({
      action: "restaurant_user.password_reset_sent",
      actor_email: input.actorEmail,
      target_email: input.email.trim().toLowerCase(),
      detail: null,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/* ------------------------------------------------------------------- reads */

export async function fetchRestaurantUsersOnce(): Promise<RestaurantUserRecord[]> {
  if (!isFirebaseAvailable()) return [];
  return toRestaurantUserList(await rtdbGet<Record<string, RestaurantUserRaw>>(RESTAURANT_USERS_PATH));
}

export function subscribeRestaurantUsers(
  callback: (rows: RestaurantUserRecord[]) => void,
): () => void {
  if (!isFirebaseAvailable()) {
    callback([]);
    return () => {};
  }
  return rtdbSubscribe<Record<string, RestaurantUserRaw>>(RESTAURANT_USERS_PATH, (map) =>
    callback(toRestaurantUserList(map)),
  );
}

/** Resolves a restaurant user by Firebase Auth UID (for Step 2 sign-in). */
export async function fetchRestaurantUserByUid(uid: string): Promise<RestaurantUserRecord | null> {
  if (!isFirebaseAvailable()) return null;
  return normalizeRestaurantUser(
    await rtdbGet<RestaurantUserRaw>(`${RESTAURANT_USERS_PATH}/${uid}`),
    uid,
  );
}

/* ----------------------------------------------------------- sign-in (Step 2) */

export type RestaurantSignInResult =
  | { ok: true; session: RestaurantUserSession }
  | {
      ok: false;
      error: "invalid_credentials" | "no_account" | "not_provisioned" | "suspended" | "unavailable";
      message: string;
    };

/**
 * Signs a restaurant management user in with Firebase Auth and resolves their
 * session from /restaurantUsers/{uid}. Prepared for the Restaurant Management
 * application — not wired to this Super Admin console yet.
 */
export async function signInRestaurantUserWithFirebase(input: {
  email: string;
  password: string;
}): Promise<RestaurantSignInResult> {
  if (!isFirebaseAvailable()) {
    return {
      ok: false,
      error: "unavailable",
      message: "Firebase is only available in the browser.",
    };
  }
  const email = input.email.trim().toLowerCase();
  try {
    const { getAuth, signInWithEmailAndPassword, signOut } = await import("firebase/auth");
    const auth = getAuth(await getMainApp());
    const credential = await signInWithEmailAndPassword(auth, email, input.password);
    const uid = credential.user.uid;
    const record = normalizeRestaurantUser(
      await rtdbGet<RestaurantUserRaw>(`${RESTAURANT_USERS_PATH}/${uid}`),
      uid,
    );
    if (!record) {
      await signOut(auth);
      return {
        ok: false,
        error: "not_provisioned",
        message:
          "This account has no Restaurant Management access. Ask a platform administrator to provision it.",
      };
    }
    if (record.status === "suspended") {
      await signOut(auth);
      return {
        ok: false,
        error: "suspended",
        message: "This account is deactivated. Contact a platform administrator.",
      };
    }
    const session = buildRestaurantUserSession(record);
    await rtdbUpdate(`${RESTAURANT_USERS_PATH}/${uid}`, { last_login_at: nowIso() }).catch(() => {});
    await writeRestaurantUserAudit({
      action: "restaurant_user.sign_in",
      actor_email: record.email,
      target_email: record.email,
      detail: `restaurant: ${record.restaurant_id}`,
    });
    return { ok: true, session };
  } catch (err) {
    return { ok: false, error: "invalid_credentials", message: friendlyAuthError(err) };
  }
}

export async function refreshRestaurantUserSession(
  stored: RestaurantUserSession,
): Promise<RestaurantUserSession | null> {
  if (!isFirebaseAvailable()) return stored;
  try {
    const record = normalizeRestaurantUser(
      await rtdbGet<RestaurantUserRaw>(`${RESTAURANT_USERS_PATH}/${stored.userId}`),
      stored.userId,
    );
    if (!record || record.status === "suspended") return null;
    return buildRestaurantUserSession(record);
  } catch {
    return stored;
  }
}
