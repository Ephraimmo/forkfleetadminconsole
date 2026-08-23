// Firebase-backed platform settings for the ForkFleet Operations Console.
//
// Wire contract (Realtime Database):
//   /settings/{section}            -> typed settings documents
//   /settings/api/keys/{id}        -> API key registry (masked secrets only)
//   /settings/api/webhooks/{id}    -> webhook endpoints + subscribed events
//   /settings/meta                 -> global last-write metadata
//   /settings/sectionMeta/{id}     -> per-section last-write metadata (conflict detection)
//
// The UI always renders defaults merged with whatever is in the database, so a
// fresh project shows a sensible console without any seeding step. Secrets are
// never persisted in clear text: full API keys are shown exactly once at
// creation/rotation and only the masked form is stored.

import {
  isFirebaseAvailable,
  rtdbGet,
  rtdbPush,
  rtdbSet,
  rtdbSubscribe,
  rtdbUpdate,
  type RTDBValue,
} from "@/lib/firebase";

const SETTINGS_PATH = "settings";

/* -------------------------------------------------------------------- types */

export interface OrganisationSettings {
  name: string;
  trading_name: string;
  support_email: string;
  support_phone: string;
  registration_number: string;
  vat_number: string;
  address: string;
}

export interface BrandingSettings {
  primary_color: string;
  accent_color: string;
  app_display_name: string;
  support_url: string;
  custom_domain: string;
}

export interface NotificationSettings {
  order_status_emails: boolean;
  dispatch_alerts: boolean;
  weekly_digest: boolean;
  slack_integration: boolean;
  sms_otp_admin: boolean;
}

export interface SecuritySettings {
  require_2fa: boolean;
  enforce_sso: boolean;
  auto_logout: boolean;
  min_password_length: number;
  session_timeout_minutes: number;
  log_retention_days: number;
  data_residency: string;
}

export interface LocalisationSettings {
  language: string;
  currency: string;
  timezone: string;
  distance_unit: string;
}

/** Unsigned Cloudinary config for browser image uploads (no API secret). */
export interface MediaSettings {
  cloudinary_cloud_name: string;
  cloudinary_upload_preset: string;
  logo_url: string;
}

export interface ApiKeyRecord {
  id: string;
  label: string;
  environment: "production" | "test";
  masked_key: string;
  created_at: string;
  rotated_at: string | null;
}

export interface WebhookRecord {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
}

export interface SettingsMeta {
  updated_at: string | null;
  updated_by: string | null;
}

export interface PlatformSettings {
  organisation: OrganisationSettings;
  branding: BrandingSettings;
  notifications: NotificationSettings;
  security: SecuritySettings;
  localisation: LocalisationSettings;
  media: MediaSettings;
  api: { keys: ApiKeyRecord[]; webhooks: WebhookRecord[] };
  meta: SettingsMeta;
  sectionMeta: Record<string, SettingsMeta>;
}

export type DraftedSection =
  | "organisation"
  | "branding"
  | "notifications"
  | "security"
  | "localisation"
  | "media";
export const DRAFTED_SECTIONS: DraftedSection[] = [
  "organisation",
  "branding",
  "notifications",
  "security",
  "localisation",
  "media",
];

export const WEBHOOK_EVENT_CATALOG = [
  "order.*",
  "driver.*",
  "payment.*",
  "settlement.*",
  "restaurant.*",
  "customer.*",
] as const;

/* ----------------------------------------------------------------- defaults */

export const DEFAULT_SETTINGS: PlatformSettings = {
  organisation: {
    name: "ForkFleet Foods (Pty) Ltd",
    trading_name: "ForkFleet",
    support_email: "support@forkfleet.demo",
    support_phone: "+27 21 555 0100",
    registration_number: "2024/123456/07",
    vat_number: "4123456789",
    address: "1 Dock Road, V&A Waterfront, Cape Town, 8001, South Africa",
  },
  branding: {
    primary_color: "#F2A93B",
    accent_color: "#2B7DF2",
    app_display_name: "ForkFleet",
    support_url: "https://forkfleet.demo/support",
    custom_domain: "",
  },
  notifications: {
    order_status_emails: true,
    dispatch_alerts: true,
    weekly_digest: false,
    slack_integration: false,
    sms_otp_admin: true,
  },
  security: {
    require_2fa: true,
    enforce_sso: false,
    auto_logout: true,
    min_password_length: 12,
    session_timeout_minutes: 30,
    log_retention_days: 365,
    data_residency: "af-south-1",
  },
  localisation: {
    language: "en-ZA",
    currency: "ZAR",
    timezone: "Africa/Johannesburg",
    distance_unit: "km",
  },
  media: {
    cloudinary_cloud_name: "",
    cloudinary_upload_preset: "",
    logo_url: "",
  },
  api: { keys: [], webhooks: [] },
  meta: { updated_at: null, updated_by: null },
  sectionMeta: {},
};

