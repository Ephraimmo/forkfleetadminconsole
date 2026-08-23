import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@/lib/use-demo-fn";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  Bike,
  ChefHat,
  CircleDollarSign,
  Clock,
  PackageCheck,
  ShoppingBag,
  Store,
  Truck,
  Users,
  XCircle,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getDashboard, type DashboardPayload } from "@/lib/dashboard.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Live Operations Dashboard | ForkFleet Console" },
      {
        name: "description",
        content:
          "Track live orders, revenue, restaurant and driver performance across the ForkFleet delivery network in real time.",
      },
      { property: "og:title", content: "Live Operations Dashboard | ForkFleet Console" },
      {
        property: "og:description",
        content: "Live orders, revenue trends, dispatch queues and fleet performance in one operations console.",
      },
    ],
  }),
  component: DashboardPage,
});

const money = (value: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(value);

const statusTone: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  accepted: "bg-info/15 text-info",
  preparing: "bg-primary/15 text-primary",
  ready: "bg-primary/20 text-primary",
  assigned: "bg-info/15 text-info",
  picked_up: "bg-info/20 text-info",
  on_the_way: "bg-info/25 text-info",
  delivered: "bg-success/15 text-success",
  cancelled: "bg-destructive/15 text-destructive",
  refunded: "bg-destructive/10 text-destructive",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${
        statusTone[status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function Metric({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof Store;
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <div className="flex items-start justify-between">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <Icon className="size-4 text-primary" />
        </div>
        <p className="metric-figure mt-2 text-2xl font-semibold">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const fetchDashboard = useServerFn(getDashboard);
  const { data, isLoading, isError, refetch } = useQuery<DashboardPayload>({
    queryKey: ["dashboard"],
    queryFn: () => fetchDashboard(),
    refetchInterval: 20_000,
  });

  const counts = data?.metrics.status_counts ?? {};
  const pipeline = [
    { label: "Pending", value: counts["pending"] ?? 0, icon: Clock },
    { label: "Preparing", value: counts["preparing"] ?? 0, icon: ChefHat },
    { label: "Ready for pickup", value: counts["ready"] ?? 0, icon: PackageCheck },
    { label: "Out for delivery", value: (counts["picked_up"] ?? 0) + (counts["on_the_way"] ?? 0), icon: Truck },
    { label: "Delivered", value: counts["delivered"] ?? 0, icon: ShoppingBag },
    { label: "Cancelled", value: (counts["cancelled"] ?? 0) + (counts["refunded"] ?? 0), icon: XCircle },
  ];

  return (
    <AppShell
      breadcrumb={["Operations", "Dashboard"]}
      title="Live operations"
      description="Network-wide view of orders, revenue, restaurants and fleet, refreshed every 20 seconds."
      actions={
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Refresh now
        </Button>
      }
    >
      {isError && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Could not load operations data</CardTitle>
            <CardDescription>Check your connection and try refreshing.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {isLoading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : data ? (
        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Orders today"
              value={String(data.metrics.today_orders)}
              hint={`${money(data.metrics.today_revenue)} delivered revenue`}
              icon={ShoppingBag}
            />
            <Metric
              label="Revenue (30 days)"
              value={money(data.metrics.month_revenue)}
              hint={`${money(data.metrics.week_revenue)} in the last 7 days`}
              icon={CircleDollarSign}
            />
            <Metric
              label="Commission earned"
              value={money(data.metrics.commission_earned)}
              hint={`Avg order ${money(data.metrics.avg_order_value)}`}
              icon={ArrowUpRight}
            />
            <Metric
              label="Fleet online"
              value={`${data.metrics.drivers_online}/${data.metrics.drivers_total}`}
              hint={`${data.metrics.restaurants_pending} restaurants awaiting approval`}
              icon={Bike}
            />
          </section>

          <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {pipeline.map((stage) => (
              <Card key={stage.label} className="gap-0 py-3">
                <CardContent className="flex items-center gap-3 px-4">
                  <span className="flex size-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                    <stage.icon className="size-4" />
                  </span>
                  <div>
                    <p className="metric-figure text-xl font-semibold">{stage.value}</p>
                    <p className="text-xs text-muted-foreground">{stage.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Revenue &amp; order trend</CardTitle>
                <CardDescription>Delivered revenue and total orders, last 14 days</CardDescription>
              </CardHeader>
              <CardContent className="h-72 px-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="day"
                      tickFormatter={(d: string) => d.slice(5)}
                      stroke="var(--color-muted-foreground)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="var(--color-muted-foreground)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      width={54}
                      tickFormatter={(v: number) => `R${Math.round(v / 1000)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        color: "var(--color-popover-foreground)",
                        fontSize: 12,
                      }}
                      formatter={(value: number, name: string) =>
                        name === "revenue" ? [money(value), "Revenue"] : [value, "Orders"]
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke="var(--color-chart-1)"
                      strokeWidth={2}
                      fill="url(#revenueFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top selling meals</CardTitle>
                <CardDescription>Units sold across the network</CardDescription>
              </CardHeader>
              <CardContent className="h-72 px-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.topItems} layout="vertical" margin={{ left: 8, right: 12 }}>
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      stroke="var(--color-muted-foreground)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--color-secondary)" }}
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        color: "var(--color-popover-foreground)",
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="units" fill="var(--color-chart-1)" radius={[0, 4, 4, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Live order queue</CardTitle>
                <CardDescription>Orders currently moving through kitchens and dispatch</CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Order</TableHead>
                      <TableHead>Restaurant</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Driver</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="pr-6 text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.liveOrders.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          No orders in flight right now.
                        </TableCell>
                      </TableRow>
                    )}
                    {data.liveOrders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="pl-6 font-medium">{order.order_number}</TableCell>
                        <TableCell className="text-muted-foreground">{order.restaurant}</TableCell>
                        <TableCell className="text-muted-foreground">{order.customer}</TableCell>
                        <TableCell className="text-muted-foreground">{order.driver ?? "Unassigned"}</TableCell>
                        <TableCell>
                          <StatusPill status={order.status} />
                        </TableCell>
                        <TableCell className="pr-6 text-right tabular-nums">{money(order.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent activity</CardTitle>
                <CardDescription>Audit trail of platform changes</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.activity.map((entry) => (
                  <div key={entry.id} className="flex gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0">
                      <p className="truncate text-sm">{entry.action.replace(/[._]/g, " ")}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {entry.actor_email ?? "system"} · {new Date(entry.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <section>
            <Tabs defaultValue="restaurants">
              <TabsList>
                <TabsTrigger value="restaurants">Top restaurants</TabsTrigger>
                <TabsTrigger value="drivers">Driver performance</TabsTrigger>
                <TabsTrigger value="customers">Best customers</TabsTrigger>
              </TabsList>

              <TabsContent value="restaurants">
                <Card>
                  <CardContent className="px-0 py-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-6">Restaurant</TableHead>
                          <TableHead>Cuisine</TableHead>
                          <TableHead className="text-right">Rating</TableHead>
                          <TableHead className="text-right">Orders</TableHead>
                          <TableHead className="pr-6 text-right">Revenue</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.topRestaurants.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="pl-6 font-medium">{r.name}</TableCell>
                            <TableCell className="text-muted-foreground">{r.cuisine}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.rating.toFixed(1)}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.orders}</TableCell>
                            <TableCell className="pr-6 text-right tabular-nums">{money(r.revenue)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="drivers">
                <Card>
                  <CardContent className="px-0 py-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-6">Driver</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Rating</TableHead>
                          <TableHead className="text-right">Deliveries</TableHead>
                          <TableHead className="pr-6 text-right">Delivery fees</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.driverPerformance.map((d) => (
                          <TableRow key={d.id}>
                            <TableCell className="pl-6 font-medium">{d.full_name}</TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="capitalize">
                                {d.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{d.rating.toFixed(1)}</TableCell>
                            <TableCell className="text-right tabular-nums">{d.deliveries}</TableCell>
                            <TableCell className="pr-6 text-right tabular-nums">{money(d.earnings)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="customers">
                <Card>
                  <CardContent className="px-0 py-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-6">Customer</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead className="text-right">Orders</TableHead>
                          <TableHead className="pr-6 text-right">Lifetime spend</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.bestCustomers.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell className="pl-6 font-medium">{c.full_name}</TableCell>
                            <TableCell className="text-muted-foreground">{c.email}</TableCell>
                            <TableCell className="text-right tabular-nums">{c.orders}</TableCell>
                            <TableCell className="pr-6 text-right tabular-nums">{money(c.spend)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="Restaurants"
              value={String(data.metrics.restaurants_total)}
              hint={`${data.metrics.restaurants_pending} pending approval`}
              icon={Store}
            />
            <Metric
              label="Customers"
              value={String(data.metrics.customers_total)}
              hint={`${data.metrics.customers_new_30d} joined in 30 days`}
              icon={Users}
            />
            <Metric
              label="Lifetime revenue"
              value={money(data.metrics.total_revenue)}
              hint="Delivered orders only"
              icon={CircleDollarSign}
            />
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
