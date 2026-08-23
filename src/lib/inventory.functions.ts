import { audit } from "@/lib/audit";
import {
  customsEntries,
  delay,
  inventory,
  restaurants,
  uid,
  type DemoCustomsEntry,
  type InventoryUnit,
} from "@/lib/demo-store";

export interface InventoryRow {
  id: string;
  restaurant_id: string;
  sku: string;
  name: string;
  category: string;
  unit: InventoryUnit;
  quantity_on_hand: number;
  reorder_level: number;
  ideal_stock: number;
  unit_cost: number;
  supplier: string;
  is_perishable: boolean;
  shelf_life_days: number | null;
  last_counted_at: string;
  is_imported: boolean;
  country_of_origin: string | null;
}

export interface CustomsRow extends DemoCustomsEntry {
  item_name: string;
  restaurant_name: string;
}

export async function listInventory(input?: {
  restaurantId?: string;
  search?: string;
  category?: string;
  lowOnly?: boolean;
  importedOnly?: boolean;
}): Promise<InventoryRow[]> {
  await delay(80);
  const search = input?.search?.trim().toLowerCase();
  return inventory
    .filter((i) => (!input?.restaurantId || input.restaurantId === "all" || i.restaurant_id === input.restaurantId))
    .filter((i) => (!input?.category || input.category === "all" || i.category === input.category))
    .filter((i) => (!input?.lowOnly || i.quantity_on_hand <= i.reorder_level))
    .filter((i) => (!input?.importedOnly || i.is_imported))
    .filter((i) => !search || i.name.toLowerCase().includes(search) || i.sku.toLowerCase().includes(search));
}

export async function adjustStock(input: { id: string; delta: number; note?: string }) {
  await delay(50);
  const item = inventory.find((i) => i.id === input.id);
  if (!item) throw new Error("Inventory item not found");
  const previous = item.quantity_on_hand;
  item.quantity_on_hand = Math.max(0, item.quantity_on_hand + input.delta);
  item.last_counted_at = new Date().toISOString();
  audit({
    action: input.delta >= 0 ? "inventory.received" : "inventory.adjusted",
    entityType: "inventory_item",
    entityId: item.id,
    after: { previous, quantity: item.quantity_on_hand, note: input.note ?? null },
  });
  return { ok: true, quantity: item.quantity_on_hand };
}

export async function listCustoms(input?: { status?: string; search?: string }): Promise<CustomsRow[]> {
  await delay(70);
  const search = input?.search?.trim().toLowerCase();
  const restaurantMap = new Map(restaurants.map((r) => [r.id, r.name]));
  const getItem = (iid: string) => inventory.find((i) => i.id === iid);

  return customsEntries
    .filter((c) => (!input?.status || input.status === "all" || c.status === input.status))
    .filter((c) => !search || c.shipment_ref.toLowerCase().includes(search) || c.hs_code.includes(search))
    .map((c) => {
      const item = getItem(c.item_id);
      return {
        ...c,
        item_name: item?.name ?? "Unknown item",
        restaurant_name: item ? (restaurantMap.get(item.restaurant_id) ?? "—") : "—",
      };
    })
    .sort((a, b) => b.eta.localeCompare(a.eta));
}

export async function updateCustomsStatus(input: { id: string; status: DemoCustomsEntry["status"]; notes?: string }) {
  await delay(60);
  const c = customsEntries.find((x) => x.id === input.id);
  if (!c) throw new Error("Customs entry not found");
  c.status = input.status;
  if (input.notes) c.notes = input.notes;
  if (input.status === "cleared") c.cleared_at = new Date().toISOString();
  if (input.status === "cleared" && !c.arrived_at) c.arrived_at = new Date().toISOString();
  audit({
    action: "customs.status_updated",
    entityType: "customs_entry",
    entityId: c.id,
    after: { status: c.status },
  });
  return { ok: true };
}

export async function upsertCustomsDocument(input: { id: string; docName: string; present: boolean }) {
  await delay(40);
  const c = customsEntries.find((x) => x.id === input.id);
  if (!c) throw new Error("Customs entry not found");
  const existing = c.documents.find((d) => d.name === input.docName);
  if (existing) existing.status = input.present ? "present" : "missing";
  else c.documents.push({ name: input.docName, status: input.present ? "present" : "missing" });
  return { ok: true };
}

export async function createInventoryItem(input: Omit<InventoryRow, "id" | "last_counted_at">) {
  await delay(70);
  const id = uid("inv");
  inventory.push({
    ...input,
    id,
    last_counted_at: new Date().toISOString(),
  });
  audit({
    action: "inventory.item_created",
    entityType: "inventory_item",
    entityId: id,
    after: { name: input.name, sku: input.sku },
  });
  return { ok: true, id };
}
