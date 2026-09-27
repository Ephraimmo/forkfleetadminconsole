// In-memory stand-in for src/lib/firestore.ts, for unit tests.
//
//   vi.mock("@/lib/firestore", async (importOriginal) =>
//     (await import("@/lib/testing/fake-firestore")).fakeFirestoreModule(await importOriginal()));
//   import { fakeDb } from "@/lib/testing/fake-firestore";
//
// Paths go through the real resolvePath(), so logical paths land in the same
// documents as in production. fsBatch is all-or-nothing. fsTransaction behaves
// like Firestore's optimistic transactions: every await yields (so concurrent
// callers really interleave), a commit fails if anything it read has changed
// since, and the callback is then retried with fresh data — up to 5 attempts.

import type * as FirestoreModule from "@/lib/firestore";

type Doc = Record<string, unknown>;
type Module = typeof FirestoreModule;
type Write = FirestoreModule.FsBatchWrite;

const MAX_ATTEMPTS = 5;

export const fakeDb = {
  docs: new Map<string, Doc>(),
  /** Bumped on every committed write to a document. */
  versions: new Map<string, number>(),
  /**
   * Awaited just before any write commits (for a transaction: before its
   * conflict check). Lets a test slip another write in between a caller's
   * read and its write, to prove the two can't clobber each other.
   */
  beforeCommit: null as null | ((writes: Write[]) => Promise<void>),
  reset() {
    this.docs = new Map();
    this.versions = new Map();
    this.beforeCommit = null;
  },
};

const clone = <T>(value: T): T => structuredClone(value);
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setNested(target: Doc, keys: string[], value: unknown) {
  let cursor = target;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      if (value === null) delete cursor[key];
      else cursor[key] = clone(value);
      return;
    }
    const next = cursor[key];
    cursor = (cursor[key] = next && typeof next === "object" ? next : {}) as Doc;
  });
}

export function fakeFirestoreModule(actual: Module): Module {
  const { resolvePath } = actual;

  const read = (path: string): unknown => {
    const target = resolvePath(path);
    if (target.kind === "collection") {
      const prefix = `${target.collectionPath}/`;
      const out: Record<string, Doc> = {};
      for (const [docPath, data] of fakeDb.docs) {
        const id = docPath.slice(prefix.length);
        if (docPath.startsWith(prefix) && !id.includes("/")) out[id] = clone(data);
      }
      return Object.keys(out).length > 0 ? out : null;
    }
    const data = fakeDb.docs.get(target.docPath);
    if (!data) return null;
    if (target.kind === "doc") return clone(data);
    const value = target.field.reduce<unknown>((c, k) => (c as Doc | undefined)?.[k], data);
    return value === undefined ? null : clone(value);
  };

  /** Apply one write to `docs`; returns the document it touched. */
  const apply = (docs: Map<string, Doc>, write: Write): string => {
    const target = resolvePath(write.path);
    if (target.kind === "collection") throw new Error(`Expected a document path: ${write.path}`);
    const field = target.kind === "field" ? target.field : [];
    const current = docs.get(target.docPath);
    const remove = write.kind === "delete" || (write.kind === "set" && write.value == null);

    if (remove) {
      if (field.length === 0) docs.delete(target.docPath);
      else if (current) setNested(current, field, null);
    } else if (write.kind === "set" && field.length === 0) {
      docs.set(target.docPath, clone(write.value) as Doc);
    } else {
      const doc = current ?? {};
      if (write.kind === "set") setNested(doc, field, write.value);
      else {
        for (const [key, value] of Object.entries(write.patch)) {
          setNested(doc, [...field, ...key.split(/[/.]/).filter(Boolean)], value);
        }
      }
      docs.set(target.docPath, doc);
    }
    return target.docPath;
  };

  const commit = (writes: Write[]) => {
    const next = new Map([...fakeDb.docs].map(([path, doc]) => [path, clone(doc)]));
    const touched = writes.map((write) => apply(next, write)); // throws before anything lands
    fakeDb.docs = next;
    for (const path of touched) fakeDb.versions.set(path, (fakeDb.versions.get(path) ?? 0) + 1);
  };

  /** A plain (non-transactional) write: no conflict check, last writer wins. */
  const write = async (writes: Write[]) => {
    await tick();
    await fakeDb.beforeCommit?.(writes);
    commit(writes);
  };

  const fake: Partial<Module> = {
    isFirebaseAvailable: () => true,
    fsGet: (async (path: string) => {
      await tick();
      return read(path);
    }) as Module["fsGet"],
    fsSet: (path, value) => write([{ kind: "set", path, value }]),
    fsUpdate: (path, patch) => write([{ kind: "update", path, patch }]),
    fsBatch: (writes) => write(writes),
    fsSubscribe: ((path: string, callback: (value: unknown) => void) => {
      void tick().then(() => callback(read(path)));
      return () => {};
    }) as Module["fsSubscribe"],
    fsTransaction: (async (run: (tx: FirestoreModule.FsTransaction) => Promise<unknown>) => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const seen = new Map<string, number>();
        const writes: Write[] = [];
        const tx: FirestoreModule.FsTransaction = {
          get: (async (path: string) => {
            if (writes.length > 0) {
              throw new Error(
                "Firestore transactions require all reads to be executed before all writes.",
              );
            }
            await tick();
            const docPath = resolvePath(path);
            if (docPath.kind === "collection") throw new Error("Transactions read documents only");
            seen.set(docPath.docPath, fakeDb.versions.get(docPath.docPath) ?? 0);
            return read(path);
          }) as FirestoreModule.FsTransaction["get"],
          set: (path, value) => void writes.push({ kind: "set", path, value }),
          update: (path, patch) => void writes.push({ kind: "update", path, patch }),
          delete: (path) => void writes.push({ kind: "delete", path }),
        };
        const result = await run(tx);
        await tick();
        await fakeDb.beforeCommit?.(writes);
        const changed = [...seen].some(
          ([path, version]) => (fakeDb.versions.get(path) ?? 0) !== version,
        );
        if (changed) continue; // someone else committed first — retry with fresh reads
        commit(writes);
        return result;
      }
      throw Object.assign(new Error("Transaction failed: too much contention."), {
        code: "aborted",
      });
    }) as Module["fsTransaction"],
  };

  return { ...actual, ...fake };
}
