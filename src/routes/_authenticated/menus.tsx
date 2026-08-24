import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FolderOpen,
  ImagePlus,
  LayoutGrid,
  Loader2,
  Package,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import { CloudinaryImageUpload } from "@/components/cloudinary-image-upload";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useFirebaseRestaurants } from "@/hooks/use-firebase-restaurants";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  deleteFirebaseMenuChild as deleteMenuChild,
  deleteFirebaseCategory as deleteCategory,
  deleteFirebaseMenuItem as deleteMenuItem,
  getFirebaseMenu,
  saveFirebaseAddon as saveAddon,
  saveFirebaseCategory as saveCategory,
  saveFirebaseMenuItem as saveMenuItem,
  saveFirebaseModifier as saveModifier,
  saveFirebaseVariant as saveVariant,
  subscribeFirebaseMenu,
  toggleFirebaseMenuItem as toggleMenuItem,
  addonsForMenuItem,
  modifiersForMenuItem,
  variantsForMenuItem,
  type MenuItem,
  type MenuModifier,
  type MenuPayload,
  type ModifierChoiceConfig,
} from "@/lib/menus.firebase";
import { isFirebaseAvailable } from "@/lib/firebase";

export const Route = createFileRoute("/_authenticated/menus")({
  validateSearch: (search: Record<string, unknown>) => ({
    restaurant: (search["restaurant"] as string) ?? "",
  }),
  head: () => ({
    meta: [
      { title: "Menu Management — ForkFleet Console" },
      {
        name: "description",
        content:
          "Manage menu categories, products, variants, add-ons, pricing, availability and imagery synced with Firebase.",
      },
      { property: "og:title", content: "Menu Management — ForkFleet Console" },
      {
        property: "og:description",
        content: "Categories, products, variants, add-ons, pricing and availability.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MenusPage,
});

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// Curated Unsplash food photo IDs for the "random product image" helper.
const PRODUCT_PHOTO_IDS = [
  "photo-1565299624946-b28f40a0ae38",
  "photo-1565958011703-44f9829ba187",
  "photo-1568901346375-23c9450c58cd",
  "photo-1569718212165-3a8278d5f624",
  "photo-1555939594-58d7cb561ad1",
  "photo-1540189549336-e6e99c3679fe",
  "photo-1606313564200-e75d5e30476c",
  "photo-1617196034796-73dfa7b1fd56",
  "photo-1476124369491-e7addf5db371",
  "photo-1544025162-d76694265947",
  "photo-1528735602780-2552fd46c7af",
  "photo-1608897013039-887f21d8c804",
];
function randomProductImage(): string {
  const id = PRODUCT_PHOTO_IDS[Math.floor(Math.random() * PRODUCT_PHOTO_IDS.length)]!;
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=700&q=70&sig=${Math.floor(Math.random() * 10000)}`;
}

function productCustomizationCounts(
  itemId: string,
  variants: MenuPayload["variants"],
  addons: MenuPayload["addons"],
  item: MenuItem,
  modifiers: MenuModifier[],
) {
  const v = variantsForMenuItem(variants, itemId).length;
  const a = addonsForMenuItem(addons, itemId).length;
  const m = modifiersForMenuItem(modifiers, item).length;
  return { v, a, m };
}

function toggleProductModifierChoice(
  item: MenuItem,
  modifier: MenuModifier,
  choiceIdx: number,
): { modifier_ids: string[]; modifier_config: MenuItem["modifier_config"] } {
  const config = { ...item.modifier_config };
  const modConfig = { ...(config[modifier.id] ?? {}) };
  const current = modConfig[String(choiceIdx)];
  if (current?.selected) {
    modConfig[String(choiceIdx)] = { selected: false, price: 0 };
  } else {
    const originalPrice = modifier.choices[choiceIdx]?.price ?? 0;
    modConfig[String(choiceIdx)] = { selected: true, price: originalPrice };
  }
  config[modifier.id] = modConfig;
  const modifier_ids = Object.keys(config).filter((mid) =>
    Object.values(config[mid] ?? {}).some((c) => c.selected),
  );
  return { modifier_ids, modifier_config: config };
}

function updateProductModifierChoicePrice(
  item: MenuItem,
  modifierId: string,
  choiceIdx: number,
  price: number,
): MenuItem["modifier_config"] {
  const config = { ...item.modifier_config };
  const modConfig = { ...(config[modifierId] ?? {}) };
  modConfig[String(choiceIdx)] = {
    ...(modConfig[String(choiceIdx)] ?? { selected: true }),
    selected: true,
    price,
  };
  config[modifierId] = modConfig;
  return config;
}

type PendingDelete =
  | { kind: "category"; id: string; label: string }
  | { kind: "product"; id: string; label: string }
  | { kind: "variant"; id: string; label: string }
  | { kind: "addon"; id: string; label: string }
  | { kind: "modifier"; id: string; label: string };

function MenusPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [restaurantId, setRestaurantId] = useState(search.restaurant);
  const [newProductImageUrl, setNewProductImageUrl] = useState("");
  const [activeTab, setActiveTab] = useState("products");
  const [productSearch, setProductSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [newProductCategoryId, setNewProductCategoryId] = useState("");
  const [newModifierType, setNewModifierType] = useState<"option" | "extra">("option");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const queryClient = useQueryClient();
  const { rows: restaurants, loading: rLoading } = useFirebaseRestaurants();

  // Track per-restaurant menu item counts so we can (a) show item counts in the
  // picker and (b) auto-select a restaurant that actually has menu data when no
  // id is in the URL. We prefetch counts for all restaurants lazily.
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    if (!isFirebaseAvailable() || restaurants.length === 0) return;
    Promise.all(
      restaurants.map(async (r) => {
        const snap = await import("@/lib/firebase").then(({ rtdbGet }) =>
          rtdbGet<Record<string, unknown>>(`menus/${r.id}/items`),
        );
        return [r.id, snap ? Object.keys(snap).length : 0] as const;
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setItemCounts(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [restaurants]);

  // Auto-select a restaurant on load once the list arrives: prefer the one from
  // the URL, else the restaurant with the most menu items (people usually want
  // to edit an existing menu), else the first approved restaurant, else the
  // first in the list. This prevents the picker silently landing on a brand-new
  // empty restaurant and making existing items look "missing".
  useEffect(() => {
    if (restaurantId) return;
    if (restaurants.length === 0) return;
    const approvedWithItems = restaurants.find(
      (r) => r.status === "approved" && (itemCounts[r.id] ?? 0) > 0,
    );
    const anyWithItems = restaurants.find((r) => (itemCounts[r.id] ?? 0) > 0);
    const firstApproved = restaurants.find((r) => r.status === "approved");
    const pick: (typeof restaurants)[number] | undefined =
      approvedWithItems ?? anyWithItems ?? firstApproved ?? restaurants[0];
    if (pick) {
      setRestaurantId(pick.id);
      void navigate({ to: "/menus", search: { restaurant: pick.id }, replace: true });
    }
  }, [restaurants, restaurantId, itemCounts, navigate]);

  // Keep URL in sync when the user changes restaurants.
  useEffect(() => {
    if (!restaurantId) return;
    if (search.restaurant === restaurantId) return;
    void navigate({ to: "/menus", search: { restaurant: restaurantId }, replace: true });
  }, [restaurantId, search.restaurant, navigate]);

  const selectedRestaurant = useMemo(
    () => restaurants.find((r) => r.id === restaurantId) ?? null,
    [restaurants, restaurantId],
  );

  const menuKey = ["menu-fb", restaurantId];

  // Fetch + live-subscribe to the menu.
  const menuQuery = useQuery<MenuPayload>({
    queryKey: menuKey,
    queryFn: async () => {
      if (!selectedRestaurant || !isFirebaseAvailable())
        return { categories: [], items: [], variants: [], addons: [], modifiers: [] };
      return getFirebaseMenu(selectedRestaurant);
    },
    enabled: Boolean(selectedRestaurant),
    initialData: { categories: [], items: [], variants: [], addons: [], modifiers: [] },
  });

  useEffect(() => {
    if (!restaurantId) return;
    const unsub = subscribeFirebaseMenu(restaurantId, (payload) => {
      queryClient.setQueryData(menuKey, payload);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: menuKey });
  const notify = (message: string) => () => {
    toast.success(message);
    void invalidate();
  };
  const fail = (error: Error) => toast.error(error.message);

  const categoryMutation = useMutation({
    mutationFn: (_p: { id?: string; restaurant_id: string; name: string; sort_order?: number }) =>
      saveCategory(_p),
    onSuccess: notify("Category saved"),
    onError: fail,
  });
  const categoryDelete = useMutation({
    mutationFn: (p: { restaurant_id: string; id: string }) => deleteCategory(p),
    onSuccess: notify("Category removed"),
    onError: fail,
  });
  const itemMutation = useMutation({
    mutationFn: (_p: Parameters<typeof saveMenuItem>[0]) => saveMenuItem(_p),
    onSuccess: notify("Product saved"),
    onError: fail,
  });
  const itemDelete = useMutation({
    mutationFn: (p: { restaurant_id: string; id: string }) => deleteMenuItem(p),
    onSuccess: notify("Product removed"),
    onError: fail,
  });
  const availabilityMutation = useMutation({
    mutationFn: (p: { restaurant_id: string; id: string; is_available: boolean }) =>
      toggleMenuItem(p),
    onSuccess: notify("Availability updated"),
    onError: fail,
  });
  const variantMutation = useMutation({
    mutationFn: (_p: Parameters<typeof saveVariant>[0]) => saveVariant(_p),
    onSuccess: notify("Variant saved"),
    onError: fail,
  });
  const addonMutation = useMutation({
    mutationFn: (_p: Parameters<typeof saveAddon>[0]) => saveAddon(_p),
    onSuccess: notify("Add-on saved"),
    onError: fail,
  });
  const modifierMutation = useMutation({
    mutationFn: (_p: Parameters<typeof saveModifier>[0]) => saveModifier(_p),
    onSuccess: notify("Modifier group saved"),
    onError: fail,
  });
  const childDelete = useMutation({
    mutationFn: (p: { restaurant_id: string; id: string; kind: "variant" | "addon" | "modifier" }) =>
      deleteMenuChild(p),
    onSuccess: notify("Removed"),
    onError: fail,
  });

  return (
    <PermissionGate
      required={["menus.view", "menus.manage"]}
      breadcrumb={["Catalogue", "Menus"]}
      title="Menu management"
      description="Build and maintain your restaurant menu — categories, products, pricing, and customisation options."
      actions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="hidden gap-1.5 font-normal sm:inline-flex">
            <span className="size-1.5 rounded-full bg-emerald-500" /> Firebase
          </Badge>
          <Select value={restaurantId} onValueChange={setRestaurantId} disabled={rLoading}>
            <SelectTrigger className="w-64">
              <SelectValue
                placeholder={rLoading ? "Loading restaurants…" : "Choose a restaurant"}
              />
            </SelectTrigger>
            <SelectContent>
              {restaurants.map((r) => {
                const count = itemCounts[r.id];
                return (
                  <SelectItem key={r.id} value={r.id}>
                    <div className="flex w-full items-center gap-2">
                      <Avatar className="size-5 rounded-sm">
                        {r.image_url ? (
                          <AvatarImage src={r.image_url} alt={r.name} className="object-cover" />
                        ) : null}
                        <AvatarFallback className="rounded-sm bg-primary/10 text-[10px] text-primary">
                          {initials(r.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate">{r.name}</span>
                      <span
                        className={`ml-auto rounded-full px-1.5 py-0 text-[10px] ${count && count > 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-muted text-muted-foreground"}`}
                      >
                        {count ?? 0} items
                      </span>
                    </div>
                  </SelectItem>
                );
              })}
              {restaurants.length === 0 && !rLoading && (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  No restaurants in Firebase yet.
                </div>
              )}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {(staff) => {
        const canManage = staff.hasPermission("menus.manage");

        if (!restaurantId) {
          return (
            <Card>
              <CardContent className="py-16 text-center">
                {rLoading ? (
                  <Skeleton className="mx-auto h-5 w-64" />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {restaurants.length === 0
                      ? "No restaurants found in Firebase. Register a restaurant first from the Restaurants page."
                      : "Select a restaurant to load its menu."}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        }
        if (menuQuery.isLoading || !menuQuery.data || !selectedRestaurant)
          return <Skeleton className="h-96 w-full" />;
        const { categories, items, variants, addons, modifiers } = menuQuery.data;

        const sortedCategories = [...categories].sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
        );

        const filteredItems = items.filter((item) => {
          const q = productSearch.trim().toLowerCase();
          if (q) {
            const matchesSearch =
              item.name.toLowerCase().includes(q) ||
              item.description?.toLowerCase().includes(q) ||
              item.category.toLowerCase().includes(q);
            if (!matchesSearch) return false;
          }
          if (categoryFilter === "all") return true;
          if (categoryFilter === "uncategorized") {
            return !item.category_id || !categories.some((c) => c.id === item.category_id);
          }
          return item.category_id === categoryFilter;
        });

        const productGroups: { id: string; name: string; items: typeof items }[] = [];
        for (const cat of sortedCategories) {
          const catItems = filteredItems.filter((i) => i.category_id === cat.id);
          if (catItems.length > 0) {
            productGroups.push({ id: cat.id, name: cat.name, items: catItems });
          }
        }
        const uncategorizedItems = filteredItems.filter(
          (i) => !i.category_id || !categories.some((c) => c.id === i.category_id),
        );
        if (uncategorizedItems.length > 0) {
          productGroups.push({
            id: "uncategorized",
            name: "Uncategorised",
            items: uncategorizedItems,
          });
        }

        const availableCount = items.filter((i) => i.is_available).length;

        const handleConfirmDelete = () => {
          if (!pendingDelete) return;
          const p = { restaurant_id: restaurantId, id: pendingDelete.id };
          switch (pendingDelete.kind) {
            case "category":
              categoryDelete.mutate(p);
              break;
            case "product":
              itemDelete.mutate(p);
              break;
            case "variant":
            case "addon":
            case "modifier":
              childDelete.mutate({ ...p, kind: pendingDelete.kind });
              break;
          }
          setPendingDelete(null);
        };

        const renderProductAccordionItem = (item: MenuItem) => {
                        const itemVariants = variantsForMenuItem(variants, item.id);
                        const itemAddons = addonsForMenuItem(addons, item.id);
                        const itemModifiers = modifiersForMenuItem(modifiers, item);
                        const counts = productCustomizationCounts(
                          item.id,
                          variants,
                          addons,
                          item,
                          modifiers,
                        );
                        return (
                        <AccordionItem key={item.id} value={item.id}>
                          <AccordionTrigger>
                            <div className="flex flex-1 items-center gap-3 pr-3 text-left">
                              <Avatar className="size-10 rounded-md border">
                                {item.image_url ? (
                                  <AvatarImage
                                    src={item.image_url}
                                    alt={item.name}
                                    className="object-cover"
                                  />
                                ) : null}
                                <AvatarFallback className="rounded-md bg-primary/10 text-primary">
                                  {initials(item.name)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium">{item.name}</p>
                                {item.description ? (
                                  <p className="truncate text-xs text-muted-foreground">
                                    {item.description}
                                  </p>
                                ) : null}
                                <p className="mt-0.5 text-[10px] text-muted-foreground">
                                  {counts.v} variant{counts.v === 1 ? "" : "s"} · {counts.a} add-on
                                  {counts.a === 1 ? "" : "s"} · {counts.m} modifier
                                  {counts.m === 1 ? "" : "s"} · {item.prep_time_minutes} min prep
                                </p>
                              </div>
                              <div className="ml-auto flex shrink-0 items-center gap-2">
                                {item.discount_price != null && item.discount_price > 0 ? (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-500/40 text-amber-400"
                                  >
                                    Sale R {Number(item.discount_price).toFixed(2)}
                                  </Badge>
                                ) : null}
                                <Badge variant="outline">R {Number(item.price).toFixed(2)}</Badge>
                                {!item.is_available && (
                                  <Badge variant="secondary">Unavailable</Badge>
                                )}
                                <span className="hidden text-xs text-muted-foreground sm:inline">
                                  {Number(item.points_value ?? 5)} pts · {item.category}
                                </span>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="space-y-4">
                            <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                              <p>
                                <span className="font-medium text-foreground">Category:</span>{" "}
                                {item.category}
                              </p>
                              {item.description ? (
                                <p className="mt-1">
                                  <span className="font-medium text-foreground">Description:</span>{" "}
                                  {item.description}
                                </p>
                              ) : null}
                              <p className="mt-1">
                                <span className="font-medium text-foreground">Prep time:</span>{" "}
                                {item.prep_time_minutes} min ·{" "}
                                <span className="font-medium text-foreground">Points:</span>{" "}
                                {item.points_value ?? 5} ·{" "}
                                <span className="font-medium text-foreground">ID:</span> {item.id}
                              </p>
                              {item.allergens.length > 0 ? (
                                <p className="mt-1">
                                  <span className="font-medium text-foreground">Allergens:</span>{" "}
                                  {item.allergens.join(", ")}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-4">
                              <div className="flex items-center gap-2">
                                <Label className="text-xs">Available</Label>
                                <Switch
                                  checked={item.is_available}
                                  disabled={!canManage}
                                  onCheckedChange={(checked) =>
                                    availabilityMutation.mutate({
                                      restaurant_id: restaurantId,
                                      id: item.id,
                                      is_available: checked,
                                    })
                                  }
                                />
                              </div>
                              {canManage && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive"
                                  onClick={() =>
                                    setPendingDelete({
                                      kind: "product",
                                      id: item.id,
                                      label: item.name,
                                    })
                                  }
                                >
                                  <Trash2 className="mr-1 size-3.5" /> Delete product
                                </Button>
                              )}
                            </div>

                            {canManage && (
                              <div className="max-w-md rounded-md border border-border bg-muted/30 p-3">
                                <CloudinaryImageUpload
                                  label="Product image"
                                  context="product"
                                  value={item.image_url ?? ""}
                                  previewAspect="square"
                                  onChange={(url) =>
                                    itemMutation.mutate({
                                      ...item,
                                      image_url: url.trim() ? url.trim() : null,
                                    })
                                  }
                                />
                              </div>
                            )}

                            {canManage && (
                              <form
                                className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-muted/30 p-3"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  const form = new FormData(event.currentTarget);
                                  const sale = Number(form.get("discount_price"));
                                  itemMutation.mutate({
                                    ...item,
                                    price: Number(form.get("price") ?? item.price),
                                    discount_price: sale > 0 ? sale : null,
                                    points_value: Number(form.get("points_value") || 0),
                                  });
                                }}
                              >
                                <div className="space-y-1">
                                  <Label htmlFor={`price-${item.id}`} className="text-xs">
                                    Price (R)
                                  </Label>
                                  <Input
                                    id={`price-${item.id}`}
                                    name="price"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    required
                                    defaultValue={item.price}
                                    className="h-9 w-28"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label htmlFor={`sale-${item.id}`} className="text-xs">
                                    Sale price (R){" "}
                                    <span className="font-normal text-muted-foreground">
                                      — blank clears
                                    </span>
                                  </Label>
                                  <Input
                                    id={`sale-${item.id}`}
                                    name="discount_price"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    defaultValue={item.discount_price ?? ""}
                                    placeholder="None"
                                    className="h-9 w-32"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label htmlFor={`pts-${item.id}`} className="text-xs">
                                    Points per item
                                  </Label>
                                  <Input
                                    id={`pts-${item.id}`}
                                    name="points_value"
                                    type="number"
                                    min="0"
                                    defaultValue={item.points_value ?? 5}
                                    className="h-9 w-24"
                                  />
                                </div>
                                <Button
                                  type="submit"
                                  size="sm"
                                  variant="secondary"
                                  disabled={itemMutation.isPending}
                                >
                                  Save pricing
                                </Button>
                                <p className="w-full text-xs text-muted-foreground">
                                  Price, sale price and points live-sync to the customer app —
                                  coupons, combos and rewards read these values.
                                </p>
                              </form>
                            )}

                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                              <div className="space-y-2">
                                <p className="text-sm font-medium">
                                  Variants{" "}
                                  <span className="font-normal text-muted-foreground">
                                    ({itemVariants.length})
                                  </span>
                                </p>
                                {itemVariants.length === 0 && (
                                  <p className="text-xs text-muted-foreground">No variants linked.</p>
                                )}
                                {itemVariants
                                  .map((variant) => (
                                    <div
                                      key={variant.id}
                                      className="flex items-center justify-between rounded border border-border px-3 py-1.5 text-sm"
                                    >
                                      <span>
                                        {variant.name}
                                        {variant.is_default ? (
                                          <span className="ml-1 text-[10px] text-primary">default</span>
                                        ) : null}
                                      </span>
                                      <span className="flex items-center gap-2 tabular-nums">
                                        +R {Number(variant.price_delta).toFixed(2)}
                                        {canManage && (
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={() =>
                                              setPendingDelete({
                                                kind: "variant",
                                                id: variant.id,
                                                label: variant.name,
                                              })
                                            }
                                          >
                                            <Trash2 className="size-3.5 text-destructive" />
                                          </Button>
                                        )}
                                      </span>
                                    </div>
                                  ))}
                                {canManage && (
                                  <form
                                    className="flex gap-2"
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      const form = new FormData(event.currentTarget);
                                      variantMutation.mutate({
                                        restaurant_id: restaurantId,
                                        menu_item_id: item.id,
                                        name: String(form.get("name")),
                                        price_delta: Number(form.get("price_delta") ?? 0),
                                      });
                                      event.currentTarget.reset();
                                    }}
                                  >
                                    <Input
                                      name="name"
                                      placeholder="Large"
                                      className="h-9"
                                      required
                                    />
                                    <Input
                                      name="price_delta"
                                      type="number"
                                      step="0.5"
                                      placeholder="+R"
                                      className="h-9 w-24"
                                    />
                                    <Button type="submit" size="icon" aria-label="Add variant">
                                      <Plus className="size-4" />
                                    </Button>
                                  </form>
                                )}
                              </div>

                              <div className="space-y-2">
                                <p className="text-sm font-medium">
                                  Add-ons{" "}
                                  <span className="font-normal text-muted-foreground">
                                    ({itemAddons.length})
                                  </span>
                                </p>
                                {itemAddons.length === 0 && (
                                  <p className="text-xs text-muted-foreground">No add-ons linked.</p>
                                )}
                                {itemAddons.map((addon) => (
                                    <div
                                      key={addon.id}
                                      className="flex items-center justify-between rounded border border-border px-3 py-1.5 text-sm"
                                    >
                                      <span>
                                        {addon.name}
                                        <span className="ml-1 text-[10px] text-muted-foreground">
                                          max {addon.max_quantity}
                                        </span>
                                      </span>
                                      <span className="flex items-center gap-2 tabular-nums">
                                        R {Number(addon.price).toFixed(2)}
                                        {canManage && (
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={() =>
                                              setPendingDelete({
                                                kind: "addon",
                                                id: addon.id,
                                                label: addon.name,
                                              })
                                            }
                                          >
                                            <Trash2 className="size-3.5 text-destructive" />
                                          </Button>
                                        )}
                                      </span>
                                    </div>
                                  ))}
                                {canManage && (
                                  <form
                                    className="flex gap-2"
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      const form = new FormData(event.currentTarget);
                                      addonMutation.mutate({
                                        restaurant_id: restaurantId,
                                        menu_item_id: item.id,
                                        name: String(form.get("name")),
                                        price: Number(form.get("price") ?? 0),
                                      });
                                      event.currentTarget.reset();
                                    }}
                                  >
                                    <Input
                                      name="name"
                                      placeholder="Extra cheese"
                                      className="h-9"
                                      required
                                    />
                                    <Input
                                      name="price"
                                      type="number"
                                      step="0.5"
                                      placeholder="R"
                                      className="h-9 w-24"
                                    />
                                    <Button type="submit" size="icon" aria-label="Add add-on">
                                      <Plus className="size-4" />
                                    </Button>
                                  </form>
                                )}
                              </div>

                              <div className="space-y-2 md:col-span-2 xl:col-span-1">
                                <p className="text-sm font-medium">
                                  Modifier groups{" "}
                                  <span className="font-normal text-muted-foreground">
                                    ({itemModifiers.length} assigned)
                                  </span>
                                </p>
                                {modifiers.length === 0 && (
                                  <p className="text-xs text-muted-foreground">
                                    Create modifier groups on the Menu structure tab first.
                                  </p>
                                )}
                                {modifiers.map((modifier) => {
                                  const assigned = item.modifier_ids.includes(modifier.id);
                                  const modConfig = item.modifier_config[modifier.id] ?? {};
                                  return (
                                    <div
                                      key={modifier.id}
                                      className="rounded border border-border px-3 py-2 text-sm"
                                    >
                                      <p className="font-medium">{modifier.name}</p>
                                      <p className="text-[10px] text-muted-foreground">
                                        {modifier.type} · {modifier.choices.length} choices
                                      </p>
                                      <div className="mt-2 space-y-1">
                                        {modifier.choices.map((choice, idx) => {
                                          const cfg = modConfig[String(idx)] as
                                            | ModifierChoiceConfig
                                            | undefined;
                                          const selected = cfg?.selected === true;
                                          return (
                                            <div
                                              key={idx}
                                              className="flex items-center gap-2 text-xs"
                                            >
                                              {canManage ? (
                                                <Checkbox
                                                  checked={selected}
                                                  onCheckedChange={() => {
                                                    const next = toggleProductModifierChoice(
                                                      item,
                                                      modifier,
                                                      idx,
                                                    );
                                                    itemMutation.mutate({
                                                      ...item,
                                                      ...next,
                                                    });
                                                  }}
                                                />
                                              ) : (
                                                <span>{selected ? "✓" : "○"}</span>
                                              )}
                                              <span className="flex-1">{choice.label}</span>
                                              {modifier.include_pricing && canManage && selected ? (
                                                <Input
                                                  type="number"
                                                  step="0.01"
                                                  className="h-7 w-20"
                                                  defaultValue={cfg?.price ?? choice.price}
                                                  onBlur={(e) => {
                                                    itemMutation.mutate({
                                                      ...item,
                                                      modifier_config: updateProductModifierChoicePrice(
                                                        item,
                                                        modifier.id,
                                                        idx,
                                                        Number(e.target.value) || 0,
                                                      ),
                                                    });
                                                  }}
                                                />
                                              ) : modifier.include_pricing && selected ? (
                                                <span className="tabular-nums">
                                                  +R {(cfg?.price ?? choice.price).toFixed(2)}
                                                </span>
                                              ) : null}
                                            </div>
                                          );
                                        })}
                                      </div>
                                      {!assigned && canManage && (
                                        <p className="mt-1 text-[10px] text-muted-foreground">
                                          Select choices above to assign this group.
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                        );
        };

        return (
          <div className="space-y-6">
            {/* Overview stats */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <Package className="size-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold tabular-nums">{items.length}</p>
                    <p className="text-xs text-muted-foreground">Total products</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
                    <UtensilsCrossed className="size-5 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold tabular-nums">{availableCount}</p>
                    <p className="text-xs text-muted-foreground">Available now</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10">
                    <FolderOpen className="size-5 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold tabular-nums">{categories.length}</p>
                    <p className="text-xs text-muted-foreground">Categories</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-amber-500/10">
                    <SlidersHorizontal className="size-5 text-amber-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold tabular-nums">{modifiers.length}</p>
                    <p className="text-xs text-muted-foreground">Modifier groups</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <TabsList>
                  <TabsTrigger value="products" className="gap-1.5">
                    <LayoutGrid className="size-3.5" />
                    Products
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                      {items.length}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="structure" className="gap-1.5">
                    <FolderOpen className="size-3.5" />
                    Menu structure
                  </TabsTrigger>
                </TabsList>

                {canManage && (
                  <Dialog open={addProductOpen} onOpenChange={setAddProductOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="size-4" />
                        Add product
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Add a new product</DialogTitle>
                        <DialogDescription>
                          Fill in the details below. The product will appear on the customer menu
                          immediately after saving.
                        </DialogDescription>
                      </DialogHeader>
                      <form
                        className="grid gap-4 sm:grid-cols-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          const sale = Number(form.get("discount_price"));
                          const imageUrl = newProductImageUrl.trim() || randomProductImage();
                          itemMutation.mutate(
                            {
                              restaurant_id: restaurantId,
                              category_id: newProductCategoryId || null,
                              category:
                                categories.find((c) => c.id === newProductCategoryId)?.name ??
                                "General",
                              name: String(form.get("name")),
                              description: String(form.get("description") ?? ""),
                              price: Number(form.get("price")),
                              discount_price: sale > 0 ? sale : null,
                              points_value: Number(form.get("points_value") || 5),
                              prep_time_minutes: Number(form.get("prep_time_minutes") ?? 15),
                              is_available: true,
                              is_featured: false,
                              image_url: imageUrl,
                              allergens: [],
                            },
                            {
                              onSuccess: () => {
                                setAddProductOpen(false);
                                setNewProductImageUrl("");
                                setNewProductCategoryId("");
                                event.currentTarget.reset();
                              },
                            },
                          );
                        }}
                      >
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor="new-name">Product name</Label>
                          <Input
                            id="new-name"
                            name="name"
                            required
                            placeholder="e.g. Margherita Pizza"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Category</Label>
                          <Select
                            value={newProductCategoryId || "none"}
                            onValueChange={(v) =>
                              setNewProductCategoryId(v === "none" ? "" : v)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Uncategorised</SelectItem>
                              {categories.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="new-price">Price (R)</Label>
                          <Input
                            id="new-price"
                            name="price"
                            type="number"
                            step="0.01"
                            min="0"
                            required
                            placeholder="129.00"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="new-sale">Sale price (R)</Label>
                          <Input
                            id="new-sale"
                            name="discount_price"
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Optional"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="new-points">Loyalty points</Label>
                          <Input
                            id="new-points"
                            name="points_value"
                            type="number"
                            min="0"
                            defaultValue="5"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="new-prep">Prep time (minutes)</Label>
                          <Input
                            id="new-prep"
                            name="prep_time_minutes"
                            type="number"
                            defaultValue="15"
                          />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor="new-description">Description</Label>
                          <Textarea
                            id="new-description"
                            name="description"
                            placeholder="Short description shown to customers"
                            rows={2}
                          />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <CloudinaryImageUpload
                            label="Product image"
                            context="product"
                            value={newProductImageUrl}
                            onChange={setNewProductImageUrl}
                            previewAspect="square"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setNewProductImageUrl(randomProductImage())}
                          >
                            <ImagePlus className="mr-1 size-3.5" /> Use placeholder image
                          </Button>
                        </div>
                        <DialogFooter className="sm:col-span-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setAddProductOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button type="submit" disabled={itemMutation.isPending} className="gap-2">
                            {itemMutation.isPending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Plus className="size-4" />
                            )}
                            Create product
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                )}
              </div>

              {/* Products tab */}
              <TabsContent value="products" className="mt-4 space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <CardTitle className="text-base">Product catalogue</CardTitle>
                        <CardDescription>
                          {filteredItems.length === items.length
                            ? `${items.length} products organised by category`
                            : `Showing ${filteredItems.length} of ${items.length} products`}
                        </CardDescription>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            placeholder="Search products…"
                            value={productSearch}
                            onChange={(e) => setProductSearch(e.target.value)}
                            className="h-9 w-full pl-8 sm:w-52"
                          />
                        </div>
                        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                          <SelectTrigger className="h-9 w-full sm:w-44">
                            <SelectValue placeholder="All categories" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All categories</SelectItem>
                            <SelectItem value="uncategorized">Uncategorised</SelectItem>
                            {sortedCategories.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {items.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Package className="mb-3 size-10 text-muted-foreground/50" />
                        <p className="text-sm font-medium">No products yet</p>
                        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                          {canManage
                            ? "Click \"Add product\" to create your first menu item."
                            : "This restaurant has no menu items yet."}
                        </p>
                        {canManage && (
                          <Button
                            className="mt-4 gap-2"
                            size="sm"
                            onClick={() => setAddProductOpen(true)}
                          >
                            <Plus className="size-4" />
                            Add your first product
                          </Button>
                        )}
                      </div>
                    ) : filteredItems.length === 0 ? (
                      <div className="py-12 text-center">
                        <p className="text-sm text-muted-foreground">
                          No products match your search. Try a different term or filter.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {productGroups.map((group) => (
                          <div key={group.id}>
                            <div className="mb-3 flex items-center gap-2">
                              <FolderOpen className="size-4 text-muted-foreground" />
                              <h3 className="text-sm font-semibold">{group.name}</h3>
                              <Badge variant="secondary" className="text-xs">
                                {group.items.length}
                              </Badge>
                            </div>
                            <Accordion type="multiple" className="w-full">
                              {group.items.map((item) => renderProductAccordionItem(item))}
                            </Accordion>
                            {group.id !== productGroups[productGroups.length - 1]?.id && (
                              <Separator className="mt-6" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Menu structure tab */}
              <TabsContent value="structure" className="mt-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <FolderOpen className="size-4" />
                        Categories
                      </CardTitle>
                      <CardDescription>
                        Organise products into groups shown on the customer menu.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {canManage && (
                        <form
                          className="flex gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const form = new FormData(event.currentTarget);
                            categoryMutation.mutate({
                              restaurant_id: restaurantId,
                              name: String(form.get("name")),
                              sort_order: categories.length,
                            });
                            event.currentTarget.reset();
                          }}
                        >
                          <Input
                            name="name"
                            placeholder="New category name"
                            required
                            className="h-9"
                          />
                          <Button
                            type="submit"
                            size="icon"
                            aria-label="Add category"
                            disabled={categoryMutation.isPending}
                          >
                            {categoryMutation.isPending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Plus className="size-4" />
                            )}
                          </Button>
                        </form>
                      )}
                      {categories.length === 0 ? (
                        <div className="rounded-lg border border-dashed py-8 text-center">
                          <FolderOpen className="mx-auto mb-2 size-8 text-muted-foreground/40" />
                          <p className="text-sm text-muted-foreground">
                            No categories yet. Add one to organise your menu.
                          </p>
                        </div>
                      ) : (
                        sortedCategories.map((category) => (
                          <div
                            key={category.id}
                            className="flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/30"
                          >
                            <div>
                              <p className="text-sm font-medium">{category.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {items.filter((i) => i.category_id === category.id).length} products
                              </p>
                            </div>
                            {canManage && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8"
                                onClick={() =>
                                  setPendingDelete({
                                    kind: "category",
                                    id: category.id,
                                    label: category.name,
                                  })
                                }
                              >
                                <Trash2 className="size-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <SlidersHorizontal className="size-4" />
                        Modifier groups
                      </CardTitle>
                      <CardDescription>
                        Customisation options like size, spice level, or extras — assign to
                        products on the Products tab.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {modifiers.length === 0 ? (
                        <div className="rounded-lg border border-dashed py-8 text-center">
                          <SlidersHorizontal className="mx-auto mb-2 size-8 text-muted-foreground/40" />
                          <p className="text-sm text-muted-foreground">
                            No modifier groups yet. Create one below.
                          </p>
                        </div>
                      ) : (
                        modifiers.map((modifier) => (
                          <div
                            key={modifier.id}
                            className="rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/30"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium">{modifier.name}</p>
                                  <Badge variant="outline" className="text-[10px]">
                                    {modifier.type === "option" ? "Required" : "Optional"}
                                  </Badge>
                                </div>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {modifier.choices.length} choices · pick{" "}
                                  {modifier.min_selections}–{modifier.max_selections}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {modifier.choices.map((c) => c.label).join(" · ")}
                                </p>
                              </div>
                              {canManage && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-8 shrink-0"
                                  onClick={() =>
                                    setPendingDelete({
                                      kind: "modifier",
                                      id: modifier.id,
                                      label: modifier.name,
                                    })
                                  }
                                >
                                  <Trash2 className="size-4 text-destructive" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                      {canManage && (
                        <>
                          <Separator />
                          <form
                            className="space-y-3 rounded-lg border border-dashed p-4"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const form = new FormData(event.currentTarget);
                              const includePricing = form.get("include_pricing") === "on";
                              const choiceLabels = String(form.get("choices") ?? "")
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean);
                              if (choiceLabels.length === 0) {
                                toast.error("Enter at least one choice (comma-separated).");
                                return;
                              }
                              modifierMutation.mutate({
                                restaurant_id: restaurantId,
                                name: String(form.get("name")),
                                type: newModifierType,
                                include_pricing: includePricing,
                                required: newModifierType === "option",
                                min_selections: newModifierType === "option" ? 1 : 0,
                                max_selections: newModifierType === "option" ? 1 : 3,
                                choices: choiceLabels.map((label) => ({ label, price: 0 })),
                              });
                              event.currentTarget.reset();
                              setNewModifierType("option");
                            }}
                          >
                            <p className="text-sm font-medium">New modifier group</p>
                            <div className="space-y-1.5">
                              <Label htmlFor="mod-name">Group name</Label>
                              <Input
                                id="mod-name"
                                name="name"
                                placeholder="e.g. Spice level"
                                required
                                className="h-9"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label>Type</Label>
                              <Select
                                value={newModifierType}
                                onValueChange={(v) =>
                                  setNewModifierType(v as "option" | "extra")
                                }
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="option">
                                    Option — customer must pick one
                                  </SelectItem>
                                  <SelectItem value="extra">
                                    Extra — optional, multiple allowed
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="mod-choices">Choices</Label>
                              <Input
                                id="mod-choices"
                                name="choices"
                                placeholder="Mild, Medium, Hot"
                                required
                                className="h-9"
                              />
                              <p className="text-[11px] text-muted-foreground">
                                Separate choices with commas
                              </p>
                            </div>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Checkbox name="include_pricing" />
                              Allow custom pricing per choice
                            </label>
                            <Button
                              type="submit"
                              size="sm"
                              disabled={modifierMutation.isPending}
                              className="w-full gap-2"
                            >
                              {modifierMutation.isPending ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Plus className="size-4" />
                              )}
                              Add modifier group
                            </Button>
                          </form>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>

            <AlertDialog
              open={!!pendingDelete}
              onOpenChange={(open) => !open && setPendingDelete(null)}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete{" "}
                    {pendingDelete?.kind === "category"
                      ? "category"
                      : pendingDelete?.kind === "product"
                        ? "product"
                        : pendingDelete?.kind === "modifier"
                          ? "modifier group"
                          : pendingDelete?.kind === "variant"
                            ? "variant"
                            : "add-on"}
                    ?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {pendingDelete?.kind === "category"
                      ? `"${pendingDelete.label}" will be removed. Products in this category will become uncategorised.`
                      : pendingDelete?.kind === "product"
                        ? `"${pendingDelete?.label}" and all its variants, add-ons, and modifier assignments will be permanently removed.`
                        : `"${pendingDelete?.label}" will be permanently removed. This action cannot be undone.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={handleConfirmDelete}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        );
      }}
    </PermissionGate>
  );
}
