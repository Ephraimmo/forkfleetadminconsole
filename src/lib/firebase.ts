// Firebase Realtime Database client for ForkFleet.
// SSR-safe: firebase/database is only touched on the client. Server-side calls
// return rejected promises so the caller falls back to local data.

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

type RTDBDatabase = Awaited<ReturnType<typeof import("firebase/database").getDatabase>>;

let _db: RTDBDatabase | null = null;
let _initPromise: Promise<RTDBDatabase> | null = null;

async function getDb(): Promise<RTDBDatabase> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;
  if (!isBrowser) {
    throw new Error("Firebase is only available in the browser.");
  }
  _initPromise = (async () => {
    const { initializeApp } = await import("firebase/app");
    const { getDatabase } = await import("firebase/database");
    const app = initializeApp(FIREBASE_CONFIG, "forkfleet-main");
    _db = getDatabase(app);
    return _db;
  })();
  return _initPromise;
}

export type RTDBValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: RTDBValue | undefined }
  | RTDBValue[]
  | undefined;

export async function rtdbSet<T extends RTDBValue>(path: string, value: T): Promise<void> {
  const db = await getDb();
  const { ref, set } = await import("firebase/database");
  await set(ref(db, path), value);
}

/** Writes through a named Firebase app (e.g. provisioner) so RTDB rules see that app's auth. */
export async function rtdbSetWithApp<T extends RTDBValue>(
  appName: string,
  path: string,
  value: T,
): Promise<void> {
  if (!isBrowser) throw new Error("Firebase is only available in the browser.");
  const { getApps, initializeApp } = await import("firebase/app");
  const { getDatabase, ref, set } = await import("firebase/database");
  const existing = getApps().find((app) => app.name === appName);
  const app = existing ?? initializeApp(FIREBASE_CONFIG, appName);
  await set(ref(getDatabase(app), path), value);
}

export async function rtdbGetWithApp<T = unknown>(appName: string, path: string): Promise<T | null> {
  if (!isBrowser) throw new Error("Firebase is only available in the browser.");
  const { getApps, initializeApp } = await import("firebase/app");
  const { getDatabase, ref, get } = await import("firebase/database");
  const existing = getApps().find((app) => app.name === appName);
  const app = existing ?? initializeApp(FIREBASE_CONFIG, appName);
  const snap = await get(ref(getDatabase(app), path));
  return (snap.val() as T) ?? null;
}

export async function rtdbUpdate(path: string, value: Record<string, RTDBValue>): Promise<void> {
  const db = await getDb();
  const { ref, update } = await import("firebase/database");
  await update(ref(db, path), value);
}

export async function rtdbGet<T = unknown>(path: string): Promise<T | null> {
  const db = await getDb();
  const { ref, get } = await import("firebase/database");
  const snap = await get(ref(db, path));
  return (snap.val() as T) ?? null;
}

/** Append a child under `path` with a server-generated push key. Returns the key. */
export async function rtdbPush<T extends RTDBValue>(path: string, value: T): Promise<string> {
  const db = await getDb();
  const { ref, push } = await import("firebase/database");
  const pushed = await push(ref(db, path), value);
  return pushed.key ?? "";
}

export function rtdbSubscribe<T = unknown>(
  path: string,
  callback: (value: T | null) => void,
): () => void {
  let cancelled = false;
  let unsub: (() => void) | null = null;
  void (async () => {
    try {
      const db = await getDb();
      if (cancelled) return;
      const { ref, onValue } = await import("firebase/database");
      if (cancelled) return;
      unsub = onValue(ref(db, path), (snap) => callback((snap.val() as T) ?? null));
    } catch (err) {
      console.warn("[firebase] subscribe failed", err);
      callback(null);
    }
  })();
  return () => {
    cancelled = true;
    if (unsub) unsub();
  };
}

/** True when a Realtime Database call failed because security rules denied it. */
export function isRtdbPermissionDenied(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code ?? "";
  const message = err instanceof Error ? err.message : "";
  return (
    code === "PERMISSION_DENIED" ||
    message.includes("permission_denied") ||
    message.toLowerCase().includes("permission denied")
  );
}

export const isFirebaseAvailable = (): boolean => isBrowser;
