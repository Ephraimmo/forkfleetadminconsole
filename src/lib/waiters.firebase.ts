// Waiters — the staff who serve dine-in tables — and which waiter gets which table.
//
// Data shape (shared with the Restaurant Admin and Customer apps — do not
// rename fields; see docs/DINE_IN_TABLES_QR_HANDOVER.md):
//   /restaurantUsers/{uid}         -> the waiter's login and profile: role "waiter",
//                                     restaurant_id, branch_id (null = every branch)
//   /waiterRosters/{restaurantId}  -> WaiterRoster: each waiter's name, branch, whether
//                                     they're active and online, and their last assignment
//   table.session.waiter_*         -> the waiter looking after a seating
//   order.dine_in.waiter_*         -> copied onto the seating's open orders
//
// Assignment: every new seating goes to the next online waiter who covers the
// table's branch — the one who has gone longest since their last table, so
// tables go round the waiters in turn. The waiter keeps the table for the whole
// seating (every order the table places goes to them). A branch with one
// online waiter gets every table. With nobody online, the seating waits
// unassigned and goes to the first waiter who comes online. A waiter who goes
// offline (or is deactivated) hands their open tables to the next online waiter.
//
// Assignment runs on staff devices — every online waiter's Waiter screen and
// the console's Table overview (useAutoAssignWaiters) — never in a guest's app,
// so guests never need to read the roster. Each assignment is one transaction:
// several devices racing to assign the same seating assign it exactly once.

import {
  fsBatch,
  fsGet,
  fsSubscribe,
  fsTransaction,
  fsUpdate,
  isFirebaseAvailable,
  type FirestoreValue,
  type FsBatchWrite,
} from "@/lib/firestore";
import { staffActorLabel, type StaffActor } from "@/lib/dine-in";
import { randomId } from "@/lib/dine-in-order-edit";
import type { TimelineEvent } from "@/lib/orders.firebase";
import { createRestaurantUser } from "@/lib/restaurant-users.firebase";
import {
  isSessionIdle,
  listTables,
  normalizeTable,
  tableDisplayName,
  tablePath,
  type RestaurantTable,
} from "@/lib/tables.firebase";

export interface RosterWaiter {
  uid: string;
  name: string;
  /** The branch they work at; null = every branch of the restaurant. */
  branch_id: string | null;
  branch_name: string | null;
  /** Deactivated waiters get no tables and can't sign in. */
  active: boolean;
  /** On shift and taking tables. */
  online: boolean;
  online_since: string | null;
  /** When they were last given a table — the round-robin order. */
  last_assigned_at: string | null;
  assigned_count: number;
}

export interface WaiterRoster {
  restaurant_id: string;
  waiters: Record<string, RosterWaiter>;
}

export type AssignOutcome =
  | { status: "assigned"; waiter_id: string; waiter_name: string }
  | { status: "unassigned" }
  | { status: "unchanged" }
  | { status: "no-waiter-available" }
  | { status: "gone" };

const ROSTERS = "waiterRosters";
const rosterPath = (restaurantId: string) => `${ROSTERS}/${restaurantId}`;
const orderPath = (id: string) => `orders/${id}`;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strOrNull = (v: unknown): string | null => str(v) || null;
// Cast at the write boundary — see the same helper in orders.firebase.ts.
const w = (v: unknown): FirestoreValue => v as FirestoreValue;
/** Orders that are finished with — a reassignment leaves their waiter as it was. */
const CLOSED_STATUSES = ["delivered", "rejected", "cancelled", "refunded"];

/* ------------------------------------------------------------------ roster */

export function normalizeRoster(restaurantId: string, raw: unknown): WaiterRoster {
  const waiters: Record<string, RosterWaiter> = {};
  const rawWaiters =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>)["waiters"] : null;
  if (rawWaiters && typeof rawWaiters === "object") {
    for (const [uid, value] of Object.entries(rawWaiters as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const r = value as Record<string, unknown>;
      const count = Number(r["assigned_count"]);
      waiters[uid] = {
        uid,
        name: str(r["name"]) || "Waiter",
        branch_id: strOrNull(r["branch_id"]),
        branch_name: strOrNull(r["branch_name"]),
        active: r["active"] !== false,
        online: r["online"] === true,
        online_since: strOrNull(r["online_since"]),
        last_assigned_at: strOrNull(r["last_assigned_at"]),
        assigned_count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
      };
    }
  }
  return { restaurant_id: restaurantId, waiters };
}

