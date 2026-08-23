import { useEffect, useMemo, useState } from "react";
import { Bike, MapPin, Navigation, Store, Zap, Coffee, AlertTriangle, PauseCircle, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DispatchOrder } from "@/lib/dispatch.functions";
import type { DriverRow } from "@/lib/dispatch.functions";

const W = 900;
const H = 520;

const driverStatusCfg: Record<
  DriverRow["status"],
  { label: string; color: string; ring: string }
> = {
  online: { label: "Idle", color: "fill-emerald-400", ring: "stroke-emerald-400/40" },
  busy: { label: "On delivery", color: "fill-primary", ring: "stroke-primary/40" },
  offline: { label: "Offline", color: "fill-muted-foreground/50", ring: "stroke-muted-foreground/20" },
  pending: { label: "Pending", color: "fill-amber-400", ring: "stroke-amber-400/40" },
  suspended: { label: "Suspended", color: "fill-destructive", ring: "stroke-destructive/40" },
};

/** Deterministic 0..1 hash so a given seed always maps to the same demo coordinate. */
function hash01(seed: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

type Point = { x: number; y: number };

interface Lane {
  order: DispatchOrder;
  pickup: Point;
  dropoff: Point;
  bend: Point;
  progress: number;
  driver: Point;
  etaLeft: number;
}

function routeProgress(order: DispatchOrder, now: number): number {
  const base: Record<string, [number, number]> = {
    ready: [0, 0.02],
    assigned: [0.02, 0.2],
    picked_up: [0.2, 0.45],
    on_the_way: [0.45, 0.95],
    delivered: [1, 1],
  };
  const [from, to] = base[order.status] ?? [0, 0.05];
  const eta = order.eta_minutes ?? 30;
  const elapsed = Math.max(0, (now - new Date(order.placed_at).getTime()) / 60000);
  const share = Math.min(1, elapsed / Math.max(eta, 1));
  return Math.min(1, from + (to - from) * share);
}

function quadAt(a: Point, c: Point, b: Point, t: number): Point {
  const m = 1 - t;
  return {
    x: m * m * a.x + 2 * m * t * c.x + t * t * b.x,
    y: m * m * a.y + 2 * m * t * c.y + t * t * b.y,
  };
}

function driverHomePoint(id: string): Point {
  return {
    x: 60 + hash01(id, 31) * (W - 120),
    y: 60 + hash01(id, 32) * (H - 120),
  };
}

interface Cluster {
  x: number;
  y: number;
  r: number;
}

function computeClusters(pts: Point[]): Cluster[] {
  const clusters: Cluster[] = [];
  const used = new Set<number>();
  for (let i = 0; i < pts.length; i++) {
    if (used.has(i)) continue;
    const nearby = pts
      .map((p, idx) => ({ idx, d: Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y) }))
      .filter((x) => x.d < 85 && !used.has(x.idx));
    if (nearby.length >= 3) {
      nearby.forEach((n) => used.add(n.idx));
      clusters.push({
        x: nearby.reduce((s, n) => s + pts[n.idx]!.x, 0) / nearby.length,
        y: nearby.reduce((s, n) => s + pts[n.idx]!.y, 0) / nearby.length,
        r: 42 + Math.min(nearby.length * 5, 50),
      });
    }
  }
  return clusters.slice(0, 6);
}

export interface LiveMapProps {
  orders: DispatchOrder[];
  drivers: DriverRow[];
  title?: string;
  description?: string;
  className?: string;
  /** Optional tab/filter state controlled by the parent */
  focusMode?: "all" | "deliveries" | "drivers";
}

