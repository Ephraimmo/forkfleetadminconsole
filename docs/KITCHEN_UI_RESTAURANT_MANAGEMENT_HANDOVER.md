# Handover: Kitchen UI — ForkFleet Console → Restaurant Management App

This document **analyses the Kitchen queue UI** in the ForkFleet Super Admin Console and provides a **copy-paste AI prompt** to recreate an equivalent Kitchen screen in the separate **Restaurant Management** web app, wired to the **same Firebase Realtime Database**.

> **Related docs:** Platform integration overview → `SUPER_ADMIN_RESTAURANT_MANAGEMENT_HANDOVER.md` (auth, `/restaurantUsers`, RTDB rules). This doc goes deep on Kitchen UI + behaviour only.

---

## Summary (how it works here)

| Concern | Approach |
|--------|----------|
| **UI pattern** | 3-column Kanban board (Accepted → Cooking → Ready) |
| **Data source** | Same `/orders/{id}` records as Orders & Dispatch — no separate kitchen collection |
| **Visibility filter** | Status ∈ `{ accepted, preparing, ready }` only |
| **Restaurant scope** | Super Admin: optional filter dropdown; **RM app: always `session.restaurantId`** |
| **Realtime** | `subscribeFirebaseOrders()` → in-memory cache → React Query invalidation |
| **Advance actions** | `accepted → preparing → ready` via `setFirebaseOrderStatus()` |
| **Pickup handover** | On `ready` + `order_type === "pickup"`: **Customer collected** → `picked_up` |
| **Delivery handover** | Kitchen stops at `ready`; Dispatch assigns driver (`assigned` → …) |
| **Accept/reject** | **Not on Kitchen page** — done on Orders page (`pending → accepted \| rejected`) |
| **Permissions (RM app)** | `rm.kitchen.view` (read) · `rm.kitchen.manage` (advance / collect) |
| **Audit** | Timeline at `/orders/{id}/timeline/{eventId}` + optional client audit log |

---

## Where Kitchen sits in the platform

```
Customer app                Super Admin / RM app              Driver app
     │                              │                              │
     │  POST /orders/{id}           │                              │
     │  status: pending             │                              │
     └──────────────────────────────►                              │
                                    │                              │
                         Orders page: Accept / Reject              │
                                    │                              │
                         status: accepted ────────────────────────┤
                                    │                              │
                         Kitchen page: preparing → ready            │
                                    │                              │
              ┌─────────────────────┴─────────────────────┐        │
              │ delivery                          pickup  │        │
              ▼                                         ▼        │
     Dispatch: assign driver                   Kitchen: collected │
              │                                         │        │
              ▼                                         ▼        │
         picked_up → on_the_way → delivered      picked_up → delivered
              └──────────────────────────────────────────►────────┘
```

**Restaurant Management app** owns the left-hand operational lane for **one restaurant**. It does **not** need Dispatch unless the RM user also has `rm.delivery.*` permissions.

---

## UI analysis (Super Admin reference)

**Route:** `/kitchen`  
**File:** `src/routes/_authenticated/kitchen.tsx`  
**Nav:** Sidebar → Operations → **Kitchen queue** (permission: platform `orders.view`)

### Page shell

| Element | Implementation | Notes for RM app |
|--------|----------------|------------------|
| Title | `Live kitchen queue` | Rename to e.g. **Kitchen pass** or **Live kitchen** |
| Description | Accepted / cooking / ready lanes, realtime + audit | Keep similar copy |
| Breadcrumb | `Operations / Kitchen queue` | Use RM nav, e.g. `Kitchen` |
| Permission gate | `orders.view` + `orders.manage` for actions | Map to `rm.kitchen.view` / `rm.kitchen.manage` |
| Restaurant filter | `<Select>` — **All restaurants** or one `restaurant.id` | **Remove** — scope to `session.restaurantId` only |
| Loading | Full-width `<Skeleton>` | Same pattern |

### Kanban layout

```
┌─────────────────────┬─────────────────────┬─────────────────────┐
│  New (Accepted)     │  Cooking            │  Ready for pickup   │
│  icon: ChefHat      │  icon: Flame        │  icon: PackageCheck │
│  hint in column def │  hint: On the pass  │  hint: driver/cust. │
├─────────────────────┼─────────────────────┼─────────────────────┤
│  [Order ticket]     │  [Order ticket]     │  [Order ticket]     │
│  [Order ticket]     │                     │  + Customer collected│
│  "Lane is clear."   │  "Lane is clear."   │    (pickup only)    │
└─────────────────────┴─────────────────────┴─────────────────────┘
```

