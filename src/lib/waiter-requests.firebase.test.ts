import { beforeEach, describe, expect, it, vi } from "vitest";

// Firestore is replaced by the in-memory fake in src/lib/testing/fake-firestore.ts.
vi.mock("@/lib/firestore", async (importOriginal) =>
  (await import("@/lib/testing/fake-firestore")).fakeFirestoreModule(await importOriginal()),
);

import { fakeDb as db } from "@/lib/testing/fake-firestore";
import { buildTableOverview } from "@/lib/table-overview";
import { placeDineInOrder } from "@/lib/table-sessions.firebase";
import { issueTableQr, listTables, saveTable, type RestaurantTable } from "@/lib/tables.firebase";
import {
  acceptWaiterRequest,
  activeWaiterRequests,
  normalizeWaiterRequest,
  requestWaiter,
  resolveWaiterRequest,
  waiterRequestMessage,
  type WaiterRequest,
} from "@/lib/waiter-requests.firebase";

const RID = "rst-nonna";
type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const SAM = { id: "staff_sam", email: "sam@nonna.test", name: "Sam" };
const LEE = { id: "staff_lee", email: "lee@nonna.test", name: "Lee" };

async function addTable(
  label: string,
  order_mode: "single" | "multiple" = "multiple",
  active = true,
) {
  return saveTable({ restaurant_id: RID, label, capacity: 4, active, order_mode });
}

const call = (table: RestaurantTable, guest: string, message?: string) =>
  requestWaiter({
    table: { restaurant_id: RID, table_id: table.id },
    guest: { id: guest },
    ...(message ? { message } : {}),
  });

const order = (table: RestaurantTable, guest: string) =>
  placeDineInOrder({
    table: { restaurant_id: RID, table_id: table.id },
    guest: { id: guest },
    items: [{ name: "Steak", quantity: 1, unit_price: 189 }],
  });

const requestDoc = (id: string) => db.docs.get(`waiterRequests/${id}`) as Doc;
const request = (id: string) => normalizeWaiterRequest(id, requestDoc(id))!;
const tableDoc = (table: RestaurantTable) =>
  db.docs.get(`restaurants/${RID}/tables/${table.id}`) as Doc;
const allRequests = () =>
  [...db.docs.entries()]
    .filter(([path]) => path.startsWith("waiterRequests/"))
    .map(([path, doc]) => normalizeWaiterRequest(path.split("/")[1]!, doc)!);

beforeEach(() => {
  db.reset();
  db.docs.set(`restaurants/${RID}`, { id: RID, name: "Nonna's Table" });
});

describe("Task 8 — a guest requests a waiter", () => {
  it("records the call against the right restaurant, table, table session and guest", async () => {
    const table = await addTable("12");
    await order(table, "guest_a");
    const placed = await order(table, "guest_b");

    const result = await call(table, "guest_b");

    expect(result.created).toBe(true);
    const session = tableDoc(table)["session"];
    expect(request(result.request_id)).toMatchObject({
      restaurant_id: RID,
      restaurant_name: "Nonna's Table",
      table_id: table.id,
      table_label: "12",
      table_session_id: session.id,
      order_mode: "multiple",
      guest_id: "guest_b",
      guest_label: "Customer 2",
      order_id: placed.order_id,
      status: "open",
      request_count: 1,
    });
    expect(result).toMatchObject({ session_id: session.id, guest_label: "Customer 2" });
  });

  it("shows what staff read on the card: “Customer needs assistance.” unless the guest said more", async () => {
    const table = await addTable("12");
    const plain = await call(table, "guest_a");
    const bill = await call(table, "guest_b", "  Can we have the bill?  ");

    expect(waiterRequestMessage(request(plain.request_id))).toBe("Customer needs assistance.");
    expect(waiterRequestMessage(request(bill.request_id))).toBe("Can we have the bill?");
  });

  it("a guest who calls before ordering starts the seating, and their order joins it", async () => {
    const table = await addTable("12");
    const called = await call(table, "guest_a");
    const placed = await order(table, "guest_a");

    expect(placed.session_id).toBe(called.session_id);
    expect(placed.guest_label).toBe(called.guest_label);
    expect(request(called.request_id).table_session_id).toBe(placed.session_id);
  });

  it("pressing it again while waiting asks again on the same call — also after the guest has ordered", async () => {
    const table = await addTable("10", "single");
    const first = await call(table, "guest_a");
    await order(table, "guest_a"); // rewrites the seating; the pointer to the call must survive
    const again = await call(table, "guest_a", "Still waiting");

    expect(again).toMatchObject({ request_id: first.request_id, created: false });
    expect(request(first.request_id)).toMatchObject({ request_count: 2, message: "Still waiting" });
    expect(allRequests()).toHaveLength(1);

    await resolveWaiterRequest({ request_id: first.request_id, actor: SAM });
    const later = await call(table, "guest_a");
    expect(later.created).toBe(true);
    expect(later.request_id).not.toBe(first.request_id);
  });

  it("keeps different guests' calls apart", async () => {
    const table = await addTable("12");
    const [a, b] = await Promise.all([call(table, "guest_a"), call(table, "guest_b")]);

    expect(a.request_id).not.toBe(b.request_id);
    expect(a.session_id).toBe(b.session_id);
    expect(
      allRequests()
        .map((r) => r.guest_label)
        .sort(),
    ).toEqual(["Customer 1", "Customer 2"]);
    expect(Object.keys(tableDoc(table)["session"].guests)).toHaveLength(2);
  });

  it("works from the QR code, and refuses a regenerated code or a switched-off table", async () => {
    const table = await addTable("12");
    const { qr_token: token } = await issueTableQr({ restaurant_id: RID, table_id: table.id });
    const byToken = await requestWaiter({ table: { token: token! }, guest: { id: "guest_a" } });
    expect(request(byToken.request_id).table_id).toBe(table.id);

    await issueTableQr({ restaurant_id: RID, table_id: table.id });
    await expect(
      requestWaiter({ table: { token: token! }, guest: { id: "guest_b" } }),
    ).rejects.toMatchObject({ code: "dine-in/invalid-code" });

    const off = await addTable("9", "single", false);
    await expect(call(off, "guest_c")).rejects.toMatchObject({ code: "dine-in/table-inactive" });
    expect(allRequests()).toHaveLength(1);
  });

  it("writes the table back untouched apart from its seating", async () => {
    const table = await addTable("12");
    db.docs.set(`restaurants/${RID}/tables/${table.id}`, { ...tableDoc(table), section: "patio" });
    const before = structuredClone(tableDoc(table));

    await call(table, "guest_a");

    const { session, ...rest } = tableDoc(table);
    expect(rest).toEqual(
      Object.fromEntries(Object.entries(before).filter(([k]) => k !== "session")),
    );
    expect(
      Object.values(session.guests as Record<string, Doc>)[0]!["waiter_request_id"],
    ).toBeTruthy();
  });
});

