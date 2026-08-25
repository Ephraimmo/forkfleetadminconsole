// Firebase client for ForkFleet — now backed by CLOUD FIRESTORE.
//
// Every data module keeps using the same helper names (rtdbGet/rtdbSet/etc.)
// so business logic is untouched; only the storage engine changed. Paths are
// mapped onto Firestore with this convention:
//
//   segments.length === 1            -> COLLECTION          e.g. "restaurants"
//   segments.length === 2            -> DOCUMENT            e.g. "orders/{id}"
//   segments.length >= 3             -> DOT-FIELD on the
//                                       depth-2 document    e.g. "orders/{id}/timeline/{eventId}"
//                                       becomes update "timeline.{eventId}"
//
// Null writes delete (RTDB semantics): null on a document path deletes the
// document; null on a field path removes the field. `undefined` values are
// stripped before writing because Firestore rejects them while RTDB dropped
// them silently.
//
// Auth still runs on Firebase Auth; FIREBASE_CONFIG is shared with both.

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBCTflur84nQjEc-YdsD_p2sR8eI7BD6nA",
  authDomain: "e-comm-bd997.firebaseapp.com",
  databaseURL: "https://e-comm-bd997-default-rtdb.firebaseio.com",
  projectId: "e-comm-bd997",
  storageBucket: "e-comm-bd997.appspot.com",
  messagingSenderId: "280613901400",
  appId: "1:280613901400:web:bf168e55508b9102dda62d",
} as const;

const isBrowser = typeof window !== "undefined";

type FirestoreDb = Awaited<ReturnType<typeof import("firebase/firestore").getFirestore>>;
type FirestoreApp = Awaited<ReturnType<typeof import("firebase/app").initializeApp>>;

let _db: FirestoreDb | null = null;
let _initPromise: Promise<FirestoreDb> | null = null;

async function getMainApp(): Promise<FirestoreApp> {
  const { getApps, initializeApp } = await import("firebase/app");
  const existing = getApps().find((app) => app.name === "[DEFAULT]");
  return existing ?? initializeApp(FIREBASE_CONFIG);
}

async function getDb(): Promise<FirestoreDb> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;
  if (!isBrowser) {
    throw new Error("Firebase is only available in the browser.");
  }
  _initPromise = (async () => {
    const { getFirestore } = await import("firebase/firestore");
    _db = getFirestore(await getMainApp());
    return _db;
  })();
  return _initPromise;
}

async function getDbWithApp(appName: string): Promise<FirestoreDb> {
  const { getApps, initializeApp } = await import("firebase/app");
  const { getFirestore } = await import("firebase/firestore");
  const existing = getApps().find((app) => app.name === appName);
  const app = existing ?? initializeApp(FIREBASE_CONFIG, appName);
  return getFirestore(app);
}

/* ------------------------------------------------------------------ types */

export type RTDBValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: RTDBValue | undefined }
  | RTDBValue[]
  | undefined;

/** Strip `undefined` values recursively — Firestore rejects them. */
function sanitize<T>(value: T): T {
  if (value === undefined) return null as unknown as T;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = sanitize(v);
  }
  return out as T;
}

/* ------------------------------------------------------------- path utils */

interface PathRef {
  kind: "col" | "doc";
  /** Collection path when kind==="col", otherwise the document path. */
  path: string;
  /** Dot field path relative to the depth-2 document (only when >= 3 segments). */
  fieldPath: string | null;
}

function resolvePath(path: string): PathRef {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) throw new Error("Empty database path.");
  if (segments.length === 1) return { kind: "col", path: segments[0]!, fieldPath: null };
  if (segments.length === 2) return { kind: "doc", path, fieldPath: null };
  return {
    kind: "doc",
    path: segments.slice(0, 2).join("/"),
    fieldPath: segments.slice(2).join("."),
  };
}

