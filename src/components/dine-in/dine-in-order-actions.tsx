// Waiter actions for a dine-in order, whichever step it's at:
//   waiting for confirmation → Edit order · Confirm order · Reject
//   confirmed with the table → Edit order · Send to kitchen · Reject
//   ready (kitchen finished) → Mark as served
//   any time after confirming, until paid → Take payment (cash, card or EFT)
//
// Wrap a page in <DineInActionsProvider> and drop <DineInOrderActions> next
// to any dine-in order; it shows nothing when the waiter has nothing to do.
// The provider owns the edit and reject dialogs and follows the live order
// book, so a dialog stays open (and says so) when the order changes
// underneath it — e.g. another waiter confirms it first.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  Banknote,
  ChefHat,
  CheckCheck,
  ConciergeBell,
  Loader2,
  Pencil,
  XCircle,
} from "lucide-react";

import { EditDineInOrderDialog } from "@/components/dine-in/edit-dine-in-order-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useStaffActor } from "@/hooks/use-staff-actor";
import { audit } from "@/lib/audit";
import {
  canTakeDineInPayment,
  DINE_IN_PAYMENT_METHODS,
  hasDineInAction,
  isAwaitingWaiterConfirmation,
  isWithWaiter,
  WAITER_CONFIRMED,
  type DineInPaymentMethod,
  type StaffActor,
} from "@/lib/dine-in";
import {
  confirmDineInOrder,
  confirmDineInPayment,
  dineInOrderName,
  markDineInOrderServed,
  sendDineInOrderToKitchen,
} from "@/lib/dine-in-orders.firebase";
import { onOrdersChanged, rejectOrder, type DispatchOrder } from "@/lib/dispatch.functions";
import { tableDisplayName } from "@/lib/tables.firebase";

type Step = "confirm" | "send" | "serve";

interface DineInActions {
  edit: (orderId: string) => void;
  reject: (orderId: string) => void;
  pay: (orderId: string) => void;
  run: (step: Step, order: DispatchOrder) => Promise<void>;
  busyWith: (orderId: string) => Step | null;
}

const ActionsContext = createContext<DineInActions | null>(null);

export function DineInActionsProvider({
  children,
  actor: actorOverride,
}: {
  children: React.ReactNode;
  /** Who is acting — defaults to the signed-in console staff member (the Waiter screen passes the waiter). */
  actor?: StaffActor;
}) {
  const staffActor = useStaffActor();
  const actor = actorOverride ?? staffActor;
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  useEffect(() => onOrdersChanged(setOrders), []);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlyMap<string, Step>>(new Map());

  const run = useCallback(
    async (step: Step, order: DispatchOrder) => {
      setBusy((m) => new Map(m).set(order.id, step));
      const name = dineInOrderName(order);
      try {
        if (step === "confirm") {
          await confirmDineInOrder({
            order_id: order.id,
            // Only what the waiter could see: refuses if a guest added something since.
            reviewed_line_ids: order.items.map((i) => i.id),
            actor,
          });
          audit({
            action: "order.dine_in.confirmed",
            entityType: "order",
            entityId: order.id,
            before: { status: order.status },
            after: { status: WAITER_CONFIRMED },
          });
          toast.success(`${name} confirmed.`, {
            description: "Send it to the kitchen when the table is ready.",
          });
        } else if (step === "send") {
          await sendDineInOrderToKitchen({ order_id: order.id, actor });
          audit({
            action: "order.dine_in.sent_to_kitchen",
            entityType: "order",
            entityId: order.id,
            before: { status: order.status },
            after: { status: "accepted" },
          });
          toast.success(`${name} sent to the kitchen.`);
        } else {
          const served = await markDineInOrderServed({ order_id: order.id, actor });
          audit({
            action: "order.dine_in.served",
            entityType: "order",
            entityId: order.id,
            before: { status: order.status },
            after: {
              status: "delivered",
              table: served.table_label || null,
              waiter: served.served_by,
              served_at: served.served_at,
            },
          });
          toast.success(`${name} served.`);
        }
      } catch (e) {
        const fallback = {
          confirm: "Could not confirm the order.",
          send: "Could not send the order to the kitchen.",
          serve: "Could not mark the order served.",
        }[step];
        toast.error(e instanceof Error ? e.message : fallback);
      } finally {
        setBusy((m) => {
          const next = new Map(m);
          next.delete(order.id);
          return next;
        });
      }
    },
    [actor],
  );

  const value = useMemo<DineInActions>(
    () => ({
      edit: setEditingId,
      reject: setRejectingId,
      pay: setPayingId,
      run,
      busyWith: (id) => busy.get(id) ?? null,
    }),
    [run, busy],
  );

  const find = (id: string | null) => (id ? (orders.find((o) => o.id === id) ?? null) : null);

  return (
    <ActionsContext.Provider value={value}>
      {children}
      <EditDineInOrderDialog
        open={editingId !== null}
        order={find(editingId)}
        actor={actor}
        onClose={() => setEditingId(null)}
      />
      <RejectDineInOrderDialog
        order={find(rejectingId)}
        actor={actor}
        onClose={() => setRejectingId(null)}
      />
      <TakePaymentDialog order={find(payingId)} actor={actor} onClose={() => setPayingId(null)} />
    </ActionsContext.Provider>
  );
}

