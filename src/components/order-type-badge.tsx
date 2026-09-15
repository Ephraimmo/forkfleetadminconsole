// Small fulfilment-type indicator shown on order cards/rows across the
// console (kitchen, dispatch, orders). One place to style it.

import { Bike, ShoppingBag } from "lucide-react";
import type { OrderType } from "@/lib/orders.firebase";

export function OrderTypeBadge({ type }: { type: OrderType }) {
  return type === "pickup" ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-medium text-sky-400">
      <ShoppingBag className="size-2.5" /> Pickup
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
      <Bike className="size-2.5" /> Delivery
    </span>
  );
}
