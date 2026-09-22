// Firebase-backed customer directory.
//
// Stored under the Realtime Database root: /customers/{id}
//
// Customers have NO restaurant_id field of their own — this node is global,
// the same way it is in Restaurant Admin (see
// docs/RESTAURANT_ADMIN_TO_SUPER_ADMIN_CUSTOMERS_HANDOVER.md §1.2). A given
// customer can order from more than one restaurant on this platform, so
// "this restaurant's customers" is always derived by filtering orders by
// restaurant_id first and joining back to this node — never by adding an
// ownership field here.

import { isFirebaseAvailable, fsSubscribe, fsUpdate } from "@/lib/firestore";

export interface FirebaseCustomer {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string | { label?: string; street?: string } | null;
  /** Treated as active unless explicitly false — matches Restaurant Admin's convention. */
  active?: boolean;
  created_at?: string;
}

const CUSTOMERS_PATH = "customers";

export function subscribeFirebaseCustomers(cb: (rows: FirebaseCustomer[]) => void): () => void {
  if (!isFirebaseAvailable()) {
    cb([]);
    return () => {};
  }
  return fsSubscribe<Record<string, Omit<FirebaseCustomer, "id">>>(CUSTOMERS_PATH, (val) => {
    cb(val ? Object.entries(val).map(([id, c]) => ({ id, ...(c ?? {}) })) : []);
  });
}

export function customerDisplayName(c: FirebaseCustomer): string {
  return c.name?.trim() || c.email?.trim() || "Guest";
}

export function customerAddressLabel(c: FirebaseCustomer): string {
  if (!c.address) return "—";
  if (typeof c.address === "string") return c.address;
  return c.address.label || c.address.street || "—";
}

/** Active unless explicitly set to false. */
export function customerIsActive(c: FirebaseCustomer): boolean {
  return c.active !== false;
}

/** Global toggle — matches Restaurant Admin's behaviour (a customer deactivated
 *  here is inactive platform-wide, not scoped to one restaurant). */
export async function toggleCustomerActive(customer: FirebaseCustomer): Promise<void> {
  if (!isFirebaseAvailable()) throw new Error("Firebase unavailable");
  await fsUpdate(`${CUSTOMERS_PATH}/${customer.id}`, {
    active: !customerIsActive(customer),
  });
}
