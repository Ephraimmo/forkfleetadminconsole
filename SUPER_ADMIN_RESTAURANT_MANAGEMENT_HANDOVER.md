# Super Admin → Restaurant Management Integration Handover

> **Document purpose:** Give the next AI/developer everything needed to connect the existing **Restaurant Management Web Application** to the completed **ForkFleet Super Admin Console** without guessing architecture, field names, or permissions.
>
> **Status as of Step 1 completion:** Super Admin is prepared. Restaurant Management app is **NOT connected yet**.

---

## 1. Executive Summary

The ForkFleet platform uses **one Firebase project** (`e-comm-bd997`) with **Firebase Authentication** (email/password) and **Firebase Realtime Database (RTDB)** — **not Firestore**.

| Application | Role |
|-------------|------|
| **Super Admin Console** (`forkfleetadminconsole`) | Manages multiple restaurants, provisions Restaurant Management users, assigns roles/permissions, and is the authority for access control. |
| **Restaurant Management App** (separate codebase) | Must operate **one assigned restaurant** per authenticated user, using the same Firebase Auth + RTDB data. |

> The Super Admin application manages multiple restaurants and controls access.
>
> The Restaurant Management application operates the single restaurant assigned to the authenticated user.

**Step 1 delivered:**
- Access Control → **Restaurant Management** tab
- Real Firebase Auth user provisioning
- RTDB profile at `/restaurantUsers/{uid}` with `restaurant_id`, `role`, `permissions`, `status`
- Versioned security rules in `database.rules.json`
- Prepared sign-in API: `signInRestaurantUserWithFirebase()` in `restaurant-users.firebase.ts`

**Step 2 must deliver:**
- Wire Restaurant Management login to the same Firebase Auth
- Load `/restaurantUsers/{uid}` after sign-in
- Scope all reads/writes to `session.restaurantId`
- Enforce permissions from Super Admin (UI + RTDB rules)
- **No manual restaurant picker after login**

---

## 2. Application Architecture

### Super Admin Console (this repo)

| Layer | Technology | Location |
|-------|------------|----------|
| Frontend | React 19, TypeScript, TanStack Router/Start, Tailwind, Radix/shadcn | `src/routes/`, `src/components/` |
| SSR | TanStack Start + Nitro | `src/start.ts`, `src/server.ts` |
| Primary database | **Firebase Realtime Database** | `src/lib/firebase.ts`, `src/lib/*.firebase.ts` |
| Auth (Super Admin UI) | Demo localStorage **or** Firebase Auth for `/staffUsers` | `src/lib/session.functions.ts`, `src/lib/auth.firebase.ts` |
| Auth (Restaurant user provisioning) | Firebase Auth via secondary app `forkfleet-provisioner` | `src/lib/restaurant-users.firebase.ts` |
| Secondary/planned DB | Supabase PostgreSQL schema exists | `supabase/migrations/` — **NOT used at runtime for most UI** |

### Restaurant Management App (separate — not in this repo)

**NOT IMPLEMENTED in this repository.** The integrating developer must locate that codebase separately and connect it using this document.

Both apps must share:
- Same `FIREBASE_CONFIG` (see §5)
- Same Firebase Auth users (Restaurant Management users are real Auth accounts)
- Same RTDB paths and field names

They may have completely different UI/UX.

---

## 3. Super Admin Responsibilities

The Super Admin Console is the **central authority** for:

| Domain | RTDB / Auth | Super Admin UI |
|--------|-------------|----------------|
| Restaurants (create, approve, suspend) | `/restaurants/{id}` | `/restaurants` |
| Restaurant Management users | `/restaurantUsers/{uid}` + Firebase Auth | `/access` → Restaurant Management tab |
| Platform staff | `/staffUsers/{uid}` + Firebase Auth | `/access` → Team tab |
| User → restaurant assignment | `restaurantUsers.{uid}.restaurant_id` | Assign in create/edit dialog |
| Roles & permissions (RM app) | `restaurantUsers.{uid}.role`, `.permissions` | Permission picker in Access Control |
| Access audit | `/restaurantUserAudit`, `/staffAudit` | Written automatically on mutations |

Super Admin does **not** require Restaurant Management users to pick a restaurant at login — assignment is stored on the user profile.

---

## 4. Restaurant Management Responsibilities

The Restaurant Management application must:

1. Authenticate with **Firebase Auth** (same project).
2. Read `/restaurantUsers/{auth.uid}`.
3. Reject users with no profile, `status: "suspended"`, or `is_deleted: true`.
4. Load **exactly one restaurant**: `/restaurants/{restaurant_id}`.
5. Apply permission codes from the profile (e.g. hide/disable modules without `rm.orders.view`).
6. Query operational data **scoped to `restaurant_id`** (orders, menus, drivers, etc.).
7. **Never** trust client-supplied `restaurantId` over the profile's `restaurant_id`.

Operational modules (expected in RM app, permissions defined in Super Admin):

- Dashboard, Profile, Menu, Orders, Kitchen, Tables, Customers, Inventory, Delivery, Drivers, Payments, Promotions, Reports, Settings

---

## 5. Firebase Architecture

### Project configuration

