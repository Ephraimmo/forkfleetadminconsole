import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@/lib/use-demo-fn";
import { toast } from "sonner";
import {
  Ban,
  Bike,
  CheckCircle2,
  Clock3,
  FileText,
  History,
  Inbox,
  LayoutGrid,
  MapPin,
  MessageSquare,
  Navigation,
  ReceiptText,
  Search,
  ShoppingBag,
  Table as TableIcon,
  User as UserIcon,
  UtensilsCrossed,
  XCircle,
} from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useFirebaseOrderSync } from "@/hooks/use-firebase-orders";
import { OrderTypeBadge } from "@/components/order-type-badge";
import { PaymentReceiptDialog } from "@/components/orders/payment-receipt-dialog";
import { onOrdersChanged } from "@/lib/dispatch.functions";
import { useEffect } from "react";

import {
  acceptOrder,
  advanceDelivery,
  assignDriver,
  getAuditTrail,
  listOrders,
  rejectOrder,
  type DispatchOrder,
  type OrderStatus,
} from "@/lib/dispatch.functions";
import {
  hasActiveAssignment,
  isApprovedDriver,
  subscribeActiveAssignments,
  type DriverAssignment,
} from "@/lib/drivers.firebase";
import { useDriverFleet, type DriverRow } from "@/hooks/use-driver-fleet";

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "Order Pipeline — ForkFleet Console" },
      {
        name: "description",
        content:
          "Accept new incoming orders, reject with a reason, push orders to the kitchen, assign drivers and track deliveries.",
      },
      { property: "og:title", content: "Order Pipeline — ForkFleet Console" },
      {
        property: "og:description",
        content: "Accept, cook, dispatch and deliver — every transition is audited.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrdersPage,
});

const STATUSES: OrderStatus[] = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "assigned",
  "picked_up",
  "on_the_way",
  "delivered",
  "rejected",
  "cancelled",
  "refunded",
];

const statusTone: Record<string, string> = {
  pending: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  accepted: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  preparing: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  ready: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  assigned: "bg-sky-500/15 text-sky-400 border-sky-500/25",
  picked_up: "bg-sky-500/15 text-sky-400 border-sky-500/25",
  on_the_way: "bg-indigo-500/15 text-indigo-400 border-indigo-500/25",
  delivered: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  rejected: "bg-rose-600/15 text-rose-300 border-rose-600/30",
  cancelled: "bg-destructive/15 text-destructive border-destructive/25",
  refunded: "bg-destructive/15 text-destructive border-destructive/25",
};

// Pipeline step rules:
//  - pending     → only Accept / Reject (no driver assignment, no kitchen advance)
//  - accepted    → kitchen picks up
//  - preparing   → kitchen marks ready
//  - ready       → dispatch ASSIGNS DRIVER (only assignable status)
//  - assigned    → driver picks up
//  - picked_up   → driver starts delivery
//  - on_the_way  → driver delivers
//  - delivered/rejected/cancelled/refunded: terminal
const NEXT_STEP: Partial<Record<OrderStatus, OrderStatus>> = {
  assigned: "picked_up",
  picked_up: "on_the_way",
  on_the_way: "delivered",
};

/** Next pipeline step for an order, honouring its fulfilment type.
 *  Pickup orders skip drivers entirely: ready → picked_up (collected) → delivered (closed). */
function nextStepFor(order: DispatchOrder): OrderStatus | null {
  if (order.order_type === "pickup") {
    if (order.status === "ready") return "picked_up";
    if (order.status === "picked_up") return "delivered";
    return null;
  }
  return NEXT_STEP[order.status] ?? null;
}

/** Button label for the next step, with pickup-friendly wording. */
function nextStepLabel(order: DispatchOrder, next: OrderStatus): string {
  if (order.order_type === "pickup") {
    if (next === "picked_up") return "Mark collected";
    if (next === "delivered") return "Complete";
  }
  return next.replace("_", " ");
}

