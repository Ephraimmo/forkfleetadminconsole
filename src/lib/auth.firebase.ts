// Firebase-backed identity & access control for the ForkFleet Operations Console.
//
// Wire-up:
//   Firebase Auth (Email/Password) -> credential store (email + password)
//   /staffUsers/{uid}              -> console profile: roles, status, audit fields
//   /staffAudit/{id}               -> append-only access-control audit trail
//
// Account provisioning runs on a SECONDARY Firebase app so creating a user
// never replaces the signed-in administrator's auth state — the standard
// client-side pattern for admin-managed users without the Admin SDK.

import { rolePermissions } from "@/lib/demo-store";
import {
  FIREBASE_CONFIG,
  isFirebaseAvailable,
  isRtdbPermissionDenied,
  rtdbGet,
  rtdbPush,
  rtdbSet,
  rtdbSubscribe,
  rtdbUpdate,
} from "@/lib/firebase";
import {
  buildSessionForRoles,
  isStaffRole,
  type StaffRole,
  type StaffSession,
} from "@/lib/session.functions";

export type StaffStatus = "active" | "suspended";

/** Wire shape persisted at /staffUsers/{uid}. Roles are stored as a map (RTDB-friendly). */
interface StaffUserRaw {
  uid?: string;
  email?: string;
  full_name?: string | null;
  job_title?: string | null;
  roles?: Record<string, boolean> | null;
  status?: string | null;
  is_deleted?: boolean | null;
  created_at?: string | null;
  created_by?: string | null;
  last_login_at?: string | null;
}

/** Normalised console user surfaced to the Access Control UI. */
export interface StaffUserRecord {
  uid: string;
  email: string;
  full_name: string;
  job_title: string | null;
  roles: StaffRole[];
  status: StaffStatus;
  created_at: string;
  created_by: string | null;
  last_login_at: string | null;
}

export const STAFF_USERS_PATH = "staffUsers";
const STAFF_AUDIT_PATH = "staffAudit";
const PROVISIONER_APP_NAME = "forkfleet-provisioner";
const MAIN_APP_NAME = "forkfleet-main";

/** Platform owner: this account always bootstraps itself to full access on
 *  sign-in — the staffUsers profile is created automatically if missing, and
 *  a missing doc is self-healed on session refresh. Matched by firestore.rules. */
export const OWNER_EMAIL = "karaboephraim2@gmail.com";

const nowIso = () => new Date().toISOString();

type FirebaseApp = Awaited<ReturnType<typeof import("firebase/app").initializeApp>>;
type FirebaseAuth = Awaited<ReturnType<typeof import("firebase/auth").getAuth>>;

/* ------------------------------------------------------------------ helpers */

function rolesToMap(roles: StaffRole[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const role of roles) map[role] = true;
  return map;
}

function normalizeStaffUser(
  raw: StaffUserRaw | null | undefined,
  uid: string,
): StaffUserRecord | null {
  if (!raw || raw.is_deleted === true) return null;
  const email = String(raw.email ?? "").trim();
  if (!email) return null;
  return {
    uid: raw.uid ?? uid,
    email,
    full_name: String(raw.full_name ?? "").trim(),
    job_title: raw.job_title ?? null,
    roles: Object.keys(raw.roles ?? {}).filter(isStaffRole),
    status: raw.status === "suspended" ? "suspended" : "active",
    created_at: raw.created_at ?? nowIso(),
    created_by: raw.created_by ?? null,
    last_login_at: raw.last_login_at ?? null,
  };
}

function toRawStaffUser(record: StaffUserRecord): Record<string, import("./firebase").RTDBValue> {
  return {
    uid: record.uid,
    email: record.email,
    full_name: record.full_name,
    job_title: record.job_title,
    roles: rolesToMap(record.roles),
    status: record.status,
    is_deleted: false,
    created_at: record.created_at,
    created_by: record.created_by,
    last_login_at: record.last_login_at,
  };
}

function toStaffList(map: Record<string, StaffUserRaw> | null): StaffUserRecord[] {
  return Object.entries(map ?? {})
    .map(([uid, raw]) => normalizeStaffUser(raw, uid))
    .filter((row): row is StaffUserRecord => row !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Maps Firebase Auth error codes to operator-friendly messages. */
function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string } | null | undefined)?.code ?? "";
  switch (code) {
    case "auth/email-already-in-use":
      return "That email is already registered. Grant it roles or reset its password instead.";
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
    case "auth/operation-not-allowed":
      return "Email/Password sign-in is disabled for this Firebase project. Enable it under Firebase Console → Authentication → Sign-in method, then try again.";
    case "auth/unauthorized-domain":
      return "This domain is not authorized by Firebase. Add it under Firebase Console → Authentication → Settings → Authorized domains.";
    case "auth/admin-restricted-operation":
      return "Firebase rejected this operation because of the project's restrictions. Contact the project owner.";
    default:
      if (isRtdbPermissionDenied(err)) {
        return friendlyRtdbDenied();
      }
      return err instanceof Error && err.message ? err.message : "Unexpected Firebase error.";
  }
}

