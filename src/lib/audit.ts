import { logAudit } from "@/lib/demo-store";
import { readStoredFirebaseSession } from "@/lib/session.functions";

/** Small wrapper that resolves the signed-in operator's email before logging. */
export function audit(
  entry: {
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: Record<string, string | number | boolean | null> | null;
    after?: Record<string, string | number | boolean | null> | null;
  },
) {
  const session = readStoredFirebaseSession();
  return logAudit({
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    actorEmail: session?.email ?? null,
  });
}
