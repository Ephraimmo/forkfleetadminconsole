import {
  audit,
} from "@/lib/audit";
import {
  delay,
  notificationPreferences,
  notifications,
  uid,
  type DemoNotification,
  type NotificationChannel,
  type NotificationSeverity,
} from "@/lib/demo-store";

export interface AlertPreference {
  id: string;
  trigger: string;
  label: string;
  description: string;
  enabled: boolean;
  channels: NotificationChannel[];
  minSeverity: NotificationSeverity;
  roles: string[];
}

export async function listNotifications(input?: { unreadOnly?: boolean }): Promise<DemoNotification[]> {
  await delay(60);
  const all = notifications.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  return input?.unreadOnly ? all.filter((n) => !n.read_at) : all;
}

export async function markNotificationRead(input: { id: string }) {
  await delay(30);
  const n = notifications.find((x) => x.id === input.id);
  if (n) n.read_at = new Date().toISOString();
  return { ok: true };
}

export async function markAllNotificationsRead() {
  await delay(40);
  const now = new Date().toISOString();
  for (const n of notifications) if (!n.read_at) n.read_at = now;
  return { ok: true };
}

export async function listNotificationPreferences(): Promise<AlertPreference[]> {
  await delay(60);
  return notificationPreferences.map((p) => ({ ...p, channels: [...p.channels], roles: [...p.roles] }));
}

export async function updateNotificationPreference(input: {
  id: string;
  enabled?: boolean;
  channels?: NotificationChannel[];
  minSeverity?: NotificationSeverity;
}) {
  await delay(50);
  const p = notificationPreferences.find((x) => x.id === input.id);
  if (!p) throw new Error("Preference not found");
  if (typeof input.enabled === "boolean") p.enabled = input.enabled;
  if (input.channels) p.channels = input.channels;
  if (input.minSeverity) p.minSeverity = input.minSeverity;
  audit({
    action: "notification.preference.updated",
    entityType: "notification_preference",
    entityId: p.id,
    after: { enabled: p.enabled, channels: p.channels.join(","), severity: p.minSeverity },
  });
  return { ok: true };
}

export async function sendTestAlert(input: { trigger: string }) {
  await delay(120);
  const pref = notificationPreferences.find((p) => p.trigger === input.trigger);
  if (!pref) throw new Error("Unknown trigger");
  notifications.unshift({
    id: uid("ntf"),
    title: `Test alert: ${pref.label}`,
    body: "This is a demo notification sent manually from the notification preferences screen.",
    severity: pref.minSeverity,
    trigger: pref.trigger,
    created_at: new Date().toISOString(),
    read_at: null,
    link: "/notifications",
  });
  audit({
    action: "notification.test_sent",
    entityType: "notification",
    after: { trigger: pref.trigger },
  });
  return { ok: true };
}
