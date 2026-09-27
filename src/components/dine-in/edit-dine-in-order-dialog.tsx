// The waiter's order editor: change a dine-in order before it goes to the
// kitchen — add and remove items, change quantities, sizes, add-ons and
// modifiers, item notes and special instructions, and leave a note — then
// save, or save and confirm it. Every save is kept in the order's edit history
// (what each line was, who changed it, when). Changing an order that was
// already confirmed withdraws the confirmation, so it is confirmed again
// before anyone sends it to the kitchen.
//
// The editor works on a snapshot taken when it opens, so live updates never
// overwrite what the waiter is doing. Items a guest adds meanwhile are shown
// and kept (see applyOrderEdit() in dine-in-order-edit.ts).

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCheck,
  Loader2,
  Minus,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";

import { DineInStatusBadge } from "@/components/dine-in/dine-in-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DispatchOrder } from "@/lib/dispatch.functions";
import { audit } from "@/lib/audit";
import { dineInStatusLabel, isWithWaiter, WAITER_CONFIRMED, type StaffActor } from "@/lib/dine-in";
import {
  defaultVariant,
  describeLineOptions,
  lineTotal,
  MAX_QUANTITY,
  MAX_TEXT,
  maxChoices,
  menuItemOptions,
  menuItemPrice,
  modifierAddonId,
  parseModifierAddonId,
  priceOrder,
  setAddonQuantity,
  toggleModifierChoice,
  withQuantity,
  type MenuItemOptions,
} from "@/lib/dine-in-order-edit";
import {
  confirmDineInOrder,
  dineInOrderName,
  editDineInOrder,
} from "@/lib/dine-in-orders.firebase";
import { getMenuForRestaurant, type MenuItem, type MenuPayload } from "@/lib/menus.firebase";
import type { OrderLineAddon, OrderLineVariant } from "@/lib/orders.firebase";
import { tableDisplayName } from "@/lib/tables.firebase";

/** A line as the waiter is editing it. `id` is null for a line they added. */
interface DraftLine {
  key: string;
  id: string | null;
  item_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  notes: string;
  variant: OrderLineVariant | null;
  addons: OrderLineAddon[];
  added_by: string | null;
}

let keySeq = 0;
const nextKey = () => `draft_${++keySeq}`;

