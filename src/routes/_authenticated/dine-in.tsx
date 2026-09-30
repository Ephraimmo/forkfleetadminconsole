import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import { Armchair, BellRing, ChefHat, ConciergeBell, QrCode, Search, Utensils } from "lucide-react";

import { AwaitingConfirmationCard } from "@/components/dine-in/awaiting-confirmation-card";
import { DineInActionsProvider } from "@/components/dine-in/dine-in-order-actions";
import { DineInOrderDialog } from "@/components/dine-in/dine-in-order-dialog";
import { DineInStatusBadge } from "@/components/dine-in/dine-in-status-badge";
import { WaiterRequestCard } from "@/components/dine-in/waiter-request-card";
import { PermissionGate } from "@/components/permission-gate";
import { OrderModeBadge } from "@/components/restaurants/tables-manager";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWaiterRequests } from "@/hooks/use-waiter-requests";
import { onOrdersChanged, type DispatchOrder } from "@/lib/dispatch.functions";
import {
  customerSessionLabel,
  dineInStatusLabel,
  filterDineInOrders,
  isAwaitingWaiterConfirmation,
  isWithWaiter,
  OPEN_DINE_IN_STATUSES,
} from "@/lib/dine-in";
import type { OrderStatus } from "@/lib/orders.firebase";
import { activeWaiterRequests } from "@/lib/waiter-requests.firebase";