function useDineInActions(): DineInActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("useDineInActions must be used inside <DineInActionsProvider>");
  return actions;
}

/** The waiter's next steps for a dine-in order — nothing when there are none. */
export function DineInOrderActions({
  order,
  compact = false,
  className,
  onAction,
}: {
  order: DispatchOrder;
  /** Short labels, for tight cards. */
  compact?: boolean;
  className?: string;
  /** Called when Edit or Reject opens its dialog (e.g. to close a dialog this sits in). */
  onAction?: () => void;
}) {
  const actions = useDineInActions();
  const payable = canTakeDineInPayment(order);
  if (!hasDineInAction(order) && !payable) return null;
  const busy = actions.busyWith(order.id);
  const spinner = <Loader2 className="mr-1 size-3.5 animate-spin" />;
  const payButton = payable ? (
    <Button
      size="sm"
      variant="outline"
      className="border-emerald-500/40 text-emerald-300 hover:text-emerald-200"
      onClick={() => {
        onAction?.();
        actions.pay(order.id);
      }}
      disabled={busy !== null}
      title="Record that the table has paid"
    >
      <Banknote className="mr-1 size-3.5" /> {compact ? "Payment" : "Take payment"}
    </Button>
  ) : null;

  if (!hasDineInAction(order)) {
    return <div className={`flex flex-wrap gap-2 ${className ?? ""}`}>{payButton}</div>;
  }

  if (order.status === "ready") {
    return (
      <div className={`flex flex-wrap gap-2 ${className ?? ""}`}>
        {payButton}
        <Button
          size="sm"
          onClick={() => void actions.run("serve", order)}
          disabled={busy !== null}
          title={`Served at ${tableDisplayName(order.dine_in?.table_label ?? "—")}`}
        >
          {busy === "serve" ? spinner : <ConciergeBell className="mr-1 size-3.5" />}
          {compact ? "Served" : "Mark as served"}
        </Button>
      </div>
    );
  }

  const awaiting = isAwaitingWaiterConfirmation(order.status);
  return (
    <div className={`flex flex-wrap gap-2 ${className ?? ""}`}>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          onAction?.();
          actions.edit(order.id);
        }}
        disabled={busy !== null}
        title={awaiting ? undefined : "Changing a confirmed order means confirming it again"}
      >
        <Pencil className="mr-1 size-3.5" /> {compact ? "Edit" : "Edit order"}
      </Button>
      {awaiting ? (
        <Button
          size="sm"
          onClick={() => void actions.run("confirm", order)}
          disabled={busy !== null || order.items.length === 0}
          title="Confirm the order with the table — it goes to the kitchen when you send it"
        >
          {busy === "confirm" ? spinner : <CheckCheck className="mr-1 size-3.5" />}
          {compact ? "Confirm" : "Confirm order"}
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() => void actions.run("send", order)}
          disabled={busy !== null}
          title="Send the confirmed order to the kitchen"
        >
          {busy === "send" ? spinner : <ChefHat className="mr-1 size-3.5" />}
          {compact ? "Send" : "Send to kitchen"}
        </Button>
      )}
      {payButton}
      <Button
        size="sm"
        variant="ghost"
        className="text-rose-300 hover:text-rose-200"
        onClick={() => {
          onAction?.();
          actions.reject(order.id);
        }}
        disabled={busy !== null}
      >
        <Ban className="mr-1 size-3.5" /> Reject
      </Button>
    </div>
  );
}

