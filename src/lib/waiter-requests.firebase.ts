// Dine-in waiter calls — a guest pressing "Request waiter" at their table.
//
// Data shape (shared with the Customer and Restaurant Admin apps — do not
// rename fields; see docs/DINE_IN_TABLES_QR_HANDOVER.md):
//   /waiterRequests/{requestId}  -> WaiterRequest (one document per call)
//
// requestWaiter() records a call against the restaurant, the table, the
// seating at the table and the guest. It joins the seating exactly the way
// ordering does (table-sessions.firebase.ts), so a guest who calls before
// ordering starts the seating, and their calls and orders share one
// "Customer N" label. Staff see open calls on the Dine-in orders and Table
// overview pages, accept one ("on my way") and resolve it once the guest has
// been helped:
//
//   open -> accepted -> resolved        (or straight from open to resolved)
//
// While a guest's call is still open or accepted, pressing the button again
// doesn't open a second call: it bumps `request_count` on the same one.

import {
  fsGet,
  fsSubscribe,
  fsTransaction,
  isFirebaseAvailable,
  type FirestoreValue,
} from "@/lib/firestore";
import { dineInError, staffActorLabel, type StaffActor } from "@/lib/dine-in";
import { randomId } from "@/lib/dine-in-order-edit";
import {
  joinSeating,
  readActiveTable,
  resolveTableRef,
  SAFE_ID,
  validateGuest,
  type DineInGuest,
  type DineInTableRef,
} from "@/lib/table-sessions.firebase";
import { resolveOrderMode, tablePath, type TableOrderMode } from "@/lib/tables.firebase";

export type WaiterRequestStatus = "open" | "accepted" | "resolved";

/** What staff see when the guest didn't say what they need. */
export const DEFAULT_WAITER_REQUEST_MESSAGE = "Customer needs assistance.";

export const MAX_WAITER_REQUEST_MESSAGE = 200;

export interface WaiterRequest {
  id: string;
  restaurant_id: string;
  /** Display snapshot of the restaurant's name at the time of the call. */
  restaurant_name: string | null;
  table_id: string;
  /** Snapshot of the table number/name, e.g. "12". */
  table_label: string;
  /** The seating the guest is part of — the same id their orders carry. */
  table_session_id: string;
  order_mode: TableOrderMode;
  /** The guest who called: their stable id (Firebase Auth uid) and seating label. */
  guest_id: string;
  guest_label: string;
  customer_id: string | null;
  /** The guest's current order in the seating when they called (single mode: the table's). */
  order_id: string | null;
  /** What the guest said, if anything (see waiterRequestMessage()). */
  message: string | null;
  status: WaiterRequestStatus;
  /** How many times the guest pressed the button while this call was unanswered. */
  request_count: number;
  created_at: string;
  last_requested_at: string;
  accepted_at: string | null;
  /** Staff id (or email) and display name of whoever accepted it. */
  accepted_by_id: string | null;
  accepted_by: string | null;
  resolved_at: string | null;
  resolved_by_id: string | null;
  resolved_by: string | null;
  updated_at: string;
}

export interface RequestWaiterResult {
  request_id: string;
  /** false when the guest already had a call waiting and this pressed it again. */
  created: boolean;
  session_id: string;
  guest_label: string;
}

const COLLECTION = "waiterRequests";
const requestPath = (id: string) => `${COLLECTION}/${id}`;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strOrNull = (v: unknown): string | null => str(v) || null;
// Cast at the write boundary — see the same helper in orders.firebase.ts.
const w = (v: unknown): FirestoreValue => v as FirestoreValue;

/* ----------------------------------------------------------------- reads */

