import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Demo-mode shim: the app no longer talks to Supabase for realtime.
 * Pages rely on periodic refetch intervals and mutation-driven invalidation
 * to stay fresh. This hook is intentionally a no-op so the import surface
 * across pages stays unchanged.
 */
export function useRealtimeInvalidate(
  _channel: string,
  _tables: string[],
  _queryKeys: string[],
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    // no-op placeholder
    void queryClient;
  }, [queryClient]);
}
