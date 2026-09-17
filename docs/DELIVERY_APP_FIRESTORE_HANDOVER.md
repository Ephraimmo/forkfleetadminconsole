# Delivery (Driver) App ↔ Super Admin Console — Firestore Integration Handover

**Firebase project:** `e-comm-bd997`
**Backend:** Cloud Firestore only. Realtime Database has been fully removed from the
Super Admin / Operations Console. Any driver-app code still using
`firebase/database` (`ref`, `onValue`, `set`, `update`, `push`) MUST be migrated or the
two apps will not see each other's data.

Read this together with `docs/FIRESTORE_MIGRATION_HANDOVER.md` (full path-mapping table
and data contract).

---

## 1. Firebase configuration (use exactly this — no `databaseURL`)

```ts
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBCTflur84nQjEc-YdsD_p2sR8eI7BD6nA",
  authDomain: "e-comm-bd997.firebaseapp.com",
  projectId: "e-comm-bd997",
  storageBucket: "e-comm-bd997.appspot.com",
  messagingSenderId: "280613901400",
  appId: "1:280613901400:web:bf168e55508b9102dda62d",
};
```

Auth: Firebase Auth email/password. A driver signs in with the account created at
registration; `drivers/{driverId}` document id **must equal** the Firebase Auth `uid`
(or store the uid in `user_id`) so the console can match profile to account.

---

## 2. API migration map (RTDB → Firestore)

| Old (RTDB) | New (Firestore) |
| --- | --- |
| `ref(db, path)` + `get()` | `getDoc(doc(db, path))` / `getDocs(collection(db, path))` |
| `set(ref, value)` | `setDoc(doc(db, path), value)` |
| `update(ref, patch)` | `setDoc(doc(db, path), patch, { merge: true })` |
| `push(ref, value)` | `addDoc(collection(db, path), value)` |
| `onValue(ref, cb)` | `onSnapshot(doc|collection, cb)` |
| `remove(ref)` | `deleteDoc(doc(db, path))` |

Rules that keep both apps compatible:
- Collection paths must have an **odd** segment count; document paths **even**.
- For logical collection paths that come out even-length, the console inserts the
  container document `_` (e.g. `support/tickets` → `support/_/tickets`). Use the same
  convention.
- Never write `undefined` — strip it before writing (Firestore rejects it).

---

## 3. Collections the delivery app owns or touches

### 3.1 `drivers/{driverId}` — driver profile (driver app writes, console moderates)

Fields (do **not** rename):

```
id, user_id, full_name, username, email, phone, city,
status: "pending" | "offline" | "online" | "busy" | "suspended" | "rejected",
is_active, is_deleted, is_verified,
rating, total_deliveries, wallet_balance,
vehicle_type, vehicle_plate, license_number, id_number,
bank_name, bank_account_number,
emergency_contact_name, emergency_contact_phone,
preferred_language,
verification_submitted_at, rejection_reason,
current_latitude, current_longitude,
created_at, updated_at, last_online_at, last_offline_at
```

Ownership:
- **Driver app writes:** registration fields, `status` transitions between
  `offline`/`online`/`busy`, `current_latitude`/`current_longitude`, `last_online_at`,
  `last_offline_at`, `updated_at`.
- **Console (super admin) writes:** `is_verified`, `is_active`, `status` values
  `pending`/`rejected`/`suspended`, `rejection_reason`.
- On registration write `status: "pending"`, `is_active: false`, `is_verified: false`.
  The driver may only go online after the console sets `is_verified: true` and
  `is_active: true` — enforce this client-side by subscribing to the profile doc.

The console's Driver Management page uses `onSnapshot` on the whole `drivers`
collection, so a new registration appears instantly. The doc id `live` is reserved and
skipped by the console — do not create it.

### 3.2 `driverAssignments/{driverId}__{restaurantId}__{branchId}`

Written by the console; **read-only for the driver app**. Use it to know which
restaurant branches a driver may receive orders from.

```
id, driver_id, restaurant_id, branch_id,
restaurant_name, branch_name,
is_active, created_at, updated_at, deactivated_at
```

Query pattern: `onSnapshot(collection(db,'driverAssignments'))` filtered by
`driver_id === myId && is_active === true` (or a `where()` query — accept the composite
index prompt the console shows on first run).

### 3.3 `orders/{orderId}` — the shared job board

Status lifecycle (single source of truth, owned by the console + driver app):

```
pending → accepted → preparing → ready → assigned → arrived → picked_up → on_the_way → delivered
                                   ↘ rejected / cancelled / refunded (terminal)
```

**BREAKING CHANGE (2026-09-17): new `arrived` status inserted between `assigned` and
`picked_up`.** The console's ops UI now blocks staff from marking an order `picked_up`
until it has gone through `arrived` — an order stuck at `assigned` with no way to reach
`picked_up` almost always means the driver app hasn't shipped the write below yet.