/** Reads a dotted field path out of plain document data (null when absent). */
function digField(data: Record<string, unknown> | null | undefined, fieldPath: string): unknown {
  let cur: unknown = data;
  for (const seg of fieldPath.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur ?? null;
}

async function getColRef(path: string) {
  const { collection } = await import("firebase/firestore");
  return collection(await getDb(), path);
}

async function getDocRef(path: string) {
  const { doc } = await import("firebase/firestore");
  const segments = path.split("/").filter(Boolean);
  // doc(db, path) accepts an even number of path args; pass segments pairwise.
  return doc(await getDb(), segments[0]!, segments[1]!);
}

/* --------------------------------------------------------------- reads */

export async function rtdbGet<T = unknown>(path: string): Promise<T | null> {
  if (!isBrowser) return null;
  const ref = resolvePath(path);
  const { getDocs, getDoc } = await import("firebase/firestore");
  if (ref.kind === "col") {
    const snap = await getDocs(await getColRef(ref.path));
    const out: Record<string, unknown> = {};
    snap.forEach((d) => {
      out[d.id] = d.data();
    });
    return (Object.keys(out).length > 0 ? out : null) as T | null;
  }
  const snap = await getDoc(await getDocRef(ref.path));
  const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  if (ref.fieldPath) return (digField(data, ref.fieldPath) ?? null) as T | null;
  return (data ?? null) as T | null;
}

export async function rtdbGetWithApp<T = unknown>(appName: string, path: string): Promise<T | null> {
  if (!isBrowser) return null;
  const db = await getDbWithApp(appName);
  const { getDocs, getDoc, collection, doc } = await import("firebase/firestore");
  const ref = resolvePath(path);
  if (ref.kind === "col") {
    const snap = await getDocs(collection(db, ref.path));
    const out: Record<string, unknown> = {};
    snap.forEach((d) => {
      out[d.id] = d.data();
    });
    return (Object.keys(out).length > 0 ? out : null) as T | null;
  }
  const segments = ref.path.split("/").filter(Boolean);
  const snap = await getDoc(doc(db, segments[0]!, segments[1]!));
  const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  if (ref.fieldPath) return (digField(data, ref.fieldPath) ?? null) as T | null;
  return (data ?? null) as T | null;
}

/**
 * Read any path explicitly as a Firestore COLLECTION, regardless of segment
 * count (used for entity subcollections such as "tickets/{id}/messages").
 */
export async function fsGetCollection<T = unknown>(collectionPath: string): Promise<T | null> {
  if (!isBrowser) return null;
  const { getDocs, collection } = await import("firebase/firestore");
  const snap = await getDocs(collection(await getDb(), collectionPath));
  const out: Record<string, unknown> = {};
  snap.forEach((d) => {
    out[d.id] = d.data();
  });
  return (Object.keys(out).length > 0 ? out : null) as T | null;
}

/** Write one document at an explicit Firestore document path (any depth). */
export async function fsWriteDocument(
  docPath: string,
  value: Record<string, unknown>,
): Promise<void> {
  if (!isBrowser) throw new Error("Firebase is only available in the browser.");
  const { doc, setDoc } = await import("firebase/firestore");
  const db = await getDb();
  const segments = docPath.split("/").filter(Boolean);
  if (segments.length < 2 || segments.length % 2 !== 0) {
    throw new Error(`Not a valid document path: ${docPath}`);
  }
  await setDoc(doc(db, segments.join("/")), sanitize(value) as Record<string, unknown>);
}

/** Subscribe to any path explicitly as a Firestore COLLECTION. */
export function fsSubscribeCollection<T = unknown>(
  collectionPath: string,
  callback: (value: T | null) => void,
): () => void {
  let cancelled = false;
  let unsub: (() => void) | null = null;
  void (async () => {
    try {
      const { collection, onSnapshot } = await import("firebase/firestore");
      const colRef = collection(await getDb(), collectionPath);
      if (cancelled) return;
      unsub = onSnapshot(colRef, (snap) => {
        const out: Record<string, unknown> = {};
        snap.forEach((d) => {
          out[d.id] = d.data();
        });
        callback((Object.keys(out).length > 0 ? out : null) as T | null);
      });
    } catch (err) {
      console.warn("[firestore] subscribe failed", err);
      callback(null);
    }
  })();
  return () => {
    cancelled = true;
    if (unsub) unsub();
  };
}

/* --------------------------------------------------------------- writes */

export async function rtdbSet<T extends RTDBValue>(path: string, value: T): Promise<void> {
  if (!isBrowser) throw new Error("Firebase is only available in the browser.");
  const ref = resolvePath(path);
  const {
    setDoc,
    deleteDoc,
    getDocs,
    writeBatch,
    doc: docFn,
    deleteField,
  } = await import("firebase/firestore");

  if (ref.kind === "col") {
    // Replace-whole-collection semantics: write given docs, delete the rest.
    const colRef = await getColRef(ref.path);
    const payload = (sanitize(value) ?? {}) as Record<string, Record<string, unknown>>;
    const batch = writeBatch(await getDb());
    const snap = await getDocs(colRef);
    snap.forEach((d) => {
      if (!payload[d.id]) batch.delete(d.ref);
    });
    for (const [id, data] of Object.entries(payload)) {
      batch.set(docFn(await getDb(), ref.path, id), sanitize(data));
    }
    await batch.commit();
    return;
  }

  const docRef = await getDocRef(ref.path);
  if (ref.fieldPath) {
    if (value === null) {
      try {
        await setDoc(docRef, { [ref.fieldPath]: deleteField() }, { merge: true });
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
      return;
    }
    await setDoc(docRef, { [ref.fieldPath]: sanitize(value) }, { merge: true });
    return;
  }
  if (value === null) {
    await deleteDoc(docRef);
    return;
  }
  await setDoc(docRef, sanitize(value) as Record<string, unknown>);
}

export async function rtdbSetWithApp<T extends RTDBValue>(
  appName: string,
  path: string,
  value: T,
): Promise<void> {
  if (!isBrowser) throw new Error("Firebase is only available in the browser.");
  const db = await getDbWithApp(appName);
  const { setDoc, doc } = await import("firebase/firestore");
  const ref = resolvePath(path);
  if (ref.kind !== "doc" || ref.fieldPath) {
    throw new Error("Provisioning writes must target a document path.");
  }
  const segments = ref.path.split("/").filter(Boolean);
  await setDoc(
    doc(db, segments[0]!, segments[1]!),
    sanitize(value) as Record<string, unknown>,
  );
}

function isNotFound(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code ?? "";
  return code === "not-found" || code === "firestore/not-found";
}

export async function rtdbUpdate(path: string, value: Record<string, RTDBValue>): Promise<void> {
  if (!isBrowser) throw new Error("Firebase is only available in the browser.");
  const { updateDoc, setDoc, deleteDoc, deleteField, doc: docFn } = await import(
    "firebase/firestore"
  );
  const ref = resolvePath(path);

  const toPatch = (entries: Record<string, RTDBValue>): Record<string, unknown> => {
    const patch: Record<string, unknown> = {};
    for (const [rawKey, rawValue] of Object.entries(entries)) {
      const key = rawKey.replace(/\//g, ".");
      patch[key] = rawValue === null ? deleteField() : sanitize(rawValue);
    }
    return patch;
  };

  if (ref.kind === "doc" && !ref.fieldPath) {
    const patch = toPatch(value);
    try {
      await updateDoc(await getDocRef(ref.path), patch);
    } catch (err) {
      if (!isNotFound(err)) throw err;
      // Missing document: emulate RTDB's auto-create for pure merges.
      const full: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v !== deleteField()) full[k] = v;
      }
      if (Object.keys(full).length > 0) {
        await setDoc(await getDocRef(ref.path), full, { merge: true });
      }
    }
    return;
  }

  if (ref.fieldPath) {
    const prefix = `${ref.fieldPath}.`;
    const patch: Record<string, unknown> = {};
    for (const [rawKey, rawValue] of Object.entries(value)) {
      const key = prefix + rawKey.replace(/\//g, ".");
      patch[key] = rawValue === null ? deleteField() : sanitize(rawValue);
    }
    try {
      await updateDoc(await getDocRef(ref.path), patch);
    } catch (err) {
      if (!isNotFound(err)) throw err;
      // Missing parent doc: emulate RTDB by creating it with the fields.
      const full: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(patch)) {
        if (v !== deleteField()) full[key] = v;
      }
      if (Object.keys(full).length > 0) {
        await setDoc(await getDocRef(ref.path), full, { merge: true });
      }
    }
    return;
  }

  // Depth-1 collection update: merge each child (slash keys target fields).
  const db = await getDb();
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const parts = rawKey.split("/").filter(Boolean);
    const docId = parts[0]!;
    const fieldPath = parts.slice(1).join(".");
    const docRef = docFn(db, ref.path, docId);
    if (rawValue === null && fieldPath === "") {
      await deleteDoc(docRef);
      continue;
    }
    if (rawValue === null) {
      try {
        await updateDoc(docRef, { [fieldPath]: deleteField() });
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
      continue;
    }
    if (fieldPath === "") {
      await setDoc(docRef, sanitize(rawValue) as Record<string, unknown>, { merge: true });
    } else {
      await setDoc(docRef, { [fieldPath]: sanitize(rawValue) }, { merge: true });
    }
  }
}

/** Append a child under `path` with a server-generated document id. Returns the id. */
export async function rtdbPush<T extends RTDBValue>(path: string, value: T): Promise<string> {
  if (!isBrowser) throw new Error("Firebase is only available in the browser.");
  const { addDoc, collection } = await import("firebase/firestore");
  const ref = await addDoc(collection(await getDb(), path), sanitize(value) as Record<string, unknown>);
  return ref.id;
}

/* ----------------------------------------------------------- subscriptions */

export function rtdbSubscribe<T = unknown>(
  path: string,
  callback: (value: T | null) => void,
): () => void {
  let cancelled = false;
  let unsub: (() => void) | null = null;
  void (async () => {
    try {
      const { onSnapshot } = await import("firebase/firestore");
      const ref = resolvePath(path);
      if (ref.kind === "col") {
        const colRef = await getColRef(ref.path);
        if (cancelled) return;
        unsub = onSnapshot(colRef, (snap) => {
          const out: Record<string, unknown> = {};
          snap.forEach((d) => {
            out[d.id] = d.data();
          });
          callback((Object.keys(out).length > 0 ? out : null) as T | null);
        });
        return;
      }
      const docRef = await getDocRef(ref.path);
      if (cancelled) return;
      unsub = onSnapshot(docRef, (snap) => {
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
        if (ref.fieldPath) {
          callback((digField(data, ref.fieldPath) ?? null) as T | null);
        } else {
          callback((data ?? null) as T | null);
        }
      });
    } catch (err) {
      console.warn("[firestore] subscribe failed", err);
      callback(null);
    }
  })();
  return () => {
    cancelled = true;
    if (unsub) unsub();
  };
}

/* ---------------------------------------------------------------- misc */

/** True when a Firestore call failed because security rules denied it. */
export function isRtdbPermissionDenied(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code ?? "";
  const message = err instanceof Error ? err.message : "";
  return (
    code === "PERMISSION_DENIED" ||
    code === "permission-denied" ||
    code === "firestore/permission-denied" ||
    message.includes("permission_denied") ||
    message.toLowerCase().includes("permission denied")
  );
}

export const isFirebaseAvailable = (): boolean => isBrowser;
