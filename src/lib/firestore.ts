// ---------------------------------------------------------------------------
// ForkFleet — Cloud Firestore data layer
// ---------------------------------------------------------------------------
// This module replaces the previous Realtime Database layer. The whole app
// talks to Firestore through the seven primitives exported here (fsGet, fsSet,
// fsUpdate, fsPush, fsSubscribe + the "WithApp" variants), which take the same
// logical paths the app has always used (e.g. `restaurants/{id}`,
// `menus/{restaurantId}/items/{itemId}`, `orders/{id}/payment`).
//
// PATH MAPPING RULES (see docs/FIRESTORE_MIGRATION_HANDOVER.md for the full
// mapping table):
//
//   1. `COLLECTIONS` below declares which logical prefixes are Firestore
//      *collections*. The segment directly after a collection is a document id;
//      anything deeper becomes a nested field path inside that document
//      (exactly matching the old subtree semantics).
//   2. Firestore requires collection paths to have an odd number of segments.
//      When a logical collection path has an even number of segments we insert
//      the container document `_` before the last segment:
//        promotions/codes      -> promotions/_/codes
//        support/tickets       -> support/_/tickets
//        uploads/images        -> uploads/_/images
//      Names, ids, hierarchy and relationships are otherwise preserved.
//
// SSR-safe: `firebase/firestore` is only imported in the browser.
// ---------------------------------------------------------------------------

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBCTflur84nQjEc-YdsD_p2sR8eI7BD6nA",
  authDomain: "e-comm-bd997.firebaseapp.com",
  projectId: "e-comm-bd997",
  storageBucket: "e-comm-bd997.appspot.com",
  messagingSenderId: "280613901400",
  appId: "1:280613901400:web:bf168e55508b9102dda62d",
} as const;

const isBrowser = typeof window !== "undefined";

export const isFirebaseAvailable = (): boolean => isBrowser;

export const MAIN_APP_NAME = "forkfleet-main";

/** Container document id used to keep collection paths at an odd depth. */
export const CONTAINER_DOC = "_";

/**
 * Logical collection paths. `*` matches a single dynamic segment.
 * Longest match wins, so `promotions/codes` beats `promotions`.
 */
const COLLECTIONS: string[] = [
  // core entities
  "restaurants",
  "restaurantBranches",
  "orders",
  "drivers",
  "driverAssignments",
  // people / access
  "staffUsers",
  "staffAudit",
  "restaurantUsers",
  "restaurantUserAudit",
  // menus (per restaurant)
  "menus/*/categories",
  "menus/*/items",
  "menus/*/variants",
  "menus/*/addons",
  "menus/*/modifiers",
  // promotions & loyalty
  "promotions",
  "promotions/codes",
  "promotions/combos",
  "promotions/restaurant_points",
  // notifications
  "notificationAlerts",
  "notificationTriggers",
  "notificationReads",
  "notificationAudit",
  // platform settings
  "settings",
  "settingsAudit",
  // support desk
  "support/tickets",
  "support/messages",
  // media
  "uploads/images",
];

const COLLECTION_SEGMENTS = COLLECTIONS.map((p) => p.split("/")).sort(
  (a, b) => b.length - a.length,
);

export type FirestoreValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: FirestoreValue | undefined }
  | FirestoreValue[]
  | undefined;

export type ResolvedPath =
  | { kind: "collection"; collectionPath: string }
  | { kind: "doc"; docPath: string }
  | { kind: "field"; docPath: string; field: string[] };

/** Convert a logical collection path into a valid Firestore collection path. */
function toFirestoreCollectionPath(segments: string[]): string {
  if (segments.length % 2 === 1) return segments.join("/");
  const copy = [...segments];
  copy.splice(copy.length - 1, 0, CONTAINER_DOC);
  return copy.join("/");
}

function matches(pattern: string[], segments: string[]): boolean {
  if (pattern.length > segments.length) return false;
  return pattern.every((p, i) => p === "*" || p === segments[i]);
}

