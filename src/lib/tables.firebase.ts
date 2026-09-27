// Firestore-backed dine-in table configuration, per restaurant.
//
// Data shape (shared with the Restaurant Admin and Customer apps — do not
// rename fields; see docs/DINE_IN_TABLES_QR_HANDOVER.md):
//   /restaurants/{restaurantId}/tables/{tableId}  -> RestaurantTable (one doc per table;
//                                                    its `session` is the seating, managed by
//                                                    table-sessions.firebase.ts)
//   /tableQrTokens/{token}                        -> TableQrTokenRecord (QR lookup index)
//   /settings/dine_in                             -> { customer_app_url } (QR link base)
//
// Capacity and order mode are independent settings: a 4-seat table can take
// one shared order ("single") or a separate order per guest ("multiple").
//
// Tables saved before order modes existed have no `order_mode` field. They
// read as DEFAULT_ORDER_MODE ("single") and keep working unchanged; the field
// is written the next time someone saves that table. No migration needed.
//
// A QR code carries nothing but an opaque random token. The token document
// maps it to restaurant + table and mirrors the few fields a guest's app needs
// (label, order mode, active). Firestore rules let a client read a token it
// already holds but never list them, so a guest can't discover — or switch
// to — another table's code.

import {
  fsBatch,
  fsGet,
  fsSubscribe,
  fsUpdate,
  isFirebaseAvailable,
  type FirestoreValue,
  type FsBatchWrite,
} from "@/lib/firestore";

/* -------------------------------------------------------------- order mode */

export type TableOrderMode = "single" | "multiple";

/** Applied to any table (or order) that has no valid order mode stored. */
export const DEFAULT_ORDER_MODE: TableOrderMode = "single";

export const ORDER_MODE_OPTIONS: {
  id: TableOrderMode;
  label: string;
  short: string;
  description: string;
}[] = [
  {
    id: "single",
    label: "Single Order Per Table",
    short: "Single",
    description: "Everyone at the table adds to one shared order and one bill.",
  },
  {
    id: "multiple",
    label: "Multiple Orders Per Table",
    short: "Multiple",
    description: "Each guest places, and pays for, their own separate order.",
  },
];

/** Canonical read of an order mode — anything unrecognised is the safe default. */
export function resolveOrderMode(raw: unknown): TableOrderMode {
  return raw === "multiple" ? "multiple" : DEFAULT_ORDER_MODE;
}

export function orderModeLabel(mode: TableOrderMode, variant: "short" | "long" = "short"): string {
  const option = ORDER_MODE_OPTIONS.find((o) => o.id === mode) ?? ORDER_MODE_OPTIONS[0]!;
  return variant === "short" ? option.short : option.label;
}

/* ------------------------------------------------------------------ tables */

