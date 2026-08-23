// Shared Points & Rewards domain logic.
//
// Single source of truth for loyalty helpers used by every screen
// (Promotions & Loyalty page AND the restaurant profile). The merge rule
// itself lives in promotions.firebase.ts (`resolveEffectivePointsConfig`) —
// never re-implement it elsewhere.

import {
  resolveEffectivePointsConfig,
  saveRestaurantPointsOverride,
  type GlobalPointsConfig,
  type RestaurantPointsOverride,
} from "@/lib/promotions.firebase";

export type PointsMethod = GlobalPointsConfig["method"];

export type EffectivePointsConfig = GlobalPointsConfig & {
  rewards_disabled_for_restaurant: boolean;
};

export function methodLabel(m: PointsMethod): string {
  return m === "both"
    ? "Per order + per item"
    : m === "per_order"
      ? "Per order"
      : m === "per_item"
        ? "Per item"
        : "None";
}

/** Toggle one half of the earning method (per-order / per-item), folding the
 *  pair down into the serialised method enum. */
export function nextMethod(
  toggled: "per_order" | "per_item",
  checked: boolean,
  current: PointsMethod,
): PointsMethod {
  const hasOrder = current === "per_order" || current === "both";
  const hasItem = current === "per_item" || current === "both";
  const nextOrder = toggled === "per_order" ? checked : hasOrder;
  const nextItem = toggled === "per_item" ? checked : hasItem;
  if (nextOrder && nextItem) return "both";
  if (nextOrder) return "per_order";
  if (nextItem) return "per_item";
  return "none";
}

/** Short human summary of what a resolved config earns, e.g.
 *  "10 pts / order + 5 pts / item". Used in list rows, previews and toasts. */
export function earnSummary(cfg: {
  enabled: boolean;
  method: PointsMethod;
  points_per_order: number;
  points_per_item_default: number;
}): string {
  if (!cfg.enabled || cfg.method === "none") return "No earning";
  const parts: string[] = [];
  if (cfg.method === "per_order" || cfg.method === "both") {
    parts.push(`${cfg.points_per_order} pts / order`);
  }
  if (cfg.method === "per_item" || cfg.method === "both") {
    parts.push(`${cfg.points_per_item_default} pts / item`);
  }
  return parts.join(" + ");
}

/* ------------------------------------------------------------------ */
/* Per-restaurant override draft model                                 */
/*                                                                     */
/* Every field starts in "inherit global" mode. Toggling a field to    */
/* Custom stores an explicit value on the restaurant's override        */
/* record; toggling back removes it so the global config applies.      */
/* ------------------------------------------------------------------ */

export interface RestaurantRewardsDraft {
  enabled: boolean;
  method: PointsMethod;
  points_per_order: number;
  points_per_item_default: number;
  redemption_enabled: boolean;
  points_required: number;
  discount_percent: number;
  // `true` = inherit the global value (nothing stored on the override).
  use_global_enabled: boolean;
  use_global_method: boolean;
  use_global_ppo: boolean;
  use_global_ppi: boolean;
  use_global_redemption: boolean;
  use_global_req: boolean;
  use_global_pct: boolean;
}

export function draftFromGlobal(
  g: GlobalPointsConfig,
  o: RestaurantPointsOverride | null | undefined,
): RestaurantRewardsDraft {
  return {
    enabled: o?.enabled ?? g.enabled,
    method: o?.method ?? g.method,
    points_per_order: o?.points_per_order ?? g.points_per_order,
    points_per_item_default: o?.points_per_item_default ?? g.points_per_item_default,
    redemption_enabled: o?.redemption_enabled ?? g.redemption_enabled,
    points_required: o?.points_required ?? g.points_required,
    discount_percent: o?.discount_percent ?? g.discount_percent,
    use_global_enabled: !o || typeof o.enabled !== "boolean",
    use_global_method: !o || o.method == null,
    use_global_ppo: !o || o.points_per_order == null,
    use_global_ppi: !o || o.points_per_item_default == null,
    use_global_redemption: !o || o.redemption_enabled == null,
    use_global_req: !o || o.points_required == null,
    use_global_pct: !o || o.discount_percent == null,
  };
}

/** Convert a draft into the payload accepted by saveRestaurantPointsOverride.
 *  Inherited fields are sent as null so nothing is persisted for them. */
export function draftToOverrideInput(
  d: RestaurantRewardsDraft,
): Parameters<typeof saveRestaurantPointsOverride>[0] {
  return {
    restaurant_id: "", // caller fills this in
    enabled: d.use_global_enabled ? null : d.enabled,
    method: d.use_global_method ? null : d.method,
    points_per_order: d.use_global_ppo ? null : d.points_per_order,
    points_per_item_default: d.use_global_ppi ? null : d.points_per_item_default,
    redemption_enabled: d.use_global_redemption ? null : d.redemption_enabled,
    points_required: d.use_global_req ? null : d.points_required,
    discount_percent: d.use_global_pct ? null : d.discount_percent,
  };
}

/** What the customer app will actually use for this restaurant, computed
 *  through the canonical merge in promotions.firebase. */
export function draftEffective(
  d: RestaurantRewardsDraft,
  g: GlobalPointsConfig,
): EffectivePointsConfig {
  const asOverride: RestaurantPointsOverride = {
    restaurant_id: "",
    enabled: d.use_global_enabled ? true : d.enabled,
    method: d.use_global_method ? null : d.method,
    points_per_order: d.use_global_ppo ? null : d.points_per_order,
    points_per_item_default: d.use_global_ppi ? null : d.points_per_item_default,
    redemption_enabled: d.use_global_redemption ? null : d.redemption_enabled,
    points_required: d.use_global_req ? null : d.points_required,
    discount_percent: d.use_global_pct ? null : d.discount_percent,
    updated_at: "",
    updated_by: null,
  };
  // `rewards_disabled_for_restaurant` only makes sense when the user
  // explicitly opted out — inheriting is never a local disable.
  const merged = resolveEffectivePointsConfig(g, asOverride);
  return {
    ...merged,
    rewards_disabled_for_restaurant: !d.use_global_enabled && !d.enabled,
  };
}