**File:** `src/lib/firebase.ts`

```typescript
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBCTflur84nQjEc-YdsD_p2sR8eI7BD6nA",
  authDomain: "e-comm-bd997.firebaseapp.com",
  databaseURL: "https://e-comm-bd997-default-rtdb.firebaseio.com",
  projectId: "e-comm-bd997",
  storageBucket: "e-comm-bd997.appspot.com",
  messagingSenderId: "280613901400",
  appId: "1:280613901400:web:bf168e55508b9102dda62d",
};
```

### Database type

| System | Status |
|--------|--------|
| **Firebase Realtime Database** | **LIVE** — all shared business data |
| **Firestore** | **NOT IMPLEMENTED** |
| **Supabase PostgreSQL** | Schema + RLS exist; **NOT used** by Restaurant Management integration path |

### Named Firebase apps

| App name | Purpose |
|----------|---------|
| `forkfleet-main` | Default RTDB client + Restaurant Management sign-in |
| `forkfleet-provisioner` | Super Admin creates Auth users without replacing admin session |

### RTDB helper API

**File:** `src/lib/firebase.ts`

- `rtdbGet(path)`, `rtdbSet(path, value)`, `rtdbUpdate(path, partial)`, `rtdbPush(path, value)`, `rtdbSubscribe(path, callback)`
- `rtdbSetWithApp(appName, path, value)` — write using provisioner auth context (used when creating `/restaurantUsers/{uid}`)

---

## 6. Authentication Flow

### A. Super Admin provisions a Restaurant Management user

```
Super Admin → Access Control → Restaurant Management → Add user
  │
  ├─► forkfleet-provisioner: createUserWithEmailAndPassword(email, password)
  │     └─► Firebase Auth UID created
  │
  ├─► forkfleet-provisioner (authenticated as new user):
  │     rtdbSetWithApp → /restaurantUsers/{uid}
  │
  └─► provisioner signOut (admin session unchanged)
```

**Service:** `createRestaurantUser()` in `src/lib/restaurant-users.firebase.ts`

**Orphan recovery:** If Auth account exists but RTDB profile is missing (prior failed write), retry with same email+password completes the profile.

### B. Restaurant Management user login (Step 2 — prepared, not wired in Super Admin UI)

```
User enters email + password
  │
  ├─► forkfleet-main: signInWithEmailAndPassword
  │
  ├─► rtdbGet /restaurantUsers/{auth.uid}
  │     ├─ missing / is_deleted → signOut, reject
  │     ├─ status === "suspended" → signOut, reject
  │     └─ active → build RestaurantUserSession
  │
  ├─► rtdbGet /restaurants/{restaurant_id}
  │
  └─► Initialize app with session.restaurantId + session.permissions
```

**Service:** `signInRestaurantUserWithFirebase()` in `src/lib/restaurant-users.firebase.ts`

**Session refresh:** `refreshRestaurantUserSession()` re-reads `/restaurantUsers/{uid}` so permission/status changes apply without re-login.

### C. Platform staff (Super Admin console operators)

Separate path — `/staffUsers/{uid}` with platform roles (`super_admin`, etc.). **Do not confuse** with `/restaurantUsers`.

| Path | Used by |
|------|---------|
| `/staffUsers/{uid}` | Super Admin / Operations Console login |
| `/restaurantUsers/{uid}` | Restaurant Management app login |

Both share Firebase Auth credential store; profile type is determined by which RTDB path has data.

---

## 7. User Data Model

### Collection path

**`/restaurantUsers/{uid}`** where `{uid}` === Firebase Auth UID.

### Wire format (RTDB)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uid` | string | yes | Firebase Auth UID (must match path key) |
| `email` | string | yes | Lowercase email |
| `full_name` | string | yes | Display name |
| `job_title` | string \| null | no | Job title |
| `phone` | string \| null | no | Phone number |
| `restaurant_id` | string | yes | **Single assigned restaurant** (e.g. `rst-nonna`) |
| `role` | string | yes | One of `RestaurantRole` values (see §10) |
| `permissions` | object map | yes | Encoded keys → `true` (see §11) |
| `status` | string | yes | `"active"` \| `"suspended"` |
| `is_deleted` | boolean | yes | Soft-delete flag; `true` = no access |
| `created_at` | string (ISO) | yes | Provision timestamp |
| `created_by` | string \| null | no | Super Admin email who created user |
| `updated_at` | string (ISO) | no | Last profile update |
| `last_login_at` | string (ISO) \| null | no | Updated on RM app sign-in |
| `removed_at` | string (ISO) | no | Set on soft-delete |
| `removed_by` | string \| null | no | Super Admin email who removed user |

### Example RTDB document

```json
{
  "uid": "bfLDMXyeTyeJ9WYC9luocKjPEHR2",
  "email": "owner@nonnas.co.za",
  "full_name": "Chloe Meyer",
  "job_title": "Restaurant Owner",
  "phone": "+27 82 123 4567",
  "restaurant_id": "rst-nonna",
  "role": "restaurant_owner",
  "permissions": {
    "rm_dashboard_view": true,
    "rm_profile_view": true,
    "rm_profile_manage": true,
    "rm_menu_view": true,
    "rm_menu_manage": true
  },
  "status": "active",
  "is_deleted": false,
  "created_at": "2026-08-23T09:00:00.000Z",
  "created_by": "avery.cole@forkfleet.demo",
  "last_login_at": null
}
```

