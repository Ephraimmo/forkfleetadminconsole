// Waiter actions for a dine-in order waiting for confirmation: Edit order,
// Confirm & send to kitchen, Reject.
//
// Wrap a page in <DineInActionsProvider> and drop <DineInOrderActions> next
// to any waiting order. The provider owns the edit and reject dialogs and
// follows the live order book, so a dialog stays open (and says so) when the
// order changes underneath it — e.g. another waiter confirms it first.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Ban, ChefHat, Loader2, Pencil, XCircle } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { useStaffActor } from "@/hooks/use-staff-actor";
import { audit } from "@/lib/audit";
import { isAwaitingWaiterConfirmation } from "@/lib/dine-in";
import { confirmDineInOrder, dineInOrderName } from "@/lib/dine-in-orders.firebase";
import { onOrdersChanged, rejectOrder, type DispatchOrder } from "@/lib/dispatch.functions";

interface DineInActions {
  edit: (orderId: string) => void;
  reject: (orderId: string) => void;
  confirm: (order: DispatchOrder) => Promise<void>;
  isConfirming: (orderId: string) => boolean;
}

const ActionsContext = createContext<DineInActions | null>(null);

export function DineInActionsProvider({ children }: { children: React.ReactNode }) {
  const actor = useStaffActor();
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  useEffect(() => onOrdersChanged(setOrders), []);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ReadonlySet<string>>(new Set());

  const confirm = useCallback(
    async (order: DispatchOrder) => {
      setConfirming((s) => new Set(s).add(order.id));
      try {
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
          after: { status: "accepted" },
        });
        toast.success(`${dineInOrderName(order)} confirmed — sent to the kitchen.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not confirm the order.");
      } finally {
        setConfirming((s) => {
          const next = new Set(s);
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
      confirm,
      isConfirming: (id) => confirming.has(id),
    }),
    [confirm, confirming],
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
      <RejectDineInOrderDialog order={find(rejectingId)} onClose={() => setRejectingId(null)} />
    </ActionsContext.Provider>
  );
}

function useDineInActions(): DineInActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("useDineInActions must be used inside <DineInActionsProvider>");
  return actions;
}

/** Edit / Confirm / Reject for a dine-in order — nothing once it's no longer waiting. */
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
  if (order.order_type !== "dine_in" || !isAwaitingWaiterConfirmation(order.status)) return null;
  const busy = actions.isConfirming(order.id);
  return (
    <div className={`flex flex-wrap gap-2 ${className ?? ""}`}>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          onAction?.();
          actions.edit(order.id);
        }}
        disabled={busy}
      >
        <Pencil className="mr-1 size-3.5" /> {compact ? "Edit" : "Edit order"}
      </Button>
      <Button
        size="sm"
        onClick={() => void actions.confirm(order)}
        disabled={busy || order.items.length === 0}
        title="Confirm the order and send it to the kitchen"
      >
        {busy ? (
          <Loader2 className="mr-1 size-3.5 animate-spin" />
        ) : (
          <ChefHat className="mr-1 size-3.5" />
        )}
        {compact ? "Confirm" : "Confirm & send to kitchen"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-rose-300 hover:text-rose-200"
        onClick={() => {
          onAction?.();
          actions.reject(order.id);
        }}
        disabled={busy}
      >
        <Ban className="mr-1 size-3.5" /> Reject
      </Button>
    </div>
  );
}

function RejectDineInOrderDialog({
  order,
  onClose,
}: {
  order: DispatchOrder | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const open = order !== null;
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const stillWaiting = order ? isAwaitingWaiterConfirmation(order.status) : false;

  async function submit() {
    if (!order) return;
    setBusy(true);
    try {
      await rejectOrder({ orderId: order.id, reason });
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
        {!stillWaiting && order && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
            This order is no longer waiting for confirmation, so it can&apos;t be rejected here.
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
            disabled={!reason.trim() || busy || !stillWaiting}
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
