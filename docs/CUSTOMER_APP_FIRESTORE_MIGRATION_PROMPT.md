# Handover — Migrate the Customer App from Realtime Database to Cloud Firestore

**From:** ForkFleet Console (operator portal) — already fully migrated
**To:** the AI/developer building the customer-facing ordering app
**Firebase project:** `e-comm-bd997` (shared by both apps)
**Companion doc:** `docs/FIRESTORE_MIGRATION_HANDOVER.md` (path mapping table,
data contract, security rules). That document is normative — this one tells you
what to change in the customer app.

---

## 0. Why you are getting this

The operator portal no longer uses the Realtime Database at all. Every
restaurant, menu, order, promotion, loyalty and support record is now read from
and written to **Cloud Firestore**. The `databaseURL` was removed from the
Firebase config and `database.rules.json` was deleted.

**Consequence:** any customer app still writing to RTDB is writing into a
database nobody reads. Orders will never appear in the console, menu/promotion
changes made by staff will never reach customers, and payment evidence will not
sync. Migrating the customer app to Firestore is required for the two apps to
stay linked.

---

## 1. What to change

1. Replace `firebase/database` with `firebase/firestore` everywhere.

   | Before (RTDB) | After (Firestore) |
   | --- | --- |
   | `getDatabase(app)` | `getFirestore(app)` |
   | `ref(db, path)` | `doc(db, path)` / `collection(db, path)` |
   | `get(ref)` | `getDoc(doc)` / `getDocs(collection)` |
   | `set(ref, v)` | `setDoc(doc, v)` |
   | `update(ref, v)` | `updateDoc(doc, v)` |
   | `push(ref, v)` | `addDoc(collection, v)` |
   | `onValue(ref, cb)` | `onSnapshot(doc/collection, cb)` |
   | `runTransaction(ref, fn)` | `runTransaction(db, async (tx) => …)` |
   | `remove(ref)` | `deleteDoc(doc)` |

2. Remove `databaseURL` from the Firebase config. Use exactly:

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

