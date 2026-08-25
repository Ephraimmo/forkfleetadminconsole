// Restaurant branches (Cloud Firestore).
//
// Previously nested at /restaurantBranches/{restaurantId}/{branchId} in the
// Realtime Database; now stored as ONE flat collection where each document id
// is "{restaurantId}__{branchId}" and carries a restaurant_id field.
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

type FlatBranchMap = Record<string, Partial<RestaurantBranch> & { restaurant_id?: string }>;

function splitBranchKey(docId: string): { rid: string; bid: string } {
  const idx = docId.indexOf("__");
  if (idx === -1) return { rid: "", bid: docId };
  return { rid: docId.slice(0, idx), bid: docId.slice(idx + 2) };
}

/** Shape raw flat rows into per-restaurant sorted branch lists. */
function shapeAll(flat: FlatBranchMap | null): Record<string, RestaurantBranch[]> {
  const out: Record<string, RestaurantBranch[]> = {};
  for (const [docId, b] of Object.entries(flat ?? {})) {
    if (!b || typeof b !== "object") continue;
    const { rid, bid } = splitBranchKey(docId);
    const restaurantId = b.restaurant_id ?? rid;
    if (!restaurantId) continue;
    const list = out[restaurantId] ?? [];
    list.push({
      ...b,
      id: b.id ?? bid,
      restaurant_id: restaurantId,
      name: b.name ?? prettyName(bid),
    });
    out[restaurantId] = list;
  }
  for (const list of Object.values(out)) {
    list.sort(
      (a, b) => Number(!!b.is_main) - Number(!!a.is_main) || a.name.localeCompare(b.name),
    );
  }
  return out;
}

function filterByRestaurant(
  all: Record<string, RestaurantBranch[]>,
  restaurantId: string,
): RestaurantBranch[] {
  return all[restaurantId] ?? [];
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
  return rtdbSubscribe<FlatBranchMap>(BRANCHES_PATH, (val) =>
    cb(filterByRestaurant(shapeAll(val), restaurantId)),
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
  return rtdbSubscribe<FlatBranchMap>(BRANCHES_PATH, (val) => cb(shapeAll(val)));
}

/** One-shot read of a restaurant's branches. */
export async function listRestaurantBranches(restaurantId: string): Promise<RestaurantBranch[]> {
  if (!isFirebaseAvailable() || !restaurantId) return [];
  const val = await rtdbGet<FlatBranchMap>(BRANCHES_PATH);
  return filterByRestaurant(shapeAll(val), restaurantId);
}