- **Grid:** `grid gap-4 xl:grid-cols-4` with **3 columns** of content (fourth grid slot unused — harmless).
- **Sort:** Oldest first (`placed_at` ascending).
- **Cap:** Max **120** tickets returned from queue helper.

### Order ticket (`OrderTicket` component)

Each card shows:

| UI element | Data / behaviour |
|-----------|------------------|
| Order number | `order.order_number` — primary heading, semibold |
| Wait timer badge | Minutes since `placed_at`; **destructive** variant if **> 25 min** |
| Subtitle | `{restaurant_name} • {customer_name}` + `OrderTypeBadge` |
| Line items | `{quantity}× {item_name}` list (variant folded into name) |
| Notes CTA | Amber button **View customer notes** if any notes exist |
| **Advance** button | Primary, full width — moves to next column status |
| **Customer collected** | Pickup + `ready` only — sets `picked_up` |
| Notes icon button | Outline — opens notes dialog |

**Notes detection** (`kitchenOrderHasNotes`):

- `special_instructions` (order-level kitchen text)
- `delivery_address.notes` → surfaced as `delivery_notes` (handover / rider notes)
- Per-line `items[].notes`

### Notes dialog

- Title: `Order notes — {order_number}`
- Sections:
  - **Kitchen instructions** (violet styling) — special instructions + per-item notes
  - **Handover / delivery notes** (sky styling) — delivery address notes
- Footer: Close button only (read-only)

### Shared components to reuse or mirror

| Component | File | Purpose |
|-----------|------|---------|
| `OrderTypeBadge` | `src/components/order-type-badge.tsx` | Pickup (sky) vs Delivery (muted + bike icon) |
| `PermissionGate` | `src/components/permission-gate.tsx` | RM app: equivalent gate on `rm.kitchen.*` |
| shadcn Card, Badge, Button, Dialog, Select | `src/components/ui/*` | Same design system recommended |

### Visual tokens (match ForkFleet dark ops console)

| Token | Usage in Kitchen |
|-------|------------------|
| `border-border`, `bg-card` | Ticket cards |
| `text-muted-foreground` | Empty lane, subtitles |
| `destructive` badge | Wait > 25 minutes |
| `amber-500/*` | Notes call-to-action |
| `violet-300` / `violet-500/20` | Kitchen instruction blocks |
| `sky-300` / `sky-500/20` | Delivery / handover notes |
| Column icons | `ChefHat`, `Flame`, `PackageCheck`, `CheckCircle2`, `ShoppingBag` |

---

## Architecture (data + realtime)

```
┌──────────────────────────┐
│  Kitchen UI (browser)    │
│  kitchen.tsx             │
└────────────┬─────────────┘
             │ getKitchenQueue({ restaurantId })
             │ advanceOrder / markCustomerCollected
             ▼
┌──────────────────────────┐
│  kitchen.functions.ts    │  ← map OrderPayload → KitchenOrder
│  in-memory cache + subs  │
└────────────┬─────────────┘
             │ subscribeFirebaseOrders
             │ setFirebaseOrderStatus
             ▼
┌──────────────────────────┐
│  orders.firebase.ts        │
│  /orders/{id}              │
│  /orders/{id}/items/*      │
│  /orders/{id}/timeline/*   │
└──────────────────────────┘
         Firebase RTDB (e-comm-bd997)
```

**Bootstrapping realtime:** `useFirebaseOrderSync()` in `src/hooks/use-firebase-orders.ts` starts a single shared subscription (also used by Orders, Dispatch, Dashboard).

---

## Source map (Super Admin repo)

| File | Role |
|------|------|
| `src/routes/_authenticated/kitchen.tsx` | Kitchen page UI — Kanban, tickets, notes dialog |
| `src/lib/kitchen.functions.ts` | Queue filter, `advanceOrder`, `markCustomerCollected`, `onKitchenChanged` |
| `src/lib/orders.firebase.ts` | Order types, `subscribeFirebaseOrders`, `setFirebaseOrderStatus`, timeline |
| `src/hooks/use-firebase-orders.ts` | One-shot subscription bootstrap |
| `src/components/order-type-badge.tsx` | Pickup / delivery pill |
| `src/routes/_authenticated/orders.tsx` | Accept/reject + full pipeline (kitchen entry point) |
| `src/lib/dispatch.functions.ts` | Driver assignment after `ready` (delivery) |
| `src/lib/restaurant-permissions.ts` | RM permission codes `rm.kitchen.view` / `rm.kitchen.manage` |
| `src/lib/restaurant-users.firebase.ts` | RM sign-in + `RestaurantUserSession.restaurantId` |
| `src/lib/firebase.ts` | Shared `FIREBASE_CONFIG` + RTDB helpers |

