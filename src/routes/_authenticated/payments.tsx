import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Receipt,
  Banknote,
  TrendingUp,
  RefreshCw,
  Download,
  Search,
  CheckCircle2,
  XCircle,
  Landmark,
  ExternalLink,
  Loader2,
  FileText,
} from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

import { money, money2, number0 } from "@/lib/demo-formatters";
import { listFirebaseOrders, type FirebaseOrder } from "@/lib/orders.firebase";
import { useFirebaseRestaurants } from "@/hooks/use-firebase-restaurants";
import {
  PERIOD_LABEL,
  resolvePeriodRange,
  summarizeRestaurantSettlements,
  summarizeRevenue,
  type DateRange,
  type PeriodGranularity,
} from "@/lib/finance.firebase";
import {
  computeDriverPayouts,
  DRIVER_COMMISSION_PER_DELIVERY,
  markDriverPayoutPaid,
  type DriverPayoutRecord,
} from "@/lib/driver-payouts.firebase";
import {
  listOrdersAwaitingPaymentApproval,
  markOrderPaid,
  paymentMethodLabel,
  rejectOrderPayment,
  type PaymentApprovalRow,
} from "@/lib/payments.firebase";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({
    meta: [
      { title: "Payments — Hearth Admin" },
      { name: "description", content: "Payouts, settlements, commissions and payment method overview." },
    ],
  }),
  component: PaymentsPage,
});

const PAYMENT_COLORS = ["oklch(0.79 0.155 71)", "oklch(0.68 0.13 240)", "oklch(0.74 0.17 150)", "oklch(0.6 0.19 20)"];

const statusTone: Record<string, string> = {
  settled: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  processing: "bg-sky-500/15 text-sky-400 border-sky-500/30",
};

const TX_STATUS_TONE: Record<string, string> = {
  delivered: statusTone["settled"]!,
  refunded: statusTone["processing"]!,
  cancelled: statusTone["failed"]!,
};

/** Resolve a granularity + optional custom bounds into a concrete range,
 *  falling back to "this week" until both custom dates are picked. */
function usePeriodRange(granularity: PeriodGranularity, customStart: string, customEnd: string): DateRange {
  return useMemo(() => {
    if (granularity === "custom") {
      if (customStart && customEnd) {
        return resolvePeriodRange("custom", { start: new Date(customStart), end: new Date(customEnd) });
      }
      return resolvePeriodRange("week");
    }
    return resolvePeriodRange(granularity);
  }, [granularity, customStart, customEnd]);
}

