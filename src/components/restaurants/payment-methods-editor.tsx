// Reusable per-restaurant payment options editor.
//
// Rendered on each restaurant's profile page (Payments tab). Operators toggle
// which payment methods customers are offered at checkout; the customer app
// reads /restaurants/{id}/payment_config live.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Banknote,
  CreditCard,
  Landmark,
  Loader2,
  RefreshCw,
  Save,
  ShoppingBag,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  PAYMENT_METHOD_CATALOG,
  savePaymentConfig,
  type PaymentMethodId,
  type PaymentMethodSetting,
  type RestaurantPaymentConfig,
} from "@/lib/payments.firebase";

const METHOD_ICONS: Record<PaymentMethodId, typeof CreditCard> = {
  card: CreditCard,
  cash_on_delivery: Banknote,
  cash_on_pickup: ShoppingBag,
  eft: Landmark,
};

export function PaymentMethodsEditor({
  restaurantId,
  restaurantName,
  config,
  canManage = true,
  onChanged,
}: {
  restaurantId: string;
  restaurantName?: string;
  config: RestaurantPaymentConfig;
  /** When false, all controls render read-only. */
  canManage?: boolean;
  /** Called after a successful save so parents can refresh caches. */
  onChanged?: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<PaymentMethodId, PaymentMethodSetting>>(config.methods);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-derive the draft when the saved config changes remotely — but never
  // clobber unsaved edits.
  const lastSavedAt = useRef<string>(config.updated_at);
  useEffect(() => {
    if (lastSavedAt.current === config.updated_at) return;
    lastSavedAt.current = config.updated_at;
    if (!dirty) setDraft(config.methods);
  }, [config, dirty]);

  const setMethod = (id: PaymentMethodId, patch: Partial<PaymentMethodSetting>) => {
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
    setDirty(true);
  };

  const enabledCount = PAYMENT_METHOD_CATALOG.filter(({ id }) => draft[id].enabled).length;
  const enabledLabels = PAYMENT_METHOD_CATALOG.filter(({ id }) => draft[id].enabled).map(
    (m) => m.label,
  );

  const save = async () => {
    if (enabledCount === 0) {
      toast.error("Enable at least one payment method — customers must be able to pay.");
      return;
    }
    setSaving(true);
    try {
      await savePaymentConfig({
        restaurant_id: restaurantId,
        methods: draft,
        updated_by: null,
      });
      setDirty(false);
      toast.success("Payment options saved — live in the customer app.");
      await onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save payment options.");
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(config.methods);
    setDirty(false);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="size-4" /> Payment options
          </CardTitle>
          <CardDescription>
            Choose how customers can pay{restaurantName ? ` at ${restaurantName}` : ""}. Only
            enabled methods appear at checkout, and only for the order types they support. Changes
            sync to the customer app within ~1 second.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {PAYMENT_METHOD_CATALOG.map((method) => {
            const Icon = METHOD_ICONS[method.id];
            const state = draft[method.id];
            return (
              <div
                key={method.id}
                className={`rounded-lg border p-4 transition-colors ${
                  state.enabled ? "border-primary/35 bg-primary/[0.04]" : "border-border"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md ${
                      state.enabled
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="size-4.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{method.label}</p>
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {method.applies_to.length === 2
                          ? "Delivery & pickup"
                          : method.applies_to[0] === "delivery"
                            ? "Delivery orders only"
                            : "Pickup orders only"}
                      </Badge>
                      {state.enabled && (
                        <Badge className="bg-emerald-600 text-[10px]">Enabled</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{method.description}</p>
                    {state.enabled && canManage && (
                      <Input
                        className="mt-2.5 h-8 max-w-md text-xs"
                        placeholder="Optional customer note — e.g. Please have exact change ready"
                        value={state.instructions ?? ""}
                        onChange={(e) =>
                          setMethod(method.id, { instructions: e.target.value || null })
                        }
                      />
                    )}
                    {state.enabled && !canManage && state.instructions && (
                      <p className="mt-1.5 text-xs italic text-muted-foreground">
                        “{state.instructions}”
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={state.enabled}
                    disabled={!canManage}
                    onCheckedChange={(checked) => setMethod(method.id, { enabled: checked })}
                    aria-label={`${method.label} enabled`}
                  />
                </div>
              </div>
            );
          })}

          {canManage && (
            <>
              <Separator />
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={save} disabled={!dirty || saving} className="gap-2">
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save payment options
                </Button>
                <Button variant="ghost" onClick={discard} disabled={!dirty || saving}>
                  <RefreshCw className="mr-1.5 size-3.5" /> Discard changes
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {enabledCount} of {PAYMENT_METHOD_CATALOG.length} methods enabled
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">What customers see</CardTitle>
          <CardDescription>
            Live result of your toggles, exactly as offered at checkout.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {(["delivery", "pickup"] as const).map((orderType) => {
            const offered = PAYMENT_METHOD_CATALOG.filter(
              ({ id, applies_to }) => draft[id].enabled && applies_to.includes(orderType),
            );
            return (
              <div key={orderType} className="rounded-md border border-border p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {orderType === "delivery" ? "Delivery orders" : "Customer pickup orders"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {offered.length > 0 ? (
                    offered.map((m) => (
                      <Badge key={m.id} variant="secondary" className="font-normal">
                        {m.label}
                        {draft[m.id].instructions ? "*" : ""}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-destructive">No payment method offered</span>
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            * shows your customer note next to the method at checkout.
          </p>
          <Separator />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Customer app path
            </p>
            <p className="mt-1 rounded bg-muted px-2 py-1 font-mono text-[11px]">
              /restaurants/{restaurantId}/payment_config
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
