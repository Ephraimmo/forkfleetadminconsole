import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BadgeCheck,
  Bike,
  Building2,
  Car,
  CheckCircle2,
  Circle,
  Clock,
  CreditCard,
  IdCard,
  Loader2,
  MapPin,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Star,
  Store,
  UserRound,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DriverRow } from "@/hooks/use-driver-fleet";
import {
  approveDriver,
  rejectDriver,
  suspendDriver,
  reactivateDriver,
  assignDriverToBranch,
  assignDriverToAllBranches,
  removeDriverBranch,
  subscribeDriverAssignmentsHistory,
  normalizeBranchKey,
  type DriverAssignment,
} from "@/lib/drivers.firebase";
import { subscribeRestaurants, type FirebaseRestaurant } from "@/lib/restaurants.firebase";
import { subscribeAllBranches, type RestaurantBranch } from "@/lib/branches.firebase";

const statusTone: Record<string, string> = {
  online: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  busy: "bg-sky-500/15 text-sky-400 border-sky-500/25",
  offline: "bg-muted text-muted-foreground border-border",
  suspended: "bg-destructive/15 text-destructive border-destructive/25",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  rejected: "bg-destructive/15 text-destructive border-destructive/25",
};

const ALL_BRANCHES = "__all__";

interface BranchOption {
  id: string;
  name: string;
}

/** Pretty-print a raw branch id ("brn-main" → "Main", "branch-test1" → "Branch Test1"). */
function prettyBranchName(id: string | null | undefined): string {
  const cleaned = String(id ?? "")
    .trim()
    .replace(/^brn-/, "")
    .replace(/^branch-/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!cleaned) return "Main";
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Branch list for a restaurant, from the authoritative /restaurantBranches
 *  registry. Falls back to any inline `branches` field, then to a single
 *  "Main" branch when the restaurant genuinely has no branch data. */
function branchOptionsFor(
  restaurant: FirebaseRestaurant | null | undefined,
  registry: Record<string, RestaurantBranch[]>,
): BranchOption[] {
  if (!restaurant) return [];
  const fromRegistry = registry[restaurant.id] ?? [];
  if (fromRegistry.length > 0) {
    return fromRegistry.map((b) => ({ id: b.id, name: b.name || prettyBranchName(b.id) }));
  }

  const raw = (restaurant as unknown as Record<string, unknown>)["branches"];

  // Object map form: { main: { id, name }, test1: { id, name } }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, { id?: string; name?: string } | string>);
    if (entries.length > 0) {
      return entries.map(([key, value]) => {
        if (value && typeof value === "object") {
          return { id: value.id ?? key, name: value.name ?? prettyBranchName(key) };
        }
        return { id: key, name: typeof value === "string" ? value : prettyBranchName(key) };
      });
    }
  }

  // Array form: [ { id, name }, ... ]
  if (Array.isArray(raw) && raw.length > 0) {
    return (raw as { id?: string; name?: string }[]).map((b, i) => ({
      id: b.id ?? `brn-${i + 1}`,
      name: b.name ?? prettyBranchName(b.id),
    }));
  }

  return [{ id: "main", name: "Main" }];
}

