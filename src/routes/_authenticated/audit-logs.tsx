import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@/lib/use-demo-fn";
import {
  ScrollText,
  Activity,
  Shield,
  User,
  FileText,
  Search,
  Download,
  Filter,
  Clock,
  ChevronRight,
} from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

import { listAuditLogs, getAuditEntityTypes, getAuditActors } from "@/lib/audit.functions";
import { profiles } from "@/lib/demo-store";
import { number0 } from "@/lib/demo-formatters";

export const Route = createFileRoute("/_authenticated/audit-logs")({
  head: () => ({
    meta: [
      { title: "Audit Logs — ForkFleet Console" },
      { name: "description", content: "Platform-wide immutable audit trail of every staff action." },
    ],
  }),
  component: AuditLogsPage,
});

const entityIcon: Record<string, typeof FileText> = {
  order: Activity,
  driver: User,
  restaurant: FileText,
  staff: Shield,
  staff_invitation: Shield,
  user_role: Shield,
  promotion: FileText,
  inventory_item: FileText,
  customs_entry: FileText,
  menu_item: FileText,
  notification_preference: Activity,
  notification: Activity,
};

function diffSummary(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  if (!before && after) return "created";
  if (before && !after) return "deleted";
  if (before && after) {
    const keys = Object.keys({ ...before, ...after });
    return keys.map((k) => {
      const b = before[k];
      const a = after[k];
      if (b === a) return null;
      if (b == null) return `${k} set to ${String(a)}`;
      if (a == null) return `${k} removed`;
      return `${k}: ${String(b)} → ${String(a)}`;
    }).filter(Boolean).join("; ") || "no changes";
  }
  return "viewed";
}

