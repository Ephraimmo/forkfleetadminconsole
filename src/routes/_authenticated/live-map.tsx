import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@/lib/use-demo-fn";
import { Bike, Navigation, RefreshCcw, Search, Store, Truck, AlertTriangle } from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveDeliveryMap } from "@/components/live-delivery-map";

import { listDrivers, listOrders } from "@/lib/dispatch.functions";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { useFirebaseRestaurants } from "@/hooks/use-firebase-restaurants";

export const Route = createFileRoute("/_authenticated/live-map")({
  head: () => ({
    meta: [
      { title: "Live Map & ETA Routes — ForkFleet Console" },
      {
        name: "description",
        content:
          "Real-time delivery map showing animated driver positions, ETA routes, pickup/drop-off pins and live fleet status.",
      },
    ],
  }),
  component: LiveMapPage,
});

type ViewMode = "all" | "deliveries" | "drivers";

function LiveMapPage() {
  const [search, setSearch] = useState("");
  const [restaurantFilter, setRestaurantFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [nonce, setNonce] = useState(0);

  const fetchOrders = useServerFn(listOrders);
  const fetchDrivers = useServerFn(listDrivers);

  const ordersQuery = useQuery({
    queryKey: ["live-map-orders", search, restaurantFilter, statusFilter, nonce],
    queryFn: () => {
      const filters: { search?: string; status?: string; driverId?: string } = {
        search,
        driverId: "all",
      };
      if (statusFilter !== "active") filters.status = statusFilter;
      return fetchOrders(filters);
    },
    refetchInterval: 15_000,
  });
  const driversQuery = useQuery({
    queryKey: ["drivers", "live-map", nonce],
    queryFn: () => fetchDrivers({}),
    refetchInterval: 15_000,
  });
  const { rows: _fbRestaurants } = useFirebaseRestaurants();
  const restaurantsQuery = { data: _fbRestaurants, isLoading: false };

  useRealtimeInvalidate("live-map", ["orders", "drivers"], [
    "live-map-orders",
    "drivers",
    "dispatch-board",
  ]);

  const allOrders = ordersQuery.data ?? [];
  const allDrivers = driversQuery.data ?? [];

  const filteredOrders = useMemo(
    () =>
      allOrders.filter((o) => {
        if (restaurantFilter !== "all" && o.restaurant_id !== restaurantFilter) return false;
        if (statusFilter === "active" && !["ready", "assigned", "picked_up", "on_the_way"].includes(o.status))
          return false;
        if (search && !o.order_number.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [allOrders, restaurantFilter, statusFilter, search],
  );

  const onTheWay = filteredOrders.filter((o) => o.status === "on_the_way" || o.status === "picked_up").length;
  const waitingPickup = filteredOrders.filter((o) => o.status === "ready" || o.status === "assigned").length;
  const activeDrivers = allDrivers.filter((d) => d.status === "busy" || d.status === "online").length;
  const idleDrivers = allDrivers.filter((d) => d.status === "online").length;
  const issues = allDrivers.filter((d) => d.status === "suspended" || d.status === "pending" || !d.is_verified).length;

  return (
    <PermissionGate
      required={["dispatch.manage", "orders.view", "drivers.view"]}
      breadcrumb={["Operations", "Live map"]}
      title="Live map &amp; ETA routes"
      description="One screen for every driver and every delivery — animated ETA routes, live positions, and fleet health."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setNonce((n) => n + 1);
              void ordersQuery.refetch();
              void driversQuery.refetch();
            }}
            disabled={ordersQuery.isFetching || driversQuery.isFetching}
          >
            <RefreshCcw className={`mr-1.5 size-3.5 ${ordersQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      }
    >
      {() => (
        <div className="space-y-4">
          {/* KPI strip */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard icon={Truck} label="In-flight orders" value={onTheWay + waitingPickup} accent="text-primary" />
            <KpiCard icon={Navigation} label="On the way" value={onTheWay} accent="text-info" />
            <KpiCard icon={Store} label="Waiting pickup" value={waitingPickup} accent="text-amber-400" />
            <KpiCard icon={Bike} label="Active drivers" value={activeDrivers} hint={`${idleDrivers} idle`} accent="text-emerald-400" />
            <KpiCard icon={AlertTriangle} label="Fleet issues" value={issues} accent={issues > 0 ? "text-destructive" : "text-muted-foreground"} />
          </div>

          {/* Filter bar */}
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 p-4">
              <div className="relative min-w-[180px] flex-1">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search order number…"
                  className="pl-8"
                />
              </div>
              <div className="min-w-[200px] flex-1">
                <Select value={restaurantFilter} onValueChange={setRestaurantFilter}>
                  <SelectTrigger>
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
              <div className="min-w-[180px] flex-1">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Active deliveries" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active deliveries</SelectItem>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="ready">Ready</SelectItem>
                    <SelectItem value="assigned">Assigned</SelectItem>
                    <SelectItem value="picked_up">Picked up</SelectItem>
                    <SelectItem value="on_the_way">On the way</SelectItem>
                    <SelectItem value="delivered">Delivered</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                <TabsList>
                  <TabsTrigger value="all">Everything</TabsTrigger>
                  <TabsTrigger value="deliveries">Routes only</TabsTrigger>
                  <TabsTrigger value="drivers">Drivers only</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardContent>
          </Card>

          {/* Unified map with integrated side panel */}
          <LiveDeliveryMap
            orders={filteredOrders}
            drivers={allDrivers}
            title="Live fleet & delivery map"
            description="Animated driver dots travel along ETA routes; idle, offline and pending drivers show at their last-known position. Hover a pin or list item to focus."
            focusMode={viewMode}
          />
        </div>
      )}
    </PermissionGate>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: typeof Truck;
  label: string;
  value: number;
  hint?: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-muted p-2">
          <Icon className={`size-4 ${accent ?? ""}`} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="flex items-baseline gap-2 text-lg font-semibold">
            {value}
            {hint && <span className="text-[11px] font-normal text-muted-foreground">{hint}</span>}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
