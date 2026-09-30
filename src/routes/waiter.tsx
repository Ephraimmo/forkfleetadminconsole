// The Waiter screen — a waiter's phone or tablet during service.
//
// A waiter (a restaurant login with the "waiter" role, created on the
// restaurant's Waiters tab) signs in, goes online, and from then on is given
// tables automatically: each new seating at their branch goes to the next
// online waiter in turn and stays with them (src/lib/waiters.firebase.ts).
// For each of their tables they:
//   1. review and edit what the guests ordered (add or remove items),
//   2. confirm it with the table, and send it to the kitchen,
//   3. get an "Order Ready" alert when the kitchen is done, and serve it,
//   4. take payment — any time after confirming the order.
// Going offline hands their open tables to the next online waiter.

import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { BellRing, ChefHat, Hand, Loader2, LogOut, Users } from "lucide-react";

import {
  DineInActionsProvider,
  DineInOrderActions,
} from "@/components/dine-in/dine-in-order-actions";
import { DineInStatusBadge } from "@/components/dine-in/dine-in-status-badge";
import { WaiterRequestCard } from "@/components/dine-in/waiter-request-card";
import { HearthLogo } from "@/components/hearth-logo";
import { OrderModeBadge } from "@/components/restaurants/tables-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAutoAssignWaiters } from "@/hooks/use-auto-assign-waiters";
import { useWaiterRequests } from "@/hooks/use-waiter-requests";
import { customerSessionLabel, readyOrderAlerts, type StaffActor } from "@/lib/dine-in";
import { hasOrderSnapshot, onOrdersChanged, type DispatchOrder } from "@/lib/dispatch.functions";
import { fsGet } from "@/lib/firestore";
import {
  signInRestaurantUserWithFirebase,
  signOutRestaurantUser,
  watchRestaurantUser,
  type RestaurantUserRecord,
} from "@/lib/restaurant-users.firebase";
import {
  isSessionIdle,
  subscribeTables,
  tableDisplayName,
  type RestaurantTable,
} from "@/lib/tables.firebase";
import { isActiveWaiterRequest } from "@/lib/waiter-requests.firebase";
import {
  assignSeatingWaiter,
  setWaiterOnline,
  subscribeWaiterRoster,
  waiterCoversBranch,
  type WaiterRoster,
} from "@/lib/waiters.firebase";

export const Route = createFileRoute("/waiter")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Waiter — Hearth" },
      { name: "description", content: "Your tables, orders and alerts during service." },
    ],
  }),
  component: WaiterPage,
});

/** Orders that no longer need the waiter once paid: served, rejected, cancelled. */
const DONE_STATUSES = ["delivered", "rejected", "cancelled", "refunded"];

