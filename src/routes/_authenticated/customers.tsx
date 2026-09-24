import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { onOrdersChanged } from "@/lib/dispatch.functions";
import type { DispatchOrder } from "@/lib/dispatch.functions";
import { useFirebaseRestaurants } from "@/hooks/use-firebase-restaurants";
import {
  Users,
  Mail,
  Phone,
  MapPin,
  Star,
  Search,
  TrendingUp,
  ShoppingBag,
  Download,
  Filter,
  UserPlus,
  Power,
} from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  subscribeFirebaseCustomers,
  customerDisplayName,
  customerAddressLabel,
  customerIsActive,
  toggleCustomerActive,
  type FirebaseCustomer,
} from "@/lib/customers.firebase";
import { money, number0 } from "@/lib/demo-formatters";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({
    meta: [
      { title: "Customers — Hearth Admin" },
      { name: "description", content: "Customer directory, lifetime value, order history, and segments." },
    ],
  }),
  component: CustomersPage,
});

const SEGMENT_COLORS = ["oklch(0.79 0.155 71)", "oklch(0.68 0.13 240)", "oklch(0.74 0.17 150)", "oklch(0.6 0.19 20)"];

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("");
}

type OrderLike = { customer_id: string | null; customer_name: string; customer_email?: string | null; customer_phone?: string | null; status: string; total: number; placed_at: string; order_number: string; restaurant_id: string };

function computeCustomerMetrics(customer: FirebaseCustomer, orders: OrderLike[]) {
  const myOrders = orders.filter(
    (o) => o.customer_id === customer.id || (customer.email && o.customer_email === customer.email),
  );
  const delivered = myOrders.filter((o) => o.status === "delivered");
  const total = delivered.reduce((s, o) => s + o.total, 0);
  const aov = delivered.length ? total / delivered.length : 0;
  const lastOrder = [...myOrders].sort((a, b) => b.placed_at.localeCompare(a.placed_at))[0];
  const daysSince = lastOrder
    ? Math.floor((Date.now() - new Date(lastOrder.placed_at).getTime()) / 86400000)
    : null;

  let segment: "VIP" | "Regular" | "New" | "At Risk" = "Regular";
  if (delivered.length >= 15 && total > 2000) segment = "VIP";
  else if (delivered.length <= 2) segment = "New";
  else if (daysSince !== null && daysSince > 60) segment = "At Risk";

  return { orders: myOrders.length, delivered: delivered.length, total, aov, lastOrder, daysSince, segment };
}

const segmentTone: Record<string, string> = {
  VIP: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Regular: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  New: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  "At Risk": "bg-destructive/15 text-destructive border-destructive/30",
};

