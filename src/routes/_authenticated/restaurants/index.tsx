import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bike,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Crosshair,
  Edit3,
  Gauge,
  Globe2,
  ImageIcon,
  Loader2,
  MapPin,
  PauseCircle,
  Percent,
  Phone,
  Plus,
  Search,
  Shuffle,
  Store,
  Trash2,
  UtensilsCrossed,
  XCircle,
} from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import { CloudinaryImageUpload } from "@/components/cloudinary-image-upload";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
  buildTiersFromRule,
  listFirebaseRestaurants,
  saveFirebaseRestaurant,
  setFirebaseRestaurantStatus,
  subscribeRestaurants,
  type DeliveryTier,
  type FirebaseRestaurant as RestaurantRow,
  type RestaurantStatus,
} from "@/lib/restaurants.firebase";

type LocationMode = "current" | "manual";

const FALLBACK_LAT = -26.1076;
const FALLBACK_LNG = 28.0567;

const RANDOM_COVER_IDS = [
  "photo-1517248135467-4c7edcad34c4",
  "photo-1552566626-52f8b828add9",
  "photo-1555396273-367ea4eb4db5",
  "photo-1559339352-11d035aa65de",
  "photo-1559329007-40df8a9345d8",
  "photo-1504674900247-0877df9cc836",
  "photo-1565299624946-b28f40a0ae38",
  "photo-1565958011703-44f9829ba187",
  "photo-1414235077428-338989a2e8c0",
  "photo-1514933651103-005eec06c04b",
  "photo-1526318896980-cf78c088247c",
  "photo-1504754524776-8f4f37790ca0",
  "photo-1528605248644-14dd04022da1",
  "photo-1540189549336-e6e99c3679fe",
];
function randomCoverUrl(): string {
  const id = RANDOM_COVER_IDS[Math.floor(Math.random() * RANDOM_COVER_IDS.length)];
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=70&sig=${Math.floor(Math.random() * 10000)}`;
}

const statusTone: Record<RestaurantStatus, string> = {
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  suspended: "bg-orange-500/15 text-orange-400 border-orange-500/25",
  rejected: "bg-destructive/15 text-destructive border-destructive/25",
};

const money = (value: number) =>
  `R ${value.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export const Route = createFileRoute("/_authenticated/restaurants/")({
  head: () => ({
    meta: [
      { title: "Restaurant Management — ForkFleet Console" },
      {
        name: "description",
        content: "Register, approve, suspend and configure restaurant partners across the delivery network.",
      },
      { property: "og:title", content: "Restaurant Management — ForkFleet Console" },
      { property: "og:description", content: "Register, approve, suspend and configure restaurant partners." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RestaurantsPage,
});

function RestaurantsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["restaurants-fb", search, status];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (typeof window === "undefined") return [];
      const rows = await listFirebaseRestaurants({ search, status });
      setConnected(true);
      return rows;
    },
    initialData: [],
    staleTime: 5_000,
    retry: 1,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const unsub = subscribeRestaurants((allRows) => {
      setConnected(true);
      const filtered = allRows
        .filter(
          (r) =>
            (!search ||
              r.name.toLowerCase().includes(search.toLowerCase()) ||
              r.cuisine.toLowerCase().includes(search.toLowerCase())) &&
            (!status || status === "all" || r.status === status),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      queryClient.setQueryData(queryKey, filtered);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status]);

  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; status: RestaurantStatus }) =>
      setFirebaseRestaurantStatus(vars),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<RestaurantRow[]>(queryKey) ?? [];
      queryClient.setQueryData<RestaurantRow[]>(
        queryKey,
        prev.map((r) => (r.id === vars.id ? { ...r, status: vars.status } : r)),
      );
      return { prev };
    },
    onError: (err: Error, _v, ctx) => {
      toast.error(err.message || "Failed to update status");
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
    },
    onSuccess: (_r, vars) => {
      toast.success(`Restaurant ${vars.status}`);
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof saveFirebaseRestaurant>[0]) =>
      saveFirebaseRestaurant(payload),
    onSuccess: () => {
      toast.success("Restaurant saved to Firebase");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["restaurants-fb"] });
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save restaurant"),
  });

  const rows = query.data ?? [];
  const counts = useMemo(() => {
    return rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [rows]);

  return (
    <PermissionGate
      required={["restaurants.view", "restaurants.manage"]}
      breadcrumb={["Catalogue", "Restaurants"]}
      title="Restaurant management"
      description="Live-synced to Firebase Realtime Database. Register, approve and tune partners."
      actions={
        <RegisterRestaurantDialog
          open={open}
          onOpenChange={setOpen}
          onSubmit={(v) => createMutation.mutate({ ...v, id: undefined, status: undefined })}
          isPending={createMutation.isPending}
        />
      }
    >
      {(staff) => {
        const canManage = staff.hasPermission("restaurants.manage");
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1.5 font-normal">
                <span className={`size-1.5 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
                Firebase Realtime Database {connected ? "· live" : "· connecting…"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Showing only restaurants saved to Firebase.
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(["approved", "pending", "suspended", "rejected"] as RestaurantStatus[]).map((key) => (
                <Card key={key}>
                  <CardHeader className="pb-2">
                    <CardDescription className="capitalize">{key}</CardDescription>
                    <CardTitle className="text-2xl">{counts[key] ?? 0}</CardTitle>
                  </CardHeader>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Store className="size-4" /> Partner directory
                  </CardTitle>
                  <CardDescription>{rows.length} restaurants matching your filters</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search by name"
                      className="h-9 w-56 pl-8"
                    />
                  </div>
                  <Tabs value={status} onValueChange={setStatus}>
                    <TabsList>
                      <TabsTrigger value="all">All</TabsTrigger>
                      <TabsTrigger value="pending">Pending</TabsTrigger>
                      <TabsTrigger value="approved">Live</TabsTrigger>
                      <TabsTrigger value="suspended">Suspended</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </CardHeader>
              <CardContent>
                {query.isLoading && !rows.length ? (
                  <Skeleton className="h-72 w-full" />
                ) : query.isError ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                    <Store className="size-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">Could not reach Firebase</p>
                    <p className="max-w-sm text-xs text-muted-foreground">
                      {(query.error as Error | null)?.message ?? "Check your connection and try again."}
                    </p>
                    <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                      Retry
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Restaurant</TableHead>
                          <TableHead>City</TableHead>
                          <TableHead>Fulfilment</TableHead>
                          <TableHead>Coordinates</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Commission</TableHead>
                          <TableHead className="text-right">Radius</TableHead>
                          <TableHead className="text-right">Hours</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((restaurant) => (
                          <TableRow key={restaurant.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Avatar className="size-10 rounded-md border">
                                  {restaurant.image_url ? (
                                    <AvatarImage
                                      src={restaurant.image_url}
                                      alt={restaurant.name}
                                      className="object-cover"
                                    />
                                  ) : null}
                                  <AvatarFallback className="rounded-md bg-primary/10 text-primary">
                                    {initials(restaurant.name)}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <Link
                                    to="/restaurants/$id"
                                    params={{ id: restaurant.id }}
                                    className="font-medium hover:underline"
                                  >
                                    {restaurant.name}
                                  </Link>
                                  <p className="text-xs text-muted-foreground">{restaurant.cuisine}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{restaurant.city}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {restaurant.delivery_enabled !== false ? (
                                  <Badge variant="outline" className="gap-1 border-emerald-500/25 bg-emerald-500/10 text-[10px] font-normal text-emerald-400">
                                    <Bike className="size-2.5" /> delivery
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="gap-1 border-muted-foreground/25 text-[10px] font-normal text-muted-foreground/70 line-through">
                                    <Bike className="size-2.5" /> delivery
                                  </Badge>
                                )}
                                {restaurant.pickup_enabled !== false ? (
                                  <Badge variant="outline" className="gap-1 border-sky-500/25 bg-sky-500/10 text-[10px] font-normal text-sky-400">
                                    pickup
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="gap-1 border-muted-foreground/25 text-[10px] font-normal text-muted-foreground/70 line-through">
                                    pickup
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {restaurant.latitude != null && restaurant.longitude != null ? (
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  {Number(restaurant.latitude).toFixed(4)}, {Number(restaurant.longitude).toFixed(4)}
                                </span>
                              ) : (
                                <Badge variant="outline" className="gap-1 text-[10px] font-normal text-amber-400">
                                  <MapPin className="size-2.5" /> not set
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`capitalize ${statusTone[restaurant.status]}`}>
                                {restaurant.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {Number(restaurant.commission_rate)}%
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {Number(restaurant.delivery_radius_km)} km
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                              {restaurant.opens_at.slice(0, 5)}–{restaurant.closes_at.slice(0, 5)}
                            </TableCell>
                            <TableCell className="text-right">
                              {canManage && (
                                <div className="flex justify-end gap-1">
                                  <Button size="sm" variant="ghost" asChild>
                                    <Link to="/restaurants/$id" params={{ id: restaurant.id }}>
                                      <Edit3 className="mr-1 size-3.5" /> Manage
                                    </Link>
                                  </Button>
                                  {restaurant.status !== "approved" && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() =>
                                        statusMutation.mutate({ id: restaurant.id, status: "approved" })
                                      }
                                    >
                                      <CheckCircle2 className="mr-1 size-3.5" /> Approve
                                    </Button>
                                  )}
                                  {restaurant.status === "approved" && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() =>
                                        statusMutation.mutate({ id: restaurant.id, status: "suspended" })
                                      }
                                    >
                                      <PauseCircle className="mr-1 size-3.5" /> Suspend
                                    </Button>
                                  )}
                                  {restaurant.status === "pending" && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-destructive"
                                      onClick={() =>
                                        statusMutation.mutate({ id: restaurant.id, status: "rejected" })
                                      }
                                    >
                                      <XCircle className="mr-1 size-3.5" /> Reject
                                    </Button>
                                  )}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {rows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                              No restaurants match this filter.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">
              Network commission at{" "}
              {money(
                rows.reduce((sum, r) => sum + Number(r.commission_rate), 0) / (rows.length || 1),
              ).replace("R ", "")}
              % average across listed partners.
            </p>
          </div>
        );
      }}
    </PermissionGate>
  );
}

// ---------------------------------------------------------------------------
// Register dialog (tabbed, professional layout)
// ---------------------------------------------------------------------------

type DialogTab = "business" | "location" | "branding" | "operations";

const DIALOG_TABS: {
  id: DialogTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}[] = [
  { id: "business",   label: "Business",   icon: Building2,       description: "Trading name, cuisine, contact" },
  { id: "location",   label: "Location",   icon: MapPin,         description: "Address and map pin" },
  { id: "branding",   label: "Branding",   icon: ImageIcon,      description: "Cover image" },
  { id: "operations", label: "Operations", icon: UtensilsCrossed, description: "Hours, fulfilment, delivery fees" },
];

interface RegisterDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (payload: {
    name: string;
    cuisine: string;
    email?: string | null | undefined;
    phone?: string | null | undefined;
    address?: string | null | undefined;
    city: string;
    commission_rate: number;
    delivery_enabled: boolean;
    pickup_enabled: boolean;
    delivery_radius_km: number;
    delivery_tiers?: DeliveryTier[] | undefined;
    prep_time_minutes: number;
    opens_at: string;
    closes_at: string;
    latitude: number | null;
    longitude: number | null;
    image_url: string | null;
  }) => void;
  isPending: boolean;
}

function RegisterRestaurantDialog({ open, onOpenChange, onSubmit, isPending }: RegisterDialogProps) {
  const [dialogTab, setDialogTab] = useState<DialogTab>("business");
  const [locationMode, setLocationMode] = useState<LocationMode>("manual");
  const [latitude, setLatitude] = useState<string>("");
  const [longitude, setLongitude] = useState<string>("");
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [cuisine, setCuisine] = useState("Contemporary");
  const [city, setCity] = useState("Johannesburg");
  const [imageUrl, setImageUrl] = useState<string>("");
  const [commission, setCommission] = useState<string>("15");
  const [radius, setRadius] = useState<string>("8");
  const [prep, setPrep] = useState<string>("20");
  const [opens, setOpens] = useState<string>("08:00");
  const [closes, setCloses] = useState<string>("22:00");
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [addr, setAddr] = useState<string>("");
  const [baseFee, setBaseFee] = useState<string>("10");
  const [stepKm, setStepKm] = useState<string>("5");
  const [feePerStep, setFeePerStep] = useState<string>("10");
  const [deliveryEnabled, setDeliveryEnabled] = useState<boolean>(true);
  const [pickupEnabled, setPickupEnabled] = useState<boolean>(true);
  const [previewTiers, setPreviewTiers] = useState<DeliveryTier[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  // Reset defaults on open
  useEffect(() => {
    if (!open) return;
    setDialogTab("business");
    setName(""); setEmail(""); setPhone(""); setAddr("");
    setLocationMode("manual"); setLatitude(""); setLongitude("");
    setGeoError(null); setLocating(false);
    setCuisine("Contemporary"); setCity("Johannesburg");
    setImageUrl(randomCoverUrl());
    setCommission("15"); setRadius("8"); setPrep("20");
    setOpens("08:00"); setCloses("22:00");
    setBaseFee("10"); setStepKm("5"); setFeePerStep("10");
    setDeliveryEnabled(true); setPickupEnabled(true);
  }, [open]);

  // Live preview of fee bands — show exactly 3 example chips for the preview strip.
  useEffect(() => {
    const base = Number(baseFee);
    const step = Number(stepKm);
    const inc = Number(feePerStep);
    if (!Number.isFinite(base) || base < 0 || !Number.isFinite(step) || step <= 0 || !Number.isFinite(inc) || inc < 0) {
      setPreviewTiers([]);
      return;
    }
    const out: DeliveryTier[] = [];
    for (let i = 0; i < 3; i++) {
      out.push({
        id: `pv_${i}`,
        up_to_km: Math.round(step * (i + 1) * 10) / 10,
        fee: Math.round((base + inc * i) * 100) / 100,
        label: null,
      });
    }
    setPreviewTiers(out);
  }, [baseFee, stepKm, feePerStep]);

  function requestCurrentLocation() {
    setGeoError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("Geolocation is not supported — using Johannesburg fallback.");
      setLatitude(FALLBACK_LAT.toFixed(6));
      setLongitude(FALLBACK_LNG.toFixed(6));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setGeoError(`${err.message || "Location unavailable"} — using Johannesburg fallback.`);
        setLatitude(FALLBACK_LAT.toFixed(6));
        setLongitude(FALLBACK_LNG.toFixed(6));
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  }

  useEffect(() => {
    if (open && locationMode === "current" && !latitude && !longitude && !locating) {
      requestCurrentLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locationMode]);

  function validateAll(): DialogTab | null {
    if (!name.trim()) return "business";
    if (!city.trim()) return "business";
    const latNum = latitude ? Number(latitude) : null;
    const lngNum = longitude ? Number(longitude) : null;
    if (latitude && (!Number.isFinite(latNum) || latNum! < -90 || latNum! > 90)) return "location";
    if (longitude && (!Number.isFinite(lngNum) || lngNum! < -180 || lngNum! > 180)) return "location";
    if (!deliveryEnabled && !pickupEnabled) return "operations";
    const base = Number(baseFee), step = Number(stepKm), inc = Number(feePerStep), r = Number(radius);
    if (deliveryEnabled) {
      if (!(Number(base) >= 0)) return "operations";
      if (!(Number(step) > 0)) return "operations";
      if (!(Number(inc) >= 0)) return "operations";
      if (!(Number(r) > 0)) return "operations";
    }
    return null;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalidTab = validateAll();
    if (invalidTab) {
      setDialogTab(invalidTab);
      toast.error(invalidTab === "business" ? "Please enter the restaurant name." : "Please check the highlighted section.");
      return;
    }
    const latRaw = String(latitude).trim();
    const lngRaw = String(longitude).trim();
    const latNum = latRaw ? Number(latRaw) : null;
    const lngNum = lngRaw ? Number(lngRaw) : null;
    setGeoError(null);

    const radiusKm = Number(radius) || 8;
    const base = Number(baseFee);
    const step = Number(stepKm);
    const inc = Number(feePerStep);

    let normalisedTiers: DeliveryTier[] = [];
    let effectiveRadius = 0;
    if (deliveryEnabled) {
      const built = buildTiersFromRule({
        base_fee: base,
        step_km: step,
        fee_per_step: inc,
        radius_km: radiusKm,
      });
      normalisedTiers = built.tiers;
      effectiveRadius = built.effectiveRadius;
    }

    onSubmit({
      name: name.trim(),
      cuisine,
      email: email.trim() || null,
      phone: phone.trim() || null,
      address: addr.trim() || null,
      city,
      commission_rate: Number(commission) || 15,
      delivery_enabled: deliveryEnabled,
      pickup_enabled: pickupEnabled,
      delivery_radius_km: deliveryEnabled ? effectiveRadius : 0,
      delivery_tiers: deliveryEnabled ? normalisedTiers : [],
      prep_time_minutes: Number(prep) || 20,
      opens_at: opens,
      closes_at: closes,
      latitude: Number.isFinite(latNum) ? latNum : null,
      longitude: Number.isFinite(lngNum) ? lngNum : null,
      image_url: imageUrl.trim() ? imageUrl.trim() : null,
    });
  }

  function nextTab() {
    const idx = DIALOG_TABS.findIndex((t) => t.id === dialogTab);
    if (idx < DIALOG_TABS.length - 1) setDialogTab(DIALOG_TABS[idx + 1]!.id);
  }
  function prevTab() {
    const idx = DIALOG_TABS.findIndex((t) => t.id === dialogTab);
    if (idx > 0) setDialogTab(DIALOG_TABS[idx - 1]!.id);
  }

  const currentIdx = DIALOG_TABS.findIndex((t) => t.id === dialogTab);
  const isFirst = currentIdx === 0;
  const isLast = currentIdx === DIALOG_TABS.length - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" /> Register restaurant
        </Button>
      </DialogTrigger>
      <DialogContent
        className="grid w-full max-w-4xl gap-0 overflow-hidden p-0"
        style={{ height: "min(94vh, 860px)" }}
      >
        <DialogHeader className="shrink-0 border-b bg-gradient-to-b from-muted/50 to-muted/20 px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-sm">
              <Store className="size-5" />
            </div>
            <div className="flex-1 pr-4">
              <DialogTitle className="text-lg">Register a restaurant partner</DialogTitle>
              <DialogDescription className="mt-0.5">
                Complete the 4 steps below. The record is saved to Firebase under <code className="rounded bg-muted px-1 py-0.5 text-xs">/restaurants</code>. Open the restaurant page after saving to manage full details.
              </DialogDescription>
            </div>
          </div>

          {/* Stepper */}
          <div className="mt-4 flex items-center gap-1">
            {DIALOG_TABS.map((t, i) => {
              const Icon = t.icon;
              const active = dialogTab === t.id;
              const done = i < currentIdx;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDialogTab(t.id)}
                  className={`group flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                    active ? "bg-primary/10 text-primary" : done ? "text-emerald-400 hover:bg-emerald-500/5" : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <span className={`flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold ${
                    active ? "border-primary bg-primary text-primary-foreground" : done ? "border-emerald-500/40 bg-emerald-500/10" : "border-muted-foreground/30"
                  }`}>
                    {done ? <CheckCircle2 className="size-3.5" /> : i + 1}
                  </span>
                  <span className="hidden sm:block">
                    <span className="block font-medium leading-tight">{t.label}</span>
                    <span className="block text-[10px] leading-tight text-muted-foreground group-hover:text-current/70">{t.description}</span>
                  </span>
                  {i < DIALOG_TABS.length - 1 && (
                    <span className={`ml-auto hidden h-px w-4 sm:block ${done ? "bg-emerald-500/40" : "bg-border"}`} />
                  )}
                  <Icon className={`ml-auto size-3.5 sm:hidden ${active ? "text-primary" : ""}`} />
                </button>
              );
            })}
          </div>
        </DialogHeader>

        <form ref={formRef} id="restaurant-form" onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-background to-muted/10 px-6 py-5">
              <Tabs value={dialogTab} onValueChange={(v) => setDialogTab(v as DialogTab)} className="h-full">

              {/* ============ TAB 1: BUSINESS ============ */}
              <TabsContent value="business" className="mt-0 space-y-5">
                <TabHeader
                  icon={Building2}
                  title="Business details"
                  subtitle="Trading identity shown to customers and dispatch."
                />
                <div className="grid gap-4 sm:grid-cols-6">
                  <div className="space-y-1.5 sm:col-span-4">
                    <Label htmlFor="r-name">Trading name <span className="text-destructive">*</span></Label>
                    <Input id="r-name" value={name} onChange={(e)=>setName(e.target.value)} placeholder="e.g. Nonna's Trattoria" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="r-cuisine">Cuisine</Label>
                    <Select value={cuisine} onValueChange={setCuisine}>
                      <SelectTrigger id="r-cuisine"><SelectValue placeholder="Select cuisine" /></SelectTrigger>
                      <SelectContent>
                        {["Contemporary","African","American","Burgers","Chinese","Fast food","Greek","Grill","Healthy","Indian","Italian","Japanese","Mediterranean","Mexican","Pizza","Portuguese","Seafood","Sushi","Thai","Vegan"].map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-3">
                    <Label htmlFor="r-email" className="flex items-center gap-1.5"><Phone className="size-3 text-muted-foreground" /> Contact email</Label>
                    <Input id="r-email" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="owner@restaurant.co.za" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-3">
                    <Label htmlFor="r-phone">Phone</Label>
                    <Input id="r-phone" value={phone} onChange={(e)=>setPhone(e.target.value)} placeholder="+27 11 000 0000" />
                  </div>
                </div>
                <div className="rounded-xl border border-primary/10 bg-primary/5 p-4">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
                    <CheckCircle2 className="size-3.5" /> Tip
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Use the kitchen&apos;s landline or a dedicated WhatsApp line for the phone — this is shown to riders when a delivery needs coordination.
                  </p>
                </div>
              </TabsContent>

              {/* ============ TAB 2: LOCATION ============ */}
              <TabsContent value="location" className="mt-0 space-y-5">
                <TabHeader icon={MapPin} title="Address & map pin" subtitle="Where riders collect orders. Required for distance-based delivery fees." />
                <div className="grid gap-4 sm:grid-cols-6">
                  <div className="space-y-1.5 sm:col-span-4">
                    <Label htmlFor="r-address">Street address</Label>
                    <Input id="r-address" value={addr} onChange={(e)=>setAddr(e.target.value)} placeholder="123 Main Road, Bryanston" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="r-city">City</Label>
                    <Select value={city} onValueChange={setCity}>
                      <SelectTrigger id="r-city"><SelectValue placeholder="Select city" /></SelectTrigger>
                      <SelectContent>
                        {["Johannesburg","Pretoria","Cape Town","Durban","Port Elizabeth","Bloemfontein","Nelspruit","Polokwane"].map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="rounded-xl border bg-card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <MapPin className="size-4 text-primary" /> Map pin coordinates
                    </div>
                    <Badge variant="outline" className="text-[10px] font-normal">required for delivery</Badge>
                  </div>

                  <RadioGroup
                    value={locationMode}
                    onValueChange={(v) => {
                      const next = v as LocationMode;
                      setLocationMode(next);
                      setGeoError(null);
                      if (next === "current" && !latitude && !longitude) requestCurrentLocation();
                    }}
                    className="mb-4 grid gap-2 sm:grid-cols-2"
                  >
                    <RadioCard id="loc-current" value="current" active={locationMode==="current"} icon={<Crosshair className="size-4" />} title="Use current location" description="Auto-detect this device's position via the browser." />
                    <RadioCard id="loc-manual" value="manual" active={locationMode==="manual"} icon={<MapPin className="size-4" />} title="Enter coordinates" description="Type latitude and longitude manually." />
                  </RadioGroup>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="r-lat" className="text-xs font-normal text-muted-foreground">Latitude</Label>
                      <Input id="r-lat" inputMode="decimal" placeholder="-26.107600" value={latitude}
                        readOnly={locationMode==="current"} disabled={locationMode==="current" && locating}
                        onChange={(e)=>setLatitude(e.target.value)}
                        className={`font-mono text-sm ${locationMode==="current"?"bg-muted":""}`} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="r-lng" className="text-xs font-normal text-muted-foreground">Longitude</Label>
                      <Input id="r-lng" inputMode="decimal" placeholder="28.056700" value={longitude}
                        readOnly={locationMode==="current"} disabled={locationMode==="current" && locating}
                        onChange={(e)=>setLongitude(e.target.value)}
                        className={`font-mono text-sm ${locationMode==="current"?"bg-muted":""}`} />
                    </div>
                  </div>

                  <p className="mt-2 text-[11px] text-muted-foreground">
                    South Africa is in the southern hemisphere — latitude will be negative (e.g. -26.1076 for Johannesburg).
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {locationMode === "current" && (
                      <>
                        {locating ? (
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Fetching position…</span>
                        ) : latitude && longitude ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-500"><CheckCircle2 className="size-3.5" /> Position locked</span>
                        ) : (
                          <Button type="button" size="sm" variant="secondary" className="h-7 text-xs" onClick={requestCurrentLocation}><Crosshair className="mr-1 size-3" /> Detect my location</Button>
                        )}
                        {!locating && latitude && longitude && (
                          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={requestCurrentLocation}>Re-detect</Button>
                        )}
                      </>
                    )}
                    {latitude && longitude && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && (
                      <a href={`https://www.google.com/maps?q=${Number(latitude).toFixed(6)},${Number(longitude).toFixed(6)}`} target="_blank" rel="noreferrer"
                        className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground transition hover:bg-accent hover:text-foreground">
                        <Globe2 className="size-3" /> Open in Maps
                      </a>
                    )}
                    {(latitude || longitude) && (
                      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={()=>{ setLatitude(""); setLongitude(""); setGeoError(null); }}>
                        Clear
                      </Button>
                    )}
                    {geoError && <span className="text-amber-500">{geoError}</span>}
                  </div>
                </div>
              </TabsContent>

              {/* ============ TAB 3: BRANDING ============ */}
              <TabsContent value="branding" className="mt-0 space-y-5">
                <TabHeader icon={ImageIcon} title="Cover image" subtitle="The hero image shown on the customer app menu card." />
                <CloudinaryImageUpload
                  label="Cover image"
                  context="restaurant_cover"
                  value={imageUrl}
                  onChange={setImageUrl}
                />
                <div className="flex justify-end">
                  <Button type="button" variant="secondary" onClick={() => setImageUrl(randomCoverUrl())}>
                    <Shuffle className="mr-2 size-4" /> Pick random Unsplash
                  </Button>
                </div>
              </TabsContent>

              {/* ============ TAB 4: OPERATIONS ============ */}
              <TabsContent value="operations" className="mt-0 space-y-5">
                <TabHeader icon={UtensilsCrossed} title="Operations & delivery" subtitle="Trading hours, fulfilment methods and distance-based fees." />
                <div className="grid gap-4 sm:grid-cols-3">
                  <LabeledNumber id="r-comm" label="Platform commission" suffix="%" hint="Platform cut per order" value={commission} onChange={setCommission} step="0.1" min={0} max={50} icon={Percent} />
                  <LabeledNumber id="r-radius" label="Delivery radius" suffix="km" hint="Farthest delivery distance" value={radius} onChange={setRadius} step="0.5" min={0.5} icon={MapPin} />
                  <LabeledNumber id="r-prep" label="Avg. prep time" suffix="min" hint="Kitchen lead time" value={prep} onChange={setPrep} min={5} icon={Clock3} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="r-opens">Opening time</Label>
                    <Input id="r-opens" type="time" value={opens} onChange={(e)=>setOpens(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="r-closes">Closing time</Label>
                    <Input id="r-closes" type="time" value={closes} onChange={(e)=>setCloses(e.target.value)} />
                  </div>
                </div>

                <div className="rounded-xl border bg-card p-4">
                  <p className="mb-3 flex items-center gap-1.5 text-sm font-medium">
                    <Bike className="size-4 text-primary" /> Fulfilment methods
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FulfilmentToggle
                      active={deliveryEnabled}
                      onToggle={(v)=>{ setDeliveryEnabled(v); if (!v && !pickupEnabled) setPickupEnabled(true); }}
                      emoji="🛵" title="Courier delivery"
                      description="Dispatch riders deliver to customer addresses. Fees calculated by distance."
                    />
                    <FulfilmentToggle
                      active={pickupEnabled}
                      onToggle={(v)=>{ setPickupEnabled(v); if (!v && !deliveryEnabled) setDeliveryEnabled(true); }}
                      emoji="🏃" title="Pickup at kitchen"
                      description="Customers collect orders themselves. No delivery fee."
                    />
                  </div>
                  {!deliveryEnabled && (
                    <p className="mt-2 text-[11px] text-amber-400">Delivery is off — the customer app will only offer pickup for this restaurant.</p>
                  )}
                </div>

                <div className={`rounded-xl border bg-card p-4 transition ${deliveryEnabled ? "" : "opacity-50"}`}>
                  <div className="mb-3">
                    <p className="flex items-center gap-1.5 text-sm font-medium"><Gauge className="size-4 text-primary" /> Delivery fee rule</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Charge <b>R base</b> for the first <b>X km</b> bucket, then add <b>R extra</b> for every additional bucket.
                      Bands are auto-generated and saved to Firebase.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <LabeledNumber id="r-base" label="Base delivery fee" suffix="R" hint="Fee for first bucket" value={baseFee} onChange={setBaseFee} disabled={!deliveryEnabled} />
                    <LabeledNumber id="r-step" label="Every" suffix="km" hint="Bucket size" value={stepKm} onChange={setStepKm} step="0.5" min={0.5} disabled={!deliveryEnabled} />
                    <LabeledNumber id="r-inc" label="Add per step" suffix="R" hint="Extra per bucket" value={feePerStep} onChange={setFeePerStep} disabled={!deliveryEnabled} />
                  </div>
                  <div className="mt-4 rounded-lg border border-border/60 bg-muted/30 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Generated bands (preview)</p>
                      <span className="text-[10px] text-muted-foreground">3 example only</span>
                    </div>
                    {deliveryEnabled && previewTiers.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {previewTiers.map((t, i) => {
                          const prev = i === 0 ? 0 : Number(previewTiers[i-1]!.up_to_km);
                          const pct = previewTiers.length > 1 ? (i/(previewTiers.length-1))*100 : 0;
                          const tone = pct < 25 ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                                     : pct < 60 ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
                                     : "border-rose-500/25 bg-rose-500/10 text-rose-300";
                          return (
                            <Badge key={t.id} variant="outline" className={`gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] ${tone}`}>
                              {prev.toFixed(1)}–{Number(t.up_to_km).toFixed(1)} km
                              <span className="font-semibold">R {Number(t.fee).toFixed(0)}</span>
                            </Badge>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Enable delivery above to generate bands.</p>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="shrink-0 flex-row items-center justify-between gap-2 border-t bg-muted/30 px-6 py-3">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="tabular-nums">Step {currentIdx + 1} / {DIALOG_TABS.length}</span>
              <span className="hidden sm:inline">· Country defaults to South Africa (ZAR)</span>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
                Cancel
              </Button>
              {!isFirst && (
                <Button type="button" variant="outline" onClick={prevTab} disabled={isPending}>
                  <ChevronLeft className="mr-1 size-4" /> Back
                </Button>
              )}
              {!isLast ? (
                <Button type="button" onClick={nextTab} disabled={isPending}>
                  Next <ChevronRight className="ml-1 size-4" />
                </Button>
              ) : (
                <Button type="submit" form="restaurant-form" disabled={isPending}>
                  {isPending ? (
                    <><Loader2 className="mr-2 size-4 animate-spin" /> Saving…</>
                  ) : (
                    <><CheckCircle2 className="mr-2 size-4" /> Register restaurant</>
                  )}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Small sub-components for the dialog
// ---------------------------------------------------------------------------

function TabHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-gradient-to-r from-primary/5 to-transparent p-4">
      <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-5" />
      </div>
      <div>
        <h2 className="text-base font-semibold leading-tight">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function LabeledNumber({
  id, label, suffix, hint, value, onChange, step = "1", min, max, icon: Icon, disabled,
}: {
  id: string;
  label: string;
  suffix: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  step?: string | number;
  min?: number;
  max?: number;
  icon?: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium">
        {Icon ? <Icon className="size-3 text-muted-foreground" /> : null}
        {label} <span className="ml-0.5 text-muted-foreground">({suffix})</span>
      </Label>
      <Input id={id} type="number" step={step} min={min} max={max} value={value} disabled={disabled}
        onChange={(e)=>onChange(e.target.value)} className="font-mono" />
      {hint && <p className="text-[10px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FulfilmentToggle({
  active, onToggle, emoji, title, description,
}: {
  active: boolean;
  onToggle: (v: boolean) => void;
  emoji: string;
  title: string;
  description: string;
}) {
  return (
    <label className={`flex cursor-pointer items-start justify-between gap-3 rounded-lg border p-4 transition ${
      active ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/60 bg-muted/10 opacity-70 hover:opacity-90"
    }`}>
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none">{emoji}</span>
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-[11px] leading-snug text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch checked={active} onCheckedChange={onToggle} />
    </label>
  );
}

function RadioCard({
  id, value, active, icon, title, description,
}: {
  id: string;
  value: string;
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <label htmlFor={id}
      className={`group relative flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
        active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:border-muted-foreground/40 hover:bg-muted/50"
      }`}>
      <RadioGroupItem value={value} id={id} className="mt-0.5" />
      <div className="flex-1 space-y-0.5">
        <div className={`flex items-center gap-1.5 text-sm font-medium ${active ? "text-primary" : ""}`}>
          <span className={active ? "text-primary" : "text-muted-foreground"}>{icon}</span>
          {title}
        </div>
        <p className="text-xs leading-snug text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}
