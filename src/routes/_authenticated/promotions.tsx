import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BadgePercent,
  Building2,
  CheckCircle2,
  Coins,
  Gift,
  Globe,
  Layers,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  Store,
  Tag,
  TicketCheck,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Truck,
  X,
} from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import { RestaurantRewardsEditor } from "@/components/loyalty/restaurant-rewards-editor";
import { RewardsPreview } from "@/components/loyalty/rewards-preview";
import { ComboManager } from "@/components/promotions/combo-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isFirebaseAvailable } from "@/lib/firebase";
import { useFirebaseRestaurants } from "@/hooks/use-firebase-restaurants";
import { earnSummary, nextMethod, type EffectivePointsConfig } from "@/lib/loyalty";
import {
  DEFAULT_POINTS_CONFIG,
  deletePromoCampaign,
  listComboDeals,
  listPromoCampaigns,
  listRestaurantPointsOverrides,
  promoRestaurantIds,
  saveGlobalPointsConfig,
  savePromoCampaign,
  subscribeComboDeals,
  subscribeGlobalPointsConfig,
  subscribePromoCampaigns,
  subscribeRestaurantPointsOverrides,
  togglePromoCampaign,
  type ComboDeal,
  type GlobalPointsConfig,
  type PromoCampaign,
  type PromoType,
  type RestaurantPointsOverride,
} from "@/lib/promotions.firebase";

const TYPE_LABELS: Record<PromoType, { label: string; suffix: string; icon: typeof Tag }> = {
  percent: { label: "Percent off", suffix: "%", icon: BadgePercent },
  fixed: { label: "Fixed amount off", suffix: " R", icon: Tag },
  free_delivery: { label: "Free delivery", suffix: "", icon: Truck },
  bogo: { label: "Buy-one-get-one", suffix: "", icon: Gift },
};

export const Route = createFileRoute("/_authenticated/promotions")({
  head: () => ({
    meta: [
      { title: "Promotions & Loyalty — ForkFleet Console" },
      {
        name: "description",
        content:
          "Coupon promotions, the Points & Rewards programme, and per-restaurant loyalty settings synced live to the customer app.",
      },
    ],
  }),
  component: PromotionsPage,
});

