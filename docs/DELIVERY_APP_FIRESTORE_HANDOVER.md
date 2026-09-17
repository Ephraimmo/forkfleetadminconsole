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
pending → accepted → preparing → ready → offered → assigned → arrived → picked_up → on_the_way → delivered
                                   ↘ rejected / cancelled / refunded (terminal)
```

**BREAKING CHANGE (2026-09-17, updated 2026-09-17): two new statuses inserted between
`ready` and `picked_up`: `offered` and `arrived`.**

- **`offered → assigned` (driver accepting) has NO staff override, ever.** Staff's
  only lever is re-offering the order to a different driver while it's still
  `offered`. Until the driver app writes this, an order stays `offered` (staff can
  keep cycling through drivers, but nothing completes without this write).
- **`assigned → arrived` DOES have a staff fallback** ("Mark arrived at restaurant" in
  the console) — added back 2026-09-17 after real orders got permanently stuck with no
  way to move them while this write wasn't shipped yet. Prefer writing this from the
  driver app once you can; the staff fallback exists so operations doesn't grind to a
  halt in the meantime, not as a signal that this write is optional.

- `ready` is the only status at which the console offers a driver (`driver_id` set,
  status → `offered`). Staff may re-offer a different driver while status is still
  `offered` (the driver hasn't accepted yet) — once `assigned`, staff can no longer
  swap drivers through the normal assign flow.
- **`offered → assigned`** (driver accepts): write the moment the driver taps
  "Accept" in the driver app, only when `order.driver_id === myDriverId`. Patch:
  `{ status: "assigned", driver_accepted_at: ISO string, updated_at: ISO string }`.
  If the driver declines/ignores, do **not** write anything — staff will re-offer to a
  different driver from the console; the order stays `offered` until then.
- **`assigned → arrived`**: write the moment the driver taps "I've arrived at the
  restaurant", only when `order.driver_id === myDriverId`. Patch:
  `{ status: "arrived", arrived_at: ISO string, updated_at: ISO string }`.
- **Driver app may only advance:** `offered → assigned → arrived → picked_up →
  on_the_way → delivered`, and only when `order.driver_id === myDriverId`. Never write
  terminal statuses (`cancelled`, `refunded`, `rejected`) — those belong to the
  console. `offered → assigned` is **driver-app exclusive** — the console has no
  button for it. `assigned → arrived → picked_up → on_the_way → delivered` may be
  written by **either** the driver app or console staff (staff keep their existing
  "Mark arrived at restaurant" / "Mark picked up" / "Mark on the way" / "Mark
  delivered" buttons).
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

## 5. Security rules (updated in the repo 2026-09-17 — **NOT YET DEPLOYED**)

`firestore.rules` in this repo now grants a signed-in driver write access to their own
profile and read/update access to orders assigned to them — this is required for
everything in section 3.3 above to work (offer-accept, arrived, etc.). Relevant
excerpt:

```
function isDriverSelf(driverId) {
  return signedIn() && request.auth.uid == driverId;
}
function isOrderDriver() {
  return signedIn() && resource.data.driver_id == request.auth.uid;
}

match /orders/{orderId} {
  allow read, update: if isPlatformAdmin() || isAnyRestaurantMember() || isOrderDriver();
  allow create, delete: if isPlatformAdmin() || isAnyRestaurantMember();
  match /{document=**} {
    allow read, write: if isPlatformAdmin() || isAnyRestaurantMember()
      || (signedIn()
          && get(/databases/$(database)/documents/orders/$(orderId)).data.driver_id == request.auth.uid);
  }
}

match /drivers/{driverId} {
  allow read: if signedIn();
  allow create, update: if isDriverSelf(driverId) || isPlatformAdmin() || isAnyRestaurantMember();
  allow delete: if isPlatformAdmin() || isAnyRestaurantMember();
}
```

**This change is only committed to the repo — someone with Firebase CLI access to the
`e-comm-bd997` project still needs to run:**

```bash
firebase deploy --only firestore:rules
```

Until that deploy happens, every driver-app write described in section 3.3
(`offered → assigned`, `assigned → arrived`, etc.) will fail with `permission-denied`,
even once the driver app's code is correct. If the driver app sees
`permission-denied` after that deploy, check: the driver has no `drivers/{uid}`
document, or `driver_id` on the order does not equal the signed-in uid.

---

## 6. Definition of done for the delivery app

1. No `firebase/database` import anywhere; no `databaseURL` in config.
2. All reads/writes go through Firestore (`getDoc`, `getDocs`, `setDoc`, `addDoc`,
   `onSnapshot`) using the logical paths above.
3. Registration creates `drivers/{uid}` with `status: "pending"` and appears in the
   console's Driver Management list in real time.
4. Driver can only go online after console approval (`is_verified && is_active`).
5. Offered orders (`status: "offered"`) appear live for the assigned driver, who must
   be able to **Accept** (writes `status: "assigned"`, `driver_accepted_at`). If they
   don't act, staff will re-offer to someone else from the console — no decline write
   needed.
6. Once `assigned`, the driver app must expose an explicit "I've arrived at the
   restaurant" action that writes `status: "arrived"`, `arrived_at`. The console has a
   staff fallback for this specific step ("Mark arrived at restaurant") so operations
   aren't blocked while this ships, but write it from the app as the primary path —
   the accept step (`offered → assigned`) has **no fallback at all**, so no order can
   complete without it regardless.
7. From `arrived` onward, orders advance through `picked_up → on_the_way →
   delivered`, each with a timeline entry.
8. Location updates show the driver moving on the console's Live Map.
9. Cash collection writes into `orders/{id}.payment` and shows on the console's
   Payments page.

Console: https://console.firebase.google.com/project/e-comm-bd997/firestore