### Normalized app type (Restaurant Management session)

**Type:** `RestaurantUserSession` in `src/lib/restaurant-users.firebase.ts`

| Field | Maps from RTDB |
|-------|------------------|
| `userId` | `uid` |
| `email` | `email` |
| `fullName` | `full_name` |
| `jobTitle` | `job_title` |
| `phone` | `phone` |
| `restaurantId` | `restaurant_id` |
| `role` | `role` |
| `permissions` | decoded array from `permissions` map |

### Audit trail

**Path:** `/restaurantUserAudit/{pushId}`

Actions: `restaurant_user.created`, `restaurant_user.profile_updated`, `restaurant_user.assignment_updated`, `restaurant_user.permissions_updated`, `restaurant_user.suspended`, `restaurant_user.reactivated`, `restaurant_user.removed`, `restaurant_user.password_reset_sent`, `restaurant_user.sign_in`

---

## 8. Restaurant Data Model

### Path

**`/restaurants/{id}`**

Restaurant document key equals the `id` field inside the document (e.g. `rst-nonna`).

### Fields (`FirebaseRestaurant`)

**File:** `src/lib/restaurants.firebase.ts`

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Primary identifier; used in `restaurantUsers.restaurant_id` |
| `name` | string | Display name |
| `slug` | string | URL slug |
| `cuisine` | string | Cuisine type |
| `email` | string \| null | Contact email |
| `phone` | string \| null | Contact phone |
| `address` | string \| null | Street address |
| `city` | string | City |
| `country` | string | Country code (e.g. `ZA`) |
| `currency` | string | e.g. `ZAR` |
| `status` | string | `approved` \| `pending` \| `suspended` \| `rejected` |
| `commission_rate` | number | Platform commission % |
| `delivery_enabled` | boolean | Delivery toggle |
| `pickup_enabled` | boolean | Pickup toggle |
| `delivery_radius_km` | number | Delivery radius |
| `delivery_tiers` | array | `{ id, up_to_km, fee, label? }[]` |
| `rating` | number | Average rating |
| `rating_count` | number | Review count |
| `prep_time_minutes` | number | Default prep time |
| `opens_at` | string | e.g. `"11:00"` |
| `closes_at` | string | e.g. `"22:30"` |
| `latitude` | number \| null | Geo |
| `longitude` | number \| null | Geo |
| `image_url` | string \| null | Cover/logo image URL |
| `created_at` | string (ISO) | Created timestamp |

### Sub-resources per restaurant

| Path | Purpose |
|------|---------|
| `/restaurants/{id}/payment_config` | Payment methods (`payments.firebase.ts`) |
| `/restaurantBranches/{restaurantId}/{branchId}` | Branches (`branches.firebase.ts`) |

### How RM app loads restaurant

```typescript
const profile = await fetchRestaurantUserByUid(auth.uid);
const restaurant = await rtdbGet(`/restaurants/${profile.restaurant_id}`);
```

**No duplicate restaurant records** — RM app reads the same `/restaurants/{id}` Super Admin maintains.

---

## 9. User → Restaurant Relationship

```
Firebase Auth UID
        │
        ▼
/restaurantUsers/{uid}
        │
        ├── restaurant_id: "rst-nonna"     ← SINGLE restaurant, set by Super Admin
        ├── role: "restaurant_owner"
        ├── permissions: { rm_* : true }
        └── status: "active"
        │
        ▼
/restaurants/rst-nonna
        │
        ├── name, address, settings, image_url, ...
        │
        ▼
Restaurant-scoped operational data:
  /menus/rst-nonna/...
  /orders/{orderId}  where order.restaurant_id === "rst-nonna"
  /driverAssignments/...  where restaurant_id === "rst-nonna"
```

### Rules

1. **One user → one restaurant** — enforced in Super Admin UI and data model. No multi-restaurant assignment.
2. **No post-login restaurant picker** — `restaurant_id` comes from `/restaurantUsers/{uid}`, not user choice.
3. **Cross-restaurant access blocked** — RTDB security rules compare `auth.uid`'s profile `restaurant_id` to data being accessed (see §14).

Example:

| User | `restaurant_id` | Can access | Cannot access |
|------|-----------------|------------|---------------|
| Manager A | `rst-nonna` | Nonna's data | `rst-braaishop`, others |
| Manager B | `rst-braaishop` | Braai Shop data | `rst-nonna`, others |

---

## 10. Roles

**File:** `src/lib/restaurant-permissions.ts`

| Role value | Label | Default scope |
|------------|-------|---------------|
| `restaurant_owner` | Restaurant Owner | All 26 RM permissions |
| `restaurant_manager` | Restaurant Manager | Operations (no payments.manage, limited settings) |
| `branch_manager` | Branch Manager | Branch ops, no profile.manage |
| `kitchen_manager` | Kitchen Manager | Kitchen + orders + inventory |
| `kitchen_staff` | Kitchen Staff | Kitchen queue only |
| `cashier` | Cashier | Orders, tables, customers, promos view |
| `inventory_manager` | Inventory Manager | Inventory + menu view + reports |

