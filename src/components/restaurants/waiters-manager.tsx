// Waiters for one restaurant (restaurant profile → Waiters tab).
//
// A waiter is a restaurant login with the "waiter" role, working at one branch
// or at every branch. They sign in on the Waiter screen (/waiter) and, while
// online, are given tables automatically — see src/lib/waiters.firebase.ts.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  UserRound,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { subscribeRestaurantBranches, type RestaurantBranch } from "@/lib/branches.firebase";
import type { StaffActor } from "@/lib/dine-in";
import {
  generateRestaurantUserPassword,
  sendRestaurantUserPasswordReset,
  subscribeRestaurantUsers,
  type RestaurantUserRecord,
} from "@/lib/restaurant-users.firebase";
import { isSessionIdle, subscribeTables, type RestaurantTable } from "@/lib/tables.firebase";
import {
  createWaiter,
  setWaiterActive,
  setWaiterOnline,
  subscribeWaiterRoster,
  updateWaiter,
  type RosterWaiter,
  type WaiterRoster,
} from "@/lib/waiters.firebase";

const ALL_BRANCHES = "__all__";

interface WaiterRow {
  user: RestaurantUserRecord;
  roster: RosterWaiter | null;
  active: boolean;
  online: boolean;
  branchLabel: string;
  openTables: number;
}

