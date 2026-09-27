import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { tableDisplayName } from "@/lib/tables.firebase";
import {
  isActiveWaiterRequest,
  subscribeWaiterRequests,
  waiterRequestMessage,
  type WaiterRequest,
} from "@/lib/waiter-requests.firebase";

/**
 * Every waiter call, live. With `notify`, a toast pops up whenever a guest
 * calls (or calls again) while the page is open — not for calls already
 * waiting when it loaded.
 */
export function useWaiterRequests(options: { notify?: boolean } = {}) {
  const [rows, setRows] = useState<WaiterRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notify = useRef(options.notify ?? false);
  notify.current = options.notify ?? false;
  // Unanswered calls already seen, with how many times each had been pressed.
  const seen = useRef<Map<string, number> | null>(null);

  useEffect(
    () =>
      // A failed listener reports through setError, then delivers an empty list.
      subscribeWaiterRequests((next) => {
        const previous = seen.current;
        const current = new Map<string, number>();
        for (const request of next) {
          if (!isActiveWaiterRequest(request)) continue;
          current.set(request.id, request.request_count);
          const before = previous?.get(request.id);
          const isNew =
            previous !== null && (before === undefined || request.request_count > before);
          if (isNew && notify.current && request.status === "open") {
            toast(`🔔 Waiter Request — ${tableDisplayName(request.table_label)}`, {
              description: `${waiterRequestMessage(request)} · ${request.guest_label}`,
              duration: 10_000,
            });
          }
        }
        seen.current = current;
        setRows(next);
      }, setError),
    [],
  );

  return { rows: rows ?? [], loading: rows === null && error === null, error };
}
