import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, FileBarChart, FileSpreadsheet, RefreshCcw } from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useServerFn } from "@/lib/use-demo-fn";
import { generateReport, type ReportKind } from "@/lib/reports.functions";
import { useFirebaseRestaurants } from "@/hooks/use-firebase-restaurants";

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports & Exports — ForkFleet Console" },
      {
        name: "description",
        content: "Build order, revenue and driver reports by date range and restaurant, then export the results.",
      },
      { property: "og:title", content: "Reports & Exports — ForkFleet Console" },
      { property: "og:description", content: "Order, revenue and driver reporting with CSV export." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const [kind, setKind] = useState<ReportKind>("orders");
  const [filters, setFilters] = useState<{ dateFrom: string; dateTo: string; restaurantId: string; status: string }>({
    dateFrom: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10),
    dateTo: new Date().toISOString().slice(0, 10),
    restaurantId: "all",
    status: "all",
  });
  const [nonce, setNonce] = useState(0);

  const fetchReport = useServerFn(generateReport);

  const { rows: _fbRestaurants } = useFirebaseRestaurants();
  const restaurantsQuery = { data: _fbRestaurants, isLoading: false };

  const queryKey = useMemo(
    () => ["report", kind, filters.dateFrom, filters.dateTo, filters.restaurantId, filters.status, nonce] as const,
    [kind, filters, nonce],
  );
  const reportQuery = useQuery({
    queryKey,
    queryFn: () => {
      const payload: { dateFrom?: string; dateTo?: string; restaurantId?: string; status?: string } = {};
      if (filters.dateFrom) payload.dateFrom = new Date(filters.dateFrom).toISOString();
      if (filters.dateTo) payload.dateTo = new Date(filters.dateTo + "T23:59:59").toISOString();
      if (filters.restaurantId !== "all") payload.restaurantId = filters.restaurantId;
      if (filters.status !== "all") payload.status = filters.status;
      return fetchReport(kind, payload);
    },
  });

  function download(filetype: "csv" | "json") {
    const r = reportQuery.data;
    if (!r) return;
    let blob: Blob;
    let filename: string;
    if (filetype === "csv") {
      blob = new Blob([r.csv], { type: "text/csv" });
      filename = `${r.kind}-report-${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
      filename = `${r.kind}-report-${new Date().toISOString().slice(0, 10)}.json`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const statusOptions =
    kind === "orders"
      ? ["all", "pending", "accepted", "preparing", "ready", "assigned", "picked_up", "on_the_way", "delivered", "cancelled", "refunded"]
      : kind === "drivers"
      ? ["all", "online", "busy", "offline", "suspended", "pending"]
      : ["all"];

  return (
    <PermissionGate
      required={["reports.view"]}
      breadcrumb={["Commerce", "Reports"]}
      title="Reports"
      description="Downloadable CSV/JSON reports with demo filters and summary charts."
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setNonce((n) => n + 1)}>
            <RefreshCcw className="mr-2 size-4" /> Refresh
          </Button>
          <Button variant="outline" onClick={() => download("csv")} disabled={!reportQuery.data}>
            <FileSpreadsheet className="mr-2 size-4" /> CSV
          </Button>
          <Button onClick={() => download("json")} disabled={!reportQuery.data}>
            <Download className="mr-2 size-4" /> JSON
          </Button>
        </div>
      }
    >
      <Tabs value={kind} onValueChange={(v) => setKind(v as ReportKind)}>
        <TabsList>
          <TabsTrigger value="orders"><FileBarChart className="mr-1 size-3.5" />Orders</TabsTrigger>
          <TabsTrigger value="drivers"><FileBarChart className="mr-1 size-3.5" />Drivers</TabsTrigger>
          <TabsTrigger value="inventory"><FileBarChart className="mr-1 size-3.5" />Inventory</TabsTrigger>
        </TabsList>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Filters</CardTitle>
            <CardDescription>Adjust the demo filters to re-slice the data.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Date from</Label>
              <Input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Date to</Label>
              <Input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} />
            </div>
            {kind !== "inventory" && (
              <div className="space-y-1.5">
                <Label>Restaurant</Label>
                <Select value={filters.restaurantId} onValueChange={(v) => setFilters({ ...filters, restaurantId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="All restaurants" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All restaurants</SelectItem>
                    {(restaurantsQuery.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <TabsContent value={kind} className="mt-4 space-y-4">
          {reportQuery.isLoading || !reportQuery.data ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-72 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {reportQuery.data.summary.map((s) => (
                  <Card key={s.label}>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="mt-1 text-xl font-semibold">{s.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {reportQuery.data.charts.map((chart, idx) => (
                  <Card key={chart.title}>
                    <CardHeader>
                      <CardTitle className="text-sm">{chart.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chart.series}>
                          <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip
                            cursor={{ fill: "hsl(var(--muted))" }}
                            contentStyle={{
                              background: "hsl(var(--popover))",
                              border: "1px solid hsl(var(--border))",
                              fontSize: 12,
                              borderRadius: 8,
                            }}
                          />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {chart.series.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base">{reportQuery.data.title} rows</CardTitle>
                    <CardDescription>
                      {reportQuery.data.rows.length} rows · generated {new Date(reportQuery.data.generatedAt).toLocaleString()}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">Demo data</Badge>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[420px]">
                    <div className="overflow-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            {reportQuery.data.columns.map((c) => (
                              <th key={c} className="px-2 py-2 font-medium whitespace-nowrap">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {reportQuery.data.rows.slice(0, 200).map((r, i) => (
                            <tr key={i} className="border-b border-border/60 hover:bg-accent/40">
                              {r.map((cell, ci) => (
                                <td key={ci} className="px-2 py-1.5 whitespace-nowrap">{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </PermissionGate>
  );
}
