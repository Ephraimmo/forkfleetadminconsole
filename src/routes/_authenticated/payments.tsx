import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@/lib/use-demo-fn";
import {
  CreditCard,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Receipt,
  Banknote,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Download,
  Search,
  Clock,
  CheckCircle2,
  XCircle,
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

import { listDrivers } from "@/lib/dispatch.functions";
import {
  drivers as seededDrivers,
  orders as seededOrders,
  restaurants as seededRestaurants,
} from "@/lib/demo-store";
import { money, money2, number0 } from "@/lib/demo-formatters";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({
    meta: [
      { title: "Payments — ForkFleet Console" },
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

function PaymentsPage() {
  const [tab, setTab] = useState("overview");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const fetchDrivers = useServerFn(listDrivers);
  const driversQuery = useQuery({ queryKey: ["drivers-payments"], queryFn: () => fetchDrivers({}) });

  const { delivered, refunded, revenueByDay, methodMix, transactions } = useMemo(() => {
    const delivered = seededOrders.filter((o) => o.status === "delivered");
    const refunded = seededOrders.filter((o) => o.status === "refunded" || o.status === "cancelled");
    const gmv = delivered.reduce((s, o) => s + o.total, 0);
    const commission = delivered.reduce((s, o) => s + o.commission, 0);
    const deliveryFees = delivered.reduce((s, o) => s + o.delivery_fee, 0);
    const refunds = refunded.reduce((s, o) => s + o.total, 0);

    // Last 14 days pseudo-trend from delivered orders
    const byDay = new Map<string, { day: string; revenue: number; orders: number }>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, { day: key.slice(5), revenue: 0, orders: 0 });
    }
    for (const o of delivered) {
      const key = o.placed_at.slice(0, 10);
      const entry = byDay.get(key);
      if (entry) {
        entry.revenue += o.total;
        entry.orders += 1;
      }
    }
    const revenueByDay = Array.from(byDay.values());

    // Mix of payment methods
    const methods = new Map<string, number>();
    for (const o of delivered) methods.set(o.payment_method, (methods.get(o.payment_method) ?? 0) + 1);
    const methodMix = Array.from(methods.entries()).map(([name, value]) => ({ name: name.toUpperCase(), value }));

    // Transactions table — take last 25 delivered orders
    const txs = delivered
      .slice()
      .sort((a, b) => b.placed_at.localeCompare(a.placed_at))
      .slice(0, 40)
      .map((o, idx) => {
        const statuses = ["settled", "pending", "settled", "processing", "settled", "failed"] as const;
        const s = statuses[idx % statuses.length]!;
        return {
          id: `TX-${(10000 + idx).toString()}`,
          order: o.order_number,
          restaurant: seededRestaurants.find((r) => r.id === o.restaurant_id)?.name ?? "—",
          method: o.payment_method,
          total: o.total,
          commission: o.commission,
          delivery: o.delivery_fee,
          status: s,
          date: o.delivered_at ?? o.placed_at,
        };
      });

    return {
      delivered,
      refunded,
      gmv,
      commission,
      deliveryFees,
      refunds,
      revenueByDay,
      methodMix,
      transactions: txs,
    };
  }, []);

  const driverPayouts = useMemo(
    () => seededDrivers.slice().sort((a, b) => b.wallet_balance - a.wallet_balance).slice(0, 10),
    [],
  );

  const filteredTx = useMemo(
    () =>
      transactions
        .filter((t) => status === "all" || t.status === status)
        .filter(
          (t) =>
            !search ||
            t.id.toLowerCase().includes(search.toLowerCase()) ||
            t.order.toLowerCase().includes(search.toLowerCase()) ||
            t.restaurant.toLowerCase().includes(search.toLowerCase()),
        ),
    [transactions, status, search],
  );

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
          <Button size="sm">
            <RefreshCw className="mr-1.5 size-3.5" /> Run payout batch
          </Button>
        </div>
      }
    >
      {() => (
        <div className="space-y-4">
          {/* KPI strip */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              icon={Receipt}
              label="Gross revenue (delivered)"
              value={money(revenueByDay.reduce((s, d) => s + d.revenue, 0))}
              delta="+12.4%"
              positive
            />
            <Kpi icon={TrendingUp} label="Platform commission" value={money(delivered.reduce((s, o) => s + o.commission, 0))} delta="+8.1%" positive tone="text-emerald-400" />
            <Kpi icon={ArrowUpRight} label="Delivery fees" value={money(delivered.reduce((s, o) => s + o.delivery_fee, 0))} delta="+3.2%" positive />
            <Kpi icon={TrendingDown} label="Refunds (cancelled)" value={money(refunded.reduce((s, o) => s + o.total, 0))} delta="−1.8%" tone="text-destructive" />
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
              <TabsTrigger value="settlements">Settlements</TabsTrigger>
              <TabsTrigger value="payouts">Driver payouts</TabsTrigger>
              <TabsTrigger value="refunds">Refunds</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-4">
              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Revenue trend (14 days)</CardTitle>
                    <CardDescription>Daily gross revenue from delivered orders</CardDescription>
                  </CardHeader>
                  <CardContent className="h-72 px-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={revenueByDay} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="day" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
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
                    <CardDescription>Share of delivered orders</CardDescription>
                  </CardHeader>
                  <CardContent className="h-72">
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
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Pending settlements (restaurants)</CardTitle>
                    <CardDescription>Waiting to be paid out in the next batch</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {seededRestaurants.slice(0, 5).map((r, i) => {
                      const owed = Math.round(delivered.filter((o) => o.restaurant_id === r.id).reduce((s, o) => s + (o.total - o.commission), 0));
                      return (
                        <div key={r.id} className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0">
                          <div className="flex items-center gap-2">
                            <span className="flex size-8 items-center justify-center rounded-md bg-muted text-xs font-semibold">{r.name[0]}</span>
                            <div>
                              <p className="text-sm font-medium">{r.name}</p>
                              <p className="text-[11px] text-muted-foreground">{r.cuisine}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold">{money(owed)}</p>
                            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/15 text-amber-400 text-[9px] uppercase">{i === 0 ? "today" : "queued"}</Badge>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Driver wallet balances</CardTitle>
                    <CardDescription>Available for instant cash-out or weekly payout</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {driverPayouts.slice(0, 5).map((d) => (
                      <div key={d.id} className="flex items-center justify-between border-b border-border/60 pb-2 last:border-0">
                        <div className="flex items-center gap-2">
                          <Wallet className="size-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">{d.full_name}</p>
                            <p className="text-[11px] text-muted-foreground">{d.vehicle_type} • {d.total_deliveries} deliveries</p>
                          </div>
                        </div>
                        <p className="text-sm font-semibold">{money(d.wallet_balance)}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="transactions" className="mt-4 space-y-4">
              <Card>
                <CardContent className="flex flex-wrap items-end gap-3 p-4">
                  <div className="relative min-w-[220px] flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                    <Input placeholder="Search TX id, order #, restaurant…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="settled">Settled</SelectItem>
                      <SelectItem value="processing">Processing</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Transaction</TableHead>
                        <TableHead>Order</TableHead>
                        <TableHead>Restaurant</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Commission</TableHead>
                        <TableHead className="text-right">Delivery</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTx.slice(0, 20).map((t) => {
                        const Icon = t.status === "settled" ? CheckCircle2 : t.status === "failed" ? XCircle : t.status === "processing" ? RefreshCw : Clock;
                        return (
                          <TableRow key={t.id}>
                            <TableCell className="pl-4 font-mono text-xs">{t.id}</TableCell>
                            <TableCell className="font-medium">{t.order}</TableCell>
                            <TableCell className="text-muted-foreground">{t.restaurant}</TableCell>
                            <TableCell className="uppercase text-xs text-muted-foreground">{t.method}</TableCell>
                            <TableCell className="text-right tabular-nums">{money2(t.total)}</TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-400">{money2(t.commission)}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{money2(t.delivery)}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline" className={statusTone[t.status] + " gap-1"}>
                                <Icon className="size-3" /> {t.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="settlements" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Weekly settlement batches</CardTitle>
                  <CardDescription>Automated every Monday at 02:00 SAST. Restaurants can be paid manually at any time.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { id: "STL-2026-W31", date: "4 Aug 2026", restaurants: 8, amount: 184204.5, status: "settled" },
                    { id: "STL-2026-W30", date: "28 Jul 2026", restaurants: 8, amount: 172510.2, status: "settled" },
                    { id: "STL-2026-W32", date: "11 Aug 2026", restaurants: 8, amount: 64320.0, status: "pending" },
                  ].map((b) => (
                    <div key={b.id} className="flex items-center justify-between rounded-lg border border-border/70 p-3">
                      <div>
                        <p className="font-medium">{b.id}</p>
                        <p className="text-[11px] text-muted-foreground">{b.date} • {b.restaurants} restaurants</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="font-semibold">{money(b.amount)}</p>
                        <Badge variant="outline" className={statusTone[b.status]}>{b.status}</Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="payouts" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Driver payouts</CardTitle>
                  <CardDescription>Wallet balances paid weekly or cashed out instantly.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Driver</TableHead>
                        <TableHead>Vehicle</TableHead>
                        <TableHead className="text-right">Deliveries</TableHead>
                        <TableHead className="text-right">Rating</TableHead>
                        <TableHead className="text-right">Available</TableHead>
                        <TableHead className="pr-4 text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {driverPayouts.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="pl-4 font-medium">{d.full_name}</TableCell>
                          <TableCell className="text-muted-foreground capitalize">{d.vehicle_type}{d.vehicle_plate ? ` • ${d.vehicle_plate}` : ""}</TableCell>
                          <TableCell className="text-right tabular-nums">{number0(d.total_deliveries)}</TableCell>
                          <TableCell className="text-right tabular-nums">★ {d.rating.toFixed(1)}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{money2(d.wallet_balance)}</TableCell>
                          <TableCell className="pr-4 text-right">
                            <Button size="sm" variant="outline">Pay out</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="refunds" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Refunds & credits</CardTitle>
                  <CardDescription>Partial and full refunds across orders, with approval trail.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {refunded.slice(0, 6).map((o) => (
                    <div key={o.id} className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                      <div>
                        <p className="text-sm font-medium">{o.order_number}</p>
                        <p className="text-[11px] text-muted-foreground">{new Date(o.placed_at).toLocaleDateString()} • {o.payment_method}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-destructive">-{money2(o.total)}</p>
                        <Badge variant="outline" className="text-[9px] uppercase">{o.status}</Badge>
                      </div>
                    </div>
                  ))}
                  {refunded.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">No refunds issued this period.</p>}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
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
                {positive ? <ArrowUpRight className="mr-0.5 inline size-3" /> : <ArrowDownLeft className="mr-0.5 inline size-3" />}
                {delta}
              </span>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