Role is stored as a **single string** on `/restaurantUsers/{uid}.role`. Permissions are stored separately and can be customized per user by Super Admin beyond role defaults.

---

## 11. Permissions

### Logical permission codes (app/session layer)

All codes use prefix `rm.` and module.action pattern:

| Module | View | Manage / other |
|--------|------|----------------|
| dashboard | `rm.dashboard.view` | — |
| profile | `rm.profile.view` | `rm.profile.manage` |
| menu | `rm.menu.view` | `rm.menu.manage` |
| orders | `rm.orders.view` | `rm.orders.manage` |
| kitchen | `rm.kitchen.view` | `rm.kitchen.manage` |
| tables | `rm.tables.view` | `rm.tables.manage` |
| customers | `rm.customers.view` | `rm.customers.manage` |
| inventory | `rm.inventory.view` | `rm.inventory.manage` |
| delivery | `rm.delivery.view` | `rm.delivery.manage` |
| drivers | `rm.drivers.view` | `rm.drivers.manage` |
| payments | `rm.payments.view` | `rm.payments.manage` |
| promotions | `rm.promotions.view` | `rm.promotions.manage` |
| reports | `rm.reports.view` | — |
| settings | `rm.settings.view` | `rm.settings.manage` |

**Full list:** `RESTAURANT_PERMISSIONS` in `src/lib/restaurant-permissions.ts`

### RTDB storage encoding (critical)

Firebase RTDB **object keys cannot contain `.`**. Permission maps in RTDB use encoded keys:

| Logical code | RTDB key |
|--------------|----------|
| `rm.dashboard.view` | `rm_dashboard_view` |
| `rm.profile.manage` | `rm_profile_manage` |
| `rm.menu.view` | `rm_menu_view` |

**Encode:** `encodePermissionKeyForRtdb(code)` — replaces `.` with `_`  
**Decode:** `decodePermissionKeyFromRtdb(key)` — for reading back to logical codes  
**Helpers:** `permissionsToMap(codes[])`, `mapToPermissions(map)`

Restaurant Management app should:
1. Read RTDB map with encoded keys
2. Decode to logical codes for UI checks: `session.permissions.includes("rm.orders.view")`

### Default permissions per role

**Constant:** `RESTAURANT_ROLE_PERMISSIONS` in `src/lib/restaurant-permissions.ts`  
**Helper:** `getDefaultPermissionsForRole(role)`

Super Admin can override defaults per user in the Access Control UI.

### Enforcement layers

| Layer | Status |
|-------|--------|
| Super Admin UI permission picker | Implemented |
| RM app UI module gating | **NOT IMPLEMENTED** (Step 2) |
| RTDB security rules | Implemented in `database.rules.json` (must be deployed) |

---

## 12. Firebase Realtime Database Collections Map

> **Note:** These are RTDB **paths**, not Firestore collections.

### Identity & access

| Path | Purpose | Restaurant link | RM user access |
|------|---------|-----------------|----------------|
| `/restaurantUsers/{uid}` | RM user profiles | `restaurant_id` field | Read own; write by platform staff or self on create |
| `/restaurantUserAudit/{id}` | RM access audit | — | Platform staff read |
| `/staffUsers/{uid}` | Platform staff profiles | — | Not for RM app |
| `/staffAudit/{id}` | Platform staff audit | — | Not for RM app |

### Restaurants

| Path | Purpose | Restaurant link |
|------|---------|-----------------|
| `/restaurants/{id}` | Restaurant master record | Key = restaurant ID |
| `/restaurants/{id}/payment_config` | Payment methods | Per restaurant |
| `/restaurantBranches/{restaurantId}/{branchId}` | Branches | Key prefix |

### Menus

| Path | Purpose | Restaurant link |
|------|---------|-----------------|
| `/menus/{restaurantId}/categories/{catId}` | Menu categories | Key segment |
| `/menus/{restaurantId}/items/{itemId}` | Products/items | Key segment |
| `/menus/{restaurantId}/variants/{varId}` | Item variants | Key segment |
| `/menus/{restaurantId}/addons/{addonId}` | Item add-ons | Key segment |

**Service:** `src/lib/menus.firebase.ts`

### Orders & kitchen

| Path | Purpose | Restaurant link |
|------|---------|-----------------|
| `/orders/{orderId}` | Order header; field `restaurant_id` | Field on document |
| `/orders/{orderId}/items/{lineId}` | Order lines | Parent order |
| `/orders/{orderId}/timeline/{eventId}` | Status timeline | Parent order |

**Order statuses:** `pending` → `accepted` → `preparing` → `ready` → `assigned` → `picked_up` → `on_the_way` → `delivered` | `cancelled` | `refunded`

**Service:** `src/lib/orders.firebase.ts`

Kitchen workflow in Super Admin reads orders filtered by `restaurant_id` and status — RM app should use the same order paths.

### Drivers & delivery

| Path | Purpose | Restaurant link |
|------|---------|-----------------|
| `/drivers/{driverId}` | Driver profile (from Driver App) | Via assignments |
| `/driverAssignments/{driverId}__{restaurantId}__{branchId}` | Driver ↔ restaurant | `restaurant_id` field |

