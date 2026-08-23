// Professional mock of the customer-app rewards wallet, driven by a resolved
// points config. Shared by the global programme editor and the per-restaurant
// override editor — style it once, use it everywhere.

import { Coins, Gift, Receipt, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { EffectivePointsConfig } from "@/lib/loyalty";

const EXAMPLE_ITEMS = 4;
const EXAMPLE_ORDER_VALUE = 300;

/**
 * Renders what diners will see in the app: a points balance, progress toward
 * the redemption threshold, and the example saving at checkout.
 */
export function RewardsPreview({
  cfg,
  title = "Customer app preview",
  subtitle,
}: {
  cfg: EffectivePointsConfig;
  title?: string;
  subtitle?: string;
}) {
  const rewardsOff = !cfg.enabled || cfg.rewards_disabled_for_restaurant;

  const earnsPerOrder = cfg.method === "per_order" || cfg.method === "both";
  const earnsPerItem = cfg.method === "per_item" || cfg.method === "both";
  const perOrderEarn =
    (earnsPerOrder ? cfg.points_per_order : 0) +
    (earnsPerItem ? cfg.points_per_item_default * EXAMPLE_ITEMS : 0);

  const canRedeem = !rewardsOff && cfg.redemption_enabled;
  // Mock balance: partway to the threshold so the progress bar is meaningful.
  const mockBalance = canRedeem ? Math.round(cfg.points_required * 0.65) : perOrderEarn * 3;
  const progressPct = canRedeem
    ? Math.min(100, Math.round((mockBalance / Math.max(1, cfg.points_required)) * 100))
    : 0;
  const discountAmt = canRedeem ? Math.round(EXAMPLE_ORDER_VALUE * cfg.discount_percent) / 100 : 0;

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Coins className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {subtitle ?? "How diners see rewards based on these settings"}
            </p>
          </div>
        </div>
        <Badge
          variant={rewardsOff ? "secondary" : "default"}
          className="shrink-0 gap-1.5 text-[10px]"
        >
          <span
            className={`size-1.5 rounded-full ${
              rewardsOff ? "bg-muted-foreground" : "bg-primary-foreground"
            }`}
          />
          {rewardsOff ? "Off" : "Live"}
        </Badge>
      </div>

      {rewardsOff ? (
        <div className="px-4 py-8 text-center">
          <Coins className="mx-auto mb-2 size-6 text-muted-foreground/40" />
          <p className="text-sm font-medium">Rewards are off</p>
          <p className="mx-auto mt-0.5 max-w-52 text-xs text-muted-foreground">
            Customers earn no points and see no rewards wallet while this is off.
          </p>
        </div>
      ) : (
        <div className="space-y-4 px-4 py-4">
          {/* Balance + progress */}
          <div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Points balance
                </p>
                <p className="metric-figure mt-0.5 text-3xl font-bold">
                  {mockBalance.toLocaleString()}
                  <span className="ml-1 text-sm font-medium text-muted-foreground">pts</span>
                </p>
              </div>
              {canRedeem && (
                <p className="text-right text-[11px] leading-tight text-muted-foreground">
                  of <b className="text-foreground">{cfg.points_required.toLocaleString()}</b>{" "}
                  needed
                  <br />
                  for next reward
                </p>
              )}
            </div>
            {canRedeem && (
              <div className="mt-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  <Gift className="mr-1 inline size-3 -translate-y-px text-primary" />
                  At {cfg.points_required.toLocaleString()} pts unlocks{" "}
                  <b className="text-foreground">{cfg.discount_percent}% off</b> an order.
                </p>
              </div>
            )}
          </div>

          {/* Earning rates */}
          <div className="grid grid-cols-2 gap-2">
            <EarnTile
              icon={<Receipt className="size-3.5" />}
              label="Per delivered order"
              value={earnsPerOrder ? `+${cfg.points_per_order} pts` : "—"}
              active={earnsPerOrder}
            />
            <EarnTile
              icon={<Tag className="size-3.5" />}
              label="Per menu item"
              value={earnsPerItem ? `+${cfg.points_per_item_default} pts` : "—"}
              active={earnsPerItem}
            />
          </div>

          {/* Example checkout */}
          {canRedeem && (
            <>
              <Separator />
              <div className="space-y-1.5 text-xs">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Example order with reward applied
                </p>
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal ({EXAMPLE_ITEMS} items)</span>
                  <span className="tabular-nums">R {EXAMPLE_ORDER_VALUE.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-emerald-500">
                  <span>Points discount ({cfg.discount_percent}%)</span>
                  <span className="tabular-nums">− R {discountAmt.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t border-dashed pt-1.5 font-semibold">
                  <span>Customer pays</span>
                  <span className="tabular-nums">
                    R {(EXAMPLE_ORDER_VALUE - discountAmt).toFixed(2)}
                  </span>
                </div>
              </div>
            </>
          )}

          <p className="text-[10px] leading-tight text-muted-foreground/80">
            An average {EXAMPLE_ITEMS}-item order earns ≈{perOrderEarn.toLocaleString()} pts under
            these rules.
          </p>
        </div>
      )}
    </div>
  );
}

function EarnTile({
  icon,
  label,
  value,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 transition ${
        active ? "border-primary/25 bg-primary/5" : "border-border/60 opacity-60"
      }`}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </p>
      <p
        className={`mt-1 metric-figure text-lg font-bold tabular-nums ${active ? "text-primary" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