---

## Order status model (kitchen-relevant)

### Statuses the kitchen board shows

| Status | Column | Next action (manage permission) |
|--------|--------|----------------------------------|
| `accepted` | New (Accepted) | Advance → `preparing` |
| `preparing` | Cooking | Advance → `ready` |
| `ready` | Ready for pickup | Delivery: wait for dispatch · Pickup: **Customer collected** → `picked_up` |

### Statuses the kitchen board hides

| Status | Why hidden |
|--------|------------|
| `pending` | Must be accepted on **Orders** first |
| `assigned`, `picked_up`, `on_the_way` | Post-kitchen / dispatch |
| `delivered`, `cancelled`, `rejected`, `refunded` | Terminal |

### Fulfilment type (`order_type`)

Read via `orderType(order)` — legacy orders without the field default to **`delivery`**.

| Type | Kitchen exit path |
|------|-------------------|
| `delivery` | Stop at `ready` → Dispatch assigns driver |
| `pickup` | `ready` → **Customer collected** (`picked_up`) → staff completes (`delivered`) on Orders/Dispatch |

**Never** set `assigned` or `on_the_way` on pickup orders — `setFirebaseOrderStatus` rejects it.

---

## Data contract

### RTDB paths (shared — do not rename fields)

```
/orders/{orderId}                    → FirebaseOrder
/orders/{orderId}/items/{lineId}     → OrderLine
/orders/{orderId}/timeline/{eventId} → TimelineEvent
```

### `KitchenOrder` (view model)

Defined in `src/lib/kitchen.functions.ts`:

```typescript
interface KitchenOrder {
  id: string;
  order_number: string;
  status: OrderStatus;
  order_type: "delivery" | "pickup";
  placed_at: string;
  eta_minutes: number | null;
  total: number;
  special_instructions: string | null;
  delivery_notes: string | null;       // from delivery_address.notes
  restaurant_id: string;
  restaurant_name: string;
  customer_name: string;
  items: {
    id: string;
    item_name: string;                 // variant name prefixed: "Large — Margherita"
    quantity: number;
    notes: string | null;
  }[];
}
```

### Mapping from Firebase (`toKitchen`)

```typescript
// Pseudocode — preserve field sources
item_name = [line.variant?.name, line.name].filter(Boolean).join(" — ")
delivery_notes = order.delivery_address?.notes ?? null
order_type = order.order_type === "pickup" ? "pickup" : "delivery"
```

### Queue query (RM app adaptation)

Super Admin:

```typescript
orders
  .filter(o => ["accepted", "preparing", "ready"].includes(o.status))
  .filter(o => restaurantId === "all" || o.restaurant_id === restaurantId)
  .sort((a, b) => a.placed_at.localeCompare(b.placed_at))
  .slice(0, 120)
```

**Restaurant Management (required):**

```typescript
orders
  .filter(o => o.restaurant_id === session.restaurantId)
  .filter(o => ["accepted", "preparing", "ready"].includes(o.status))
  .sort((a, b) => a.placed_at.localeCompare(b.placed_at))
```

---

## Mutations (must preserve)

### 1. Advance status

```typescript
// Allowed transitions (kitchen only)
accepted → preparing
preparing → ready

await setFirebaseOrderStatus({
  orderId,
  status: nextStatus,
  etaMinutes: nextStatus === "ready" ? Math.max(5, order.eta_minutes ?? 15) : null,
  actor: session.email, // RM: use authenticated user email
});
```

- Validates current status matches expected next step.
- On `ready`, sets `ready_at` and refreshes ETA.
- Appends timeline event automatically.

### 2. Customer collected (pickup only)

```typescript
// Preconditions: order_type === "pickup" && status === "ready"
await setFirebaseOrderStatus({
  orderId,
  status: "picked_up",
  note: "Customer collected at the counter",
  actor: session.email,
});
```

After this, order **leaves the kitchen board** (status no longer in kitchen filter).

### 3. Accept order (Orders module — not Kitchen UI)

Kitchen **never** accepts `pending` orders. RM app should implement Accept on an **Orders** screen with `rm.orders.manage`:

```typescript
// pending → accepted (via dispatch.functions acceptOrder or setFirebaseOrderStatus)
```

