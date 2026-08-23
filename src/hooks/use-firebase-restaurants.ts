// Central helper for components that need the list of restaurants for a
// picker/dropdown. Always returns restaurants loaded from Firebase; never
// leaks demo-store rows. SSR returns an empty list and the browser hydrates.
import { useEffect, useState } from "react";
import {
  listFirebaseRestaurants,
  subscribeRestaurants,
  type FirebaseRestaurant,
} from "@/lib/restaurants.firebase";
import { isFirebaseAvailable } from "@/lib/firebase";

export function useFirebaseRestaurants() {
  const [rows, setRows] = useState<FirebaseRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseAvailable()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    listFirebaseRestaurants({})
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    const unsub = subscribeRestaurants((all) => {
      if (cancelled) return;
      setRows([...all].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return { rows, loading, error } as const;
}
