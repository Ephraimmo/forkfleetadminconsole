// Minimal Cloud Firestore client used by the RESTAURANT MANAGEMENT data
// layer (restaurants + branches). Everything else in the console still uses
// the Realtime Database via src/lib/firebase.ts.
//
// Conventions:
//   - Collection reads return Record<docId, data> (null when empty), matching
//     the RTDB map shape so callers keep their existing logic.
//   - Writes sanitize `undefined` values (Firestore rejects them).

const isBrowser = typeof window !== "undefined";

export const fsIsAvailable = (): boolean => isBrowser;

type FirestoreDb = Awaited<ReturnType<typeof import("firebase/firestore").getFirestore>>;

let _db: FirestoreDb | null = null;

async function getDb(): Promise<FirestoreDb> {
  if (_db) return _db;
  const { getApps, initializeApp } = await import("firebase/app");
  const { getFirestore } = await import("firebase/firestore");
  const config = (await import("@/lib/firebase")).FIREBASE_CONFIG;
  const existing = getApps().find((app) => app.name === "[DEFAULT]");
  const app = existing ?? initializeApp(config);
  _db = getFirestore(app);
  return _db;
}

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

function splitDocPath(path: string): [string, string] {
  const segments = path.split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw new Error(`Expected a "collection/document" path, got: ${path}`);
  }
  return [segments[0]!, segments[1]!];
}

/** Read every document in a collection as Record<docId, data>. */
export async function fsColGet(path: string): Promise<Record<string, Record<string, unknown>> | null> {
  if (!isBrowser) return null;
  const { collection, getDocs } = await import("firebase/firestore");
  const snap = await getDocs(collection(await getDb(), path));
  const out: Record<string, Record<string, unknown>> = {};
  snap.forEach((d) => {
    out[d.id] = d.data() as Record<string, unknown>;
  });
  return Object.keys(out).length > 0 ? out : null;
}

/** Live subscription to a whole collection as Record<docId, data>. */
export function fsColSubscribe(
  path: string,
  callback: (value: Record<string, Record<string, unknown>> | null) => void,
): () => void {
  let cancelled = false;
  let unsub: (() => void) | null = null;
  void (async () => {
    try {
      const { collection, onSnapshot } = await import("firebase/firestore");
      const colRef = collection(await getDb(), path);
      if (cancelled) return;
      unsub = onSnapshot(colRef, (snap) => {
        const out: Record<string, Record<string, unknown>> = {};
        snap.forEach((d) => {
          out[d.id] = d.data() as Record<string, unknown>;
        });
        callback(Object.keys(out).length > 0 ? out : null);
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

/** Read one document ("collection/id"). Returns null when missing. */
export async function fsDocGet<T = Record<string, unknown>>(path: string): Promise<T | null> {
  if (!isBrowser) return null;
  const { doc, getDoc } = await import("firebase/firestore");
  const [col, id] = splitDocPath(path);
  const snap = await getDoc(doc(await getDb(), col, id));
  return snap.exists() ? (snap.data() as T) : null;
}

/** Replace/create one document ("collection/id"). */
export async function fsDocSet(path: string, data: Record<string, unknown>): Promise<void> {
  if (!isBrowser) throw new Error("Firebase is only available in the browser.");
  const { doc, setDoc } = await import("firebase/firestore");
  const [col, id] = splitDocPath(path);
  await setDoc(doc(await getDb(), col, id), sanitize(data));
}

/** Merge fields into one document ("collection/id"). Values may be flat fields. */
export async function fsDocUpdate(
  path: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!isBrowser) throw new Error("Firebase is only available in the browser.");
  const { doc, setDoc, updateDoc } = await import("firebase/firestore");
  const [col, id] = splitDocPath(path);
  const clean = sanitize(patch) as Record<string, unknown>;
  try {
    await updateDoc(doc(await getDb(), col, id), clean);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code ?? "";
    if (code === "not-found" || code === "firestore/not-found") {
      // Missing document: emulate RTDB's auto-create with a merge.
      await setDoc(doc(await getDb(), col, id), clean, { merge: true });
      return;
    }
    throw err;
  }
}