- `ready` is the only status at which the console assigns a driver. Assignment sets
  `driver_id` and status `assigned`.
- **Driver app may only advance:** `assigned → arrived → picked_up → on_the_way →
  delivered`, and only when `order.driver_id === myDriverId`. Never write terminal
  statuses (`cancelled`, `refunded`, `rejected`) — those belong to the console.
- **`arrived`**: write this the moment the driver taps "I've arrived at the
  restaurant" in the driver app, **before** they may write `picked_up`. Patch:
  `{ status: "arrived", arrived_at: ISO string, updated_at: ISO string }`. The
  console will also accept a manual "Mark arrived at restaurant" override from staff
  (dispatch board / orders page) for cases where the driver app can't reach this step
  (offline, not yet installed, etc.) — don't rely on that as your primary path, it's a
  fallback.
- Every status write must append a timeline entry:
  `timeline: [{ status, at: ISO string, note }]`.
- `order_type: "delivery" | "pickup"`. Pickup orders never get a driver — ignore them.
- Payment: `orders/{id}/payment` is a **field map** on the order document (not a
  subcollection). Cash-on-delivery confirmation writes
  `payment.status = "paid"`, `payment.collected_by = driverId`, `payment.collected_at`.
- Delivery address lives on the order: `delivery_address { label, street, city,
  postal_code, latitude, longitude, notes }` — use lat/long for navigation.

### 3.4 Live location / tracking

Write the driver's position to the profile doc (`current_latitude`,
`current_longitude`, `updated_at`) — that is what the console's Live Map reads.
Throttle to at most one write every 10–15 seconds while `status === "busy"` or
`"online"`, and stop writing when offline.

### 3.5 Notifications

- `notificationAlerts/{id}` — the console publishes alerts; driver app may read.
- `notificationReads/{id}` — write `{ alert_id, user_id, read_at }` when the driver
  opens an alert.

---

## 4. Shared data contract (non-negotiable)

- **Ids** are strings; auto-ids come from `addDoc`.
- **Timestamps** are ISO-8601 **strings** (`created_at`, `updated_at`,
  `last_online_at`, …) — never Firestore `Timestamp` objects.
- **Money** is in major units as plain numbers (e.g. `fee: 15`).
- **Tenant key** on every tenant-scoped doc: `restaurant_id`.
- **Booleans always present** where declared above; do not omit them.
- Never write `undefined`; use `null` or omit the key.

---

## 5. Security rules (already deployed by the console)

Relevant excerpt from `firestore.rules`:

```
match /drivers/{driverId} {
  allow read:  if signedIn();
  allow write: if isPlatformAdmin() || isAnyRestaurantMember();
}
match /driverAssignments/{doc} {
  allow read:  if signedIn();
  allow write: if isPlatformAdmin() || isAnyRestaurantMember();
}
match /orders/{orderId} {
  allow read, write: if isPlatformAdmin() || isAnyRestaurantMember();
}
```

**Action required on the super-admin side** (do this before shipping the driver app):
the current rules do not yet grant a signed-in driver write access to their own profile
or to their assigned orders. Add:

```
function isDriverSelf(driverId) {
  return request.auth != null && request.auth.uid == driverId;
}
match /drivers/{driverId} {
  allow read: if signedIn();
  allow create, update: if isDriverSelf(driverId)
                        || isPlatformAdmin() || isAnyRestaurantMember();
}
match /orders/{orderId} {
  allow read: if isPlatformAdmin() || isAnyRestaurantMember()
              || (request.auth != null
                  && resource.data.driver_id == request.auth.uid);
  allow update: if isPlatformAdmin() || isAnyRestaurantMember()
                || (request.auth != null
                    && resource.data.driver_id == request.auth.uid);
}
```

Deploy with:

```bash
firebase deploy --only firestore:rules
```

If the driver app sees `permission-denied`, the cause is almost always: rules not
deployed, the driver has no `drivers/{uid}` document, or `driver_id` on the order does
not equal the signed-in uid.

---

## 6. Definition of done for the delivery app

1. No `firebase/database` import anywhere; no `databaseURL` in config.
2. All reads/writes go through Firestore (`getDoc`, `getDocs`, `setDoc`, `addDoc`,
   `onSnapshot`) using the logical paths above.
3. Registration creates `drivers/{uid}` with `status: "pending"` and appears in the
   console's Driver Management list in real time.
4. Driver can only go online after console approval (`is_verified && is_active`).
5. Assigned orders appear live and advance only through
   `arrived → picked_up → on_the_way → delivered`, each with a timeline entry. The
   driver app must expose an explicit "I've arrived at the restaurant" action that
   writes `status: "arrived"` — the console will not let the order reach `picked_up`
   without it.
6. Location updates show the driver moving on the console's Live Map.
7. Cash collection writes into `orders/{id}.payment` and shows on the console's
   Payments page.

Console: https://console.firebase.google.com/project/e-comm-bd997/firestore