export function DriverDetailsDialog({
  driver,
  open,
  onOpenChange,
  canManage,
}: {
  driver: DriverRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
}) {
  const [assignments, setAssignments] = useState<DriverAssignment[]>([]);
  const [restaurants, setRestaurants] = useState<FirebaseRestaurant[]>([]);
  const [branchRegistry, setBranchRegistry] = useState<Record<string, RestaurantBranch[]>>({});
  const [restaurantId, setRestaurantId] = useState("");
  const [branchId, setBranchId] = useState(ALL_BRANCHES);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const driverId = driver?.id ?? null;

  // Live assignments for this driver (active + history).
  useEffect(() => {
    if (!open || !driverId) {
      setAssignments([]);
      return;
    }
    const unsub = subscribeDriverAssignmentsHistory(driverId, setAssignments);
    return unsub;
  }, [open, driverId]);

  // Restaurants + their authoritative branch registry.
  useEffect(() => {
    if (!open) return;
    const unsubR = subscribeRestaurants(setRestaurants);
    const unsubB = subscribeAllBranches(setBranchRegistry);
    return () => {
      unsubR();
      unsubB();
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setRestaurantId("");
      setBranchId(ALL_BRANCHES);
      setRejectReason("");
    }
  }, [open]);

  const activeAssignments = useMemo(() => assignments.filter((a) => a.is_active), [assignments]);
  const inactiveAssignments = useMemo(() => assignments.filter((a) => !a.is_active), [assignments]);

  // Lookups used to resolve friendly restaurant + branch names when an assignment
  // record is missing its denormalized names (assignments created outside this
  // dialog, e.g. by the driver app or an older build).
  const branchesByRestaurant = useMemo(() => {
    const map: Record<string, BranchOption[]> = {};
    for (const r of restaurants) map[r.id] = branchOptionsFor(r, branchRegistry);
    return map;
  }, [restaurants, branchRegistry]);

  const restaurantById = useMemo(() => {
    const map: Record<string, FirebaseRestaurant> = {};
    for (const r of restaurants) map[r.id] = r;
    return map;
  }, [restaurants]);

  if (!driver) return null;

  const initials = driver.full_name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const verification: "verified" | "review" | "pending" = driver.is_verified
    ? "verified"
    : driver.verification_submitted_at
      ? "review"
      : "pending";

  const requirements = [
    { label: "Profile photo", done: driver.is_verified || !!driver.full_name },
    { label: "Driver's licence", done: driver.is_verified || !!driver.license_number },
    { label: "Identity document", done: driver.is_verified || !!driver.id_number },
    { label: "Vehicle registration", done: driver.is_verified || !!driver.vehicle_plate },
    {
      label: "Bank details",
      done: driver.is_verified || !!(driver.bank_name && driver.bank_account_number),
    },
    {
      label: "Emergency contact",
      done: driver.is_verified || !!(driver.emergency_contact_name && driver.emergency_contact_phone),
    },
  ];
  const doneCount = requirements.filter((r) => r.done).length;

  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const selectedRestaurant = restaurants.find((r) => r.id === restaurantId) ?? null;
  const branches = branchOptionsFor(selectedRestaurant, branchRegistry);


  const assignmentRestaurantName = (a: DriverAssignment): string => {
    if (a.restaurant_name && a.restaurant_name.trim()) return a.restaurant_name;
    return restaurantById[a.restaurant_id]?.name ?? a.restaurant_id;
  };

  const assignmentBranchName = (a: DriverAssignment): string => {
    if (a.branch_name && a.branch_name.trim()) return a.branch_name;
    const branchList = branchesByRestaurant[a.restaurant_id] ?? [];
    const found = branchList.find(
      (b) => normalizeBranchKey(b.id) === normalizeBranchKey(a.branch_id),
    );
    return found?.name ?? prettyBranchName(a.branch_id);
  };

  /** Active assignments grouped per restaurant, with branch coverage. */
  const coverage = Object.values(
    activeAssignments.reduce<
      Record<
        string,
        { restaurantId: string; name: string; rows: DriverAssignment[] }
      >
    >((acc, a) => {
      const bucket = acc[a.restaurant_id] ?? {
        restaurantId: a.restaurant_id,
        name: assignmentRestaurantName(a),
        rows: [],
      };
      bucket.rows.push(a);
      acc[a.restaurant_id] = bucket;
      return acc;
    }, {}),
  ).map((group) => {
    const all = branchesByRestaurant[group.restaurantId] ?? [];
    const assignedKeys = new Set(group.rows.map((a) => normalizeBranchKey(a.branch_id)));
    const missing = all.filter((b) => !assignedKeys.has(normalizeBranchKey(b.id)));
    return { ...group, all, missing };
  });

  const coverMissing = async (group: (typeof coverage)[number]) => {
    const restaurant = restaurantById[group.restaurantId];
    await run(
      `cover-${group.restaurantId}`,
      () =>
        assignDriverToAllBranches(
          driver.id,
          group.restaurantId,
          group.missing,
          restaurant?.name ?? group.name,
        ),
      `All branches of ${group.name} assigned`,
    );
  };

  const confirmAssign = async () => {
    if (!selectedRestaurant) return;
    const names: { restaurant_name?: string; branch_name?: string } = {};
    if (selectedRestaurant.name) names.restaurant_name = selectedRestaurant.name;
    await run("assign", async () => {
      if (branchId === ALL_BRANCHES) {
        if (branches.length === 0) throw new Error("This restaurant has no branches yet.");
        await assignDriverToAllBranches(driver.id, selectedRestaurant.id, branches, selectedRestaurant.name);
      } else {
        const branch = branches.find((b) => b.id === branchId) ?? branches[0];
        if (!branch) throw new Error("No branch selected.");
        if (branch.name) names.branch_name = branch.name;
        await assignDriverToBranch(driver.id, selectedRestaurant.id, branch.id, names);
      }
    }, `Assigned to ${selectedRestaurant.name}`);
    setRestaurantId("");
    setBranchId(ALL_BRANCHES);
  };

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-4 pr-6">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 text-2xl font-bold text-primary-foreground">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-xl font-bold">{driver.full_name}</h2>
            <p className="truncate text-sm text-muted-foreground">
              @{driver.username ?? driver.id} · {driver.id}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {verification === "verified" ? (
                <Badge variant="default" className="gap-1">
                  <ShieldCheck className="size-3.5" /> Verified
                </Badge>
              ) : verification === "review" ? (
                <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-400">
                  <Clock className="size-3.5" /> Under review
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-400">
                  <ShieldAlert className="size-3.5" /> Pending
                </Badge>
              )}
              <Badge variant={driver.is_active ? "default" : "destructive"}>
                {driver.is_active ? "Active" : "Inactive"}
              </Badge>
              <Badge variant="outline" className={statusTone[driver.status] ?? ""}>
                {driver.status}
              </Badge>
            </div>
          </div>
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="verification">Verification</TabsTrigger>
            <TabsTrigger value="assignments">Assignments</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          {/* ---------------- Overview ---------------- */}
          <TabsContent value="overview" className="space-y-4 pt-4">
            <div className="grid grid-cols-3 gap-2">
              <MiniStat icon={Star} label="Rating" value={driver.rating.toFixed(1)} />
              <MiniStat icon={BadgeCheck} label="Deliveries" value={String(driver.total_deliveries)} />
              <MiniStat icon={Wallet} label="Balance" value={`R${driver.wallet_balance.toFixed(2)}`} />
            </div>

            <Section title="Contact">
              <DetailRow icon={Phone} label="Phone" value={driver.phone ?? "—"} />
              <DetailRow icon={UserRound} label="Email" value={driver.email ?? "—"} />
              <DetailRow icon={UserRound} label="Username" value={driver.username ?? driver.id} />
              <DetailRow icon={MapPin} label="City" value={driver.city ?? "—"} />
            </Section>

            <Section title="Vehicle & licence">
              <DetailRow
                icon={Car}
                label="Vehicle"
                value={`${driver.vehicle_type ?? "—"} · ${driver.vehicle_plate ?? "no plate"}`}
              />
              <DetailRow icon={IdCard} label="Licence" value={driver.license_number ?? "Not provided"} />
              <DetailRow icon={IdCard} label="ID number" value={driver.id_number ?? "Not provided"} />
            </Section>

            <Section title="Payout & emergency">
              <DetailRow
                icon={CreditCard}
                label="Bank"
                value={
                  driver.bank_name
                    ? `${driver.bank_name} · ${driver.bank_account_number ?? ""}`
                    : "Not provided"
                }
              />
              <DetailRow
                icon={Phone}
                label="Emergency"
                value={
                  driver.emergency_contact_name
                    ? `${driver.emergency_contact_name} · ${driver.emergency_contact_phone ?? ""}`
                    : "Not provided"
                }
              />
              <DetailRow icon={Clock} label="Member since" value={fmt(driver.created_at)} />
            </Section>
          </TabsContent>

          {/* ---------------- Verification ---------------- */}
          <TabsContent value="verification" className="space-y-4 pt-4">
            {verification === "verified" ? (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4">
                <ShieldCheck className="size-9 shrink-0 text-emerald-400" />
                <div>
                  <p className="text-sm font-bold text-emerald-400">Verified driver</p>
                  <p className="text-xs text-muted-foreground">
                    This account has been approved and can receive deliveries.
                  </p>
                </div>
              </div>
            ) : verification === "review" ? (
              <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <Clock className="size-9 shrink-0 text-amber-400" />
                <div>
                  <p className="text-sm font-bold text-amber-400">Submitted for review</p>
                  <p className="text-xs text-muted-foreground">
                    The driver submitted their profile on {fmt(driver.verification_submitted_at)}.
                    Review the documents below before approving.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <ShieldAlert className="size-9 shrink-0 text-amber-400" />
                <div>
                  <p className="text-sm font-bold text-amber-400">Awaiting driver documents</p>
                  <p className="text-xs text-muted-foreground">
                    The driver has not completed their profile yet.
                  </p>
                </div>
              </div>
            )}

            <ul className="space-y-2">
              {requirements.map((req) => (
                <li key={req.label} className="rounded-lg border border-border bg-card flex items-start gap-3 p-3">
                  {req.done ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                  ) : (
                    <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex flex-1 items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{req.label}</p>
                    <Badge variant={req.done ? "default" : "outline"}>
                      {req.done ? "Complete" : "Missing"}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {doneCount} of {requirements.length} requirements complete.
            </p>

            {canManage && verification !== "verified" && (
              <div className="space-y-3 rounded-xl border border-border p-4">
                <p className="text-sm font-semibold">Review decision</p>
                <div className="space-y-1">
                  <Label>Rejection reason (optional)</Label>
                  <Input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. Licence expired, ID unreadable"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={busy === "approve"}
                    onClick={() =>
                      run("approve", () => approveDriver(driver.id), `${driver.full_name} approved`)
                    }
                  >
                    {busy === "approve" ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="mr-2 size-4" />
                    )}
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy === "reject"}
                    onClick={() =>
                      run(
                        "reject",
                        () => rejectDriver(driver.id, rejectReason.trim() || undefined),
                        `${driver.full_name} rejected`,
                      )
                    }
                  >
                    {busy === "reject" ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <ShieldAlert className="mr-2 size-4" />
                    )}
                    Reject
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ---------------- Assignments ---------------- */}
          <TabsContent value="assignments" className="space-y-4 pt-4">
            {coverage.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
                <Building2 className="mx-auto mb-2 size-7 text-muted-foreground" />
                <p className="text-sm font-semibold">No branch assignments yet</p>
                <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                  A driver can only be assigned to an order once they cover that order&apos;s
                  restaurant <span className="font-medium">and</span> branch.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {coverage.map((group) => (
                  <li key={group.restaurantId} className="rounded-xl border border-border bg-card">
                    <div className="flex items-center gap-3 border-b border-border p-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Store className="size-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{group.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {group.rows.length} of {Math.max(group.all.length, group.rows.length)}{" "}
                          branches covered
                        </p>
                      </div>
                      {group.missing.length > 0 ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-400"
                        >
                          {group.missing.length} uncovered
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                          Full coverage
                        </Badge>
                      )}
                    </div>

                    <ul className="divide-y divide-border">
                      {group.rows.map((a) => (
                        <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                          <Building2 className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {assignmentBranchName(a)}
                          </span>
                          {canManage && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-muted-foreground hover:text-destructive"
                              disabled={busy === `remove-${a.id}`}
                              onClick={() =>
                                run("remove-" + a.id, () => removeDriverBranch(a.id), "Branch removed")
                              }
                            >
                              {busy === `remove-${a.id}` ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                "Remove"
                              )}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>

                    {group.missing.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-amber-500/5 p-3">
                        <p className="min-w-0 flex-1 text-xs text-amber-400">
                          Not covered: {group.missing.map((b) => b.name).join(", ")} — orders from
                          these branches cannot be assigned to this driver.
                        </p>
                        {canManage && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === `cover-${group.restaurantId}`}
                            onClick={() => coverMissing(group)}
                          >
                            {busy === `cover-${group.restaurantId}` ? (
                              <Loader2 className="mr-2 size-3.5 animate-spin" />
                            ) : null}
                            Cover all branches
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {inactiveAssignments.length > 0 && (
              <details className="pt-2">
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  Previous assignments ({inactiveAssignments.length})
                </summary>
                <ul className="space-y-1 pt-2">
                  {inactiveAssignments.map((a) => (
                    <li key={a.id} className="text-xs text-muted-foreground">
                      {assignmentRestaurantName(a)} · {assignmentBranchName(a)} — inactive
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {canManage && (
              <div className="rounded-xl border border-border p-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Building2 className="size-4 text-muted-foreground" /> Add assignment
                </p>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>Restaurant</Label>
                    <Select
                      value={restaurantId}
                      onValueChange={(v) => {
                        setRestaurantId(v);
                        setBranchId(ALL_BRANCHES);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a restaurant" />
                      </SelectTrigger>
                      <SelectContent>
                        {restaurants.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Branch</Label>
                    <Select value={branchId} onValueChange={setBranchId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a branch" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    className="w-full"
                    disabled={!selectedRestaurant || busy === "assign"}
                    onClick={confirmAssign}
                  >
                    {busy === "assign" ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Store className="mr-2 size-4" />
                    )}
                    Assign branch
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ---------------- Activity ---------------- */}
          <TabsContent value="activity" className="space-y-4 pt-4">
            <Section title="Status">
              <DetailRow icon={Bike} label="Status" value={String(driver.status)} />
              <DetailRow icon={Clock} label="Last online" value={fmt(driver.last_online_at)} />
              <DetailRow icon={Clock} label="Last offline" value={fmt(driver.last_offline_at)} />
              <DetailRow icon={Clock} label="Updated" value={fmt(driver.updated_at)} />
            </Section>

            {driver.rejection_reason && (
              <div className="rounded-xl border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
                Rejection reason: {driver.rejection_reason}
              </div>
            )}

            {canManage && (
              <div className="space-y-2">
                {driver.status === "suspended" ? (
                  <Button
                    className="w-full"
                    disabled={busy === "reactivate"}
                    onClick={() =>
                      run("reactivate", () => reactivateDriver(driver.id), "Driver reactivated")
                    }
                  >
                    {busy === "reactivate" ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="mr-2 size-4" />
                    )}
                    Reactivate driver
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={busy === "suspend"}
                    onClick={() => run("suspend", () => suspendDriver(driver.id), "Driver suspended")}
                  >
                    {busy === "suspend" ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <ShieldAlert className="mr-2 size-4" />
                    )}
                    Suspend driver
                  </Button>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card space-y-1 p-3">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium">{value}</span>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <Icon className="mb-1 size-4 text-muted-foreground" />
      <p className="text-lg font-semibold leading-tight">{value}</p>
      <p className="text-xs leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}
