// Combo deals manager — per-restaurant promotions, two deal kinds:
//
//  - "bundle":   several DIFFERENT menu items bought together at a discount
//               (percent or fixed rand off the bundle total).
//  - "multibuy": several units of the SAME item — e.g. "3 for 2": customer
//               gets 3, pays for 2.
//
// Deals live under /promotions/combos so the customer app reads them
// alongside coupons and loyalty rewards.

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  CheckCircle2,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Save,
  Search,
  Store,
  Trash2,
  ToggleLeft,
  ToggleRight,
  UtensilsCrossed,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { subscribeFirebaseMenu, type MenuItem } from "@/lib/menus.firebase";
import {
  comboDealLabel,
  comboDiscountLabel,
  comboKind,
  comboPricing,
  deleteComboDeal,
  multibuyPricing,
  saveComboDeal,
  toggleComboDeal,
  type ComboDeal,
  type ComboDiscountType,
  type ComboKind,
} from "@/lib/promotions.firebase";

const money = (n: number) => `R ${n.toFixed(2)}`;
/** Price customers actually pay for an item (respecting item-level sale prices). */
const effectivePrice = (i: MenuItem) =>
  i.discount_price != null && i.discount_price > 0 ? i.discount_price : i.price;

export function ComboManager({
  restaurants,
  combos,
}: {
  restaurants: { id: string; name: string }[];
  combos: ComboDeal[];
}) {
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoaded, setMenuLoaded] = useState(false);
  const [editing, setEditing] = useState<ComboDeal | null>(null);
  const [saving, setSaving] = useState(false);

  const restaurant = restaurants.find((r) => r.id === restaurantId) ?? null;
  const list = useMemo(
    () => (restaurantId ? combos.filter((c) => c.restaurant_id === restaurantId) : []),
    [combos, restaurantId],
  );
  const itemsById = useMemo(() => new Map(menuItems.map((i) => [i.id, i])), [menuItems]);

  // Load the chosen restaurant's menu so combos can reference real items.
  useEffect(() => {
    setMenuItems([]);
    setMenuLoaded(false);
    if (!restaurantId) return;
    let received = false;
    const unsub = subscribeFirebaseMenu(restaurantId, (p) => {
      received = true;
      setMenuItems(p.items);
      setMenuLoaded(true);
    });
    // If Firebase has no menu for this restaurant at all, the callback may
    // never fire — treat "no data after a moment" as an empty menu.
    const t = setTimeout(() => {
      if (!received) setMenuLoaded(true);
    }, 2500);
    return () => {
      clearTimeout(t);
      unsub();
    };
  }, [restaurantId]);

  async function handleSave(input: Parameters<typeof saveComboDeal>[0]) {
    setSaving(true);
    try {
      await saveComboDeal(input);
      setEditing(null);
      toast.success(`Combo deal "${input.name}" saved`);
    } catch (e) {
      toast.error((e as Error).message || "Failed to save combo deal");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(deal: ComboDeal) {
    try {
      await toggleComboDeal(deal.id, !deal.is_active);
      toast.success(deal.is_active ? "Combo deactivated" : "Combo activated");
    } catch (e) {
      toast.error((e as Error).message || "Failed to update combo");
    }
  }

  async function handleDelete(deal: ComboDeal) {
    if (!confirm(`Delete combo deal "${deal.name}"?`)) return;
    try {
      await deleteComboDeal(deal.id);
      toast.success("Combo deal deleted");
    } catch (e) {
      toast.error((e as Error).message || "Failed to delete combo");
    }
  }

  return (
    <div className="space-y-4">
      {/* Restaurant dropdown — combos are always for a specific restaurant */}
      <div className="w-full max-w-md space-y-1.5">
        <Label htmlFor="combo-restaurant" className="text-xs font-medium">
          Restaurant
        </Label>
        <div className="flex gap-2">
          <Select value={restaurantId ?? ""} onValueChange={(v) => setRestaurantId(v)}>
            <SelectTrigger id="combo-restaurant" className="flex-1">
              <SelectValue placeholder="No restaurant selected — choose one…" />
            </SelectTrigger>
            <SelectContent>
              {restaurants.map((r) => {
                const n = combos.filter((c) => c.restaurant_id === r.id).length;
                return (
                  <SelectItem key={r.id} value={r.id}>
                    <span className="truncate">{r.name}</span>
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      {n === 0 ? "no combos" : `${n} combo${n === 1 ? "" : "s"}`}
                    </span>
                  </SelectItem>
                );
              })}
              {restaurants.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No restaurants in Firebase yet.
                </div>
              )}
            </SelectContent>
          </Select>
          {restaurantId && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setRestaurantId(null)}
              aria-label="Clear selection"
              title="Clear selection"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Combos are built from a restaurant&apos;s own menu items, so each deal belongs to one
          restaurant.
        </p>
      </div>

      {restaurant ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold">Combo deals for {restaurant.name}</h3>
              <p className="text-xs text-muted-foreground">
                {list.length} deal{list.length === 1 ? "" : "s"} — bundles of items or multi-buy
                offers like “3 for 2”.
              </p>
            </div>
            <Button
              onClick={() => setEditing(newBlankCombo(restaurant.id))}
              disabled={menuItems.length < 1 && menuLoaded}
              title={
                menuItems.length < 1 && menuLoaded
                  ? "This restaurant needs menu items to build a combo"
                  : undefined
              }
            >
              <Plus className="mr-1.5 size-4" /> New combo
            </Button>
          </div>

          {menuLoaded && menuItems.length < 1 && (
            <Card className="border-warning/30 bg-warning/5">
              <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm">
                <UtensilsCrossed className="size-4 shrink-0 text-warning-foreground/80" />
                <p className="flex-1">
                  {restaurant.name} needs menu items before it can run a combo deal.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link to="/menus" search={{ restaurant: restaurant.id }}>
                    Add menu items
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {list.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {list.map((deal) => (
                <ComboCard
                  key={deal.id}
                  deal={deal}
                  itemsById={itemsById}
                  onEdit={() => setEditing(deal)}
                  onToggle={() => void handleToggle(deal)}
                  onDelete={() => void handleDelete(deal)}
                />
              ))}
            </div>
          ) : (
            menuItems.length >= 1 && (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  <Layers className="mx-auto mb-2 size-8 opacity-40" />
                  No combos for {restaurant.name} yet. Click <b>New combo</b> to bundle items at a
                  discount or run a “3 for 2” multi-buy.
                </CardContent>
              </Card>
            )
          )}
        </>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center">
            <Store className="mx-auto mb-3 size-9 text-muted-foreground/40" />
            <p className="text-sm font-medium">No restaurant selected</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick a restaurant from the dropdown above to manage its combo deals.
            </p>
          </CardContent>
        </Card>
      )}

      {editing && restaurant && (
        <ComboEditor
          restaurant={restaurant}
          items={menuItems}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          isSaving={saving}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Combo card                                                          */
/* ------------------------------------------------------------------ */

function ComboCard({
  deal,
  itemsById,
  onEdit,
  onToggle,
  onDelete,
}: {
  deal: ComboDeal;
  itemsById: Map<string, MenuItem>;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const kind = comboKind(deal);
  const KindIcon = kind === "multibuy" ? Repeat : Layers;

  // Pricing differs per kind.
  const bundleItems =
    kind === "bundle"
      ? deal.item_ids.map((id) => itemsById.get(id)).filter((i): i is MenuItem => !!i)
      : [];
  const bundleSubtotal = bundleItems.reduce((s, i) => s + effectivePrice(i), 0);
  const bundlePrice = comboPricing(bundleSubtotal, deal);

  const mbUnit = kind === "multibuy" ? itemsById.get(deal.item_ids[0] ?? "") : undefined;
  const mb =
    kind === "multibuy" && deal.buy_qty != null && deal.pay_qty != null
      ? multibuyPricing(mbUnit ? effectivePrice(mbUnit) : 0, deal.buy_qty, deal.pay_qty)
      : null;

  const hasPrice = kind === "bundle" ? bundleSubtotal > 0 : mb != null && mbUnit != null;
  const expired = new Date(deal.expires_at) < new Date();

  return (
    <Card className={deal.is_active ? "" : "opacity-70"}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <KindIcon className="size-4 shrink-0 text-primary" />
              <span className="truncate">{deal.name}</span>
            </CardTitle>
            <CardDescription className="mt-1 truncate">{deal.description ?? "—"}</CardDescription>
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Toggle combo"
          >
            {deal.is_active ? (
              <ToggleRight className="size-5 text-primary" />
            ) : (
              <ToggleLeft className="size-5" />
            )}
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-1.5">
          <Badge>
            {comboDealLabel(deal)}
            {kind === "bundle" ? " off the bundle" : ""}
          </Badge>
          {kind === "multibuy" && mb && mb.freeQty > 0 && (
            <Badge variant="secondary">{mb.freeQty} free</Badge>
          )}
          <Badge variant="secondary">
            {kind === "multibuy"
              ? `${deal.buy_qty ?? "?"} × ${mbUnit?.name ?? "item"}`
              : `${deal.item_ids.length} item${deal.item_ids.length === 1 ? "" : "s"}`}
          </Badge>
          {!deal.is_active && <Badge variant="destructive">Inactive</Badge>}
          {expired && <Badge variant="destructive">Expired</Badge>}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {kind === "multibuy"
            ? `Customer buys ${deal.buy_qty ?? "?"} × ${mbUnit?.name ?? "the item"} but only pays for ${deal.pay_qty ?? "?"}.`
            : bundleItems.length > 0
              ? bundleItems.map((i) => i.name).join(" + ")
              : `${deal.item_ids.length} menu items (menu not loaded)`}
        </p>

        {hasPrice && (
          <>
            <Separator />
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>{kind === "multibuy" ? "Buying separately" : "Bundle total"}</span>
                <span className="tabular-nums">
                  {money(kind === "multibuy" ? mb!.subtotal : bundleSubtotal)}
                </span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Customers pay</span>
                <span className="tabular-nums text-emerald-500">
                  {money(kind === "multibuy" ? mb!.final : bundlePrice.final)}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>They save</span>
                <span className="tabular-nums">
                  {money(kind === "multibuy" ? mb!.discount : bundlePrice.discount)}
                </span>
              </div>
            </div>
          </>
        )}

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {new Date(deal.starts_at).toLocaleDateString()} →{" "}
            {new Date(deal.expires_at).toLocaleDateString()}
          </span>
        </div>
        <Separator />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={onEdit}>
            <Pencil className="mr-1 size-3" /> Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
            aria-label="Delete combo"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Combo editor modal                                                  */
/* ------------------------------------------------------------------ */

function newBlankCombo(restaurantId: string): ComboDeal {
  const ts = new Date().toISOString();
  return {
    id: "",
    restaurant_id: restaurantId,
    name: "",
    description: "",
    kind: "bundle",
    item_ids: [],
    discount_type: "percent",
    discount_value: 10,
    buy_qty: null,
    pay_qty: null,
    is_active: true,
    starts_at: ts,
    expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
    created_at: ts,
    updated_at: ts,
  };
}

function ComboEditor({
  restaurant,
  items,
  initial,
  onClose,
  onSave,
  isSaving,
}: {
  restaurant: { id: string; name: string };
  items: MenuItem[];
  initial: ComboDeal;
  onClose: () => void;
  onSave: (input: Parameters<typeof saveComboDeal>[0]) => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [kind, setKind] = useState<ComboKind>(comboKind(initial));

  // Bundle state
  const [discountType, setDiscountType] = useState<ComboDiscountType>(
    initial.discount_type ?? "percent",
  );
  const [discountValue, setDiscountValue] = useState(String(initial.discount_value ?? 10));
  const [itemIds, setItemIds] = useState<string[]>(
    comboKind(initial) === "bundle" ? initial.item_ids : [],
  );

  // Multi-buy state
  const [itemId, setItemId] = useState(
    comboKind(initial) === "multibuy" ? (initial.item_ids[0] ?? "") : "",
  );
  const [buyQty, setBuyQty] = useState(String(initial.buy_qty ?? 3));
  const [payQty, setPayQty] = useState(String(initial.pay_qty ?? 2));

  const [query, setQuery] = useState("");
  const [startsAt, setStartsAt] = useState(initial.starts_at.slice(0, 10));
  const [expiresAt, setExpiresAt] = useState(initial.expires_at.slice(0, 10));
  const [isActive, setIsActive] = useState(initial.is_active);

  const availableItems = useMemo(() => items.filter((i) => i.is_available), [items]);

  // ---- bundle pricing preview ----
  const selectedItems = useMemo(
    () => itemIds.map((id) => items.find((i) => i.id === id)).filter((i): i is MenuItem => !!i),
    [itemIds, items],
  );
  const bundleSubtotal = selectedItems.reduce((s, i) => s + effectivePrice(i), 0);
  const bundlePrice = comboPricing(bundleSubtotal, {
    discount_type: discountType,
    discount_value: Number(discountValue) || 0,
  });

  // ---- multibuy pricing preview ----
  const mbItem = availableItems.find((i) => i.id === itemId) ?? null;
  const buyInt = Math.floor(Number(buyQty));
  const payInt = Math.floor(Number(payQty));
  const mbValid =
    mbItem != null &&
    Number.isInteger(buyInt) &&
    buyInt >= 2 &&
    Number.isInteger(payInt) &&
    payInt >= 1 &&
    payInt < buyInt;
  const mb = mbValid ? multibuyPricing(effectivePrice(mbItem), buyInt, payInt) : null;

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? items.filter(
          (i) => i.name.toLowerCase().includes(q) || i.category?.toLowerCase().includes(q),
        )
      : items;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [items, query]);

  function toggleItem(id: string) {
    setItemIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Give the combo a name");
      return;
    }

    if (kind === "multibuy") {
      if (!itemId) {
        toast.error("Pick the menu item for this multi-buy deal");
        return;
      }
      if (!mbValid) {
        toast.error(
          'Check the quantities: "gets" must be at least 2 and "pays for" must be smaller',
        );
        return;
      }
      void onSave({
        ...(initial.id ? { id: initial.id } : {}),
        restaurant_id: restaurant.id,
        name: name.trim(),
        description: description.trim() || null,
        kind: "multibuy",
        item_ids: [itemId],
        buy_qty: buyInt,
        pay_qty: payInt,
        discount_type: null,
        discount_value: null,
        starts_at: new Date(startsAt).toISOString(),
        expires_at: new Date(expiresAt + "T23:59:59").toISOString(),
        is_active: isActive,
      });
      return;
    }

    // bundle
    if (itemIds.length < 2) {
      toast.error("Tick at least two menu items to make a bundle");
      return;
    }
    const v = Number(discountValue);
    if (!Number.isFinite(v) || v <= 0) {
      toast.error("Discount must be greater than zero");
      return;
    }
    if (discountType === "percent" && v > 100) {
      toast.error("Percent discount cannot exceed 100");
      return;
    }
    void onSave({
      ...(initial.id ? { id: initial.id } : {}),
      restaurant_id: restaurant.id,
      name: name.trim(),
      description: description.trim() || null,
      kind: "bundle",
      item_ids: itemIds,
      buy_qty: null,
      pay_qty: null,
      discount_type: discountType,
      discount_value: v,
      starts_at: new Date(startsAt).toISOString(),
      expires_at: new Date(expiresAt + "T23:59:59").toISOString(),
      is_active: isActive,
    });
  }

  const showBundlePreview = kind === "bundle" && itemIds.length >= 2 && bundleSubtotal > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className="flex items-center justify-between border-b px-5 py-3">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <Layers className="size-4 text-primary" />
                {initial.id ? "Edit combo" : "New combo"}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Only for <b>{restaurant.name}</b>.
              </p>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>

          <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
            {/* Deal type */}
            <div className="space-y-1.5">
              <Label>Deal type</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <KindOption
                  icon={<Layers className="size-4" />}
                  title="Bundle discount"
                  description="Different items together, discounted (e.g. −15% on burger + chips + drink)."
                  selected={kind === "bundle"}
                  onSelect={() => setKind("bundle")}
                />
                <KindOption
                  icon={<Repeat className="size-4" />}
                  title="Multi-buy (3 for 2)"
                  description="Same item several times — customer gets N but pays for M (e.g. 3 for 2)."
                  selected={kind === "multibuy"}
                  onSelect={() => setKind("multibuy")}
                />
              </div>
            </div>

            {/* Name + description */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Combo name</Label>
                <Input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={kind === "multibuy" ? "3-for-2 Burger Deal" : "Family Feast"}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description (optional)</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={
                    kind === "multibuy" ? "Buy 3 smash burgers, pay for 2" : "2 pizzas + 1.5L drink"
                  }
                />
              </div>
            </div>

            {kind === "bundle" ? (
              <>
                {/* Bundle discount */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Discount type</Label>
                    <Select
                      value={discountType}
                      onValueChange={(v) => setDiscountType(v as ComboDiscountType)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percent">Percent off the bundle</SelectItem>
                        <SelectItem value="fixed">Fixed amount off (R)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Discount value ({discountType === "percent" ? "%" : "R"})</Label>
                    <Input
                      type="number"
                      min={0}
                      max={discountType === "percent" ? 100 : undefined}
                      step="0.5"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                    />
                  </div>
                </div>

                {/* Bundle items picker */}
                <div className="space-y-1.5">
                  <Label>Items in this bundle</Label>
                  <div className="overflow-hidden rounded-lg border">
                    <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
                      <Search className="size-3.5 shrink-0 text-muted-foreground" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search menu items…"
                        className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                      />
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {itemIds.length} selected
                      </span>
                    </div>
                    <div className="max-h-52 space-y-0.5 overflow-y-auto p-1.5">
                      {visibleItems.map((item) => {
                        const checked = itemIds.includes(item.id);
                        return (
                          <label
                            key={item.id}
                            className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition ${
                              checked ? "bg-primary/[0.06]" : "hover:bg-muted/50"
                            } ${!item.is_available ? "opacity-50" : ""}`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleItem(item.id)}
                              disabled={!item.is_available}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {item.name}
                              {item.category && (
                                <span className="ml-1.5 text-[10px] text-muted-foreground">
                                  {item.category}
                                </span>
                              )}
                            </span>
                            {!item.is_available && (
                              <span className="text-[10px] text-muted-foreground">unavailable</span>
                            )}
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {money(effectivePrice(item))}
                            </span>
                          </label>
                        );
                      })}
                      {visibleItems.length === 0 && (
                        <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                          {query
                            ? "No items match your search."
                            : "This restaurant has no menu items."}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Tick at least two items — buying all of them together unlocks the discount.
                  </p>
                </div>
              </>
            ) : (
              <>
                {/* Multi-buy item + quantities */}
                <div className="space-y-1.5">
                  <Label>Menu item</Label>
                  <Select value={itemId} onValueChange={setItemId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick the item for this deal…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableItems.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          <span className="truncate">{i.name}</span>
                          <span className="ml-2 text-[10px] text-muted-foreground">
                            {money(effectivePrice(i))}
                          </span>
                        </SelectItem>
                      ))}
                      {availableItems.length === 0 && (
                        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                          No available menu items.
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Customer gets (qty)</Label>
                    <Input
                      type="number"
                      min={2}
                      step={1}
                      value={buyQty}
                      onChange={(e) => setBuyQty(e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">How many they receive.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Pays for (qty)</Label>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={payQty}
                      onChange={(e) => setPayQty(e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      How many they pay for — must be less.
                    </p>
                  </div>
                </div>
              </>
            )}

            {/* Dates + publish */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Starts</Label>
                <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Expires</Label>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={isActive} onCheckedChange={setIsActive} />
                Publish immediately
              </label>
            </div>

            {/* Live price preview — bundle */}
            {showBundlePreview && (
              <PreviewBox
                rows={[
                  ["Buying items separately", money(bundleSubtotal)],
                  [
                    `Bundle discount (${comboDiscountLabel({ discount_type: discountType, discount_value: Number(discountValue) || 0 })})`,
                    `− ${money(bundlePrice.discount)}`,
                  ],
                ]}
                total={["Customer pays", money(bundlePrice.final)]}
              />
            )}

            {/* Live price preview — multi-buy */}
            {kind === "multibuy" && mb && mbItem && (
              <PreviewBox
                rows={[
                  [
                    `${buyInt} × ${mbItem.name} @ ${money(effectivePrice(mbItem))}`,
                    money(mb.subtotal),
                  ],
                  [`Only pays for ${payInt}`, `− ${money(mb.discount)}`],
                ]}
                total={["Customer pays", money(mb.final)]}
                extra={
                  mb.freeQty > 0
                    ? `${mb.freeQty} item${mb.freeQty === 1 ? "" : "s"} free`
                    : undefined
                }
              />
            )}
          </div>

          <div className="flex justify-end gap-2 border-t bg-muted/30 px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 size-3.5" />
              )}
              {initial.id ? "Save changes" : "Create combo"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small editor pieces                                                 */
/* ------------------------------------------------------------------ */

function KindOption({
  icon,
  title,
  description,
  selected,
  onSelect,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition ${
        selected ? "border-primary/40 bg-primary/[0.06]" : "border-border/60 hover:bg-muted/30"
      }`}
    >
      <span
        className={`mt-0.5 inline-grid size-4 shrink-0 place-items-center rounded-full border-2 ${
          selected ? "border-primary" : "border-muted-foreground/40"
        }`}
      >
        {selected && <span className="size-1.5 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {title}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

function PreviewBox({
  rows,
  total,
  extra,
}: {
  rows: [string, string][];
  total: [string, string];
  extra?: string | undefined;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-xs">
      <p className="mb-1.5 flex items-center gap-1.5 font-medium">
        <CheckCircle2 className="size-3.5 text-emerald-500" /> Customer price preview
      </p>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 text-muted-foreground">
          <span className="truncate">{label}</span>
          <span className="shrink-0 tabular-nums">{value}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-3 border-t border-dashed pt-1.5 font-semibold">
        <span>{total[0]}</span>
        <span className="shrink-0 tabular-nums text-emerald-500">{total[1]}</span>
      </div>
      {extra && <p className="mt-1 text-[11px] text-muted-foreground">{extra}</p>}
    </div>
  );
}