const money = (value: number) =>
  `R ${value.toLocaleString("en-ZA", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

type ViewMode = "table" | "cards";

function OrdersPage() {
  useFirebaseOrderSync();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [driverFilter, setDriverFilter] = useState("all");
  const [view, setView] = useState<ViewMode>("cards");
  const [trailOrder, setTrailOrder] = useState<DispatchOrder | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<DispatchOrder | null>(null);
  const [notesOrder, setNotesOrder] = useState<DispatchOrder | null>(null);

  // Reject dialog
  const [rejectTarget, setRejectTarget] = useState<DispatchOrder | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const queryClient = useQueryClient();

  const fetchOrders = useServerFn(listOrders);
  const fetchAudit = useServerFn(getAuditTrail);
  const assign = useServerFn(assignDriver);
  const advance = useServerFn(advanceDelivery);
  const accept = useServerFn(acceptOrder);
  const reject = useServerFn(rejectOrder);

  const ordersQuery = useQuery({
    queryKey: ["orders", search, status, driverFilter],
    queryFn: () => fetchOrders({ search, status, driverId: driverFilter }),
    initialData: [],
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
  const fleet = useDriverFleet();
  const [activeAssignments, setActiveAssignments] = useState<DriverAssignment[]>([]);

  useEffect(() => {
    const unsub = subscribeActiveAssignments(setActiveAssignments);
    return unsub;
  }, []);
  const trailQuery = useQuery({
    queryKey: ["order-audit", trailOrder?.id],
    queryFn: () => fetchAudit({ entityType: "order", entityId: trailOrder?.id ?? "", limit: 50 }),
    enabled: Boolean(trailOrder),
  });

  // Live subscription pushes new snapshots into the query cache.
  useEffect(() => {
    const unsub = onOrdersChanged(() => {
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["drivers"] });
    });
    return unsub;
  }, [queryClient]);

  function invalidate() {
    for (const key of [
      "orders",
      "drivers",
      "dispatch-board",
      "order-audit",
      "dispatch-audit",
      "kitchen-queue",
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  const assignMutation = useMutation({
    mutationFn: (vars: { orderId: string; driverId: string }) => assign(vars),
    onSuccess: () => {
      toast.success("Driver assigned");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const advanceMutation = useMutation({
    mutationFn: (vars: { orderId: string; nextStatus: OrderStatus }) => advance(vars),
    onSuccess: (_r, vars) => {
      toast.success(`Order ${vars.nextStatus.replace("_", " ")}`);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const acceptMutation = useMutation({
    mutationFn: (orderId: string) => accept({ orderId }),
    onSuccess: () => {
      toast.success("Order accepted — sent to kitchen");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (vars: { orderId: string; reason: string }) => reject(vars),
    onSuccess: () => {
      toast.success("Order rejected");
      setRejectTarget(null);
      setRejectReason("");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = ordersQuery.data ?? [];
  const drivers = fleet.rows;

  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <PermissionGate
      required={["orders.view", "orders.manage"]}
      breadcrumb={["Operations", "Orders"]}
      title="Order pipeline"
      description="Accept incoming orders, reject with a reason, dispatch ready orders to drivers and track every transition."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {pendingCount > 0 && (
            <Badge variant="destructive" className="animate-pulse gap-1">
              <Inbox className="size-3" /> {pendingCount} new
            </Badge>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Order number"
              className="w-44 pl-8"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={driverFilter} onValueChange={setDriverFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All drivers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All drivers</SelectItem>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-1 flex items-center rounded-md border border-border">
            <button
              type="button"
              onClick={() => setView("cards")}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs ${view === "cards" ? "bg-accent text-foreground" : "text-muted-foreground"}`}
              aria-pressed={view === "cards"}
            >
              <LayoutGrid className="size-3.5" /> Cards
            </button>
            <button
              type="button"
              onClick={() => setView("table")}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs ${view === "table" ? "bg-accent text-foreground" : "text-muted-foreground"}`}
              aria-pressed={view === "table"}
            >
              <TableIcon className="size-3.5" /> Table
            </button>
          </div>
        </div>
      }
    >
      {(staff) => {
        const canManage =
          staff.hasPermission("orders.manage") || staff.hasPermission("dispatch.manage");

        return (
          <div className="space-y-4">
            {/* Lifecycle legend */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Flow:</span>
              <FlowStep tone={statusTone["pending"]}>Pending</FlowStep> →
              <FlowStep tone={statusTone["accepted"]}>Accepted</FlowStep> →
              <FlowStep tone={statusTone["preparing"]}>Cooking</FlowStep> →
              <FlowStep tone={statusTone["ready"]}>Ready</FlowStep> →
              <span className="font-medium">assign driver</span> →
              <FlowStep tone={statusTone["assigned"]}>Assigned</FlowStep> →
              <FlowStep tone={statusTone["on_the_way"]}>On the way</FlowStep> →
              <FlowStep tone={statusTone["delivered"]}>Delivered</FlowStep>
              <span className="mx-1">•</span>
              <FlowStep tone={statusTone["rejected"]}>Rejected</FlowStep>
              <span className="ml-auto">
                Drivers can only be assigned when the order is <b>Ready</b>.
              </span>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ReceiptText className="size-4" /> {rows.length} orders
                </CardTitle>
                <CardDescription>
                  Live Firebase pipeline — new customer orders appear in <b>Incoming</b> within ~1
                  second.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {ordersQuery.isLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : view === "table" ? (
                  <OrdersTable
                    rows={rows}
                    drivers={drivers}
                    activeAssignments={activeAssignments}
                    canManage={canManage}
                    onAssign={(orderId, driverId) => assignMutation.mutate({ orderId, driverId })}
                    onAdvance={(orderId, next) =>
                      advanceMutation.mutate({ orderId, nextStatus: next })
                    }
                    onAccept={(id) => acceptMutation.mutate(id)}
                    onReject={(o) => setRejectTarget(o)}
                    onTrail={setTrailOrder}
                    onReceipt={setReceiptOrder}
                    onViewNotes={(o) => setNotesOrder(o)}
                    isPending={
                      acceptMutation.isPending ||
                      rejectMutation.isPending ||
                      advanceMutation.isPending ||
                      assignMutation.isPending
                    }
                  />
                ) : (
                  <OrdersCards
                    rows={rows}
                    drivers={drivers}
                    activeAssignments={activeAssignments}
                    canManage={canManage}
                    onAssign={(orderId, driverId) => assignMutation.mutate({ orderId, driverId })}
                    onAdvance={(orderId, next) =>
                      advanceMutation.mutate({ orderId, nextStatus: next })
                    }
                    onAccept={(id) => acceptMutation.mutate(id)}
                    onReject={(o) => setRejectTarget(o)}
                    onTrail={setTrailOrder}
                    onReceipt={setReceiptOrder}
                    onViewNotes={(o) => setNotesOrder(o)}
                    isPending={
                      acceptMutation.isPending ||
                      rejectMutation.isPending ||
                      advanceMutation.isPending ||
                      assignMutation.isPending
                    }
                  />
                )}
              </CardContent>
            </Card>

            <Dialog
              open={Boolean(trailOrder)}
              onOpenChange={(open) => !open && setTrailOrder(null)}
            >
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Audit trail</DialogTitle>
                  <DialogDescription>
                    {trailOrder?.order_number} status transitions
                  </DialogDescription>
                </DialogHeader>
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {(trailQuery.data ?? []).map((entry) => (
                    <div key={entry.id} className="rounded-md border border-border/60 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {entry.action}
                        </Badge>
                        <span className="text-muted-foreground">
                          {new Date(entry.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {String(entry.before_value?.["status"] ?? "—")} →{" "}
                        {String(entry.after_value?.["status"] ?? "—")}
                        {entry.actor_email ? ` • ${entry.actor_email}` : ""}
                      </p>
                    </div>
                  ))}
                  {(trailQuery.data ?? []).length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      No transitions recorded yet.
                    </p>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            <PaymentReceiptDialog
              order={receiptOrder}
              canManage={canManage}
              onClose={() => setReceiptOrder(null)}
              onMarkedPaid={invalidate}
            />

            <Dialog
              open={Boolean(notesOrder)}
              onOpenChange={(open) => !open && setNotesOrder(null)}
            >
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <FileText className="size-4 text-amber-400" />
                    Notes & instructions — {notesOrder?.order_number}
                  </DialogTitle>
                  <DialogDescription>
                    Customer notes for the kitchen and delivery team.
                  </DialogDescription>
                </DialogHeader>
                {notesOrder && <OrderNotesBody order={notesOrder} />}
                <DialogFooter>
                  <Button variant="secondary" onClick={() => setNotesOrder(null)}>
                    Close
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog
              open={Boolean(rejectTarget)}
              onOpenChange={(open) => !open && setRejectTarget(null)}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Ban className="size-4 text-rose-400" /> Reject order{" "}
                    {rejectTarget?.order_number}
                  </DialogTitle>
                  <DialogDescription>
                    The customer will see the reason below. This action is final — the order will
                    move to
                    <b className="text-rose-300"> Rejected</b> and will not be sent to the kitchen
                    or assigned a driver.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="rounded-md border border-rose-500/20 bg-rose-500/5 p-3 text-xs">
                    <p className="font-medium text-rose-300">{rejectTarget?.restaurant_name}</p>
                    <p className="text-muted-foreground">
                      {rejectTarget?.customer_name} • {money(rejectTarget?.total ?? 0)}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reject-reason">Reason for rejection</Label>
                    <Textarea
                      id="reject-reason"
                      rows={3}
                      placeholder="e.g. Restaurant is too busy and cannot fulfil this order / Item out of stock / Delivery address outside of service area…"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      This note is saved to the order's timeline and shared with the customer.
                    </p>
                  </div>
                </div>
                <DialogFooter className="gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setRejectTarget(null);
                      setRejectReason("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() =>
                      rejectTarget &&
                      rejectMutation.mutate({ orderId: rejectTarget.id, reason: rejectReason })
                    }
                    disabled={!rejectReason.trim() || rejectMutation.isPending}
                  >
                    <XCircle className="mr-1.5 size-4" /> Reject order
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

function FlowStep({ children, tone }: { children: React.ReactNode; tone?: string | undefined }) {
  return (
    <Badge variant="outline" className={`${tone ?? ""} text-[10px]`}>
      {children}
    </Badge>
  );
}

/** Only fully approved drivers (verified, not pending/suspended/rejected) with
 *  an active assignment for the order's exact restaurant and branch. */
function eligibleDriversFor(
  order: DispatchOrder,
  drivers: DriverRow[],
  activeAssignments: DriverAssignment[],
): DriverRow[] {
  return drivers.filter(
    (d) =>
      isApprovedDriver(d) &&
      hasActiveAssignment(activeAssignments, d.id, order.restaurant_id, order.branch_id),
  );
}

/** Human-readable hint shown when no driver is eligible for an order. */
function eligibilityHint(
  order: DispatchOrder,
  drivers: DriverRow[],
  activeAssignments: DriverAssignment[],
): string {
  const approved = drivers.filter((d) => isApprovedDriver(d));
  const atRestaurant = approved.filter((d) =>
    hasActiveAssignment(activeAssignments, d.id, order.restaurant_id, null),
  );
  if (approved.length === 0) {
    return "No approved drivers yet — approve a driver in Drivers → driver profile.";
  }
  if (atRestaurant.length === 0) {
    return `${approved.length} approved driver(s), but none is assigned to ${order.restaurant_name}. Assign one in Drivers → Assignments.`;
  }
  return `${atRestaurant.length} driver(s) cover ${order.restaurant_name}, but none covers this order's branch (${order.branch_name ?? order.branch_id ?? "unknown"}). Open the driver in Drivers → Assignments and use "Cover all branches".`;
}

