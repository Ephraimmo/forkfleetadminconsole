// Restaurant branches live at /restaurantBranches/{restaurantId}/{branchId}.
//
// This is the authoritative branch registry written by the Restaurant App.
// Driver assignments MUST be expanded against this list — reading a `branches`
// field off the restaurant record misses every real branch and silently
// assigns only "main", which is why orders on other branches showed
// "No approved driver for this branch".

import { isFirebaseAvailable, rtdbGet, rtdbSubscribe } from "@/lib/firebase";

const BRANCHES_PATH = "restaurantBranches";

export interface RestaurantBranch {
  id: string;
  restaurant_id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  code?: string | null;
  phone?: string | null;
  is_main?: boolean;
  is_active?: boolean;
  status?: string | null;
}

function prettyName(id: string): string {
  const cleaned = String(id ?? "")
    .replace(/^brn[-_]/, "")
    .replace(/^branch[-_]/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!cleaned) return "Main";
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function toBranchList(
  restaurantId: string,
  map: Record<string, Partial<RestaurantBranch>> | null,
): RestaurantBranch[] {
  if (!map) return [];
  return Object.entries(map)
    .filter(([, b]) => !!b && typeof b === "object")
    .map(([key, b]) => ({
      ...b,
      id: b.id ?? key,
      restaurant_id: b.restaurant_id ?? restaurantId,
      name: b.name ?? prettyName(key),
    }))
    .sort((a, b) => Number(!!b.is_main) - Number(!!a.is_main) || a.name.localeCompare(b.name));
}

/** Live branch list for one restaurant. Empty when the restaurant has none. */
export function subscribeRestaurantBranches(
  restaurantId: string,
  cb: (rows: RestaurantBranch[]) => void,
): () => void {
  if (!isFirebaseAvailable() || !restaurantId) {
    cb([]);
    return () => {};
  }
  return rtdbSubscribe<Record<string, Partial<RestaurantBranch>>>(
    `${BRANCHES_PATH}/${restaurantId}`,
    (val) => cb(toBranchList(restaurantId, val)),
  );
}

/** Live branch map for every restaurant: { restaurantId: RestaurantBranch[] }. */
export function subscribeAllBranches(
  cb: (map: Record<string, RestaurantBranch[]>) => void,
): () => void {
  if (!isFirebaseAvailable()) {
    cb({});
    return () => {};
  }
  return rtdbSubscribe<Record<string, Record<string, Partial<RestaurantBranch>>>>(
    BRANCHES_PATH,
    (val) => {
      const out: Record<string, RestaurantBranch[]> = {};
      for (const [rid, branches] of Object.entries(val ?? {})) {
        out[rid] = toBranchList(rid, branches);
      }
      cb(out);
    },
  );
}

/** One-shot read of a restaurant's branches. */
export async function listRestaurantBranches(restaurantId: string): Promise<RestaurantBranch[]> {
  if (!isFirebaseAvailable() || !restaurantId) return [];
  const val = await rtdbGet<Record<string, Partial<RestaurantBranch>>>(
    `${BRANCHES_PATH}/${restaurantId}`,
  );
  return toBranchList(restaurantId, val);
}
