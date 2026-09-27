import { beforeEach, describe, expect, it, vi } from "vitest";

// Firestore is replaced by the in-memory fake in src/lib/testing/fake-firestore.ts.
vi.mock("@/lib/firestore", async (importOriginal) =>
  (await import("@/lib/testing/fake-firestore")).fakeFirestoreModule(await importOriginal()),
);

import { fakeDb as db } from "@/lib/testing/fake-firestore";
import {
  DEFAULT_ORDER_MODE,
  generateQrToken,
  isQrToken,
  issueTableQr,
  listTables,
  normalizeCustomerAppUrl,
  normalizeTable,
  resolveOrderMode,
  resolveTableQrToken,
  saveTable,
  tableDisplayName,
  tableLabelKey,
  tableQrUrl,
  validateTableConfig,
  type TableOrderMode,
} from "@/lib/tables.firebase";

const RID = "rst-nonna";
const tableDoc = (id: string) => db.docs.get(`restaurants/${RID}/tables/${id}`);
const tokenDocs = () => [...db.docs.keys()].filter((k) => k.startsWith("tableQrTokens/"));

function create(label: string, order_mode: TableOrderMode, capacity = 4, active = true) {
  return saveTable({
    restaurant_id: RID,
    label,
    capacity,
    active,
    order_mode,
    actor: "ops@hearth.test",
  });
}

beforeEach(() => {
  db.reset();
});

describe("order mode defaults", () => {
  it("reads only 'multiple' as multiple — everything else is the safe default, single", () => {
    expect(DEFAULT_ORDER_MODE).toBe("single");
    expect(resolveOrderMode("multiple")).toBe("multiple");
    expect(resolveOrderMode("single")).toBe("single");
    for (const junk of [undefined, null, "", "shared", "MULTIPLE", 2, {}]) {
      expect(resolveOrderMode(junk)).toBe("single");
    }
  });

  it("an existing table saved before order modes existed loads as Single, active", async () => {
    db.docs.set(`restaurants/${RID}/tables/legacy-7`, { label: "7", capacity: 6 });
    const [table] = await listTables(RID);
    expect(table).toMatchObject({
      id: "legacy-7",
      label: "7",
      capacity: 6,
      active: true,
      order_mode: "single",
    });
  });

  it("normalises partial records without inventing a QR code", () => {
    expect(normalizeTable(RID, "t1", {})).toMatchObject({
      label: "t1",
      capacity: 4,
      active: true,
      order_mode: "single",
      qr_token: null,
    });
    expect(normalizeTable(RID, "t1", null)).toBeNull();
  });
});

describe("saveTable — creating tables", () => {
  it("creates a Single Order Per Table table and loads it back as single", async () => {
    const saved = await create("12", "single");
    expect(tableDoc(saved.id)).toMatchObject({
      label: "12",
      capacity: 4,
      active: true,
      order_mode: "single",
    });
    const [loaded] = await listTables(RID);
    expect(loaded).toMatchObject({ id: saved.id, order_mode: "single" });
  });

  it("creates a Multiple Orders Per Table table and loads it back as multiple", async () => {
    const saved = await create("5", "multiple");
    expect(tableDoc(saved.id)).toMatchObject({ label: "5", order_mode: "multiple" });
    const [loaded] = await listTables(RID);
    expect(loaded).toMatchObject({ id: saved.id, order_mode: "multiple" });
  });

  it("keeps capacity independent of order mode", async () => {
    await create("1", "single", 4);
    await create("2", "multiple", 4);
    const tables = await listTables(RID);
    expect(tables.map((t) => [t.label, t.capacity, t.order_mode])).toEqual([
      ["1", 4, "single"],
      ["2", 4, "multiple"],
    ]);
  });

  it("stores an inactive table as inactive", async () => {
    const saved = await create("9", "single", 2, false);
    expect(tableDoc(saved.id)?.["active"]).toBe(false);
  });

  it("refuses a duplicate table number — however it's typed — and writes nothing", async () => {
    await create("12", "single");
    for (const dupe of ["12", " 12 ", "Table 12", "TABLE   12"]) {
      await expect(create(dupe, "multiple")).rejects.toThrow("Table 12 already exists");
    }
    expect(await listTables(RID)).toHaveLength(1);
  });

  it("rejects invalid capacity and order mode", async () => {
    for (const capacity of [0, -1, 2.5, 51, Number.NaN]) {
      await expect(create("3", "single", capacity)).rejects.toThrow(/capacity/i);
    }
    await expect(create("3", "shared" as TableOrderMode)).rejects.toThrow(/order mode/i);
    await expect(create("   ", "single")).rejects.toThrow(/table number or name/i);
    expect(db.docs.size).toBe(0);
  });
});