/* ------------------------------------------------------------- normalisation */

type RawMap = Record<string, unknown>;

const str = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;
const num = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

function mapToSorted<T extends { created_at: string }>(
  raw: unknown,
  transform: (key: string, value: RawMap) => T | null,
): T[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as RawMap)
    .map(([key, value]) => transform(key, (value ?? {}) as RawMap))
    .filter((row): row is T => row !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function normalizeSettings(input: RawMap | null | undefined): PlatformSettings {
  const raw: RawMap = input ?? {};
  const section = (key: string): RawMap => (raw[key] ?? {}) as RawMap;
  const organisation = section("organisation");
  const branding = section("branding");
  const notifications = section("notifications");
  const security = section("security");
  const localisation = section("localisation");
  const media = section("media");
  const api = section("api");
  const meta = section("meta");
  const sectionMetaRaw = section("sectionMeta");

  const sectionMeta: Record<string, SettingsMeta> = {};
  for (const [sectionKey, value] of Object.entries(sectionMetaRaw)) {
    const entry = (value ?? {}) as RawMap;
    sectionMeta[sectionKey] = {
      updated_at: str(entry["updated_at"], "") || null,
      updated_by: str(entry["updated_by"], "") || null,
    };
  }

  return {
    organisation: {
      name: str(organisation["name"], DEFAULT_SETTINGS.organisation.name),
      trading_name: str(organisation["trading_name"], DEFAULT_SETTINGS.organisation.trading_name),
      support_email: str(
        organisation["support_email"],
        DEFAULT_SETTINGS.organisation.support_email,
      ),
      support_phone: str(
        organisation["support_phone"],
        DEFAULT_SETTINGS.organisation.support_phone,
      ),
      registration_number: str(
        organisation["registration_number"],
        DEFAULT_SETTINGS.organisation.registration_number,
      ),
      vat_number: str(organisation["vat_number"], DEFAULT_SETTINGS.organisation.vat_number),
      address: str(organisation["address"], DEFAULT_SETTINGS.organisation.address),
    },
    branding: {
      primary_color: str(branding["primary_color"], DEFAULT_SETTINGS.branding.primary_color),
      accent_color: str(branding["accent_color"], DEFAULT_SETTINGS.branding.accent_color),
      app_display_name: str(
        branding["app_display_name"],
        DEFAULT_SETTINGS.branding.app_display_name,
      ),
      support_url: str(branding["support_url"], DEFAULT_SETTINGS.branding.support_url),
      custom_domain: str(branding["custom_domain"], ""),
    },
    notifications: {
      order_status_emails: bool(
        notifications["order_status_emails"],
        DEFAULT_SETTINGS.notifications.order_status_emails,
      ),
      dispatch_alerts: bool(
        notifications["dispatch_alerts"],
        DEFAULT_SETTINGS.notifications.dispatch_alerts,
      ),
      weekly_digest: bool(
        notifications["weekly_digest"],
        DEFAULT_SETTINGS.notifications.weekly_digest,
      ),
      slack_integration: bool(
        notifications["slack_integration"],
        DEFAULT_SETTINGS.notifications.slack_integration,
      ),
      sms_otp_admin: bool(
        notifications["sms_otp_admin"],
        DEFAULT_SETTINGS.notifications.sms_otp_admin,
      ),
    },
    security: {
      require_2fa: bool(security["require_2fa"], DEFAULT_SETTINGS.security.require_2fa),
      enforce_sso: bool(security["enforce_sso"], DEFAULT_SETTINGS.security.enforce_sso),
      auto_logout: bool(security["auto_logout"], DEFAULT_SETTINGS.security.auto_logout),
      min_password_length: num(
        security["min_password_length"],
        DEFAULT_SETTINGS.security.min_password_length,
      ),
      session_timeout_minutes: num(
        security["session_timeout_minutes"],
        DEFAULT_SETTINGS.security.session_timeout_minutes,
      ),
      log_retention_days: num(
        security["log_retention_days"],
        DEFAULT_SETTINGS.security.log_retention_days,
      ),
      data_residency: str(security["data_residency"], DEFAULT_SETTINGS.security.data_residency),
    },
    localisation: {
      language: str(localisation["language"], DEFAULT_SETTINGS.localisation.language),
      currency: str(localisation["currency"], DEFAULT_SETTINGS.localisation.currency),
      timezone: str(localisation["timezone"], DEFAULT_SETTINGS.localisation.timezone),
      distance_unit: str(
        localisation["distance_unit"],
        DEFAULT_SETTINGS.localisation.distance_unit,
      ),
    },
    media: {
      cloudinary_cloud_name: str(media["cloudinary_cloud_name"], ""),
      cloudinary_upload_preset: str(media["cloudinary_upload_preset"], ""),
      logo_url: str(media["logo_url"], ""),
    },
    api: {
      keys: mapToSorted((api["keys"] ?? null) as RawMap, (key, value) => {
        const environment = value["environment"] === "test" ? "test" : "production";
        const label = str(value["label"], "Unnamed key");
        const masked = str(value["masked_key"], "");
        if (!masked) return null;
        return {
          id: str(value["id"], key) || key,
          label,
          environment,
          masked_key: masked,
          created_at: str(value["created_at"], new Date(0).toISOString()),
          rotated_at: str(value["rotated_at"], "") || null,
        };
      }),
      webhooks: mapToSorted((api["webhooks"] ?? null) as RawMap, (key, value) => {
        const url = str(value["url"], "");
        if (!url) return null;
        const events = Array.isArray(value["events"])
          ? (value["events"] as unknown[]).filter((e): e is string => typeof e === "string")
          : [];
        return {
          id: str(value["id"], key) || key,
          url,
          events,
          is_active: bool(value["is_active"], true),
          created_at: str(value["created_at"], new Date(0).toISOString()),
        };
      }),
    },
    meta: {
      updated_at: str(meta["updated_at"], "") || null,
      updated_by: str(meta["updated_by"], "") || null,
    },
    sectionMeta,
  };
}

/** Structural clone via JSON so typed documents satisfy the RTDB value contract. */
function toRtdb(value: unknown): RTDBValue {
  return JSON.parse(JSON.stringify(value)) as RTDBValue;
}

const nowIso = () => new Date().toISOString();

async function writeSettingsAudit(entry: {
  action: string;
  actor_email: string | null;
  detail: string | null;
}): Promise<void> {
  if (!isFirebaseAvailable()) return;
  try {
    await rtdbPush("settingsAudit", {
      action: entry.action,
      actor_email: entry.actor_email,
      detail: entry.detail,
      created_at: nowIso(),
    });
  } catch (err) {
    console.warn("[settings] audit write failed", err);
  }
}

/* -------------------------------------------------------------------- reads */

export async function fetchSettingsOnce(): Promise<PlatformSettings> {
  if (!isFirebaseAvailable()) return DEFAULT_SETTINGS;
  return normalizeSettings(await rtdbGet<Record<string, unknown>>(SETTINGS_PATH));
}

export function subscribeSettings(callback: (settings: PlatformSettings) => void): () => void {
  if (!isFirebaseAvailable()) {
    callback(DEFAULT_SETTINGS);
    return () => {};
  }
  return rtdbSubscribe<Record<string, unknown>>(SETTINGS_PATH, (value) =>
    callback(normalizeSettings(value)),
  );
}

/* ------------------------------------------------------------------- writes */

/** Persists one drafted section, stamps global + per-section metadata and audits. */
export async function updateSettingsSection(input: {
  section: DraftedSection;
  value: Record<string, unknown>;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  const timestamp = nowIso();
  try {
    await rtdbUpdate(SETTINGS_PATH, {
      [input.section]: toRtdb(input.value),
      "meta/updated_at": timestamp,
      "meta/updated_by": input.actorEmail ?? "unknown",
      [`sectionMeta/${input.section}/updated_at`]: timestamp,
      [`sectionMeta/${input.section}/updated_by`]: input.actorEmail ?? "unknown",
    });
    await writeSettingsAudit({
      action: `settings.${input.section}.updated`,
      actor_email: input.actorEmail,
      detail: Object.keys(input.value).join(", "),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save settings." };
  }
}

/* ----------------------------------------------------------------- API keys */

function randomHex(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

export function generateApiSecret(environment: "production" | "test"): string {
  return `ff_${environment === "production" ? "live" : "test"}_${randomHex(32)}`;
}

export function maskApiSecret(secret: string): string {
  if (secret.length <= 12) return secret;
  return `${secret.slice(0, 8)}••••••••••••${secret.slice(-4)}`;
}

async function nextKeyId(prefix: string): Promise<string> {
  return `${prefix}_${Date.now().toString(36)}${randomHex(4)}`;
}

/** Creates a key registry entry. The full secret is returned ONCE for display. */
export async function createApiKey(input: {
  label: string;
  environment: "production" | "test";
  actorEmail: string | null;
}): Promise<{ ok: true; secret: string; record: ApiKeyRecord } | { ok: false; error: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    const secret = generateApiSecret(input.environment);
    const record: ApiKeyRecord = {
      id: await nextKeyId("key"),
      label:
        input.label.trim() || (input.environment === "production" ? "Production key" : "Test key"),
      environment: input.environment,
      masked_key: maskApiSecret(secret),
      created_at: nowIso(),
      rotated_at: null,
    };
    await rtdbSet(`${SETTINGS_PATH}/api/keys/${record.id}`, toRtdb(record));
    await writeSettingsAudit({
      action: "settings.api_key.created",
      actor_email: input.actorEmail,
      detail: `${record.label} (${record.environment})`,
    });
    return { ok: true, secret, record };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create key." };
  }
}

/** Rotates a key: the old secret is invalidated, the new one is shown once. */
export async function rotateApiKey(input: {
  id: string;
  actorEmail: string | null;
}): Promise<{ ok: true; secret: string } | { ok: false; error: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    const existing = await rtdbGet<Record<string, unknown>>(
      `${SETTINGS_PATH}/api/keys/${input.id}`,
    );
    if (!existing) return { ok: false, error: "That key no longer exists." };
    const environment = existing["environment"] === "test" ? "test" : "production";
    const secret = generateApiSecret(environment);
    await rtdbUpdate(`${SETTINGS_PATH}/api/keys/${input.id}`, {
      masked_key: maskApiSecret(secret),
      rotated_at: nowIso(),
    });
    await writeSettingsAudit({
      action: "settings.api_key.rotated",
      actor_email: input.actorEmail,
      detail: String(existing["id"] ?? input.id),
    });
    return { ok: true, secret };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to rotate key." };
  }
}

export async function revokeApiKey(input: {
  id: string;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    await rtdbSet(`${SETTINGS_PATH}/api/keys/${input.id}`, null);
    await writeSettingsAudit({
      action: "settings.api_key.revoked",
      actor_email: input.actorEmail,
      detail: input.id,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to revoke key." };
  }
}

/* ----------------------------------------------------------------- webhooks */

export async function addWebhookEndpoint(input: {
  url: string;
  events: string[];
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  const url = input.url.trim();
  if (!/^https:\/\/.+/i.test(url)) {
    return { ok: false, error: "Webhook endpoints must use HTTPS." };
  }
  if (input.events.length === 0) {
    return { ok: false, error: "Subscribe the endpoint to at least one event." };
  }
  try {
    const record: WebhookRecord = {
      id: await nextKeyId("wh"),
      url,
      events: input.events,
      is_active: true,
      created_at: nowIso(),
    };
    await rtdbSet(`${SETTINGS_PATH}/api/webhooks/${record.id}`, toRtdb(record));
    await writeSettingsAudit({
      action: "settings.webhook.added",
      actor_email: input.actorEmail,
      detail: `${url} [${input.events.join(", ")}]`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add endpoint." };
  }
}

export async function setWebhookActive(input: {
  id: string;
  isActive: boolean;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    await rtdbUpdate(`${SETTINGS_PATH}/api/webhooks/${input.id}`, {
      is_active: input.isActive,
      updated_at: nowIso(),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update endpoint." };
  }
}

export async function removeWebhookEndpoint(input: {
  id: string;
  actorEmail: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isFirebaseAvailable())
    return { ok: false, error: "Firebase is only available in the browser." };
  try {
    await rtdbSet(`${SETTINGS_PATH}/api/webhooks/${input.id}`, null);
    await writeSettingsAudit({
      action: "settings.webhook.removed",
      actor_email: input.actorEmail,
      detail: input.id,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to remove endpoint." };
  }
}
