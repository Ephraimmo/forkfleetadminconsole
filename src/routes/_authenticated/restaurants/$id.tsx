import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@/lib/use-demo-fn";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bike,
  CheckCircle2,
  Coins,
  CreditCard,
  Crosshair,
  ExternalLink,
  Gauge,
  Navigation,
  Plus,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";

import { haversineDistanceKm } from "@/lib/utils";

import { PermissionGate } from "@/components/permission-gate";
import { CloudinaryImageUpload } from "@/components/cloudinary-image-upload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteBranch,
  getRestaurant,
  saveBranch,
  saveBusinessHours,
  saveRestaurant,
  type HourRow,
} from "@/lib/restaurants.functions";
import { rtdbGet, isFirebaseAvailable, rtdbSet } from "@/lib/firebase";
import { RestaurantRewardsEditor } from "@/components/loyalty/restaurant-rewards-editor";
import { PaymentMethodsEditor } from "@/components/restaurants/payment-methods-editor";
import {
  defaultPaymentConfig,
  subscribePaymentConfig,
  type RestaurantPaymentConfig,
} from "@/lib/payments.firebase";
import {
  DEFAULT_POINTS_CONFIG,
  subscribeGlobalPointsConfig,
  subscribeRestaurantPointsOverride,
  type GlobalPointsConfig,
  type RestaurantPointsOverride,
} from "@/lib/promotions.firebase";
import {
  buildTiersFromRule,
  extractRuleFromTiers,
  feeForDistance,
  saveFirebaseDeliveryTiers,
  type DeliveryTier,
  type FirebaseRestaurant,
} from "@/lib/restaurants.firebase";
import type { FirebaseOrder } from "@/lib/orders.firebase";

interface FirebaseDetail {
  restaurant: FirebaseRestaurant;
  branches: [];
  zones: [];
  hours: HourRow[];
  staff: [];
  stats: { orders: number; revenue: number; menuItems: number };
  source: "firebase";
}

async function loadRestaurant(id: string) {
  // Try Firebase first (browser only), fall back to the demo serverFn.
  if (isFirebaseAvailable()) {
    try {
      const snap = await rtdbGet<FirebaseRestaurant>(`restaurants/${id}`);
      if (snap) {
        const hours: HourRow[] = [];
        for (let d = 0; d < 7; d++) {
          hours.push({
            day_of_week: d,
            opens_at: snap.opens_at,
            closes_at: snap.closes_at,
            is_closed: false,
          });
        }
        // Load menu items count + orders/revenue directly from Firebase (no demo data).
        const [items, ordersSnap] = await Promise.all([
          rtdbGet<Record<string, unknown>>(`menus/${id}/items`),
          rtdbGet<Record<string, FirebaseOrder>>("orders"),
        ]);
        const menuItemCount = items ? Object.keys(items).length : 0;
        const myOrders = ordersSnap
          ? Object.values(ordersSnap).filter((o) => o && o.restaurant_id === id)
          : [];
        const revenue = myOrders
          .filter((o) => o.status === "delivered")
          .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
        const detail: FirebaseDetail = {
          restaurant: snap,
          branches: [],
          zones: [],
          hours,
          staff: [],
          stats: {
            orders: myOrders.length,
            revenue: Math.round(revenue),
            menuItems: menuItemCount,
          },
          source: "firebase",
        };
        return detail;
      }
    } catch (e) {
      console.warn("[restaurant detail] firebase lookup failed", e);
    }
  }
  return getRestaurant({ id });
}