/** Actionable guidance for Realtime Database rule denials. */
function friendlyRtdbDenied(): string {
  return (
    "Database permission denied. Two usual causes: (1) this browser only has a demo session — " +
    "sign out and use Staff Sign In (/auth) with your provisioned console account; " +
    "(2) the latest database.rules.json is not deployed — run \"firebase deploy --only database\" from this project."
  );
}

/**
 * Returns the Firebase Auth account signed in on the main app, or null when the
 * console is running on a demo-only session (no real operator authentication).
 */
export async function getSignedInFirebaseUser(): Promise<{
  uid: string;
  email: string | null;
} | null> {
  if (!isFirebaseAvailable()) return null;
  try {
    const { getAuth } = await import("firebase/auth");
    const auth = getAuth(await getMainApp());
    const user = auth.currentUser;
    if (!user) return null;
    return { uid: user.uid, email: user.email };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- app handling */

async function getMainApp(): Promise<FirebaseApp> {
  const { getApps, initializeApp } = await import("firebase/app");
  const existing = getApps().find((app) => app.name === MAIN_APP_NAME);
  return existing ?? initializeApp(FIREBASE_CONFIG, MAIN_APP_NAME);
}

/** Secondary app dedicated to admin provisioning. It never holds a session
 *  between operations — every provisioning call signs out when it finishes. */
async function getProvisionerAuth(): Promise<FirebaseAuth> {
  const { getApps, initializeApp } = await import("firebase/app");
  const { getAuth } = await import("firebase/auth");
  const existing = getApps().find((app) => app.name === PROVISIONER_APP_NAME);
  const app = existing ?? initializeApp(FIREBASE_CONFIG, PROVISIONER_APP_NAME);
  return getAuth(app);
}

async function writeStaffAudit(entry: {
  action: string;
  actor_email: string | null;
  target_email: string | null;
  detail?: string | null;
}): Promise<void> {
  if (!isFirebaseAvailable()) return;
  try {
    await rtdbPush(STAFF_AUDIT_PATH, {
      action: entry.action,
      actor_email: entry.actor_email,
      target_email: entry.target_email,
      detail: entry.detail ?? null,
      created_at: nowIso(),
    });
  } catch (err) {
    console.warn("[access-control] audit write failed", err);
  }
}

/* ------------------------------------------------------------- provisioning */

export interface CreateStaffUserInput {
  email: string;
  password: string;
  fullName: string;
  jobTitle: string | null;
  roles: StaffRole[];
  actorEmail: string | null;
}

export type CreateStaffUserResult =
  { ok: true; user: StaffUserRecord } | { ok: false; error: string };

/**
 * Registers a real Firebase Auth account (email + password) and provisions the
 * console profile + roles in the Realtime Database. The new user can sign in
 * immediately afterwards. Runs on the secondary app so the admin stays signed in.
 */
export async function createStaffUser(input: CreateStaffUserInput): Promise<CreateStaffUserResult> {
  if (!isFirebaseAvailable()) {
    return { ok: false, error: "Firebase is only available in the browser." };
  }
  const email = input.email.trim().toLowerCase();
  const roles = input.roles.filter(isStaffRole);
  if (roles.length === 0) {
    return { ok: false, error: "Grant at least one role." };
  }

  let auth: FirebaseAuth | null = null;
  try {
    const { createUserWithEmailAndPassword, signOut } = await import("firebase/auth");
    auth = await getProvisionerAuth();
    const credential = await createUserWithEmailAndPassword(auth, email, input.password);
    const record: StaffUserRecord = {
      uid: credential.user.uid,
      email,
      full_name: input.fullName.trim(),
      job_title: input.jobTitle?.trim() ? input.jobTitle.trim() : null,
      roles,
      status: "active",
      created_at: nowIso(),
      created_by: input.actorEmail,
      last_login_at: null,
    };
    await rtdbSet(`${STAFF_USERS_PATH}/${record.uid}`, toRawStaffUser(record));
    await writeStaffAudit({
      action: "staff.created",
      actor_email: input.actorEmail,
      target_email: email,
      detail: `roles: ${roles.join(", ")}`,
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
        /* best-effort — the provisioner must never keep a session */
      }
    }
  }
}

/** Replaces the role set of a provisioned user. Takes effect on their next
 *  session refresh (the console re-reads roles every session query). */
export async function updateStaffUserRoles(input: {
  uid: string;
  roles: StaffRole[];
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  const roles = input.roles.filter(isStaffRole);
  if (roles.length === 0) {
    return { ok: false, error: "A user must keep at least one role. Suspend them instead." };
  }
  try {
    await rtdbUpdate(`${STAFF_USERS_PATH}/${input.uid}`, {
      roles: rolesToMap(roles),
      updated_at: nowIso(),
    });
    await writeStaffAudit({
      action: "staff.roles_updated",
      actor_email: input.actorEmail,
      target_email: null,
      detail: `uid: ${input.uid} -> ${roles.join(", ")}`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update roles." };
  }
}

/** Suspended users fail sign-in immediately and are signed out of any live console session. */
export async function setStaffUserStatus(input: {
  uid: string;
  status: StaffStatus;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    await rtdbUpdate(`${STAFF_USERS_PATH}/${input.uid}`, {
      status: input.status,
      updated_at: nowIso(),
    });
    await writeStaffAudit({
      action: input.status === "suspended" ? "staff.suspended" : "staff.reactivated",
      actor_email: input.actorEmail,
      target_email: null,
      detail: `uid: ${input.uid}`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update status." };
  }
}

/**
 * Soft-deletes the console profile (is_deleted + suspended). The Firebase Auth
 * record itself can only be removed with the Admin SDK / Firebase Console —
 * by design we revoke access instead of destroying credentials from the client.
 */
export async function removeStaffUser(input: {
  uid: string;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    await rtdbUpdate(`${STAFF_USERS_PATH}/${input.uid}`, {
      is_deleted: true,
      status: "suspended",
      removed_at: nowIso(),
      removed_by: input.actorEmail,
    });
    await writeStaffAudit({
      action: "staff.removed",
      actor_email: input.actorEmail,
      target_email: null,
      detail: `uid: ${input.uid} (access revoked; auth record kept)`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to remove user." };
  }
}

/** Emails a password reset link. Works for any provisioned account. */
export async function sendStaffPasswordReset(input: {
  email: string;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    const { sendPasswordResetEmail } = await import("firebase/auth");
    const auth = await getProvisionerAuth();
    await sendPasswordResetEmail(auth, input.email.trim().toLowerCase());
    await writeStaffAudit({
      action: "staff.password_reset_sent",
      actor_email: input.actorEmail,
      target_email: input.email.trim().toLowerCase(),
      detail: null,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyAuthError(err) };
  }
}

/* ------------------------------------------------------------------- reads  */

/** One-shot read of every provisioned console user. */
export async function fetchStaffUsersOnce(): Promise<StaffUserRecord[]> {
  if (!isFirebaseAvailable()) return [];
  return toStaffList(await rtdbGet<Record<string, StaffUserRaw>>(STAFF_USERS_PATH));
}

/** Real-time provisioned staff list — new users appear instantly. */
export function subscribeStaffUsers(callback: (rows: StaffUserRecord[]) => void): () => void {
  if (!isFirebaseAvailable()) {
    callback([]);
    return () => {};
  }
  return rtdbSubscribe<Record<string, StaffUserRaw>>(STAFF_USERS_PATH, (map) =>
    callback(toStaffList(map)),
  );
}

/* -------------------------------------------------------------- sign-in/out */

export type StaffSignInResult =
  | { ok: true; session: StaffSession }
  | {
      ok: false;
      error: "invalid_credentials" | "no_account" | "not_provisioned" | "suspended" | "unavailable";
      message: string;
    };

const isOwner = (email: string): boolean => email.trim().toLowerCase() === OWNER_EMAIL;

/** Writes (or repairs) the platform owner's full-access staffUsers profile. */
async function writeOwnerProfile(uid: string, email: string): Promise<void> {
  await rtdbSet(`${STAFF_USERS_PATH}/${uid}`, {
    uid,
    email,
    full_name: "Karabo Ephraim",
    job_title: "Platform Owner",
    roles: { super_admin: true },
    status: "active",
    is_deleted: false,
    created_at: nowIso(),
    created_by: "owner-bootstrap",
    last_login_at: nowIso(),
  });
}

/**
 * Signs a staff member in with Firebase Auth and resolves their console session
 * from staffUsers/{uid}. Rejects accounts that were never provisioned through
 * Access Control, and suspended accounts. The platform owner account
 * (${OWNER_EMAIL}) is bootstrapped automatically: if the Auth account does not
 * exist yet it is created with the entered password, and a missing console
 * profile is created with full access.
 */
export async function signInStaffWithFirebase(input: {
  email: string;
  password: string;
}): Promise<StaffSignInResult> {
  if (!isFirebaseAvailable()) {
    return {
      ok: false,
      error: "unavailable",
      message: "Firebase is only available in the browser.",
    };
  }
  const email = input.email.trim().toLowerCase();
  const owner = isOwner(email);
  try {
    const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } = await import(
      "firebase/auth"
    );
    const auth = getAuth(await getMainApp());
    let uid: string;
    try {
      const credential = await signInWithEmailAndPassword(auth, email, input.password);
      uid = credential.user.uid;
    } catch (signInErr) {
      const code = (signInErr as { code?: string } | null)?.code ?? "";
      const recoverable =
        code === "auth/user-not-found" ||
        code === "auth/invalid-credential" ||
        code === "auth/invalid-login-credentials";
      if (!owner || !recoverable) {
        return { ok: false, error: "invalid_credentials", message: friendlyAuthError(signInErr) };
      }
      // Owner first-run bootstrap: create the Auth account with the typed password.
      // If the account already exists the password was simply wrong.
      try {
        const created = await createUserWithEmailAndPassword(auth, email, input.password);
        uid = created.user.uid;
      } catch (createErr) {
        return { ok: false, error: "invalid_credentials", message: friendlyAuthError(createErr) };
      }
    }

    let record = normalizeStaffUser(
      await rtdbGet<StaffUserRaw>(`${STAFF_USERS_PATH}/${uid}`),
      uid,
    );
    if (!record && owner) {
      await writeOwnerProfile(uid, email);
      record = normalizeStaffUser(
        await rtdbGet<StaffUserRaw>(`${STAFF_USERS_PATH}/${uid}`),
        uid,
      );
    }
    if (!record) {
      const { signOut } = await import("firebase/auth");
      await signOut(auth);
      return {
        ok: false,
        error: "not_provisioned",
        message:
          "This account has no console access. Ask a platform administrator to provision it.",
      };
    }
    if (record.status === "suspended") {
      const { signOut } = await import("firebase/auth");
      await signOut(auth);
      return {
        ok: false,
        error: "suspended",
        message: "This account is suspended. Contact a platform administrator.",
      };
    }
    const session = buildSessionForRoles({
      userId: record.uid,
      email: record.email,
      fullName: record.full_name || null,
      jobTitle: record.job_title,
      roles: record.roles,
      grantAll: owner || record.roles.includes("super_admin"),
    });
    await rtdbUpdate(`${STAFF_USERS_PATH}/${uid}`, { last_login_at: nowIso() }).catch(() => {});
    await writeStaffAudit({
      action: "auth.sign_in",
      actor_email: record.email,
      target_email: record.email,
      detail: "firebase",
    });
    return { ok: true, session };
  } catch (err) {
    return { ok: false, error: "invalid_credentials", message: friendlyAuthError(err) };
  }
}

/** Re-reads a stored Firebase session from the database so revoked roles and
 *  suspensions take effect without waiting for a fresh sign-in. Returns null
 *  when access was revoked (profile gone or suspended). The owner profile is
 *  self-healed when missing. */
export async function refreshFirebaseSession(stored: StaffSession): Promise<StaffSession | null> {
  if (!isFirebaseAvailable()) return stored;
  const owner = isOwner(stored.email);
  try {
    let record = normalizeStaffUser(
      await rtdbGet<StaffUserRaw>(`${STAFF_USERS_PATH}/${stored.userId}`),
      stored.userId,
    );
    if (!record && owner) {
      await writeOwnerProfile(stored.userId, stored.email);
      record = normalizeStaffUser(
        await rtdbGet<StaffUserRaw>(`${STAFF_USERS_PATH}/${stored.userId}`),
        stored.userId,
      );
    }
    if (!record || record.status === "suspended") return null;
    return buildSessionForRoles({
      userId: record.uid,
      email: record.email,
      fullName: record.full_name || null,
      jobTitle: record.job_title,
      roles: record.roles,
      grantAll: owner || record.roles.includes("super_admin"),
    });
  } catch {
    return stored; // database unreachable — keep the cached session rather than locking the operator out
  }
}

/** Signs out of the main Firebase app (best-effort, used on console sign-out). */
export async function signOutFirebaseAuth(): Promise<void> {
  if (!isFirebaseAvailable()) return;
  try {
    const { getAuth, signOut } = await import("firebase/auth");
    await signOut(getAuth(await getMainApp()));
  } catch {
    /* best-effort */
  }
}

/* ------------------------------------------------------------ password tool */

const PW_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const PW_LOWER = "abcdefghijkmnopqrstuvwxyz";
const PW_DIGITS = "23456789";
const PW_SYMBOLS = "!@#$%&*?";

/** Generates a readable, strong temporary password for provisioning. */
export function generateStaffPassword(length = 12): string {
  const all = PW_UPPER + PW_LOWER + PW_DIGITS + PW_SYMBOLS;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)] ?? "a";
  const chars = [pick(PW_UPPER), pick(PW_LOWER), pick(PW_DIGITS), pick(PW_SYMBOLS)];
  while (chars.length < length) chars.push(pick(all));
  // Fisher–Yates shuffle so required characters aren't always leading.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }
  return chars.join("");
}