/** Normalise a stored call; null when it can't identify a restaurant and table. */
export function normalizeWaiterRequest(id: string, raw: unknown): WaiterRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const restaurantId = str(r["restaurant_id"]);
  const tableId = str(r["table_id"]);
  if (!restaurantId || !tableId) return null;
  const status = r["status"];
  const createdAt = str(r["created_at"]);
  const count = Number(r["request_count"]);
  return {
    id,
    restaurant_id: restaurantId,
    restaurant_name: strOrNull(r["restaurant_name"]),
    table_id: tableId,
    table_label: str(r["table_label"]) || tableId,
    table_session_id: str(r["table_session_id"]),
    order_mode: resolveOrderMode(r["order_mode"]),
    guest_id: str(r["guest_id"]),
    guest_label: str(r["guest_label"]) || "Guest",
    customer_id: strOrNull(r["customer_id"]),
    order_id: strOrNull(r["order_id"]),
    message: strOrNull(r["message"]),
    status: status === "accepted" || status === "resolved" ? status : "open",
    request_count: Number.isInteger(count) && count > 0 ? count : 1,
    created_at: createdAt,
    last_requested_at: str(r["last_requested_at"]) || createdAt,
    accepted_at: strOrNull(r["accepted_at"]),
    accepted_by_id: strOrNull(r["accepted_by_id"]),
    accepted_by: strOrNull(r["accepted_by"]),
    resolved_at: strOrNull(r["resolved_at"]),
    resolved_by_id: strOrNull(r["resolved_by_id"]),
    resolved_by: strOrNull(r["resolved_by"]),
    updated_at: str(r["updated_at"]) || createdAt,
  };
}

/** Still needs a waiter: not yet resolved. */
export function isActiveWaiterRequest(request: Pick<WaiterRequest, "status">): boolean {
  return request.status !== "resolved";
}

/** What the call says: the guest's own words, or "Customer needs assistance." */
export function waiterRequestMessage(request: Pick<WaiterRequest, "message">): string {
  return request.message ?? DEFAULT_WAITER_REQUEST_MESSAGE;
}

/**
 * Calls that still need a waiter, optionally for one restaurant: unanswered
 * ones first, longest-waiting first, then the ones someone has accepted.
 */
export function activeWaiterRequests(
  rows: WaiterRequest[],
  filters: { restaurantId?: string } = {},
): WaiterRequest[] {
  const rank = (r: WaiterRequest) => (r.status === "open" ? 0 : 1);
  return rows
    .filter(isActiveWaiterRequest)
    .filter(
      (r) =>
        !filters.restaurantId ||
        filters.restaurantId === "all" ||
        r.restaurant_id === filters.restaurantId,
    )
    .sort((a, b) => rank(a) - rank(b) || a.created_at.localeCompare(b.created_at));
}

function toList(raw: Record<string, unknown> | null): WaiterRequest[] {
  if (!raw) return [];
  return Object.entries(raw)
    .map(([id, value]) => normalizeWaiterRequest(id, value))
    .filter((r): r is WaiterRequest => r !== null);
}

/** Every waiter call, live. */
export function subscribeWaiterRequests(
  cb: (rows: WaiterRequest[]) => void,
  onError?: (message: string) => void,
): () => void {
  if (!isFirebaseAvailable()) {
    cb([]);
    return () => {};
  }
  return fsSubscribe<Record<string, unknown>>(COLLECTION, (raw) => cb(toList(raw)), onError);
}

/* ------------------------------------------------------ guest: call waiter */

/**
 * A guest asks for a waiter. Associates the call with the restaurant, table
 * and seating the table reference resolves to (take it from the scanned QR
 * token, never from anything the guest can type) and with the guest. Reads
 * and writes the table's seating and the call in one transaction.
 */
