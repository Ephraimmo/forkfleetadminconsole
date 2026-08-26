import { logAudit, profiles } from "@/lib/demo-store";
import { getDemoUserId } from "@/lib/session.functions";

/** Small wrapper that resolves the current demo actor email before logging. */
export function audit(
  entry: {
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: Record<string, string | number | boolean | null> | null;
    after?: Record<string, string | number | boolean | null> | null;
  },
) {
  const userId = getDemoUserId();
  const profile = profiles.find((p) => p.user_id === userId);
  return logAudit({
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    actorEmail: profile?.email ?? null,
  });
}