function AuditLogsPage() {
  const [search, setSearch] = useState("");
  const [entity, setEntity] = useState("all");
  const [actor, setActor] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchLogs = useServerFn(listAuditLogs);
  const logsQuery = useQuery({
    queryKey: ["audit-logs", entity, actor],
    queryFn: () => fetchLogs({ entityType: entity, ...(actor !== "all" ? { actorEmail: actor } : {}), limit: 200 }),
    refetchInterval: 20_000,
  });
  const logs = logsQuery.data ?? [];

  const filtered = useMemo(
    () =>
      logs.filter((l) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          l.action.toLowerCase().includes(q) ||
          (l.entity_id ?? "").toLowerCase().includes(q) ||
          (l.actor_email ?? "").toLowerCase().includes(q)
        );
      }),
    [logs, search],
  );

  const selected = selectedId ? logs.find((l) => l.id === selectedId) : logs[0];

  const entities = getAuditEntityTypes();
  const actors = getAuditActors();

  const actionCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of logs) {
      const bucket = l.action.split(".").slice(0, 2).join(".");
      map.set(bucket, (map.get(bucket) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name: name.replace(/^[a-z]+\./, ""), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [logs]);

  const stats = useMemo(() => {
    const last24h = logs.filter((l) => Date.now() - new Date(l.created_at).getTime() < 86400000).length;
    const actorsCount = new Set(logs.map((l) => l.actor_email).filter(Boolean)).size;
    const entitiesCount = new Set(logs.map((l) => l.entity_type)).size;
    return { total: logs.length, last24h, actors: actorsCount, entities: entitiesCount };
  }, [logs]);

  function exportCsv() {
    const cols = ["Timestamp", "Action", "Entity", "Entity ID", "Actor", "Changes"];
    const rows = filtered.map((l) => [
      new Date(l.created_at).toISOString(),
      l.action,
      l.entity_type,
      l.entity_id ?? "",
      l.actor_email ?? "",
      diffSummary(l.before_value, l.after_value),
    ]);
    const csv = [cols.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PermissionGate
      required={["audit.view"]}
      breadcrumb={["Platform", "Audit logs"]}
      title="Audit logs"
      description="Immutable, append-only trail of every staff action across the platform — timestamped, tied to an actor, and exportable for compliance."
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-1.5 size-3.5" /> Export CSV
          </Button>
        </div>
      }
    >
      {() => (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={ScrollText} label="Total events" value={number0(stats.total)} />
            <Kpi icon={Clock} label="Last 24h" value={number0(stats.last24h)} tone="text-primary" />
            <Kpi icon={User} label="Active actors" value={number0(stats.actors)} tone="text-emerald-400" />
            <Kpi icon={Filter} label="Entity types" value={number0(stats.entities)} tone="text-amber-400" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Events by action</CardTitle>
                <CardDescription>Breakdown of the most frequent audited actions in the current log.</CardDescription>
              </CardHeader>
              <CardContent className="h-64 px-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={actionCounts} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={32} />
                    <Tooltip
                      cursor={{ fill: "var(--color-secondary)" }}
                      contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                    />
                    <Bar dataKey="value" fill="var(--color-chart-1)" radius={[0, 4, 4, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Integrity</CardTitle>
                <CardDescription>Append-only, tamper-evident log.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Integrity label="Log entries" value={`${logs.length} events`} />
                <Integrity label="Hash chain" value="Verified" good />
                <Integrity label="Retention" value="365 days" />
                <Integrity label="Last event" value={logs[0] ? new Date(logs[0].created_at).toLocaleString() : "—"} />
                <Integrity label="Export" value="CSV / JSON / SIEM" />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-end gap-3 space-y-0">
              <div className="flex-1">
                <CardTitle className="text-base">Event stream</CardTitle>
                <CardDescription>{filtered.length} events shown</CardDescription>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="relative w-60">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input placeholder="Search action, actor, id…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Select value={entity} onValueChange={setEntity}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="All entities" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All entities</SelectItem>
                    {entities.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={actor} onValueChange={setActor}>
                  <SelectTrigger className="w-60">
                    <SelectValue placeholder="All actors" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All actors</SelectItem>
                    {actors.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 p-0 lg:grid-cols-[minmax(0,1fr)_320px]">
              <ScrollArea className="max-h-[560px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead className="pl-4">When</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead className="pr-4">Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.slice(0, 80).map((l) => {
                      const Icon = entityIcon[l.entity_type] ?? FileText;
                      const actorName =
                        profiles.find((p) => p.email === l.actor_email)?.full_name ?? l.actor_email ?? "system";
                      const active = selected?.id === l.id;
                      return (
                        <TableRow
                          key={l.id}
                          className={active ? "bg-primary/5" : "cursor-pointer"}
                          onClick={() => setSelectedId(l.id)}
                        >
                          <TableCell className="pl-4 text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(l.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="flex size-6 items-center justify-center rounded-full bg-muted">
                                <User className="size-3" />
                              </span>
                              <span className="text-sm">{actorName}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="gap-1 font-mono text-[10px]">
                              <Activity className="size-3" /> {l.action}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Icon className="size-3.5 text-muted-foreground" />
                              <span className="text-xs capitalize">{l.entity_type}</span>
                              {l.entity_id && <span className="font-mono text-[10px] text-muted-foreground">{l.entity_id}</span>}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[260px] truncate pr-4 text-xs text-muted-foreground">
                            {diffSummary(l.before_value, l.after_value)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>

              <aside className="border-l border-border/70 p-4">
                {selected ? (
                  <div className="space-y-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Selected event</p>
                      <p className="mt-1 text-sm font-semibold break-all">{selected.action}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(selected.created_at).toLocaleString()}
                      </p>
                    </div>
                    <Separator />
                    <Detail label="Event ID" value={selected.id} mono />
                    <Detail label="Entity type" value={selected.entity_type} capitalize />
                    <Detail label="Entity ID" value={selected.entity_id ?? "—"} mono />
                    <Detail label="Actor" value={selected.actor_email ?? "system"} />
                    <Separator />
                    <div>
                      <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Changes</p>
                      <div className="rounded-md border border-border bg-muted/30 p-3 text-[11px] font-mono">
                        {(() => {
                          const keys = Array.from(
                            new Set([
                              ...Object.keys(selected.before_value ?? {}),
                              ...Object.keys(selected.after_value ?? {}),
                            ]),
                          );
                          if (keys.length === 0) return <span className="text-muted-foreground">No field-level diff recorded.</span>;
                          return keys.map((k) => (
                            <div key={k} className="flex gap-2">
                              <span className="text-muted-foreground">{k}:</span>
                              <span className="text-destructive">{selected.before_value?.[k] ?? "∅"}</span>
                              <ChevronRight className="size-3 text-muted-foreground" />
                              <span className="text-emerald-400">{selected.after_value?.[k] ?? "∅"}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Select an event to see field-level diff.</p>
                )}
              </aside>
            </CardContent>
          </Card>
        </div>
      )}
    </PermissionGate>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ScrollText;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-muted p-2"><Icon className={`size-4 ${tone ?? "text-primary"}`} /></div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Integrity({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0 last:pb-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium ${good ? "text-emerald-400" : ""}`}>{value}</span>
    </div>
  );
}

function Detail({ label, value, mono, capitalize }: { label: string; value: string; mono?: boolean; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm ${mono ? "font-mono text-[12px] break-all" : ""} ${capitalize ? "capitalize" : ""}`}>{value}</p>
    </div>
  );
}