/** Map a logical app path onto a Firestore collection / document / field. */
export function resolvePath(path: string): ResolvedPath {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) throw new Error("Empty Firestore path");

  const pattern = COLLECTION_SEGMENTS.find((p) => matches(p, segments));
  // Unregistered paths fall back to: segment 1 = collection, segment 2 = doc,
  // the rest = nested fields.
  const depth = pattern ? pattern.length : 1;
  const collectionPath = toFirestoreCollectionPath(segments.slice(0, depth));

  if (segments.length === depth) return { kind: "collection", collectionPath };
  const docPath = `${collectionPath}/${segments[depth]}`;
  const field = segments.slice(depth + 1);
  if (field.length === 0) return { kind: "doc", docPath };
  return { kind: "field", docPath, field };
}

/* ----------------------------------------------------------------- app / db */

type FirestoreDb = Awaited<ReturnType<typeof import("firebase/firestore").getFirestore>>;

const dbCache = new Map<string, Promise<FirestoreDb>>();

async function getDbFor(appName: string): Promise<FirestoreDb> {
  if (!isBrowser) throw new Error("Firestore is only available in the browser.");
  const cached = dbCache.get(appName);
  if (cached) return cached;
  const promise = (async () => {
    const { getApps, initializeApp } = await import("firebase/app");
    const { getFirestore } = await import("firebase/firestore");
    const existing = getApps().find((a) => a.name === appName);
    const app = existing ?? initializeApp(FIREBASE_CONFIG, appName);
    return getFirestore(app);
  })();
  dbCache.set(appName, promise);
  return promise;
}

const getDb = () => getDbFor(MAIN_APP_NAME);

/* ------------------------------------------------------------ error mapping */

/** Firestore error code, when the thrown value is a FirebaseError. */
function errorCode(err: unknown): string {
  return String((err as { code?: string } | null | undefined)?.code ?? "");
}

/** True when a Firestore call failed because security rules denied it. */
export function isPermissionDenied(err: unknown): boolean {
  const code = errorCode(err);
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    code === "permission-denied" ||
    code === "PERMISSION_DENIED" ||
    message.includes("permission-denied") ||
    message.includes("permission denied") ||
    message.includes("missing or insufficient permissions")
  );
}

/** Human-readable message for any Firestore failure. Never fails silently. */
export function describeFirestoreError(err: unknown, action = "read data"): string {
  const code = errorCode(err).replace(/^firestore\//, "");
  switch (code) {
    case "permission-denied":
      return `You do not have permission to ${action}.`;
    case "unavailable":
      return "The database is unreachable — check your network connection and try again.";
    case "not-found":
      return "That record no longer exists.";
    case "already-exists":
      return "A record with that id already exists.";
    case "deadline-exceeded":
      return "The database took too long to respond. Please retry.";
    case "resource-exhausted":
      return "The database quota has been exhausted. Please retry later.";
    case "failed-precondition":
      return "The database rejected this request (a required index may be missing).";
    case "unauthenticated":
      return "Your session expired — sign in again to continue.";
    case "cancelled":
      return "The request was cancelled.";
    default:
      return err instanceof Error ? err.message : `Failed to ${action}.`;
  }
}

/** Wrap a Firestore call so callers always get an actionable Error. */
async function guard<T>(action: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const wrapped = new Error(describeFirestoreError(err, action));
    (wrapped as Error & { code?: string }).code = errorCode(err);
    (wrapped as Error & { cause?: unknown }).cause = err;
    throw wrapped;
  }
}

/* ------------------------------------------------------------------- helpers */

/** Firestore rejects `undefined`; strip it the way the old layer did. */
function clean<T>(value: T): T {
  if (value === undefined) return null as unknown as T;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => clean(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = clean(v);
  }
  return out as unknown as T;
}