export const Route = createFileRoute("/_authenticated/dine-in")({
  // `order` opens that order's details — e.g. from an "Order Ready" alert.
  validateSearch: (search: Record<string, unknown>): { order?: string } =>
    typeof search["order"] === "string" && search["order"] ? { order: search["order"] } : {},
  head: () => ({
    meta: [
      { title: "Dine-in orders — Hearth Admin" },
      {
        name: "description",
        content:
          "Orders placed at restaurant tables by QR code, waiter requests, and orders waiting for a waiter's confirmation.",
      },
      { property: "og:title", content: "Dine-in orders — Hearth Admin" },
      {
        property: "og:description",
        content: "Live dine-in orders by table, order mode, status and waiter.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DineInOrdersPage,
});

// Legacy "pending" dine-in orders are included in "Waiting for waiter confirmation".
const STATUS_FILTERS: OrderStatus[] = [
  ...OPEN_DINE_IN_STATUSES.filter((s) => s !== "pending"),
  "delivered",
  "rejected",
  "cancelled",
  "refunded",
];

function DineInOrdersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [restaurantId, setRestaurantId] = useState("all");

  // The whole live order book (listOrders() caps at the newest 500 of every
  // type, which could hide dine-in orders on a busy day).
  const [allOrders, setAllOrders] = useState<DispatchOrder[]>([]);
  useEffect(() => onOrdersChanged(setAllOrders), []);
  const requests = useWaiterRequests({ notify: true });
  const navigate = useNavigate();
  const selectedId = Route.useSearch().order ?? null;
  const setSelectedId = (id: string | null) =>
    void navigate({ to: "/dine-in", search: id ? { order: id } : {}, replace: true });

  const dineIn = useMemo(() => filterDineInOrders(allOrders), [allOrders]);
  const restaurants = useMemo(() => {
    const byId = new Map<string, string>();
    for (const o of dineIn) byId.set(o.restaurant_id, o.restaurant_name);
    for (const r of requests.rows) {
      if (!byId.has(r.restaurant_id))
        byId.set(r.restaurant_id, r.restaurant_name ?? r.restaurant_id);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [dineIn, requests.rows]);
  const rows = useMemo(
    () => filterDineInOrders(dineIn, { restaurantId, status, search }),
    [dineIn, restaurantId, status, search],
  );
  // The waiter's queues follow the restaurant filter only, longest-waiting first.
  const waiting = useMemo(
    () =>
      filterDineInOrders(dineIn, { restaurantId })
        .filter((o) => isWithWaiter(o.status))
        .reverse(),
    [dineIn, restaurantId],
  );
  const readyToServe = useMemo(
    () =>
      filterDineInOrders(dineIn, { restaurantId, status: "ready" }).sort((a, b) =>
        (a.ready_at ?? a.placed_at).localeCompare(b.ready_at ?? b.placed_at),
      ),
    [dineIn, restaurantId],
  );
  const calls = useMemo(
    () => activeWaiterRequests(requests.rows, { restaurantId }),
    [requests.rows, restaurantId],
  );
  const orderNumbers = useMemo(
    () => new Map(allOrders.map((o) => [o.id, o.order_number])),
    [allOrders],
  );
  const selected = selectedId ? (allOrders.find((o) => o.id === selectedId) ?? null) : null;
  const multiRestaurant = restaurants.length > 1;

  const count = (s: OrderStatus) => dineIn.filter((o) => o.status === s).length;
  const openCount = dineIn.filter((o) => OPEN_DINE_IN_STATUSES.includes(o.status)).length;
  const waitingCount = dineIn.filter((o) => isAwaitingWaiterConfirmation(o.status)).length;
  const openCalls = activeWaiterRequests(requests.rows).filter((r) => r.status === "open").length;

  return (
    <PermissionGate
      required={["orders.view", "orders.manage"]}
      breadcrumb={["Operations", "Dine-in orders"]}
      title="Dine-in orders"
      description="Orders placed at a table by scanning its QR code, and guests calling for a waiter. A guest's order goes to the kitchen only after a waiter confirms it with the table and sends it, and the waiter marks it served once the kitchen has it ready."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link to="/tables">
              <Armchair className="mr-2 size-4" /> Table overview
            </Link>
          </Button>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Order, table or guest"
              className="w-48 pl-8"
            />
          </div>
          {restaurants.length > 1 && (
            <Select value={restaurantId} onValueChange={setRestaurantId}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All restaurants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All restaurants</SelectItem>
                {restaurants.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open orders</SelectItem>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {dineInStatusLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {(staff) => {
        const canManage = staff.hasPermission("orders.manage");
        return (
          <DineInActionsProvider>
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                <Stat label="Waiter requests" value={openCalls} highlight={openCalls > 0} />
                <Stat
                  label="Waiting for waiter confirmation"
                  value={waitingCount}
                  highlight={waitingCount > 0}
                />
                <Stat label="Open dine-in orders" value={openCount} />
                <Stat label="Preparing" value={count("preparing")} />
                <Stat
                  label="Ready to serve"
                  value={count("ready")}
                  highlight={count("ready") > 0}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <BellRing className="size-4 text-amber-300" /> Waiter requests
                    </CardTitle>
                    <CardDescription>
                      Guests who pressed &ldquo;Request waiter&rdquo;. Accept to let others know
                      you&apos;re on it; resolve once they&apos;ve been helped.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {requests.error ? (
                      <p className="text-sm text-destructive">{requests.error}</p>
                    ) : calls.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        {requests.loading ? "Loading…" : "No guests are waiting for a waiter."}
                      </p>
                    ) : (
                      calls.map((request) => (
                        <WaiterRequestCard
                          key={request.id}
                          request={request}
                          canManage={canManage}
                          showRestaurant={multiRestaurant}
                          orderNumber={request.order_id ? orderNumbers.get(request.order_id) : null}
                        />
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Utensils className="size-4 text-emerald-300" /> Ready to serve
                    </CardTitle>
                    <CardDescription>
                      The kitchen has finished these. Take them to the table, then mark them served.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {readyToServe.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        Nothing is waiting to be served.
                      </p>
                    ) : (
                      readyToServe.map((order) => (
                        <AwaitingConfirmationCard
                          key={order.id}
                          order={order}
                          canManage={canManage}
                          showRestaurant={multiRestaurant}
                          onOpen={() => setSelectedId(order.id)}
                        />
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ChefHat className="size-4 text-fuchsia-300" /> Confirm &amp; send to kitchen
                    </CardTitle>
                    <CardDescription>
                      Orders from the table don&apos;t reach the kitchen until a waiter confirms
                      them with the guests and sends them. Edit anything the guest chose first, if
                      needed.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {waiting.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        Nothing is waiting for the waiter.
                      </p>
                    ) : (
                      waiting.map((order) => (
                        <AwaitingConfirmationCard
                          key={order.id}
                          order={order}
                          canManage={canManage}
                          showRestaurant={multiRestaurant}
                          onOpen={() => setSelectedId(order.id)}
                        />
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ConciergeBell className="size-4" /> {rows.length} dine-in order
                    {rows.length === 1 ? "" : "s"}
                  </CardTitle>
                  <CardDescription>
                    Live from the order book. Select an order to see its items, modifiers, notes and
                    history. Kitchen progress happens on the Kitchen page, as for any other order.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Order</TableHead>
                          <TableHead>Table</TableHead>
                          <TableHead>Order mode</TableHead>
                          <TableHead>Customer / session</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Waiter</TableHead>
                          <TableHead className="text-right">Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((order) => (
                          <DineInRow
                            key={order.id}
                            order={order}
                            onOpen={() => setSelectedId(order.id)}
                          />
                        ))}
                        {rows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={7} className="py-12 text-center">
                              <QrCode className="mx-auto mb-2 size-7 text-muted-foreground" />
                              <p className="text-sm text-muted-foreground">
                                {dineIn.length === 0
                                  ? "No dine-in orders yet. When guests order by scanning a table's QR code, their orders appear here."
                                  : "No dine-in orders match these filters."}
                              </p>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <DineInOrderDialog
                order={selected}
                canManage={canManage}
                onClose={() => setSelectedId(null)}
              />
            </div>
          </DineInActionsProvider>
        );
      }}
    </PermissionGate>
  );
}

function DineInRow({ order, onOpen }: { order: DispatchOrder; onOpen: () => void }) {
  const who = customerSessionLabel(order);
  const created = new Date(order.created_at || order.placed_at);
  const validDate = !Number.isNaN(created.getTime());
  return (
    <TableRow
      className="cursor-pointer"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      aria-label={`Order ${order.order_number} — view details`}
    >
      <TableCell>
        <p className="font-medium">
          {order.order_number}
          {(order.dine_in?.round ?? 1) > 1 && (
            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
              Round {order.dine_in!.round}
            </span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground">{order.restaurant_name}</p>
      </TableCell>
      <TableCell className="font-medium">{order.dine_in?.table_label ?? "—"}</TableCell>
      <TableCell>
        {order.dine_in ? (
          <OrderModeBadge mode={order.dine_in.order_mode} />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        <p>{who.primary}</p>
        {who.secondary && <p className="text-[11px] text-muted-foreground">{who.secondary}</p>}
      </TableCell>
      <TableCell>
        <DineInStatusBadge status={order.status} />
        {order.payment_status === "paid" ? (
          <p className="mt-1 text-[11px] text-emerald-400">
            Paid{order.dine_in?.paid_with ? ` · ${order.dine_in.paid_with}` : ""}
          </p>
        ) : (
          !["rejected", "cancelled", "refunded"].includes(order.status) && (
            <p className="mt-1 text-[11px] text-muted-foreground">Unpaid</p>
          )
        )}
      </TableCell>
      <TableCell className={order.dine_in?.waiter_name ? "" : "text-muted-foreground"}>
        {order.dine_in?.waiter_name ?? "Waiting for a waiter"}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right text-xs">
        {validDate ? (
          <>
            <p className="tabular-nums">{format(created, "d MMM, HH:mm")}</p>
            <p className="text-muted-foreground">
              {formatDistanceToNow(created, { addSuffix: true })}
            </p>
          </>
        ) : (
          "—"
        )}
      </TableCell>
    </TableRow>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-amber-500/40" : ""}>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