function RejectDineInOrderDialog({
  order,
  actor,
  onClose,
}: {
  order: DispatchOrder | null;
  actor: StaffActor;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const open = order !== null;
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const stillWithWaiter = order ? isWithWaiter(order.status) : false;

  async function submit() {
    if (!order) return;
    setBusy(true);
    try {
      await rejectOrder({ orderId: order.id, reason, actor: actor.email ?? actor.name ?? null });
      toast.success(`${dineInOrderName(order)} rejected.`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reject the order.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="size-4 text-rose-400" /> Reject{" "}
            {order ? dineInOrderName(order) : "order"}
          </DialogTitle>
          <DialogDescription>
            The guest sees the reason. The order won&apos;t go to the kitchen, and the next items
            from the table start a new order.
          </DialogDescription>
        </DialogHeader>
        {!stillWithWaiter && order && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
            This order has already gone to the kitchen, so it can&apos;t be rejected here.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="dine-in-reject-reason">Reason</Label>
          <Textarea
            id="dine-in-reject-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. The kitchen has run out of the steak"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void submit()}
            disabled={!reason.trim() || busy || !stillWithWaiter}
          >
            {busy ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <XCircle className="mr-1.5 size-4" />
            )}
            Reject order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TakePaymentDialog({
  order,
  actor,
  onClose,
}: {
  order: DispatchOrder | null;
  actor: StaffActor;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<DineInPaymentMethod>("cash");
  const [busy, setBusy] = useState(false);
  const open = order !== null;
  useEffect(() => {
    if (open) setMethod("cash");
  }, [open]);
  const payable = order ? canTakeDineInPayment(order) : false;

  async function submit() {
    if (!order) return;
    setBusy(true);
    try {
      const paid = await confirmDineInPayment({ order_id: order.id, method, actor });
      audit({
        action: "order.dine_in.paid",
        entityType: "order",
        entityId: order.id,
        before: { payment_status: order.payment_status },
        after: { payment_status: "paid", method, amount: paid.amount },
      });
      toast.success(`${dineInOrderName(order)} paid — R ${paid.amount.toFixed(2)}.`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="size-4 text-emerald-400" /> Take payment
          </DialogTitle>
          <DialogDescription>
            {order ? dineInOrderName(order) : ""} — confirm the table has paid.
          </DialogDescription>
        </DialogHeader>
        {order && (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-center">
              <p className="text-xs text-muted-foreground">Amount due</p>
              <p className="text-2xl font-semibold tabular-nums">R {order.total.toFixed(2)}</p>
            </div>
            <RadioGroup
              value={method}
              onValueChange={(v) => setMethod(v as DineInPaymentMethod)}
              className="gap-2"
            >
              {DINE_IN_PAYMENT_METHODS.map((m) => (
                <Label
                  key={m.id}
                  htmlFor={`pay-${m.id}`}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border p-2.5 font-normal ${
                    method === m.id ? "border-primary/40 bg-primary/5" : ""
                  }`}
                >
                  <RadioGroupItem id={`pay-${m.id}`} value={m.id} />
                  {m.label}
                </Label>
              ))}
            </RadioGroup>
            {!payable && (
              <p className="text-xs text-destructive">
                This order can&apos;t take a payment right now.
              </p>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !payable}>
            {busy ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <CheckCheck className="mr-1.5 size-4" />
            )}
            Confirm payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