function pick(data: unknown, field: string[]): unknown {
  let cursor: unknown = data;
  for (const key of field) {
    if (cursor === null || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor ?? null;
}

function nest(field: string[], value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let cursor = out;
  field.forEach((key, i) => {
    if (i === field.length - 1) cursor[key] = value;
    else cursor = (cursor[key] = {}) as Record<string, unknown>;
  });
  return out;
}

/** Normalise an update patch: `a/b` and `a.b` keys both mean a nested field. */
function patchToNested(
  patch: Record<string, unknown>,
  deleteSentinel: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(patch)) {
    if (rawValue === undefined) continue;
    const keys = rawKey.split(/[/.]/).filter(Boolean);
    const value = rawValue === null ? deleteSentinel : clean(rawValue);
    let cursor = out;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) cursor[key] = value;
      else {
        const next = (cursor[key] as Record<string, unknown> | undefined) ?? {};
        cursor[key] = next;
        cursor = next;
      }
    });
  }
  return out;
}

/* ---------------------------------------------------------------- read APIs */

/** Read a document, a whole collection (keyed by document id) or a field. */
export async function fsGet<T = unknown>(path: string, appName = MAIN_APP_NAME): Promise<T | null> {
  return guard(`read ${path}`, async () => {
    const db = await getDbFor(appName);
    const target = resolvePath(path);
    const { collection, doc, getDoc, getDocs } = await import("firebase/firestore");

    if (target.kind === "collection") {
      const snap = await getDocs(collection(db, target.collectionPath));
      if (snap.empty) return null;
      const out: Record<string, unknown> = {};
      snap.forEach((d) => {
        if (d.id === CONTAINER_DOC) return;
        out[d.id] = d.data();
      });
      return (Object.keys(out).length > 0 ? (out as T) : null) as T | null;
    }

    const snap = await getDoc(doc(db, target.docPath));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (target.kind === "doc") return (data as T) ?? null;
    return (pick(data, target.field) as T) ?? null;
  });
}

/** Read through a named Firebase app (e.g. the provisioner app). */
export function fsGetWithApp<T = unknown>(appName: string, path: string): Promise<T | null> {
  return fsGet<T>(path, appName);
}

/* --------------------------------------------------------------- write APIs */

/**
 * Replace the value at `path`. `null` deletes.
 * - field path  -> merge (or delete) that nested field
 * - document    -> full document replace / delete
 * - collection  -> replace the whole collection with the given map
 */
export async function fsSet<T extends FirestoreValue>(
  path: string,
  value: T,
  appName = MAIN_APP_NAME,
): Promise<void> {
  return guard(`save ${path}`, async () => {
    const db = await getDbFor(appName);
    const target = resolvePath(path);
    const { collection, deleteDoc, deleteField, doc, getDocs, setDoc, writeBatch } = await import(
      "firebase/firestore"
    );

    if (target.kind === "field") {
      const payload =
        value === null || value === undefined
          ? nest(target.field, deleteField())
          : nest(target.field, clean(value));
      await setDoc(doc(db, target.docPath), payload, { merge: true });
      return;
    }

    if (target.kind === "doc") {
      if (value === null || value === undefined) {
        await deleteDoc(doc(db, target.docPath));
        return;
      }
      await setDoc(doc(db, target.docPath), clean(value) as Record<string, unknown>);
      return;
    }

    // Whole-collection replace (batched, so related writes land atomically).
    const ref = collection(db, target.collectionPath);
    const existing = await getDocs(ref);
    const next = (value ?? {}) as Record<string, FirestoreValue>;
    const batch = writeBatch(db);
    existing.forEach((d) => {
      if (d.id === CONTAINER_DOC) return;
      if (!(d.id in next)) batch.delete(d.ref);
    });
    for (const [id, docValue] of Object.entries(next)) {
      if (docValue === null || docValue === undefined) {
        batch.delete(doc(db, `${target.collectionPath}/${id}`));
      } else {
        batch.set(doc(db, `${target.collectionPath}/${id}`), clean(docValue) as never);
      }
    }
    await batch.commit();
  });
}

/** Writes through a named Firebase app so security rules see that app's auth. */
export function fsSetWithApp<T extends FirestoreValue>(
  appName: string,
  path: string,
  value: T,
): Promise<void> {
  return fsSet(path, value, appName);
}

