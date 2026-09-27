// A dine-in order the waiter has to act on: table, order number, what's on
// it, and the waiter's next step — Edit / Confirm order / Reject while it
// waits for confirmation, Send to kitchen once confirmed, Mark as served once
// the kitchen has it ready.

import { formatDistanceToNow } from "date-fns";

import { DineInOrderActions } from "@/components/dine-in/dine-in-order-actions";
import type { DispatchOrder } from "@/lib/dispatch.functions";
import { customerSessionLabel, dineInStatusLabel } from "@/lib/dine-in";
import { describeLineOptions } from "@/lib/dine-in-order-edit";
import { tableDisplayName } from "@/lib/tables.firebase";

const money = (value: number) =>
  `R ${value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SHOWN_ITEMS = 4;

/** Card colours by step: waiting for confirmation, confirmed, ready to serve. */
function tone(status: string): { card: string; label: string } {
  if (status === "waiter_confirmed") {
    return { card: "border-sky-500/30 bg-sky-500/5", label: "text-sky-300" };
  }
  if (status === "ready") {
    return { card: "border-emerald-500/30 bg-emerald-500/5", label: "text-emerald-300" };
  }
  return { card: "border-fuchsia-500/30 bg-fuchsia-500/5", label: "text-fuchsia-300" };
}

export function AwaitingConfirmationCard({
  order,
  canManage,
  showRestaurant = false,
  onOpen,
}: {
  order: DispatchOrder;
  canManage: boolean;
  showRestaurant?: boolean;
  /** Open the order's full details. */
  onOpen: () => void;
}) {
  const who = customerSessionLabel(order);
  const placed = new Date(order.created_at || order.placed_at);
  const round = order.dine_in?.round ?? 1;
  const colours = tone(order.status);
  return (
    <div className={`rounded-lg border p-3 ${colours.card}`}>
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 text-left hover:underline"
          title="View order details"
        >
          <p className="text-lg font-semibold leading-tight">
            {tableDisplayName(order.dine_in?.table_label ?? "—")}
          </p>
          <p className="text-sm">
            Order {order.order_number}
            {round > 1 && <span className="text-muted-foreground"> · round {round}</span>}
          </p>
        </button>
        {!Number.isNaN(placed.getTime()) && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatDistanceToNow(placed, { addSuffix: true })}
          </span>
        )}
      </div>
      <p className={`mt-1.5 text-sm font-medium ${colours.label}`}>
        {dineInStatusLabel(order.status)}
      </p>

      <ul className="mt-2 space-y-0.5 text-xs">
        {order.items.slice(0, SHOWN_ITEMS).map((item) => {
          const options = describeLineOptions({ addons: item.addons });
          return (
            <li key={item.id}>
              {item.quantity}× {item.item_name}
              {options.length > 0 && (
                <span className="text-muted-foreground"> · {options.join(", ")}</span>
              )}
              {item.notes && <span className="italic text-amber-200/90"> · “{item.notes}”</span>}
            </li>
          );
        })}
        {order.items.length > SHOWN_ITEMS && (
          <li className="text-[11px] italic text-muted-foreground">
            +{order.items.length - SHOWN_ITEMS} more
          </li>
        )}
        {order.items.length === 0 && (
          <li className="text-[11px] italic text-muted-foreground">No items</li>
        )}
      </ul>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {[
          who.primary,
          who.secondary,
          money(order.total),
          showRestaurant ? order.restaurant_name : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {canManage && <DineInOrderActions order={order} compact className="mt-2.5" />}
    </div>
  );
}
