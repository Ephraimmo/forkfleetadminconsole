import { delay, drivers, orders, restaurants, inventory, findCustomer, findDriver, findRestaurant } from "@/lib/demo-store";

export type ReportKind = "orders" | "drivers" | "inventory";

export interface ReportFilter {
  dateFrom?: string;
  dateTo?: string;
  restaurantId?: string;
  status?: string;
}

export interface SeriesPoint {
  label: string;
  value: number;
}

export interface ReportResult {
  kind: ReportKind;
  title: string;
  generatedAt: string;
  filters: ReportFilter;
  summary: { label: string; value: string | number }[];
  charts: { title: string; series: SeriesPoint[] }[];
  columns: string[];
  rows: (string | number)[][];
  csv: string;
}

function toDate(s?: string) {
  return s ? new Date(s) : null;
}

function inRange(date: string, from: Date | null, to: Date | null) {
  const d = new Date(date);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function toCsv(columns: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export async function generateReport(kind: ReportKind, filters?: ReportFilter): Promise<ReportResult> {
  const f = filters ?? {};
  await delay(120);
  const from = toDate(f.dateFrom);
  const to = toDate(f.dateTo);

  if (kind === "orders") return buildOrdersReport(f, from, to);
  if (kind === "drivers") return buildDriversReport(f, from, to);
  return buildInventoryReport(f);
}

function buildOrdersReport(filters: ReportFilter, from: Date | null, to: Date | null): ReportResult {
  const rows = orders
    .filter((o) => inRange(o.placed_at, from, to))
    .filter((o) => (!filters.restaurantId || filters.restaurantId === "all" || o.restaurant_id === filters.restaurantId))
    .filter((o) => (!filters.status || filters.status === "all" || o.status === filters.status));

  const totalRevenue = rows.filter((o) => o.status === "delivered").reduce((s, o) => s + o.total, 0);
  const avgOrder = rows.length ? totalRevenue / rows.filter((o) => o.status === "delivered").length : 0;
  const delivered = rows.filter((o) => o.status === "delivered").length;
  const cancelled = rows.filter((o) => o.status === "cancelled").length;

  const byStatus = new Map<string, number>();
  for (const o of rows) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);

  const byRestaurant = new Map<string, number>();
  for (const o of rows) byRestaurant.set(o.restaurant_id, (byRestaurant.get(o.restaurant_id) ?? 0) + o.total);
  const topRestaurants = Array.from(byRestaurant.entries())
    .map(([rid, total]) => ({ label: findRestaurant(rid)?.name ?? rid, value: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const table = rows.map((o) => [
    o.order_number,
    findRestaurant(o.restaurant_id)?.name ?? "—",
    findCustomer(o.customer_id)?.full_name ?? "—",
    o.status,
    new Date(o.placed_at).toLocaleString(),
    `R ${o.total.toFixed(2)}`,
  ]);

  return {
    kind: "orders",
    title: "Orders report",
    generatedAt: new Date().toISOString(),
    filters,
    summary: [
      { label: "Total orders", value: rows.length },
      { label: "Delivered", value: delivered },
      { label: "Cancelled", value: cancelled },
      { label: "Revenue", value: `R ${totalRevenue.toFixed(2)}` },
      { label: "Avg delivered order", value: `R ${avgOrder.toFixed(2)}` },
    ],
    charts: [
      { title: "Orders by status", series: Array.from(byStatus.entries()).map(([k, v]) => ({ label: k, value: v })) },
      { title: "Revenue by restaurant (top 6)", series: topRestaurants },
    ],
    columns: ["Order #", "Restaurant", "Customer", "Status", "Placed at", "Total"],
    rows: table,
    csv: toCsv(["Order #", "Restaurant", "Customer", "Status", "Placed at", "Total"], table),
  };
}

function buildDriversReport(filters: ReportFilter, from: Date | null, to: Date | null): ReportResult {
  const relevantOrders = orders.filter((o) => inRange(o.placed_at, from, to));
  const table = drivers.map((d) => {
    const driverOrders = relevantOrders.filter((o) => o.driver_id === d.id);
    const earnings = driverOrders.filter((o) => o.status === "delivered").reduce((s, o) => s + o.delivery_fee, 0);
    return [d.full_name, d.vehicle_type, d.status, d.rating.toFixed(1), driverOrders.length, `R ${earnings.toFixed(2)}`];
  });

  const byStatus = new Map<string, number>();
  for (const d of drivers) byStatus.set(d.status, (byStatus.get(d.status) ?? 0) + 1);

  const byVehicle = new Map<string, number>();
  for (const d of drivers) byVehicle.set(d.vehicle_type, (byVehicle.get(d.vehicle_type) ?? 0) + 1);

  const top = drivers
    .slice()
    .map((d) => ({
      label: d.full_name,
      value: relevantOrders.filter((o) => o.driver_id === d.id && o.status === "delivered").length,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  return {
    kind: "drivers",
    title: "Drivers report",
    generatedAt: new Date().toISOString(),
    filters,
    summary: [
      { label: "Total drivers", value: drivers.length },
      { label: "Online", value: drivers.filter((d) => d.status === "online").length },
      { label: "Busy", value: drivers.filter((d) => d.status === "busy").length },
      { label: "Suspended", value: drivers.filter((d) => d.status === "suspended").length },
      { label: "Avg rating", value: (drivers.reduce((s, d) => s + d.rating, 0) / drivers.length).toFixed(2) },
    ],
    charts: [
      { title: "Drivers by status", series: Array.from(byStatus.entries()).map(([k, v]) => ({ label: k, value: v })) },
      { title: "Fleet by vehicle", series: Array.from(byVehicle.entries()).map(([k, v]) => ({ label: k, value: v })) },
      { title: "Top performers (deliveries)", series: top },
    ],
    columns: ["Driver", "Vehicle", "Status", "Rating", "Deliveries (period)", "Earnings (period)"],
    rows: table,
    csv: toCsv(["Driver", "Vehicle", "Status", "Rating", "Deliveries", "Earnings"], table),
  };
}

function buildInventoryReport(filters: ReportFilter): ReportResult {
  const items = inventory.filter(
    (i) => !filters.restaurantId || filters.restaurantId === "all" || i.restaurant_id === i.restaurant_id,
  );
  const lowStock = items.filter((i) => i.quantity_on_hand <= i.reorder_level);
  const outOfStock = items.filter((i) => i.quantity_on_hand === 0);
  const imported = items.filter((i) => i.is_imported);
  const totalValue = items.reduce((s, i) => s + i.quantity_on_hand * i.unit_cost, 0);

  const byCategory = new Map<string, { count: number; value: number }>();
  for (const i of items) {
    const c = byCategory.get(i.category) ?? { count: 0, value: 0 };
    c.count += 1;
    c.value += i.quantity_on_hand * i.unit_cost;
    byCategory.set(i.category, c);
  }

  const table = items.map((i) => [
    i.sku,
    i.name,
    findRestaurant(i.restaurant_id)?.name ?? "—",
    i.category,
    String(i.quantity_on_hand),
    String(i.reorder_level),
    i.is_imported ? "Imported" : "Local",
    `R ${i.unit_cost.toFixed(2)}`,
    `R ${(i.quantity_on_hand * i.unit_cost).toFixed(2)}`,
  ]);

  return {
    kind: "inventory",
    title: "Inventory report",
    generatedAt: new Date().toISOString(),
    filters,
    summary: [
      { label: "SKUs", value: items.length },
      { label: "Low stock", value: lowStock.length },
      { label: "Out of stock", value: outOfStock.length },
      { label: "Imported SKUs", value: imported.length },
      { label: "Stock value", value: `R ${totalValue.toFixed(2)}` },
    ],
    charts: [
      {
        title: "SKUs by category",
        series: Array.from(byCategory.entries()).map(([k, v]) => ({ label: k, value: v.count })),
      },
      {
        title: "Stock value by category (R)",
        series: Array.from(byCategory.entries()).map(([k, v]) => ({ label: k, value: Math.round(v.value * 100) / 100 })),
      },
    ],
    columns: ["SKU", "Item", "Restaurant", "Category", "On hand", "Reorder", "Origin", "Unit cost", "Stock value"],
    rows: table,
    csv: toCsv(
      ["SKU", "Item", "Restaurant", "Category", "On hand", "Reorder", "Origin", "Unit cost", "Stock value"],
      table,
    ),
  };
}