**Service:** `src/lib/drivers.firebase.ts`

### Promotions

| Path | Purpose | Restaurant link |
|------|---------|-----------------|
| `/promotions/global/points_config` | Global loyalty config | Platform-wide |
| `/promotions/codes/{id}` | Promo codes | May reference restaurants |
| `/promotions/restaurant_points/{id}` | Per-restaurant points | Restaurant-specific |
| `/promotions/combos/{id}` | Combo deals | Restaurant-specific |

**Service:** `src/lib/promotions.firebase.ts`

### Other platform paths (Super Admin heavy)

| Path | Purpose | RM relevance |
|------|---------|--------------|
| `/settings/{section}` | Platform settings | Limited RM settings via restaurant profile |
| `/support/tickets/{id}` | Support desk | Optional RM integration |
| `/notificationAlerts/{id}` | In-app alerts | Optional |
| `/uploads/images` | Cloudinary upload log | Shared image uploads |

### NOT IMPLEMENTED as dedicated RTDB paths

| Feature | Status |
|---------|--------|
| `/tables/{restaurantId}` | **NOT IMPLEMENTED** — permission exists (`rm.tables.*`) but no RTDB tables module found |
| `/customers/{restaurantId}` | **NOT IMPLEMENTED** in Firebase layer — Super Admin customers page uses demo store |
| Firestore collections | **NOT IMPLEMENTED** |
| Dedicated `/inventory/{restaurantId}` | **NOT IMPLEMENTED** in Firebase — Super Admin inventory page uses demo store |

---

## 13. Restaurant Data Isolation

### Security model (RTDB rules)

**File:** `database.rules.json` (deploy with `firebase deploy --only database`)

Platform staff (users in `/staffUsers` with roles `super_admin`, `platform_admin`, or `operations_manager`) have broad read/write.

Restaurant Management users are restricted by:

1. **`restaurant_id` on their profile** must match the restaurant being accessed.
2. **Encoded permission keys** on their profile must be `true` for the operation.

Example rule patterns:

```
/restaurants/{restaurantId}
  .read:  platform staff OR user's restaurant_id == restaurantId

/menus/{restaurantId}
  .read:  platform staff OR (user.restaurant_id == restaurantId AND permissions/rm_menu_view == true)
  .write: platform staff OR (user.restaurant_id == restaurantId AND permissions/rm_menu_manage == true)

/orders/{orderId}
  .read:  platform staff OR (permissions/rm_orders_view AND order.restaurant_id == user.restaurant_id)
  .write: platform staff OR (permissions/rm_orders_manage AND order.restaurant_id == user.restaurant_id)
```

### RM app query requirements

**Do not rely on frontend filtering alone.**

```typescript
// CORRECT: filter by session restaurant
const orders = allOrders.filter(o => o.restaurant_id === session.restaurantId);

// BETTER: RTDB query scoped where possible + rules enforce match

// WRONG: trust URL param
const restaurantId = searchParams.get("restaurantId"); // never use as authority
```

If a user changes `restaurantId` in the URL or request body, RTDB rules must deny access to another restaurant's data.

### Self-provision rule (user creation)

On first create only, newly authenticated user may write their own `/restaurantUsers/{uid}` if `!data.exists()` and `auth.uid == $uid`. This supports Super Admin provisioning via the provisioner app. Updates afterward require platform staff.

---

## 14. Firebase Security Rules

**File:** `database.rules.json`  
**Config:** `firebase.json` points to this file.

### Paths with restaurant isolation rules

| Path | Read | Write |
|------|------|-------|
| `restaurantUsers/{uid}` | Self or platform staff | Self on create; platform staff always |
| `restaurants/{restaurantId}` | Assigned RM user or platform staff | Platform staff or RM with `rm_profile_manage` |
| `restaurantBranches/{restaurantId}` | Same as restaurants | Same |
| `menus/{restaurantId}` | RM with `rm_menu_view` + matching restaurant | RM with `rm_menu_manage` |
| `orders/{orderId}` | RM with `rm_orders_view` + matching `restaurant_id` on order | RM with `rm_orders_manage` |
| `drivers/{driverId}` | RM with `rm_drivers_view` | RM with `rm_drivers_manage` |
| `driverAssignments/{id}` | RM with `rm_drivers_view` + matching restaurant | RM with `rm_drivers_manage` |
| `promotions` | RM with `rm_promotions_view` | RM with `rm_promotions_manage` |
| `settings` | RM with `rm_settings_view` | RM with `rm_settings_manage` |

Encoded permission keys in rules (examples): `rm_menu_view`, `rm_orders_manage`, `rm_profile_manage`, `rm_drivers_view`, etc.

### Security gaps / risks

| Issue | Detail |
|-------|--------|
| Rules not auto-deployed | `database.rules.json` is in repo; **must be deployed to Firebase Console** manually or via CLI |
| Super Admin demo login | `/auth` uses demo localStorage — RTDB writes from demo session may fail under strict rules until Super Admin uses Firebase Auth |
| Partial rule coverage | Not every RTDB path has restaurant-scoped rules yet (e.g. `support`, `notificationAlerts`) |
| Tables/customers/inventory | Permissions defined but **no RTDB paths** — rules not applicable until data layer exists |
| Auth record deletion | Soft-delete only; Firebase Auth account retained (no Admin SDK in client) |

