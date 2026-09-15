# Restaurant Admin — Location & Branch Management Handover

**Backend:** Cloud Firestore, Firebase project `e-comm-bd997` (no Realtime Database).
**Audience:** the AI/dev building the **Restaurant Management admin** app.
**Goal:** restaurant admins can edit their own restaurant location and create/edit/delete
their branches, and every change appears immediately in the Super Admin console
(and vice versa) because both apps read and write the exact same Firestore documents.

Read this together with `docs/FIRESTORE_MIGRATION_HANDOVER.md` (path mapping rules,
data-layer primitives, shared contract).

---

## 1. What is already in place (no super-admin change required)

- `firestore.rules` already grants an active `restaurantUsers/{uid}` member full
  read/write on `restaurants/{restaurant_id}` and `restaurantBranches/{restaurant_id}`
  (plus any nested field), and platform admins have the same access.
- Super Admin already reads branches live from `restaurantBranches` via
  `subscribeAllBranches` / `subscribeRestaurantBranches` and uses that list for
  dispatch and driver assignment.
- Restaurant location fields (`latitude`, `longitude`, `address`, `city`,
  `delivery_radius_km`, `delivery_tiers`) already live on `restaurants/{id}` and are
  what the super admin, dispatch, and live map use.

So the restaurant app only has to write to these same paths — no new collections,
no sync job, no duplicated location data.

---

## 2. Paths to use

| Purpose | Logical path | Firestore location |
| --- | --- | --- |
| Restaurant record (location lives here) | `restaurants/{restaurantId}` | document |
| Single restaurant field | `restaurants/{restaurantId}/address` | field on that doc |
| Branch registry for one restaurant | `restaurantBranches/{restaurantId}` | document (map of branches) |
| One branch | `restaurantBranches/{restaurantId}/{branchId}` | field `{branchId}` on that doc |

`restaurantBranches/{restaurantId}` is a **single document whose fields are branch ids**
(the old RTDB subtree shape). Never create a `restaurantBranches/{rid}/branches/...`
subcollection — the super admin will not see it.

Branch ids: `brn-<slug-or-random>`, stable and never reused.

---

## 3. Restaurant location contract (`restaurants/{id}`)

Fields the restaurant admin may change:

```ts
address: string | null
city: string
latitude: number | null      // decimal degrees, e.g. -26.1662
longitude: number | null     // decimal degrees, e.g. 28.0426
delivery_radius_km: number   // > 0
delivery_tiers: { up_to_km: number; fee: number }[]  // sorted ascending by up_to_km
delivery_enabled: boolean
pickup_enabled: boolean
opens_at: string             // "HH:mm"
closes_at: string            // "HH:mm"
prep_time_minutes: number
phone: string | null
email: string | null
image_url: string | null
updated_at: string           // ISO-8601, set on every write
```

Fields the restaurant admin must **NOT** write (super-admin owned):
`status`, `commission_rate`, `rating`, `rating_count`, `slug`, `created_at`, `id`.

Rules:
- Always write `latitude`/`longitude` as **numbers**, never strings; write `null` when unknown.
- `delivery_radius_km` must be `>= max(delivery_tiers[].up_to_km)`; the super admin
  auto-extends the radius when tiers exceed it, so keep them consistent to avoid churn.
- Never write `undefined` — omit the key instead.
- Use field-level updates for location edits so concurrent super-admin edits are not
  clobbered: update `address`, `city`, `latitude`, `longitude`, `updated_at` only.

---

## 4. Branch contract (`restaurantBranches/{restaurantId}/{branchId}`)

```ts
{
  id: string;                 // equals the field key
  restaurant_id: string;      // tenant key, always set
  name: string;               // e.g. "Sandton City"
  code?: string | null;       // internal branch code
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  delivery_radius_km?: number;
  is_main?: boolean;          // exactly one branch true per restaurant
  is_active?: boolean;        // false hides it from dispatch/customer app
  status?: "approved" | "pending" | "suspended" | null;
  opens_at?: string;          // "HH:mm"
  closes_at?: string;
  created_at: string;         // ISO-8601
  updated_at: string;         // ISO-8601
}
```

Invariants the super admin relies on:
1. `id` and `restaurant_id` are always present and correct — dispatch groups drivers by them.
2. `name` is human readable; the super admin falls back to a prettified id when missing,
   which produces confusing labels, so always send a name.
3. Exactly one branch has `is_main: true`. When the admin promotes a new main branch,
   clear the flag on the previous one in the same write.
4. Deleting a branch = delete the field from `restaurantBranches/{rid}`. Prefer
   `is_active: false` when orders reference the branch historically.
5. A restaurant with no branch document is treated as single-location; the app should
   create a `main` branch on first location save so dispatch has something to bind to.

---

## 5. Reads and writes (mirror the super-admin data layer)

Use the same primitives described in `docs/FIRESTORE_MIGRATION_HANDOVER.md`:

```ts
// location
await fsUpdate(`restaurants/${rid}`, { address, city, latitude, longitude, updated_at: now });

// create / edit branch (nested field update — does not touch sibling branches)
await fsUpdate(`restaurantBranches/${rid}`, { [branchId]: branch });

// live branch list for the signed-in restaurant
fsSubscribe(`restaurantBranches/${rid}`, (map) => setBranches(toList(map)));

// delete a branch field
await fsUpdate(`restaurantBranches/${rid}`, { [branchId]: deleteField() });
```

Always scope every read and write to the signed-in user's `restaurant_id` from
`restaurantUsers/{uid}` — the rules enforce it, and cross-tenant reads will fail
with `permission-denied`.

Use `onSnapshot` (not polling) for branch lists so a super-admin edit shows up
instantly on the restaurant side.

---

## 6. Access requirements

- The signed-in user must have `restaurantUsers/{uid}` with
  `{ uid, restaurant_id, status: "active", permissions: {...} }`.
- Suggested permission codes to gate the UI:
  `restaurant.location.manage`, `restaurant.branches.manage`.
- `permission-denied` on these paths means either the user document is missing/inactive
  or the latest rules are not deployed:

```bash
firebase deploy --only firestore:rules
```

---

## 7. Linking checklist (do all of these)

- [ ] Remove any remaining `firebase/database` usage; Firestore only, no `databaseURL`.
- [ ] Write location to `restaurants/{restaurantId}` — do not create a separate
      `locations` collection.
- [ ] Write branches to `restaurantBranches/{restaurantId}` as map fields.
- [ ] Numbers for coordinates, ISO strings for timestamps, `restaurant_id` on every branch.
- [ ] Never write super-admin-owned fields (`status`, `commission_rate`, ratings).
- [ ] Keep exactly one `is_main` branch; keep `delivery_radius_km` >= largest tier.
- [ ] Subscribe with `onSnapshot` so super-admin changes appear live.
- [ ] Verify end to end: edit location + add a branch in the restaurant app, then
      confirm the Super Admin console (Restaurants detail + Dispatch branch picker)
      shows the change without a reload.

---

## 8. Super-admin side status

No schema or code change is needed on the Super Admin console for this feature:
rules, paths, branch subscriptions, and location fields are already in place and
authoritative. If the restaurant app introduces a new branch field, add it to the
table in section 4 of this document and to `docs/FIRESTORE_MIGRATION_HANDOVER.md`
so both apps stay contract-aligned.
