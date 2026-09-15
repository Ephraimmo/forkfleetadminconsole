// Bootstraps the Firebase orders subscription so any module that calls
// listOrders/listDrivers/getDispatchBoard/getKitchenQueue/getDashboard sees
// live data. Safe to call from multiple components; subscription starts once.
import { useEffect } from "react";
import { onOrdersChanged } from "@/lib/dispatch.functions";
import { onKitchenChanged } from "@/lib/kitchen.functions";

let started = false;
export function startFirebaseOrderSync() {
  if (started) return;
  if (typeof window === "undefined") return; // SSR guard
  started = true;
  onOrdersChanged(() => {});
  onKitchenChanged(() => {});
}

export function useFirebaseOrderSync() {
  useEffect(() => {
    startFirebaseOrderSync();
  }, []);
}