export const Route = createFileRoute("/_authenticated/restaurants/$id")({
  head: () => ({
    meta: [
      { title: "Restaurant profile — ForkFleet Console" },
      {
        name: "description",
        content:
          "Configure branches, delivery zones, trading hours and commission for a restaurant partner.",
      },
      { property: "og:title", content: "Restaurant profile — ForkFleet Console" },
      {
        property: "og:description",
        content: "Branches, delivery zones, trading hours and commission settings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RestaurantDetailPage,
});

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function RestaurantDetailPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const fetchRestaurant = useServerFn(getRestaurant);
  const updateRestaurant = useServerFn(saveRestaurant);
  const persistHours = useServerFn(saveBusinessHours);
  const persistBranch = useServerFn(saveBranch);
  const removeBranch = useServerFn(deleteBranch);

  const query = useQuery({
    queryKey: ["restaurant", id],
    queryFn: () => loadRestaurant(id),
  });

  const [hours, setHours] = useState<HourRow[]>([]);
  const [activeTab, setActiveTab] = useState<string>("profile");
  const [coverDraft, setCoverDraft] = useState<string>("");
  useEffect(() => {
    if (!query.data) return;
    const existing = query.data.hours;
    setHours(
      DAYS.map((_, day) => {
        const match = existing.find((h) => h.day_of_week === day);
        return (
          match ?? {
            day_of_week: day,
            opens_at: query.data.restaurant.opens_at,
            closes_at: query.data.restaurant.closes_at,
            is_closed: false,
          }
        );
      }),
    );
    const coverUrl =
      "image_url" in query.data.restaurant
        ? ((query.data.restaurant as FirebaseRestaurant).image_url ?? "")
        : "";
    setCoverDraft(coverUrl);
  }, [query.data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["restaurant", id] });
  const mutate = <T,>(fn: (input: T) => Promise<unknown>, message: string) =>
    useMutationLike(fn, message, invalidate);

  const profileMutation = mutate(
    (_payload: Parameters<typeof updateRestaurant>[0]) => updateRestaurant(_payload),
    "Profile saved",
  );
  const hoursMutation = mutate(
    (payload: { restaurantId: string; hours: HourRow[] }) => persistHours(payload),
    "Trading hours updated",
  );
  const branchMutation = mutate(
    (_payload: Parameters<typeof persistBranch>[0]) => persistBranch(_payload),
    "Branch saved",
  );
  const branchDelete = mutate((payload: { id: string }) => removeBranch(payload), "Branch removed");

  // Fulfilment toggles
  const [fulfilmentDelivery, setFulfilmentDelivery] = useState<boolean>(true);
  const [fulfilmentPickup, setFulfilmentPickup] = useState<boolean>(true);
  useEffect(() => {
    if (!query.data) return;
    const r = query.data.restaurant as FirebaseRestaurant;
    setFulfilmentDelivery(r.delivery_enabled !== false);
    setFulfilmentPickup(r.pickup_enabled !== false);
  }, [query.data?.restaurant.id, query.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveFulfilmentFlags() {
    if (!query.data) return;
    const r = query.data.restaurant as FirebaseRestaurant;
    if (!fulfilmentDelivery && !fulfilmentPickup) {
      toast.error("Enable at least one of delivery or pickup.");
      return;
    }
    try {
      await rtdbSet(`restaurants/${r.id}/delivery_enabled`, fulfilmentDelivery);
      await rtdbSet(`restaurants/${r.id}/pickup_enabled`, fulfilmentPickup);
      if (!fulfilmentDelivery) {
        await rtdbSet(`restaurants/${r.id}/delivery_radius_km`, 0);
      }
      toast.success("Fulfilment methods saved");
      await queryClient.invalidateQueries({ queryKey: ["restaurant", id] });
      await queryClient.invalidateQueries({ queryKey: ["restaurants-fb"] });
    } catch (e) {
      toast.error((e as Error).message || "Failed to save fulfilment settings");
    }
  }

  async function saveCoverImage() {
    if (!query.data) return;
    const r = query.data.restaurant as FirebaseRestaurant;
    const next = coverDraft.trim() ? coverDraft.trim() : null;
    try {
      if (isFirebaseAvailable()) {
        await rtdbSet(`restaurants/${r.id}/image_url`, next);
      } else {
        toast.error("Firebase is unavailable — cover image not saved.");
        return;
      }
      toast.success("Cover image saved");
      await queryClient.invalidateQueries({ queryKey: ["restaurant", id] });
      await queryClient.invalidateQueries({ queryKey: ["restaurants-fb"] });
    } catch (e) {
      toast.error((e as Error).message || "Failed to save cover image");
    }
  }

  // ---------- Delivery fee rule (Firebase-native) ----------
  const [baseFee, setBaseFee] = useState<string>("10");
  const [stepKm, setStepKm] = useState<string>("5");
  const [feePerStep, setFeePerStep] = useState<string>("10");
  const [radiusInput, setRadiusInput] = useState<string>("8");
  const [previewTiers, setPreviewTiers] = useState<DeliveryTier[]>([]);
  const [tierDistance, setTierDistance] = useState<string>("5");
  const [tierPreviewFee, setTierPreviewFee] = useState<number | null>(null);
  // Live distance calculator inputs (customer lat/lng).
  const [destLat, setDestLat] = useState<string>("");
  const [destLng, setDestLng] = useState<string>("");
  const [calcLocating, setCalcLocating] = useState(false);

  const restaurant = query.data?.restaurant as FirebaseRestaurant | undefined;
  const restaurantHasCoords = Boolean(
    restaurant && restaurant.latitude != null && restaurant.longitude != null,
  );

  // Live-computed distance from restaurant coords to destination coords.
  const computedDistanceKm = useMemo(() => {
    if (!restaurant || !restaurantHasCoords) return null;
    const lat = Number(destLat);
    const lng = Number(destLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return haversineDistanceKm(
      { latitude: restaurant.latitude, longitude: restaurant.longitude },
      { latitude: lat, longitude: lng },
    );
  }, [restaurant, restaurantHasCoords, destLat, destLng]);

  // Fee for the live-computed distance.
  const computedFee = useMemo(() => {
    if (computedDistanceKm == null) return null;
    return feeForDistance(previewTiers, computedDistanceKm);
  }, [computedDistanceKm, previewTiers]);

  // Load existing rule from the restaurant on entry.
  useEffect(() => {
    if (!query.data) return;
    const r = query.data.restaurant as FirebaseRestaurant;
    setRadiusInput(String(Number(r.delivery_radius_km) || 8));
    const rule = extractRuleFromTiers((r.delivery_tiers as DeliveryTier[] | undefined) ?? null);
    setBaseFee(String(rule?.base_fee ?? 10));
    setStepKm(String(rule?.step_km ?? 5));
    setFeePerStep(String(rule?.fee_per_step ?? 10));
  }, [query.data?.restaurant.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Regenerate preview bands whenever the rule changes.
  useEffect(() => {
    const base = Number(baseFee);
    const step = Number(stepKm);
    const inc = Number(feePerStep);
    const radius = Number(radiusInput);
    if (
      !Number.isFinite(base) ||
      base < 0 ||
      !Number.isFinite(step) ||
      step <= 0 ||
      !Number.isFinite(inc) ||
      inc < 0 ||
      !Number.isFinite(radius) ||
      radius <= 0
    ) {
      setPreviewTiers([]);
      return;
    }
    const { tiers } = buildTiersFromRule({
      base_fee: base,
      step_km: step,
      fee_per_step: inc,
      radius_km: radius,
    });
    setPreviewTiers(tiers);
    const d = Number(tierDistance);
    setTierPreviewFee(Number.isFinite(d) && d > 0 ? feeForDistance(tiers, d) : null);
  }, [baseFee, stepKm, feePerStep, radiusInput, tierDistance]);

  function useMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Geolocation is not supported in this browser.");
      return;
    }
    setCalcLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDestLat(pos.coords.latitude.toFixed(6));
        setDestLng(pos.coords.longitude.toFixed(6));
        setCalcLocating(false);
      },
      () => {
        setCalcLocating(false);
        toast.error("Could not get your location. Enter coordinates manually.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  }

  async function saveTiers() {
    if (!query.data) return;
    const r = query.data.restaurant as FirebaseRestaurant;
    const base = Number(baseFee);
    const step = Number(stepKm);
    const inc = Number(feePerStep);
    const radius = Number(radiusInput);
    if (!Number.isFinite(base) || base < 0) {
      toast.error("Base fee must be a positive amount");
      return;
    }
    if (!Number.isFinite(step) || step <= 0) {
      toast.error("Distance step must be a positive number of km");
      return;
    }
    if (!Number.isFinite(inc) || inc < 0) {
      toast.error("Fee per step must be a positive amount");
      return;
    }
    if (!Number.isFinite(radius) || radius <= 0) {
      toast.error("Delivery radius must be a positive number of km");
      return;
    }
    const { tiers, effectiveRadius } = buildTiersFromRule({
      base_fee: base,
      step_km: step,
      fee_per_step: inc,
      radius_km: radius,
    });
    try {
      await saveFirebaseDeliveryTiers({ id: r.id, tiers });
      if (effectiveRadius !== Number(r.delivery_radius_km)) {
        await rtdbSet(`restaurants/${r.id}/delivery_radius_km`, effectiveRadius);
      }
      toast.success(
        `Delivery fees saved — R${base} first ${step} km, +R${inc} every ${step} km up to ${effectiveRadius} km`,
      );
      await queryClient.invalidateQueries({ queryKey: ["restaurant", id] });
      await queryClient.invalidateQueries({ queryKey: ["restaurants-fb"] });
    } catch (e) {
      toast.error((e as Error).message || "Failed to save delivery fees");
    }
  }

  return (
    <PermissionGate
      required={["restaurants.view", "restaurants.manage"]}
      breadcrumb={["Catalogue", "Restaurants", query.data?.restaurant.name ?? "Profile"]}
      title={query.data?.restaurant.name ?? "Restaurant"}
      description="Branches, operating zones, delivery radius, trading hours and commission."
      actions={
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/restaurants">
              <ArrowLeft className="mr-2 size-4" /> Directory
            </Link>
          </Button>
          <Button asChild>
            <Link to="/menus" search={{ restaurant: id }}>
              <UtensilsCrossed className="mr-2 size-4" /> Manage menu
            </Link>
          </Button>
        </div>
      }
    >
      {(staff) => {
        const canManage = staff.hasPermission("restaurants.manage");
        if (query.isLoading || !query.data) return <Skeleton className="h-96 w-full" />;
        const { restaurant, branches, zones, stats, staff: team } = query.data;
        const fromFirebase = "source" in query.data && query.data.source === "firebase";
        const cover =
          "image_url" in restaurant ? (restaurant as FirebaseRestaurant).image_url : null;

        return (
          <div className="space-y-4">
            {fromFirebase && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-500" /> Loaded from Firebase
                  Realtime Database
                </span>
                <Button variant="ghost" size="sm" asChild className="h-7 px-2 text-xs">
                  <a
                    href={`https://console.firebase.google.com/project/e-comm-bd997/database/e-comm-bd997-default-rtdb/data/~2Frestaurants~2F${restaurant.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Firebase <ExternalLink className="ml-1 size-3" />
                  </a>
                </Button>
              </div>
            )}
            {cover && (
              <div className="overflow-hidden rounded-lg border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cover}
                  alt={restaurant.name}
                  className="aspect-[16/5] w-full object-cover"
                />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Status" value={restaurant.status} capitalize />
              <Stat label="Lifetime orders" value={stats.orders.toLocaleString()} />
              <Stat
                label="Delivered revenue"
                value={`R ${Math.round(stats.revenue).toLocaleString()}`}
              />
              <Stat label="Menu items" value={String(stats.menuItems)} />
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 sm:inline-flex sm:h-9 sm:w-auto sm:flex-nowrap">
                <TabsTrigger value="profile">Profile & commission</TabsTrigger>
                <TabsTrigger value="hours">Business hours</TabsTrigger>
                <TabsTrigger value="branches">Branches</TabsTrigger>
                <TabsTrigger value="zones" className="gap-1.5">
                  <Gauge className="size-3.5" /> Delivery fees
                </TabsTrigger>
                <TabsTrigger value="rewards" className="gap-1.5">
                  <Coins className="size-3.5" /> Points &amp; Rewards
                </TabsTrigger>
                <TabsTrigger value="payments" className="gap-1.5">
                  <CreditCard className="size-3.5" /> Payments
                </TabsTrigger>
                <TabsTrigger value="team">Team</TabsTrigger>
              </TabsList>

              <TabsContent value="profile">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Commercial settings</CardTitle>
                    <CardDescription>
                      Commission rate, delivery radius and default trading window.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form
                      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        profileMutation.mutate({
                          id: restaurant.id,
                          name: String(form.get("name")),
                          cuisine: String(form.get("cuisine")),
                          email: String(form.get("email") ?? ""),
                          phone: String(form.get("phone") ?? ""),
                          address: String(form.get("address") ?? ""),
                          city: String(form.get("city")),
                          commission_rate: Number(form.get("commission_rate")),
                          delivery_radius_km: Number(form.get("delivery_radius_km")),
                          prep_time_minutes: Number(form.get("prep_time_minutes")),
                          opens_at: String(form.get("opens_at")),
                          closes_at: String(form.get("closes_at")),
                        });
                      }}
                    >
                      <Field
                        name="name"
                        label="Trading name"
                        defaultValue={restaurant.name}
                        disabled={!canManage}
                      />
                      <Field
                        name="cuisine"
                        label="Cuisine"
                        defaultValue={restaurant.cuisine}
                        disabled={!canManage}
                      />
                      <Field
                        name="city"
                        label="City"
                        defaultValue={restaurant.city}
                        disabled={!canManage}
                      />
                      <Field
                        name="email"
                        label="Email"
                        defaultValue={restaurant.email ?? ""}
                        disabled={!canManage}
                      />
                      <Field
                        name="phone"
                        label="Phone"
                        defaultValue={restaurant.phone ?? ""}
                        disabled={!canManage}
                      />
                      <Field
                        name="address"
                        label="Address"
                        defaultValue={restaurant.address ?? ""}
                        disabled={!canManage}
                      />
                      <Field
                        name="commission_rate"
                        label="Commission %"
                        type="number"
                        step="0.1"
                        defaultValue={String(restaurant.commission_rate)}
                        disabled={!canManage}
                      />
                      <Field
                        name="delivery_radius_km"
                        label="Delivery radius (km)"
                        type="number"
                        step="0.5"
                        defaultValue={String(restaurant.delivery_radius_km)}
                        disabled={!canManage}
                      />
                      <Field
                        name="prep_time_minutes"
                        label="Prep time (min)"
                        type="number"
                        defaultValue={String(restaurant.prep_time_minutes)}
                        disabled={!canManage}
                      />
                      <Field
                        name="opens_at"
                        label="Opens"
                        type="time"
                        defaultValue={restaurant.opens_at.slice(0, 5)}
                        disabled={!canManage}
                      />
                      <Field
                        name="closes_at"
                        label="Closes"
                        type="time"
                        defaultValue={restaurant.closes_at.slice(0, 5)}
                        disabled={!canManage}
                      />
                      {canManage && (
                        <div className="flex items-end">
                          <Button type="submit" disabled={profileMutation.isPending}>
                            Save changes
                          </Button>
                        </div>
                      )}
                    </form>

                    <Separator className="my-4" />

                    <div className="space-y-3">
                      <div>
                        <h4 className="mb-1 text-sm font-medium">Cover image</h4>
                        <p className="mb-3 text-xs text-muted-foreground">
                          Upload to Cloudinary — only the returned HTTPS URL is stored on the
                          restaurant.
                        </p>
                      </div>
                      <CloudinaryImageUpload
                        label="Restaurant cover"
                        context="restaurant_cover"
                        value={coverDraft}
                        disabled={!canManage}
                        onChange={setCoverDraft}
                      />
                      {canManage && (
                        <Button type="button" onClick={() => void saveCoverImage()}>
                          Save cover image
                        </Button>
                      )}
                    </div>

                    <Separator className="my-4" />

                    <div>
                      <h4 className="mb-1 text-sm font-medium">Fulfilment methods</h4>
                      <p className="mb-3 text-xs text-muted-foreground">
                        Control what ordering options customers see on the app. Toggling delivery
                        off disables fees and courier dispatch for this restaurant.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label
                          className={`flex cursor-pointer items-start justify-between gap-3 rounded-md border p-3 transition ${
                            fulfilmentDelivery
                              ? "border-emerald-500/30 bg-emerald-500/5"
                              : "border-border/60 opacity-60"
                          }`}
                        >
                          <div className="space-y-0.5">
                            <p className="text-sm font-medium flex items-center gap-1.5">
                              <Bike className="size-3.5" /> Courier delivery
                            </p>
                            <p className="text-[11px] leading-snug text-muted-foreground">
                              Riders deliver to customer addresses. Fees based on distance tiers.
                            </p>
                          </div>
                          <Switch
                            checked={fulfilmentDelivery}
                            disabled={!canManage}
                            onCheckedChange={(v) => {
                              setFulfilmentDelivery(v);
                              if (!v && !fulfilmentPickup) setFulfilmentPickup(true);
                            }}
                          />
                        </label>
                        <label
                          className={`flex cursor-pointer items-start justify-between gap-3 rounded-md border p-3 transition ${
                            fulfilmentPickup
                              ? "border-emerald-500/30 bg-emerald-500/5"
                              : "border-border/60 opacity-60"
                          }`}
                        >
                          <div className="space-y-0.5">
                            <p className="text-sm font-medium">🏃 Pickup at kitchen</p>
                            <p className="text-[11px] leading-snug text-muted-foreground">
                              Customers collect themselves. No delivery fee.
                            </p>
                          </div>
                          <Switch
                            checked={fulfilmentPickup}
                            disabled={!canManage}
                            onCheckedChange={(v) => {
                              setFulfilmentPickup(v);
                              if (!v && !fulfilmentDelivery) setFulfilmentDelivery(true);
                            }}
                          />
                        </label>
                      </div>
                      {!fulfilmentDelivery && (
                        <p className="mt-2 text-[11px] text-amber-400">
                          Delivery is off — customers will only see pickup.
                        </p>
                      )}
                      {canManage && (
                        <div className="mt-3 flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={saveFulfilmentFlags}
                          >
                            <CheckCircle2 className="mr-1.5 size-3.5" /> Save fulfilment settings
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="hours">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Weekly trading hours</CardTitle>
                    <CardDescription>
                      Per-day opening windows used by ordering and dispatch.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {hours.map((hour, index) => (
                      <div
                        key={hour.day_of_week}
                        className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
                      >
                        <span className="w-24 text-sm font-medium">{DAYS[hour.day_of_week]}</span>
                        <Input
                          type="time"
                          className="h-9 w-32"
                          value={hour.opens_at.slice(0, 5)}
                          disabled={!canManage || hour.is_closed}
                          onChange={(event) =>
                            setHours((prev) =>
                              prev.map((h, i) =>
                                i === index ? { ...h, opens_at: event.target.value } : h,
                              ),
                            )
                          }
                        />
                        <span className="text-muted-foreground">–</span>
                        <Input
                          type="time"
                          className="h-9 w-32"
                          value={hour.closes_at.slice(0, 5)}
                          disabled={!canManage || hour.is_closed}
                          onChange={(event) =>
                            setHours((prev) =>
                              prev.map((h, i) =>
                                i === index ? { ...h, closes_at: event.target.value } : h,
                              ),
                            )
                          }
                        />
                        <div className="ml-auto flex items-center gap-2">
                          <Label className="text-xs text-muted-foreground">Closed</Label>
                          <Switch
                            checked={hour.is_closed}
                            disabled={!canManage}
                            onCheckedChange={(checked) =>
                              setHours((prev) =>
                                prev.map((h, i) =>
                                  i === index ? { ...h, is_closed: checked } : h,
                                ),
                              )
                            }
                          />
                        </div>
                      </div>
                    ))}
                    {canManage && (
                      <Button
                        onClick={() => hoursMutation.mutate({ restaurantId: id, hours })}
                        disabled={hoursMutation.isPending}
                      >
                        Save trading hours
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="branches">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Branches</CardTitle>
                    <CardDescription>
                      Physical locations operating under this partner.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {canManage && (
                      <form
                        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          branchMutation.mutate({
                            restaurant_id: id,
                            name: String(form.get("name")),
                            code: String(form.get("code") ?? ""),
                            address: String(form.get("address") ?? ""),
                            city: String(form.get("city") ?? restaurant.city),
                            delivery_radius_km: Number(form.get("delivery_radius_km") ?? 8),
                          });
                          event.currentTarget.reset();
                        }}
                      >
                        <Field name="name" label="Branch name" required />
                        <Field name="code" label="Code" placeholder="JHB-01" />
                        <Field name="address" label="Address" />
                        <Field name="city" label="City" defaultValue={restaurant.city} />
                        <div className="flex items-end gap-2">
                          <Field
                            name="delivery_radius_km"
                            label="Radius km"
                            type="number"
                            step="0.5"
                            defaultValue="8"
                          />
                          <Button type="submit" size="icon" aria-label="Add branch">
                            <Plus className="size-4" />
                          </Button>
                        </div>
                      </form>
                    )}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Branch</TableHead>
                          <TableHead>Code</TableHead>
                          <TableHead>City</TableHead>
                          <TableHead className="text-right">Radius</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {branches.map((branch) => (
                          <TableRow key={branch.id}>
                            <TableCell className="font-medium">{branch.name}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {branch.code ?? "—"}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{branch.city}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {Number(branch.delivery_radius_km)} km
                            </TableCell>
                            <TableCell className="text-right">
                              {canManage && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => branchDelete.mutate({ id: branch.id })}
                                >
                                  <Trash2 className="size-4 text-destructive" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {branches.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className="py-8 text-center text-sm text-muted-foreground"
                            >
                              No branches configured yet.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="zones">
                <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
                  {/* ---- Left column: rule builder + band strip ---- */}
                  <div className="space-y-4">
                    <Card>
                      <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                              <Gauge className="size-4 text-primary" /> Delivery fee rule
                            </CardTitle>
                            <CardDescription className="mt-1 max-w-xl">
                              Customers are charged a <b className="text-foreground">base fee</b>{" "}
                              for the first distance bucket, then the fee increases by a fixed
                              amount per extra bucket. The customer app reads these bands live from
                              Firebase — no code change required when you adjust prices here.
                            </CardDescription>
                          </div>
                          <Badge
                            variant="outline"
                            className="gap-1.5 text-[10px] font-normal text-emerald-400"
                          >
                            <span className="size-1.5 rounded-full bg-emerald-500" /> Live to
                            customer app
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        {/* How-it-works strip */}
                        <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 text-xs sm:grid-cols-3">
                          <RuleStep
                            n={1}
                            title="Set the base"
                            body="Fee for the closest deliveries (0 to first bucket)."
                          />
                          <RuleStep
                            n={2}
                            title="Choose bucket size"
                            body="Every X km adds a fixed amount to the fee."
                          />
                          <RuleStep
                            n={3}
                            title="Cap with a radius"
                            body="Distances beyond the radius show as “out of range”."
                          />
                        </div>

                        {/* Inputs */}
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          <FeeField
                            id="df-base"
                            label="Base delivery fee"
                            suffix="R"
                            hint="Charged for the first bucket."
                            value={baseFee}
                            onChange={setBaseFee}
                            disabled={!canManage}
                          />
                          <FeeField
                            id="df-step"
                            label="Every"
                            suffix="km"
                            hint="Bucket size; distance steps."
                            value={stepKm}
                            onChange={setStepKm}
                            step="0.5"
                            min={0.5}
                            disabled={!canManage}
                          />
                          <FeeField
                            id="df-inc"
                            label="Add per extra step"
                            suffix="R"
                            hint="Extra rands billed per bucket."
                            value={feePerStep}
                            onChange={setFeePerStep}
                            disabled={!canManage}
                          />
                          <FeeField
                            id="df-radius"
                            label="Max delivery radius"
                            suffix="km"
                            hint="Farthest address we deliver to."
                            value={radiusInput}
                            onChange={setRadiusInput}
                            step="0.5"
                            min={0.5}
                            disabled={!canManage}
                          />
                        </div>

                        {/* Generated band strip (visual gradient chips) — preview shows first 3 bands as examples */}
                        <div className="rounded-xl border border-border/60 bg-gradient-to-b from-muted/40 to-muted/10 p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                              Auto-generated distance bands
                            </p>
                            <span className="text-[10px] text-muted-foreground">
                              {previewTiers.length > 3
                                ? `3 example only · ${previewTiers.length} total`
                                : `${previewTiers.length} band${previewTiers.length === 1 ? "" : "s"}`}
                            </span>
                          </div>
                          {previewTiers.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {previewTiers.slice(0, 3).map((t, i) => {
                                const prev = i === 0 ? 0 : Number(previewTiers[i - 1]!.up_to_km);
                                const pct =
                                  previewTiers.length > 1
                                    ? (i / (previewTiers.length - 1)) * 100
                                    : 0;
                                const tone = bandTone(pct);
                                return (
                                  <div
                                    key={t.id}
                                    className={`flex flex-col items-stretch rounded-lg border px-3 py-2 font-mono text-xs shadow-sm ${tone}`}
                                  >
                                    <span className="text-[10px] uppercase tracking-wide opacity-70">
                                      {prev.toFixed(1)}–{Number(t.up_to_km).toFixed(1)} km
                                    </span>
                                    <span className="text-base font-semibold tabular-nums">
                                      R {Number(t.fee).toFixed(2)}
                                    </span>
                                  </div>
                                );
                              })}
                              {previewTiers.length > 3 && (
                                <div className="flex items-center rounded-lg border border-dashed border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
                                  … {previewTiers.length - 3} more band
                                  {previewTiers.length - 3 === 1 ? "" : "s"} up to{" "}
                                  {Number(previewTiers[previewTiers.length - 1]!.up_to_km).toFixed(
                                    1,
                                  )}{" "}
                                  km
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-rose-300">
                              Enter valid numbers above to generate fee bands.
                            </p>
                          )}
                        </div>

                        {/* Warnings */}
                        {!restaurantHasCoords && (
                          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                            <p className="font-medium">Restaurant coordinates are not set.</p>
                            <p className="mt-0.5 text-amber-200/80">
                              The customer app needs a map pin on this restaurant to calculate
                              distance-based delivery fees. Edit the restaurant and pin its
                              location.
                            </p>
                          </div>
                        )}

                        {canManage && (
                          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                            <p className="text-[11px] text-muted-foreground">
                              Saved to{" "}
                              <code className="rounded bg-muted px-1 py-0.5">
                                /restaurants/{restaurant.id}/delivery_tiers
                              </code>
                              . Radius auto-extends to cover the last band.
                            </p>
                            <Button type="button" onClick={saveTiers}>
                              <CheckCircle2 className="mr-1.5 size-3.5" /> Save fees to Firebase
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* ---- Right column: live fee calculator ---- */}
                  <div className="space-y-4">
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Bike className="size-4 text-primary" /> Fee calculator
                        </CardTitle>
                        <CardDescription>
                          Test what the customer will be quoted. Type a distance, or drop a pin.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="tier-distance" className="text-xs">
                            Distance (km)
                          </Label>
                          <Input
                            id="tier-distance"
                            type="number"
                            step="0.5"
                            min={0}
                            value={tierDistance}
                            onChange={(e) => setTierDistance(e.target.value)}
                            className="font-mono"
                          />
                        </div>
                        <div
                          className={`rounded-xl border p-4 ${
                            tierPreviewFee == null
                              ? "border-rose-500/30 bg-rose-500/5"
                              : "border-emerald-500/30 bg-emerald-500/5"
                          }`}
                        >
                          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                            Customer pays
                          </p>
                          {tierPreviewFee != null ? (
                            <>
                              <p className="mt-1 text-3xl font-bold text-emerald-400 tabular-nums">
                                R {tierPreviewFee.toFixed(2)}
                              </p>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                For a delivery of {Number(tierDistance).toFixed(1)} km from the
                                restaurant.
                              </p>
                            </>
                          ) : (
                            <p className="mt-1 text-sm text-rose-300">
                              This address is outside the delivery radius.
                            </p>
                          )}
                        </div>

                        <Separator />

                        {/* Live lat/lng distance check */}
                        <div>
                          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                            <Navigation className="size-3.5 text-primary" />
                            Check from restaurant to a customer pin
                          </p>
                          {!restaurantHasCoords ? (
                            <p className="text-[11px] text-amber-400">
                              Set the restaurant&apos;s coordinates first to use this.
                            </p>
                          ) : (
                            <>
                              <div className="grid gap-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <Label className="text-[10px] text-muted-foreground">
                                      Customer lat
                                    </Label>
                                    <Input
                                      type="number"
                                      step="0.0001"
                                      value={destLat}
                                      onChange={(e) => setDestLat(e.target.value)}
                                      placeholder="-26.1076"
                                      className="h-8 font-mono text-xs"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[10px] text-muted-foreground">
                                      Customer lng
                                    </Label>
                                    <Input
                                      type="number"
                                      step="0.0001"
                                      value={destLng}
                                      onChange={(e) => setDestLng(e.target.value)}
                                      placeholder="28.0567"
                                      className="h-8 font-mono text-xs"
                                    />
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={useMyLocation}
                                  disabled={calcLocating}
                                >
                                  <Crosshair className="mr-1.5 size-3.5" />
                                  {calcLocating ? "Fetching location…" : "Use my location"}
                                </Button>
                              </div>

                              {computedDistanceKm != null && (
                                <div className="mt-3 space-y-2 rounded-lg border bg-muted/30 p-3">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">
                                      Straight-line distance
                                    </span>
                                    <span className="font-mono font-medium">
                                      {computedDistanceKm.toFixed(2)} km
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">Applying bands</span>
                                    <span className="font-mono font-medium">
                                      {(() => {
                                        const t = previewTiers.find(
                                          (x) => computedDistanceKm <= Number(x.up_to_km),
                                        );
                                        if (!t) return "—";
                                        const prev =
                                          previewTiers.indexOf(t) === 0
                                            ? 0
                                            : Number(
                                                previewTiers[previewTiers.indexOf(t) - 1]!.up_to_km,
                                              );
                                        return `${prev.toFixed(1)}–${Number(t.up_to_km).toFixed(1)} km bucket`;
                                      })()}
                                    </span>
                                  </div>
                                  <Separator />
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium">Quoted delivery fee</span>
                                    {computedFee != null ? (
                                      <span className="text-lg font-bold text-emerald-400 tabular-nums">
                                        R {computedFee.toFixed(2)}
                                      </span>
                                    ) : (
                                      <Badge
                                        variant="outline"
                                        className="border-rose-500/30 text-rose-300"
                                      >
                                        Out of range
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Open in Google Maps link */}
                              {destLat &&
                                destLng &&
                                restaurant.latitude != null &&
                                restaurant.longitude != null && (
                                  <a
                                    href={`https://www.google.com/maps/dir/${Number(restaurant.latitude).toFixed(6)},${Number(restaurant.longitude).toFixed(6)}/${Number(destLat).toFixed(6)},${Number(destLng).toFixed(6)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                                  >
                                    <ExternalLink className="size-3" /> Preview route in Google Maps
                                  </a>
                                )}
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="rewards">
                <RestaurantRewardsTab
                  restaurantId={restaurant.id}
                  restaurantName={restaurant.name}
                  canManage={canManage}
                />
              </TabsContent>

              <TabsContent value="payments">
                <RestaurantPaymentsTab
                  restaurantId={restaurant.id}
                  restaurantName={restaurant.name}
                  canManage={canManage}
                />
              </TabsContent>

              <TabsContent value="team">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Restaurant team</CardTitle>
                    <CardDescription>
                      Owners, managers and kitchen staff attached to this partner.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {team.length === 0 && (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        Nobody assigned yet — invite staff from Access control.
                      </p>
                    )}
                    {team.map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between rounded-md border border-border p-3"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {member.full_name ?? member.email ?? member.user_id}
                          </p>
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        </div>
                        <Badge variant="secondary" className="capitalize">
                          {member.role.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    ))}
                    <Button asChild variant="outline">
                      <Link to="/access">Manage access & invitations</Link>
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        );
      }}
    </PermissionGate>
  );
}

/**
 * Points & Rewards tab — wires the shared per-restaurant editor to live
 * Firebase subscriptions (global programme + this restaurant's override).
 */
function RestaurantRewardsTab({
  restaurantId,
  restaurantName,
  canManage,
}: {
  restaurantId: string;
  restaurantName: string;
  canManage: boolean;
}) {
  const [globalCfg, setGlobalCfg] = useState<GlobalPointsConfig>(DEFAULT_POINTS_CONFIG);
  const [override, setOverride] = useState<RestaurantPointsOverride | null>(null);

  useEffect(() => subscribeGlobalPointsConfig(setGlobalCfg), []);
  useEffect(() => subscribeRestaurantPointsOverride(restaurantId, setOverride), [restaurantId]);

  if (!isFirebaseAvailable()) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Points &amp; Rewards settings are stored in Firebase, which isn&apos;t reachable right
          now.
        </CardContent>
      </Card>
    );
  }

  return (
    <RestaurantRewardsEditor
      restaurantId={restaurantId}
      restaurantName={restaurantName}
      global={globalCfg}
      override={override}
      canManage={canManage}
    />
  );
}

function RestaurantPaymentsTab({
  restaurantId,
  restaurantName,
  canManage,
}: {
  restaurantId: string;
  restaurantName: string;
  canManage: boolean;
}) {
  const [config, setConfig] = useState<RestaurantPaymentConfig>(() =>
    defaultPaymentConfig(restaurantId),
  );

  useEffect(() => subscribePaymentConfig(restaurantId, setConfig), [restaurantId]);

  if (!isFirebaseAvailable()) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Payment options are stored in Firebase, which isn&apos;t reachable right now.
        </CardContent>
      </Card>
    );
  }

  return (
    <PaymentMethodsEditor
      restaurantId={restaurantId}
      restaurantName={restaurantName}
      config={config}
      canManage={canManage}
    />
  );
}

function useMutationLike<T>(
  fn: (input: T) => Promise<unknown>,
  message: string,
  onDone: () => void,
) {
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(message);
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

function Stat({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={`text-2xl ${capitalize ? "capitalize" : ""}`}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function Field({
  name,
  label,
  ...props
}: { name: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`f-${name}`}>{label}</Label>
      <Input id={`f-${name}`} name={name} {...props} />
    </div>
  );
}

function FeeField({
  id,
  label,
  suffix,
  hint,
  value,
  onChange,
  disabled,
  step = "1",
  min = 0,
}: {
  id: string;
  label: string;
  suffix: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  step?: string | number;
  min?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium">
        {label} <span className="ml-0.5 text-muted-foreground">({suffix})</span>
      </Label>
      <Input
        id={id}
        type="number"
        step={step}
        min={min}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
      />
      <p className="text-[10px] leading-tight text-muted-foreground">{hint}</p>
    </div>
  );
}

function RuleStep({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
        {n}
      </div>
      <div>
        <p className="text-[11px] font-semibold">{title}</p>
        <p className="text-[10px] leading-tight text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function bandTone(pct: number): string {
  // Map percentage 0..100 to a colour ramp from green (close) → amber (mid) → rose (far).
  if (pct < 25) return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  if (pct < 60) return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  return "border-rose-500/25 bg-rose-500/10 text-rose-300";
}
