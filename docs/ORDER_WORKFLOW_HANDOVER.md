# Order Workflow Handover

**Handover: Driver App ↔ Admin Order Section**
Updated 2026-09-17 · Source: `fleetdriverhub` driver app (Firestore) · Collection: `orders`

How an order moves from "no driver yet" to "delivered," what the driver app writes to Firestore at
each step, and exactly what the admin order screen should show and allow at each stage.

The driver app and the admin console don't talk to each other directly — they both read and write the
same Firestore document at `orders/{orderId}`. This document defines the driver app's side of that
contract: which fields it writes, and when.

**Note:** the driver app repo has no admin UI of its own. Every "admin" action described below
(assign, reassign, cancel) is something a separate admin console is expected to write directly to the
same `orders` document in Firestore. This is a specification for that contract, not a description of
admin-side code that already exists.

---

## 1. The shared data contract

| Field | Type | Written by | Meaning |
|---|---|---|---|
| `driver_id` | `string \| null` | Admin (assigns) · driver app (accepts) | The driver currently attached to the order. **Setting this is the admin's "assign a driver" action.** |
| `driver_status` | `string` | Driver app only | Granular driver-side progress: `assigned → arrived_at_restaurant → picked_up → on_the_way → arrived_at_customer → delivered` |
| `status` | `OrderStatus` | Restaurant/admin (pending→ready), then mirrored by driver app | The order's overall status, shared with the customer app and restaurant dashboard. Driver app only touches this on accept, pickup, start, and complete — see the note in Stage 6. |
| `timeline` | `TimelineEntry[]` | Appended by driver app on every action | Append-only audit log: `{ status, at, driver_id?, note?, latitude?, longitude? }`. This is the source of truth the driver app uses to know whether the current driver has actually confirmed the assignment yet. |
| `assigned_at` / `picked_up_at` / `on_the_way_at` / `delivered_at` | ISO string | Driver app | Stage timestamps, set alongside the matching status change. |
| `proof_of_delivery` | object | Driver app, on completion | `{ method, value, recorded_at, latitude, longitude }` — PIN or customer confirmation. |

**Prerequisite the admin UI should enforce:** a driver can only be assigned to an order if they already
have an active `driverAssignments/{driverId__restaurantId__branchId}` record for that restaurant +
branch. That's a separate, standing "this driver may work this branch" grant — it is not created
per-order. If the admin assigns a driver without one, the driver's Accept will fail server-side with
"not authorized for this delivery."

---

## 2. Lifecycle at a glance

```
 0             1                2           3            4              5             6              7
Unassigned → Waiting to → Accepted → At restaurant → Picked up → On the way → At customer → Delivered
              accept                                  (admin locks
                                                        to read-only)
```

- **Amber (0–1):** waiting on a person to act (admin to assign, driver to accept).
- **Orange (2–6):** driver is actively working the delivery.
- **Green (7):** terminal, done.

---

## 3. Stage by stage

### 0 · Unassigned — *"Needs a driver"*

- **Trigger:** Order created (by restaurant / customer app). No driver picked yet.
- **Firestore state:**
  ```
  driver_id: null
  driver_status: undefined
  ```
- **Admin status label:** "Unassigned"
- **Admin actions:**
  - ✅ Assign a driver (write `driver_id`)
  - ✅ Cancel the order

---

### 1 · Waiting for driver to accept — *"Waiting"*

- **Trigger:** Admin sets `driver_id`. Nothing else changes yet — the driver hasn't confirmed.
- **Firestore state:**
  ```
  driver_id: "drv_123"
  timeline: []   // no "assigned" entry yet
  ```
- **Driver app:** Order appears in the driver's **Available** tab with an **Accept delivery** button —
  computed as `needsAcceptance`: `driver_id` is set but no `{status: "assigned"}` timeline entry exists
  yet.
- **Admin status label:** "Waiting for driver to accept"
- **Admin actions:**
  - ✅ **Reassign** — overwrite `driver_id` with a different driver. Safe: nothing is committed yet.
  - ✅ Cancel the order
  - ❌ No delivery-progress actions — there's nothing to show yet

---

### 2 · Accepted — heading to restaurant — *"In progress"*