---

## 15. Restaurant Information Synchronization

When Super Admin updates `/restaurants/{id}`:

- `name`, `address`, `phone`, `email`, `image_url`, hours, delivery settings, etc.

Restaurant Management app should **subscribe or re-fetch** `/restaurants/{session.restaurantId}` — not maintain a separate copy.

Payment config: `/restaurants/{id}/payment_config` via `payments.firebase.ts`.

Branches: `/restaurantBranches/{restaurantId}/{branchId}` via `branches.firebase.ts`.

---

## 16. Menus

**Paths:** `/menus/{restaurantId}/categories|items|variants|addons/{id}`

**Service:** `src/lib/menus.firebase.ts`

| Entity | Key fields |
|--------|------------|
| Category | `id`, `restaurant_id`, `name`, `sort_order`, `is_available` |
| Item (product) | `id`, `restaurant_id`, `category_id`, `name`, `price`, `is_available`, `image_url` |
| Variant | `id`, `menu_item_id`, `name`, `price_delta` |
| Addon | `id`, `menu_item_id`, `name`, `price`, `max_quantity` |

RM app must use `session.restaurantId` as the `{restaurantId}` path segment.

Required permissions: `rm.menu.view` / `rm.menu.manage`

---

## 17. Orders

**Paths:** `/orders/{orderId}`, `/orders/{orderId}/items/{lineId}`, `/orders/{orderId}/timeline/{eventId}`

**Service:** `src/lib/orders.firebase.ts`

Key order fields:

| Field | Purpose |
|-------|---------|
| `restaurant_id` | **Restaurant scope** — must match session |
| `status` | Workflow state |
| `order_type` | `delivery` \| `pickup` |
| `order_number` | Display number |
| `placed_at`, `ready_at`, `delivered_at`, ... | Timestamps |
| `driver_id` | Assigned driver (delivery) |
| `customer_id` | Customer reference |

Required permissions: `rm.orders.view` / `rm.orders.manage`

---

## 18. Kitchen Workflow

Kitchen uses the **same order records** as Orders.

```
Order (restaurant_id = X, status = pending)
  → accepted
  → preparing        ← kitchen queue (Super Admin: /kitchen)
  → ready
  → [delivery path: assigned → picked_up → on_the_way → delivered]
  → [pickup path: picked_up → delivered]
```

**Restaurant ID** stays on the order document throughout — never strip or override it.

Required permissions: `rm.kitchen.view` / `rm.kitchen.manage`

Super Admin implementation: `src/routes/_authenticated/kitchen.tsx` + `orders.firebase.ts`

---

## 19. Delivery Workflow

Delivery assignment connects orders to drivers:

```
Order (order_type = delivery, status = ready)
  → assigned (driver_id set)
  → picked_up
  → on_the_way
  → delivered
```

**Driver assignment path:** `/driverAssignments/{driverId}__{restaurantId}__{branchId}`

Required permissions: `rm.delivery.view` / `rm.delivery.manage`, `rm.drivers.view` / `rm.drivers.manage`

Super Admin: `src/routes/_authenticated/dispatch.tsx`, `drivers.tsx`, `live-map.tsx`

---

## 20. Driver Workflow

**Driver profile:** `/drivers/{driverId}` — written by Driver App  
**Assignment:** `/driverAssignments/{driverId}__{restaurantId}__{branchId}`

RM app lists drivers relevant to **their restaurant** via assignments where `restaurant_id === session.restaurantId`.

**Service:** `src/lib/drivers.firebase.ts`

---

## 21. Existing Code Locations (Super Admin repo)

### Firebase configuration

| File | Purpose |
|------|---------|
| `src/lib/firebase.ts` | RTDB client, `FIREBASE_CONFIG`, read/write/subscribe |
| `firebase.json` | Points to `database.rules.json` |
| `database.rules.json` | RTDB security rules |

### Authentication & access control

| File | Purpose |
|------|---------|
| `src/lib/auth.firebase.ts` | Platform staff Auth + `/staffUsers` |
| `src/lib/restaurant-users.firebase.ts` | RM user Auth + `/restaurantUsers` + sign-in for Step 2 |
| `src/lib/restaurant-permissions.ts` | Roles, permission codes, encode/decode |
| `src/lib/session.functions.ts` | Demo session + staff session builders |
| `src/routes/_authenticated/access.tsx` | Access Control page (Team + Restaurant Management + matrix) |
| `src/components/access/restaurant-management-tab.tsx` | Restaurant Management UI |

### Restaurant & operations data

