import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";

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
import {
  deleteFirebaseMenuChild as deleteMenuChild,
  deleteFirebaseCategory as deleteCategory,
  deleteFirebaseMenuItem as deleteMenuItem,
  getFirebaseMenu,
  saveFirebaseAddon as saveAddon,
  saveFirebaseCategory as saveCategory,
  saveFirebaseMenuItem as saveMenuItem,
  saveFirebaseVariant as saveVariant,
  subscribeFirebaseMenu,
  toggleFirebaseMenuItem as toggleMenuItem,
  type MenuPayload,
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

function MenusPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [restaurantId, setRestaurantId] = useState(search.restaurant);
  const [newProductImageUrl, setNewProductImageUrl] = useState("");
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
        return { categories: [], items: [], variants: [], addons: [] };
      return getFirebaseMenu(selectedRestaurant);
    },
    enabled: Boolean(selectedRestaurant),
    initialData: { categories: [], items: [], variants: [], addons: [] },
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
  const childDelete = useMutation({
    mutationFn: (p: { restaurant_id: string; id: string; kind: "variant" | "addon" }) =>
      deleteMenuChild(p),
    onSuccess: notify("Removed"),
    onError: fail,
  });

  return (
    <PermissionGate
      required={["menus.view", "menus.manage"]}
      breadcrumb={["Catalogue", "Menus"]}
      title="Menu management"
      description="All categories, products and pricing are saved to Firebase Realtime Database."
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
        const { categories, items, variants, addons } = menuQuery.data;

        // Build logical category → items groups so the products section mirrors
        // how a customer menu looks (category order from sort_order, uncategorised
        // items at the bottom). This also guarantees deleted-category items are
        // still visible instead of disappearing.
        const itemsByCategory = new Map<string, typeof items>();
        const uncategorized: typeof items = [];
        for (const item of items) {
          if (item.category_id && categories.some((c) => c.id === item.category_id)) {
            const arr = itemsByCategory.get(item.category_id) ?? [];
            arr.push(item);
            itemsByCategory.set(item.category_id, arr);
          } else {
            uncategorized.push(item);
          }
        }

        return (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
              <Card className="h-fit">
                <CardHeader>
                  <CardTitle className="text-base">Categories</CardTitle>
                  <CardDescription>
                    {categories.length} groups · {items.length} products synced from Firebase
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
                      <Input name="name" placeholder="New category" required className="h-9" />
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
                  {categories.map((category) => (
                    <div
                      key={category.id}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">{category.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {items.filter((i) => i.category_id === category.id).length} items
                        </p>
                      </div>
                      {canManage && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            categoryDelete.mutate({ restaurant_id: restaurantId, id: category.id })
                          }
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {categories.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No categories yet — add one to get started.
                    </p>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-4">
                {canManage && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Add a product</CardTitle>
                      <CardDescription>
                        Items are saved instantly to Firebase and live-synced.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form
                        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          const categoryId = String(form.get("category_id") ?? "");
                          const sale = Number(form.get("discount_price"));
                          const imageUrl = newProductImageUrl.trim() || randomProductImage();
                          itemMutation.mutate({
                            restaurant_id: restaurantId,
                            category_id: categoryId || null,
                            category:
                              categories.find((c) => c.id === categoryId)?.name ?? "General",
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
                          });
                          event.currentTarget.reset();
                          setNewProductImageUrl("");
                        }}
                      >
                        <div className="space-y-1.5">
                          <Label htmlFor="name">Product name</Label>
                          <Input
                            id="name"
                            name="name"
                            required
                            placeholder="e.g. Margherita Pizza"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="category_id">Category</Label>
                          <select
                            id="category_id"
                            name="category_id"
                            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          >
                            <option value="">Uncategorised</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="price">Price (R)</Label>
                          <Input
                            id="price"
                            name="price"
                            type="number"
                            step="0.01"
                            min="0"
                            required
                            placeholder="129.00"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="discount_price">Sale price (R)</Label>
                          <Input
                            id="discount_price"
                            name="discount_price"
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Optional"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="points_value">Points per item</Label>
                          <Input
                            id="points_value"
                            name="points_value"
                            type="number"
                            min="0"
                            defaultValue="5"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="prep_time_minutes">Prep (min)</Label>
                          <Input
                            id="prep_time_minutes"
                            name="prep_time_minutes"
                            type="number"
                            defaultValue="15"
                          />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor="description">Description</Label>
                          <Input
                            id="description"
                            name="description"
                            placeholder="Short description shown to customers"
                          />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
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
                            className="mt-1 h-7 px-2 text-xs"
                            onClick={() => setNewProductImageUrl(randomProductImage())}
                          >
                            <ImagePlus className="mr-1 size-3.5" /> Use random Unsplash photo
                          </Button>
                        </div>
                        <div className="flex items-end">
                          <Button type="submit" disabled={itemMutation.isPending} className="gap-2">
                            {itemMutation.isPending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Plus className="size-4" />
                            )}{" "}
                            Add product
                          </Button>
                        </div>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">
                          <ImagePlus className="size-3.5" /> Upload to Cloudinary for a real CDN URL,
                          or use a random Unsplash photo. Sale price and points drive customer
                          promotions.
                        </p>
                      </form>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Products</CardTitle>
                    <CardDescription>{items.length} items on this menu</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Accordion type="single" collapsible className="w-full">
                      {items.map((item) => (
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
                                    itemDelete.mutate({ restaurant_id: restaurantId, id: item.id })
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

                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-2">
                                <p className="text-sm font-medium">Variants</p>
                                {variants
                                  .filter((v) => v.menu_item_id === item.id)
                                  .map((variant) => (
                                    <div
                                      key={variant.id}
                                      className="flex items-center justify-between rounded border border-border px-3 py-1.5 text-sm"
                                    >
                                      <span>{variant.name}</span>
                                      <span className="flex items-center gap-2 tabular-nums">
                                        +R {Number(variant.price_delta).toFixed(2)}
                                        {canManage && (
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={() =>
                                              childDelete.mutate({
                                                restaurant_id: restaurantId,
                                                id: variant.id,
                                                kind: "variant",
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
                                <p className="text-sm font-medium">Add-ons</p>
                                {addons
                                  .filter((a) => a.menu_item_id === item.id)
                                  .map((addon) => (
                                    <div
                                      key={addon.id}
                                      className="flex items-center justify-between rounded border border-border px-3 py-1.5 text-sm"
                                    >
                                      <span>{addon.name}</span>
                                      <span className="flex items-center gap-2 tabular-nums">
                                        R {Number(addon.price).toFixed(2)}
                                        {canManage && (
                                          <Button
                                            size="icon"
                                            variant="ghost"
                                            onClick={() =>
                                              childDelete.mutate({
                                                restaurant_id: restaurantId,
                                                id: addon.id,
                                                kind: "addon",
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
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                    {items.length === 0 && (
                      <p className="py-10 text-center text-sm text-muted-foreground">
                        No products on this menu yet — add one above.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        );
      }}
    </PermissionGate>
  );
}