3. Build **one data layer module** (mirror of the portal's `src/lib/firestore.ts`)
   exposing five primitives that accept the *logical* paths the app already uses:

```ts
fsGet(path)               // read doc, collection, or nested field
fsSet(path, value)        // create/replace
fsUpdate(path, partial)   // shallow/nested field update
fsPush(path, value)       // auto-id doc in a collection -> returns id
fsSubscribe(path, cb)     // realtime listener (onSnapshot)
```

Do **not** sprinkle `doc()`/`collection()` calls through screens — every read and
write goes through this module so path mapping stays in one place.

---

## 2. Keep the logical paths — map them, don't rename them

All existing paths from the promotions/payments integration guides stay the same
in app code. The data layer translates them using two rules:

1. A declared **collection prefix** is a Firestore collection; the next segment
   is a document id; anything deeper is a **nested field path inside that
   document** (same semantics as the old RTDB subtree).
2. Firestore collection paths must have an **odd** segment count. When a logical
   collection path is even-length, insert the container document `_` before the
   final segment.

Declared collection prefixes (`*` = one dynamic segment) — must match the portal
exactly:

```
restaurants, restaurantBranches, orders, drivers, driverAssignments,
staffUsers, staffAudit, restaurantUsers, restaurantUserAudit,
menus/*/categories, menus/*/items, menus/*/variants, menus/*/addons, menus/*/modifiers,
promotions, promotions/codes, promotions/combos, promotions/restaurant_points,
notificationAlerts, notificationTriggers, notificationReads, notificationAudit,
settings, settingsAudit, support/tickets, support/messages, uploads/images,
loyalty/wallets, loyalty/ledger, loyalty/earned_orders
```

### Mapping table for the paths the customer app touches

| Logical path (unchanged in code) | Firestore location |
| --- | --- |
| `restaurants/{rid}` | `restaurants/{rid}` (doc) |
| `restaurants/{rid}/payment_methods` | field `payment_methods` on `restaurants/{rid}` |
| `restaurants/{rid}/payment_config` | field `payment_config` on `restaurants/{rid}` |
| `restaurants/{rid}/delivery_tiers` | field `delivery_tiers` on `restaurants/{rid}` |
| `restaurantBranches/{rid}/{branchId}` | field `{branchId}` on `restaurantBranches/{rid}` |
| `menus/{rid}/items/{itemId}` | `menus/{rid}/items/{itemId}` (doc) |
| `menus/{rid}/categories|variants|addons|modifiers/{id}` | same shape |
| `orders/{orderId}` | `orders/{orderId}` (doc) |
| `orders/{orderId}/payment` | field `payment` on `orders/{orderId}` |
| `promotions/codes/{couponId}` | `promotions/_/codes/{couponId}` |
| `promotions/combos/{comboId}` | `promotions/_/combos/{comboId}` |
| `promotions/global/points_config` | field `points_config` on `promotions/global` |
| `promotions/restaurant_points/{rid}` | `promotions/_/restaurant_points/{rid}` |
| `loyalty/wallets/{customerId}` | `loyalty/_/wallets/{customerId}` |
| `loyalty/ledger/{entryId}` | `loyalty/_/ledger/{entryId}` |
| `loyalty/earned_orders/{customerId}` | `loyalty/_/earned_orders/{customerId}` (order ids as fields) |
| `support/tickets/{ticketId}` | `support/_/tickets/{ticketId}` |
| `support/messages/{messageId}` | `support/_/messages/{messageId}` |
| `uploads/images/{id}` | `uploads/_/images/{id}` |

---

## 3. Shared data contract (both apps must obey)

- **Ids** are strings; auto-ids come from `addDoc`.
- **Timestamps** are ISO-8601 strings (`created_at`, `updated_at`, `paid_at`),
  never Firestore `Timestamp` objects — so both apps parse identically.
- **Money** is stored in major units as numbers (`total: 154.5`), currency ZAR.
- **Tenant key** on every tenant-scoped doc: `restaurant_id`.
- **Never write `undefined`** — strip it before writing (Firestore rejects it).
- **Nested maps** (branches, payment methods, payment evidence, permissions) stay
  plain objects keyed by id — the old RTDB shape is preserved.
- Booleans `delivery_enabled`, `pickup_enabled`, `is_active` are always present
  on restaurants.
- Order lifecycle and `order_type: "delivery" | "pickup"` semantics are unchanged.

---

## 4. Realtime linkage between the two apps

Where you used `onValue`, use `onSnapshot`:

- Menu availability / prices: `menus/{rid}/items` collection listener.
- Payment methods a restaurant accepts: doc listener on `restaurants/{rid}`,
  read the `payment_methods` / `payment_config` field.
- Promotions: collection listeners on `promotions/_/codes`,
  `promotions/_/combos`, `promotions/_/restaurant_points`, doc listener on
  `promotions/global`.
- Order status + payment evidence: doc listener on `orders/{orderId}` — the
  console's status changes and "mark as paid" actions must reflect in ~1 s.
- Queries the console uses (for parity): orders filtered by `restaurant_id`
  and ordered by `created_at`. A composite index may be requested on first run —
  create it from the link in the error.

Transactions: coupon `usage_count` increments and every loyalty balance mutation
must use Firestore `runTransaction(db, …)`, keeping earning idempotent via
`loyalty/earned_orders/{customerId}` fields.

---

## 5. Write boundaries (unchanged, now enforced by `firestore.rules`)

The customer app may write only:

- `orders/{orderId}` including the `payment` evidence field
- coupon `usage_count` on `promotions/_/codes/{id}`
- `loyalty/**`
- `support/_/tickets` + `support/_/messages` it owns

It must **never** write `restaurants/**`, `menus/**`, `promotions/**` config,
`drivers/**`, `settings/**`, `staffUsers/**` or `restaurantUsers/**` —
those are portal-owned and the rules will reject it.

Rules live in the portal repo (`firestore.rules`, registered in `firebase.json`)
and are deployed with `firebase deploy --only firestore:rules`. A
`permission-denied` error means either the write was outside the boundary above
or the customer is not signed in.

---

## 6. Definition of done

1. No `firebase/database` import, no `databaseURL`, no `ref/onValue/push`
   anywhere in the customer app.
2. All reads/writes go through the single Firestore data layer using the logical
   paths in §2.
3. Place an order end-to-end: it appears in the ForkFleet Console orders list
   immediately, with matching totals, `order_type`, and `payment` evidence
   (`receipt_number = "R-" + order_number`).
4. Staff change the order status / mark a cash order paid in the console → the
   customer app reflects it within ~1 s without a reload.
5. Staff toggle a payment method or a coupon in the console → checkout updates
   live.
6. Menu item price/availability edited in the console → visible in the app live.
7. Typecheck, lint and production build clean.

Report results item by item, and flag any place where existing customer-app code
conflicts with this document — this document and
`docs/FIRESTORE_MIGRATION_HANDOVER.md` win.