function PromotionsPage() {
  const { rows: restaurants } = useFirebaseRestaurants();

  // ---- live data ----
  const [pointsConfig, setPointsConfig] = useState<GlobalPointsConfig>(DEFAULT_POINTS_CONFIG);
  const [promos, setPromos] = useState<PromoCampaign[]>([]);
  const [combos, setCombos] = useState<ComboDeal[]>([]);
  const [overrides, setOverrides] = useState<RestaurantPointsOverride[]>([]);
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState("coupons");
  const [editingPromo, setEditingPromo] = useState<PromoCampaign | null>(null);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string | null>(null);

  const selectedRestaurant = useMemo(
    () => restaurants.find((r) => r.id === selectedRestaurantId) ?? null,
    [restaurants, selectedRestaurantId],
  );
  const selectedOverride = useMemo(
    () => overrides.find((o) => o.restaurant_id === selectedRestaurantId) ?? null,
    [overrides, selectedRestaurantId],
  );

  const globalEffective: EffectivePointsConfig = useMemo(
    () => ({ ...pointsConfig, rewards_disabled_for_restaurant: false }),
    [pointsConfig],
  );

  useEffect(() => {
    if (!isFirebaseAvailable()) return;
    let mounted = true;
    const u1 = subscribeGlobalPointsConfig((c) => {
      if (mounted) {
        setPointsConfig(c);
        setConnected(true);
      }
    });
    const u2 = subscribePromoCampaigns((list) => {
      if (mounted) setPromos(list);
    });
    const u3 = subscribeRestaurantPointsOverrides((rows) => {
      if (mounted) setOverrides(rows);
    });
    const u4 = subscribeComboDeals((list) => {
      if (mounted) setCombos(list);
    });
    void listPromoCampaigns().then((list) => {
      if (mounted) setPromos(list);
    });
    void listRestaurantPointsOverrides().then((rows) => {
      if (mounted) setOverrides(rows);
    });
    void listComboDeals().then((list) => {
      if (mounted) setCombos(list);
    });
    return () => {
      mounted = false;
      u1();
      u2();
      u3();
      u4();
    };
  }, []);

  const refreshOverrides = async () => setOverrides(await listRestaurantPointsOverrides());

  // ---- derived metrics ----
  const kpis = useMemo(() => {
    const activePromos = promos.filter((p) => p.is_active && new Date(p.expires_at) > new Date());
    const totalRedemptions = promos.reduce((s, p) => s + (p.usage_count ?? 0), 0);
    return {
      activePromos: activePromos.length,
      totalPromos: promos.length,
      totalRedemptions,
      rewardsOn: pointsConfig.enabled,
      redemptionPhrase: pointsConfig.redemption_enabled
        ? `${pointsConfig.points_required.toLocaleString()} pts → ${pointsConfig.discount_percent}% off`
        : "No redemption",
      restaurantsWithOverride: overrides.length,
    };
  }, [promos, pointsConfig, overrides]);

  // ---- mutations ----
  const pointsSaveMut = useMutation({
    mutationFn: (patch: Partial<GlobalPointsConfig>) => saveGlobalPointsConfig(patch, "admin"),
    onSuccess: (c) => {
      setPointsConfig(c);
      toast.success("Rewards programme saved");
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save rewards config"),
  });

  const promoSaveMut = useMutation({
    mutationFn: (input: Parameters<typeof savePromoCampaign>[0]) => savePromoCampaign(input),
    onSuccess: async () => {
      toast.success("Promotion saved");
      setEditingPromo(null);
      setPromos(await listPromoCampaigns());
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save promotion"),
  });

  const promoToggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      togglePromoCampaign(id, active),
    onSuccess: (_, v) => {
      toast.success(v.active ? "Promo activated" : "Promo deactivated");
      void listPromoCampaigns().then(setPromos);
    },
  });

  const promoDeleteMut = useMutation({
    mutationFn: (id: string) => deletePromoCampaign(id),
    onSuccess: async () => {
      toast.success("Promotion deleted");
      setPromos(await listPromoCampaigns());
    },
  });

  return (
    <PermissionGate
      required={["promotions.view", "promotions.manage"]}
      breadcrumb={["Commerce", "Promotions & Loyalty"]}
      title="Promotions & Loyalty"
      description="Coupon promotions and the Points & Rewards programme — global defaults plus per-restaurant settings, synced live to the customer app."
      actions={
        <Badge variant="outline" className="gap-1.5 font-normal">
          <span
            className={`size-1.5 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}
          />
          {connected ? "Firebase live" : "Connecting…"}
        </Badge>
      }
    >
      {() => (
        <div className="space-y-4">
          {/* KPI strip */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={TicketCheck}
              label="Active promotions"
              value={String(kpis.activePromos)}
              sub={`${kpis.totalPromos} total coupons`}
              tone="text-primary"
            />
            <KpiCard
              icon={Receipt}
              label="Coupon redemptions"
              value={kpis.totalRedemptions.toLocaleString()}
              sub="All-time"
            />
            <KpiCard
              icon={Coins}
              label="Rewards programme"
              value={kpis.rewardsOn ? "Enabled" : "Disabled"}
              sub={
                kpis.rewardsOn
                  ? `${earnSummary(pointsConfig)} · ${kpis.redemptionPhrase}`
                  : "Customers earn nothing"
              }
              tone={kpis.rewardsOn ? "text-emerald-400" : "text-muted-foreground"}
            />
            <KpiCard
              icon={Building2}
              label="Custom restaurant rules"
              value={`${kpis.restaurantsWithOverride} of ${restaurants.length}`}
              sub="Restaurants with their own loyalty settings"
              tone="text-sky-400"
            />
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-auto flex-wrap gap-1">
              <TabsTrigger value="coupons">
                <TicketCheck className="mr-1.5 size-3.5" /> Coupon promos ({promos.length})
              </TabsTrigger>
              <TabsTrigger value="combos">
                <Layers className="mr-1.5 size-3.5" /> Combo deals ({combos.length})
              </TabsTrigger>
              <TabsTrigger value="points">
                <Globe className="mr-1.5 size-3.5" /> Global rewards
              </TabsTrigger>
              <TabsTrigger value="per-restaurant">
                <Coins className="mr-1.5 size-3.5" /> Per-restaurant rewards
              </TabsTrigger>
            </TabsList>

            {/* ---------------- COMBO DEALS ---------------- */}
            <TabsContent value="combos" className="mt-4">
              <ComboManager restaurants={restaurants} combos={combos} />
            </TabsContent>

            {/* ---------------- COUPONS ---------------- */}
            <TabsContent value="coupons" className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold">Coupon promotions</h3>
                  <p className="text-xs text-muted-foreground">
                    {promos.length} code{promos.length === 1 ? "" : "s"} — customers apply these at
                    checkout.
                  </p>
                </div>
                <Button onClick={() => setEditingPromo(newBlankPromo())}>
                  <Plus className="mr-1.5 size-4" /> New coupon
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {promos.map((p) => (
                  <Card key={p.id} className={p.is_active ? "" : "opacity-70"}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                            <Tag className="size-4" />
                            <span className="truncate">{p.name}</span>
                            <Badge variant="outline" className="font-mono">
                              {p.code}
                            </Badge>
                          </CardTitle>
                          <CardDescription className="mt-1">{p.description ?? "—"}</CardDescription>
                        </div>
                        <button
                          type="button"
                          onClick={() => promoToggleMut.mutate({ id: p.id, active: !p.is_active })}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Toggle"
                        >
                          {p.is_active ? (
                            <ToggleRight className="size-5 text-primary" />
                          ) : (
                            <ToggleLeft className="size-5" />
                          )}
                        </button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="flex flex-wrap gap-1.5">
                        <PromoValueBadge p={p} />
                        <Badge variant="secondary">Min order R {p.min_order}</Badge>
                        {p.max_discount != null && (
                          <Badge variant="secondary">Cap R {p.max_discount}</Badge>
                        )}
                        <Badge variant="secondary">{promoScopeLabel(p, restaurants)}</Badge>
                        {p.usage_limit != null && (
                          <Badge variant="secondary">
                            {p.usage_count} / {p.usage_limit}
                          </Badge>
                        )}
                        {!p.is_active && <Badge variant="destructive">Inactive</Badge>}
                        {new Date(p.expires_at) < new Date() && (
                          <Badge variant="destructive">Expired</Badge>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>
                          {new Date(p.starts_at).toLocaleDateString()} →{" "}
                          {new Date(p.expires_at).toLocaleDateString()}
                        </span>
                        <span>
                          {p.usage_count} redemption{p.usage_count === 1 ? "" : "s"}
                        </span>
                      </div>
                      <Separator />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          onClick={() => setEditingPromo(p)}
                        >
                          <Pencil className="mr-1 size-3" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Delete promo ${p.code}?`)) promoDeleteMut.mutate(p.id);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {promos.length === 0 && (
                  <Card className="col-span-full">
                    <CardContent className="py-12 text-center text-sm text-muted-foreground">
                      <TicketCheck className="mx-auto mb-2 size-8 opacity-40" />
                      No coupon promotions yet. Click <b>New coupon</b> to create one.
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            {/* ---------------- GLOBAL REWARDS ---------------- */}
            <TabsContent value="points" className="mt-4">
              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <div className="space-y-4">
                  {/* Programme control */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <SettingsIcon className="size-4 text-primary" /> Programme defaults
                      </CardTitle>
                      <CardDescription>
                        Applied to every restaurant unless it has custom rules on the Per-restaurant
                        tab.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      {/* Master switch */}
                      <div className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5">
                        <div>
                          <p className="text-sm font-medium">Enable Points &amp; Rewards</p>
                          <p className="text-[11px] text-muted-foreground">
                            When off, customers neither earn nor redeem. Balances are preserved.
                          </p>
                        </div>
                        <Switch
                          checked={pointsConfig.enabled}
                          onCheckedChange={(v) =>
                            setPointsConfig({
                              ...pointsConfig,
                              enabled: v,
                              redemption_enabled: v ? pointsConfig.redemption_enabled : false,
                            })
                          }
                        />
                      </div>

                      {/* Earning */}
                      <section className="space-y-3">
                        <h4 className="text-sm font-semibold">How customers earn</h4>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <MethodTile
                            icon={<Receipt className="size-4" />}
                            title="Per delivered order"
                            checked={
                              pointsConfig.method === "per_order" || pointsConfig.method === "both"
                            }
                            disabled={!pointsConfig.enabled}
                            onCheckedChange={(v) =>
                              setPointsConfig({
                                ...pointsConfig,
                                method: nextMethod("per_order", v === true, pointsConfig.method),
                              })
                            }
                          />
                          <MethodTile
                            icon={<Tag className="size-4" />}
                            title="Per menu item"
                            checked={
                              pointsConfig.method === "per_item" || pointsConfig.method === "both"
                            }
                            disabled={!pointsConfig.enabled}
                            onCheckedChange={(v) =>
                              setPointsConfig({
                                ...pointsConfig,
                                method: nextMethod("per_item", v === true, pointsConfig.method),
                              })
                            }
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <NumField
                            label="Points per order"
                            suffix="pts"
                            value={pointsConfig.points_per_order}
                            onChange={(n) =>
                              setPointsConfig({ ...pointsConfig, points_per_order: Math.max(0, n) })
                            }
                            disabled={
                              !pointsConfig.enabled ||
                              !(
                                pointsConfig.method === "per_order" ||
                                pointsConfig.method === "both"
                              )
                            }
                          />
                          <NumField
                            label="Points per item (default)"
                            suffix="pts"
                            value={pointsConfig.points_per_item_default}
                            onChange={(n) =>
                              setPointsConfig({
                                ...pointsConfig,
                                points_per_item_default: Math.max(0, n),
                              })
                            }
                            disabled={
                              !pointsConfig.enabled ||
                              !(
                                pointsConfig.method === "per_item" || pointsConfig.method === "both"
                              )
                            }
                          />
                        </div>
                      </section>

                      <Separator />

                      {/* Redemption */}
                      <section className="space-y-3">
                        <div className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5">
                          <div>
                            <p className="text-sm font-medium">Allow points discount at checkout</p>
                            <p className="text-[11px] text-muted-foreground">
                              Customers with enough points unlock a percentage off their order.
                            </p>
                          </div>
                          <Switch
                            checked={pointsConfig.redemption_enabled}
                            disabled={!pointsConfig.enabled}
                            onCheckedChange={(v) =>
                              setPointsConfig({ ...pointsConfig, redemption_enabled: v })
                            }
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <NumField
                            label="Points required"
                            suffix="pts"
                            min={1}
                            value={pointsConfig.points_required}
                            onChange={(n) =>
                              setPointsConfig({ ...pointsConfig, points_required: Math.max(1, n) })
                            }
                            disabled={!pointsConfig.enabled || !pointsConfig.redemption_enabled}
                          />
                          <NumField
                            label="Discount"
                            suffix="%"
                            max={100}
                            value={pointsConfig.discount_percent}
                            onChange={(n) =>
                              setPointsConfig({
                                ...pointsConfig,
                                discount_percent: Math.min(100, Math.max(0, n)),
                              })
                            }
                            disabled={!pointsConfig.enabled || !pointsConfig.redemption_enabled}
                          />
                        </div>
                      </section>

                      <div className="flex justify-end border-t pt-4">
                        <Button
                          onClick={() =>
                            pointsSaveMut.mutate({
                              enabled: pointsConfig.enabled,
                              method: pointsConfig.method,
                              points_per_order: pointsConfig.points_per_order,
                              points_per_item_default: pointsConfig.points_per_item_default,
                              redemption_enabled: pointsConfig.redemption_enabled,
                              points_required: pointsConfig.points_required,
                              discount_percent: pointsConfig.discount_percent,
                            })
                          }
                          disabled={pointsSaveMut.isPending}
                        >
                          {pointsSaveMut.isPending ? (
                            <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
                          ) : (
                            <Save className="mr-1.5 size-3.5" />
                          )}
                          Save global rewards
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Live preview */}
                <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
                  <RewardsPreview
                    cfg={globalEffective}
                    title="Global programme"
                    subtitle="Live preview of the platform defaults"
                  />
                </div>
              </div>
            </TabsContent>

            {/* ---------------- PER-RESTAURANT ---------------- */}
            <TabsContent value="per-restaurant" className="mt-4 space-y-4">
              {/* Restaurant dropdown — nothing selected by default */}
              <div className="w-full max-w-md space-y-1.5">
                <Label htmlFor="rr-picker" className="text-xs font-medium">
                  Restaurant
                </Label>
                <div className="flex gap-2">
                  <Select
                    value={selectedRestaurantId ?? ""}
                    onValueChange={(v) => setSelectedRestaurantId(v)}
                  >
                    <SelectTrigger id="rr-picker" className="flex-1">
                      <SelectValue placeholder="No restaurant selected — choose one…" />
                    </SelectTrigger>
                    <SelectContent>
                      {restaurants.map((r) => {
                        const o = overrides.find((x) => x.restaurant_id === r.id);
                        return (
                          <SelectItem key={r.id} value={r.id}>
                            <span className="truncate">{r.name}</span>
                            <span className="ml-2 text-[10px] text-muted-foreground">
                              {o ? "custom rules" : "global defaults"}
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
                  {selectedRestaurantId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setSelectedRestaurantId(null)}
                      aria-label="Clear selection"
                      title="Clear selection"
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Choose a restaurant to view or change its rewards. Each restaurant can run a
                  completely different points &amp; rewards programme.
                </p>
              </div>

              {/* Shared editor */}
              {selectedRestaurant ? (
                <RestaurantRewardsEditor
                  key={selectedRestaurant.id}
                  restaurantId={selectedRestaurant.id}
                  restaurantName={selectedRestaurant.name}
                  global={pointsConfig}
                  override={selectedOverride}
                  onChanged={refreshOverrides}
                />
              ) : (
                <Card className="border-dashed">
                  <CardContent className="py-14 text-center">
                    <Store className="mx-auto mb-3 size-9 text-muted-foreground/40" />
                    <p className="text-sm font-medium">No restaurant selected</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pick a restaurant from the dropdown above to manage its rewards.
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>

          {/* Coupon editor modal */}
          {editingPromo && (
            <CouponEditor
              restaurants={restaurants}
              initial={editingPromo}
              onClose={() => setEditingPromo(null)}
              onSave={(data) => promoSaveMut.mutate(data)}
              isSaving={promoSaveMut.isPending}
            />
          )}
        </div>
      )}
    </PermissionGate>
  );
}

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                          */
/* ------------------------------------------------------------------ */

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-muted p-2">
          <Icon className={`size-4 ${tone ?? "text-primary"}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className={`text-lg font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
          {sub && <p className="truncate text-[10px] text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function MethodTile({
  icon,
  title,
  checked,
  disabled,
  onCheckedChange,
}: {
  icon: React.ReactNode;
  title: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (v: boolean | "indeterminate") => void;
}) {
  return (
    <label
      className={`flex items-center gap-2.5 rounded-lg border p-3 text-sm font-medium transition ${
        checked ? "border-primary/25 bg-primary/[0.04]" : "border-border/60"
      } ${disabled ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
    >
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
      <span className="flex items-center gap-1.5">
        {icon}
        {title}
      </span>
    </label>
  );
}

function NumField({
  label,
  suffix,
  value,
  onChange,
  disabled,
  min = 0,
  max,
}: {
  label: string;
  suffix: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">
        {label} <span className="text-muted-foreground">({suffix})</span>
      </Label>
      <Input
        type="number"
        min={min}
        max={max}
        step="1"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="font-mono"
      />
    </div>
  );
}

/** Human label for a coupon's restaurant scope, e.g. "All restaurants",
 *  "First order only", or "Nando's, KFC +2 more". */
function promoScopeLabel(p: PromoCampaign, restaurants: { id: string; name: string }[]): string {
  if (p.scope === "platform") return "All restaurants";
  if (p.scope === "first_order") return "First order only";
  const names = promoRestaurantIds(p).map(
    (id) => restaurants.find((r) => r.id === id)?.name ?? "Unknown",
  );
  if (names.length === 0) return "No restaurants selected";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
}

function PromoValueBadge({ p }: { p: PromoCampaign }) {
  const info = TYPE_LABELS[p.type];
  const text =
    p.type === "percent"
      ? `${p.value}${info.suffix}`
      : p.type === "fixed"
        ? `R${p.value} off`
        : info.label;
  return (
    <Badge className="gap-1.5">
      <info.icon className="size-3" />
      {text}
    </Badge>
  );
}

function newBlankPromo(): PromoCampaign {
  const ts = new Date().toISOString();
  return {
    id: "",
    code: "",
    name: "",
    description: "",
    type: "percent",
    value: 10,
    scope: "platform",
    restaurant_id: null,
    restaurant_ids: null,
    min_order: 0,
    max_discount: null,
    usage_limit: null,
    usage_count: 0,
    starts_at: ts,
    expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
    is_active: true,
    applies_to: "all",
    created_at: ts,
    updated_at: ts,
    created_by: null,
  };
}

/* ------------------------------------------------------------------ */
/* Coupon Editor Modal                                                 */
/* ------------------------------------------------------------------ */

function CouponEditor({
  restaurants,
  initial,
  onClose,
  onSave,
  isSaving,
}: {
  restaurants: { id: string; name: string }[];
  initial: PromoCampaign;
  onClose: () => void;
  onSave: (data: Parameters<typeof savePromoCampaign>[0]) => void;
  isSaving: boolean;
}) {
  const [code, setCode] = useState(initial.code);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [type, setType] = useState<PromoType>(initial.type);
  const [value, setValue] = useState(String(initial.value));
  const [scope, setScope] = useState(initial.scope);
  const [restaurantIds, setRestaurantIds] = useState<string[]>(() => promoRestaurantIds(initial));
  const [minOrder, setMinOrder] = useState(String(initial.min_order));
  const [maxDiscount, setMaxDiscount] = useState(
    initial.max_discount == null ? "" : String(initial.max_discount),
  );
  const [usageLimit, setUsageLimit] = useState(
    initial.usage_limit == null ? "" : String(initial.usage_limit),
  );
  const [startsAt, setStartsAt] = useState(initial.starts_at.slice(0, 10));
  const [expiresAt, setExpiresAt] = useState(initial.expires_at.slice(0, 10));
  const [isActive, setIsActive] = useState(initial.is_active);

  function toggleRestaurant(rid: string) {
    setRestaurantIds((prev) =>
      prev.includes(rid) ? prev.filter((x) => x !== rid) : [...prev, rid],
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      toast.error("Code and name are required");
      return;
    }
    if (scope === "restaurant" && restaurantIds.length === 0) {
      toast.error(
        'Check at least one restaurant this coupon applies to, or select "All restaurants".',
      );
      return;
    }
    const payload: Parameters<typeof onSave>[0] = {
      code: code.toUpperCase(),
      name,
      description: description || null,
      type,
      value: Number(value) || 0,
      scope,
      restaurant_ids: scope === "restaurant" ? restaurantIds : null,
      min_order: Number(minOrder) || 0,
      max_discount: maxDiscount === "" ? null : Number(maxDiscount),
      usage_limit: usageLimit === "" ? null : Number(usageLimit),
      starts_at: new Date(startsAt).toISOString(),
      expires_at: new Date(expiresAt + "T23:59:59").toISOString(),
      is_active: isActive,
    };
    if (initial.id) payload.id = initial.id;
    onSave(payload);
  }

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
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <BadgePercent className="size-4 text-primary" />
              {initial.id ? "Edit promotion" : "New promotion"}
            </h3>
            <Button type="button" variant="ghost" size="icon" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Code</Label>
                <Input
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="SUMMER25"
                  className="font-mono uppercase"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Summer sale"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Description</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short description shown to customers"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={type} onValueChange={(v) => setType(v as PromoType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent off</SelectItem>
                    <SelectItem value="fixed">Fixed amount off</SelectItem>
                    <SelectItem value="free_delivery">Free delivery</SelectItem>
                    <SelectItem value="bogo">Buy-one-get-one</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {type !== "free_delivery" && type !== "bogo" && (
                <div className="space-y-1.5">
                  <Label>Value ({type === "percent" ? "%" : "R"})</Label>
                  <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Scope</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="platform">All restaurants</SelectItem>
                    <SelectItem value="restaurant">Specific restaurants</SelectItem>
                    <SelectItem value="first_order">First order only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {scope === "restaurant" ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Applies to (check restaurants)</Label>
                  <div className="overflow-hidden rounded-lg border">
                    <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs">
                      <span className="text-muted-foreground">
                        {restaurantIds.length} of {restaurants.length} selected
                      </span>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          className="font-medium text-primary hover:underline disabled:no-underline disabled:opacity-50"
                          onClick={() => setRestaurantIds(restaurants.map((r) => r.id))}
                          disabled={restaurants.length === 0}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground hover:underline disabled:no-underline disabled:opacity-50"
                          onClick={() => setRestaurantIds([])}
                          disabled={restaurantIds.length === 0}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="max-h-44 space-y-0.5 overflow-y-auto p-1.5">
                      {restaurants.map((r) => {
                        const checked = restaurantIds.includes(r.id);
                        return (
                          <label
                            key={r.id}
                            className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition ${
                              checked ? "bg-primary/[0.06]" : "hover:bg-muted/50"
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleRestaurant(r.id)}
                            />
                            <span className="truncate">{r.name}</span>
                          </label>
                        );
                      })}
                      {restaurants.length === 0 && (
                        <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                          No restaurants in Firebase yet.
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    The coupon only works at the checked restaurants — at least one required.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="invisible">Hint</Label>
                  <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    {scope === "platform"
                      ? "Valid at every restaurant on the platform."
                      : "Valid at every restaurant, for customers on their first order."}
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Min order (R)</Label>
                <Input
                  type="number"
                  value={minOrder}
                  onChange={(e) => setMinOrder(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Max discount (R, optional)</Label>
                <Input
                  type="number"
                  value={maxDiscount}
                  onChange={(e) => setMaxDiscount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Usage limit (optional)</Label>
                <Input
                  type="number"
                  value={usageLimit}
                  onChange={(e) => setUsageLimit(e.target.value)}
                />
              </div>
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
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Switch checked={isActive} onCheckedChange={setIsActive} />
                Publish immediately
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t bg-muted/30 px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1.5 size-3.5" />
              )}
              {initial.id ? "Save changes" : "Create promotion"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
