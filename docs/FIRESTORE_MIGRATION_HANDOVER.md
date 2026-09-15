# Firestore Migration & Integration Handover

**Project:** ForkFleet Restaurant Management (admin console)
**Firebase project:** `e-comm-bd997`
**Status:** Realtime Database fully removed. All app data reads/writes go to Cloud Firestore.

This document is the technical source of truth for every app that shares this
backend (admin console, kitchen UI, customer app, driver app).

---

## 1. What changed

| Before | After |
| --- | --- |
| `firebase/database` (`ref`, `get`, `set`, `update`, `push`, `onValue`) | `firebase/firestore` (`doc`, `collection`, `getDoc`, `setDoc`, `updateDoc`, `addDoc`, `onSnapshot`) |
| `src/lib/firebase.ts` (RTDB helpers) | `src/lib/firestore.ts` (single data layer) |
| `database.rules.json` | `firestore.rules` |
| `databaseURL` in config | removed (Firestore uses `projectId`) |

No routes, navigation, workflows, component structure, or UX changed.

### Data-layer primitives (`src/lib/firestore.ts`)

```ts
fsGet(path)                  // read a doc, collection, or nested field
fsSet(path, value)           // create/replace (merge-free for docs)
fsUpdate(path, partial)      // shallow/nested field update
fsPush(path, value)          // auto-id document in a collection -> returns id
fsSubscribe(path, cb)        // realtime listener (onSnapshot)
// *WithApp variants target a secondary Firebase app instance
```

All primitives accept the **same logical paths the app has always used**, so call
sites were renamed only (`rtdbGet` -> `fsGet`, `RTDBValue` -> `FirestoreValue`,
`toRtdb` -> `toFirestore`).

---

## 2. Path mapping rules

1. `COLLECTIONS` in `src/lib/firestore.ts` declares which logical prefixes are
   Firestore **collections**. The segment right after a collection is a document
   id; anything deeper becomes a **nested field path** inside that document —
   matching the old RTDB subtree semantics.
2. Firestore collection paths must have an odd segment count. When a logical
   collection path is even-length, the container document `_` is inserted before
   the final segment. Ids, names, and hierarchy are otherwise untouched.

### Mapping table

| Logical path (unchanged in app code) | Firestore location |
| --- | --- |
| `restaurants/{id}` | `restaurants/{id}` (doc) |
| `restaurants/{id}/payment_methods` | field `payment_methods` on `restaurants/{id}` |
| `restaurantBranches/{restaurantId}/{branchId}` | field `{branchId}` on `restaurantBranches/{restaurantId}` |
| `menus/{rid}/categories/{id}` | `menus/{rid}/categories/{id}` (doc) |
| `menus/{rid}/items/{id}` | `menus/{rid}/items/{id}` (doc) |
| `menus/{rid}/variants|addons|modifiers/{id}` | same shape as above |
| `orders/{id}` | `orders/{id}` (doc) |
| `orders/{id}/payment` | field `payment` on `orders/{id}` |
| `drivers/{id}` | `drivers/{id}` (doc) |
| `driverAssignments/{id}` | `driverAssignments/{id}` (doc) |
| `staffUsers/{uid}`, `restaurantUsers/{uid}` | docs |
| `staffAudit/{id}`, `restaurantUserAudit/{id}` | docs |
| `promotions/codes/{id}` | `promotions/_/codes/{id}` |
| `promotions/combos/{id}` | `promotions/_/combos/{id}` |
| `promotions/restaurant_points/{rid}` | `promotions/_/restaurant_points/{rid}` |
| `settings/{section}` | `settings/{section}` (doc) |
| `settingsAudit/{id}` | doc |
| `support/tickets/{id}` | `support/_/tickets/{id}` |
| `support/messages/{id}` | `support/_/messages/{id}` |
| `uploads/images/{id}` | `uploads/_/images/{id}` |
| `notificationAlerts|Triggers|Reads|Audit/{id}` | docs |

---

## 3. Shared data contract

- **Ids** are strings; auto-ids come from `fsPush` (Firestore `addDoc`).
- **Timestamps** are ISO-8601 strings (`created_at`, `updated_at`) — not
  Firestore `Timestamp` objects — so all client apps parse them identically.
- **Money** is stored in major units as numbers (e.g. `fee: 15`).
- **Booleans** are always present on restaurants: `delivery_enabled`,
  `pickup_enabled`, `is_active`.
- **Tenant key** on every tenant-scoped doc: `restaurant_id`.
- **Undefined is never written** — the layer strips `undefined` before writing.
- **Nested maps** (branches, payment methods, permissions) are plain objects
  keyed by id, preserving the old RTDB shape.

Consumer apps must read/write only through these logical paths.

---

## 4. Security rules

`firestore.rules` (registered in `firebase.json` under `firestore.rules`).

Role model:
- `staffUsers/{uid}.roles.{super_admin|platform_admin|operations_manager} == true`
  grants platform-wide access.
- `restaurantUsers/{uid}` with `status == 'active'` grants access scoped to
  `restaurant_id`.
- First staff account may bootstrap itself as `super_admin`.
- Audit collections are append-friendly for signed-in users, read-only for
  platform admins.

Deploy:

```bash
firebase deploy --only firestore:rules
```

---

## 5. Operations notes

- Indexes: composite indexes may be requested by the console on first query
  (orders by `restaurant_id` + `created_at`). Create them from the error link.
- The data layer is SSR-safe: `firebase/firestore` is imported only in the
  browser; server render returns empty results and the client hydrates.
- If reads fail with `permission-denied`, either the signed-in user has no
  `staffUsers`/`restaurantUsers` document, or the latest `firestore.rules` is
  not deployed.
- Console: https://console.firebase.google.com/project/e-comm-bd997/firestore

---

## 6. Migrating legacy RTDB data (one-off)

Export the old database and import into Firestore preserving the mapping above:

```bash
firebase database:get / --project e-comm-bd997 > rtdb-export.json
# then transform with the mapping table in section 2 and write via the Admin SDK
```

Even-length collection paths must gain the `_` container document during import.
