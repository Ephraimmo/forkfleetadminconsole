// Dine-in order lines: validation, pricing, modifiers and waiter edits.
//
// Pure, so a guest placing an order (table-sessions.firebase.ts), a waiter
// editing one (the editor dialog and dine-in-orders.firebase.ts) and the
// customer app all validate and price lines exactly the same way.
//
// Modifiers: an order line stores the chosen size as `variant` and every
// extra as an entry in `addons`. A choice from a menu modifier group
// ("Cooking: Medium rare", "Sauce: Pepper") is an addon whose id is
// `mod:{modifierId}:{choiceIndex}` and whose name is "{Group}: {Choice}". Its
// quantity follows the line's quantity, so a priced choice is charged per
// item. Plain menu add-ons keep their own quantity, as before.

import { dineInError } from "@/lib/dine-in";
import type { OrderLine, OrderLineAddon, OrderLineVariant } from "@/lib/orders.firebase";
import {
  addonsForMenuItem,
  modifiersForMenuItem,
  variantsForMenuItem,
  type MenuAddon,
  type MenuItem,
  type MenuModifier,
  type MenuPayload,
  type MenuVariant,
} from "@/lib/menus.firebase";

export interface DineInItemInput {
  item_id?: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  notes?: string | null;
  variant?: OrderLineVariant | null;
  addons?: OrderLineAddon[];
}

/** Most items a guest can send in one go. */
export const MAX_ITEMS_PER_ORDER = 50;
/** Most lines one order can hold after a waiter's edits. */
export const MAX_LINES_PER_ORDER = 100;
export const MAX_QUANTITY = 99;
export const MAX_TEXT = 500;
/** Same service fee createFirebaseOrder() charges by default. */
export const SERVICE_FEE_RATE = 0.05;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
export const round2 = (n: number) => Math.round(n * 100) / 100;

