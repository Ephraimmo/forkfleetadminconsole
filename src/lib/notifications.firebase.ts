// Firebase-backed in-app alerts & triggers for the ForkFleet Operations Console.
//
// Wire contract (Realtime Database):
//   /notificationAlerts/{id}            -> every alert an administrator sent (manual or trigger)
//   /notificationTriggers/{id}          -> reusable event -> alert automation rules
//   /notificationReads/{alertId}/{uid}  -> per-recipient read receipt (ISO timestamp)
//   /notificationAudit/{id}             -> append-only audit trail
//
// Delivery model: alerts carry an audience (all staff / selected roles / one
// user). Every console session resolves its own inbox client-side by matching
// the audience, and stamps read receipts under /notificationReads — so the
// bell badge, the inbox and the admin "read" counters all update in real time.

import {
  isFirebaseAvailable,
  rtdbGet,
  rtdbPush,
  rtdbSet,
  rtdbSubscribe,
  rtdbUpdate,
  type RTDBValue,
} from "@/lib/firebase";
import type { NotificationSeverity } from "@/lib/demo-store";

/* -------------------------------------------------------------------- types */

export type AlertAudienceType = "all" | "roles" | "user";

export interface AlertAudience {
  type: AlertAudienceType;
  roles: string[];
  user_id: string | null;
  user_label: string | null;
}

export interface AlertRecord {
  id: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  audience: AlertAudience;
  source: { kind: "manual" | "trigger"; trigger_id: string | null; trigger_name: string | null };
  created_by: string | null;
  created_at: string;
}

export interface TriggerRecord {
  id: string;
  name: string;
  event: string;
  severity: NotificationSeverity;
  title_template: string;
  body_template: string;
  audience: AlertAudience;
  is_active: boolean;
  fired_count: number;
  last_fired_at: string | null;
  created_by: string | null;
  created_at: string;
}

/** Everything an inbox needs: an alert plus this user's read state. */
export interface InboxItem {
  id: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  created_at: string;
  read_at: string | null;
  link: string | null;
  source: "firebase" | "demo";
  trigger_name: string | null;
}

export const ALERTS_PATH = "notificationAlerts";
export const TRIGGERS_PATH = "notificationTriggers";
const READS_PATH = "notificationReads";

const nowIso = () => new Date().toISOString();

/** Operational events a trigger can subscribe to. */
export const EVENT_CATALOG: {
  code: string;
  label: string;
  severity: NotificationSeverity;
  hint: string;
}[] = [
  {
    code: "order.placed",
    label: "Order placed",
    severity: "info",
    hint: "Fires for every new order",
  },
  {
    code: "order.delayed",
    label: "Order running late",
    severity: "warning",
    hint: "Past the promised delivery window",
  },
  {
    code: "order.cancelled",
    label: "Order cancelled",
    severity: "critical",
    hint: "Customer or restaurant cancellation",
  },
  {
    code: "driver.offline",
    label: "Driver offline mid-shift",
    severity: "warning",
    hint: "Active driver stopped responding",
  },
  {
    code: "driver.new_registration",
    label: "New driver signup",
    severity: "info",
    hint: "A driver applied for onboarding",
  },
  {
    code: "kitchen.queue_high",
    label: "Kitchen queue above threshold",
    severity: "warning",
    hint: "More orders than the kitchen can pace",
  },
  {
    code: "payment.failed",
    label: "Payment failed",
    severity: "critical",
    hint: "Card or EFT capture rejected",
  },
  {
    code: "payout.completed",
    label: "Payout completed",
    severity: "success",
    hint: "Restaurant or driver payout settled",
  },
  {
    code: "stock.low",
    label: "Stock item below reorder level",
    severity: "warning",
    hint: "Inventory crossed its reorder point",
  },
  {
    code: "staff.suspended",
    label: "Staff account suspended",
    severity: "info",
    hint: "Access control action",
  },
];

export const SEVERITIES: { value: NotificationSeverity; label: string; dot: string }[] = [
  { value: "info", label: "Info", dot: "bg-sky-500" },
  { value: "success", label: "Success", dot: "bg-emerald-500" },
  { value: "warning", label: "Warning", dot: "bg-amber-500" },
  { value: "critical", label: "Critical", dot: "bg-rose-500" },
];

export const emptyAudience = (): AlertAudience => ({
  type: "all",
  roles: [],
  user_id: null,
  user_label: null,
});

export function describeAudience(audience: AlertAudience): string {
  if (audience.type === "all") return "All staff";
  if (audience.type === "user") return audience.user_label ?? audience.user_id ?? "One user";
  if (audience.roles.length === 0) return "No roles selected";
  return audience.roles.map((role) => role.replace(/_/g, " ")).join(", ");
}