---

## Permissions

### Super Admin Console (this repo)

| Action | Platform permission |
|--------|---------------------|
| View kitchen page | `orders.view` |
| Advance / collect | `orders.manage` |

### Restaurant Management app (target)

| Action | RM permission |
|--------|---------------|
| View kitchen module | `rm.kitchen.view` |
| Advance / customer collected | `rm.kitchen.manage` |
| Accept pending orders | `rm.orders.manage` (Orders screen, not Kitchen) |

**Role defaults** (`src/lib/restaurant-permissions.ts`):

| Role | Kitchen access |
|------|----------------|
| `kitchen_manager` | view + manage (+ orders manage) |
| `kitchen_staff` | view + manage |
| `restaurant_manager` / `owner` | view + manage |
| `cashier` | orders only — **no** `rm.kitchen.*` by default |

Gate UI: hide Advance / Customer collected buttons when user lacks `rm.kitchen.manage`.

---

## Realtime strategy

1. Subscribe once to `/orders` (+ child listeners for items/timeline per order — see `subscribeFirebaseOrders`).
2. Maintain cached `KitchenOrder[]`.
3. On cache update, notify subscribers (`onKitchenChanged`).
4. React Query: `queryKey: ['kitchen-queue', restaurantId]` with `staleTime: Infinity`; invalidate on subscription callback.

RM app should use the **same** subscription helper or copy `orders.firebase.ts` verbatim — do not poll unless Firebase unavailable.

---

## RM app differences (mandatory)

| Super Admin Kitchen | Restaurant Management Kitchen |
|--------------------|------------------------------|
| Restaurant `<Select>` (all / one) | **Fixed** `session.restaurantId` |
| Platform `orders.view` / `orders.manage` | `rm.kitchen.view` / `rm.kitchen.manage` |
| Shows `restaurant_name` on every ticket | Optional — user only owns one restaurant |
| Accept on Orders page (platform staff) | Accept on RM Orders with `rm.orders.manage` |
| Multi-restaurant ops console branding | Restaurant-branded shell |

**Security:** Never trust a client-supplied `restaurantId` query param over `/restaurantUsers/{uid}.restaurant_id`. RTDB rules must enforce the same (see `database.rules.json`).

---

## Acceptance checklist (RM Kitchen module)

- [ ] Sign-in resolves `RestaurantUserSession` with `restaurantId`
- [ ] Kitchen board shows **only** that restaurant's orders
- [ ] Three columns: Accepted → Cooking → Ready
- [ ] Tickets show order number, wait time, customer, items, pickup/delivery badge
- [ ] Notes dialog shows kitchen + handover instructions
- [ ] Advance moves `accepted → preparing → ready` with timeline entry
- [ ] Pickup orders on Ready show **Customer collected** → `picked_up`
- [ ] Delivery orders on Ready have **no** driver actions on Kitchen screen
- [ ] `pending` orders never appear until accepted elsewhere
- [ ] Realtime updates without manual refresh
- [ ] View-only users (`rm.kitchen.view` only) see board but no action buttons
- [ ] Pickup orders never transition to `assigned` / `on_the_way`

---

## Operator quick start

1. Super Admin → **Access Control** → provision a `kitchen_staff` user assigned to restaurant `rst-…`.
2. Customer app (or test client) places an order → status `pending`.
3. RM **Orders** screen → **Accept** → order appears in Kitchen **New** column.
4. Kitchen → **Advance** twice → **Ready**.
5. Pickup: **Customer collected** → order leaves kitchen board.
6. Delivery: order stays Ready until Dispatch/RM delivery module assigns a driver.

---

## AI implementation prompt (copy-paste)

Use the block below with another AI (attach or open the **Restaurant Management** codebase and this document). Replace bracketed placeholders if needed.