function CustomersPage() {
  const [search, setSearch] = useState("");
  const [restaurantFilter, setRestaurantFilter] = useState("all");
  const [segment, setSegment] = useState("all");
  const [tab, setTab] = useState("directory");

  // Live data — both listeners update this screen immediately as orders come
  // in or customer records change, no manual refresh, no polling interval.
  // See docs/RESTAURANT_ADMIN_TO_SUPER_ADMIN_CUSTOMERS_HANDOVER.md §1.1.
  const [customers, setCustomers] = useState<FirebaseCustomer[]>([]);
  const [allOrders, setAllOrders] = useState<DispatchOrder[]>([]);
  useEffect(() => subscribeFirebaseCustomers(setCustomers), []);
  useEffect(() => onOrdersChanged(setAllOrders), []);

  const { rows: restaurants } = useFirebaseRestaurants();

  // Customers have no restaurant_id of their own — "this restaurant's
  // customers" is derived by filtering orders by restaurant_id first, the
  // same way Restaurant Admin does it (handover doc §1.2). "All restaurants"
  // uses every order, unfiltered.
  const scopedOrders = useMemo(
    () =>
      restaurantFilter === "all"
        ? allOrders
        : allOrders.filter((o) => o.restaurant_id === restaurantFilter),
    [allOrders, restaurantFilter],
  );
  const scopedCustomerIds = useMemo(
    () =>
      restaurantFilter === "all"
        ? null
        : new Set(scopedOrders.map((o) => o.customer_id).filter((id): id is string => Boolean(id))),
    [restaurantFilter, scopedOrders],
  );
  const scopedEmails = useMemo(
    () =>
      restaurantFilter === "all"
        ? null
        : new Set(
            scopedOrders.map((o) => o.customer_email).filter((e): e is string => Boolean(e)),
          ),
    [restaurantFilter, scopedOrders],
  );

  const visibleCustomers = useMemo(() => {
    if (!scopedCustomerIds && !scopedEmails) return customers;
    return customers.filter(
      (c) => scopedCustomerIds?.has(c.id) || (c.email && scopedEmails?.has(c.email)),
    );
  }, [customers, scopedCustomerIds, scopedEmails]);

  const rows = useMemo(() => {
    const base = visibleCustomers.map((c) => ({
      customer: c,
      metrics: computeCustomerMetrics(c, scopedOrders),
    }));
    return base
      .filter((r) => {
        const name = customerDisplayName(r.customer).toLowerCase();
        const email = (r.customer.email ?? "").toLowerCase();
        const phone = r.customer.phone ?? "";
        return (
          !search ||
          name.includes(search.toLowerCase()) ||
          email.includes(search.toLowerCase()) ||
          phone.includes(search)
        );
      })
      .filter((r) => segment === "all" || r.metrics.segment === segment)
      .sort((a, b) => b.metrics.total - a.metrics.total);
  }, [visibleCustomers, scopedOrders, search, segment]);

  const kpis = useMemo(() => {
    const totals = visibleCustomers.map((c) => computeCustomerMetrics(c, scopedOrders));
    return {
      total: visibleCustomers.length,
      new30: totals.filter((t) => t.delivered <= 3).length,
      vip: totals.filter((t) => t.segment === "VIP").length,
      revenue: totals.reduce((s, t) => s + t.total, 0),
      aov: totals.length ? totals.reduce((s, t) => s + t.aov, 0) / totals.length : 0,
      atRisk: totals.filter((t) => t.segment === "At Risk").length,
    };
  }, [visibleCustomers, scopedOrders]);

  const segmentBreakdown = useMemo(() => {
    const counts: Record<string, number> = { VIP: 0, Regular: 0, New: 0, "At Risk": 0 };
    visibleCustomers.forEach((c) => {
      const m = computeCustomerMetrics(c, scopedOrders);
      counts[m.segment] = (counts[m.segment] ?? 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [visibleCustomers, scopedOrders]);

  const topSpenders = useMemo(
    () =>
      visibleCustomers
        .map((c) => {
          const m = computeCustomerMetrics(c, scopedOrders);
          return { name: customerDisplayName(c), value: Math.round(m.total) };
        })
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
    [visibleCustomers, scopedOrders],
  );

  // Also pick up guest (no customer_id) orders for the activity feed.
  const recentOrders = useMemo(
    () => [...scopedOrders].sort((a, b) => b.placed_at.localeCompare(a.placed_at)).slice(0, 12),
    [scopedOrders],
  );

  async function handleToggleActive(customer: FirebaseCustomer) {
    try {
      await toggleCustomerActive(customer);
      toast.success(
        customerIsActive(customer)
          ? `${customerDisplayName(customer)} deactivated`
          : `${customerDisplayName(customer)} reactivated`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update customer status");
    }
  }

  function exportCsv() {
    const cols = ["Name", "Email", "Phone", "Status", "Segment", "Orders", "Delivered", "LTV", "AOV", "Last order (days)"];
    const lines = rows.map((r) => [
      customerDisplayName(r.customer),
      r.customer.email ?? "",
      r.customer.phone ?? "",
      customerIsActive(r.customer) ? "Active" : "Inactive",
      r.metrics.segment,
      r.metrics.orders,
      r.metrics.delivered,
      r.metrics.total.toFixed(2),
      r.metrics.aov.toFixed(2),
      r.metrics.daysSince ?? "",
    ].join(","));
    const csv = [cols.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PermissionGate
      required={["customers.view", "orders.view"]}
      breadcrumb={["Commerce", "Customers"]}
      title="Customers"
      description="Directory of every diner on the network, with lifetime spend, favourite restaurants, order history and segmentation."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-1.5 size-3.5" /> Export CSV
          </Button>
          <Button size="sm">
            <UserPlus className="mr-1.5 size-3.5" /> Add customer
          </Button>
        </div>
      }
    >
      {() => (
        <div className="space-y-4">
          {/* KPI strip */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Kpi icon={Users} label="Total customers" value={number0(kpis.total)} />
            <Kpi icon={UserPlus} label="New (≤3 orders)" value={number0(kpis.new30)} tone="text-sky-400" />
            <Kpi icon={Star} label="VIP customers" value={number0(kpis.vip)} tone="text-amber-400" />
            <Kpi icon={TrendingUp} label="Lifetime revenue" value={money(kpis.revenue)} />
            <Kpi icon={ShoppingBag} label="Avg order value" value={money(kpis.aov)} tone="text-emerald-400" />
            <Kpi icon={Filter} label="At risk" value={number0(kpis.atRisk)} tone="text-destructive" />
          </div>

          {/* Charts */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top customers by lifetime value</CardTitle>
                <CardDescription>Ranked by total delivered revenue in ZAR</CardDescription>
              </CardHeader>
              <CardContent className="h-64 px-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topSpenders} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} layout="vertical">
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `R${Math.round(v / 1000)}k`} />
                    <YAxis type="category" dataKey="name" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={120} />
                    <Tooltip
                      cursor={{ fill: "var(--color-secondary)" }}
                      contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => money(v)}
                    />
                    <Bar dataKey="value" fill="var(--color-chart-1)" radius={[0, 4, 4, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Segments</CardTitle>
                <CardDescription>Breakdown by customer tier</CardDescription>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={segmentBreakdown} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                      {segmentBreakdown.map((_, i) => (
                        <Cell key={i} fill={SEGMENT_COLORS[i % SEGMENT_COLORS.length]} stroke="var(--color-card)" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                  {segmentBreakdown.map((s, i) => (
                    <div key={s.name} className="flex items-center gap-1.5">
                      <span className="inline-block size-2.5 rounded-full" style={{ background: SEGMENT_COLORS[i] }} />
                      <span className="text-muted-foreground">{s.name}</span>
                      <span className="ml-auto font-medium">{s.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters + Table */}
          <Tabs value={tab} onValueChange={setTab}>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0 pb-4">
              <div className="flex-1">
                <CardTitle className="text-base">Customer directory</CardTitle>
                <CardDescription>{rows.length} customer{rows.length === 1 ? "" : "s"} shown</CardDescription>
              </div>
              <TabsList>
                <TabsTrigger value="directory">Directory</TabsTrigger>
                <TabsTrigger value="segments">Segments</TabsTrigger>
                <TabsTrigger value="activity">Recent activity</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input placeholder="Search name, email, phone…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Select value={restaurantFilter} onValueChange={setRestaurantFilter}>
                  <SelectTrigger className="w-52">
                    <SelectValue placeholder="All restaurants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All restaurants</SelectItem>
                    {restaurants.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={segment} onValueChange={setSegment}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="All segments" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All segments</SelectItem>
                    <SelectItem value="VIP">VIP</SelectItem>
                    <SelectItem value="Regular">Regular</SelectItem>
                    <SelectItem value="New">New</SelectItem>
                    <SelectItem value="At Risk">At Risk</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <TabsContent value="directory" className="mt-0">
                <div className="overflow-hidden rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Segment</TableHead>
                        <TableHead className="text-right">Orders</TableHead>
                        <TableHead className="text-right">LTV</TableHead>
                        <TableHead className="text-right">Avg order</TableHead>
                        <TableHead className="text-right">Last order</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.slice(0, 18).map((r) => (
                        <TableRow key={r.customer.id}>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <Avatar className="size-8">
                                <AvatarFallback className="bg-primary/15 text-primary text-xs">{initials(customerDisplayName(r.customer))}</AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-sm font-medium leading-tight">{customerDisplayName(r.customer)}</p>
                                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <MapPin className="size-3" /> {customerAddressLabel(r.customer)}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.customer.email && <div className="flex items-center gap-1"><Mail className="size-3" /> {r.customer.email}</div>}
                            {r.customer.phone && <div className="flex items-center gap-1"><Phone className="size-3" /> {r.customer.phone}</div>}
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => void handleToggleActive(r.customer)}
                              className="inline-flex items-center gap-1"
                              title={customerIsActive(r.customer) ? "Click to deactivate" : "Click to reactivate"}
                            >
                              <Badge
                                variant="outline"
                                className={
                                  customerIsActive(r.customer)
                                    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                                    : "border-muted-foreground/30 text-muted-foreground"
                                }
                              >
                                <Power className="mr-1 size-3" />
                                {customerIsActive(r.customer) ? "Active" : "Inactive"}
                              </Badge>
                            </button>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={segmentTone[r.metrics.segment]}>{r.metrics.segment}</Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.metrics.delivered}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{money(r.metrics.total)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{money(r.metrics.aov)}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {r.metrics.daysSince === null ? "—" : `${r.metrics.daysSince}d ago`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="segments" className="mt-0">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  {(["VIP", "Regular", "New", "At Risk"] as const).map((s) => {
                    const members = rows.filter((r) => r.metrics.segment === s);
                    const rev = members.reduce((acc, r) => acc + r.metrics.total, 0);
                    return (
                      <Card key={s} className="border-dashed">
                        <CardContent className="space-y-2 p-4">
                          <Badge variant="outline" className={segmentTone[s]}>{s}</Badge>
                          <p className="text-2xl font-semibold">{members.length}</p>
                          <p className="text-xs text-muted-foreground">{money(rev)} combined LTV</p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="activity" className="mt-0">
                <Card>
                  <CardContent className="space-y-2 p-4">
                    {recentOrders.length === 0 ? (
                        <p className="py-8 text-center text-xs text-muted-foreground">No orders yet — place an order from the customer app and it will appear here.</p>
                      ) : recentOrders.map((o) => {
                        const cust = customers.find((c) => c.id === o.customer_id) ?? null;
                        return (
                          <div key={o.id} className="flex items-center gap-3 border-b border-border/60 pb-2 last:border-0">
                            <ShoppingBag className="size-4 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm">
                                <span className="font-medium">{cust ? customerDisplayName(cust) : o.customer_name}</span>{" "}
                                <span className="text-muted-foreground">placed {o.order_number}</span>
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {new Date(o.placed_at).toLocaleString()} • {o.status.replace(/_/g, " ")}
                              </p>
                            </div>
                            <Badge variant="secondary">{money(o.total)}</Badge>
                          </div>
                        );
                      })}
                  </CardContent>
                </Card>
              </TabsContent>
            </CardContent>
          </Card>
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
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-muted p-2"><Icon className={`size-4 ${tone ?? "text-primary"}`} /></div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
