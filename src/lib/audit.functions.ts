import { auditLogs, delay, unwrap } from "@/lib/demo-store";

export interface AuditFilters {
  entityType?: string;
  actorEmail?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_email: string | null;
  before_value: Record<string, string | number | boolean | null> | null;
  after_value: Record<string, string | number | boolean | null> | null;
  created_at: string;
}

export async function listAuditLogs(arg?: AuditFilters | { data: AuditFilters }): Promise<AuditLogEntry[]> {
  await delay(40);
  const input = unwrap(arg);
  const from = input?.from ? new Date(input.from).getTime() : null;
  const to = input?.to ? new Date(input.to).getTime() : null;
  return auditLogs
    .filter((a) => !input?.entityType || input.entityType === "all" || a.entity_type === input.entityType)
    .filter((a) => !input?.actorEmail || a.actor_email === input.actorEmail)
    .filter((a) => !input?.action || a.action.includes(input.action))
    .filter((a) => {
      const t = new Date(a.created_at).getTime();
      if (from && t < from) return false;
      if (to && t > to) return false;
      return true;
    })
    .slice(0, input?.limit ?? 200);
}

export function getAuditEntityTypes(): string[] {
  return Array.from(new Set(auditLogs.map((a) => a.entity_type))).sort();
}

export function getAuditActors(): string[] {
  return Array.from(new Set(auditLogs.map((a) => a.actor_email).filter(Boolean) as string[])).sort();
}
