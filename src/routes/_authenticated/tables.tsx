import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Armchair, ConciergeBell, Loader2, Settings2, Users } from "lucide-react";

import {
  DineInActionsProvider,
  DineInOrderActions,
} from "@/components/dine-in/dine-in-order-actions";
import { DineInStatusBadge } from "@/components/dine-in/dine-in-status-badge";
import { WaiterRequestCard } from "@/components/dine-in/waiter-request-card";
import { PermissionGate } from "@/components/permission-gate";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useFirebaseRestaurants } from "@/hooks/use-firebase-restaurants";
import { useWaiterRequests } from "@/hooks/use-waiter-requests";
import { onOrdersChanged, type DispatchOrder } from "@/lib/dispatch.functions";
import {
  buildTableOverview,
  OCCUPANCY_LABEL,
  SERVICE_LABEL,
  summarizeOverview,
  type OverviewOrder,
  type TableOccupancy,
  type TableOverview,
  type TableService,
} from "@/lib/table-overview";
import { closeTableSession } from "@/lib/table-sessions.firebase";
import { useAutoAssignWaiters } from "@/hooks/use-auto-assign-waiters";
import type { StaffActor } from "@/lib/dine-in";
import {
  assignSeatingWaiter,
  subscribeWaiterRoster,
  waiterCoversBranch,
  type RosterWaiter,
  type WaiterRoster,
} from "@/lib/waiters.firebase";
import {
  subscribeTables,
  tableDisplayName,
  type RestaurantTable,
  type TableOrderMode,
} from "@/lib/tables.firebase";