function PaymentsPage() {
  const [tab, setTab] = useState("overview");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [rejectTarget, setRejectTarget] = useState<PaymentApprovalRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [revenueGranularity, setRevenueGranularity] = useState<PeriodGranularity>("week");
  const [revenueCustomStart, setRevenueCustomStart] = useState("");
  const [revenueCustomEnd, setRevenueCustomEnd] = useState("");
  const revenueRange = usePeriodRange(revenueGranularity, revenueCustomStart, revenueCustomEnd);

  const [payoutGranularity, setPayoutGranularity] = useState<PeriodGranularity>("week");
  const [payoutCustomStart, setPayoutCustomStart] = useState("");
  const [payoutCustomEnd, setPayoutCustomEnd] = useState("");
  const payoutRange = usePeriodRange(payoutGranularity, payoutCustomStart, payoutCustomEnd);

  const queryClient = useQueryClient();

  const ordersQuery = useQuery({
    queryKey: ["orders-all"],
    queryFn: () => listFirebaseOrders(),
    refetchInterval: 30_000,
  });
  const orders = useMemo<FirebaseOrder[]>(
    () => (ordersQuery.data ?? []).map((p) => p.order),
    [ordersQuery.data],
  );
  const { rows: restaurantRows } = useFirebaseRestaurants();

  const revenue = useMemo(() => summarizeRevenue(orders, revenueRange), [orders, revenueRange]);
  const settlements = useMemo(
    () => summarizeRestaurantSettlements(orders, restaurantRows, revenueRange),
    [orders, restaurantRows, revenueRange],
  );
  const methodMix = useMemo(
    () => revenue.byMethod.map((m) => ({ name: m.method.toUpperCase(), value: m.orders })),
    [revenue.byMethod],
  );

  const payoutsQuery = useQuery({
    queryKey: ["driver-payouts", payoutRange.start.toISOString(), payoutRange.end.toISOString(), orders.length],
    queryFn: () => computeDriverPayouts(orders, payoutRange),
    enabled: ordersQuery.data !== undefined,
  });
  const payouts = payoutsQuery.data ?? [];
  const pendingPayouts = useMemo(() => payouts.filter((p) => p.status === "pending"), [payouts]);
  const invalidatePayouts = () => void queryClient.invalidateQueries({ queryKey: ["driver-payouts"] });

  const markPaidMutation = useMutation({
    mutationFn: (vars: { row: DriverPayoutRecord; actor: string | null }) =>
      markDriverPayoutPaid({
        driver_id: vars.row.driver_id,
        driver_name: vars.row.driver_name,
        range: payoutRange,
        deliveries: vars.row.deliveries,
        gross_delivery_fees: vars.row.gross_delivery_fees,
        commission: vars.row.commission,
        amount_due: vars.row.amount_due,
        actor: vars.actor,
      }),
    onSuccess: (_r, vars) => {
      toast.success(`${vars.row.driver_name} marked as paid.`);
      invalidatePayouts();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const payAllMutation = useMutation({
    mutationFn: async (vars: { rows: DriverPayoutRecord[]; actor: string | null }) => {
      await Promise.all(
        vars.rows.map((row) =>
          markDriverPayoutPaid({
            driver_id: row.driver_id,
            driver_name: row.driver_name,
            range: payoutRange,
            deliveries: row.deliveries,
            gross_delivery_fees: row.gross_delivery_fees,
            commission: row.commission,
            amount_due: row.amount_due,
            actor: vars.actor,
          }),
        ),
      );
    },
    onSuccess: (_r, vars) => {
      toast.success(`Paid ${vars.rows.length} driver${vars.rows.length === 1 ? "" : "s"}.`);
      invalidatePayouts();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const transactionRows = useMemo(() => {
    return orders
      .filter((o) => o.status === "delivered" || o.status === "refunded" || o.status === "cancelled")
      .slice()
      .sort((a, b) =>
        (b.delivered_at ?? b.cancelled_at ?? b.placed_at).localeCompare(
          a.delivered_at ?? a.cancelled_at ?? a.placed_at,
        ),
      );
  }, [orders]);

  const filteredTx = useMemo(
    () =>
      transactionRows
        .filter((o) => status === "all" || o.status === status)
        .filter(
          (o) =>
            !search ||
            o.order_number.toLowerCase().includes(search.toLowerCase()) ||
            o.restaurant_name.toLowerCase().includes(search.toLowerCase()) ||
            o.customer_name.toLowerCase().includes(search.toLowerCase()),
        ),
    [transactionRows, status, search],
  );

  const refundedOrders = useMemo(
    () =>
      orders
        .filter((o) => o.status === "refunded" || o.status === "cancelled")
        .slice()
        .sort((a, b) => (b.cancelled_at ?? b.placed_at).localeCompare(a.cancelled_at ?? a.placed_at)),
    [orders],
  );

  const approvalsQuery = useQuery({
    queryKey: ["payment-approvals"],
    queryFn: () => listOrdersAwaitingPaymentApproval(),
    refetchInterval: 15_000,
  });
  const paymentApprovals = approvalsQuery.data ?? [];

  const invalidateApprovals = () => void queryClient.invalidateQueries({ queryKey: ["payment-approvals"] });

  const approveMutation = useMutation({
    mutationFn: (vars: { row: PaymentApprovalRow; actor: string | null }) =>
      markOrderPaid({
        order_id: vars.row.order_id,
        order_number: vars.row.order_number,
        total: vars.row.total,
        payment_method: "eft",
        recorded_by: vars.actor,
      }),
    onSuccess: (_r, vars) => {
      toast.success(`${vars.row.order_number} approved — the order can now be accepted.`);
      invalidateApprovals();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (vars: { orderId: string; reason: string; actor: string | null }) =>
      rejectOrderPayment({ order_id: vars.orderId, reason: vars.reason, actor: vars.actor }),
    onSuccess: () => {
      toast.success("Proof of payment rejected.");
      setRejectTarget(null);
      setRejectReason("");
      invalidateApprovals();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <PermissionGate
      required={["finance.view", "orders.view"]}
      breadcrumb={["Commerce", "Payments"]}
      title="Payments &amp; payouts"
      description="Platform revenue, restaurant settlements, driver payouts, refunds and payment method mix."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm">
            <Download className="mr-1.5 size-3.5" /> Export ledger
          </Button>
        </div>
      }
    >
      {(staff) => (
        <div className="space-y-4">
          {/* KPI strip — revenue for the selected period */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={Receipt} label={`Revenue — ${PERIOD_LABEL[revenueGranularity]}`} value={money(revenue.totalRevenue)} />
            <Kpi icon={TrendingUp} label="Orders completed" value={number0(revenue.totalOrders)} tone="text-emerald-400" />
            <Kpi icon={ArrowUpRight} label="Avg order value" value={money(revenue.averageOrderValue)} />
            <Kpi icon={Banknote} label="Delivery fees" value={money(revenue.deliveryFees)} />
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="proof" className="gap-1.5">
                Proof of payment
                {paymentApprovals.length > 0 && (
                  <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                    {paymentApprovals.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
              <TabsTrigger value="settlements">Settlements</TabsTrigger>
              <TabsTrigger value="payouts">Driver payouts</TabsTrigger>
              <TabsTrigger value="refunds">Refunds</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-4">
              <Card>
                <CardContent className="flex flex-wrap items-end justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium">Revenue for {PERIOD_LABEL[revenueGranularity]}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {revenueRange.start.toLocaleDateString("en-ZA")} – {revenueRange.end.toLocaleDateString("en-ZA")}
                    </p>
                  </div>
                  <PeriodControl
                    granularity={revenueGranularity}
                    onGranularityChange={setRevenueGranularity}
                    customStart={revenueCustomStart}
                    customEnd={revenueCustomEnd}
                    onCustomStartChange={setRevenueCustomStart}
                    onCustomEndChange={setRevenueCustomEnd}
                  />
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Revenue trend</CardTitle>
                    <CardDescription>Daily gross revenue from completed orders in this period</CardDescription>
                  </CardHeader>
                  <CardContent className="h-72 px-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={revenue.byDay} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => `R${Math.round(v / 1000)}k`} />
                        <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => money(v)} />
                        <Area type="monotone" dataKey="revenue" stroke="var(--color-chart-1)" strokeWidth={2} fill="url(#revFill)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Payment methods</CardTitle>
                    <CardDescription>Share of completed orders</CardDescription>
                  </CardHeader>
                  <CardContent className="h-72">
                    {methodMix.length === 0 ? (
                      <p className="py-8 text-center text-xs text-muted-foreground">No completed orders yet.</p>
                    ) : (
                      <ResponsiveContainer width="100%" height="80%">
                        <PieChart>
                          <Pie data={methodMix} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                            {methodMix.map((_, i) => (
                              <Cell key={i} fill={PAYMENT_COLORS[i % PAYMENT_COLORS.length]} stroke="var(--color-card)" strokeWidth={2} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                          <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Revenue by restaurant</CardTitle>
                  <CardDescription>How much each restaurant contributed in this period</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {revenue.byRestaurant.length === 0 ? (
                    <p className="py-8 text-center text-xs text-muted-foreground">No completed orders in this period yet.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-4">Restaurant</TableHead>
                          <TableHead className="text-right">Orders</TableHead>
                          <TableHead className="pr-4 text-right">Revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {revenue.byRestaurant.map((r) => (
                          <TableRow key={r.restaurant_id || r.restaurant_name}>
                            <TableCell className="pl-4 font-medium">{r.restaurant_name}</TableCell>
                            <TableCell className="text-right tabular-nums">{number0(r.orders)}</TableCell>
                            <TableCell className="pr-4 text-right font-semibold tabular-nums">{money2(r.revenue)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="proof" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Proof of payment approvals</CardTitle>
                  <CardDescription>
                    Orders paid by bank transfer (EFT) — the customer's uploaded proof must be
                    approved here before the order can be accepted on the Orders page.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {approvalsQuery.isLoading && (
                    <p className="py-8 text-center text-xs text-muted-foreground">Loading…</p>
                  )}
                  {!approvalsQuery.isLoading && paymentApprovals.length === 0 && (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      Nothing waiting on review — every EFT order's proof of payment has been
                      approved or rejected.
                    </p>
                  )}
                  {paymentApprovals.map((row) => {
                    const isApproving =
                      approveMutation.isPending &&
                      approveMutation.variables?.row.order_id === row.order_id;
                    return (
                      <div
                        key={row.order_id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3"
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 items-center justify-center rounded-md bg-muted">
                            <Landmark className="size-4 text-amber-400" />
                          </span>
                          <div>
                            <p className="text-sm font-medium">
                              {row.order_number}
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {row.restaurant_name} · {row.customer_name}
                              </span>
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {paymentMethodLabel(row.evidence.method)} · placed{" "}
                              {new Date(row.placed_at).toLocaleString("en-ZA", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold tabular-nums">{money2(row.total)}</p>
                          {row.evidence.proof_url ? (
                            <a
                              href={row.evidence.proof_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2"
                            >
                              <FileText className="size-3.5" /> View document{" "}
                              <ExternalLink className="size-3" />
                            </a>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              No document uploaded yet
                            </Badge>
                          )}
                          {staff.hasPermission("finance.manage") && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setRejectTarget(row)}
                                disabled={rejectMutation.isPending || isApproving}
                              >
                                <XCircle className="mr-1 size-3.5" /> Reject
                              </Button>
                              <Button
                                size="sm"
                                disabled={!row.evidence.proof_url || isApproving}
                                onClick={() =>
                                  approveMutation.mutate({ row, actor: staff.session?.email ?? null })
                                }
                              >
                                {isApproving ? (
                                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="mr-1 size-3.5" />
                                )}
                                Approve
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="transactions" className="mt-4 space-y-4">
              <Card>
                <CardContent className="flex flex-wrap items-end gap-3 p-4">
                  <div className="relative min-w-[220px] flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                    <Input placeholder="Search order #, restaurant, customer…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="delivered">Delivered</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="refunded">Refunded</SelectItem>
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Order</TableHead>
                        <TableHead>Restaurant</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Delivery</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                        <TableHead className="pr-4 text-right">Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTx.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="py-8 text-center text-xs text-muted-foreground">
                            No transactions match this filter.
                          </TableCell>
                        </TableRow>
                      )}
                      {filteredTx.slice(0, 40).map((o) => {
                        const Icon = o.status === "delivered" ? CheckCircle2 : o.status === "refunded" ? RefreshCw : XCircle;
                        const date = o.delivered_at ?? o.cancelled_at ?? o.placed_at;
                        return (
                          <TableRow key={o.id}>
                            <TableCell className="pl-4 font-medium">{o.order_number}</TableCell>
                            <TableCell className="text-muted-foreground">{o.restaurant_name}</TableCell>
                            <TableCell className="text-muted-foreground">{o.customer_name}</TableCell>
                            <TableCell className="uppercase text-xs text-muted-foreground">{o.payment_method}</TableCell>
                            <TableCell className="text-right tabular-nums">{money2(o.total)}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{money2(o.delivery_fee)}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline" className={TX_STATUS_TONE[o.status] + " gap-1"}>
                                <Icon className="size-3" /> {o.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="pr-4 text-right text-xs text-muted-foreground">
                              {new Date(date).toLocaleDateString("en-ZA")}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="settlements" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <CardTitle className="text-base">Restaurant settlements</CardTitle>
                    <CardDescription>
                      Revenue owed to each restaurant after the platform's commission, for{" "}
                      {PERIOD_LABEL[revenueGranularity].toLowerCase()}.
                    </CardDescription>
                  </div>
                  <PeriodControl
                    granularity={revenueGranularity}
                    onGranularityChange={setRevenueGranularity}
                    customStart={revenueCustomStart}
                    customEnd={revenueCustomEnd}
                    onCustomStartChange={setRevenueCustomStart}
                    onCustomEndChange={setRevenueCustomEnd}
                  />
                </CardHeader>
                <CardContent className="p-0">
                  {settlements.length === 0 ? (
                    <p className="py-8 text-center text-xs text-muted-foreground">No completed orders in this period yet.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-4">Restaurant</TableHead>
                          <TableHead className="text-right">Orders</TableHead>
                          <TableHead className="text-right">Revenue</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Commission</TableHead>
                          <TableHead className="pr-4 text-right">Amount owed</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {settlements.map((row) => (
                          <TableRow key={row.restaurant_id || row.restaurant_name}>
                            <TableCell className="pl-4 font-medium">{row.restaurant_name}</TableCell>
                            <TableCell className="text-right tabular-nums">{number0(row.orders)}</TableCell>
                            <TableCell className="text-right tabular-nums">{money2(row.revenue)}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{row.commission_rate}%</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{money2(row.commission)}</TableCell>
                            <TableCell className="pr-4 text-right font-semibold tabular-nums">{money2(row.amount_owed)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="payouts" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <CardTitle className="text-base">Driver payouts</CardTitle>
                    <CardDescription>
                      Each driver keeps the delivery fee from every completed delivery, minus a{" "}
                      {money(DRIVER_COMMISSION_PER_DELIVERY)} platform commission per delivery.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <PeriodControl
                      granularity={payoutGranularity}
                      onGranularityChange={setPayoutGranularity}
                      customStart={payoutCustomStart}
                      customEnd={payoutCustomEnd}
                      onCustomStartChange={setPayoutCustomStart}
                      onCustomEndChange={setPayoutCustomEnd}
                    />
                    {staff.hasPermission("finance.manage") && (
                      <Button
                        size="sm"
                        disabled={pendingPayouts.length === 0 || payAllMutation.isPending}
                        onClick={() =>
                          payAllMutation.mutate({ rows: pendingPayouts, actor: staff.session?.email ?? null })
                        }
                      >
                        {payAllMutation.isPending ? (
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1.5 size-3.5" />
                        )}
                        Pay all pending ({pendingPayouts.length})
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {payoutsQuery.isLoading && (
                    <p className="py-8 text-center text-xs text-muted-foreground">Loading…</p>
                  )}
                  {!payoutsQuery.isLoading && payouts.length === 0 && (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      No completed deliveries in this period yet.
                    </p>
                  )}
                  {payouts.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-4">Driver</TableHead>
                          <TableHead className="text-right">Deliveries</TableHead>
                          <TableHead className="text-right">Delivery fees</TableHead>
                          <TableHead className="text-right">Platform commission</TableHead>
                          <TableHead className="text-right">Amount due</TableHead>
                          <TableHead className="text-right">Status</TableHead>
                          <TableHead className="pr-4 text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payouts.map((row) => {
                          const isPaying =
                            markPaidMutation.isPending &&
                            markPaidMutation.variables?.row.driver_id === row.driver_id;
                          return (
                            <TableRow key={row.driver_id}>
                              <TableCell className="pl-4 font-medium">{row.driver_name}</TableCell>
                              <TableCell className="text-right tabular-nums">{number0(row.deliveries)}</TableCell>
                              <TableCell className="text-right tabular-nums">{money2(row.gross_delivery_fees)}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{money2(row.commission)}</TableCell>
                              <TableCell className="text-right font-semibold tabular-nums">{money2(row.amount_due)}</TableCell>
                              <TableCell className="text-right">
                                <Badge variant="outline" className={row.status === "paid" ? statusTone["settled"] : statusTone["pending"]}>
                                  {row.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="pr-4 text-right">
                                {row.status === "pending" && staff.hasPermission("finance.manage") ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={isPaying || payAllMutation.isPending}
                                    onClick={() =>
                                      markPaidMutation.mutate({ row, actor: staff.session?.email ?? null })
                                    }
                                  >
                                    {isPaying && <Loader2 className="mr-1 size-3.5 animate-spin" />}
                                    Mark paid
                                  </Button>
                                ) : row.status === "paid" ? (
                                  <span className="text-[11px] text-muted-foreground">
                                    Paid {row.paid_at ? new Date(row.paid_at).toLocaleDateString("en-ZA") : ""}
                                  </span>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="refunds" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Refunds & credits</CardTitle>
                  <CardDescription>Cancelled and refunded orders, most recent first.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {refundedOrders.slice(0, 20).map((o) => (
                    <div key={o.id} className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                      <div>
                        <p className="text-sm font-medium">{o.order_number}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {o.restaurant_name} · {new Date(o.placed_at).toLocaleDateString("en-ZA")} · {o.payment_method}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-destructive">-{money2(o.total)}</p>
                        <Badge variant="outline" className="text-[9px] uppercase">{o.status}</Badge>
                      </div>
                    </div>
                  ))}
                  {refundedOrders.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">No refunds issued.</p>}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <Dialog
            open={Boolean(rejectTarget)}
            onOpenChange={(open) => {
              if (!open) {
                setRejectTarget(null);
                setRejectReason("");
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <XCircle className="size-4 text-destructive" /> Reject proof of payment —{" "}
                  {rejectTarget?.order_number}
                </DialogTitle>
                <DialogDescription>
                  The order stays unaccepted. Staff decide separately whether to also reject or
                  cancel the order itself.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="pop-reject-reason">Reason for rejection</Label>
                <Textarea
                  id="pop-reject-reason"
                  rows={3}
                  placeholder="e.g. Amount doesn't match the order total / Document is illegible / No proof uploaded…"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>
              <DialogFooter>
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
                  disabled={!rejectReason.trim() || rejectMutation.isPending}
                  onClick={() =>
                    rejectTarget &&
                    rejectMutation.mutate({
                      orderId: rejectTarget.order_id,
                      reason: rejectReason,
                      actor: staff.session?.email ?? null,
                    })
                  }
                >
                  {rejectMutation.isPending ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <XCircle className="mr-1.5 size-4" />
                  )}
                  Reject
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </PermissionGate>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  delta,
  positive,
  tone,
}: {
  icon: typeof Receipt;
  label: string;
  value: string;
  delta?: string;
  positive?: boolean;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-muted p-2"><Icon className={`size-4 ${tone ?? "text-primary"}`} /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="flex items-baseline gap-2 text-lg font-semibold">
            {value}
            {delta && (
              <span className={`text-[10px] ${positive ? "text-emerald-400" : "text-destructive"}`}>
                {delta}
              </span>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function PeriodControl({
  granularity,
  onGranularityChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
}: {
  granularity: PeriodGranularity;
  onGranularityChange: (g: PeriodGranularity) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (v: string) => void;
  onCustomEndChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Period</Label>
        <Select value={granularity} onValueChange={(v) => onGranularityChange(v as PeriodGranularity)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Today</SelectItem>
            <SelectItem value="week">This week</SelectItem>
            <SelectItem value="month">This month</SelectItem>
            <SelectItem value="custom">Custom range</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {granularity === "custom" && (
        <>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">From</Label>
            <Input type="date" value={customStart} onChange={(e) => onCustomStartChange(e.target.value)} className="w-36" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">To</Label>
            <Input type="date" value={customEnd} onChange={(e) => onCustomEndChange(e.target.value)} className="w-36" />
          </div>
        </>
      )}
    </div>
  );
}