describe("saveTable — editing tables", () => {
  it("switches Single → Multiple in place: same record, no duplicate", async () => {
    const saved = await create("12", "single");
    const edited = await saveTable({
      ...saved,
      order_mode: "multiple",
      restaurant_id: RID,
      id: saved.id,
    });
    expect(edited.id).toBe(saved.id);
    const tables = await listTables(RID);
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ id: saved.id, order_mode: "multiple" });
  });

  it("switches Multiple → Single in place", async () => {
    const saved = await create("5", "multiple");
    await saveTable({ ...saved, order_mode: "single", restaurant_id: RID, id: saved.id });
    const tables = await listTables(RID);
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ id: saved.id, order_mode: "single" });
  });

  it("only touches the config fields — unrelated fields survive exactly", async () => {
    const original = {
      label: "12",
      capacity: 4,
      active: true,
      order_mode: "single",
      qr_token: "keep-this-token",
      created_at: "2026-01-01T00:00:00.000Z",
      section: "patio", // written by another app
      sort_order: 3,
    };
    db.docs.set(`restaurants/${RID}/tables/t12`, structuredClone(original));

    await saveTable({
      restaurant_id: RID,
      id: "t12",
      label: "12",
      capacity: 6,
      active: true,
      order_mode: "multiple",
      actor: "ops@hearth.test",
    });

    const after = tableDoc("t12")!;
    expect(after).toMatchObject({
      ...original,
      capacity: 6,
      order_mode: "multiple",
      updated_by: "ops@hearth.test",
    });
    expect(Object.keys(after).sort()).toEqual(
      [...Object.keys(original), "updated_at", "updated_by"].sort(),
    );
  });

  it("a legacy table with no order mode opens as Single and saves cleanly", async () => {
    db.docs.set(`restaurants/${RID}/tables/legacy-7`, { label: "7", capacity: 6, active: true });
    const [table] = await listTables(RID);
    await saveTable({ ...table!, capacity: 8, restaurant_id: RID, id: table!.id });
    expect(tableDoc("legacy-7")).toMatchObject({ label: "7", capacity: 8, order_mode: "single" });
  });

  it("allows keeping its own name but not taking another table's", async () => {
    const twelve = await create("12", "single");
    await create("14", "single");
    await expect(
      saveTable({ ...twelve, capacity: 2, restaurant_id: RID, id: twelve.id }),
    ).resolves.toMatchObject({ capacity: 2 });
    await expect(
      saveTable({ ...twelve, label: "Table 14", restaurant_id: RID, id: twelve.id }),
    ).rejects.toThrow("Table 14 already exists");
    expect(tableDoc(twelve.id)?.["label"]).toBe("12");
  });

  it("never turns an edit of a removed table into a new record", async () => {
    await expect(
      saveTable({
        restaurant_id: RID,
        id: "gone",
        label: "3",
        capacity: 4,
        active: true,
        order_mode: "single",
      }),
    ).rejects.toThrow("no longer exists");
    expect(db.docs.size).toBe(0);
  });

  it("keeps the QR lookup in step with the table's label, mode and status", async () => {
    const saved = await create("12", "single");
    const { qr_token } = await issueTableQr({ restaurant_id: RID, table_id: saved.id });
    await saveTable({
      restaurant_id: RID,
      id: saved.id,
      label: "12A",
      capacity: 4,
      active: false,
      order_mode: "multiple",
    });
    expect(await resolveTableQrToken(qr_token!)).toMatchObject({
      restaurant_id: RID,
      table_id: saved.id,
      table_label: "12A",
      order_mode: "multiple",
      active: false,
    });
  });
});

