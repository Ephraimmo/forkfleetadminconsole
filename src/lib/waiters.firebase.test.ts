import { beforeEach, describe, expect, it, vi } from "vitest";

// Firestore is replaced by the in-memory fake in src/lib/testing/fake-firestore.ts.
vi.mock("@/lib/firestore", async (importOriginal) =>
  (await import("@/lib/testing/fake-firestore")).fakeFirestoreModule(await importOriginal()),
);

import { fakeDb as db } from "@/lib/testing/fake-firestore";
import { placeDineInOrder } from "@/lib/table-sessions.firebase";
import { listTables, saveTable, type RestaurantTable } from "@/lib/tables.firebase";
import {
  assignSeatingWaiter,
  pickNextWaiter,
  seatingsNeedingWaiter,
  setWaiterActive,
  setWaiterOnline,
  waiterCoversBranch,
  type RosterWaiter,
} from "@/lib/waiters.firebase";

const RID = "rst-nonna";
type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function waiter(uid: string, overrides: Partial<RosterWaiter> = {}): RosterWaiter {
  return {
    uid,
    name: uid.replace(/^w_/, "").replace(/^./, (c) => c.toUpperCase()),
    branch_id: null,
    branch_name: null,
    active: true,
    online: true,
    online_since: "2026-09-30T08:00:00.000Z",
    last_assigned_at: null,
    assigned_count: 0,
    ...overrides,
  };
}

function seedRoster(waiters: RosterWaiter[]) {
  db.docs.set(`waiterRosters/${RID}`, {
    restaurant_id: RID,
    waiters: Object.fromEntries(waiters.map((w) => [w.uid, w])),
  });
  for (const w of waiters) {
    db.docs.set(`restaurantUsers/${w.uid}`, {
      uid: w.uid,
      email: `${w.uid}@nonna.test`,
      full_name: w.name,
      restaurant_id: RID,
      branch_id: w.branch_id,
      role: "waiter",
      status: w.active ? "active" : "suspended",
    });
  }
}

const roster = () => db.docs.get(`waiterRosters/${RID}`) as Doc;
const tableDoc = (t: RestaurantTable) => db.docs.get(`restaurants/${RID}/tables/${t.id}`) as Doc;
const orderDoc = (id: string) => db.docs.get(`orders/${id}`) as Doc;

async function addTable(label: string, branch: string | null = "brn_sandton") {
  return saveTable({
    restaurant_id: RID,
    label,
    capacity: 4,
    active: true,
    order_mode: "multiple",
    branch_id: branch,
    branch_name: branch ? branch.replace("brn_", "") : null,
  });
}

/** A guest orders at the table, which starts its seating. */
async function seat(table: RestaurantTable, guest = "guest_1") {
  const placed = await placeDineInOrder({
    table: { restaurant_id: RID, table_id: table.id },
    guest: { id: guest },
    items: [{ name: "Steak", quantity: 1, unit_price: 189 }],
  });
  return { ...placed, table };
}

async function autoAssign(s: { table: RestaurantTable; session_id: string }) {
  return assignSeatingWaiter({
    restaurant_id: RID,
    table_id: s.table.id,
    session_id: s.session_id,
  });
}

beforeEach(() => {
  db.reset();
  db.docs.set(`restaurants/${RID}`, { id: RID, name: "Nonna's Trattoria" });
});