export function subscribeWaiterRoster(
  restaurantId: string,
  cb: (roster: WaiterRoster) => void,
  onError?: (message: string) => void,
): () => void {
  if (!isFirebaseAvailable() || !restaurantId) {
    cb(normalizeRoster(restaurantId, null));
    return () => {};
  }
  return fsSubscribe<Record<string, unknown>>(
    rosterPath(restaurantId),
    (raw) => cb(normalizeRoster(restaurantId, raw)),
    onError,
  );
}

/** Whether a waiter may serve a table at `branchId` (either side unset = the whole restaurant). */
export function waiterCoversBranch(
  waiter: Pick<RosterWaiter, "branch_id">,
  branchId: string | null,
): boolean {
  return waiter.branch_id === null || branchId === null || waiter.branch_id === branchId;
}

/**
 * The waiter who should get the next table at `branchId`: of the active,
 * online waiters covering that branch, the one who has gone longest since
 * their last table (never-assigned first, then whoever came online first).
 * Null when nobody is available.
 */
export function pickNextWaiter(
  waiters: RosterWaiter[],
  branchId: string | null,
  exclude: string[] = [],
): RosterWaiter | null {
  const eligible = waiters.filter(
    (w) => w.active && w.online && !exclude.includes(w.uid) && waiterCoversBranch(w, branchId),
  );
  eligible.sort(
    (a, b) =>
      (a.last_assigned_at ?? "").localeCompare(b.last_assigned_at ?? "") ||
      (a.online_since ?? "").localeCompare(b.online_since ?? "") ||
      a.name.localeCompare(b.name) ||
      a.uid.localeCompare(b.uid),
  );
  return eligible[0] ?? null;
}

/** Open seatings that no waiter is looking after yet. */
export function seatingsNeedingWaiter(
  tables: RestaurantTable[],
  now = Date.now(),
): RestaurantTable[] {
  return tables.filter((t) => t.session && !t.session.waiter_id && !isSessionIdle(t.session, now));
}

/* --------------------------------------------------------------- assignment */

/**
 * Give a seating its waiter, in one transaction with the roster and the
 * seating's open orders.
 *   - `waiter_id` set: assign that waiter (a manager's choice; they must be active).
 *   - `waiter_id: null`: take the seating off its waiter (it waits for the next one).
 *   - omitted: automatic — the next waiter in turn, only if the seating has none yet.
 *   - `release_from`: automatic, for a seating whose waiter is leaving: hand it
 *     to the next waiter other than them, or leave it waiting.
 * Only acts on the seating the caller saw (`session_id`); a newer one is left alone.
 */
export async function assignSeatingWaiter(input: {
  restaurant_id: string;
  table_id: string;
  session_id: string;
  waiter_id?: string | null;
  release_from?: string | null;
  actor?: StaffActor | null;
}): Promise<AssignOutcome> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  return fsTransaction(async (tx) => {
    // ---- reads ----
    const raw = await tx.get<Record<string, unknown>>(
      tablePath(input.restaurant_id, input.table_id),
    );
    const table = normalizeTable(input.restaurant_id, input.table_id, raw);
    const session = table?.session;
    if (!raw || !table || !session || session.id !== input.session_id) {
      return { status: "gone" } as const;
    }
    const roster = normalizeRoster(
      input.restaurant_id,
      await tx.get<Record<string, unknown>>(rosterPath(input.restaurant_id)),
    );
    const everyone = Object.values(roster.waiters);

    let next: RosterWaiter | null;
    if (input.waiter_id !== undefined && !input.release_from) {
      if (input.waiter_id === null) {
        if (!session.waiter_id) return { status: "unchanged" } as const;
        next = null;
      } else {
        next = roster.waiters[input.waiter_id] ?? null;
        if (!next || !next.active) throw new Error("That waiter isn't available.");
        if (session.waiter_id === next.uid) return { status: "unchanged" } as const;
      }
    } else if (input.release_from) {
      if (session.waiter_id !== input.release_from) return { status: "unchanged" } as const;
      next = pickNextWaiter(everyone, table.branch_id, [input.release_from]);
    } else {
      if (session.waiter_id) return { status: "unchanged" } as const;
      next = pickNextWaiter(everyone, table.branch_id);
      if (!next) return { status: "no-waiter-available" } as const;
    }

    const orders: { id: string; data: Record<string, unknown> }[] = [];
    for (const id of session.order_ids) {
      const data = await tx.get<Record<string, unknown>>(orderPath(id));
      if (data) orders.push({ id, data });
    }

    // ---- writes ----
    const ts = new Date().toISOString();
    const who = input.actor ? staffActorLabel(input.actor) : "Automatic assignment";
    const name = next?.name ?? null;
    tx.set(
      tablePath(input.restaurant_id, input.table_id),
      w({
        ...raw,
        session: {
          ...(raw["session"] as Record<string, unknown>),
          waiter_id: next?.uid ?? null,
          waiter_name: name,
          waiter_assigned_at: next ? ts : null,
        },
      }),
    );
    if (next) {
      tx.update(rosterPath(input.restaurant_id), {
        restaurant_id: input.restaurant_id,
        [`waiters/${next.uid}/last_assigned_at`]: ts,
        [`waiters/${next.uid}/assigned_count`]: next.assigned_count + 1,
        updated_at: ts,
      });
    }
    const note = next
      ? `${tableDisplayName(table.label)} assigned to ${next.name}${input.actor ? ` by ${who}` : ""}`
      : `${tableDisplayName(table.label)} is waiting for a waiter`;
    for (const order of orders) {
      if (CLOSED_STATUSES.includes(str(order.data["status"]))) continue;
      const event: TimelineEvent = { id: randomId("tl"), status: "note", at: ts, note, actor: who };
      tx.update(orderPath(order.id), {
        "dine_in/waiter_id": next?.uid ?? null,
        "dine_in/waiter_name": name,
        [`timeline/${event.id}`]: w(event),
        updated_at: ts,
      });
    }
    return next
      ? ({ status: "assigned", waiter_id: next.uid, waiter_name: next.name } as const)
      : ({ status: "unassigned" } as const);
  });
}