| File | RTDB domain |
|------|-------------|
| `src/lib/restaurants.firebase.ts` | `/restaurants` |
| `src/lib/menus.firebase.ts` | `/menus/{restaurantId}` |
| `src/lib/orders.firebase.ts` | `/orders` |
| `src/lib/drivers.firebase.ts` | `/drivers`, `/driverAssignments` |
| `src/lib/branches.firebase.ts` | `/restaurantBranches` |
| `src/lib/payments.firebase.ts` | `/restaurants/{id}/payment_config` |
| `src/lib/promotions.firebase.ts` | `/promotions/*` |
| `src/lib/settings.firebase.ts` | `/settings` |
| `src/lib/support.firebase.ts` | `/support/tickets` |
| `src/lib/notifications.firebase.ts` | `/notificationAlerts` |

### Hooks

| File | Purpose |
|------|---------|
| `src/hooks/use-firebase-restaurants.ts` | Restaurant list for pickers |
| `src/hooks/use-staff-session.ts` | Permission checks in Super Admin UI |
| `src/hooks/use-firebase-orders.ts` | Order subscriptions |

### Tests

| File | Purpose |
|------|---------|
| `src/lib/restaurant-users.test.ts` | Permission encoding, normalization |

---

## 22. Integration Requirements (Restaurant Management App)

When integrating, the RM app **must**:

1. Use the **same `FIREBASE_CONFIG`** (or equivalent env-based config for the same project).
2. Sign in with **Firebase Auth email/password** (`signInWithEmailAndPassword`).
3. Load **`/restaurantUsers/{auth.uid}`** immediately after sign-in.
4. Reject if profile missing, `is_deleted`, or `status !== "active"`.
5. Set **`restaurantId = profile.restaurant_id`** — no manual selection.
6. Load **`/restaurants/{restaurantId}`** for branding/profile.
7. Decode permissions map → string array for UI gating.
8. Scope **all operational queries** to `restaurantId`.
9. Use **`signInRestaurantUserWithFirebase`** or port its logic — already implemented in Super Admin repo.
10. Call **`refreshRestaurantUserSession`** on app focus/route change so Super Admin permission changes apply.
11. **Not** create a parallel auth or permission system.
12. **Not** duplicate restaurant records.

### Recommended session bootstrap (pseudocode)

```typescript
import { signInRestaurantUserWithFirebase, refreshRestaurantUserSession } from "./restaurant-users.firebase";
import { rtdbGet } from "./firebase";

// Login
const result = await signInRestaurantUserWithFirebase({ email, password });
if (!result.ok) throw new Error(result.message);

const session = result.session;
// session.restaurantId, session.permissions, session.role

const restaurant = await rtdbGet(`/restaurants/${session.restaurantId}`);

// Gate modules
const canViewOrders = session.permissions.includes("rm.orders.view");
const canManageMenu = session.permissions.includes("rm.menu.manage");
```

Copy or share `restaurant-users.firebase.ts` and `restaurant-permissions.ts` into the RM app (or publish as shared package).

---

## 23. Step-by-Step Integration Plan

### Step 1 — Analyze existing RM app authentication

Locate current login flow. Identify if it uses demo auth, separate Firebase project, or local state.

### Step 2 — Align Firebase project

Replace/configure Firebase init to use the same project as `FIREBASE_CONFIG` in `src/lib/firebase.ts`.

### Step 3 — Port auth + session services

Copy or import:
- `src/lib/firebase.ts`
- `src/lib/restaurant-users.firebase.ts`
- `src/lib/restaurant-permissions.ts`

### Step 4 — Replace RM login with Firebase Auth

Wire login form to `signInRestaurantUserWithFirebase()`. Persist session (localStorage or secure storage).

### Step 5 — Load user profile and restaurant

After sign-in:
```
/restaurantUsers/{uid}  →  session
/restaurants/{restaurant_id}  →  restaurant context
```

### Step 6 — Remove restaurant picker from RM app

Delete/disable any post-login restaurant selection. Show assigned restaurant name read-only if needed.

### Step 7 — Apply permission-based module routing

Map RM routes to permission codes:

| RM route/module | Required permission |
|-----------------|---------------------|
| Dashboard | `rm.dashboard.view` |
| Profile/settings | `rm.profile.view` / `rm.profile.manage` |
| Menu | `rm.menu.view` / `rm.menu.manage` |
| Orders | `rm.orders.view` / `rm.orders.manage` |
| Kitchen | `rm.kitchen.view` / `rm.kitchen.manage` |
| etc. | See §11 |

### Step 8 — Connect operational data to RTDB paths

Replace any local/demo data with Firebase services matching Super Admin paths (§12). Always filter by `session.restaurantId`.

### Step 9 — Deploy and verify RTDB rules

```bash
firebase deploy --only database
```

Test cross-restaurant access denial.

### Step 10 — End-to-end testing

Use checklist in §25.

---

## 24. Security Requirements

1. **Never** use URL/query `restaurantId` as authority — use `/restaurantUsers/{uid}.restaurant_id`.
2. **Always** authenticate Firebase requests — anonymous access must not read other restaurants.
3. **Decode** RTDB permission keys before checking logical codes.
4. **Re-check** session on navigation (`refreshRestaurantUserSession`).
5. **Sign out** suspended/deleted users immediately.
6. **Deploy** `database.rules.json` — repo rules are not active until deployed.
7. **Do not** weaken rules to fix client bugs.

---

## 25. Testing Checklist

### Super Admin (verify before RM integration)