describe("pickNextWaiter — who gets the next table", () => {
  it("goes round the online waiters in turn: whoever has waited longest first", () => {
    const waiters = [
      waiter("w_amy", { last_assigned_at: "2026-09-30T10:00:00.000Z" }),
      waiter("w_ben", { last_assigned_at: "2026-09-30T09:00:00.000Z" }),
      waiter("w_cal"),
    ];
    expect(pickNextWaiter(waiters, "brn_sandton")?.uid).toBe("w_cal");
    waiters[2]!.last_assigned_at = "2026-09-30T11:00:00.000Z";
    expect(pickNextWaiter(waiters, "brn_sandton")?.uid).toBe("w_ben");
    waiters[1]!.last_assigned_at = "2026-09-30T11:05:00.000Z";
    expect(pickNextWaiter(waiters, "brn_sandton")?.uid).toBe("w_amy");
  });

  it("only picks waiters who are active, online and cover the table's branch", () => {
    const waiters = [
      waiter("w_off", { online: false }),
      waiter("w_gone", { active: false }),
      waiter("w_rose", { branch_id: "brn_rosebank" }),
      waiter("w_sand", { branch_id: "brn_sandton", last_assigned_at: "2026-09-30T12:00:00.000Z" }),
    ];
    expect(pickNextWaiter(waiters, "brn_sandton")?.uid).toBe("w_sand");
    expect(pickNextWaiter(waiters, "brn_rosebank")?.uid).toBe("w_rose");
    expect(pickNextWaiter(waiters, "brn_other")).toBeNull();
  });

  it("gives every table to the one waiter on a branch", () => {
    const only = [waiter("w_solo", { branch_id: "brn_sandton" })];
    for (let i = 0; i < 5; i++) {
      expect(pickNextWaiter(only, "brn_sandton")?.uid).toBe("w_solo");
      only[0]!.last_assigned_at = `2026-09-30T1${i}:00:00.000Z`;
    }
  });

  it("an all-branches waiter covers every branch; a table with no branch takes anyone", () => {
    expect(waiterCoversBranch({ branch_id: null }, "brn_sandton")).toBe(true);
    expect(waiterCoversBranch({ branch_id: "brn_sandton" }, "brn_sandton")).toBe(true);
    expect(waiterCoversBranch({ branch_id: "brn_sandton" }, "brn_rosebank")).toBe(false);
    expect(waiterCoversBranch({ branch_id: "brn_sandton" }, null)).toBe(true);
  });
});