/**
 * Hand every open table a waiter is looking after to the next online waiter
 * (or leave it waiting when nobody else is on). Used when they go offline or
 * are deactivated. Returns how many tables moved.
 */
export async function releaseWaiterTables(input: {
  restaurant_id: string;
  waiter_id: string;
  actor?: StaffActor | null;
}): Promise<number> {
  const tables = await listTables(input.restaurant_id);
  let moved = 0;
  for (const table of tables) {
    if (!table.session || table.session.waiter_id !== input.waiter_id) continue;
    const outcome = await assignSeatingWaiter({
      restaurant_id: input.restaurant_id,
      table_id: table.id,
      session_id: table.session.id,
      release_from: input.waiter_id,
      actor: input.actor ?? null,
    });
    if (outcome.status === "assigned" || outcome.status === "unassigned") moved += 1;
  }
  return moved;
}

/** Give every open seating that has no waiter one, if a waiter is available. */
export async function assignWaitingSeatings(restaurantId: string): Promise<number> {
  const tables = await listTables(restaurantId);
  let assigned = 0;
  for (const table of seatingsNeedingWaiter(tables)) {
    const outcome = await assignSeatingWaiter({
      restaurant_id: restaurantId,
      table_id: table.id,
      session_id: table.session!.id,
    });
    if (outcome.status === "assigned") assigned += 1;
  }
  return assigned;
}

/* -------------------------------------------------------- managing waiters */

export interface WaiterInput {
  restaurant_id: string;
  full_name: string;
  phone: string | null;
  /** null = every branch of the restaurant. */
  branch_id: string | null;
  branch_name: string | null;
}

function rosterEntry(
  uid: string,
  input: Pick<WaiterInput, "full_name" | "branch_id" | "branch_name">,
) {
  return {
    uid,
    name: input.full_name.trim(),
    branch_id: input.branch_id || null,
    branch_name: input.branch_id ? input.branch_name || null : null,
  };
}

/**
 * Create a waiter: a restaurant login with the "waiter" role (email and
 * password — they sign in on the Waiter screen) and their place on the
 * restaurant's roster, offline until they start their shift.
 */