function WaiterPage() {
  const [user, setUser] = useState<RestaurantUserRecord | null | undefined>(undefined);
  const [authUid, setAuthUid] = useState<string | null>(null);
  useEffect(
    () =>
      watchRestaurantUser((record, uid) => {
        setUser(record);
        setAuthUid(uid);
      }),
    [],
  );

  if (user === undefined) {
    return (
      <Shell>
        <Skeleton className="h-48 w-full" />
      </Shell>
    );
  }
  if (!user) return <SignIn signedInWithoutAccess={authUid !== null} />;
  if (user.role !== "waiter") {
    return (
      <Shell>
        <Card>
          <CardContent className="space-y-3 py-8 text-center text-sm">
            <p>
              This screen is for waiters. {user.email} is a {user.role.replace(/_/g, " ")} account.
            </p>
            <Button variant="outline" onClick={() => void signOutRestaurantUser()}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }
  if (user.status !== "active") {
    return (
      <Shell>
        <Card>
          <CardContent className="space-y-3 py-8 text-center text-sm">
            <p>Your waiter account is deactivated. Ask your manager to reactivate it.</p>
            <Button variant="outline" onClick={() => void signOutRestaurantUser()}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }
  return <WaiterService user={user} />;
}

function Shell({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <HearthLogo className="h-7" />
            <span className="text-sm font-medium text-muted-foreground">Waiter</span>
          </div>
          {header}
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-4">{children}</main>
    </div>
  );
}

function SignIn({ signedInWithoutAccess }: { signedInWithoutAccess: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signInRestaurantUserWithFirebase({ email, password });
    setBusy(false);
    if (!result.ok) setError(result.message);
    // On success watchRestaurantUser() picks the waiter up.
  }

  return (
    <Shell>
      <Card className="mx-auto max-w-sm">
        <CardHeader>
          <CardTitle>Waiter sign in</CardTitle>
          <CardDescription>Use the email and password your manager gave you.</CardDescription>
        </CardHeader>
        <CardContent>
          {signedInWithoutAccess && (
            <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
              This browser is signed in with an account that isn&apos;t a waiter. Sign in with your
              waiter account.
            </p>
          )}
          <form className="space-y-3" onSubmit={(e) => void submit(e)}>
            <div className="space-y-1.5">
              <Label htmlFor="waiter-email">Email</Label>
              <Input
                id="waiter-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="waiter-password">Password</Label>
              <Input
                id="waiter-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !email || !password}>
              {busy && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}

function WaiterService({ user }: { user: RestaurantUserRecord }) {
  const restaurantId = user.restaurant_id;
  const actor = useMemo<StaffActor>(
    () => ({ id: user.uid, email: user.email, name: user.full_name || user.email }),
    [user.uid, user.email, user.full_name],
  );

  const [restaurantName, setRestaurantName] = useState("");
  useEffect(() => {
    void fsGet<{ name?: string }>(`restaurants/${restaurantId}`)
      .then((r) => setRestaurantName(r?.name ?? ""))
      .catch(() => {});
  }, [restaurantId]);

  const [tables, setTables] = useState<RestaurantTable[] | null>(null);
  const [roster, setRoster] = useState<WaiterRoster | null>(null);
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  useEffect(() => subscribeTables(restaurantId, setTables), [restaurantId]);
  useEffect(() => subscribeWaiterRoster(restaurantId, setRoster), [restaurantId]);
  useEffect(() => onOrdersChanged(setOrders), []);
  const requests = useWaiterRequests();

  const me = roster?.waiters[user.uid] ?? null;
  const online = Boolean(me?.online);
  const branchId = me?.branch_id ?? user.branch_id;
  const branchLabel = me?.branch_name ?? (branchId ? branchId : "All branches");

  // While this waiter is on shift, this device hands out tables that need a waiter.
  useAutoAssignWaiters(restaurantId, tables, roster, online);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const myTables = useMemo(
    () =>
      (tables ?? [])
        .filter((t) => t.session?.waiter_id === user.uid && !isSessionIdle(t.session, now))
        .sort((a, b) => (a.session!.opened_at < b.session!.opened_at ? -1 : 1)),
    [tables, user.uid, now],
  );
  const mySessions = useMemo(() => new Set(myTables.map((t) => t.session!.id)), [myTables]);
  const myOrders = useMemo(
    () =>
      orders
        .filter(
          (o) =>
            o.order_type === "dine_in" &&
            o.restaurant_id === restaurantId &&
            (mySessions.has(o.dine_in?.table_session_id ?? "") ||
              o.dine_in?.waiter_id === user.uid),
        )
        .filter((o) => !DONE_STATUSES.includes(o.status) || o.payment_status !== "paid")
        .filter((o) => !["rejected", "cancelled", "refunded"].includes(o.status)),
    [orders, restaurantId, mySessions, user.uid],
  );
  const waiting = useMemo(
    () =>
      (tables ?? []).filter(
        (t) =>
          t.session &&
          !t.session.waiter_id &&
          !isSessionIdle(t.session, now) &&
          waiterCoversBranch({ branch_id: branchId }, t.branch_id),
      ),
    [tables, branchId, now],
  );
  const myCalls = requests.rows.filter(
    (r) =>
      isActiveWaiterRequest(r) &&
      r.restaurant_id === restaurantId &&
      mySessions.has(r.table_session_id),
  );

  useWaiterAlerts(tables !== null, myTables, myOrders);

  const [switching, setSwitching] = useState(false);
  async function toggleOnline(next: boolean) {
    setSwitching(true);
    try {
      const result = await setWaiterOnline({
        restaurant_id: restaurantId,
        waiter: {
          uid: user.uid,
          name: me?.name ?? (user.full_name || user.email),
          branch_id: branchId,
          branch_name: me?.branch_name ?? null,
        },
        online: next,
        actor,
      });
      toast.success(
        next
          ? `You're online — new tables come to you${result.tables_assigned ? ` (${result.tables_assigned} waiting table(s) assigned)` : ""}.`
          : `You're offline${result.tables_moved ? ` — ${result.tables_moved} table(s) handed to the next waiter` : ""}.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change your shift.");
    } finally {
      setSwitching(false);
    }
  }

  async function takeTable(table: RestaurantTable) {
    try {
      await assignSeatingWaiter({
        restaurant_id: restaurantId,
        table_id: table.id,
        session_id: table.session!.id,
        waiter_id: user.uid,
        actor,
      });
      toast.success(`${tableDisplayName(table.label)} is yours.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not take the table.");
    }
  }

  const toConfirm = myOrders.filter(
    (o) => o.status === "waiting_for_waiter_confirmation" || o.status === "pending",
  ).length;
  const ready = myOrders.filter((o) => o.status === "ready");
  const unpaid = myOrders.filter((o) => o.payment_status !== "paid").length;

  return (
    <Shell
      header={
        <div className="flex items-center gap-3">
          <div className="text-right leading-tight">
            <p className="text-sm font-medium">{user.full_name || user.email}</p>
            <p className="text-[11px] text-muted-foreground">
              {restaurantName || "Restaurant"} · {branchLabel}
            </p>
          </div>
          <label className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
            <Switch
              checked={online}
              disabled={switching || roster === null}
              onCheckedChange={(v) => void toggleOnline(v)}
            />
            <span
              className={`text-xs font-medium ${online ? "text-emerald-400" : "text-muted-foreground"}`}
            >
              {online ? "Online" : "Offline"}
            </span>
          </label>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void signOutRestaurantUser()}
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      }
    >
      <DineInActionsProvider actor={actor}>
        {!online && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            You&apos;re offline, so you won&apos;t get new tables. Switch to <b>Online</b> when your
            shift starts.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="My tables" value={myTables.length} />
          <Stat label="To confirm" value={toConfirm} tone={toConfirm ? "text-fuchsia-300" : ""} />
          <Stat
            label="Ready to serve"
            value={ready.length}
            tone={ready.length ? "text-emerald-300" : ""}
          />
          <Stat label="Unpaid" value={unpaid} />
        </div>

        {ready.length > 0 && (
          <Card className="border-emerald-500/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-emerald-300">
                <ChefHat className="size-4" /> Ready to serve
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {ready.map((o) => (
                <div
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5"
                >
                  <span className="text-sm font-medium">
                    {tableDisplayName(o.dine_in?.table_label ?? "—")} · {o.order_number}
                  </span>
                  <DineInOrderActions order={o} compact />
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {myCalls.length > 0 && (
          <div className="space-y-2">
            {myCalls.map((r) => (
              <WaiterRequestCard key={r.id} request={r} canManage actor={actor} />
            ))}
          </div>
        )}

        {online && waiting.length > 0 && (
          <Card className="border-amber-500/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Hand className="size-4" /> Waiting for a waiter
              </CardTitle>
              <CardDescription>These tables have guests but no waiter yet.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {waiting.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm"
                >
                  <span>
                    {tableDisplayName(t.label)}
                    {t.branch_name ? (
                      <span className="text-muted-foreground"> · {t.branch_name}</span>
                    ) : null}
                  </span>
                  <Button size="sm" onClick={() => void takeTable(t)}>
                    Take table
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">My tables</h2>
          {tables === null ? (
            <Skeleton className="h-40 w-full" />
          ) : myTables.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {online
                  ? "No tables yet — new tables come to you automatically."
                  : "Go online to start getting tables."}
              </CardContent>
            </Card>
          ) : (
            myTables.map((table) => (
              <TableCard
                key={table.id}
                table={table}
                orders={myOrders.filter((o) => o.dine_in?.table_session_id === table.session!.id)}
              />
            ))
          )}
        </section>
      </DineInActionsProvider>
    </Shell>
  );
}

function TableCard({ table, orders }: { table: RestaurantTable; orders: DispatchOrder[] }) {
  const session = table.session!;
  const sorted = [...orders].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg">{tableDisplayName(table.label)}</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-1.5">
              <OrderModeBadge mode={session.order_mode} />
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" /> {Object.keys(session.guests).length}
              </span>
              · seated {formatDistanceToNow(new Date(session.opened_at), { addSuffix: true })}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {sorted.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No orders yet — the guests are still choosing.
          </p>
        )}
        {sorted.map((order) => {
          const who = customerSessionLabel(order);
          return (
            <div key={order.id} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">
                    {order.order_number}{" "}
                    <span className="font-normal text-muted-foreground">· {who.primary}</span>
                  </p>
                  {who.secondary && (
                    <p className="text-[11px] text-muted-foreground">{who.secondary}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <DineInStatusBadge status={order.status} className="text-[10px]" />
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${order.payment_status === "paid" ? "border-emerald-500/40 text-emerald-300" : "text-muted-foreground"}`}
                  >
                    {order.payment_status === "paid" ? "Paid" : "Unpaid"}
                  </Badge>
                </div>
              </div>
              <ul className="space-y-0.5 text-xs">
                {order.items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span>
                      {item.quantity}× {item.item_name}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      R {item.line_total.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                <span className="text-sm font-semibold tabular-nums">
                  R {order.total.toFixed(2)}
                </span>
                <DineInOrderActions order={order} compact />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Toasts for this waiter only: a new table assigned to them, and an order the kitchen has finished. */
function useWaiterAlerts(
  tablesLoaded: boolean,
  myTables: RestaurantTable[],
  myOrders: DispatchOrder[],
) {
  const seenTables = useRef<Set<string> | null>(null);
  const seenReady = useRef<Set<string> | null>(null);

  useEffect(() => {
    // The first loaded list only takes stock: those tables were already theirs.
    if (!tablesLoaded) return;
    const ids = new Set(myTables.map((t) => t.session!.id));
    if (seenTables.current) {
      for (const t of myTables) {
        if (!seenTables.current.has(t.session!.id)) {
          toast(`🪑 New table — ${tableDisplayName(t.label)}`, {
            description: "It's yours. Greet the guests and check their order.",
            duration: 10_000,
          });
        }
      }
    }
    seenTables.current = ids;
  }, [tablesLoaded, myTables]);

  useEffect(() => {
    if (!hasOrderSnapshot()) return;
    const { ready, alerts } = readyOrderAlerts(seenReady.current, myOrders);
    seenReady.current = ready;
    for (const order of alerts) {
      toast("🔔 Order Ready", {
        id: `waiter-ready-${order.id}`,
        description: `${tableDisplayName(order.dine_in?.table_label ?? "—")} · Order ${order.order_number}`,
        duration: Number.POSITIVE_INFINITY,
        closeButton: true,
        icon: <BellRing className="size-4" />,
      });
    }
  }, [myOrders]);
}

function Stat({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <CardHeader className="p-3">
        <CardDescription className="text-xs">{label}</CardDescription>
        <CardTitle className={`text-2xl tabular-nums ${tone}`}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