export const Route = createFileRoute("/_authenticated/tables")({
  // Optional: without it the first restaurant is shown.
  validateSearch: (search: Record<string, unknown>): { restaurant?: string } =>
    typeof search["restaurant"] === "string" && search["restaurant"]
      ? { restaurant: search["restaurant"] }
      : {},
  head: () => ({
    meta: [
      { title: "Table overview — Hearth Admin" },
      {
        name: "description",
        content:
          "Live status of every dine-in table: who's seated, their orders, how they're going and who's asked for a waiter.",
      },
      { property: "og:title", content: "Table overview — Hearth Admin" },
      {
        property: "og:description",
        content: "Occupied and available tables with their active dine-in orders, live.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TableOverviewPage,
});

const MODE_LABEL: Record<TableOrderMode, string> = {
  single: "Single Order",
  multiple: "Multiple Orders",
};

const OCCUPANCY_TONE: Record<TableOccupancy, string> = {
  occupied: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  available: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  inactive: "border-border bg-muted text-muted-foreground",
};

function TableOverviewPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { rows, loading: restaurantsLoading } = useFirebaseRestaurants();
  const restaurants = useMemo(() => [...rows].sort((a, b) => a.name.localeCompare(b.name)), [rows]);
  const restaurantId = search.restaurant || restaurants[0]?.id || "";
  const restaurant = restaurants.find((r) => r.id === restaurantId) ?? null;

  const [tables, setTables] = useState<RestaurantTable[] | null>(null);
  const [tablesError, setTablesError] = useState<string | null>(null);
  useEffect(() => {
    setTables(null);
    setTablesError(null);
    if (!restaurantId) return;
    return subscribeTables(restaurantId, setTables, setTablesError);
  }, [restaurantId]);

  // Waiters on shift, and — while this page is open — handing each new seating
  // to the next one in turn.
  const [roster, setRoster] = useState<WaiterRoster | null>(null);
  useEffect(() => {
    setRoster(null);
    if (!restaurantId) return;
    return subscribeWaiterRoster(restaurantId, setRoster);
  }, [restaurantId]);
  useAutoAssignWaiters(restaurantId || null, tables, roster);

  // The whole live order book — the overview picks out each table's seating.
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  useEffect(() => onOrdersChanged(setOrders), []);
  const requests = useWaiterRequests({ notify: true });
  const orderNumbers = useMemo(() => new Map(orders.map((o) => [o.id, o.order_number])), [orders]);
  const ordersById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  // Idle seatings and "seated for" times depend on the clock, not just data.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const entries = useMemo(
    () => (tables ? buildTableOverview(tables, orders, now, requests.rows) : []),
    [tables, orders, now, requests.rows],
  );
  const summary = summarizeOverview(entries);
  const [clearing, setClearing] = useState<TableOverview | null>(null);

  return (
    <PermissionGate
      required={["orders.view", "orders.manage"]}
      breadcrumb={["Operations", "Table overview"]}
      title="Table overview"
      description="Every table at a restaurant, live: who's seated, what they've ordered, how it's going and who's asked for a waiter."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={restaurantId}
            onValueChange={(id) => void navigate({ to: "/tables", search: { restaurant: id } })}
            disabled={restaurants.length === 0}
          >
            <SelectTrigger className="w-56">
              <SelectValue
                placeholder={restaurantsLoading ? "Loading restaurants…" : "Choose a restaurant"}
              />
            </SelectTrigger>
            <SelectContent>
              {restaurants.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild variant="outline">
            <Link to="/dine-in">
              <ConciergeBell className="mr-2 size-4" /> Dine-in orders
            </Link>
          </Button>
        </div>
      }
    >
      {(staff) => {
        const canManage = staff.hasPermission("orders.manage");
        if (restaurantsLoading && restaurants.length === 0)
          return <Skeleton className="h-64 w-full" />;
        if (!restaurant) {
          return (
            <EmptyCard>
              {restaurants.length === 0
                ? "No restaurants yet."
                : "That restaurant wasn't found — choose one above."}
            </EmptyCard>
          );
        }
        return (
          <DineInActionsProvider>
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                <Stat
                  label="Waiter requests"
                  value={String(summary.waiter_requests)}
                  highlight={summary.waiter_requests > 0}
                />
                <Stat
                  label="Occupied tables"
                  value={`${summary.occupied} of ${summary.tables - summary.inactive}`}
                />
                <Stat label="Available tables" value={String(summary.available)} />
                <Stat label="Active orders" value={String(summary.active_orders)} />
                <Stat label="Guests seated" value={String(summary.guests)} />
              </div>

              {tablesError ? (
                <EmptyCard tone="error">{tablesError}</EmptyCard>
              ) : tables === null ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-56 w-full" />
                  ))}
                </div>
              ) : entries.length === 0 ? (
                <EmptyCard>
                  <p>{restaurant.name} has no tables yet.</p>
                  <Button asChild variant="outline" className="mt-3">
                    <Link to="/restaurants/$id" params={{ id: restaurant.id }}>
                      <Settings2 className="mr-2 size-4" /> Set up tables
                    </Link>
                  </Button>
                </EmptyCard>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {entries.map((entry) => (
                    <TableCard
                      key={entry.table.id}
                      entry={entry}
                      canManage={canManage}
                      orderNumbers={orderNumbers}
                      ordersById={ordersById}
                      waiters={roster ? Object.values(roster.waiters) : []}
                      actor={{
                        id: staff.session?.userId ?? null,
                        email: staff.session?.email ?? null,
                        name: staff.session?.fullName ?? null,
                      }}
                      onClear={() => setClearing(entry)}
                    />
                  ))}
                </div>
              )}

              <ClearTableDialog
                entry={clearing}
                actor={staff.session?.email ?? null}
                onDone={() => setClearing(null)}
              />
            </div>
          </DineInActionsProvider>
        );
      }}
    </PermissionGate>
  );
}

const SERVICE_TONE: Record<TableService, string> = {
  ready_to_serve: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  with_waiter: "border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-300",
  in_kitchen: "border-amber-500/25 bg-amber-500/15 text-amber-300",
  served: "border-border bg-muted text-muted-foreground",
};