export interface RestaurantTable {
  id: string;
  restaurant_id: string;
  /** Table number or name, e.g. "12" or "Patio 3". Unique per restaurant. */
  label: string;
  /** Seats at the table. Independent of order_mode. */
  capacity: number;
  /** Inactive tables stay listed but their QR code must not accept orders. */
  active: boolean;
  order_mode: TableOrderMode;
  /** Current QR token — null until one is generated. */
  qr_token: string | null;
  qr_generated_at: string | null;
  qr_generated_by: string | null;
  /** The seating currently at the table (null when the table is free). Written
   *  only by table-sessions.firebase.ts. */
  session: TableSession | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

/**
 * One seating at a table: everything ordered from the moment the first guest
 * orders until staff clear the table (or it has sat idle for
 * SESSION_IDLE_TIMEOUT_MS). Every order placed meanwhile carries its id in
 * `dine_in.table_session_id`.
 */
export interface TableSession {
  id: string;
  opened_at: string;
  /** Last time anyone ordered, or called a waiter, in this seating. */
  last_activity_at: string;
  /** Fixed for the whole seating — a mode change made mid-meal applies from the next seating. */
  order_mode: TableOrderMode;
  /** Single mode: the table's most recent order (it takes everyone's items while still open). */
  current_order_id: string | null;
  /** Orders created in this seating so far. */
  order_count: number;
  /** Everyone who has ordered, keyed by guest id. */
  guests: Record<string, TableSessionGuest>;
}

/**
 * A seating nobody has ordered in for this long is treated as over, so the
 * next party at the table starts a fresh one even if staff forgot to clear it.
 */
export const SESSION_IDLE_TIMEOUT_MS = 3 * 60 * 60 * 1000;

export function isSessionIdle(
  session: Pick<TableSession, "last_activity_at">,
  now = Date.now(),
): boolean {
  const last = Date.parse(session.last_activity_at);
  return !Number.isFinite(last) || now - last > SESSION_IDLE_TIMEOUT_MS;
}

export interface TableSessionGuest {
  /** "Customer 2", or the guest's name when known. */
  label: string;
  joined_at: string;
  /** Multiple mode: this guest's most recent order (only ever their own). */
  current_order_id: string | null;
  order_count: number;
  /** This guest's latest waiter call (waiter-requests.firebase.ts), so pressing
   *  "Request waiter" again doesn't open a second one while it's unanswered. */
  waiter_request_id: string | null;
}

/** The fields an admin edits. Everything else on the record is left alone. */
export interface TableConfigInput {
  label: string;
  capacity: number;
  active: boolean;
  order_mode: TableOrderMode;
}

export const DEFAULT_TABLE_CAPACITY = 4;
export const MAX_TABLE_CAPACITY = 50;
export const MAX_TABLE_LABEL_LENGTH = 40;

const tablesPath = (restaurantId: string) => `restaurants/${restaurantId}/tables`;
export const tablePath = (restaurantId: string, tableId: string) =>
  `${tablesPath(restaurantId)}/${tableId}`;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strOrNull = (v: unknown): string | null => str(v) || null;
const count = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** Normalise a stored seating; null when there isn't a valid one. */
export function normalizeTableSession(raw: unknown): TableSession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r["id"]);
  const openedAt = str(r["opened_at"]);
  if (!id || !openedAt) return null;
  const guests: Record<string, TableSessionGuest> = {};
  const rawGuests = r["guests"];
  if (rawGuests && typeof rawGuests === "object") {
    for (const [guestId, value] of Object.entries(rawGuests as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const g = value as Record<string, unknown>;
      guests[guestId] = {
        label: str(g["label"]) || "Guest",
        joined_at: str(g["joined_at"]) || openedAt,
        current_order_id: strOrNull(g["current_order_id"]),
        order_count: count(g["order_count"]),
        waiter_request_id: strOrNull(g["waiter_request_id"]),
      };
    }
  }
  return {
    id,
    opened_at: openedAt,
    last_activity_at: str(r["last_activity_at"]) || openedAt,
    order_mode: resolveOrderMode(r["order_mode"]),
    current_order_id: strOrNull(r["current_order_id"]),
    order_count: count(r["order_count"]),
    guests,
  };
}

// Cast at the write boundary — see the same helper in orders.firebase.ts.
const w = (v: unknown): FirestoreValue => v as FirestoreValue;

/** Normalise a stored (possibly partial or legacy) table record. */
export function normalizeTable(
  restaurantId: string,
  id: string,
  raw: Record<string, unknown> | null | undefined,
): RestaurantTable | null {
  if (!raw || typeof raw !== "object") return null;
  const capacity = Number(raw["capacity"]);
  return {
    id,
    restaurant_id: restaurantId,
    label: str(raw["label"]) || id,
    capacity:
      Number.isFinite(capacity) && capacity >= 1 ? Math.round(capacity) : DEFAULT_TABLE_CAPACITY,
    active: raw["active"] !== false,
    order_mode: resolveOrderMode(raw["order_mode"]),
    qr_token: strOrNull(raw["qr_token"]),
    qr_generated_at: strOrNull(raw["qr_generated_at"]),
    qr_generated_by: strOrNull(raw["qr_generated_by"]),
    session: normalizeTableSession(raw["session"]),
    created_at: str(raw["created_at"]),
    updated_at: str(raw["updated_at"]),
    updated_by: strOrNull(raw["updated_by"]),
  };
}

/** Natural order: "2" before "10", case-insensitive. */
export function sortTables(tables: RestaurantTable[]): RestaurantTable[] {
  return tables
    .slice()
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }),
    );
}

function toTableList(
  restaurantId: string,
  raw: Record<string, Record<string, unknown>> | null,
): RestaurantTable[] {
  if (!raw) return [];
  return sortTables(
    Object.entries(raw)
      .map(([id, value]) => normalizeTable(restaurantId, id, value))
      .filter((t): t is RestaurantTable => t !== null),
  );
}

/**
 * Comparison key for duplicate detection: case- and whitespace-insensitive,
 * and "Table 12" is the same table as "12".
 */
export function tableLabelKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^table\s+(?=\S)/, "");
}

/** How a table is named to people: "12" -> "Table 12", "Patio 3" stays as is. */
export function tableDisplayName(label: string): string {
  const trimmed = label.trim();
  return /^\d+[a-z]?$/i.test(trimmed) ? `Table ${trimmed}` : trimmed;
}