/** True when the given session (uid + granted roles) is a recipient of the alert. */
export function audienceMatches(
  audience: AlertAudience,
  session: { userId: string; roles: string[] },
): boolean {
  if (audience.type === "all") return true;
  if (audience.type === "user") return !!audience.user_id && audience.user_id === session.userId;
  return audience.roles.some((role) => session.roles.includes(role));
}

/* ------------------------------------------------------------- normalisation */

type RawMap = Record<string, unknown>;
const obj = (source: RawMap | null | undefined, key: string): RawMap =>
  (source?.[key] ?? {}) as RawMap;
const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function normalizeSeverity(value: unknown): NotificationSeverity {
  return value === "success" || value === "warning" || value === "critical" ? value : "info";
}

function normalizeAudience(raw: RawMap): AlertAudience {
  const type = raw["type"] === "roles" || raw["type"] === "user" ? raw["type"] : "all";
  const roles = Array.isArray(raw["roles"])
    ? (raw["roles"] as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  return {
    type,
    roles,
    user_id: str(raw["user_id"]) || null,
    user_label: str(raw["user_label"]) || null,
  };
}

function normalizeAlert(raw: RawMap, id: string): AlertRecord | null {
  const title = str(raw["title"]).trim();
  if (!title) return null;
  const source = obj(raw, "source");
  return {
    id: str(raw["id"], id) || id,
    title,
    body: str(raw["body"]),
    severity: normalizeSeverity(raw["severity"]),
    audience: normalizeAudience(obj(raw, "audience")),
    source: {
      kind: source["kind"] === "trigger" ? "trigger" : "manual",
      trigger_id: str(source["trigger_id"]) || null,
      trigger_name: str(source["trigger_name"]) || null,
    },
    created_by: str(raw["created_by"]) || null,
    created_at: str(raw["created_at"], new Date(0).toISOString()),
  };
}

function normalizeTrigger(raw: RawMap, id: string): TriggerRecord | null {
  const name = str(raw["name"]).trim();
  if (!name) return null;
  return {
    id: str(raw["id"], id) || id,
    name,
    event: str(raw["event"], "order.placed"),
    severity: normalizeSeverity(raw["severity"]),
    title_template: str(raw["title_template"]),
    body_template: str(raw["body_template"]),
    audience: normalizeAudience(obj(raw, "audience")),
    is_active: raw["is_active"] !== false,
    fired_count: num(raw["fired_count"]),
    last_fired_at: str(raw["last_fired_at"]) || null,
    created_by: str(raw["created_by"]) || null,
    created_at: str(raw["created_at"], new Date(0).toISOString()),
  };
}

function toSorted<T extends { created_at: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const toRtdb = (value: unknown): RTDBValue => JSON.parse(JSON.stringify(value)) as RTDBValue;

function randomId(prefix: string): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Date.now().toString(36)}${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function writeAudit(entry: {
  action: string;
  actor_email: string | null;
  detail: string;
}): Promise<void> {
  if (!isFirebaseAvailable()) return;
  try {
    await rtdbPush("notificationAudit", {
      action: entry.action,
      actor_email: entry.actor_email,
      detail: entry.detail,
      created_at: nowIso(),
    });
  } catch (err) {
    console.warn("[notifications] audit write failed", err);
  }
}

/* -------------------------------------------------------------------- reads */

export async function fetchAlertsOnce(): Promise<AlertRecord[]> {
  if (!isFirebaseAvailable()) return [];
  const raw = await rtdbGet<RawMap>(ALERTS_PATH);
  if (!raw) return [];
  return toSorted(
    Object.entries(raw)
      .map(([id, value]) => normalizeAlert((value ?? {}) as RawMap, id))
      .filter((row): row is AlertRecord => row !== null),
  );
}

export function subscribeAlerts(callback: (rows: AlertRecord[]) => void): () => void {
  if (!isFirebaseAvailable()) {
    callback([]);
    return () => {};
  }
  return rtdbSubscribe<RawMap>(ALERTS_PATH, (raw) => {
    const rows = Object.entries(raw ?? {})
      .map(([id, value]) => normalizeAlert((value ?? {}) as RawMap, id))
      .filter((row): row is AlertRecord => row !== null);
    callback(toSorted(rows));
  });
}

export async function fetchTriggersOnce(): Promise<TriggerRecord[]> {
  if (!isFirebaseAvailable()) return [];
  const raw = await rtdbGet<RawMap>(TRIGGERS_PATH);
  if (!raw) return [];
  return toSorted(
    Object.entries(raw)
      .map(([id, value]) => normalizeTrigger((value ?? {}) as RawMap, id))
      .filter((row): row is TriggerRecord => row !== null),
  );
}

export function subscribeTriggers(callback: (rows: TriggerRecord[]) => void): () => void {
  if (!isFirebaseAvailable()) {
    callback([]);
    return () => {};
  }
  return rtdbSubscribe<RawMap>(TRIGGERS_PATH, (raw) => {
    const rows = Object.entries(raw ?? {})
      .map(([id, value]) => normalizeTrigger((value ?? {}) as RawMap, id))
      .filter((row): row is TriggerRecord => row !== null);
    callback(toSorted(rows));
  });
}

/** alertId -> { uid -> read-at ISO } */
export type ReadReceipts = Record<string, Record<string, string>>;

export async function fetchReadReceiptsOnce(): Promise<ReadReceipts> {
  if (!isFirebaseAvailable()) return {};
  const raw = await rtdbGet<RawMap>(READS_PATH);
  const result: ReadReceipts = {};
  for (const [alertId, users] of Object.entries(raw ?? {})) {
    const entry: Record<string, string> = {};
    for (const [uid, readAt] of Object.entries((users ?? {}) as RawMap)) {
      if (typeof readAt === "string") entry[uid] = readAt;
    }
    result[alertId] = entry;
  }
  return result;
}

export function subscribeReadReceipts(callback: (receipts: ReadReceipts) => void): () => void {
  if (!isFirebaseAvailable()) {
    callback({});
    return () => {};
  }
  return rtdbSubscribe<RawMap>(READS_PATH, (raw) => {
    const result: ReadReceipts = {};
    for (const [alertId, users] of Object.entries(raw ?? {})) {
      const entry: Record<string, string> = {};
      for (const [uid, readAt] of Object.entries((users ?? {}) as RawMap)) {
        if (typeof readAt === "string") entry[uid] = readAt;
      }
      result[alertId] = entry;
    }
    callback(result);
  });
}

/* -------------------------------------------------------------- inbox (user) */

export async function fetchInboxOnce(session: {
  userId: string;
  roles: string[];
}): Promise<InboxItem[]> {
  if (!isFirebaseAvailable()) return [];
  const [alerts, receipts] = await Promise.all([fetchAlertsOnce(), fetchReadReceiptsOnce()]);
  return alerts
    .filter((alert) => audienceMatches(alert.audience, session))
    .map((alert) => ({
      id: alert.id,
      title: alert.title,
      body: alert.body,
      severity: alert.severity,
      created_at: alert.created_at,
      read_at: receipts[alert.id]?.[session.userId] ?? null,
      link: "/notifications",
      source: "firebase" as const,
      trigger_name: alert.source.trigger_name,
    }));
}

/** Real-time inbox for the signed-in user (alerts + read receipts stream in). */
export function subscribeInbox(
  session: { userId: string; roles: string[] },
  callback: (rows: InboxItem[]) => void,
): () => void {
  let alerts: AlertRecord[] = [];
  let receipts: ReadReceipts = {};
  const emit = () => {
    callback(
      alerts
        .filter((alert) => audienceMatches(alert.audience, session))
        .map((alert) => ({
          id: alert.id,
          title: alert.title,
          body: alert.body,
          severity: alert.severity,
          created_at: alert.created_at,
          read_at: receipts[alert.id]?.[session.userId] ?? null,
          link: "/notifications",
          source: "firebase" as const,
          trigger_name: alert.source.trigger_name,
        })),
    );
  };
  const unsubAlerts = subscribeAlerts((rows) => {
    alerts = rows;
    emit();
  });
  const unsubReads = subscribeReadReceipts((rows) => {
    receipts = rows;
    emit();
  });
  return () => {
    unsubAlerts();
    unsubReads();
  };
}

export async function markInboxItemRead(input: { alertId: string; userId: string }): Promise<void> {
  if (!isFirebaseAvailable()) return;
  await rtdbSet(`${READS_PATH}/${input.alertId}/${input.userId}`, nowIso());
}

/* ------------------------------------------------------------------- writes */

export interface ComposeAlertInput {
  title: string;
  body: string;
  severity: NotificationSeverity;
  audience: AlertAudience;
  actorEmail: string | null;
}

export async function sendAlert(
  input: ComposeAlertInput,
): Promise<{ ok: true; alert: AlertRecord } | { ok: false; error: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 3)
    return { ok: false, error: "Give the alert a title (at least 3 characters)." };
  if (body.length < 5) return { ok: false, error: "Write a message body (at least 5 characters)." };
  if (input.audience.type === "roles" && input.audience.roles.length === 0) {
    return { ok: false, error: "Select at least one role to deliver to." };
  }
  if (input.audience.type === "user" && !input.audience.user_id) {
    return { ok: false, error: "Pick a team member to deliver to." };
  }
  try {
    const record: AlertRecord = {
      id: randomId("al"),
      title,
      body,
      severity: input.severity,
      audience: input.audience,
      source: { kind: "manual", trigger_id: null, trigger_name: null },
      created_by: input.actorEmail,
      created_at: nowIso(),
    };
    await rtdbSet(`${ALERTS_PATH}/${record.id}`, toRtdb(record));
    await writeAudit({
      action: "alert.sent",
      actor_email: input.actorEmail,
      detail: `"${title}" -> ${describeAudience(input.audience)} (${input.severity})`,
    });
    return { ok: true, alert: record };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to send alert." };
  }
}

export async function deleteAlert(input: {
  id: string;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    await rtdbSet(`${ALERTS_PATH}/${input.id}`, null);
    await rtdbSet(`${READS_PATH}/${input.id}`, null);
    await writeAudit({ action: "alert.deleted", actor_email: input.actorEmail, detail: input.id });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete alert." };
  }
}

export interface ComposeTriggerInput {
  name: string;
  event: string;
  severity: NotificationSeverity;
  titleTemplate: string;
  bodyTemplate: string;
  audience: AlertAudience;
  actorEmail: string | null;
}

export async function createTrigger(
  input: ComposeTriggerInput,
): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  const name = input.name.trim();
  if (name.length < 3) return { ok: false, error: "Name the trigger (at least 3 characters)." };
  if (!EVENT_CATALOG.some((event) => event.code === input.event)) {
    return { ok: false, error: "Choose an event from the catalog." };
  }
  if (input.titleTemplate.trim().length < 3) return { ok: false, error: "Add a title template." };
  if (input.bodyTemplate.trim().length < 5) return { ok: false, error: "Add a body template." };
  if (input.audience.type === "roles" && input.audience.roles.length === 0) {
    return { ok: false, error: "Select at least one role for the audience." };
  }
  if (input.audience.type === "user" && !input.audience.user_id) {
    return { ok: false, error: "Pick a team member for the audience." };
  }
  try {
    const record: TriggerRecord = {
      id: randomId("tg"),
      name,
      event: input.event,
      severity: input.severity,
      title_template: input.titleTemplate.trim(),
      body_template: input.bodyTemplate.trim(),
      audience: input.audience,
      is_active: true,
      fired_count: 0,
      last_fired_at: null,
      created_by: input.actorEmail,
      created_at: nowIso(),
    };
    await rtdbSet(`${TRIGGERS_PATH}/${record.id}`, toRtdb(record));
    await writeAudit({
      action: "trigger.created",
      actor_email: input.actorEmail,
      detail: `${name} on ${input.event} -> ${describeAudience(input.audience)}`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create trigger." };
  }
}

export async function setTriggerActive(input: {
  id: string;
  isActive: boolean;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    await rtdbUpdate(`${TRIGGERS_PATH}/${input.id}`, {
      is_active: input.isActive,
      updated_at: nowIso(),
    });
    await writeAudit({
      action: input.isActive ? "trigger.enabled" : "trigger.disabled",
      actor_email: input.actorEmail,
      detail: input.id,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update trigger." };
  }
}

export async function deleteTrigger(input: {
  id: string;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    await rtdbSet(`${TRIGGERS_PATH}/${input.id}`, null);
    await writeAudit({
      action: "trigger.deleted",
      actor_email: input.actorEmail,
      detail: input.id,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete trigger." };
  }
}

/** Dispatches an alert from a trigger's templates right now (manual fire). */
export async function fireTrigger(input: {
  id: string;
  actorEmail: string | null;
}): Promise<{ ok: true; alert: AlertRecord } | { ok: false; error: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    const raw = await rtdbGet<RawMap>(`${TRIGGERS_PATH}/${input.id}`);
    const trigger = raw ? normalizeTrigger(raw, input.id) : null;
    if (!trigger) return { ok: false, error: "That trigger no longer exists." };
    if (!trigger.is_active) return { ok: false, error: "Enable the trigger before firing it." };
    const record: AlertRecord = {
      id: randomId("al"),
      title: trigger.title_template,
      body: trigger.body_template,
      severity: trigger.severity,
      audience: trigger.audience,
      source: { kind: "trigger", trigger_id: trigger.id, trigger_name: trigger.name },
      created_by: input.actorEmail,
      created_at: nowIso(),
    };
    await rtdbSet(`${ALERTS_PATH}/${record.id}`, toRtdb(record));
    await rtdbUpdate(`${TRIGGERS_PATH}/${trigger.id}`, {
      fired_count: trigger.fired_count + 1,
      last_fired_at: nowIso(),
    });
    await writeAudit({
      action: "trigger.fired",
      actor_email: input.actorEmail,
      detail: `${trigger.name} -> alert ${record.id}`,
    });
    return { ok: true, alert: record };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to fire trigger." };
  }
}