function TableCard({
  entry,
  canManage,
  orderNumbers,
  ordersById,
  waiters,
  actor,
  onClear,
}: {
  entry: TableOverview;
  canManage: boolean;
  orderNumbers: Map<string, string>;
  ordersById: Map<string, DispatchOrder>;
  /** The restaurant's roster, for reassigning the table. */
  waiters: RosterWaiter[];
  actor: StaffActor;
  onClear: () => void;
}) {
  const { table, status, mode, session } = entry;
  const multiple = mode === "multiple";
  const occupied = status === "occupied";
  const calling = entry.waiter_requests.some((r) => r.status === "open");
  return (
    <Card
      className={`flex flex-col ${calling ? "border-amber-400/60 shadow-[0_0_0_1px] shadow-amber-400/30" : occupied ? "border-amber-500/30" : ""} ${status === "inactive" ? "opacity-60" : ""}`}
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Armchair className="size-4 text-muted-foreground" />
          {tableDisplayName(table.label)}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-sm">
        {entry.waiter_requests.map((request) => (
          <WaiterRequestCard
            key={request.id}
            request={request}
            canManage={canManage}
            compact
            orderNumber={request.order_id ? orderNumbers.get(request.order_id) : null}
          />
        ))}
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
          <dt className="text-muted-foreground">Capacity</dt>
          <dd className="tabular-nums">{table.capacity}</dd>
          <dt className="text-muted-foreground">Mode</dt>
          <dd>
            {MODE_LABEL[mode]}
            {entry.next_mode && (
              <span className="block text-[11px] text-muted-foreground">
                {MODE_LABEL[entry.next_mode]} once cleared
              </span>
            )}
          </dd>
          {multiple ? (
            <>
              <dt className="text-muted-foreground">Active Orders</dt>
              <dd className="font-medium tabular-nums">{entry.active_orders.length}</dd>
            </>
          ) : (
            <>
              <dt className="text-muted-foreground">Active Order</dt>
              <dd className="font-medium">{entry.table_order?.order_number ?? "—"}</dd>
            </>
          )}
          {table.branch_name && (
            <>
              <dt className="text-muted-foreground">Branch</dt>
              <dd>{table.branch_name}</dd>
            </>
          )}
          {occupied && session && (
            <>
              <dt className="text-muted-foreground">Waiter</dt>
              <dd>
                <WaiterPicker
                  table={table}
                  sessionId={session.id}
                  waiterId={session.waiter_id}
                  waiterName={session.waiter_name}
                  waiters={waiters}
                  canManage={canManage}
                  actor={actor}
                />
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <Badge variant="outline" className={OCCUPANCY_TONE[status]}>
              {OCCUPANCY_LABEL[status]}
            </Badge>
          </dd>
          {entry.service && (
            <>
              <dt className="text-muted-foreground">Service</dt>
              <dd>
                <Badge variant="outline" className={SERVICE_TONE[entry.service]}>
                  {SERVICE_LABEL[entry.service]}
                </Badge>
              </dd>
            </>
          )}
        </dl>

        {entry.ready_orders.length > 0 && (
          <ul className="space-y-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
            {entry.ready_orders.map((ready) => {
              const order = ordersById.get(ready.id);
              return (
                <li key={ready.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{ready.order_number}</span> ready
                    {multiple ? ` — ${ready.guest_label}` : ""}
                  </span>
                  {canManage && order && (
                    <DineInOrderActions order={order} compact className="shrink-0" />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {occupied && multiple && <GuestOrders orders={entry.orders} />}
        {occupied && !multiple && entry.table_order && (
          <SharedOrder
            order={entry.table_order}
            items={entry.item_summary}
            earlier={entry.orders}
          />
        )}
        {!occupied && (
          <p className="text-xs text-muted-foreground">
            {status === "inactive" ? "Switched off — not taking orders." : "No active orders."}
          </p>
        )}

        {occupied && session && (
          <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users className="size-3" /> {entry.guest_count} · seated{" "}
              {formatDistanceToNow(new Date(session.opened_at), { addSuffix: true })}
            </span>
            {canManage && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClear}>
                Clear table
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The seating's waiter, and — for managers — a way to hand the table to someone else. */
function WaiterPicker({
  table,
  sessionId,
  waiterId,
  waiterName,
  waiters,
  canManage,
  actor,
}: {
  table: RestaurantTable;
  sessionId: string;
  waiterId: string | null;
  waiterName: string | null;
  waiters: RosterWaiter[];
  canManage: boolean;
  actor: StaffActor;
}) {
  const [busy, setBusy] = useState(false);
  const choices = waiters
    .filter((w) => w.active && waiterCoversBranch(w, table.branch_id))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  if (!canManage || choices.length === 0) {
    return waiterId ? (
      <span>{waiterName ?? "Waiter"}</span>
    ) : (
      <span className="text-amber-300">Waiting for a waiter</span>
    );
  }
  return (
    <Select
      value={waiterId ?? ""}
      disabled={busy}
      onValueChange={(uid) => {
        setBusy(true);
        void assignSeatingWaiter({
          restaurant_id: table.restaurant_id,
          table_id: table.id,
          session_id: sessionId,
          waiter_id: uid,
          actor,
        })
          .then((o) => {
            if (o.status === "assigned")
              toast.success(`${tableDisplayName(table.label)} → ${o.waiter_name}`);
          })
          .catch((e: unknown) =>
            toast.error(e instanceof Error ? e.message : "Could not reassign the table."),
          )
          .finally(() => setBusy(false));
      }}
    >
      <SelectTrigger className={`h-7 text-xs ${waiterId ? "" : "text-amber-300"}`}>
        <SelectValue placeholder="Waiting for a waiter" />
      </SelectTrigger>
      <SelectContent>
        {choices.map((w) => (
          <SelectItem key={w.uid} value={w.uid}>
            {w.name}
            {w.online ? "" : " (offline)"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function GuestOrders({ orders }: { orders: OverviewOrder[] }) {
  return (
    <ul className="space-y-1.5 rounded-md border bg-muted/20 p-2 text-xs">
      {orders.map((order) => (
        <li
          key={order.id}
          className={`flex items-center justify-between gap-2 ${order.in_progress ? "" : "opacity-60"}`}
        >
          <span className="min-w-0 truncate">
            <span className="font-medium">{order.order_number}</span> — {order.guest_label}
          </span>
          <DineInStatusBadge status={order.status} className="shrink-0 text-[10px]" />
        </li>
      ))}
    </ul>
  );
}

function SharedOrder({
  order,
  items,
  earlier,
}: {
  order: OverviewOrder;
  items: { item_name: string; quantity: number }[];
  earlier: OverviewOrder[];
}) {
  const previous = earlier.filter((o) => o.id !== order.id);
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {order.order_number}
          {order.round > 1 && (
            <span className="ml-1 font-normal text-muted-foreground">· round {order.round}</span>
          )}
        </span>
        <DineInStatusBadge status={order.status} className="text-[10px]" />
      </div>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.item_name} className="flex justify-between gap-2">
            <span className="truncate">{item.item_name}</span>
            <span className="tabular-nums text-muted-foreground">× {item.quantity}</span>
          </li>
        ))}
      </ul>
      {order.contributors.length > 0 && (
        <p className="text-muted-foreground">
          {order.contributors.length === 1
            ? `Ordered by ${order.contributors[0]}`
            : `Shared by ${order.contributors.length} guests`}
        </p>
      )}
      {previous.length > 0 && (
        <p className="text-muted-foreground">
          Earlier this seating:{" "}
          {previous.map((o) => `${o.order_number} (${o.status_label})`).join(", ")}
        </p>
      )}
    </div>
  );
}

function ClearTableDialog({
  entry,
  actor,
  onDone,
}: {
  entry: TableOverview | null;
  actor: string | null;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const name = entry ? tableDisplayName(entry.table.label) : "";
  const inProgress = entry?.active_orders.length ?? 0;

  async function clear() {
    if (!entry?.session) return;
    setBusy(true);
    try {
      const cleared = await closeTableSession({
        restaurant_id: entry.table.restaurant_id,
        table_id: entry.table.id,
        session_id: entry.session.id,
        actor,
      });
      toast.success(cleared ? `${name} is clear and available.` : `${name} was already cleared.`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not clear the table.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={entry !== null} onOpenChange={(open) => !open && !busy && onDone()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Ends this seating once the guests have left. Their orders stay in the order book, and
            the next guest to scan the table&apos;s code starts a new seating.
            {inProgress > 0 && (
              <span className="mt-2 block font-medium text-amber-300">
                {inProgress} order{inProgress === 1 ? " is" : "s are"} still in progress — the
                kitchen keeps going, but {inProgress === 1 ? "it" : "they"} won&apos;t show on this
                table any more.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep seating</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void clear();
            }}
          >
            {busy && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Clear table
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EmptyCard({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <Card className={tone === "error" ? "border-destructive/30" : ""}>
      <CardContent
        className={`py-12 text-center text-sm ${tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
      >
        {children}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-amber-500/40" : ""}>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
