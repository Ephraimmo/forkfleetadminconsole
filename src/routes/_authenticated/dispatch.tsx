import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@/lib/use-demo-fn";
import { toast } from "sonner";
import {
  Bike,
  Clock,
  ExternalLink,
  FileText,
  MapPin,
  MessageSquare,
  PackageCheck,
  Radar,
  ShoppingBag,
  Truck,
  XCircle,
} from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import { OrderTypeBadge } from "@/components/order-type-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";

import {
  advanceDelivery,
  assignDriver,
  getAuditTrail,
  getDispatchBoard,
  type DispatchOrder,
  type OrderStatus,
} from "@/lib/dispatch.functions";
import {
  hasActiveAssignment,
  isApprovedDriver,
  subscribeActiveAssignments,
  type DriverAssignment,
} from "@/lib/drivers.firebase";
import { useDriverFleet } from "@/hooks/use-driver-fleet";
import { useFirebaseRestaurants } from "@/hooks/use-firebase-restaurants";

export const Route = createFileRoute("/_authenticated/dispatch")({
  head: () => ({
    meta: [
      { title: "Dispatch Board — ForkFleet Console" },
      {
        name: "description",
        content:
          "Assign ready orders to drivers, track pickups and ETAs live, and audit every delivery transition.",
      },
      { property: "og:title", content: "Dispatch Board — ForkFleet Console" },
      {
        property: "og:description",
        content: "Assign drivers, track pickups and ETAs, audit every transition.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DispatchPage,
});

const LANES: { key: OrderStatus; label: string; next: OrderStatus | null; icon: typeof Radar }[] = [
  { key: "ready", label: "Awaiting driver", next: null, icon: PackageCheck },
  { key: "assigned", label: "Driver assigned", next: "picked_up", icon: Bike },
  { key: "picked_up", label: "Picked up", next: "on_the_way", icon: Truck },
  { key: "on_the_way", label: "On the way", next: "delivered", icon: MapPin },
];

const nextLabel: Record<string, string> = {
  picked_up: "Mark picked up",
  on_the_way: "Mark on the way",
  delivered: "Mark delivered",
};

function DispatchPage() {
  const [restaurantId, setRestaurantId] = useState("all");
  const [assigning, setAssigning] = useState<DispatchOrder | null>(null);
  const [driverId, setDriverId] = useState("");
  const [eta, setEta] = useState("30");
  const [notesOrder, setNotesOrder] = useState<DispatchOrder | null>(null);
  const queryClient = useQueryClient();

  const fetchBoard = useServerFn(getDispatchBoard);

  const fetchAudit = useServerFn(getAuditTrail);
  const assign = useServerFn(assignDriver);
  const advance = useServerFn(advanceDelivery);

  const boardQuery = useQuery({
    queryKey: ["dispatch-board", restaurantId],
    queryFn: () => fetchBoard({ restaurantId }),
    refetchInterval: 20_000,
  });
  const fleet = useDriverFleet();
  const [activeAssignments, setActiveAssignments] = useState<DriverAssignment[]>([]);

  useEffect(() => {
    const unsub = subscribeActiveAssignments(setActiveAssignments);
    return unsub;
  }, []);
  const { rows: _fbRestaurants } = useFirebaseRestaurants();
  const restaurantsQuery = { data: _fbRestaurants, isLoading: false };
  const auditQuery = useQuery({
    queryKey: ["dispatch-audit"],
    queryFn: () => fetchAudit({ entityType: "order", limit: 25 }),
  });

  useRealtimeInvalidate(
    "dispatch-live",
    ["orders", "drivers"],
    ["dispatch-board", "drivers", "dispatch-audit"],
  );

  const assignMutation = useMutation({
    mutationFn: (vars: { orderId: string; driverId: string; etaMinutes?: number }) =>
      assign({ data: vars }),
    onSuccess: () => {
      toast.success("Driver assigned");
      setAssigning(null);
      setDriverId("");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const advanceMutation = useMutation({
    mutationFn: (vars: { orderId: string; nextStatus: OrderStatus }) => advance({ data: vars }),
    onSuccess: (_r, vars) => {
      toast.success(`Delivery ${vars.nextStatus.replace("_", " ")}`);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function invalidate() {
    for (const key of ["dispatch-board", "drivers", "dispatch-audit", "orders"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  // Delivery orders go through the driver lanes; customer-pickup orders get
  // their own lane (no driver — collected at the counter, then closed).
  const orders = useMemo(() => boardQuery.data ?? [], [boardQuery.data]);
  const deliveryOrders = useMemo(() => orders.filter((o) => o.order_type !== "pickup"), [orders]);
  const pickupOrders = useMemo(() => orders.filter((o) => o.order_type === "pickup"), [orders]);

  const activeOrdersByDriver = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of orders) {
      if (o.driver_id && ["assigned", "picked_up", "on_the_way"].includes(o.status)) {
        counts[o.driver_id] = (counts[o.driver_id] ?? 0) + 1;
      }
    }
    return counts;
  }, [orders]);

  // Only fully approved drivers (verified, not pending/suspended/rejected) who
  // hold an active assignment for the order's exact restaurant and branch are
  // eligible for assignment.
  const eligibleDrivers = useMemo(() => {
    if (!assigning) return [];
    return fleet.rows.filter(
      (d) =>
        isApprovedDriver(d) &&
        hasActiveAssignment(activeAssignments, d.id, assigning.restaurant_id, assigning.branch_id),
    );
  }, [assigning, fleet.rows, activeAssignments]);

  // Diagnostic counts shown when no driver is eligible, so the exact failing
  // condition is visible without digging through the console.
  const diagnostics = useMemo(() => {
    if (!assigning) return null;
    const approved = fleet.rows.filter((d) => isApprovedDriver(d));
    const assignedToRestaurant = approved.filter((d) =>
      hasActiveAssignment(activeAssignments, d.id, assigning.restaurant_id, null),
    );
    const assignedToBranch = assignedToRestaurant.filter((d) =>
      hasActiveAssignment(activeAssignments, d.id, assigning.restaurant_id, assigning.branch_id),
    );
    return {
      total: fleet.rows.length,
      approved: approved.length,
      assignedToRestaurant: assignedToRestaurant.length,
      assignedToBranch: assignedToBranch.length,
      restaurantId: assigning.restaurant_id ?? "—",
      branchId: assigning.branch_id ?? "—",
    };
  }, [assigning, fleet.rows, activeAssignments]);

  return (
    <PermissionGate
      required={["dispatch.view", "dispatch.manage"]}
      breadcrumb={["Operations", "Dispatch"]}
      title="Dispatch board"
      description="Assign ready orders, follow pickups and ETAs live, and keep a full audit trail."
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/live-map">
              <ExternalLink className="mr-1.5 size-3.5" /> Open live map
            </Link>
          </Button>
          <Select value={restaurantId} onValueChange={setRestaurantId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="All restaurants" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All restaurants</SelectItem>
              {(restaurantsQuery.data ?? []).map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {(staff) => {
        const canManage = staff.hasPermission("dispatch.manage");
        if (boardQuery.isLoading) return <Skeleton className="h-96 w-full" />;
        return (
          <div className="space-y-4">
            <Card className="border-dashed">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium">Live fleet map moved to its own screen</p>
                  <p className="text-xs text-muted-foreground">
                    The unified live map now shows ETA routes, driver positions and fleet status in
                    one place.
                  </p>
                </div>
                <Button asChild>
                  <Link to="/live-map">
                    <ExternalLink className="mr-1.5 size-3.5" /> Open live map
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {LANES.map((lane) => {
                const laneOrders = deliveryOrders.filter((o) => o.status === lane.key);
                return (
                  <Card key={lane.key} className="flex flex-col">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <lane.icon className="size-4" /> {lane.label}
                      </CardTitle>
                      <CardDescription>{laneOrders.length} orders</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {laneOrders.map((order) => (
                        <DeliveryCard
                          key={order.id}
                          order={order}
                          canManage={canManage}
                          onViewNotes={() => setNotesOrder(order)}
                          {...(lane.key === "ready"
                            ? {
                                onAssign: () => {
                                  setAssigning(order);
                                  setDriverId("");
                                  setEta(String(order.eta_minutes ?? 30));
                                },
                              }
                            : {})}
                          {...(lane.next
                            ? {
                                onAdvance: () =>
                                  advanceMutation.mutate({
                                    orderId: order.id,
                                    nextStatus: lane.next as OrderStatus,
                                  }),
                                advanceLabel: nextLabel[lane.next] ?? "Advance",
                              }
                            : {})}
                          onCancel={() =>
                            advanceMutation.mutate({ orderId: order.id, nextStatus: "cancelled" })
                          }
                        />
                      ))}
                      {laneOrders.length === 0 && (
                        <p className="py-8 text-center text-xs text-muted-foreground">
                          Lane is clear.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              {/* Customer pickups — ready orders waiting for the customer,
                  then collected orders ready to be closed. No driver needed. */}
              <Card className="flex flex-col border-sky-500/20">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShoppingBag className="size-4 text-sky-400" /> Customer pickups
                  </CardTitle>
                  <CardDescription>
                    {pickupOrders.length} order{pickupOrders.length === 1 ? "" : "s"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {pickupOrders.map((order) => (
                    <PickupCard
                      key={order.id}
                      order={order}
                      canManage={canManage}
                      onViewNotes={() => setNotesOrder(order)}
                      {...(order.status === "ready"
                        ? {
                            onAdvance: () =>
                              advanceMutation.mutate({
                                orderId: order.id,
                                nextStatus: "picked_up",
                              }),
                            advanceLabel: "Mark collected",
                          }
                        : {
                            onAdvance: () =>
                              advanceMutation.mutate({
                                orderId: order.id,
                                nextStatus: "delivered",
                              }),
                            advanceLabel: "Complete order",
                          })}
                      onCancel={() =>
                        advanceMutation.mutate({ orderId: order.id, nextStatus: "cancelled" })
                      }
                    />
                  ))}
                  {pickupOrders.length === 0 && (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      No pickups waiting.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Recent status transitions</CardTitle>
                <CardDescription>
                  Every dispatch action is written to the audit log.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(auditQuery.data ?? []).map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2 text-xs"
                  >
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {entry.action}
                    </Badge>
                    <span className="text-muted-foreground">{entry.actor_email ?? "system"}</span>
                    <span className="text-muted-foreground">
                      {String(entry.before_value?.["status"] ?? "—")} →{" "}
                      {String(entry.after_value?.["status"] ?? "—")}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {new Date(entry.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
                {(auditQuery.data ?? []).length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    No transitions logged yet.
                  </p>
                )}
              </CardContent>
            </Card>

            <Dialog
              open={Boolean(notesOrder)}
              onOpenChange={(open) => !open && setNotesOrder(null)}
            >
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <FileText className="size-4 text-amber-400" />
                    Order notes — {notesOrder?.order_number}
                  </DialogTitle>
                  <DialogDescription>
                    Delivery & handover instructions from the customer.
                  </DialogDescription>
                </DialogHeader>
                {notesOrder && <DispatchNotesBody order={notesOrder} />}
                <DialogFooter>
                  <Button variant="secondary" onClick={() => setNotesOrder(null)}>
                    Close
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={Boolean(assigning)} onOpenChange={(open) => !open && setAssigning(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Assign driver</DialogTitle>
                  <DialogDescription>
                    {assigning?.order_number} • {assigning?.restaurant_name}
                    {assigning?.branch_name ? ` — ${assigning.branch_name}` : ""} →{" "}
                    {assigning?.customer_name}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Driver</Label>
                    {eligibleDrivers.length === 0 ? (
                      <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
                        <p className="font-medium">
                          No eligible driver for{" "}
                          {assigning?.branch_name ? `${assigning.restaurant_name} · ${assigning.branch_name}` : assigning?.restaurant_name}.
                        </p>
                        {diagnostics && (
                          <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                            <li>{diagnostics.total} driver(s) loaded, {diagnostics.approved} approved</li>
                            <li>{diagnostics.assignedToRestaurant} assigned to this restaurant</li>
                            <li>{diagnostics.assignedToBranch} assigned to this branch</li>
                            <li>
                              order restaurant_id <span className="font-mono">{diagnostics.restaurantId}</span> · branch_id{" "}
                              <span className="font-mono">{diagnostics.branchId}</span>
                            </li>
                          </ul>
                        )}
                        <p className="text-xs">
                          Approve the driver and assign them to this branch in the Driver fleet, then
                          try again.
                        </p>
                      </div>
                    ) : (
                      <Select value={driverId} onValueChange={setDriverId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select an eligible driver" />
                        </SelectTrigger>
                        <SelectContent>
                          {eligibleDrivers.map((driver) => (
                            <SelectItem key={driver.id} value={driver.id}>
                              {driver.full_name} • {driver.vehicle_type ?? "vehicle"} •{" "}
                              {activeOrdersByDriver[driver.id] ?? 0} active
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="eta">ETA (minutes)</Label>
                    <Input
                      id="eta"
                      type="number"
                      min={5}
                      max={180}
                      value={eta}
                      onChange={(e) => setEta(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    disabled={!driverId || assignMutation.isPending || eligibleDrivers.length === 0}
                    onClick={() =>
                      assigning &&
                      assignMutation.mutate({
                        orderId: assigning.id,
                        driverId,
                        etaMinutes: Number(eta) || 30,
                      })
                    }
                  >
                    Assign & dispatch
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        );
      }}
    </PermissionGate>
  );
}

function dispatchOrderHasNotes(order: DispatchOrder): boolean {
  if ((order.special_instructions ?? "").trim().length > 0) return true;
  if ((order.delivery_notes ?? "").trim().length > 0) return true;
  return order.items.some((it) => (it.notes ?? "").trim().length > 0);
}

function DispatchNotesBody({ order }: { order: DispatchOrder }) {
  const special = (order.special_instructions ?? "").trim();
  const delivery = (order.delivery_notes ?? "").trim();
  const itemNotes = order.items.filter((it) => (it.notes ?? "").trim().length > 0);
  return (
    <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
      <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
        {order.order_number} • {order.restaurant_name} → {order.customer_name}
        {order.delivery_address && (
          <p className="mt-1 flex items-start gap-1.5 text-foreground/80">
            <MapPin className="mt-0.5 size-3 shrink-0" /> {order.delivery_address}
          </p>
        )}
      </div>
      {(special.length > 0 || itemNotes.length > 0) && (
        <section>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-violet-300">
            <PackageCheck className="size-3.5" /> Kitchen / handover notes
          </h4>
          {special && (
            <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-3 text-xs">
              <p className="whitespace-pre-wrap text-foreground/90">{special}</p>
            </div>
          )}
          {itemNotes.map((it) => (
            <div
              key={it.id}
              className="mt-1.5 rounded-md border border-violet-500/20 bg-violet-500/5 p-2 text-xs"
            >
              <p className="font-medium text-foreground">
                {it.quantity}× {it.item_name}
              </p>
              <p className="mt-0.5 text-foreground/80">{it.notes}</p>
            </div>
          ))}
        </section>
      )}
      {delivery && (
        <section>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-sky-300">
            <Bike className="size-3.5" /> Delivery instructions
          </h4>
          <div className="rounded-md border border-sky-500/20 bg-sky-500/5 p-3 text-xs">
            <p className="whitespace-pre-wrap text-foreground/90">{delivery}</p>
          </div>
        </section>
      )}
    </div>
  );
}

function DeliveryCard({
  order,
  canManage,
  onAssign,
  onAdvance,
  advanceLabel,
  onCancel,
  onViewNotes,
}: {
  order: DispatchOrder;
  canManage: boolean;
  onAssign?: () => void;
  onAdvance?: () => void;
  advanceLabel?: string;
  onCancel?: () => void;
  onViewNotes?: () => void;
}) {
  const waited = Math.max(
    0,
    Math.round((Date.now() - new Date(order.placed_at).getTime()) / 60000),
  );
  const hasNotes = dispatchOrderHasNotes(order);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{order.order_number}</p>
        <Badge variant={waited > 40 ? "destructive" : "secondary"} className="gap-1">
          <Clock className="size-3" /> {waited}m
        </Badge>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {order.restaurant_name}
        {order.branch_name ? ` · ${order.branch_name}` : ""} → {order.customer_name}
      </p>
      {order.delivery_address && (
        <p className="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
          <MapPin className="mt-0.5 size-3 shrink-0" /> {order.delivery_address}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        {order.driver_name ? (
          <Badge variant="outline" className="gap-1">
            <Bike className="size-3" /> {order.driver_name}
          </Badge>
        ) : (
          <Badge variant="outline">Unassigned</Badge>
        )}
        {order.eta_minutes != null && <Badge variant="secondary">ETA {order.eta_minutes}m</Badge>}
        {hasNotes && (
          <Badge variant="secondary" className="gap-1 text-amber-300">
            <MessageSquare className="size-2.5" /> notes
          </Badge>
        )}
      </div>
      {hasNotes && onViewNotes && (
        <button
          type="button"
          onClick={onViewNotes}
          className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-left text-[11px] text-amber-200 transition hover:bg-amber-500/15"
        >
          <MessageSquare className="size-3.5 shrink-0" />
          <span className="truncate">View customer notes</span>
        </button>
      )}
      {canManage && (
        <div className="mt-3 flex flex-col gap-2">
          {onAssign && (
            <Button size="sm" onClick={onAssign}>
              <Bike className="mr-1 size-3.5" /> Assign driver
            </Button>
          )}
          {onAdvance && (
            <Button size="sm" onClick={onAdvance}>
              <Truck className="mr-1 size-3.5" /> {advanceLabel}
            </Button>
          )}
          {hasNotes && onViewNotes && (
            <Button size="sm" variant="outline" onClick={onViewNotes}>
              <FileText className="mr-1 size-3.5" /> View notes
            </Button>
          )}
          {onCancel && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onCancel}>
              <XCircle className="mr-1 size-3.5" /> Cancel order
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Card for the "Customer pickups" lane — a ready order waiting at the
 *  counter, or a collected one ready to be closed. No driver involved. */
function PickupCard({
  order,
  canManage,
  onAdvance,
  advanceLabel,
  onCancel,
  onViewNotes,
}: {
  order: DispatchOrder;
  canManage: boolean;
  onAdvance: () => void;
  advanceLabel: string;
  onCancel: () => void;
  onViewNotes: () => void;
}) {
  const waited = Math.max(
    0,
    Math.round((Date.now() - new Date(order.placed_at).getTime()) / 60000),
  );
  const hasNotes = dispatchOrderHasNotes(order);
  const collected = order.status === "picked_up";

  return (
    <div
      className={`rounded-lg border p-3 ${collected ? "border-emerald-500/25 bg-emerald-500/[0.03]" : "border-sky-500/25 bg-sky-500/[0.03]"}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{order.order_number}</p>
        <Badge variant={waited > 40 ? "destructive" : "secondary"} className="gap-1">
          <Clock className="size-3" /> {waited}m
        </Badge>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {order.restaurant_name} → {order.customer_name}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        <OrderTypeBadge type="pickup" />
        <Badge
          variant={collected ? "default" : "outline"}
          className={collected ? "bg-emerald-600" : ""}
        >
          {collected ? "Collected by customer" : "Waiting at counter"}
        </Badge>
        {hasNotes && (
          <Badge variant="secondary" className="gap-1 text-amber-300">
            <MessageSquare className="size-2.5" /> notes
          </Badge>
        )}
      </div>
      {hasNotes && (
        <button
          type="button"
          onClick={onViewNotes}
          className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-left text-[11px] text-amber-200 transition hover:bg-amber-500/15"
        >
          <MessageSquare className="size-3.5 shrink-0" />
          <span className="truncate">View customer notes</span>
        </button>
      )}
      {canManage && (
        <div className="mt-3 flex flex-col gap-2">
          <Button size="sm" onClick={onAdvance}>
            <ShoppingBag className="mr-1 size-3.5" /> {advanceLabel}
          </Button>
          {hasNotes && (
            <Button size="sm" variant="outline" onClick={onViewNotes}>
              <FileText className="mr-1 size-3.5" /> View notes
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-destructive" onClick={onCancel}>
            <XCircle className="mr-1 size-3.5" /> Cancel order
          </Button>
        </div>
      )}
    </div>
  );
}