describe("Task 8 — staff accept and resolve", () => {
  it("accept marks who is on it; resolve closes it", async () => {
    const table = await addTable("12");
    const { request_id } = await call(table, "guest_a");

    const accepted = await acceptWaiterRequest({ request_id, actor: SAM });
    expect(accepted).toMatchObject({
      status: "accepted",
      accepted_by: "Sam",
      accepted_by_id: "staff_sam",
    });
    expect(request(request_id).accepted_at).toBeTruthy();

    expect(await resolveWaiterRequest({ request_id, actor: SAM })).toBe(true);
    expect(request(request_id)).toMatchObject({ status: "resolved", resolved_by: "Sam" });
  });

  it("can be resolved straight away, by any waiter, and only once", async () => {
    const table = await addTable("12");
    const { request_id } = await call(table, "guest_a");

    expect(await resolveWaiterRequest({ request_id, actor: LEE })).toBe(true);
    expect(await resolveWaiterRequest({ request_id, actor: SAM })).toBe(false);
    expect(request(request_id).resolved_by).toBe("Lee");
    await expect(acceptWaiterRequest({ request_id, actor: SAM })).rejects.toMatchObject({
      code: "dine-in/request-closed",
    });
  });

  it("only one waiter can take a call, even when two accept at the same moment", async () => {
    const table = await addTable("12");
    const { request_id } = await call(table, "guest_a");

    const results = await Promise.allSettled([
      acceptWaiterRequest({ request_id, actor: SAM }),
      acceptWaiterRequest({ request_id, actor: LEE }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = request(request_id).accepted_by;
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toMatchObject({ code: "dine-in/request-taken" });
    expect(String(loser.reason.message)).toContain(winner!);
    // Accepting a call you already hold is fine.
    const holder = winner === "Sam" ? SAM : LEE;
    await expect(acceptWaiterRequest({ request_id, actor: holder })).resolves.toMatchObject({
      status: "accepted",
    });
  });

  it("refuses unknown requests", async () => {
    await expect(acceptWaiterRequest({ request_id: "wr_nope", actor: SAM })).rejects.toMatchObject({
      code: "dine-in/request-not-found",
    });
    await expect(resolveWaiterRequest({ request_id: "../x", actor: SAM })).rejects.toMatchObject({
      code: "dine-in/request-not-found",
    });
  });
});

describe("Task 8 — where waiters see calls", () => {
  it("lists unanswered calls first, longest-waiting first, for the chosen restaurant", () => {
    const r = (id: string, overrides: Partial<WaiterRequest>) =>
      normalizeWaiterRequest(id, {
        restaurant_id: RID,
        table_id: "t1",
        created_at: "2026-09-27T10:00:00Z",
        ...overrides,
      })!;
    const rows = [
      r("a", { status: "accepted", created_at: "2026-09-27T09:00:00Z" }),
      r("b", { created_at: "2026-09-27T10:05:00Z" }),
      r("c", { created_at: "2026-09-27T10:01:00Z" }),
      r("d", { status: "resolved" }),
      r("e", { restaurant_id: "rst-other" }),
    ];
    expect(activeWaiterRequests(rows, { restaurantId: RID }).map((x) => x.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(activeWaiterRequests(rows).map((x) => x.id)).toContain("e");
  });

  it("puts the call on its table in the Table overview, which shows as occupied even before anyone orders", async () => {
    const twelve = await addTable("12");
    const ten = await addTable("10", "single");
    const { request_id } = await call(twelve, "guest_a");

    const overview = async () => {
      const entries = buildTableOverview(await listTables(RID), [], Date.now(), allRequests());
      return {
        t12: entries.find((e) => e.table.id === twelve.id)!,
        t10: entries.find((e) => e.table.id === ten.id)!,
      };
    };

    const before = await overview();
    expect(before.t12.status).toBe("occupied");
    expect(before.t12.waiter_requests.map((x) => x.id)).toEqual([request_id]);
    expect(before.t10).toMatchObject({ status: "available", waiter_requests: [] });

    await resolveWaiterRequest({ request_id, actor: SAM });
    const after = await overview();
    expect(after.t12.waiter_requests).toEqual([]);
    expect(after.t12.status).toBe("available");
  });
});