```
You are implementing a Kitchen module in the Restaurant Management web app so it matches the ForkFleet Super Admin kitchen queue (reference: docs/KITCHEN_UI_RESTAURANT_MANAGEMENT_HANDOVER.md in the ForkFleet Console repo). Adapt routing, auth, and shell to the RM app, but preserve the order status model, Firebase paths, and UI behaviour exactly.

## Goal
Build a realtime Kitchen pass / queue screen for a single restaurant, linked to the same Firebase RTDB as ForkFleet Console and the customer app. Kitchen staff advance orders through accepted → preparing → ready and hand pickup orders to customers. Delivery orders stop at ready.

## Required behaviour

### 1. Auth & scope
- Sign in with Firebase Auth (project e-comm-bd997) using the existing RM sign-in flow.
- Load /restaurantUsers/{auth.uid} → session.restaurantId.
- All kitchen queries MUST filter order.restaurant_id === session.restaurantId.
- Do NOT show a restaurant picker.
- Enforce rm.kitchen.view to see the module; rm.kitchen.manage to advance or mark collected.

### 2. UI — Kanban kitchen board
Recreate the Super Admin layout from src/routes/_authenticated/kitchen.tsx:
- Page title e.g. "Live kitchen queue" with short description.
- Three columns:
  - New (Accepted) — icon ChefHat — Advance → preparing
  - Cooking — icon Flame — Advance → ready
  - Ready for pickup — icon PackageCheck — pickup only: "Customer collected" button
- Each order ticket shows:
  - order_number (heading)
  - wait badge: minutes since placed_at; highlight if > 25 min
  - customer_name + OrderTypeBadge (pickup vs delivery)
  - line items as "{qty}× {name}" (include variant in name if present)
  - "View customer notes" when special_instructions, delivery notes, or line notes exist
- Empty lane copy: "Lane is clear."
- Notes dialog: kitchen instructions (violet) + handover/delivery notes (sky).

Copy or reimplement OrderTypeBadge from src/components/order-type-badge.tsx.

### 3. Data layer
Reuse or port:
- src/lib/orders.firebase.ts — subscribeFirebaseOrders, setFirebaseOrderStatus, orderType()
- src/lib/kitchen.functions.ts — toKitchen mapping, getKitchenQueue filter, advanceOrder, markCustomerCollected, onKitchenChanged

Queue filter:
  status in [accepted, preparing, ready]
  restaurant_id === session.restaurantId
  sort by placed_at ascending
  limit 120

KitchenOrder shape and field mapping must match the handover doc.

### 4. Mutations
- advanceOrder: accepted→preparing, preparing→ready only; validate transitions; call setFirebaseOrderStatus with actor = user email; set eta on ready.
- markCustomerCollected: only pickup + ready → picked_up with note "Customer collected at the counter".
- Do NOT accept pending orders on this screen — that belongs on RM Orders (rm.orders.manage).

### 5. Realtime
- Single shared Firebase orders subscription (see use-firebase-orders.ts pattern).
- Invalidate kitchen query cache on onKitchenChanged — no polling.

### 6. Permissions UI
- rm.kitchen.view only → read-only board (no Advance / Customer collected).
- rm.kitchen.manage → full actions.

### 7. Shared Firebase config
Use the same FIREBASE_CONFIG as ForkFleet Console (src/lib/firebase.ts). Same RTDB paths — never rename order fields (customer app depends on them).

## Non-goals
- Do not create a separate /kitchenOrders collection.
- Do not implement driver assignment on the Kitchen screen (Delivery module / Dispatch).
- Do not allow pickup orders to enter assigned or on_the_way statuses.
- Do not let users switch restaurants.

## Deliverables
1. Kitchen route/page component mirroring the reference UI.
2. kitchen service module (queue + mutations) scoped to session.restaurantId.
3. Permission gates on rm.kitchen.*.
4. Brief test plan: accept order → advance twice → ready → collect (pickup) or leave for delivery.

## Reference files (ForkFleet Console)
- src/routes/_authenticated/kitchen.tsx
- src/lib/kitchen.functions.ts
- src/lib/orders.firebase.ts
- src/components/order-type-badge.tsx
- src/lib/restaurant-permissions.ts (rm.kitchen.*)
- SUPER_ADMIN_RESTAURANT_MANAGEMENT_HANDOVER.md §18 (workflow summary)

Match this behaviour; map component paths and auth to the Restaurant Management app conventions.
```

---

## Reference screenshots (structural)

**Column headers + ticket actions:**

```
┌─ New (Accepted) ─────────────┐
│ FF-1042              [12m]   │
│ Nonna's • Sipho N.  [Pickup] │
│ 1× Large — Margherita        │
│ 2× Garlic bread              │
│ [View customer notes]        │
│ [ ✓ Advance ]                │
└──────────────────────────────┘
```

**Ready + pickup:**

```
┌─ Ready for pickup ───────────┐
│ FF-1038               [8m]   │
│ …                            │
│ [ ✓ Advance ]  ← hidden      │
│ [ 🛍 Customer collected ]    │
└──────────────────────────────┘
```

---

*Document version: 2026-08-23 · ForkFleet Console kitchen reference implementation*