describe("assignSeatingWaiter — automatic assignment", () => {
  it("assigns each new table to the next waiter in turn, and every order at it", async () => {
    seedRoster([waiter("w_amy"), waiter("w_ben", { online_since: "2026-09-30T08:30:00.000Z" })]);
    const tables = await Promise.all(["10", "11", "12"].map((l) => addTable(l)));
    const seatings = [];
    for (const t of tables) seatings.push(await seat(t));

    const outcomes = [];
    for (const s of seatings) outcomes.push(await autoAssign(s));

    expect(outcomes.map((o) => (o.status === "assigned" ? o.waiter_id : o.status))).toEqual([
      "w_amy",
      "w_ben",
      "w_amy",
    ]);
    expect(tableDoc(tables[0]!)["session"]).toMatchObject({
      waiter_id: "w_amy",
      waiter_name: "Amy",
    });
    expect(orderDoc(seatings[0]!.order_id)["dine_in"]).toMatchObject({
      waiter_id: "w_amy",
      waiter_name: "Amy",
    });
    expect(roster()["waiters"]["w_amy"]["assigned_count"]).toBe(2);
    expect(roster()["waiters"]["w_ben"]["assigned_count"]).toBe(1);
  });

  it("keeps the table with its waiter: the next order at the same seating goes to them too", async () => {
    seedRoster([waiter("w_amy"), waiter("w_ben")]);
    const s = await seat(await addTable("10"));
    await autoAssign(s);

    const next = await seat(s.table, "guest_2");
    expect(next.session_id).toBe(s.session_id);
    expect(orderDoc(next.order_id)["dine_in"]).toMatchObject({ waiter_id: "w_amy" });
    expect(await autoAssign(s)).toEqual({ status: "unchanged" });
  });

  it("assigns a seating once, even when two devices try at the same moment", async () => {
    seedRoster([waiter("w_amy"), waiter("w_ben")]);
    const s = await seat(await addTable("10"));

    const results = await Promise.all([autoAssign(s), autoAssign(s)]);

    expect(results.map((r) => r.status).sort()).toEqual(["assigned", "unchanged"]);
    const counts = Object.values(roster()["waiters"] as Record<string, Doc>).map(
      (w) => w["assigned_count"],
    );
    expect(counts.sort()).toEqual([0, 1]);
  });

  it("only gives a branch's tables to waiters who work there", async () => {
    seedRoster([
      waiter("w_rose", { branch_id: "brn_rosebank" }),
      waiter("w_sand", { branch_id: "brn_sandton" }),
    ]);
    for (let i = 0; i < 3; i++) {
      const s = await seat(await addTable(`S${i}`, "brn_sandton"));
      expect(await autoAssign(s)).toMatchObject({ waiter_id: "w_sand" });
    }
    const r = await seat(await addTable("R1", "brn_rosebank"));
    expect(await autoAssign(r)).toMatchObject({ waiter_id: "w_rose" });
  });

  it("leaves a table waiting when nobody is online, then gives it to the first waiter to come on", async () => {
    seedRoster([waiter("w_amy", { online: false })]);
    const s = await seat(await addTable("10"));

    expect(await autoAssign(s)).toEqual({ status: "no-waiter-available" });
    expect(seatingsNeedingWaiter(await listTables(RID)).map((t) => t.id)).toEqual([s.table.id]);

    const result = await setWaiterOnline({
      restaurant_id: RID,
      waiter: { uid: "w_amy", name: "Amy", branch_id: null, branch_name: null },
      online: true,
      actor: null,
    });

    expect(result.tables_assigned).toBe(1);
    expect(tableDoc(s.table)["session"]["waiter_id"]).toBe("w_amy");
    expect(orderDoc(s.order_id)["dine_in"]["waiter_id"]).toBe("w_amy");
  });

  it("hands a waiter's tables to the next waiter when they go offline", async () => {
    seedRoster([waiter("w_amy"), waiter("w_ben")]);
    const s = await seat(await addTable("10"));
    await autoAssign(s);

    const result = await setWaiterOnline({
      restaurant_id: RID,
      waiter: { uid: "w_amy", name: "Amy", branch_id: null, branch_name: null },
      online: false,
      actor: { email: "amy@nonna.test", name: "Amy" },
    });

    expect(result.tables_moved).toBe(1);
    expect(tableDoc(s.table)["session"]["waiter_id"]).toBe("w_ben");
    expect(orderDoc(s.order_id)["dine_in"]).toMatchObject({
      waiter_id: "w_ben",
      waiter_name: "Ben",
    });
  });

  it("with nobody else on, a leaving waiter's tables wait for the next one", async () => {
    seedRoster([waiter("w_amy")]);
    const s = await seat(await addTable("10"));
    await autoAssign(s);

    await setWaiterOnline({
      restaurant_id: RID,
      waiter: { uid: "w_amy", name: "Amy", branch_id: null, branch_name: null },
      online: false,
      actor: null,
    });

    expect(tableDoc(s.table)["session"]["waiter_id"]).toBeNull();
    // A null in an update deletes the field; it reads back as "no waiter".
    expect(orderDoc(s.order_id)["dine_in"]["waiter_id"] ?? null).toBeNull();
  });

  it("deactivating a waiter suspends their login and moves their tables", async () => {
    seedRoster([waiter("w_amy"), waiter("w_ben")]);
    const s = await seat(await addTable("10"));
    await autoAssign(s);

    await setWaiterActive({ restaurant_id: RID, uid: "w_amy", active: false, actor: null });

    expect((db.docs.get("restaurantUsers/w_amy") as Doc)["status"]).toBe("suspended");
    expect(roster()["waiters"]["w_amy"]).toMatchObject({ active: false, online: false });
    expect(tableDoc(s.table)["session"]["waiter_id"]).toBe("w_ben");
  });

  it("lets a manager move a table to a chosen waiter, but not to a deactivated one", async () => {
    seedRoster([waiter("w_amy"), waiter("w_ben"), waiter("w_gone", { active: false })]);
    const s = await seat(await addTable("10"));
    await autoAssign(s);

    expect(
      await assignSeatingWaiter({
        restaurant_id: RID,
        table_id: s.table.id,
        session_id: s.session_id,
        waiter_id: "w_ben",
        actor: { email: "boss@nonna.test", name: "Boss" },
      }),
    ).toMatchObject({ status: "assigned", waiter_id: "w_ben" });
    await expect(
      assignSeatingWaiter({
        restaurant_id: RID,
        table_id: s.table.id,
        session_id: s.session_id,
        waiter_id: "w_gone",
      }),
    ).rejects.toThrow(/isn't available/);
    expect(tableDoc(s.table)["session"]["waiter_id"]).toBe("w_ben");
  });

  it("leaves a table that has been cleared (or re-seated) alone", async () => {
    seedRoster([waiter("w_amy")]);
    const s = await seat(await addTable("10"));
    expect(
      await assignSeatingWaiter({
        restaurant_id: RID,
        table_id: s.table.id,
        session_id: "ses_old",
      }),
    ).toEqual({ status: "gone" });
    expect(tableDoc(s.table)["session"]["waiter_id"]).toBeNull();
  });
});