describe("table QR codes", () => {
  it("issues an opaque token that resolves to exactly this restaurant and table", async () => {
    const saved = await create("12", "multiple");
    const table = await issueTableQr({
      restaurant_id: RID,
      table_id: saved.id,
      actor: "ops@hearth.test",
    });

    expect(isQrToken(table.qr_token!)).toBe(true);
    expect(table.qr_token).not.toContain(RID);
    expect(table.qr_token).not.toContain(saved.id);
    expect(tableDoc(saved.id)).toMatchObject({
      qr_token: table.qr_token,
      qr_generated_by: "ops@hearth.test",
    });
    expect(await resolveTableQrToken(table.qr_token!)).toMatchObject({
      restaurant_id: RID,
      table_id: saved.id,
      table_label: "12",
      order_mode: "multiple",
      active: true,
    });
  });

  it("stores nothing sensitive in the token record", async () => {
    const saved = await create("12", "single");
    const { qr_token } = await issueTableQr({
      restaurant_id: RID,
      table_id: saved.id,
      actor: "ops@hearth.test",
    });
    expect(Object.keys(db.docs.get(`tableQrTokens/${qr_token}`)!).sort()).toEqual(
      [
        "active",
        "created_at",
        "order_mode",
        "restaurant_id",
        "table_id",
        "table_label",
        "updated_at",
      ].sort(),
    );
  });

  it("encodes only the customer app address and the token in the QR link", () => {
    const token = generateQrToken();
    expect(tableQrUrl("https://order.example.com", token)).toBe(
      `https://order.example.com/dine-in/${token}`,
    );
    expect(tableQrUrl("https://order.example.com/", token)).toBe(
      `https://order.example.com/dine-in/${token}`,
    );
  });

  it("regenerating revokes the old code in the same write", async () => {
    const saved = await create("12", "single");
    const first = await issueTableQr({ restaurant_id: RID, table_id: saved.id });
    const second = await issueTableQr({ restaurant_id: RID, table_id: saved.id });

    expect(second.qr_token).not.toBe(first.qr_token);
    expect(await resolveTableQrToken(first.qr_token!)).toBeNull();
    expect(await resolveTableQrToken(second.qr_token!)).toMatchObject({ table_id: saved.id });
    expect(tokenDocs()).toEqual([`tableQrTokens/${second.qr_token}`]);
    expect(tableDoc(saved.id)?.["qr_token"]).toBe(second.qr_token);
  });

  it("won't issue a code for a table that doesn't exist", async () => {
    await expect(issueTableQr({ restaurant_id: RID, table_id: "nope" })).rejects.toThrow(
      "no longer exists",
    );
    expect(tokenDocs()).toEqual([]);
  });

  it("ignores anything that isn't a well-formed token", async () => {
    for (const bad of [
      "",
      "12",
      `${RID}/tables/t1`,
      "a".repeat(31),
      "a".repeat(33),
      "a/".repeat(16),
    ]) {
      expect(await resolveTableQrToken(bad)).toBeNull();
    }
  });

  it("generates unique, URL-safe, 192-bit tokens", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateQrToken()));
    expect(tokens.size).toBe(1000);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe("helpers", () => {
  it("treats 'Table 12' and '12' as the same table", () => {
    expect(tableLabelKey("Table 12")).toBe("12");
    expect(tableLabelKey("  PATIO   3 ")).toBe("patio 3");
    expect(tableLabelKey("Table")).toBe("table");
  });

  it("names numeric tables 'Table N' and leaves named ones alone", () => {
    expect(tableDisplayName("12")).toBe("Table 12");
    expect(tableDisplayName("12a")).toBe("Table 12a");
    expect(tableDisplayName("Patio 3")).toBe("Patio 3");
  });

  it("validates without the table being edited counting as a duplicate", () => {
    const config = { label: "12", capacity: 4, active: true, order_mode: "single" as const };
    expect(validateTableConfig(config, [])).toBeNull();
    expect(validateTableConfig(config, [{ label: "12" }])).toMatch(/already exists/);
  });

  it("accepts only https (or local http) customer app addresses", () => {
    expect(normalizeCustomerAppUrl("https://order.example.com/")).toBe("https://order.example.com");
    expect(normalizeCustomerAppUrl(" https://example.com/app// ")).toBe("https://example.com/app");
    expect(normalizeCustomerAppUrl("http://localhost:5174")).toBe("http://localhost:5174");
    for (const bad of [
      "",
      "order.example.com",
      "http://order.example.com",
      "javascript:alert(1)",
      "https://x.com/?t=1",
    ]) {
      expect(normalizeCustomerAppUrl(bad)).toBeNull();
    }
  });
});
