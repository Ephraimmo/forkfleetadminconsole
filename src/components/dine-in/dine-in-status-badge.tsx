// A dine-in order's status in dine-in wording ("Waiting for waiter confirmation", "Served"…).

import { Badge } from "@/components/ui/badge";
import { dineInStatusLabel } from "@/lib/dine-in";
import type { OrderStatus } from "@/lib/orders.firebase";

const STATUS_TONE: Partial<Record<OrderStatus, string>> = {
  waiting_for_waiter_confirmation: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  // Legacy dine-in orders wait for the waiter as "pending".
  pending: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  accepted: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  preparing: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  ready: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  delivered: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  rejected: "bg-rose-600/15 text-rose-300 border-rose-600/30",
  cancelled: "bg-destructive/15 text-destructive border-destructive/25",
  refunded: "bg-destructive/15 text-destructive border-destructive/25",
};

export function DineInStatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={`${STATUS_TONE[status] ?? ""} ${className ?? ""}`}>
      {dineInStatusLabel(status)}
    </Badge>
  );
}