export function LiveDeliveryMap({
  orders,
  drivers,
  title = "Live map & ETA routes",
  description = "Drivers animate along ETA routes between pickup (restaurant) and drop-off (customer). Idle and offline drivers appear at their last known position.",
  className,
  focusMode = "all",
}: LiveMapProps) {
  const [now, setNow] = useState(() => Date.now());
  const [focusedOrderId, setFocusedOrderId] = useState<string | null>(null);
  const [focusedDriverId, setFocusedDriverId] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(Date.now());
      setPulse((p) => (p + 1) % 1000);
    }, 1500);
    return () => window.clearInterval(tick);
  }, []);

  const tracked = useMemo(
    () =>
      orders
        .filter((o) => ["ready", "assigned", "picked_up", "on_the_way"].includes(o.status))
        .slice(0, 18),
    [orders],
  );

  const lanes = useMemo<Lane[]>(
    () =>
      tracked.map((order) => {
        const pickup = {
          x: 80 + hash01(order.restaurant_id, 1) * (W * 0.32),
          y: 70 + hash01(order.restaurant_id, 2) * (H - 150),
        };
        const dropoff = {
          x: W * 0.52 + hash01(order.id, 3) * (W * 0.4),
          y: 70 + hash01(order.id, 4) * (H - 150),
        };
        const bend = {
          x: (pickup.x + dropoff.x) / 2,
          y: (pickup.y + dropoff.y) / 2 + (hash01(order.id, 5) - 0.5) * 160,
        };
        const progress = routeProgress(order, now);
        const eta = order.eta_minutes ?? 30;
        return {
          order,
          pickup,
          dropoff,
          bend,
          progress,
          driver: quadAt(pickup, bend, dropoff, progress),
          etaLeft: Math.max(0, Math.round(eta * (1 - progress))),
        };
      }),
    [tracked, now],
  );

  /** Idle drivers (online but not on a tracked delivery) get a home-position pin;
   *  busy drivers on a tracked order are represented by the moving route-driver dot. */
  const busyDriverIds = useMemo(() => new Set(tracked.map((o) => o.driver_id).filter(Boolean) as string[]), [tracked]);
  const idleDrivers = useMemo(
    () => drivers.filter((d) => d.status !== "busy" && !busyDriverIds.has(d.id)),
    [drivers, busyDriverIds],
  );
  const idlePoints = useMemo(() => idleDrivers.map((d) => driverHomePoint(d.id)), [idleDrivers]);
  const clusters = useMemo(
    () => (focusMode === "drivers" || focusMode === "all" ? computeClusters(idlePoints) : []),
    [idlePoints, focusMode],
  );

  const showDeliveries = focusMode !== "drivers";
  const showDrivers = focusMode !== "deliveries";

  const focusedLane = focusedOrderId ? lanes.find((l) => l.order.id === focusedOrderId) : undefined;
  const focusedDriver = focusedDriverId ? drivers.find((d) => d.id === focusedDriverId) : undefined;

  const driverCounts = useMemo(
    () => ({
      online: drivers.filter((d) => d.status === "online").length,
      busy: drivers.filter((d) => d.status === "busy").length,
      offline: drivers.filter((d) => d.status === "offline").length,
      issues: drivers.filter((d) => d.status === "suspended" || d.status === "pending" || !d.is_verified).length,
    }),
    [drivers],
  );

  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* MAP */}
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <Navigation className="size-4 text-primary" /> {title}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <LegendDot className="bg-primary" label="Driver (delivering)" />
              <LegendDot className="bg-emerald-400" label="Driver (idle)" />
              <LegendDot className="bg-secondary" label="Pickup" ring />
              <LegendDot className="bg-accent" label="Drop-off" />
            </div>
          </div>

          <div className="relative h-[520px] w-full bg-muted/20">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="h-full w-full"
              preserveAspectRatio="xMidYMid slice"
              role="img"
              aria-label="Live driver and delivery map"
            >
              <defs>
                <pattern id="ffm-grid" width="44" height="44" patternUnits="userSpaceOnUse">
                  <path d="M44 0H0V44" fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
                </pattern>
                <radialGradient id="ffm-heat" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="route-grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="var(--color-chart-3)" stopOpacity="0.85" />
                </linearGradient>
              </defs>
              <rect width={W} height={H} fill="url(#ffm-grid)" className="text-muted-foreground" />

              {/* stylised arterial roads */}
              {[0.22, 0.5, 0.78].map((f) => (
                <line
                  key={`h${f}`}
                  x1={0}
                  y1={H * f}
                  x2={W}
                  y2={H * f}
                  stroke="currentColor"
                  strokeOpacity="0.15"
                  strokeWidth={10}
                  strokeLinecap="round"
                  className="text-muted-foreground"
                />
              ))}
              {[0.25, 0.58, 0.82].map((f) => (
                <line
                  key={`v${f}`}
                  x1={W * f}
                  y1={0}
                  x2={W * f}
                  y2={H}
                  stroke="currentColor"
                  strokeOpacity="0.15"
                  strokeWidth={10}
                  strokeLinecap="round"
                  className="text-muted-foreground"
                />
              ))}

              {/* heat clusters for idle driver density */}
              {showDrivers &&
                clusters.map((c, i) => (
                  <circle key={`h-${i}`} cx={c.x} cy={c.y} r={c.r} fill="url(#ffm-heat)" className="text-emerald-400" />
                ))}

              {/* routes */}
              {showDeliveries &&
                lanes.map((lane) => {
                  const dim =
                    Boolean(focusedOrderId || focusedDriverId) &&
                    focusedOrderId !== lane.order.id &&
                    focusedDriverId !== lane.order.driver_id;
                  return (
                    <g
                      key={lane.order.id}
                      opacity={dim ? 0.18 : 1}
                      onMouseEnter={() => setFocusedOrderId(lane.order.id)}
                      onMouseLeave={() => setFocusedOrderId(null)}
                      className="cursor-pointer"
                    >
                      <path
                        d={`M${lane.pickup.x} ${lane.pickup.y} Q${lane.bend.x} ${lane.bend.y} ${lane.dropoff.x} ${lane.dropoff.y}`}
                        fill="none"
                        stroke="url(#route-grad)"
                        strokeWidth={dim ? 2 : 2.5}
                        strokeDasharray="8 6"
                        strokeLinecap="round"
                      />
                      <circle cx={lane.pickup.x} cy={lane.pickup.y} r={7} className="fill-secondary stroke-border" strokeWidth="2" />
                      <circle cx={lane.dropoff.x} cy={lane.dropoff.y} r={7} className="fill-accent stroke-border" strokeWidth="2" />
                      {/* moving driver */}
                      <g>
                        <circle
                          cx={lane.driver.x}
                          cy={lane.driver.y}
                          r={16 + (pulse % 2) * 6}
                          className="fill-primary/15"
                          opacity={0.7 - (pulse % 2) * 0.35}
                        />
                        <circle cx={lane.driver.x} cy={lane.driver.y} r={7} className="fill-primary stroke-background" strokeWidth="2" />
                        <text
                          x={lane.driver.x + 12}
                          y={lane.driver.y - 8}
                          className="fill-foreground text-[11px] font-semibold"
                        >
                          {lane.order.order_number}
                        </text>
                        {lane.order.driver_name && (
                          <text
                            x={lane.driver.x + 12}
                            y={lane.driver.y + 6}
                            className="fill-muted-foreground text-[10px]"
                          >
                            {lane.order.driver_name}
                          </text>
                        )}
                      </g>
                    </g>
                  );
                })}

              {/* idle / offline / other drivers at home positions */}
              {showDrivers &&
                idleDrivers.map((d) => {
                  const pt = driverHomePoint(d.id);
                  const cfg = driverStatusCfg[d.status];
                  const isFocused = focusedDriverId === d.id;
                  const dim =
                    Boolean(focusedDriverId || focusedOrderId) && !isFocused && !lanes.some((l) => l.order.driver_id === d.id);
                  return (
                    <g
                      key={d.id}
                      opacity={dim ? 0.25 : 1}
                      className="cursor-pointer"
                      onMouseEnter={() => setFocusedDriverId(d.id)}
                      onMouseLeave={() => setFocusedDriverId(null)}
                      onClick={() => setFocusedDriverId(isFocused ? null : d.id)}
                    >
                      {(d.status === "online" || d.status === "pending") && (
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r={14 + (pulse % 2) * 5}
                          className={cn("fill-transparent stroke-[2.5]", cfg.ring)}
                          opacity={0.7 - (pulse % 2) * 0.4}
                        />
                      )}
                      <circle cx={pt.x} cy={pt.y} r={7} className={cn(cfg.color, "stroke-background")} strokeWidth="2" />
                      {!d.is_verified && (
                        <circle cx={pt.x + 6} cy={pt.y - 6} r={4} className="fill-destructive stroke-background" strokeWidth="1.5" />
                      )}
                      {isFocused && (
                        <g>
                          <rect
                            x={pt.x + 11}
                            y={pt.y - 26}
                            width={Math.max(96, d.full_name.length * 6.4)}
                            height={36}
                            rx="6"
                            className="fill-popover stroke-border"
                            strokeWidth="1"
                          />
                          <text x={pt.x + 17} y={pt.y - 12} className="fill-foreground text-[11px] font-semibold">
                            {d.full_name}
                          </text>
                          <text x={pt.x + 17} y={pt.y + 2} className="fill-muted-foreground text-[10px]">
                            {cfg.label} • {d.vehicle_type}
                          </text>
                        </g>
                      )}
                      <title>{`${d.full_name} — ${cfg.label} (${d.vehicle_type})`}</title>
                    </g>
                  );
                })}
            </svg>

            {/* Floating legend overlay */}
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-[11px] shadow-sm backdrop-blur">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Zap className="size-3 text-emerald-400" /> {driverCounts.online} idle
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Bike className="size-3 text-primary" /> {driverCounts.busy} on delivery
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Coffee className="size-3" /> {driverCounts.offline} offline
                </span>
                {driverCounts.issues > 0 && (
                  <span className="flex items-center gap-1.5 text-destructive">
                    <AlertTriangle className="size-3" /> {driverCounts.issues} issues
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* SIDEBAR PANEL */}
        <div className="flex flex-col border-t border-border bg-card lg:border-l lg:border-t-0">
          <div className="border-b border-border p-4">
            <h4 className="text-sm font-semibold">Live activity</h4>
            <p className="text-xs text-muted-foreground">
              {lanes.length} in-flight • {driverCounts.online + driverCounts.busy} drivers online
            </p>
          </div>
          <div className="max-h-[560px] flex-1 overflow-y-auto p-3">
            {/* Deliveries in flight */}
            {showDeliveries && (
              <div className="mb-4">
                <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Deliveries
                </p>
                <div className="space-y-2">
                  {lanes.map((lane) => {
                    const active = focusedLane?.order.id === lane.order.id;
                    return (
                      <button
                        key={lane.order.id}
                        type="button"
                        onMouseEnter={() => setFocusedOrderId(lane.order.id)}
                        onMouseLeave={() => setFocusedOrderId(null)}
                        onClick={() => setFocusedOrderId(active ? null : lane.order.id)}
                        className={cn(
                          "w-full rounded-md border border-border/70 p-2.5 text-left transition-colors hover:bg-muted/60",
                          active && "border-primary/50 bg-muted/60",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold">{lane.order.order_number}</span>
                          <Badge
                            variant="secondary"
                            className={cn(
                              "gap-1 text-[10px]",
                              lane.etaLeft < 10 && "bg-amber-500/15 text-amber-400",
                            )}
                          >
                            <Clock className="size-2.5" /> {lane.etaLeft}m
                          </Badge>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {lane.order.restaurant_name} → {lane.order.customer_name}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                          {lane.order.driver_name ? (
                            <Badge variant="outline" className="gap-1 text-[10px]">
                              <Bike className="size-2.5" /> {lane.order.driver_name}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">Unassigned</Badge>
                          )}
                          <span className="text-muted-foreground">{lane.order.status.replace(/_/g, " ")}</span>
                        </div>
                        <div className="mt-2 h-1 w-full rounded-full bg-muted">
                          <div
                            className="h-1 rounded-full bg-primary transition-all"
                            style={{ width: `${Math.round(lane.progress * 100)}%` }}
                          />
                        </div>
                      </button>
                    );
                  })}
                  {lanes.length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground">No deliveries in flight.</p>
                  )}
                </div>
              </div>
            )}

            {/* Idle drivers */}
            {showDrivers && (
              <div>
                <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Fleet
                </p>
                <div className="space-y-1.5">
                  {drivers
                    .slice()
                    .sort((a, b) => {
                      const order = { busy: 0, online: 1, pending: 2, offline: 3, suspended: 4 } as const;
                      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
                    })
                    .slice(0, 22)
                    .map((d) => {
                      const cfg = driverStatusCfg[d.status];
                      const isFocused = focusedDriverId === d.id;
                      const activeOrder = lanes.find((l) => l.order.driver_id === d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onMouseEnter={() => setFocusedDriverId(d.id)}
                          onMouseLeave={() => setFocusedDriverId(null)}
                          onClick={() => setFocusedDriverId(isFocused ? null : d.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-muted/60",
                            isFocused && "bg-muted/60",
                          )}
                        >
                          <span className={cn("inline-block size-2.5 shrink-0 rounded-full", cfg.color.replace("fill-", "bg-"))} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{d.full_name}</span>
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {d.vehicle_type}{d.vehicle_plate ? ` • ${d.vehicle_plate}` : ""} • {cfg.label}
                              {activeOrder ? ` • ${activeOrder.order.order_number}` : ""}
                            </span>
                          </span>
                          {!d.is_verified && <AlertTriangle className="size-3 text-destructive" />}
                          {d.status === "busy" && <Bike className="size-3 text-primary" />}
                          {d.status === "online" && <Zap className="size-3 text-emerald-400" />}
                          {d.status === "offline" && <PauseCircle className="size-3 text-muted-foreground" />}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function LegendDot({ className, label, ring }: { className: string; label: string; ring?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span
        className={cn(
          "inline-block size-2.5 rounded-full",
          className,
          ring && "ring-2 ring-border",
        )}
      />
      {label}
    </span>
  );
}
