// "🔔 Order Ready" for waiters: the moment the kitchen marks a dine-in order
// ready, a toast pops up on whichever console page is open —
//
//   🔔 Order Ready
//   Table 12
//   Order #FF-123456
//   [View Order]
//
// It stays until dismissed, viewed, or the order is served (then it goes by
// itself). Orders that were already ready when the console opened raise no
// alert; the Dine-in orders page lists them under "Ready to serve".

import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { readyOrderAlerts } from "@/lib/dine-in";
import { hasOrderSnapshot, onOrdersChanged } from "@/lib/dispatch.functions";
import { tableDisplayName } from "@/lib/tables.firebase";

// Kept across pages (the shell remounts on each one), so moving around the
// console never repeats an alert or misses an order that turned ready meanwhile.
let seen: Set<string> | null = null;

const toastId = (orderId: string) => `order-ready-${orderId}`;

export function useOrderReadyAlerts(enabled: boolean) {
  const navigate = useNavigate();
  const nav = useRef(navigate);
  nav.current = navigate;

  useEffect(() => {
    if (!enabled) return;
    return onOrdersChanged((rows) => {
      if (!hasOrderSnapshot()) return; // nothing loaded yet — not the same as no orders
      const { ready, alerts, cleared } = readyOrderAlerts(seen, rows);
      seen = ready;
      for (const id of cleared) toast.dismiss(toastId(id));
      for (const order of alerts) {
        toast("🔔 Order Ready", {
          id: toastId(order.id),
          description: (
            <span className="block leading-snug">
              {tableDisplayName(order.dine_in?.table_label ?? "—")}
              <br />
              Order #{order.order_number}
            </span>
          ),
          duration: Number.POSITIVE_INFINITY,
          closeButton: true,
          action: {
            label: "View Order",
            onClick: () => void nav.current({ to: "/dine-in", search: { order: order.id } }),
          },
        });
      }
    });
  }, [enabled]);
}