export function randomId(prefix: string): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Date.now().toString(36)}${Array.from(bytes, (b) => (b % 36).toString(36)).join("")}`;
}

/* ------------------------------------------------------------- validation */

export function validateItems(
  items: DineInItemInput[],
  max = MAX_ITEMS_PER_ORDER,
): DineInItemInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw dineInError("dine-in/invalid-items", "Add at least one item to order.");
  }
  if (items.length > max) {
    throw dineInError("dine-in/invalid-items", `Order at most ${max} items at a time.`);
  }
  return items.map((item) => {
    const name = str(item.name);
    if (!name || name.length > 120) {
      throw dineInError("dine-in/invalid-items", "Every item needs a name.");
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) {
      throw dineInError("dine-in/invalid-items", `Quantity for ${name} must be 1–${MAX_QUANTITY}.`);
    }
    if (!Number.isFinite(item.unit_price) || item.unit_price < 0) {
      throw dineInError("dine-in/invalid-items", `${name} has an invalid price.`);
    }
    if (item.variant && !Number.isFinite(item.variant.price_delta)) {
      throw dineInError("dine-in/invalid-items", `${name} has an invalid size.`);
    }
    for (const addon of item.addons ?? []) {
      if (
        !Number.isFinite(addon.price) ||
        addon.price < 0 ||
        !Number.isInteger(addon.quantity) ||
        addon.quantity < 1
      ) {
        throw dineInError("dine-in/invalid-items", `${name} has an invalid add-on.`);
      }
    }
    return { ...item, name, notes: str(item.notes).slice(0, MAX_TEXT) || null };
  });
}

/* ---------------------------------------------------------------- pricing */

/** Line total — the same formula createFirebaseOrder() uses. */
export function lineTotal(
  item: Pick<DineInItemInput, "unit_price" | "quantity" | "variant" | "addons">,
): number {
  const addons = (item.addons ?? []).reduce((sum, a) => sum + a.price * a.quantity, 0);
  const variantDelta = (item.variant?.price_delta ?? 0) * item.quantity;
  return round2(item.unit_price * item.quantity + addons + variantDelta);
}

export function priceOrder(
  lines: Pick<OrderLine, "line_total">[],
  extras: { delivery_fee: number; tax: number; tip: number; discount: number },
) {
  const subtotal = round2(lines.reduce((sum, l) => sum + (Number(l.line_total) || 0), 0));
  const service_fee = round2(subtotal * SERVICE_FEE_RATE);
  const total = round2(
    subtotal + extras.delivery_fee + service_fee + extras.tax + extras.tip - extras.discount,
  );
  return { subtotal, service_fee, total };
}

/* -------------------------------------------------------------- modifiers */

const MODIFIER_ADDON = /^mod:([^:]+):(\d+)$/;

export function modifierAddonId(modifierId: string, choiceIndex: number): string {
  return `mod:${modifierId}:${choiceIndex}`;
}

export function parseModifierAddonId(
  id: string,
): { modifier_id: string; choice_index: number } | null {
  const match = MODIFIER_ADDON.exec(id);
  return match ? { modifier_id: match[1]!, choice_index: Number(match[2]) } : null;
}

export function isModifierAddon(addon: Pick<OrderLineAddon, "id">): boolean {
  return parseModifierAddonId(addon.id) !== null;
}

export interface ModifierChoiceOption {
  index: number;
  label: string;
  price: number;
}

/** What a waiter can pick for one menu item: its sizes, add-ons and modifier groups. */
export interface MenuItemOptions {
  variants: MenuVariant[];
  addons: MenuAddon[];
  modifiers: { group: MenuModifier; choices: ModifierChoiceOption[] }[];
}

/**
 * The available options for a menu item. A modifier group offers the choices
 * ticked for this product on the Menus page (all of them when none are), at
 * the product's price for that choice when the group is priced.
 */
export function menuItemOptions(
  menu: Pick<MenuPayload, "variants" | "addons" | "modifiers">,
  item: MenuItem,
): MenuItemOptions {
  return {
    variants: variantsForMenuItem(menu.variants, item.id).filter((v) => v.is_available),
    addons: addonsForMenuItem(menu.addons, item.id).filter((a) => a.is_available),
    modifiers: modifiersForMenuItem(menu.modifiers, item)
      .filter((group) => group.is_available)
      .map((group) => {
        const config = item.modifier_config[group.id] ?? {};
        const configured = Object.values(config).some((c) => c.selected);
        const choices = group.choices
          .map((choice, index) => ({ choice, index, cfg: config[String(index)] }))
          .filter(({ cfg }) => !configured || cfg?.selected === true)
          .map(({ choice, index, cfg }) => ({
            index,
            label: choice.label,
            price: group.include_pricing ? round2(Number(cfg?.price ?? choice.price) || 0) : 0,
          }));
        return { group, choices };
      })
      .filter((m) => m.choices.length > 0),
  };
}

/** What one of a menu item costs: its discount price while it's on special, else its price. */
export function menuItemPrice(item: Pick<MenuItem, "price" | "discount_price">): number {
  const price = Number(item.price) || 0;
  const discount = item.discount_price == null ? NaN : Number(item.discount_price);
  return round2(Number.isFinite(discount) && discount >= 0 && discount < price ? discount : price);
}

/** The size a newly added item starts with: its default, else the first one (none if it has no sizes). */
export function defaultVariant(variants: MenuVariant[]): OrderLineVariant | null {
  const v = variants.find((x) => x.is_default) ?? variants[0];
  return v ? { id: v.id, name: v.name, price_delta: Number(v.price_delta) || 0 } : null;
}

/** Most choices a guest may pick in a group (at least one). */
export function maxChoices(group: Pick<MenuModifier, "max_selections">): number {
  return Math.max(1, Math.floor(Number(group.max_selections) || 1));
}

/**
 * Pick or unpick one choice of a modifier group on a line. In a group that
 * allows a single choice, picking one replaces the previous; a group that is
 * already at its maximum ignores further picks.
 */
export function toggleModifierChoice(
  line: { quantity: number; addons: OrderLineAddon[] },
  group: Pick<MenuModifier, "id" | "name" | "max_selections">,
  choice: ModifierChoiceOption,
): OrderLineAddon[] {
  const id = modifierAddonId(group.id, choice.index);
  if (line.addons.some((a) => a.id === id)) return line.addons.filter((a) => a.id !== id);
  const inGroup = (a: OrderLineAddon) => parseModifierAddonId(a.id)?.modifier_id === group.id;
  const max = maxChoices(group);
  let addons = line.addons;
  if (max === 1) addons = addons.filter((a) => !inGroup(a));
  else if (addons.filter(inGroup).length >= max) return line.addons;
  return [
    ...addons,
    { id, name: `${group.name}: ${choice.label}`, price: choice.price, quantity: line.quantity },
  ];
}

/** Set how many of a plain add-on a line has; 0 removes it. */
export function setAddonQuantity(
  addons: OrderLineAddon[],
  addon: Pick<OrderLineAddon, "id" | "name" | "price">,
  quantity: number,
): OrderLineAddon[] {
  const rest = addons.filter((a) => a.id !== addon.id);
  if (quantity <= 0) return rest;
  const next = { id: addon.id, name: addon.name, price: addon.price, quantity };
  const at = addons.findIndex((a) => a.id === addon.id);
  if (at === -1) return [...addons, next];
  return addons.map((a) => (a.id === addon.id ? next : a));
}

/** Change a line's quantity; its modifier choices follow it. */
export function withQuantity<T extends { quantity: number; addons: OrderLineAddon[] }>(
  line: T,
  quantity: number,
): T {
  return {
    ...line,
    quantity,
    addons: line.addons.map((a) => (isModifierAddon(a) ? { ...a, quantity } : a)),
  };
}

/** A line's size and extras as short labels: ["Large", "Cooking: Rare", "Extra cheese ×2"]. */
export function describeLineOptions(line: {
  variant?: OrderLineVariant | null;
  addons?: OrderLineAddon[] | null;
}): string[] {
  return [
    ...(line.variant?.name ? [line.variant.name] : []),
    ...(line.addons ?? []).map((a) =>
      isModifierAddon(a) || a.quantity <= 1 ? a.name : `${a.name} ×${a.quantity}`,
    ),
  ];
}

/* ------------------------------------------------------------ waiter edit */

/** A line in the edited order: an existing one (with its `id`), or a new one. */
export interface OrderEditLine extends DineInItemInput {
  id?: string | null;
}

export interface OrderEdit {
  /**
   * The lines the waiter started editing from. Lines not listed here were
   * added by a guest while the waiter was editing, and are kept as they are.
   */
  base_line_ids: string[];
  /** Every line the waiter wants on the order, in order. */
  lines: OrderEditLine[];
  /** Only when the waiter changed them: what they were when editing began, and the new text. */
  special_instructions?: { from: string | null; to: string | null } | null;
}

export interface AppliedOrderEdit {
  items: Record<string, OrderLine>;
  special_instructions: string | null;
  /** What changed, in words, for the order's history. Empty when nothing did. */
  changes: string[];
  /** The same changes line by line, with each line as it was before and after. */
  line_changes: OrderEditLineChange[];
}

/**
 * One line a waiter changed, as kept in the order's edit history. The line is
 * stored exactly as it was and as it became, so the customer's original order
 * is never lost, only superseded.
 */
export interface OrderEditLineChange {
  line_id: string;
  kind: "added" | "removed" | "changed";
  item_name: string;
  /** The line before the edit, e.g. "Steak + Mushroom Sauce" (null for a line the waiter added). */
  original: string | null;
  /** The line after the edit, e.g. "Steak" (null when it was removed). */
  updated: string | null;
  /** What changed, e.g. ["Mushroom Sauce removed"], or ["Removed Chips ×1"]. */
  changes: string[];
  before: OrderLine | null;
  after: OrderLine | null;
}

/** `orders/{id}.edits/{editId}` — one save of the waiter's order editor. */
export interface OrderEditRecord {
  id: string;
  at: string;
  /** The waiter's name, as on the order's history. */
  by: string;
  by_id: string | null;
  /** The order's status when it was edited. */
  status_before: string;
  lines: OrderEditLineChange[];
  special_instructions: { from: string | null; to: string | null } | null;
  /** Every change in words — the same text as the order's history. */
  summary: string;
  total_before: number;
  total_after: number;
  /** The order had been confirmed with the table; this edit withdrew that, so it must be confirmed again. */
  confirmation_withdrawn: boolean;
}

const noteOf = (v: unknown) => str(v).slice(0, MAX_TEXT) || null;
const addonKey = (addons: OrderLineAddon[] | null | undefined) =>
  (addons ?? [])
    .map((a) => `${a.id}|${a.quantity}|${a.price}`)
    .sort()
    .join(",");
const lineLabel = (line: Pick<OrderLine, "name">) => line.name;

/** A line in one phrase: "Steak + Mushroom Sauce", "2× Burger (Large) + Cooking: Rare". */
export function describeOrderLine(
  line: Pick<OrderLine, "name" | "quantity"> & {
    variant?: OrderLineVariant | null;
    addons?: OrderLineAddon[] | null;
  },
): string {
  const name = line.variant?.name ? `${line.name} (${line.variant.name})` : line.name;
  const extras = (line.addons ?? []).map((a) =>
    isModifierAddon(a) || a.quantity <= 1 ? a.name : `${a.name} ×${a.quantity}`,
  );
  return [`${line.quantity > 1 ? `${line.quantity}× ` : ""}${name}`, ...extras].join(" + ");
}

/**
 * How a line's add-ons and modifier choices changed, in words: "Mushroom
 * Sauce removed", "Extra cheese added", "Extra cheese ×1 → ×2", and for a
 * swapped choice in a choose-one group "Cooking: Rare → Medium". A modifier's
 * quantity follows the line's, so that alone isn't a change.
 */
export function describeAddonChanges(
  before: OrderLineAddon[] | null | undefined,
  after: OrderLineAddon[] | null | undefined,
): string[] {
  const was = new Map((before ?? []).map((a) => [a.id, a]));
  const now = new Map((after ?? []).map((a) => [a.id, a]));
  const removed = [...was.values()].filter((a) => !now.has(a.id));
  const added = [...now.values()].filter((a) => !was.has(a.id));
  const group = (a: OrderLineAddon) => parseModifierAddonId(a.id)?.modifier_id ?? null;
  const choice = (a: OrderLineAddon) => a.name.split(": ").slice(1).join(": ") || a.name;
  const label = (a: OrderLineAddon) =>
    !isModifierAddon(a) && a.quantity > 1 ? `${a.name} ×${a.quantity}` : a.name;
  const out: string[] = [];

  for (const gone of removed) {
    const g = group(gone);
    const swapped = g ? added.filter((a) => group(a) === g) : [];
    const gonesInGroup = g ? removed.filter((a) => group(a) === g) : [];
    if (swapped.length === 1 && gonesInGroup.length === 1) {
      out.push(`${gone.name} → ${choice(swapped[0]!)}`);
      added.splice(added.indexOf(swapped[0]!), 1);
    } else {
      out.push(`${label(gone)} removed`);
    }
  }
  for (const a of added) out.push(`${label(a)} added`);
  for (const [id, a] of now) {
    const b = was.get(id);
    if (b && !isModifierAddon(a) && b.quantity !== a.quantity) {
      out.push(`${a.name} ×${b.quantity} → ×${a.quantity}`);
    }
  }
  return out;
}

/** Read `orders/{id}.edits` back as a list, oldest first. */
export function normalizeOrderEdits(raw: unknown): OrderEditRecord[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter((entry): entry is [string, Record<string, unknown>] =>
      Boolean(entry[1] && typeof entry[1] === "object"),
    )
    .map(([id, e]) => ({
      id: str(e["id"]) || id,
      at: str(e["at"]),
      by: str(e["by"]) || "Staff",
      by_id: str(e["by_id"]) || null,
      status_before: str(e["status_before"]),
      lines: (Array.isArray(e["lines"]) ? (e["lines"] as OrderEditLineChange[]) : []).filter(
        (l) => l && typeof l === "object",
      ),
      special_instructions:
        e["special_instructions"] && typeof e["special_instructions"] === "object"
          ? (e["special_instructions"] as OrderEditRecord["special_instructions"])
          : null,
      summary: str(e["summary"]),
      total_before: Number(e["total_before"]) || 0,
      total_after: Number(e["total_after"]) || 0,
      confirmation_withdrawn: e["confirmation_withdrawn"] === true,
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Apply a waiter's edit to an order's current lines.
 *
 * - An existing line keeps who added it, its name and its price; the waiter
 *   changes its quantity, size, add-ons/modifiers and note.
 * - A line from `base_line_ids` that isn't in `lines` is removed.
 * - A line without an id is added (by the waiter).
 * - Lines added since the waiter began (not in `base_line_ids`) are untouched.
 *
 * Throws "dine-in/order-changed" when the edit would overwrite something that
 * changed meanwhile (a line the waiter edited is gone, or the special
 * instructions were changed by someone else).
 */
export function applyOrderEdit(
  current: {
    items: Record<string, OrderLine> | null | undefined;
    special_instructions: string | null | undefined;
  },
  edit: OrderEdit,
  ctx: { at: string; editor: string; newLineId?: () => string },
): AppliedOrderEdit {
  const items = current.items ?? {};
  const base = new Set(edit.base_line_ids);
  const lines = Array.isArray(edit.lines) ? edit.lines : [];
  if (lines.length > MAX_LINES_PER_ORDER) {
    throw dineInError(
      "dine-in/invalid-items",
      `An order can hold at most ${MAX_LINES_PER_ORDER} lines.`,
    );
  }

  const edited = new Map<string, OrderEditLine>();
  for (const line of lines) {
    if (!line.id) continue;
    if (!base.has(line.id)) {
      throw dineInError("dine-in/invalid-items", "That line isn't part of the order you edited.");
    }
    if (edited.has(line.id)) {
      throw dineInError("dine-in/invalid-items", "The edited order lists a line more than once.");
    }
    if (!items[line.id]) {
      throw dineInError(
        "dine-in/order-changed",
        "This order changed while you were editing it — reopen it to see the latest version.",
      );
    }
    edited.set(line.id, line);
  }

  // Validate every line the waiter touched, with the stored name and price of existing ones.
  const candidates = lines.map((line) => {
    const stored = line.id ? items[line.id]! : null;
    return {
      item_id: stored ? stored.item_id : (line.item_id ?? null),
      name: stored ? stored.name : line.name,
      unit_price: stored ? Number(stored.unit_price) : line.unit_price,
      quantity: line.quantity,
      notes: line.notes ?? null,
      variant: line.variant ?? null,
      addons: line.addons ?? [],
    };
  });
  const valid = candidates.length > 0 ? validateItems(candidates, MAX_LINES_PER_ORDER) : [];

  const changes: string[] = [];
  const lineChanges: OrderEditLineChange[] = [];
  const next: Record<string, OrderLine> = {};
  for (const [id, line] of Object.entries(items)) {
    if (!base.has(id)) {
      next[id] = line; // added by a guest since the waiter started
      continue;
    }
    const index = lines.findIndex((l) => l.id === id);
    if (index === -1) {
      const removed = `Removed ${lineLabel(line)} ×${line.quantity}`;
      changes.push(removed);
      lineChanges.push({
        line_id: id,
        kind: "removed",
        item_name: line.name,
        original: describeOrderLine(line),
        updated: null,
        changes: [removed],
        before: line,
        after: null,
      });
      continue;
    }
    const input = valid[index]!;
    const parts: string[] = [];
    if (input.quantity !== line.quantity) parts.push(`×${line.quantity} → ×${input.quantity}`);
    if ((input.variant?.id ?? null) !== (line.variant?.id ?? null)) {
      // The ids differ, so at least one side has a size.
      parts.push(
        input.variant && line.variant
          ? `size ${line.variant.name} → ${input.variant.name}`
          : input.variant
            ? `size ${input.variant.name}`
            : `size ${line.variant!.name} removed`,
      );
    }
    if (addonKey(input.addons) !== addonKey(line.addons)) {
      parts.push(...describeAddonChanges(line.addons, input.addons));
    }
    const notes = noteOf(input.notes);
    if (notes !== noteOf(line.notes)) parts.push(notes ? `note "${notes}"` : "note removed");

    if (parts.length === 0) {
      next[id] = line;
      continue;
    }
    changes.push(`${lineLabel(line)}: ${parts.join("; ")}`);
    const updated = {
      ...line,
      quantity: input.quantity,
      notes,
      variant: input.variant ?? null,
      addons: input.addons ?? [],
      edited_at: ctx.at,
      edited_by: ctx.editor,
    };
    next[id] = { ...updated, line_total: lineTotal(updated) };
    lineChanges.push({
      line_id: id,
      kind: "changed",
      item_name: line.name,
      original: describeOrderLine(line),
      updated: describeOrderLine(next[id]!),
      changes: parts,
      before: line,
      after: next[id]!,
    });
  }

  const newLineId = ctx.newLineId ?? (() => randomId("ln"));
  lines.forEach((line, index) => {
    if (line.id) return;
    const input = valid[index]!;
    const id = newLineId();
    const created: OrderLine = {
      id,
      item_id: str(input.item_id) || id,
      name: input.name,
      quantity: input.quantity,
      unit_price: input.unit_price,
      line_total: lineTotal(input),
      notes: input.notes ?? null,
      variant: input.variant ?? null,
      addons: input.addons ?? [],
      added_by: null,
      added_by_staff: ctx.editor,
      added_at: ctx.at,
    };
    next[id] = created;
    const added = `Added ${input.name} ×${input.quantity}`;
    changes.push(added);
    lineChanges.push({
      line_id: id,
      kind: "added",
      item_name: input.name,
      original: null,
      updated: describeOrderLine(created),
      changes: [added],
      before: null,
      after: created,
    });
  });

  if (Object.keys(next).length === 0) {
    throw dineInError(
      "dine-in/invalid-items",
      "An order needs at least one item. To cancel the whole order, reject it instead.",
    );
  }

  let special = current.special_instructions ?? null;
  const change = edit.special_instructions;
  if (change) {
    const to = noteOf(change.to);
    if (to !== noteOf(change.from)) {
      if (noteOf(current.special_instructions) !== noteOf(change.from)) {
        throw dineInError(
          "dine-in/order-changed",
          "The special instructions changed while you were editing — reopen the order to see them.",
        );
      }
      special = to;
      changes.push(to ? "Updated the special instructions" : "Removed the special instructions");
    }
  }

  return { items: next, special_instructions: special, changes, line_changes: lineChanges };
}

/** Recount how many items each guest contributed, after an edit. Guests stay listed even at 0. */
export function recountContributors(
  stored:
    | Record<string, { label?: string; first_added_at?: string; item_count?: number }>
    | null
    | undefined,
  items: Record<string, OrderLine>,
): Record<string, { label: string; first_added_at: string; item_count: number }> {
  const counts = new Map<string, number>();
  for (const line of Object.values(items)) {
    const guest = line.added_by?.guest_id;
    if (guest) counts.set(guest, (counts.get(guest) ?? 0) + line.quantity);
  }
  return Object.fromEntries(
    Object.entries(stored ?? {}).map(([guestId, c]) => [
      guestId,
      {
        label: str(c?.label) || "Guest",
        first_added_at: str(c?.first_added_at),
        item_count: counts.get(guestId) ?? 0,
      },
    ]),
  );
}