export async function requestWaiter(input: {
  table: DineInTableRef;
  guest: DineInGuest;
  /** Optional: what the guest needs, e.g. "Can we have the bill?". */
  message?: string | null;
}): Promise<RequestWaiterResult> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  const guest = validateGuest(input.guest);
  const message = str(input.message).slice(0, MAX_WAITER_REQUEST_MESSAGE) || null;
  const ref = await resolveTableRef(input.table);

  // Display-only restaurant name, read once outside the transaction.
  const restaurant = await fsGet<Record<string, unknown>>(`restaurants/${ref.restaurant_id}`);
  const restaurantName = strOrNull(restaurant?.["name"]);

  return fsTransaction(async (tx) => {
    // ---- Reads ----
    const { raw: tableRaw, table } = await readActiveTable(tx, ref);
    const now = Date.now();
    const ts = new Date(now).toISOString();
    const { session, seat } = joinSeating(table, guest, now);
    const previousId = seat.waiter_request_id;
    const previous = previousId
      ? normalizeWaiterRequest(previousId, await tx.get(requestPath(previousId)))
      : null;

    // ---- Writes ----
    let result: RequestWaiterResult;
    if (
      previous &&
      isActiveWaiterRequest(previous) &&
      previous.table_session_id === session.id &&
      previous.table_id === table.id
    ) {
      // Pressed again while still waiting: the same call, asked once more.
      tx.update(requestPath(previous.id), {
        request_count: previous.request_count + 1,
        last_requested_at: ts,
        updated_at: ts,
        ...(message ? { message } : {}),
      });
      result = {
        request_id: previous.id,
        created: false,
        session_id: session.id,
        guest_label: seat.label,
      };
    } else {
      const request: WaiterRequest = {
        id: randomId("wr"),
        restaurant_id: table.restaurant_id,
        restaurant_name: restaurantName,
        table_id: table.id,
        table_label: table.label,
        table_session_id: session.id,
        order_mode: session.order_mode,
        guest_id: guest.id,
        guest_label: seat.label,
        customer_id: str(input.guest.customer_id) || null,
        order_id:
          (session.order_mode === "single" ? session.current_order_id : seat.current_order_id) ??
          null,
        message,
        status: "open",
        request_count: 1,
        created_at: ts,
        last_requested_at: ts,
        accepted_at: null,
        accepted_by_id: null,
        accepted_by: null,
        resolved_at: null,
        resolved_by_id: null,
        resolved_by: null,
        updated_at: ts,
      };
      tx.set(requestPath(request.id), w(request));
      seat.waiter_request_id = request.id;
      result = {
        request_id: request.id,
        created: true,
        session_id: session.id,
        guest_label: seat.label,
      };
    }

    session.guests[guest.id] = seat;
    session.last_activity_at = ts;
    // Write the table back exactly as read, with only its seating changed.
    tx.set(tablePath(table.restaurant_id, table.id), w({ ...tableRaw, session }));
    return result;
  });
}

/* ------------------------------------------------- staff: accept / resolve */

const actorKey = (actor: StaffActor) => str(actor.id) || str(actor.email) || null;

function assertRequestId(id: string) {
  if (!SAFE_ID.test(id)) {
    throw dineInError("dine-in/request-not-found", "That waiter request doesn't exist.");
  }
}

/**
 * A waiter takes the call ("on my way"). Only one waiter can hold it: if
 * someone else accepted it first, this fails and says who. Accepting a call
 * you already hold does nothing.
 */
export async function acceptWaiterRequest(input: {
  request_id: string;
  actor: StaffActor;
}): Promise<WaiterRequest> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  assertRequestId(input.request_id);
  return fsTransaction(async (tx) => {
    const request = normalizeWaiterRequest(
      input.request_id,
      await tx.get(requestPath(input.request_id)),
    );
    if (!request) {
      throw dineInError("dine-in/request-not-found", "That waiter request doesn't exist.");
    }
    if (request.status === "resolved") {
      throw dineInError("dine-in/request-closed", "This request has already been resolved.");
    }
    const me = actorKey(input.actor);
    if (request.status === "accepted") {
      if (request.accepted_by_id && request.accepted_by_id === me) return request;
      throw dineInError(
        "dine-in/request-taken",
        `${request.accepted_by ?? "Another waiter"} has already accepted this request.`,
      );
    }
    const ts = new Date().toISOString();
    const patch = {
      status: "accepted" as const,
      accepted_at: ts,
      accepted_by_id: me,
      accepted_by: staffActorLabel(input.actor),
      updated_at: ts,
    };
    tx.update(requestPath(request.id), patch);
    return { ...request, ...patch };
  });
}

/**
 * The guest has been helped. Works from open or accepted, by any waiter.
 * Returns false when it was already resolved (nothing changes).
 */
export async function resolveWaiterRequest(input: {
  request_id: string;
  actor: StaffActor;
}): Promise<boolean> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  assertRequestId(input.request_id);
  return fsTransaction(async (tx) => {
    const request = normalizeWaiterRequest(
      input.request_id,
      await tx.get(requestPath(input.request_id)),
    );
    if (!request) {
      throw dineInError("dine-in/request-not-found", "That waiter request doesn't exist.");
    }
    if (request.status === "resolved") return false;
    const ts = new Date().toISOString();
    tx.update(requestPath(request.id), {
      status: "resolved",
      resolved_at: ts,
      resolved_by_id: actorKey(input.actor),
      resolved_by: staffActorLabel(input.actor),
      updated_at: ts,
    });
    return true;
  });
}
