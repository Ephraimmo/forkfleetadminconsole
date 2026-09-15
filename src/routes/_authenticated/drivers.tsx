import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bike, Eye, Search, ShieldCheck, Star } from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDriverFleet, type DriverRow } from "@/hooks/use-driver-fleet";
import { DriverDetailsDialog } from "@/components/drivers/DriverDetailsDialog";
import type { DriverStatus } from "@/lib/drivers.firebase";

export const Route = createFileRoute("/_authenticated/drivers")({
  head: () => ({
    meta: [
      { title: "Driver Fleet — ForkFleet Console" },
      {
        name: "description",
        content: "Review and approve registered drivers, assign restaurant branches and manage the fleet in real time.",
      },
      { property: "og:title", content: "Driver Fleet — ForkFleet Console" },
      { property: "og:description", content: "Live driver approvals, branch assignments and status management." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DriversPage,
});

const DRIVER_STATUSES: DriverStatus[] = [
  "online",
  "busy",
  "offline",
  "suspended",
  "pending",
  "rejected",
];

const statusTone: Record<string, string> = {
  online: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  busy: "bg-sky-500/15 text-sky-400 border-sky-500/25",
  offline: "bg-muted text-muted-foreground border-border",
  suspended: "bg-destructive/15 text-destructive border-destructive/25",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  rejected: "bg-destructive/15 text-destructive border-destructive/25",
};

function verificationBadge(driver: DriverRow) {
  if (driver.is_verified) {
    return (
      <Badge variant="default" className="gap-1">
        <ShieldCheck className="size-3.5" /> Verified
      </Badge>
    );
  }
  if (driver.verification_submitted_at) {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-400">
        Under review
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-400">
      Pending
    </Badge>
  );
}

function DriversPage() {
  const { rows, source, loading } = useDriverFleet();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<DriverRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((d) => {
      if (status !== "all" && d.status !== status) return false;
      if (!q) return true;
      return (
        d.full_name.toLowerCase().includes(q) ||
        (d.email ?? "").toLowerCase().includes(q) ||
        (d.username ?? "").toLowerCase().includes(q) ||
        (d.phone ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, status]);

  const pendingCount = filtered.filter((d) => d.status === "pending").length;
  const onlineCount = filtered.filter((d) => d.status === "online").length;
  const busyCount = filtered.filter((d) => d.status === "busy").length;

  return (
    <PermissionGate
      required={["drivers.view", "drivers.manage"]}
      breadcrumb={["Operations", "Drivers"]}
      title="Driver fleet"
      description="Review registered drivers, approve accounts and assign restaurant branches — all live from Firebase."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, username, email or phone"
              className="w-64 pl-8"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {DRIVER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {(staff) => {
        const canManage =
          staff.hasPermission("drivers.manage") || staff.hasPermission("dispatch.manage");
        return (
          <div className="space-y-4">
            {source === "demo" && !loading && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                Firebase is not reachable — showing sample data. Registered drivers appear here
                automatically once Firebase is connected.
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryTile label="Drivers" value={String(filtered.length)} />
              <SummaryTile label="Awaiting approval" value={String(pendingCount)} tone="amber" />
              <SummaryTile label="Online" value={String(onlineCount)} tone="emerald" />
              <SummaryTile label="On delivery" value={String(busyCount)} tone="sky" />
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bike className="size-4" /> Driver fleet
                </CardTitle>
                <CardDescription>
                  Open a driver to review their profile, verify documents, assign branches and
                  manage their status.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Driver</TableHead>
                          <TableHead>Vehicle</TableHead>
                          <TableHead>City</TableHead>
                          <TableHead>Deliveries</TableHead>
                          <TableHead>Rating</TableHead>
                          <TableHead>Verification</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((driver) => (
                          <TableRow key={driver.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{driver.full_name}</span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {driver.email ?? driver.username ?? driver.id}
                              </p>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {driver.vehicle_type ?? "—"}
                              {driver.vehicle_plate ? ` • ${driver.vehicle_plate}` : ""}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{driver.city ?? "—"}</TableCell>
                            <TableCell className="text-muted-foreground">{driver.total_deliveries}</TableCell>
                            <TableCell>
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Star className="size-3.5 text-amber-400" /> {driver.rating.toFixed(1)}
                              </span>
                            </TableCell>
                            <TableCell>{verificationBadge(driver)}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={statusTone[driver.status] ?? ""}>
                                {driver.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelected(driver)}
                              >
                                <Eye className="mr-1.5 size-4" /> View
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {filtered.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={8}
                              className="py-10 text-center text-sm text-muted-foreground"
                            >
                              No drivers match these filters. New drivers appear here in real time
                              after they register in the Driver App.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <DriverDetailsDialog
              driver={selected}
              open={!!selected}
              onOpenChange={(o) => !o && setSelected(null)}
              canManage={canManage}
            />
          </div>
        );
      }}
    </PermissionGate>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "amber" | "emerald" | "sky";
}) {
  const toneClass =
    tone === "amber"
      ? "text-amber-400"
      : tone === "emerald"
        ? "text-emerald-400"
        : tone === "sky"
          ? "text-sky-400"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
