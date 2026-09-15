// Reusable per-restaurant Points & Rewards editor.
//
// Rendered in two places: the Promotions & Loyalty "Per-restaurant" tab and
// each restaurant's profile page (Points & Rewards tab). One implementation —
// the restaurant picker, inheritance chips and live preview are shared.

import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  CheckCircle2,
  Globe,
  Info,
  Receipt,
  RefreshCw,
  Save,
  Store,
  Tag,
  Trash2,
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
  deleteRestaurantPointsOverride,
  saveRestaurantPointsOverride,
  type GlobalPointsConfig,
  type RestaurantPointsOverride,
} from "@/lib/promotions.firebase";
import {
  draftEffective,
  draftFromGlobal,
  earnSummary,
  methodLabel,
  nextMethod,
  type RestaurantRewardsDraft,
} from "@/lib/loyalty";
import { RewardsPreview } from "@/components/loyalty/rewards-preview";

export function RestaurantRewardsEditor({
  restaurantId,
  restaurantName,
  global,
  override,
  canManage = true,
  onChanged,
  backLink,
}: {
  restaurantId: string;
  restaurantName?: string;
  global: GlobalPointsConfig;
  override: RestaurantPointsOverride | null;
  /** When false, all controls render read-only. */
  canManage?: boolean;
  /** Called after a successful save/reset so parents can refresh caches. */
  onChanged?: () => void | Promise<void>;
  /** Optional link shown under the header (e.g. back to the restaurant). */
  backLink?: React.ReactNode;
}) {
  const [draft, setDraft] = useState<RestaurantRewardsDraft>(() =>
    draftFromGlobal(global, override),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Re-derive the draft when the restaurant/global/override changes — but
  // never clobber unsaved edits.
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    const key = `${restaurantId}:${global.updated_at}:${override?.updated_at ?? ""}`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    if (!dirty) {
      setDraft(draftFromGlobal(global, override));
    }
  }, [restaurantId, global, override, dirty]);

  const update = (patch: Partial<RestaurantRewardsDraft>) => {
    setDirty(true);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const eff = draftEffective(draft, global);
  const earnsPerOrder = eff.method === "per_order" || eff.method === "both";
  const earnsPerItem = eff.method === "per_item" || eff.method === "both";
  const hasOverride = !!override;

  async function handleSave() {
    if (draft.points_per_order < 0 || draft.points_per_item_default < 0) {
      toast.error("Point values cannot be negative");
      return;
    }
    if (draft.discount_percent < 0 || draft.discount_percent > 100) {
      toast.error("Discount must be between 0 and 100%");
      return;
    }
    setSaving(true);
    try {
      await saveRestaurantPointsOverride({
        restaurant_id: restaurantId,
        enabled: draft.use_global_enabled ? null : draft.enabled,
        method: draft.use_global_method ? null : draft.method,
        points_per_order: draft.use_global_ppo ? null : draft.points_per_order,
        points_per_item_default: draft.use_global_ppi ? null : draft.points_per_item_default,
        redemption_enabled: draft.use_global_redemption ? null : draft.redemption_enabled,
        points_required: draft.use_global_req ? null : draft.points_required,
        discount_percent: draft.use_global_pct ? null : draft.discount_percent,
      });
      setDirty(false);
      toast.success(
        restaurantName ? `Rewards saved for ${restaurantName}` : "Restaurant rewards saved",
      );
      await onChanged?.();
    } catch (e) {
      toast.error((e as Error).message || "Failed to save rewards");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      await deleteRestaurantPointsOverride(restaurantId);
      setDirty(false);
      setDraft(draftFromGlobal(global, null));
      toast.success("Custom rules removed — global settings apply");
      await onChanged?.();
    } catch (e) {
      toast.error((e as Error).message || "Failed to reset");
    } finally {
      setResetting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              {restaurantName ? (
                <>
                  <Store className="size-4 shrink-0 text-primary" />
                  <span className="truncate">{restaurantName}</span>
                </>
              ) : (
                "Restaurant rewards"
              )}
              <Badge
                variant={hasOverride ? "default" : "secondary"}
                className="shrink-0 text-[10px]"
              >
                {hasOverride ? "Custom rules" : "Inherits global"}
              </Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              Set a different points and rewards programme for this restaurant, or leave any setting
              on <b>Global</b> to inherit the platform default.
            </CardDescription>
            {backLink}
          </div>
          {canManage && (
            <div className="flex shrink-0 gap-2">
              {hasOverride && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={handleReset}
                  disabled={resetting || saving}
                >
                  {resetting ? (
                    <RefreshCw className="mr-1 size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1 size-3.5" />
                  )}
                  Reset to global
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={!dirty || saving || resetting}
              >
                {saving ? (
                  <RefreshCw className="mr-1 size-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1 size-3.5" />
                )}
                {dirty ? "Save changes" : "Saved"}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {!global.enabled && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <p>
              The global rewards master switch is off, so no restaurant earns points yet. Enable it
              under{" "}
              <Link to="/promotions" className="font-medium underline underline-offset-2">
                Promotions &amp; Loyalty
              </Link>{" "}
              for these settings to take effect.
            </p>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          {/* ------- settings column ------- */}
          <div className="space-y-5">
            {/* Master enable */}
            <InheritRow
              label="Rewards enabled"
              description="Earn and redeem for orders at this restaurant."
              inherit={draft.use_global_enabled}
              globalLabel={global.enabled ? "Global: On" : "Global: Off"}
              onToggleInherit={
                canManage
                  ? () => update({ use_global_enabled: !draft.use_global_enabled })
                  : undefined
              }
              control={
                <Switch
                  checked={draft.enabled}
                  disabled={!canManage}
                  onCheckedChange={(v) =>
                    update({
                      use_global_enabled: false,
                      enabled: v,
                      redemption_enabled: v ? draft.redemption_enabled : false,
                    })
                  }
                />
              }
            />

            <Separator />

            {/* Earning */}
            <section className="space-y-3">
              <SectionHead
                title="Earning"
                inherit={draft.use_global_method}
                globalLabel={methodLabel(global.method)}
                onToggleInherit={
                  canManage
                    ? () => update({ use_global_method: !draft.use_global_method })
                    : undefined
                }
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <MethodOption
                  icon={<Receipt className="size-4" />}
                  title="Per delivered order"
                  description="Flat points once per order."
                  checked={draft.method === "per_order" || draft.method === "both"}
                  disabled={!canManage || !eff.enabled}
                  onCheckedChange={(v) =>
                    update({
                      use_global_method: false,
                      method: nextMethod("per_order", v === true, draft.method),
                    })
                  }
                />
                <MethodOption
                  icon={<Tag className="size-4" />}
                  title="Per menu item"
                  description="Points for every item bought."
                  checked={draft.method === "per_item" || draft.method === "both"}
                  disabled={!canManage || !eff.enabled}
                  onCheckedChange={(v) =>
                    update({
                      use_global_method: false,
                      method: nextMethod("per_item", v === true, draft.method),
                    })
                  }
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <InheritNumberField
                  label="Points per order"
                  suffix="pts"
                  inherit={draft.use_global_ppo}
                  globalValue={global.points_per_order}
                  value={draft.points_per_order}
                  onToggleInherit={
                    canManage ? () => update({ use_global_ppo: !draft.use_global_ppo }) : undefined
                  }
                  onChange={(v) => update({ points_per_order: Math.max(0, v) })}
                  disabled={!canManage || !eff.enabled || !earnsPerOrder}
                />
                <InheritNumberField
                  label="Points per item (default)"
                  suffix="pts"
                  inherit={draft.use_global_ppi}
                  globalValue={global.points_per_item_default}
                  value={draft.points_per_item_default}
                  onToggleInherit={
                    canManage ? () => update({ use_global_ppi: !draft.use_global_ppi }) : undefined
                  }
                  onChange={(v) => update({ points_per_item_default: Math.max(0, v) })}
                  disabled={!canManage || !eff.enabled || !earnsPerItem}
                />
              </div>
            </section>

            <Separator />

            {/* Redemption */}
            <section className="space-y-3">
              <SectionHead title="Redemption" />
              <InheritRow
                label="Allow points discount at checkout"
                description="Enough points unlocks a percentage off the order."
                inherit={draft.use_global_redemption}
                globalLabel={global.redemption_enabled ? "Global: On" : "Global: Off"}
                onToggleInherit={
                  canManage
                    ? () => update({ use_global_redemption: !draft.use_global_redemption })
                    : undefined
                }
                control={
                  <Switch
                    checked={draft.redemption_enabled}
                    disabled={!canManage || !eff.enabled}
                    onCheckedChange={(v) =>
                      update({ use_global_redemption: false, redemption_enabled: v })
                    }
                  />
                }
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <InheritNumberField
                  label="Points required"
                  suffix="pts"
                  min={1}
                  inherit={draft.use_global_req}
                  globalValue={global.points_required}
                  value={draft.points_required}
                  onToggleInherit={
                    canManage ? () => update({ use_global_req: !draft.use_global_req }) : undefined
                  }
                  onChange={(v) => update({ points_required: Math.max(1, v) })}
                  disabled={!canManage || !eff.enabled || !eff.redemption_enabled}
                />
                <InheritNumberField
                  label="Discount"
                  suffix="%"
                  max={100}
                  inherit={draft.use_global_pct}
                  globalValue={global.discount_percent}
                  value={draft.discount_percent}
                  onToggleInherit={
                    canManage ? () => update({ use_global_pct: !draft.use_global_pct }) : undefined
                  }
                  onChange={(v) => update({ discount_percent: Math.min(100, Math.max(0, v)) })}
                  disabled={!canManage || !eff.enabled || !eff.redemption_enabled}
                />
              </div>
            </section>

            {/* Effective summary */}
            <div className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs">
              <CheckCircle2
                className={`mt-0.5 size-3.5 shrink-0 ${eff.enabled ? "text-emerald-500" : "text-muted-foreground"}`}
              />
              <p className="text-muted-foreground">
                <b className="text-foreground">Effective for this restaurant: </b>
                {!eff.enabled
                  ? "rewards off"
                  : `${earnSummary(eff)}${
                      eff.redemption_enabled
                        ? ` · ${eff.points_required.toLocaleString()} pts → ${eff.discount_percent}% off`
                        : " · no redemption"
                    }`}
              </p>
            </div>
          </div>

          {/* ------- preview column ------- */}
          <div className="space-y-3">
            <RewardsPreview
              cfg={eff}
              title={restaurantName ? `${restaurantName}` : "Customer app preview"}
              subtitle="Live preview of these exact rules"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Building blocks (inherit-chip pattern)                              */
/* ------------------------------------------------------------------ */

/** Small Global/Custom pill shown next to each setting. Clicking flips
 *  between inheriting the global value and storing a restaurant override. */
function InheritChip({
  inherit,
  onToggle,
  disabled,
}: {
  inherit: boolean;
  onToggle?: (() => void) | undefined;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled || !onToggle}
      title={
        inherit
          ? "Using the global value — click to customise"
          : "Custom value — click to inherit global"
      }
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
        inherit
          ? "border-border text-muted-foreground hover:text-foreground"
          : "border-primary/30 bg-primary/10 text-primary"
      } ${!onToggle ? "cursor-default" : ""}`}
    >
      <Globe className="size-2.5" />
      {inherit ? "Global" : "Custom"}
    </button>
  );
}

function InheritRow({
  label,
  description,
  inherit,
  globalLabel,
  onToggleInherit,
  control,
}: {
  label: string;
  description?: string;
  inherit: boolean;
  /** Shown on the chip when inheriting, e.g. "Global: On". */
  globalLabel: string;
  onToggleInherit?: (() => void) | undefined;
  /** The editable control shown when not inheriting. */
  control: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 transition ${
        inherit ? "border-border/60" : "border-primary/25 bg-primary/[0.04]"
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{label}</p>
          <InheritChip inherit={inherit} onToggle={onToggleInherit} />
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {inherit ? globalLabel : description}
        </p>
      </div>
      <div className={inherit ? "pointer-events-none shrink-0 opacity-50" : "shrink-0"}>
        {inherit ? (
          <Badge variant="secondary" className="text-[10px]">
            {globalLabel.replace("Global: ", "")}
          </Badge>
        ) : (
          control
        )}
      </div>
    </div>
  );
}

function SectionHead({
  title,
  inherit,
  globalLabel,
  onToggleInherit,
}: {
  title: string;
  inherit?: boolean;
  globalLabel?: string;
  onToggleInherit?: (() => void) | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      {inherit !== undefined && (
        <span className="inline-flex items-center gap-2">
          {inherit && globalLabel && (
            <span className="text-[10px] text-muted-foreground">{globalLabel}</span>
          )}
          <InheritChip inherit={inherit} onToggle={onToggleInherit} />
        </span>
      )}
    </div>
  );
}

function MethodOption({
  icon,
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (v: boolean | "indeterminate") => void;
}) {
  return (
    <label
      className={`flex items-start gap-2.5 rounded-lg border p-3 transition ${
        checked ? "border-primary/25 bg-primary/[0.04]" : "border-border/60"
      } ${disabled ? "pointer-events-none opacity-50" : "cursor-pointer"}`}
    >
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {title}
        </p>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}

function InheritNumberField({
  label,
  suffix,
  inherit,
  globalValue,
  value,
  onToggleInherit,
  onChange,
  disabled,
  min = 0,
  max,
}: {
  label: string;
  suffix: string;
  inherit: boolean;
  globalValue: number;
  value: number;
  onToggleInherit?: (() => void) | undefined;
  onChange: (v: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium">
          {label} <span className="text-muted-foreground">({suffix})</span>
        </Label>
        <InheritChip inherit={inherit} onToggle={onToggleInherit} />
      </div>
      <Input
        type="number"
        min={min}
        max={max}
        step="1"
        value={inherit ? globalValue : value}
        disabled={disabled || inherit}
        onFocus={() => {
          // Focusing an inherited field switches it to Custom so you can type.
          if (inherit && onToggleInherit && !disabled) {
            onToggleInherit();
            onChange(globalValue);
          }
        }}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          onChange(Math.max(min, max != null ? Math.min(max, n) : n));
        }}
        className={`font-mono ${inherit ? "text-muted-foreground" : ""}`}
      />
    </div>
  );
}