- [ ] Super Admin creates restaurant under `/restaurants`
- [ ] Super Admin creates RM user with Restaurant Owner role
- [ ] Firebase Auth account exists in Firebase Console
- [ ] `/restaurantUsers/{uid}` document exists with correct `restaurant_id`
- [ ] Permissions stored with encoded keys (`rm_dashboard_view`, not `rm.dashboard.view`)
- [ ] User appears in Access Control → Restaurant Management table
- [ ] Edit user: change restaurant, role, permissions
- [ ] Deactivate user → `status: "suspended"`
- [ ] Reactivate user

### Restaurant Management integration

- [ ] RM user logs in with provisioned email/password
- [ ] Correct restaurant loads automatically (no picker)
- [ ] Restaurant name/profile matches `/restaurants/{id}`
- [ ] Permissions match Super Admin assignment
- [ ] Unauthorized modules hidden/blocked
- [ ] Menu data scoped to assigned restaurant
- [ ] Orders scoped to assigned restaurant
- [ ] Kitchen queue shows only assigned restaurant orders
- [ ] Delivery/drivers scoped to assigned restaurant
- [ ] User **cannot** access another restaurant by changing URL/ID
- [ ] Suspended user cannot sign in
- [ ] Permission change in Super Admin reflected after session refresh
- [ ] Logout + login as different user loads different restaurant
- [ ] RTDB rules deny cross-restaurant read/write (test in Firebase Rules Simulator)

---

## 26. Known Issues

| Issue | Impact | Mitigation |
|-------|--------|------------|
| RTDB rules may not be deployed | Client writes fail with PERMISSION_DENIED | Run `firebase deploy --only database` |
| Super Admin `/auth` uses demo login | Admin RTDB writes may fail under strict rules | Use Firebase-authenticated Super Admin or open rules for admin paths during setup |
| Orphan Auth accounts | Email already in use after partial failure | Retry same email+password — orphan recovery completes profile |
| Permission key dots | RTDB rejects `.` in keys | Fixed: use encoded keys (§11) |
| Soft-delete only | Auth account remains in Firebase Console | Acceptable; access revoked via profile |

---

## 27. NOT IMPLEMENTED Items

| Item | Status |
|------|--------|
| Restaurant Management app connection | **NOT IMPLEMENTED** — Step 2 |
| `signInRestaurantUserWithFirebase` wired to RM app UI | **NOT IMPLEMENTED** (function exists in Super Admin repo) |
| Firestore | **NOT IMPLEMENTED** |
| Supabase runtime auth for RM app | **NOT IMPLEMENTED** (schema exists, unused) |
| RTDB `/tables/{restaurantId}` | **NOT IMPLEMENTED** (permission exists) |
| RTDB customers collection | **NOT IMPLEMENTED** (demo store in Super Admin only) |
| RTDB inventory collection | **NOT IMPLEMENTED** (demo store in Super Admin only) |
| Firebase Admin SDK user deletion | **NOT IMPLEMENTED** (client-only provisioning) |
| Multi-restaurant per RM user | **NOT IMPLEMENTED** (by design: one restaurant each) |
| RM app session persistence standard | **NOT IMPLEMENTED** (implement in Step 2) |
| Cloud Functions for provisioning | **NOT IMPLEMENTED** (client-side provisioner app pattern) |

---

## 28. Final Integration Notes

### Target architecture

```
SUPER ADMIN MANAGEMENT APP
        │
        ├── Multiple restaurants (/restaurants)
        ├── Restaurant Management users (/restaurantUsers)
        ├── Firebase Authentication (shared)
        ├── User → Restaurant assignment (restaurant_id)
        ├── Roles + Permissions (role + permissions map)
        │
        ▼
Shared Firebase Realtime Database
        │
        ├── /restaurants/{id}
        ├── /menus/{restaurantId}/...
        ├── /orders/{orderId}  (restaurant_id field)
        ├── /drivers, /driverAssignments
        └── ...
        │
        ▼
RESTAURANT MANAGEMENT APP
        │
        ├── Authenticate (Firebase Auth)
        ├── Load /restaurantUsers/{uid}
        ├── Derive restaurantId (no manual pick)
        ├── Load /restaurants/{restaurantId}
        ├── Apply permissions
        └── Operate restaurant-scoped modules
```

### Copy-paste checklist for RM developer

1. Same Firebase project: `e-comm-bd997`
2. User profile path: `/restaurantUsers/{auth.uid}`
3. Restaurant path: `/restaurants/{profile.restaurant_id}`
4. Permission check: decode RTDB map → `rm.orders.view` etc.
5. Sign-in reference: `src/lib/restaurant-users.firebase.ts` → `signInRestaurantUserWithFirebase`
6. Security rules: `database.rules.json` — deploy before production
7. Do not build a second permission or restaurant assignment system

### Commits (Super Admin Step 1)

| Commit | Description |
|--------|-------------|
| `093fa20` | Initial Restaurant Management access control |
| `28e2e2c` | Provisioning fixes + UI improvements |
| `96984ae` | RTDB permission key encoding fix |

---

**End of handover document.**  
The Restaurant Management application is **not connected yet**. Use this document as the single source of truth for Step 2 integration.
