// Payment receipt / proof-of-payment dialog for a single order.
//
// Shows the evidence record at /orders/{id}/payment (written by the customer
// app or by staff) together with the order breakdown. Cash payments that are
// still pending can be marked PAID here — the customer app sees the same
// record live, so both sides always show the same receipt.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BadgeCheck,
  Banknote,
  Clock3,
  CreditCard,
  ExternalLink,
  FileText,
  Landmark,
  Loader2,
  ShoppingBag,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { OrderTypeBadge } from "@/components/order-type-badge";
import {
  markOrderPaid,
  paymentMethodLabel,
  subscribeOrderPayment,
  synthesizePaymentEvidence,
  type OrderPaymentEvidence,
  type PaymentStatus,
} from "@/lib/payments.firebase";
import type { DispatchOrder } from "@/lib/dispatch.functions";

const money = (value: number) =>
  `R ${value.toLocaleString("en-ZA", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

const STATUS_TONE: Record<PaymentStatus, string> = {
  paid: "bg-emerald-600 text-white",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  failed: "bg-rose-600/15 text-rose-400 border-rose-500/30",
  refunded: "bg-slate-500/15 text-slate-300 border-slate-500/30",
};

export function PaymentReceiptDialog({
  order,
  canManage,
  onClose,
  onMarkedPaid,
}: {
  order: DispatchOrder | null;
  canManage: boolean;
  onClose: () => void;
  onMarkedPaid?: () => void | Promise<void>;
}) {
  const [evidence, setEvidence] = useState<OrderPaymentEvidence | null>(null);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    if (!order) return;
    setEvidence(null);
    return subscribeOrderPayment(order.id, setEvidence);
  }, [order]);

  if (!order) return null;

  const ev = evidence ?? synthesizePaymentEvidence(order);
  const MethodIcon =
    ev.method === "card"
      ? CreditCard
      : ev.method === "cash_on_pickup"
        ? ShoppingBag
        : ev.method === "eft"
          ? Landmark
          : Banknote;

  const markPaid = async () => {
    setMarking(true);
    try {
      await markOrderPaid({
        order_id: order.id,
        order_number: order.order_number,
        total: order.total,
        payment_method: order.payment_method,
        recorded_by: "console",
      });
      toast.success(`Payment recorded — ${ev.receipt_number} is now proof of payment.`);
      await onMarkedPaid?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the payment.");
    } finally {
      setMarking(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-4" /> Payment receipt
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{ev.receipt_number}</span>
            <span>·</span>
            <span>{order.order_number}</span>
            <OrderTypeBadge type={order.order_type} />
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate font-medium">{order.restaurant_name}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(order.placed_at).toLocaleString("en-ZA", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}{" "}
                · {order.customer_name}
              </p>
            </div>
          </div>

          <Separator />

          <div className="space-y-1">
            {order.items.map((item) => (
              <div key={item.id} className="flex justify-between gap-3 text-xs">
                <span className="truncate">
                  {item.quantity}× {item.item_name}
                </span>
                <span className="tabular-nums">{money(item.line_total)}</span>
              </div>
            ))}
          </div>

          <Separator />

          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">{money(order.subtotal)}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between text-emerald-400">
                <span>Discounts</span>
                <span className="tabular-nums">−{money(order.discount)}</span>
              </div>
            )}
            {order.order_type === "delivery" && (
              <div className="flex justify-between text-muted-foreground">
                <span>Delivery fee</span>
                <span className="tabular-nums">{money(order.delivery_fee)}</span>
              </div>
            )}
            {order.tip > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Tip</span>
                <span className="tabular-nums">{money(order.tip)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-sm font-semibold">
              <span>Total paid</span>
              <span className="tabular-nums">{money(ev.amount)}</span>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <MethodIcon className="size-4 text-muted-foreground" />
                {paymentMethodLabel(ev.method)}
              </span>
              <Badge className={STATUS_TONE[ev.status] ?? "bg-slate-500/15 text-slate-300"}>
                {ev.status === "paid" && <BadgeCheck className="mr-1 size-3" />}
                {ev.status === "pending" && <Clock3 className="mr-1 size-3" />}
                {ev.status === "paid"
                  ? "Paid"
                  : ev.status === "pending"
                    ? "Awaiting payment"
                    : ev.status}
              </Badge>
            </div>
            <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <dt>Receipt no.</dt>
                <dd className="font-mono text-foreground">{ev.receipt_number}</dd>
              </div>
              {ev.gateway && (
                <div className="flex justify-between">
                  <dt>Gateway</dt>
                  <dd>{ev.gateway}</dd>
                </div>
              )}
              {ev.reference && (
                <div className="flex justify-between gap-3">
                  <dt>Reference</dt>
                  <dd className="truncate font-mono text-foreground">{ev.reference}</dd>
                </div>
              )}
              {ev.card_brand && (
                <div className="flex justify-between">
                  <dt>Card</dt>
                  <dd className="capitalize">
                    {ev.card_brand}
                    {ev.card_last4 ? ` •••• ${ev.card_last4}` : ""}
                  </dd>
                </div>
              )}
              {ev.paid_at && (
                <div className="flex justify-between">
                  <dt>Paid at</dt>
                  <dd>
                    {new Date(ev.paid_at).toLocaleString("en-ZA", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </dd>
                </div>
              )}
              {ev.proof_url && (
                <div className="flex justify-between">
                  <dt>Proof upload</dt>
                  <dd>
                    <a
                      href={ev.proof_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
                    >
                      View document <ExternalLink className="size-3" />
                    </a>
                  </dd>
                </div>
              )}
              {ev.status === "pending" && ev.method !== "card" && (
                <p className="pt-1 text-[11px] text-amber-300/90">
                  {ev.method === "cash_on_pickup"
                    ? "Customer pays cash at the counter — mark as paid when collected."
                    : ev.method === "eft"
                      ? "Customer transfers the money and uploads proof (image or PDF) — verify the EFT, then mark as paid."
                      : "Driver collects the cash on delivery — mark as paid on handover."}
                </p>
              )}
            </dl>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {canManage && ev.status !== "paid" && (
            <Button onClick={markPaid} disabled={marking} className="gap-2">
              {marking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BadgeCheck className="size-4" />
              )}
              Mark as paid
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