/**
 * First problem with a table config, or null when it's valid. `others` are the
 * restaurant's other tables (exclude the one being edited).
 */
export function validateTableConfig(
  input: TableConfigInput,
  others: Pick<RestaurantTable, "label">[],
): string | null {
  const label = input.label.trim();
  if (!label) return "Enter a table number or name.";
  if (label.length > MAX_TABLE_LABEL_LENGTH) {
    return `Keep the table name to ${MAX_TABLE_LABEL_LENGTH} characters or fewer.`;
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 1) {
    return "Capacity must be a whole number of seats (at least 1).";
  }
  if (input.capacity > MAX_TABLE_CAPACITY) {
    return `Capacity can be at most ${MAX_TABLE_CAPACITY} seats.`;
  }
  if (input.order_mode !== "single" && input.order_mode !== "multiple") {
    return "Choose an order mode for this table.";
  }
  const key = tableLabelKey(label);
  const clash = others.find((t) => tableLabelKey(t.label) === key);
  if (clash) return `${tableDisplayName(clash.label)} already exists at this restaurant.`;
  return null;
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function listTables(restaurantId: string): Promise<RestaurantTable[]> {
  if (!isFirebaseAvailable()) return [];
  const raw = await fsGet<Record<string, Record<string, unknown>>>(tablesPath(restaurantId));
  return toTableList(restaurantId, raw);
}

export function subscribeTables(
  restaurantId: string,
  cb: (tables: RestaurantTable[]) => void,
  onError?: (message: string) => void,
): () => void {
  if (!isFirebaseAvailable()) {
    cb([]);
    return () => {};
  }
  return fsSubscribe<Record<string, Record<string, unknown>>>(
    tablesPath(restaurantId),
    (raw) => cb(toTableList(restaurantId, raw)),
    onError,
  );
}

/**
 * Create a table (no `id`) or edit one in place (`id` given). Editing only
 * ever touches the config fields plus updated_at/updated_by, so the QR token,
 * created_at and any fields other apps keep on the table survive untouched.
 * An edit never creates a record: if the table has been removed meanwhile, it
 * fails instead.
 */
export async function saveTable(
  input: TableConfigInput & {
    restaurant_id: string;
    id?: string | null;
    actor?: string | null;
  },
): Promise<RestaurantTable> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const config: TableConfigInput = {
    label: input.label.trim(),
    capacity: input.capacity,
    active: input.active,
    order_mode: input.order_mode,
  };

  // Re-read so the duplicate check runs against what's saved, not a stale list.
  const existing = await listTables(input.restaurant_id);
  const current = input.id ? existing.find((t) => t.id === input.id) : null;
  if (input.id && !current) throw new Error("This table no longer exists — refresh and try again.");

  const error = validateTableConfig(
    config,
    existing.filter((t) => t.id !== input.id),
  );
  if (error) throw new Error(error);

  const ts = new Date().toISOString();
  const actor = input.actor ?? null;

  if (current) {
    const patch = { ...config, updated_at: ts, updated_by: actor };
    const writes: FsBatchWrite[] = [
      { kind: "update", path: tablePath(input.restaurant_id, current.id), patch },
    ];
    // Keep the QR lookup in step so a scan sees the new label/mode/status.
    if (current.qr_token) {
      writes.push({
        kind: "update",
        path: `tableQrTokens/${current.qr_token}`,
        patch: {
          restaurant_id: current.restaurant_id,
          table_id: current.id,
          table_label: config.label,
          order_mode: config.order_mode,
          active: config.active,
          updated_at: ts,
        },
      });
    }
    await fsBatch(writes);
    return { ...current, ...patch };
  }

  const table: RestaurantTable = {
    id: randomId("tbl"),
    restaurant_id: input.restaurant_id,
    ...config,
    qr_token: null,
    qr_generated_at: null,
    qr_generated_by: null,
    session: null,
    created_at: ts,
    updated_at: ts,
    updated_by: actor,
  };
  await fsBatch([{ kind: "set", path: tablePath(input.restaurant_id, table.id), value: w(table) }]);
  return table;
}

/* ---------------------------------------------------------------- QR codes */