export function WaitersManager({
  restaurantId,
  restaurantName,
  canManage,
  actor,
}: {
  restaurantId: string;
  restaurantName: string;
  canManage: boolean;
  actor: StaffActor;
}) {
  const [users, setUsers] = useState<RestaurantUserRecord[] | null>(null);
  const [roster, setRoster] = useState<WaiterRoster | null>(null);
  const [branches, setBranches] = useState<RestaurantBranch[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WaiterRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => subscribeRestaurantUsers(setUsers), []);
  useEffect(() => subscribeWaiterRoster(restaurantId, setRoster, setError), [restaurantId]);
  useEffect(() => subscribeRestaurantBranches(restaurantId, setBranches), [restaurantId]);
  useEffect(() => subscribeTables(restaurantId, setTables), [restaurantId]);

  const branchName = (id: string | null) =>
    id === null ? "All branches" : (branches.find((b) => b.id === id)?.name ?? id);

  const rows = useMemo<WaiterRow[]>(() => {
    const now = Date.now();
    return (users ?? [])
      .filter((u) => u.restaurant_id === restaurantId && u.role === "waiter")
      .map((user) => {
        const entry = roster?.waiters[user.uid] ?? null;
        const active = user.status === "active" && (entry?.active ?? true);
        return {
          user,
          roster: entry,
          active,
          online: active && (entry?.online ?? false),
          branchLabel: branchName(entry?.branch_id ?? user.branch_id),
          openTables: tables.filter(
            (t) => t.session?.waiter_id === user.uid && !isSessionIdle(t.session, now),
          ).length,
        };
      })
      .sort(
        (a, b) =>
          Number(b.online) - Number(a.online) || a.user.full_name.localeCompare(b.user.full_name),
      );
  }, [users, roster, tables, restaurantId, branches]); // eslint-disable-line react-hooks/exhaustive-deps

  const onlineCount = rows.filter((r) => r.online).length;

  async function toggleOnline(row: WaiterRow, online: boolean) {
    setBusy(row.user.uid);
    try {
      const result = await setWaiterOnline({
        restaurant_id: restaurantId,
        waiter: {
          uid: row.user.uid,
          name: row.roster?.name ?? row.user.full_name,
          branch_id: row.roster?.branch_id ?? row.user.branch_id,
          branch_name: row.roster?.branch_name ?? null,
        },
        online,
        actor,
      });
      toast.success(
        online
          ? `${row.user.full_name} is on shift${result.tables_assigned ? ` — ${result.tables_assigned} waiting table(s) assigned` : ""}.`
          : `${row.user.full_name} is off shift${result.tables_moved ? ` — ${result.tables_moved} table(s) handed over` : ""}.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the shift.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(row: WaiterRow) {
    setBusy(row.user.uid);
    try {
      const result = await setWaiterActive({
        restaurant_id: restaurantId,
        uid: row.user.uid,
        active: !row.active,
        actor,
      });
      toast.success(
        row.active
          ? `${row.user.full_name} deactivated${result.tables_moved ? ` — ${result.tables_moved} table(s) handed over` : ""}.`
          : `${row.user.full_name} reactivated.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the waiter.");
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword(row: WaiterRow) {
    const result = await sendRestaurantUserPasswordReset({
      email: row.user.email,
      actorEmail: actor.email,
    });
    if (result.ok) toast.success(`Password reset email sent to ${row.user.email}.`);
    else toast.error(result.error ?? "Could not send the reset email.");
  }

  const waiterScreen =
    typeof window !== "undefined" ? `${window.location.origin}/waiter` : "/waiter";

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserRound className="size-4" /> Waiters
              </CardTitle>
              <CardDescription className="mt-1 max-w-2xl">
                Waiters at {restaurantName}. While on shift, each new table goes to the next waiter
                at its branch in turn, and stays with them until it's cleared. Waiters sign in at{" "}
                <span className="font-mono text-foreground">{waiterScreen}</span>.
              </CardDescription>
            </div>
            {canManage && (
              <Button onClick={() => setAdding(true)} disabled={users === null}>
                <Plus className="mr-1.5 size-4" /> Add waiter
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          {users === null ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              {rows.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {rows.length} waiter{rows.length === 1 ? "" : "s"} · {onlineCount} on shift now
                </p>
              )}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Waiter</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>On shift</TableHead>
                      <TableHead>Tables now</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.user.uid} className={row.active ? "" : "opacity-60"}>
                        <TableCell>
                          <p className="font-medium">{row.user.full_name || row.user.email}</p>
                          <p className="text-[11px] text-muted-foreground">{row.user.email}</p>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.branchLabel}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={row.online}
                              disabled={!canManage || !row.active || busy === row.user.uid}
                              onCheckedChange={(v) => void toggleOnline(row, v)}
                              aria-label={`${row.user.full_name} on shift`}
                            />
                            <span
                              className={`text-xs ${row.online ? "text-emerald-400" : "text-muted-foreground"}`}
                            >
                              {row.online ? "Online" : "Offline"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          <span className="inline-flex items-center gap-1.5">
                            <Users className="size-3.5 text-muted-foreground" /> {row.openTables}
                          </span>
                        </TableCell>
                        <TableCell>
                          {row.active ? (
                            <Badge className="bg-emerald-600 text-[10px]">Active</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">
                              Deactivated
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage && (
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditing(row)}
                                aria-label={`Edit ${row.user.full_name}`}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void resetPassword(row)}
                                title="Email a password reset link"
                              >
                                <KeyRound className="size-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className={row.active ? "text-rose-300 hover:text-rose-200" : ""}
                                onClick={() => void toggleActive(row)}
                                disabled={busy === row.user.uid}
                                title={
                                  row.active ? "Deactivate — hands their tables over" : "Reactivate"
                                }
                              >
                                <Power className="size-3.5" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {rows.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-10 text-center text-sm text-muted-foreground"
                        >
                          No waiters yet.
                          {canManage && " Add one to start assigning tables automatically."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <WaiterFormDialog
        open={adding || editing !== null}
        row={editing}
        restaurantId={restaurantId}
        branches={branches}
        actor={actor}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      />
    </>
  );
}

function WaiterFormDialog({
  open,
  row,
  restaurantId,
  branches,
  actor,
  onClose,
}: {
  open: boolean;
  /** The waiter being edited, or null when adding one. */
  row: WaiterRow | null;
  restaurantId: string;
  branches: RestaurantBranch[];
  actor: StaffActor;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [branch, setBranch] = useState(ALL_BRANCHES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(row?.user.full_name ?? "");
    setEmail(row?.user.email ?? "");
    setPhone(row?.user.phone ?? "");
    setPassword(row ? "" : generateRestaurantUserPassword());
    setBranch(row?.roster?.branch_id ?? row?.user.branch_id ?? ALL_BRANCHES);
    setError(null);
    setCreated(null);
  }, [open, row?.user.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchId = branch === ALL_BRANCHES ? null : branch;
  const branchName = branchId ? (branches.find((b) => b.id === branchId)?.name ?? null) : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (row) {
        await updateWaiter({
          restaurant_id: restaurantId,
          uid: row.user.uid,
          full_name: name,
          phone: phone || null,
          branch_id: branchId,
          branch_name: branchName,
        });
        toast.success(`${name} saved.`);
        onClose();
        return;
      }
      if (!email.trim()) throw new Error("Enter the waiter's email — they sign in with it.");
      if (password.length < 8) throw new Error("Use a password of at least 8 characters.");
      const result = await createWaiter({
        restaurant_id: restaurantId,
        full_name: name,
        email,
        password,
        phone: phone || null,
        branch_id: branchId,
        branch_name: branchName,
        actorEmail: actor.email,
      });
      if (!result.ok) throw new Error(result.error);
      toast.success(`${name} added.`);
      setCreated({ email: email.trim().toLowerCase(), password });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the waiter.");
    } finally {
      setSaving(false);
    }
  }

  const waiterScreen =
    typeof window !== "undefined" ? `${window.location.origin}/waiter` : "/waiter";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {row ? `Edit ${row.user.full_name}` : created ? "Waiter added" : "Add waiter"}
          </DialogTitle>
          <DialogDescription>
            {created
              ? "Share these details with the waiter. The password isn't shown again."
              : "Waiters sign in on the Waiter screen and get tables at their branch automatically while on shift."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3 text-sm">
            {[
              ["Sign in at", waiterScreen],
              ["Email", created.email],
              ["Password", created.password],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2"
              >
                <span className="text-muted-foreground">{k}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-xs">{v}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(v!)
                        .then(() => toast.success(`${k} copied`))
                    }
                    aria-label={`Copy ${k}`}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </span>
              </div>
            ))}
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form id="waiter-form" className="space-y-4" onSubmit={(e) => void submit(e)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="waiter-name">Full name</Label>
                <Input
                  id="waiter-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="waiter-phone">Phone (optional)</Label>
                <Input id="waiter-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            {!row && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="waiter-email">Email (their sign-in)</Label>
                  <Input
                    id="waiter-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="waiter-password">Password</Label>
                  <div className="flex gap-1.5">
                    <Input
                      id="waiter-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setPassword(generateRestaurantUserPassword())}
                      aria-label="Generate a password"
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="waiter-branch">Branch</Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger id="waiter-branch">
                  <SelectValue />
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
              <p className="text-xs text-muted-foreground">
                {branchId
                  ? "Only gets tables at this branch."
                  : "Can be given a table at any branch of the restaurant."}
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 size-4" />
                )}
                {row ? "Save" : "Add waiter"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
