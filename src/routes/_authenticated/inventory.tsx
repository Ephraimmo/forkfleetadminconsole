import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Boxes,
  Download,
  FileWarning,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  Plane,
  Search,
} from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useServerFn } from "@/lib/use-demo-fn";
import { listCustoms, listInventory, adjustStock, updateCustomsStatus } from "@/lib/inventory.functions";
import { useFirebaseRestaurants } from "@/hooks/use-firebase-restaurants";

const CUSTOMS_STATUS: Record<string, { tone: string; label: string }> = {
  draft: { tone: "bg-muted text-muted-foreground", label: "Draft" },
  submitted: { tone: "bg-sky-500/15 text-sky-400 border-sky-500/25", label: "Submitted" },
  inspection: { tone: "bg-amber-500/15 text-amber-400 border-amber-500/25", label: "Inspection" },
  held: { tone: "bg-destructive/15 text-destructive border-destructive/40", label: "Held" },
  cleared: { tone: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25", label: "Cleared" },
  rejected: { tone: "bg-muted text-destructive border-destructive/30", label: "Rejected" },
};

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({
    meta: [
      { title: "Stock & Inventory — ForkFleet Console" },
      {
        name: "description",
        content: "Track ingredient stock levels, low-stock alerts and menu availability across every kitchen.",
      },
      { property: "og:title", content: "Stock & Inventory — ForkFleet Console" },
      { property: "og:description", content: "Stock levels, low-stock alerts and menu availability per kitchen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InventoryPage,
});

function InventoryPage() {
  const queryClient = useQueryClient();
  const fetchInventory = useServerFn(listInventory);
  const fetchCustoms = useServerFn(listCustoms);

  const adjust = useServerFn(adjustStock);
  const updateStatus = useServerFn(updateCustomsStatus);

  const [tab, setTab] = useState("stock");
  const [restaurantId, setRestaurantId] = useState("all");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [importedOnly, setImportedOnly] = useState(false);
  const [customsSearch, setCustomsSearch] = useState("");
  const [customsStatus, setCustomsStatus] = useState("all");

  const { rows: _fbRestaurants } = useFirebaseRestaurants();
  const restaurantsQuery = { data: _fbRestaurants, isLoading: false };
  const inventoryQuery = useQuery({
    queryKey: ["inventory", tab, restaurantId, search, category, lowOnly, importedOnly],
    queryFn: () => {
      const payload: { restaurantId?: string; search?: string; category?: string; lowOnly?: boolean; importedOnly?: boolean } = {
        restaurantId,
        search,
        lowOnly,
        importedOnly,
      };
      if (category !== "all") payload.category = category;
      return fetchInventory(payload);
    },
    enabled: tab === "stock" || tab === "customs",
  });
  const customsQuery = useQuery({
    queryKey: ["customs", customsStatus, customsSearch],
    queryFn: () => fetchCustoms({ status: customsStatus, search: customsSearch }),
  });

  const categories = useMemo(() => {
    const set = new Set((inventoryQuery.data ?? []).map((i) => i.category));
    return ["all", ...Array.from(set).sort()];
  }, [inventoryQuery.data]);

  const stats = useMemo(() => {
    const rows = inventoryQuery.data ?? [];
    return {
      skus: rows.length,
      lowStock: rows.filter((r) => r.quantity_on_hand <= r.reorder_level).length,
      outOfStock: rows.filter((r) => r.quantity_on_hand === 0).length,
      imported: rows.filter((r) => r.is_imported).length,
      value: rows.reduce((s, r) => s + r.quantity_on_hand * r.unit_cost, 0),
    };
  }, [inventoryQuery.data]);

  const customsStats = useMemo(() => {
    const rows = customsQuery.data ?? [];
    return {
      shipments: rows.length,
      held: rows.filter((r) => r.status === "held").length,
      cleared: rows.filter((r) => r.status === "cleared").length,
    };
  }, [customsQuery.data]);

  function exportCsv() {
    const rows = inventoryQuery.data ?? [];
    const header = ["SKU", "Item", "Category", "On hand", "Reorder", "Unit", "Cost", "Origin", "Supplier"];
    const csv = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.sku,
          `"${r.name.replace(/"/g, '""')}"`,
          r.category,
          r.quantity_on_hand,
          r.reorder_level,
          r.unit,
          r.unit_cost.toFixed(2),
          r.country_of_origin ?? "Local",
          r.supplier,
        ].join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCustomsCsv() {
    const rows = customsQuery.data ?? [];
    const header = [
      "Shipment ref",
      "Item",
      "Restaurant",
      "HS code",
      "Origin",
      "Port",
      "Incoterm",
      "Declared value",
      "Duty %",
      "VAT %",
      "Landed cost",
      "Status",
      "ETA",
    ];
    const csv = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.shipment_ref,
          `"${r.item_name.replace(/"/g, '""')}"`,
          `"${r.restaurant_name.replace(/"/g, '""')}"`,
          r.hs_code,
          r.country_of_origin,
          r.port_of_entry,
          r.incoterm,
          r.declared_value.toFixed(2),
          r.import_duty_pct,
          r.vat_pct,
          r.total_landed_cost.toFixed(2),
          r.status,
          r.eta,
        ].join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const adjMutation = useMutation({
    mutationFn: (input: { id: string; delta: number; note?: string }) => adjust(input),
    onSuccess: (_, v) => {
      toast.success(v.delta > 0 ? "Stock received" : "Stock adjusted");
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
  });
  const statusMutation = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      updateStatus({ id: input.id, status: input.status as never }),
    onSuccess: () => {
      toast.success("Customs status updated");
      void queryClient.invalidateQueries({ queryKey: ["customs"] });
    },
  });

  return (
    <PermissionGate
      required={["inventory.view"]}
      breadcrumb={["Catalogue", "Inventory"]}
      title="Inventory & customs"
      description="Stock levels, reorder alerts and import/export customs entries — all driven by demo data."
      actions={
        <Button variant="outline" onClick={tab === "stock" ? exportCsv : exportCustomsCsv}>
          <Download className="mr-2 size-4" /> Export CSV
        </Button>
      }
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="stock">Stock levels</TabsTrigger>
          <TabsTrigger value="customs" className="flex items-center gap-1">
            <Plane className="size-3.5" /> Import / customs
            {customsStats.held > 0 && (
              <Badge variant="destructive" className="ml-1 h-4 px-1 text-[9px]">
                {customsStats.held} held
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard icon={Boxes} label="Total SKUs" value={stats.skus} />
            <StatCard icon={PackageCheck} label="In stock" value={stats.skus - stats.outOfStock} tone="text-emerald-400" />
            <StatCard icon={PackageMinus} label="Low stock" value={stats.lowStock} tone="text-amber-400" />
            <StatCard icon={FileWarning} label="Out of stock" value={stats.outOfStock} tone="text-destructive" />
            <StatCard icon={PackagePlus} label="Stock value" value={`R ${stats.value.toFixed(0)}`} />
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <CardTitle className="text-base">Stock on hand</CardTitle>
                <CardDescription>{stats.imported} imported SKUs tracked.</CardDescription>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                <Select value={restaurantId} onValueChange={setRestaurantId}>
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
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative sm:col-span-2">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU or name" className="pl-8" />
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
                  Low stock only
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={importedOnly} onChange={(e) => setImportedOnly(e.target.checked)} />
                  Imported only
                </label>
              </div>
            </CardHeader>
            <CardContent>
              {inventoryQuery.isLoading ? (
                <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Reorder</TableHead>
                      <TableHead>Origin</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="w-64" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(inventoryQuery.data ?? []).map((i) => {
                      const low = i.quantity_on_hand <= i.reorder_level;
                      const out = i.quantity_on_hand === 0;
                      return (
                        <TableRow key={i.id}>
                          <TableCell className="font-mono text-xs">{i.sku}</TableCell>
                          <TableCell>{i.name}</TableCell>
                          <TableCell className="capitalize">{i.category}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className={out ? "text-destructive font-medium" : low ? "text-amber-400 font-medium" : ""}>
                              {i.quantity_on_hand} {i.unit}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {i.reorder_level} {i.unit}
                          </TableCell>
                          <TableCell>
                            <Badge variant={i.is_imported ? "outline" : "secondary"}>
                              {i.country_of_origin ?? "Local"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{i.supplier}</TableCell>
                          <TableCell className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => adjMutation.mutate({ id: i.id, delta: -1 })}
                              disabled={i.quantity_on_hand === 0}
                            >
                              −1
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => adjMutation.mutate({ id: i.id, delta: 5 })}>
                              +5
                            </Button>
                            <Button size="sm" onClick={() => adjMutation.mutate({ id: i.id, delta: i.ideal_stock - i.quantity_on_hand })}>
                              Restock to ideal
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {(inventoryQuery.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                          No inventory matches your filters.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customs" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard icon={Plane} label="Active shipments" value={customsStats.shipments} />
            <StatCard icon={FileWarning} label="Held by customs" value={customsStats.held} tone="text-destructive" />
            <StatCard icon={PackageCheck} label="Cleared" value={customsStats.cleared} tone="text-emerald-400" />
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <CardTitle className="text-base">Import shipments & customs</CardTitle>
                <CardDescription>HS codes, duties, SADC paperwork and landed cost tracking.</CardDescription>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Select value={customsStatus} onValueChange={setCustomsStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {Object.entries(CUSTOMS_STATUS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={customsSearch} onChange={(e) => setCustomsSearch(e.target.value)} placeholder="Shipment or HS code" className="pl-8" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shipment</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Restaurant</TableHead>
                    <TableHead>HS / Origin</TableHead>
                    <TableHead>Port / Incoterm</TableHead>
                    <TableHead className="text-right">Landed cost</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Documents</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(customsQuery.data ?? []).map((c) => {
                    const s = ((CUSTOMS_STATUS as Record<string, { tone: string; label: string }>)[c.status] ??
                      CUSTOMS_STATUS["draft"])!;
                    const missingDocs = c.documents.filter((d) => d.status === "missing").length;
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <p className="font-mono text-xs">{c.shipment_ref}</p>
                          <p className="text-[10px] text-muted-foreground">ETA {new Date(c.eta).toLocaleDateString()}</p>
                        </TableCell>
                        <TableCell>{c.item_name}</TableCell>
                        <TableCell>{c.restaurant_name}</TableCell>
                        <TableCell>
                          <p className="font-mono text-xs">{c.hs_code}</p>
                          <p className="text-[10px] text-muted-foreground">{c.country_of_origin}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-xs">{c.port_of_entry}</p>
                          <p className="text-[10px] text-muted-foreground">{c.incoterm}</p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          R {c.total_landed_cost.toFixed(2)}
                          <p className="text-[10px] text-muted-foreground">
                            duty {c.import_duty_pct}% · VAT {c.vat_pct}%{c.excise_pct ? ` · excise ${c.excise_pct}%` : ""}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={s.tone}>{s.label}</Badge>
                          {c.notes && <p className="mt-1 max-w-[180px] text-[10px] text-muted-foreground">{c.notes}</p>}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {c.documents.map((d) => (
                              <Badge key={d.name} variant={d.status === "missing" ? "destructive" : "secondary"} className="text-[9px]">
                                {d.name}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={c.status}
                            onValueChange={(v) => statusMutation.mutate({ id: c.id, status: v as never })}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(CUSTOMS_STATUS).map(([k, v]) => (
                                <SelectItem key={k} value={k}>{v.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {missingDocs > 0 && c.status === "held" && (
                            <p className="mt-1 text-[10px] text-destructive">{missingDocs} document(s) missing</p>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(customsQuery.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                        No shipments match your filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <div className="mt-4 text-xs text-muted-foreground">
                Need per-restaurant customs reports? Head to <Link to="/reports" className="underline">Reports</Link> to download a customs/order CSV.
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PermissionGate>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Boxes;
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-muted p-2">
          <Icon className={`size-4 ${tone ?? ""}`} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