/** What /tableQrTokens/{token} holds. Nothing here is sensitive. */
export interface TableQrTokenRecord {
  restaurant_id: string;
  table_id: string;
  table_label: string;
  order_mode: TableOrderMode;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const QR_TOKEN_BYTES = 24; // 192 bits -> 32 base64url characters
const QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** A fresh, unguessable, URL-safe QR token. Carries no meaning by itself. */
export function generateQrToken(): string {
  const bytes = new Uint8Array(QR_TOKEN_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isQrToken(value: string): boolean {
  return QR_TOKEN_PATTERN.test(value);
}

/**
 * Issue a QR token for a table — the first one, or a replacement. On
 * regenerate the old token is deleted in the same atomic write, so a printed
 * copy of the old code stops resolving the moment the new one exists.
 */
export async function issueTableQr(input: {
  restaurant_id: string;
  table_id: string;
  actor?: string | null;
}): Promise<RestaurantTable> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const table = normalizeTable(
    input.restaurant_id,
    input.table_id,
    await fsGet<Record<string, unknown>>(tablePath(input.restaurant_id, input.table_id)),
  );
  if (!table) throw new Error("This table no longer exists — refresh and try again.");

  const token = generateQrToken();
  const ts = new Date().toISOString();
  const actor = input.actor ?? null;
  const record: TableQrTokenRecord = {
    restaurant_id: table.restaurant_id,
    table_id: table.id,
    table_label: table.label,
    order_mode: table.order_mode,
    active: table.active,
    created_at: ts,
    updated_at: ts,
  };

  const writes: FsBatchWrite[] = [
    { kind: "set", path: `tableQrTokens/${token}`, value: w(record) },
    {
      kind: "update",
      path: tablePath(table.restaurant_id, table.id),
      patch: { qr_token: token, qr_generated_at: ts, qr_generated_by: actor },
    },
  ];
  if (table.qr_token && table.qr_token !== token) {
    writes.push({ kind: "delete", path: `tableQrTokens/${table.qr_token}` });
  }
  await fsBatch(writes);
  return { ...table, qr_token: token, qr_generated_at: ts, qr_generated_by: actor };
}

/**
 * Resolve a scanned token to its restaurant + table (null when unknown or
 * revoked). This is the only way a guest's app should learn which table it is
 * at — never from anything the guest can type or pick.
 */
export async function resolveTableQrToken(token: string): Promise<TableQrTokenRecord | null> {
  if (!isFirebaseAvailable() || !isQrToken(token)) return null;
  const raw = await fsGet<Record<string, unknown>>(`tableQrTokens/${token}`);
  if (!raw) return null;
  const restaurantId = str(raw["restaurant_id"]);
  const tableId = str(raw["table_id"]);
  if (!restaurantId || !tableId) return null;
  return {
    restaurant_id: restaurantId,
    table_id: tableId,
    table_label: str(raw["table_label"]),
    order_mode: resolveOrderMode(raw["order_mode"]),
    active: raw["active"] !== false,
    created_at: str(raw["created_at"]),
    updated_at: str(raw["updated_at"]),
  };
}

/* ---------------------------------------------------- QR link (customer app) */

const DINE_IN_SETTINGS_PATH = "settings/dine_in";

/** The path the customer app serves the dine-in entry point on. */
export const DINE_IN_QR_ROUTE = "/dine-in";

/** A clean base URL ("https://host[/path]", no trailing slash), or null if invalid. */
export function normalizeCustomerAppUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) return null;
  if (url.search || url.hash) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** What a table's QR code encodes: the customer app's dine-in link for the token. */
export function tableQrUrl(customerAppUrl: string, token: string): string {
  return `${customerAppUrl.replace(/\/+$/, "")}${DINE_IN_QR_ROUTE}/${encodeURIComponent(token)}`;
}

function envCustomerAppUrl(): string | null {
  return normalizeCustomerAppUrl(import.meta.env.VITE_CUSTOMER_APP_URL);
}

/** Live customer app base URL: Settings value first, then VITE_CUSTOMER_APP_URL. */
export function subscribeCustomerAppUrl(cb: (url: string | null) => void): () => void {
  if (!isFirebaseAvailable()) {
    cb(envCustomerAppUrl());
    return () => {};
  }
  return fsSubscribe<Record<string, unknown>>(DINE_IN_SETTINGS_PATH, (raw) =>
    cb(normalizeCustomerAppUrl(str(raw?.["customer_app_url"])) ?? envCustomerAppUrl()),
  );
}

export async function saveCustomerAppUrl(raw: string, actor?: string | null): Promise<string> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const url = normalizeCustomerAppUrl(raw);
  if (!url) {
    throw new Error(
      "Enter the customer app's full https:// address, e.g. https://order.example.com",
    );
  }
  await fsUpdate(DINE_IN_SETTINGS_PATH, {
    customer_app_url: url,
    updated_at: new Date().toISOString(),
    updated_by: actor ?? null,
  });
  return url;
}