export async function createWaiter(
  input: WaiterInput & { email: string; password: string; actorEmail: string | null },
): Promise<{ ok: true; uid: string } | { ok: false; error: string }> {
  if (!input.full_name.trim()) return { ok: false, error: "Enter the waiter's name." };
  const created = await createRestaurantUser({
    email: input.email,
    password: input.password,
    fullName: input.full_name,
    jobTitle: "Waiter",
    phone: input.phone,
    restaurantId: input.restaurant_id,
    branchId: input.branch_id,
    role: "waiter",
    actorEmail: input.actorEmail,
  });
  if (!created.ok) return created;
  const uid = created.user.uid;
  try {
    await fsUpdate(rosterPath(input.restaurant_id), {
      restaurant_id: input.restaurant_id,
      [`waiters/${uid}`]: w({
        ...rosterEntry(uid, input),
        active: true,
        online: false,
        online_since: null,
        last_assigned_at: null,
        assigned_count: 0,
      }),
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    return {
      ok: false,
      error: `The login was created, but the waiter couldn't be added to the roster (${
        err instanceof Error ? err.message : "unknown error"
      }). Open the waiter and save again to finish.`,
    };
  }
  return { ok: true, uid };
}

/** Change a waiter's name, phone or branch — on their profile and the roster together. */
export async function updateWaiter(input: WaiterInput & { uid: string }): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  if (!input.full_name.trim()) throw new Error("Enter the waiter's name.");
  const ts = new Date().toISOString();
  const entry = rosterEntry(input.uid, input);
  const writes: FsBatchWrite[] = [
    {
      kind: "update",
      path: `restaurantUsers/${input.uid}`,
      patch: {
        full_name: entry.name,
        phone: input.phone?.trim() || null,
        branch_id: entry.branch_id,
        updated_at: ts,
      },
    },
    {
      kind: "update",
      path: rosterPath(input.restaurant_id),
      patch: {
        restaurant_id: input.restaurant_id,
        [`waiters/${input.uid}/uid`]: input.uid,
        [`waiters/${input.uid}/name`]: entry.name,
        [`waiters/${input.uid}/branch_id`]: entry.branch_id,
        [`waiters/${input.uid}/branch_name`]: entry.branch_name,
        updated_at: ts,
      },
    },
  ];
  await fsBatch(writes);
}

/**
 * Deactivate (or reactivate) a waiter. Deactivating suspends their login,
 * takes them off shift and hands their open tables to the next waiter.
 */
export async function setWaiterActive(input: {
  restaurant_id: string;
  uid: string;
  active: boolean;
  actor: StaffActor | null;
}): Promise<{ tables_moved: number }> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const ts = new Date().toISOString();
  await fsBatch([
    {
      kind: "update",
      path: `restaurantUsers/${input.uid}`,
      patch: { status: input.active ? "active" : "suspended", updated_at: ts },
    },
    {
      kind: "update",
      path: rosterPath(input.restaurant_id),
      patch: {
        [`waiters/${input.uid}/active`]: input.active,
        ...(input.active ? {} : { [`waiters/${input.uid}/online`]: false }),
        updated_at: ts,
      },
    },
  ]);
  if (input.active) return { tables_moved: 0 };
  return {
    tables_moved: await releaseWaiterTables({
      restaurant_id: input.restaurant_id,
      waiter_id: input.uid,
      actor: input.actor,
    }),
  };
}

/**
 * Start or end a waiter's shift. Going online makes them next in line for new
 * tables and picks up any seating that's been waiting for a waiter; going
 * offline hands their open tables to the next online waiter.
 */
export async function setWaiterOnline(input: {
  restaurant_id: string;
  waiter: Pick<RosterWaiter, "uid" | "name" | "branch_id" | "branch_name">;
  online: boolean;
  actor: StaffActor | null;
}): Promise<{ tables_moved: number; tables_assigned: number }> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const ts = new Date().toISOString();
  const uid = input.waiter.uid;
  await fsUpdate(rosterPath(input.restaurant_id), {
    restaurant_id: input.restaurant_id,
    // Name and branch too, so a waiter missing from the roster is added whole.
    [`waiters/${uid}/uid`]: uid,
    [`waiters/${uid}/name`]: input.waiter.name,
    [`waiters/${uid}/branch_id`]: input.waiter.branch_id,
    [`waiters/${uid}/branch_name`]: input.waiter.branch_name,
    [`waiters/${uid}/online`]: input.online,
    [`waiters/${uid}/online_since`]: input.online ? ts : null,
    updated_at: ts,
  });
  if (input.online) {
    return { tables_moved: 0, tables_assigned: await assignWaitingSeatings(input.restaurant_id) };
  }
  return {
    tables_moved: await releaseWaiterTables({
      restaurant_id: input.restaurant_id,
      waiter_id: uid,
      actor: input.actor,
    }),
    tables_assigned: 0,
  };
}

/** One-off read of a restaurant's roster. */
export async function getWaiterRoster(restaurantId: string): Promise<WaiterRoster> {
  if (!isFirebaseAvailable()) return normalizeRoster(restaurantId, null);
  return normalizeRoster(restaurantId, await fsGet(rosterPath(restaurantId)));
}