/**
 * Merge a patch. Keys may be nested paths (`meta/updated_at` or `meta.updated_at`).
 * `null` values delete the field. On a collection path each key is a document.
 */
export async function fsUpdate(
  path: string,
  patch: Record<string, FirestoreValue>,
  appName = MAIN_APP_NAME,
): Promise<void> {
  return guard(`update ${path}`, async () => {
    const db = await getDbFor(appName);
    const target = resolvePath(path);
    const { deleteField, doc, setDoc, writeBatch } = await import("firebase/firestore");

    if (target.kind === "collection") {
      const batch = writeBatch(db);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        const keys = key.split("/").filter(Boolean);
        const docId = keys[0]!;
        const rest = keys.slice(1);
        const ref = doc(db, `${target.collectionPath}/${docId}`);
        const payload =
          rest.length > 0
            ? patchToNested({ [rest.join(".")]: value }, deleteField())
            : patchToNested((value ?? {}) as Record<string, unknown>, deleteField());
        batch.set(ref, payload as never, { merge: true });
      }
      await batch.commit();
      return;
    }

    const base = target.kind === "field" ? target.field : [];
    const nested = patchToNested(patch as Record<string, unknown>, deleteField());
    const payload = base.length > 0 ? nest(base, nested) : nested;
    await setDoc(doc(db, target.docPath), payload, { merge: true });
  });
}

/** Append a document with a generated id. Returns the new id. */
export async function fsPush<T extends FirestoreValue>(
  path: string,
  value: T,
  appName = MAIN_APP_NAME,
): Promise<string> {
  return guard(`save ${path}`, async () => {
    const db = await getDbFor(appName);
    const target = resolvePath(path);
    const { addDoc, collection, doc, setDoc } = await import("firebase/firestore");

    if (target.kind === "collection") {
      const created = await addDoc(
        collection(db, target.collectionPath),
        clean(value) as Record<string, unknown>,
      );
      return created.id;
    }
    // Pushing under a document/field: generate an id and store it as a child key.
    const id = `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const field = target.kind === "field" ? [...target.field, id] : [id];
    await setDoc(doc(db, target.docPath), nest(field, clean(value)), { merge: true });
    return id;
  });
}

/* ----------------------------------------------------------- realtime APIs */

/**
 * Live listener with the same callback contract as before: collections arrive
 * as a map keyed by document id, documents/fields as their value (or null).
 */
export function fsSubscribe<T = unknown>(
  path: string,
  callback: (value: T | null) => void,
  onError?: (message: string) => void,
): () => void {
  let cancelled = false;
  let unsub: (() => void) | null = null;

  void (async () => {
    try {
      const db = await getDb();
      if (cancelled) return;
      const target = resolvePath(path);
      const { collection, doc, onSnapshot } = await import("firebase/firestore");
      if (cancelled) return;

      const fail = (err: unknown) => {
        const message = describeFirestoreError(err, `watch ${path}`);
        console.error(`[firestore] listener failed for ${path}:`, message);
        onError?.(message);
        callback(null);
      };

      if (target.kind === "collection") {
        unsub = onSnapshot(
          collection(db, target.collectionPath),
          (snap) => {
            const out: Record<string, unknown> = {};
            snap.forEach((d) => {
              if (d.id === CONTAINER_DOC) return;
              out[d.id] = d.data();
            });
            callback((Object.keys(out).length > 0 ? (out as T) : null) as T | null);
          },
          fail,
        );
        return;
      }

      unsub = onSnapshot(
        doc(db, target.docPath),
        (snap) => {
          if (!snap.exists()) return callback(null);
          const data = snap.data();
          if (target.kind === "doc") return callback((data as T) ?? null);
          callback((pick(data, target.field) as T) ?? null);
        },
        fail,
      );
    } catch (err) {
      const message = describeFirestoreError(err, `watch ${path}`);
      console.warn("[firestore] subscribe failed", message);
      onError?.(message);
      callback(null);
    }
  })();

  return () => {
    cancelled = true;
    if (unsub) unsub();
  };
}