function OrdersTable({
  rows,
  drivers,
  activeAssignments,
  canManage,
  onAssign,
  onAdvance,
  onAccept,
  onReject,
  onTrail,
  onReceipt,
  onViewNotes,
  isPending,
}: {
  rows: DispatchOrder[];
  drivers: DriverRow[];
  activeAssignments: DriverAssignment[];
  canManage: boolean;
  onAssign: (orderId: string, driverId: string) => void;
  onAdvance: (orderId: string, next: OrderStatus) => void;
  onAccept: (orderId: string) => void;
  onReject: (order: DispatchOrder) => void;
  onTrail: (order: DispatchOrder) => void;
  onReceipt: (order: DispatchOrder) => void;
  onViewNotes: (order: DispatchOrder) => void;
  isPending: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Restaurant</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Driver</TableHead>
            <TableHead>ETA</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((order) => {
            const next = nextStepFor(order);
            const isIncoming = order.status === "pending";
            const hasNotes = orderHasNotes(order);
            return (
              <TableRow key={order.id} className={isIncoming ? "bg-slate-500/5" : ""}>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {order.order_number}
                    <OrderTypeBadge type={order.order_type} />
                  </span>
                  {hasNotes && (
                    <Badge variant="secondary" className="ml-1.5 gap-1 py-0 text-[10px]">
                      <MessageSquare className="size-2.5" /> notes
                    </Badge>
                  )}
                  {order.status === "rejected" && order.rejection_reason && (
                    <p className="mt-0.5 text-[10px] italic text-rose-300">
                      Rejected: {order.rejection_reason}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{order.restaurant_name}</TableCell>
                <TableCell className="text-muted-foreground">{order.customer_name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusTone[order.status] ?? ""}>
                    {order.status.replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell>
                  {canManage && order.status === "ready" && order.order_type !== "pickup" ? (
                    eligibleDriversFor(order, drivers, activeAssignments).length === 0 ? (
                      <span
                        className="text-[11px] text-amber-400"
                        title={eligibilityHint(order, drivers, activeAssignments)}
                      >
                        No approved driver for this branch
                      </span>
                    ) : (
                      <Select
                        value={order.driver_id ?? ""}
                        onValueChange={(value) => onAssign(order.id, value)}
                      >
                        <SelectTrigger className="h-8 w-40">
                          <SelectValue placeholder="Assign driver" />
                        </SelectTrigger>
                        <SelectContent>
                          {eligibleDriversFor(order, drivers, activeAssignments).map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.full_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )
                  ) : order.order_type === "pickup" ? (
                    <span className="text-xs text-sky-400">Customer collects</span>
                  ) : (
                    <span className="text-muted-foreground">{order.driver_name ?? "—"}</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {order.eta_minutes != null ? `${order.eta_minutes}m` : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(order.total)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    {canManage && isIncoming && (
                      <>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => onAccept(order.id)}
                          disabled={isPending}
                        >
                          <CheckCircle2 className="mr-1 size-3.5" /> Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onReject(order)}
                          disabled={isPending}
                        >
                          <Ban className="mr-1 size-3.5" /> Reject
                        </Button>
                      </>
                    )}
                    {canManage && next && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onAdvance(order.id, next)}
                        disabled={isPending}
                      >
                        {nextStepLabel(order, next)}
                      </Button>
                    )}
                    {hasNotes && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onViewNotes(order)}
                        title="View notes"
                      >
                        <FileText className="mr-1 size-3.5" /> View
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onReceipt(order)}
                      title="Payment receipt"
                    >
                      <ReceiptText className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onTrail(order)}
                      title="Audit trail"
                    >
                      <History className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                No orders match these filters. When a customer places an order it will appear here.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function OrdersCards({
  rows,
  drivers,
  activeAssignments,
  canManage,
  onAssign,
  onAdvance,
  onAccept,
  onReject,
  onTrail,
  onReceipt,
  onViewNotes,
  isPending,
}: {
  rows: DispatchOrder[];
  drivers: DriverRow[];
  activeAssignments: DriverAssignment[];
  canManage: boolean;
  onAssign: (orderId: string, driverId: string) => void;
  onAdvance: (orderId: string, next: OrderStatus) => void;
  onAccept: (orderId: string) => void;
  onReject: (order: DispatchOrder) => void;
  onTrail: (order: DispatchOrder) => void;
  onReceipt: (order: DispatchOrder) => void;
  onViewNotes: (order: DispatchOrder) => void;
  isPending: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-12 text-center">
        <Inbox className="mx-auto mb-2 size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No orders yet. Place an order from the customer app or point a test client at{" "}
          <code className="rounded bg-muted px-1">/orders</code>.
        </p>
      </div>
    );
  }

  const groups: {
    key: OrderStatus | "incoming" | "terminal";
    label: string;
    orders: DispatchOrder[];
    tone: string;
  }[] = [
    { key: "incoming", label: "Incoming (new)", orders: [], tone: "text-slate-300" },
    { key: "accepted", label: "Queued for kitchen", orders: [], tone: "text-violet-300" },
    { key: "preparing", label: "Preparing", orders: [], tone: "text-amber-300" },
    { key: "ready", label: "Ready for pickup", orders: [], tone: "text-amber-400" },
    { key: "assigned", label: "Driver assigned", orders: [], tone: "text-sky-400" },
    { key: "on_the_way", label: "On the way", orders: [], tone: "text-indigo-400" },
    { key: "delivered", label: "Delivered", orders: [], tone: "text-emerald-400" },
    {
      key: "terminal",
      label: "Rejected / Refunded / Cancelled",
      orders: [],
      tone: "text-rose-300",
    },
  ];

  for (const o of rows) {
    if (o.status === "pending") groups[0]!.orders.push(o);
    else if (o.status === "accepted") groups[1]!.orders.push(o);
    else if (o.status === "preparing") groups[2]!.orders.push(o);
    else if (o.status === "ready") groups[3]!.orders.push(o);
    else if (o.status === "assigned" || o.status === "picked_up") groups[4]!.orders.push(o);
    else if (o.status === "on_the_way") groups[5]!.orders.push(o);
    else if (o.status === "delivered") groups[6]!.orders.push(o);
    else groups[7]!.orders.push(o);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-4">
      {groups
        .filter((g) => g.orders.length > 0)
        .map((g) => (
          <Card key={g.key} className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className={`flex items-center gap-2 text-sm ${g.tone}`}>
                {g.key === "incoming" && <Inbox className="size-4" />}
                {g.key === "accepted" && <Clock3 className="size-4" />}
                {g.key === "preparing" && <UtensilsCrossed className="size-4" />}
                {g.key === "ready" && <MapPin className="size-4" />}
                {g.key === "assigned" && <Bike className="size-4" />}
                {g.key === "on_the_way" && <Navigation className="size-4" />}
                {g.key === "delivered" && <ReceiptText className="size-4" />}
                {g.key === "terminal" && <Ban className="size-4" />}
                {g.label}
              </CardTitle>
              <CardDescription>
                {g.orders.length} order{g.orders.length === 1 ? "" : "s"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {g.orders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  drivers={drivers}
                  activeAssignments={activeAssignments}
                  canManage={canManage}
                  onAssign={onAssign}
                  onAdvance={onAdvance}
                  onAccept={onAccept}
                  onReject={onReject}
                  onTrail={onTrail}
                  onReceipt={onReceipt}
                  onViewNotes={onViewNotes}
                  isPending={isPending}
                />
              ))}
            </CardContent>
          </Card>
        ))}
    </div>
  );
}

function OrderCard({
  order,
  drivers,
  activeAssignments,
  canManage,
  onAssign,
  onAdvance,
  onAccept,
  onReject,
  onTrail,
  onReceipt,
  onViewNotes,
  isPending,
}: {
  order: DispatchOrder;
  drivers: DriverRow[];
  activeAssignments: DriverAssignment[];
  canManage: boolean;
  onAssign: (orderId: string, driverId: string) => void;
  onAdvance: (orderId: string, next: OrderStatus) => void;
  onAccept: (orderId: string) => void;
  onReject: (order: DispatchOrder) => void;
  onTrail: (order: DispatchOrder) => void;
  onReceipt: (order: DispatchOrder) => void;
  onViewNotes: (order: DispatchOrder) => void;
  isPending: boolean;
}) {
  // Honour the fulfilment type: pickup orders move collected → closed,
  // never through the driver-only "on the way" step.
  const next = nextStepFor(order);
  const waited = Math.max(
    0,
    Math.round((Date.now() - new Date(order.placed_at).getTime()) / 60000),
  );
  const isIncoming = order.status === "pending";
  const isRejected = order.status === "rejected";
  const hasNotes = orderHasNotes(order);
  const itemNotes = order.items.filter((it) => (it.notes ?? "").trim().length > 0);

  return (
    <div
      className={`rounded-lg border p-3 ${isIncoming ? "border-slate-500/30 bg-slate-500/5" : isRejected ? "border-rose-600/25 bg-rose-600/5" : "border-border bg-card"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{order.order_number}</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <UtensilsCrossed className="size-3 shrink-0" />
            <span className="truncate">{order.restaurant_name}</span>
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <UserIcon className="size-3 shrink-0" />
            <span className="truncate">{order.customer_name}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <OrderTypeBadge type={order.order_type} />
          <Badge variant="outline" className={statusTone[order.status] ?? ""}>
            {order.status.replace("_", " ")}
          </Badge>
          <Badge variant={waited > 25 ? "destructive" : "secondary"} className="text-[10px]">
            {waited}m
          </Badge>
        </div>
      </div>

      <ul className="mt-2 space-y-0.5 text-xs">
        {order.items.slice(0, 3).map((item) => (
          <li key={item.id} className="flex justify-between gap-2">
            <span className="truncate">
              {item.quantity}× {item.item_name}
            </span>
          </li>
        ))}
        {order.items.length > 3 && (
          <li className="text-[10px] italic text-muted-foreground">
            +{order.items.length - 3} more items
          </li>
        )}
      </ul>

      {isRejected && order.rejection_reason && (
        <Accordion type="single" collapsible>
          <AccordionItem value="reason" className="border-none">
            <AccordionTrigger className="py-1 text-[11px] text-rose-300">
              View rejection reason
            </AccordionTrigger>
            <AccordionContent className="pb-1 text-[11px] text-rose-200/90">
              {order.rejection_reason}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          {order.order_type === "pickup" ? (
            <>
              <ShoppingBag className="size-3.5 text-sky-400" />
              <span className="text-sky-400">Customer collects</span>
            </>
          ) : (
            <>
              <Bike className="size-3.5" />
              {order.driver_name ?? "Unassigned"}
            </>
          )}
        </span>
        <span className="tabular-nums font-medium">{money(order.total)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock3 className="size-3" />
          {order.eta_minutes != null ? `${order.eta_minutes}m ETA` : "—"}
        </span>
        <span className="flex items-center gap-1.5">
          {order.payment_method}
          <span
            className={`rounded-full px-1.5 py-px text-[10px] font-medium ${
              order.payment_status === "paid"
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-amber-500/15 text-amber-400"
            }`}
          >
            {order.payment_status === "paid" ? "Paid" : "Pending"}
          </span>
        </span>
      </div>

      {hasNotes && (
        <button
          type="button"
          onClick={() => onViewNotes(order)}
          className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-left text-[11px] text-amber-200 transition hover:bg-amber-500/15"
        >
          <MessageSquare className="size-3.5 shrink-0" />
          <span className="truncate">
            View customer notes
            {(order.special_instructions || itemNotes.length > 0) &&
              order.delivery_notes &&
              " (kitchen + delivery)"}
            {(order.special_instructions || itemNotes.length > 0) &&
              !order.delivery_notes &&
              " (kitchen)"}
            {!order.special_instructions &&
              itemNotes.length === 0 &&
              order.delivery_notes &&
              " (delivery)"}
          </span>
        </button>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canManage && isIncoming && (
          <>
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onAccept(order.id)}
              disabled={isPending}
            >
              <CheckCircle2 className="mr-1 size-3.5" /> Accept
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onReject(order)}
              disabled={isPending}
            >
              <Ban className="mr-1 size-3.5" /> Reject
            </Button>
          </>
        )}
        {canManage && order.status === "ready" && order.order_type !== "pickup" &&
          (() => {
            const eligible = eligibleDriversFor(order, drivers, activeAssignments);
            if (eligible.length === 0) {
              return (
                <span
                  className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-400"
                  title={eligibilityHint(order, drivers, activeAssignments)}
                >
                  No approved driver for this branch
                </span>
              );
            }
            return (
              <Select onValueChange={(value) => onAssign(order.id, value)}>
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue placeholder="Assign driver" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })()}
        {canManage && next && (
          <Button
            size="sm"
            className="flex-1"
            onClick={() => onAdvance(order.id, next)}
            disabled={isPending}
          >
            {nextStepLabel(order, next)}
          </Button>
        )}
        {hasNotes && (
          <Button size="sm" variant="outline" onClick={() => onViewNotes(order)} title="View notes">
            <FileText className="mr-1 size-3.5" /> View
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onReceipt(order)} title="Payment receipt">
          <ReceiptText className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onTrail(order)} title="Audit trail">
          <History className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function orderHasNotes(order: DispatchOrder): boolean {
  if ((order.special_instructions ?? "").trim().length > 0) return true;
  if ((order.delivery_notes ?? "").trim().length > 0) return true;
  return order.items.some((it) => (it.notes ?? "").trim().length > 0);
}

function OrderNotesBody({ order }: { order: DispatchOrder }) {
  const special = (order.special_instructions ?? "").trim();
  const delivery = (order.delivery_notes ?? "").trim();
  const itemNotes = order.items.filter((it) => (it.notes ?? "").trim().length > 0);
  const hasKitchen = special.length > 0 || itemNotes.length > 0;
  const hasDelivery = delivery.length > 0;

  return (
    <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
      <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
        <div className="grid grid-cols-2 gap-2 text-muted-foreground">
          <div>
            <span className="text-muted-foreground/70">Order:</span>{" "}
            <span className="font-medium text-foreground">{order.order_number}</span>
          </div>
          <div>
            <span className="text-muted-foreground/70">Customer:</span>{" "}
            <span className="font-medium text-foreground">{order.customer_name}</span>
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground/70">Restaurant:</span>{" "}
            <span className="font-medium text-foreground">{order.restaurant_name}</span>
          </div>
          {order.delivery_address && (
            <div className="col-span-2 flex items-start gap-1.5">
              <MapPin className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              <span className="text-foreground/90">{order.delivery_address}</span>
            </div>
          )}
        </div>
      </div>

      {hasKitchen && (
        <section>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-violet-300">
            <UtensilsCrossed className="size-3.5" /> Kitchen instructions
          </h4>
          <div className="space-y-2">
            {special && (
              <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-3 text-xs">
                <p className="mb-1 text-[10px] uppercase tracking-wide text-violet-300/80">
                  Special instructions
                </p>
                <p className="whitespace-pre-wrap text-foreground/90">{special}</p>
              </div>
            )}
            {itemNotes.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-violet-300/80">Item notes</p>
                {itemNotes.map((it) => (
                  <div
                    key={it.id}
                    className="rounded-md border border-violet-500/20 bg-violet-500/5 p-2 text-xs"
                  >
                    <p className="font-medium text-foreground">
                      {it.quantity}× {it.item_name}
                    </p>
                    <p className="mt-0.5 text-foreground/80">{it.notes}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {hasDelivery && (
        <section>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-sky-300">
            <Bike className="size-3.5" /> Delivery instructions
          </h4>
          <div className="rounded-md border border-sky-500/20 bg-sky-500/5 p-3 text-xs">
            <p className="whitespace-pre-wrap text-foreground/90">{delivery}</p>
          </div>
        </section>
      )}

      {!hasKitchen && !hasDelivery && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          This order has no notes on file.
        </p>
      )}
    </div>
  );
}