- **Trigger:** Driver taps **Accept delivery** → `acceptAssignment()`
- **Firestore state:**
  ```
  driver_status: "assigned"
  status: "assigned"
  assigned_at: now
  timeline += { status: "assigned", driver_id }
  ```
- **Admin status label:** "Waiting for driver to get to the restaurant"
- **Admin actions:**
  - ✅ View live status
  - ✅ Cancel the order
  - ❌ No reassignment — the driver has committed. See [open decision #2](#5-open-decisions-for-the-admin-build) if a swap is still needed here.

---

### 3 · Arrived at restaurant — *"In progress"*

- **Trigger:** Driver taps **Arrived at restaurant** → `arriveAtRestaurant()`. Order-wide `status` is
  *not* touched here — only `driver_status`.
- **Firestore state:**
  ```
  driver_status: "arrived_at_restaurant"
  arrived_at_restaurant: now
  timeline += { status: "arrived_at_restaurant" }
  ```
- **Admin status label:** "Driver at restaurant — picking up order"
- **Admin actions:**
  - ✅ View live status
  - ✅ Cancel the order

---

### 4 · Picked up — *"Admin goes read-only"*

- **Trigger:** Driver verifies the pickup code, then taps **Picked up order** → `verifyPickup()` then
  `pickUpOrder()`.
- **Firestore state:**
  ```
  driver_status: "picked_up"
  status: "picked_up"
  picked_up_at: now
  timeline += { status: "picked_up" }
  ```
- **Admin status label:** "Order picked up — driver en route"

  This is the point where the admin screen locks down: the order becomes a **read-only live tracker**.

- **Admin actions:**
  - ✅ View live status only
  - ✅ **Cancel order** — the one remaining action
  - ❌ No reassignment, no edits, no other buttons

---

### 5 · On the way — *"Read-only"*

- **Trigger:** Driver taps **Start delivery** → `startDelivery()`
- **Firestore state:**
  ```
  driver_status: "on_the_way"
  status: "on_the_way"
  on_the_way_at: now
  timeline += { status: "on_the_way" }
  ```
- **Admin status label:** "On the way to customer"
- **Admin actions:**
  - ✅ View live status only
  - ✅ Cancel order (flagged — see [open decision #3](#5-open-decisions-for-the-admin-build))

---

### 6 · Arrived at customer — *"Read-only"*

- **Trigger:** Driver taps **Arrive at customer** → `arriveAtCustomer()`
- **Firestore state:**
  ```
  driver_status: "arrived_at_customer"
  arrived_at_customer: now
  timeline += { status: "arrived_at_customer" }
  // note: order.status is NOT updated here — stays "on_the_way"
  ```
- **Admin status label:** "Driver at customer's door"
- **Admin actions:**
  - ✅ View live status only
  - ❌ Cancel is questionable this late — see [open decision #3](#5-open-decisions-for-the-admin-build)

---

### 7 · Delivered — *"Terminal"*

- **Trigger:** Driver captures PIN or confirmation and taps **Complete delivery** →
  `completeDelivery()`
- **Firestore state:**
  ```
  driver_status: "delivered"
  status: "delivered"
  delivered_at: now
  proof_of_delivery: { method, value, ... }
  // + a driverEarnings record is created
  ```
- **Admin status label:** "Delivered"
- **Admin actions:**
  - ✅ View as a closed, historical record
  - ❌ No actions — nothing left to do

---

### ✕ · Cancelled / failed / rejected — *"Terminal, exceptional"*

- **Trigger:** Admin cancels the order (from any stage above). This mutation doesn't exist in the
  driver app or in this repo yet — see [open decision #1](#5-open-decisions-for-the-admin-build).
- **Driver app effect:** Order drops out of the driver's Available/Active tabs immediately and appears
  in their **Past** tab.

---

## 4. Cross-cutting rules

- **The driver app has no admin UI.** Every "admin" action described above (assign, reassign, cancel)
  is something a separate admin console writes directly to the same `orders` document in Firestore.
  This document defines the contract that console needs to honor — it isn't a description of code that
  exists on the admin side today.
- **Branch eligibility gates every driver action, separately from assignment.** Before Accept, Arrive,
  Pickup, Start, or Arrive-at-customer will succeed, the driver must have an active
  `driverAssignments` record for that order's restaurant + branch. This is a standing roster grant
  ("driver X may work branch Y"), not something scoped to one order — admins should manage it
  separately from per-order assignment.
- **Connectivity gotcha already fixed:** the driver app previously treated itself as offline more or
  less permanently (a stale Realtime-Database connectivity check against a Firestore backend), which
  queued every action — including Start Delivery — instead of running it. That's resolved; mutations
  now run immediately when the device is actually online.

---

## 5. Open decisions for the admin build

Things this handover intentionally leaves as decisions, not defaults, because they need product input.

1. **There is no cancel mutation yet.** Nothing in this repo writes `status: "cancelled"`. Before the
   admin "Cancel" button described throughout this doc can work, someone needs to define what
   cancelling mid-delivery does: does the driver get a push notification? Does a partially-earned
   amount still get recorded? That logic should probably live in a Cloud Function both apps trust, not
   a raw client-side write.

2. **Reassignment after acceptance (Stage 2+) is undefined.** This doc assumes reassignment is only
   safe during Stage 1 (waiting to accept), because after that the driver has already committed and may
   be en route. If the business still needs a way to swap drivers after acceptance, that likely wants
   an explicit "unassign" mutation (clearing `driver_id` and `driver_status`, with a timeline entry
   recording who did it and why) rather than the admin silently overwriting `driver_id` on a live
   delivery.

3. **Should Cancel stay available once on_the_way / arrived_at_customer?** Technically nothing stops
   it, but cancelling a delivery that's already at the customer's door is almost certainly the wrong
   default — that likely needs a support/ops override path instead of a plain button, or a
   confirmation step that makes the risk explicit.

4. **Driver decline isn't wired up.** The driver app's delivery card already supports a "Reject" button
   in its component (`DeliveryCard`'s `onReject` prop), but no screen currently passes a handler to it.
   If a driver should be able to actively decline an admin-assigned order — bouncing it back to Stage 0
   for reassignment — that decline mutation still needs to be built and wired in.

---

## 6. Admin console implementation notes (added 2026-09-17)

This section documents how `fleet-admin-hub` (this repo) actually implements the contract above —
useful if this doc drifts from the code again.

- **`status` never becomes `"offered"` or `"arrived"`.** An earlier build of this console briefly
  invented those two `status` values before this handover was available. They're gone now —
  `orderStage()` in `src/lib/dispatch.functions.ts` computes the admin-facing stage (unassigned /
  waiting_accept / heading_to_restaurant / at_restaurant / etc.) from `status` + `driver_id` +
  `driver_status` instead, and treats any surviving legacy `"offered"`/`"arrived"` records as their
  real equivalent so old in-flight orders keep working without a data migration.
- **Field names actually used:** `driver_status`, `assigned_at`, `arrived_at_restaurant`,
  `picked_up_at`, `on_the_way_at`, `arrived_at_customer`, `delivered_at` — see `FirebaseOrder` in
  `src/lib/orders.firebase.ts`.
- **No staff override anywhere in the UI**, matching this doc exactly — every stage from "waiting to
  accept" onward (Stages 1–7) is driver-app-only. Staff's only lever at all is reassigning to a
  different driver while still Stage 1 (`assignDriver` / "Change driver"). A "Mark arrived at
  restaurant" staff fallback existed briefly (added, then removed, both 2026-09-17) after orders got
  permanently stuck at Stage 2 while the driver app's own write wasn't shipped yet — the underlying
  mutation (`markArrivedAtRestaurant` in `orders.firebase.ts` / `dispatch.functions.ts`) is still there,
  unused, in case a fallback is wanted again.
- **Firestore rules:** `firestore.rules` in this repo grants a signed-in driver read/update access to
  orders where `driver_id` matches their own uid, and create/update access to their own `drivers/{uid}`
  profile — required for the driver app to write any of the fields above. See
  `docs/DELIVERY_APP_FIRESTORE_HANDOVER.md` §5 for the exact rule text and deployment status.

---

*Prepared as a handover reference — update alongside any change to the accept/pickup/delivery flow.*