const money = (value: number) =>
  `R ${value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function toDraft(item: DispatchOrder["items"][number]): DraftLine {
  return {
    key: nextKey(),
    id: item.id,
    item_id: item.item_id,
    name: item.name,
    unit_price: item.base_price,
    quantity: item.quantity,
    notes: item.notes ?? "",
    variant: item.variant,
    addons: item.addons,
    added_by: item.added_by_label,
  };
}

export function EditDineInOrderDialog({
  open,
  order,
  actor,
  onClose,
}: {
  open: boolean;
  /** The live order (null while loading, or if it has gone). */
  order: DispatchOrder | null;
  actor: StaffActor;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [base, setBase] = useState<string[]>([]);
  const [specialFrom, setSpecialFrom] = useState<string | null>(null);
  const [special, setSpecial] = useState("");
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState<"save" | "confirm" | null>(null);
  const loadedFor = useRef<string | null>(null);

  // Snapshot the order once, when the editor opens on it.
  useEffect(() => {
    if (!open) {
      loadedFor.current = null;
      return;
    }
    if (!order || loadedFor.current === order.id) return;
    loadedFor.current = order.id;
    setDraft(order.items.map(toDraft));
    setBase(order.items.map((i) => i.id));
    setSpecialFrom(order.special_instructions ?? null);
    setSpecial(order.special_instructions ?? "");
    setNote("");
    setExpanded(null);
    setPicking(order.items.length === 0);
  }, [open, order]);

  const restaurantId = order?.restaurant_id ?? "";
  const menuQuery = useQuery({
    queryKey: ["dine-in-menu", restaurantId],
    queryFn: () => getMenuForRestaurant(restaurantId),
    enabled: open && Boolean(restaurantId),
    staleTime: 60_000,
  });
  const menu = menuQuery.data ?? null;
  const menuItems = useMemo(() => new Map((menu?.items ?? []).map((i) => [i.id, i])), [menu]);

  const editable = order ? isWithWaiter(order.status) : false;
  const confirmed = order?.status === WAITER_CONFIRMED;
  const liveIds = new Set(order?.items.map((i) => i.id) ?? []);
  const addedMeanwhile = order ? order.items.filter((i) => !base.includes(i.id)) : [];
  const goneMeanwhile = draft.some((l) => l.id && !liveIds.has(l.id));

  const price = order
    ? priceOrder(
        [
          ...draft.map((l) => ({ line_total: lineTotal(l) })),
          ...addedMeanwhile.map((i) => ({ line_total: i.line_total })),
        ],
        { delivery_fee: order.delivery_fee, tax: 0, tip: order.tip, discount: order.discount },
      )
    : null;

  const update = (key: string, change: (line: DraftLine) => DraftLine) =>
    setDraft((lines) => lines.map((l) => (l.key === key ? change(l) : l)));

  function addFromMenu(item: MenuItem) {
    const options = menu ? menuItemOptions(menu, item) : null;
    const line: DraftLine = {
      key: nextKey(),
      id: null,
      item_id: item.id,
      name: item.name,
      unit_price: menuItemPrice(item),
      quantity: 1,
      notes: "",
      variant: defaultVariant(options?.variants ?? []),
      addons: [],
      added_by: null,
    };
    setDraft((lines) => [...lines, line]);
    // Open its options straight away when there's something to choose.
    if (options && (options.variants.length > 1 || options.modifiers.length > 0)) {
      setExpanded(line.key);
    }
    setPicking(false);
  }

  async function save(andConfirm: boolean) {
    if (!order) return;
    setSaving(andConfirm ? "confirm" : "save");
    try {
      const specialText = special.trim() || null;
      const result = await editDineInOrder({
        order_id: order.id,
        base_line_ids: base,
        lines: draft.map((l) => ({
          id: l.id,
          item_id: l.item_id,
          name: l.name,
          quantity: l.quantity,
          unit_price: l.unit_price,
          notes: l.notes.trim() || null,
          variant: l.variant,
          addons: l.addons,
        })),
        special_instructions:
          specialText !== ((specialFrom ?? "").trim() || null)
            ? { from: specialFrom, to: specialText }
            : null,
        note,
        actor,
      });
      if (result.changes.length > 0 || result.noted) {
        audit({
          action: "order.dine_in.edited",
          entityType: "order",
          entityId: order.id,
          after: { changes: result.changes.join("; ") || null, noted: result.noted },
        });
      }
      // An order that was confirmed and wasn't changed is still confirmed.
      const stillConfirmed = order.status === WAITER_CONFIRMED && !result.confirmation_withdrawn;
      if (andConfirm && !stillConfirmed) {
        await confirmDineInOrder({ order_id: order.id, reviewed_line_ids: result.line_ids, actor });
        audit({
          action: "order.dine_in.confirmed",
          entityType: "order",
          entityId: order.id,
          before: { status: order.status },
          after: { status: WAITER_CONFIRMED },
        });
        toast.success(`${dineInOrderName(order)} confirmed.`, {
          description: "Send it to the kitchen when the table is ready.",
        });
      } else if (result.changes.length > 0 || result.noted) {
        toast.success(`${dineInOrderName(order)} updated.`, {
          description: result.confirmation_withdrawn
            ? "It needs confirming again before it can go to the kitchen."
            : result.changes.slice(0, 4).join(" · ") || "Note added.",
        });
      } else if (andConfirm) {
        toast.message(`${dineInOrderName(order)} is already confirmed.`);
      } else {
        toast.message("Nothing to save — the order is unchanged.");
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the order.");
    } finally {
      setSaving(null);
    }
  }

  const table = order?.dine_in ? tableDisplayName(order.dine_in.table_label) : "";
  const blocked = !order || !editable || goneMeanwhile;
  const empty = draft.length === 0 && addedMeanwhile.length === 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && saving === null && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="border-b p-5 pb-3">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Edit order {order?.order_number}
            {order && <DineInStatusBadge status={order.status} className="text-[10px]" />}
          </DialogTitle>
          <DialogDescription>
            {table ? `${table} · ` : ""}
            Nothing goes to the kitchen until the order is confirmed and sent.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {!order ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              This order isn&apos;t available any more.
            </p>
          ) : (
            <>
              {!editable && (
                <Notice tone="error">
                  This order is now {dineInStatusLabel(order.status).toLowerCase()} — it can no
                  longer be edited.
                </Notice>
              )}
              {confirmed && (
                <Notice tone="info">
                  This order has been confirmed with the table. Saving a change withdraws the
                  confirmation — confirm it again before sending it to the kitchen.
                </Notice>
              )}
              {goneMeanwhile && editable && (
                <Notice tone="error">
                  Someone else changed this order while you were editing. Close and reopen it to
                  start from the latest version.
                </Notice>
              )}

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Items</h3>
                  <Button
                    size="sm"
                    variant={picking ? "secondary" : "outline"}
                    onClick={() => setPicking((p) => !p)}
                    disabled={blocked}
                  >
                    {picking ? <X className="mr-1 size-3.5" /> : <Plus className="mr-1 size-3.5" />}
                    {picking ? "Close menu" : "Add item"}
                  </Button>
                </div>

                {picking && (
                  <MenuPicker
                    menu={menu}
                    loading={menuQuery.isLoading}
                    error={menuQuery.error instanceof Error ? menuQuery.error.message : null}
                    onPick={addFromMenu}
                  />
                )}

                <ul className="space-y-2">
                  {draft.map((line) => {
                    const menuItem = line.item_id ? (menuItems.get(line.item_id) ?? null) : null;
                    const options = menu && menuItem ? menuItemOptions(menu, menuItem) : null;
                    const summary = describeLineOptions(line);
                    const isOpen = expanded === line.key;
                    return (
                      <li key={line.key} className="rounded-md border p-2.5">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                              {line.name}
                              {!line.id && (
                                <Badge variant="outline" className="h-4 px-1 text-[9px]">
                                  Added by you
                                </Badge>
                              )}
                            </div>
                            {summary.length > 0 && (
                              <p className="text-[11px] text-muted-foreground">
                                {summary.join(" · ")}
                              </p>
                            )}
                            {line.notes.trim() && (
                              <p className="text-[11px] italic text-amber-200/90">
                                Note: {line.notes.trim()}
                              </p>
                            )}
                            {line.id && line.added_by && (
                              <p className="text-[10px] text-muted-foreground">
                                Added by {line.added_by}
                              </p>
                            )}
                          </div>
                          <Stepper
                            label={line.name}
                            value={line.quantity}
                            min={1}
                            max={MAX_QUANTITY}
                            disabled={blocked}
                            onChange={(q) => update(line.key, (l) => withQuantity(l, q))}
                          />
                          <span className="w-24 pt-1 text-right text-sm tabular-nums">
                            {money(lineTotal(line))}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            aria-label={`Remove ${line.name}`}
                            disabled={blocked}
                            onClick={() =>
                              setDraft((lines) => lines.filter((l) => l.key !== line.key))
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                        <button
                          type="button"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                          onClick={() => setExpanded(isOpen ? null : line.key)}
                          disabled={blocked}
                          aria-expanded={isOpen}
                        >
                          <SlidersHorizontal className="size-3" />
                          {isOpen ? "Done" : "Modifiers & note"}
                        </button>
                        {isOpen && (
                          <LineOptions
                            line={line}
                            options={options}
                            menuLoading={menuQuery.isLoading}
                            onChange={(next) => update(line.key, () => next)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>

                {draft.length === 0 && (
                  <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    {addedMeanwhile.length > 0
                      ? "You've removed every item you started with."
                      : "No items. Add one from the menu, or close this and reject the order instead."}
                  </p>
                )}

                {addedMeanwhile.length > 0 && (
                  <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-2.5 text-xs">
                    <p className="font-medium text-sky-300">
                      Added by guests while you were editing — these stay on the order
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {addedMeanwhile.map((i) => (
                        <li key={i.id} className="flex justify-between gap-2">
                          <span>
                            {i.quantity}× {i.item_name}
                            {i.added_by_label ? ` — ${i.added_by_label}` : ""}
                          </span>
                          <span className="tabular-nums">{money(i.line_total)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              <section className="space-y-1.5">
                <Label htmlFor="edit-special">
                  Special instructions{" "}
                  <span className="font-normal text-muted-foreground">(the kitchen sees this)</span>
                </Label>
                <Textarea
                  id="edit-special"
                  rows={2}
                  maxLength={MAX_TEXT}
                  value={special}
                  disabled={blocked}
                  onChange={(e) => setSpecial(e.target.value)}
                  placeholder="e.g. Bring the starters out together"
                />
              </section>

              <section className="space-y-1.5">
                <Label htmlFor="edit-note">
                  Add a note{" "}
                  <span className="font-normal text-muted-foreground">
                    (saved to the order&apos;s history for staff — not shown to the kitchen)
                  </span>
                </Label>
                <Textarea
                  id="edit-note"
                  rows={2}
                  maxLength={MAX_TEXT}
                  value={note}
                  disabled={blocked}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Guest asked for the steak to come out after the salads"
                />
              </section>

              {price && (
                <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="text-right tabular-nums">{money(price.subtotal)}</dd>
                  <dt className="text-muted-foreground">Service fee</dt>
                  <dd className="text-right tabular-nums">{money(price.service_fee)}</dd>
                  <dt className="font-medium">New total</dt>
                  <dd className="text-right font-medium tabular-nums">{money(price.total)}</dd>
                </dl>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2 border-t p-4">
          <Button variant="ghost" onClick={onClose} disabled={saving !== null}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => void save(false)}
            disabled={blocked || empty || saving !== null}
          >
            {saving === "save" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-4" />
            )}
            Save changes
          </Button>
          <Button onClick={() => void save(true)} disabled={blocked || empty || saving !== null}>
            {saving === "confirm" ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <CheckCheck className="mr-1.5 size-4" />
            )}
            Save &amp; confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------ pieces */

function Notice({ children, tone }: { children: React.ReactNode; tone: "error" | "info" }) {
  return (
    <p
      className={`flex items-start gap-2 rounded-md border p-2.5 text-xs ${
        tone === "error"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-sky-500/30 bg-sky-500/5 text-sky-300"
      }`}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center rounded-md border">
      <button
        type="button"
        className="px-1.5 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
        aria-label={`One fewer ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus className="size-3" />
      </button>
      <span className="w-6 text-center text-xs tabular-nums" aria-label={`${label} quantity`}>
        {value}
      </span>
      <button
        type="button"
        className="px-1.5 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
        aria-label={`One more ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
}

const chip = (on: boolean) =>
  `rounded-full border px-2.5 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
    on
      ? "border-primary bg-primary/15 text-foreground"
      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
  }`;

/** Size, modifier groups, add-ons and note for one line. */
function LineOptions({
  line,
  options,
  menuLoading,
  onChange,
}: {
  line: DraftLine;
  /** null when the item isn't on the restaurant's menu (any more). */
  options: MenuItemOptions | null;
  menuLoading: boolean;
  onChange: (line: DraftLine) => void;
}) {
  const known = (a: OrderLineAddon) => {
    if (!options) return false;
    const mod = parseModifierAddonId(a.id);
    if (mod) {
      return options.modifiers.some(
        (m) =>
          m.group.id === mod.modifier_id && m.choices.some((c) => c.index === mod.choice_index),
      );
    }
    return options.addons.some((x) => x.id === a.id);
  };
  const other = line.addons.filter((a) => !known(a));
  const variants = options?.variants ?? [];
  const staleVariant = line.variant && !variants.some((v) => v.id === line.variant!.id);

  return (
    <div className="mt-2 space-y-3 rounded-md border bg-muted/20 p-2.5 text-xs">
      {menuLoading && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Loading the menu…
        </p>
      )}
      {!menuLoading && !options && (
        <p className="text-muted-foreground">
          This item isn&apos;t on the menu any more, so only its current extras can be removed.
        </p>
      )}

      {(variants.length > 0 || staleVariant) && (
        <div>
          <p className="mb-1 font-medium">Size</p>
          <div className="flex flex-wrap gap-1.5">
            {staleVariant && (
              <button type="button" className={chip(true)} aria-pressed disabled>
                {line.variant!.name}
              </button>
            )}
            {variants.map((v) => {
              const on = line.variant?.id === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={on}
                  className={chip(on)}
                  onClick={() =>
                    onChange({
                      ...line,
                      variant: { id: v.id, name: v.name, price_delta: Number(v.price_delta) || 0 },
                    })
                  }
                >
                  {v.name}
                  {v.price_delta
                    ? ` ${v.price_delta > 0 ? "+" : "−"}${money(Math.abs(v.price_delta))}`
                    : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {options?.modifiers.map(({ group, choices }) => {
        const max = maxChoices(group);
        const picked = line.addons.filter(
          (a) => parseModifierAddonId(a.id)?.modifier_id === group.id,
        ).length;
        return (
          <div key={group.id}>
            <p className="mb-1 font-medium">
              {group.name}{" "}
              <span className="font-normal text-muted-foreground">
                {max === 1 ? "· choose 1" : `· up to ${max}`}
                {group.required ? " · required" : ""}
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {choices.map((choice) => {
                const on = line.addons.some(
                  (a) => a.id === modifierAddonId(group.id, choice.index),
                );
                return (
                  <button
                    key={choice.index}
                    type="button"
                    aria-pressed={on}
                    className={chip(on)}
                    disabled={!on && max > 1 && picked >= max}
                    onClick={() =>
                      onChange({ ...line, addons: toggleModifierChoice(line, group, choice) })
                    }
                  >
                    {choice.label}
                    {choice.price ? ` +${money(choice.price)}` : ""}
                  </button>
                );
              })}
            </div>
            {group.required && picked === 0 && (
              <p className="mt-1 text-amber-300">
                Required — pick one before sending it to the kitchen.
              </p>
            )}
          </div>
        );
      })}

      {options && options.addons.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Add-ons</p>
          <ul className="space-y-1">
            {options.addons.map((addon) => {
              const qty = line.addons.find((a) => a.id === addon.id)?.quantity ?? 0;
              return (
                <li key={addon.id} className="flex items-center justify-between gap-2">
                  <span>
                    {addon.name}{" "}
                    <span className="text-muted-foreground">+{money(addon.price)}</span>
                  </span>
                  <Stepper
                    label={addon.name}
                    value={qty}
                    min={0}
                    max={addon.max_quantity}
                    onChange={(q) =>
                      onChange({ ...line, addons: setAddonQuantity(line.addons, addon, q) })
                    }
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {other.length > 0 && (
        <div>
          <p className="mb-1 font-medium">Other extras on this item</p>
          <div className="flex flex-wrap gap-1.5">
            {other.map((a) => (
              <span key={a.id} className={`${chip(true)} inline-flex items-center gap-1`}>
                {describeLineOptions({ addons: [a] })[0]}
                {a.price > 0 && ` +${money(a.price * a.quantity)}`}
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    onChange({ ...line, addons: line.addons.filter((x) => x.id !== a.id) })
                  }
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor={`note-${line.key}`} className="text-xs">
          Item note{" "}
          <span className="font-normal text-muted-foreground">(the kitchen sees this)</span>
        </Label>
        <Input
          id={`note-${line.key}`}
          className="h-8 text-xs"
          maxLength={MAX_TEXT}
          value={line.notes}
          onChange={(e) => onChange({ ...line, notes: e.target.value })}
          placeholder="e.g. No onions"
        />
      </div>
    </div>
  );
}

/** Search the restaurant's menu and pick an item to add. */
function MenuPicker({
  menu,
  loading,
  error,
  onPick,
}: {
  menu: MenuPayload | null;
  loading: boolean;
  error: string | null;
  onPick: (item: MenuItem) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    if (!menu) return [];
    const q = query.trim().toLowerCase();
    const categoryName = new Map(menu.categories.map((c) => [c.id, c.name]));
    const order = new Map(menu.categories.map((c, i) => [c.id, i]));
    const byCategory = new Map<string, { name: string; rank: number; items: MenuItem[] }>();
    for (const item of menu.items) {
      if (!item.is_available || !item.name) continue;
      if (q && !item.name.toLowerCase().includes(q) && !item.category.toLowerCase().includes(q)) {
        continue;
      }
      const key = item.category_id ?? item.category;
      const group = byCategory.get(key) ?? {
        name: (item.category_id && categoryName.get(item.category_id)) || item.category || "Menu",
        rank: item.category_id ? (order.get(item.category_id) ?? 999) : 999,
        items: [],
      };
      group.items.push(item);
      byCategory.set(key, group);
    }
    return [...byCategory.values()]
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
      .map((g) => ({ ...g, items: g.items.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [menu, query]);

  return (
    <div className="rounded-md border bg-muted/10 p-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the menu"
          className="h-9 pl-8"
        />
      </div>
      <div className="mt-2 max-h-64 overflow-y-auto">
        {loading ? (
          <p className="flex items-center gap-1.5 p-3 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Loading the menu…
          </p>
        ) : error ? (
          <p className="p-3 text-xs text-destructive">{error}</p>
        ) : groups.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            {menu && menu.items.length > 0
              ? "Nothing on the menu matches."
              : "This restaurant has no menu items yet."}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.name} className="mb-2">
              <p className="px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {group.name}
              </p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => onPick(item)}
                    >
                      <span className="truncate">{item.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {money(menuItemPrice(item))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
