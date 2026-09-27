// Everything about one dine-in order: table, guests, items with their
// modifiers and notes, totals, who confirmed, sent and served it, its edit
// history and its timeline — plus the waiter's next step (confirm, send to
// the kitchen, or mark served).

import { format } from "date-fns";

import { DineInOrderActions } from "@/components/dine-in/dine-in-order-actions";
import { DineInStatusBadge } from "@/components/dine-in/dine-in-status-badge";
import { OrderEditHistory } from "@/components/dine-in/order-edit-history";
import { OrderModeBadge } from "@/components/restaurants/tables-manager";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DispatchOrder } from "@/lib/dispatch.functions";
import { customerSessionLabel, dineInStatusLabel } from "@/lib/dine-in";
import { describeLineOptions } from "@/lib/dine-in-order-edit";
import { tableDisplayName } from "@/lib/tables.firebase";

const money = (value: number) =>
  `R ${value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (iso: string | null | undefined) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? format(d, "d MMM, HH:mm") : "—";
};

function historyLabel(event: DispatchOrder["timeline"][number]): string {
  if (event.note) return event.note;
  if (event.status === "placed") return "Order placed";
  return dineInStatusLabel(event.status);
}

export function DineInOrderDialog({
  order,
  canManage,
  onClose,
}: {
  order: DispatchOrder | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const dineIn = order?.dine_in ?? null;
  const who = order ? customerSessionLabel(order) : null;
  return (
    <Dialog open={order !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-2xl flex-col gap-0 p-0">
        {order && (
          <>
            <DialogHeader className="border-b p-5 pb-3">
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {tableDisplayName(dineIn?.table_label ?? "—")} · Order {order.order_number}
                <DineInStatusBadge status={order.status} className="text-[10px]" />
              </DialogTitle>
              <DialogDescription>
                {order.restaurant_name}
                {(dineIn?.round ?? 1) > 1 ? ` · round ${dineIn!.round} this seating` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Order mode</dt>
                <dd>{dineIn ? <OrderModeBadge mode={dineIn.order_mode} /> : "—"}</dd>
                <dt className="text-muted-foreground">Customer / session</dt>
                <dd>
                  {who?.primary}
                  {who?.secondary && (
                    <span className="text-muted-foreground"> · {who.secondary}</span>
                  )}
                </dd>
                <dt className="text-muted-foreground">Waiter</dt>
                <dd className={dineIn?.waiter_name ? "" : "text-muted-foreground"}>
                  {dineIn?.waiter_name ?? "Unassigned"}
                </dd>
                <dt className="text-muted-foreground">Placed</dt>
                <dd>{when(order.created_at || order.placed_at)}</dd>
                {dineIn?.confirmed_at && (
                  <>
                    <dt className="text-muted-foreground">Confirmed</dt>
                    <dd>
                      {when(dineIn.confirmed_at)}
                      {dineIn.confirmed_by ? ` by ${dineIn.confirmed_by}` : ""}
                    </dd>
                  </>
                )}
                {dineIn?.sent_to_kitchen_at && (
                  <>
                    <dt className="text-muted-foreground">Sent to kitchen</dt>
                    <dd>
                      {when(dineIn.sent_to_kitchen_at)}
                      {dineIn.sent_to_kitchen_by ? ` by ${dineIn.sent_to_kitchen_by}` : ""}
                    </dd>
                  </>
                )}
                {order.status === "ready" && (
                  <>
                    <dt className="text-muted-foreground">Ready</dt>
                    <dd className="font-medium text-emerald-300">
                      Waiting to be served{order.ready_at ? ` since ${when(order.ready_at)}` : ""}
                    </dd>
                  </>
                )}
                {dineIn?.served_at && (
                  <>
                    <dt className="text-muted-foreground">Served</dt>
                    <dd>
                      {when(dineIn.served_at)}
                      {dineIn.served_by ? ` by ${dineIn.served_by}` : ""}
                    </dd>
                  </>
                )}
              </dl>

              <section>
                <h3 className="mb-1.5 text-xs font-semibold">Items</h3>
                <ul className="divide-y rounded-md border">
                  {order.items.map((item) => {
                    const options = describeLineOptions({ addons: item.addons });
                    return (
                      <li key={item.id} className="flex justify-between gap-3 p-2.5">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {item.quantity}× {item.item_name}
                          </p>
                          {options.length > 0 && (
                            <p className="text-[11px] text-muted-foreground">
                              {options.join(" · ")}
                            </p>
                          )}
                          {item.notes && (
                            <p className="text-[11px] italic text-amber-200/90">
                              Note: {item.notes}
                            </p>
                          )}
                          {item.added_by_label && (
                            <p className="text-[10px] text-muted-foreground">
                              Added by {item.added_by_label}
                            </p>
                          )}
                          {item.edited_by && (
                            <p className="text-[10px] text-amber-300/90">
                              Edited by {item.edited_by} · {when(item.edited_at)} — see edit history
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 tabular-nums">{money(item.line_total)}</span>
                      </li>
                    );
                  })}
                  {order.items.length === 0 && (
                    <li className="p-3 text-center text-xs text-muted-foreground">No items</li>
                  )}
                </ul>
              </section>

              {order.special_instructions && (
                <section className="rounded-md border border-violet-500/20 bg-violet-500/5 p-3 text-xs">
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-violet-300/80">
                    Special instructions
                  </p>
                  <p className="whitespace-pre-wrap">{order.special_instructions}</p>
                </section>
              )}

              <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="text-right tabular-nums">{money(order.subtotal)}</dd>
                <dt className="font-medium">Total</dt>
                <dd className="text-right font-medium tabular-nums">{money(order.total)}</dd>
              </dl>

              <OrderEditHistory orderNumber={order.order_number} edits={order.edits} />

              {order.timeline.length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold">History</h3>
                  <ol className="space-y-1 text-xs">
                    {order.timeline.map((event, i) => (
                      <li key={`${event.at}-${i}`} className="flex gap-3">
                        <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                          {when(event.at)}
                        </span>
                        <span className="min-w-0">{historyLabel(event)}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>

            <DialogFooter className="gap-2 border-t p-4 sm:justify-between">
              {canManage ? <DineInOrderActions order={order} onAction={onClose} /> : <span />}
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
