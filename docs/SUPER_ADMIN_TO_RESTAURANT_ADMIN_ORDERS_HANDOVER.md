# Handover: Super Admin Order Pipeline → Restaurant Admin "Orders"

> **Audience:** AI / developer building the **Restaurant Management (Restaurant Admin) app**
> ("Orderly Hub").
> **Goal:** Bring the Restaurant Admin app's Orders section up to date with how order status,
> driver assignment and delivery progress actually work in the ForkFleet Super Admin console today —
> so a restaurant admin sees the **same, accurate** order status a platform dispatcher sees, not a
> stale or misleading one.
> **Source of truth:** ForkFleet Super Admin console (`forkfleetadminconsole`), routes `/orders`,
> `/dispatch` and `/payments` — this doc is a snapshot of that implementation: originally 2026-09-17,
> updated 2026-09-20 to add the `rm.orders.assign` permission (§4, §5.3, §6), updated again
> **2026-09-20** to add the proof-of-payment approval gate (§5.6) and restaurant payment-method
> configuration (§11).

Related docs in this repo:

- [ORDER_WORKFLOW_HANDOVER.md](./ORDER_WORKFLOW_HANDOVER.md) — the authoritative **driver app**
  contract this doc's status model is built against. Read that one first if anything here is unclear.
- [DELIVERY_APP_FIRESTORE_HANDOVER.md](./DELIVERY_APP_FIRESTORE_HANDOVER.md) — Firebase config,
  `drivers`/`driverAssignments` collections, security rules. Its own order-status section is
  superseded by `ORDER_WORKFLOW_HANDOVER.md` — don't use it for order status.
- [KITCHEN_UI_RESTAURANT_MANAGEMENT_HANDOVER.md](./KITCHEN_UI_RESTAURANT_MANAGEMENT_HANDOVER.md) —
  the kitchen board (`accepted` → `preparing` → `ready`). **That doc predates the Firestore migration
  and still describes Realtime Database paths — use the Firestore paths in §1.1 below instead.**
- [SUPER_ADMIN_RESTAURANT_MANAGEMENT_HANDOVER.md](../SUPER_ADMIN_RESTAURANT_MANAGEMENT_HANDOVER.md) —
  auth, `restaurantUsers`, restaurant scoping, provisioning.

---

## 1. What you must understand first

### 1.1 The data lives in Cloud Firestore — not Realtime Database, not Supabase

The whole platform (customer app, driver app, this console, and your Restaurant Admin app) reads and
writes the same Firestore project, `e-comm-bd997`. There is no separate `orders` table in Supabase —
don't look for one.

```
orders/{orderId}                      -> the order document (fields below)
orders/{orderId}/items/{lineId}       -> OrderLine
orders/{orderId}/timeline/{eventId}   -> TimelineEvent (this console's own audit trail — see §7, it is NOT the same thing as the driver app's `timeline` array field)
```

### 1.2 `status` alone does not tell you what's actually happening

This is the single most important thing in this document, and the exact bug this console spent an
entire iteration cycle fixing. **Do not build an Orders screen that just switches on `status`.**

Assigning a driver does **not** change `status` — it stays `"ready"` until the driver's own app
writes `status: "assigned"` (accepting the job). Likewise, "driver arrived at the restaurant" and
"driver arrived at the customer" are **never** `status` values — they live in a separate
`driver_status` field. So:

- `status: "ready"` means **either** "nobody's been offered this order yet" **or** "a driver has been
  offered it and hasn't accepted" — you cannot tell which without also checking `driver_id`.
- `status: "assigned"` means **either** "driver is heading to the restaurant" **or** "driver is
  already at the restaurant" — you cannot tell which without also checking `driver_status`.

**You must compute a display "stage" from `status` + `driver_id` + `driver_status` together.** §3
gives you the exact algorithm this console uses — copy it verbatim, don't reinvent it.

### 1.3 One user → one restaurant, and Firestore rules do **not** enforce it for orders

Your signed-in user's profile lives at `restaurantUsers/{uid}` and carries `restaurant_id`. **Current
Firestore rules grant any signed-in restaurant member read/write access to every order, not just
their own restaurant's** (`isAnyRestaurantMember()` in `firestore.rules` checks only "is a restaurant
member," never "is a member of *this order's* restaurant"). This is the same trust model already used
elsewhere in this platform (see `SUPER_ADMIN_TO_RESTAURANT_ADMIN_SUPPORT_HANDOVER.md` §3, which
documents the identical gap for support tickets) — not something new you need to fix, but something
you must not rely on the backend to catch for you:

```
visible(order, session)  ⇔  order.restaurant_id === session.restaurantId
```

**Filter client-side, always.** Never render, count, badge, or act on an order belonging to another
restaurant, even though the rules would currently let you read it.

---

## 2. Exact data model (copy these types verbatim)

From `src/lib/orders.firebase.ts` and `src/lib/dispatch.functions.ts` in this repo:

```ts
// The order's overall status. ONLY these 11 values are ever written to
// `status`. There is deliberately no "offered" or "arrived" value.
export type OrderStatus =
  | "pending"      // just placed, not yet accepted by the restaurant
  | "accepted"     // restaurant accepted it, headed to the kitchen
  | "preparing"     // kitchen is cooking it
  | "ready"         // ready for pickup/dispatch — see §1.2, this is overloaded
  | "assigned"      // driver has ACCEPTED (not just been offered) — see §1.2
  | "picked_up"     // driver has the order (delivery) or customer collected it (pickup)
  | "on_the_way"    // delivery only — driver en route to the customer
  | "delivered"     // terminal — closed successfully
  | "rejected"      // terminal — restaurant declined it while "pending"
  | "cancelled"      // terminal
  | "refunded";     // terminal

// Granular driver-side progress. Independent of `status` — written by the
// driver app directly to Firestore, never by the customer or restaurant app.
export type DriverStatus =
  | "assigned"
  | "arrived_at_restaurant"
  | "picked_up"
  | "on_the_way"
  | "arrived_at_customer"
  | "delivered";

export type OrderType = "delivery" | "pickup";

export interface FirebaseOrder {
  id: string;
  order_number: string;
  status: OrderStatus;
  order_type: OrderType;             // legacy orders missing this default to "delivery"
  placed_at: string;                 // ISO 8601, like every timestamp below
  accepted_at: string | null;
  ready_at: string | null;

  driver_status: DriverStatus | null;
  assigned_at: string | null;            // driver accepted
  arrived_at_restaurant: string | null;  // driver_status only — status stays "assigned"
  picked_up_at: string | null;
  on_the_way_at: string | null;
  arrived_at_customer: string | null;    // driver_status only — status stays "on_the_way"
  delivered_at: string | null;
  cancelled_at: string | null;

  eta_minutes: number | null;
  eta_at: string | null;

  subtotal: number;
  delivery_fee: number;
  service_fee: number;
  tax: number;
  discount: number;
  tip: number;
  total: number;
  coupon_code: string | null;
  payment_method: "card" | "cash" | "wallet" | "eft" | "apple_pay" | "google_pay";
  payment_status: "pending" | "paid" | "failed" | "refunded";

  delivery_address: {
    label: string | null;
    street: string;
    city: string;
    postal_code: string | null;
    latitude: number | null;
    longitude: number | null;
    notes: string | null;
  } | null;
  special_instructions: string | null;
  scheduled_for: string | null;

  restaurant_id: string;              // ← THE SCOPING FIELD, see §1.3
  restaurant_name: string;
  restaurant_image: string | null;
  branch_id?: string | null;
  branch_name?: string | null;

  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;

  driver_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_photo: string | null;
  driver_rating: number | null;

  rejection_reason: string | null;
  rejected_by: string | null;
  rejected_at: string | null;

  created_at: string;
  updated_at: string;
}
```

Rules of the schema:

- **snake_case everywhere**, no camelCase aliases.
- Every timestamp is an **ISO 8601 string**, compared with `localeCompare` for sorting — never a
  Firestore `Timestamp` object.
- Money is plain numbers in major units (e.g. `total: 249.5`).
- **Legacy data:** a small number of already-placed orders may still carry `status: "offered"` or
  `status: "arrived"` — values an earlier, incorrect build of this console briefly wrote before this
  contract was finalized. Treat `"offered"` as equivalent to `"ready"` and `"arrived"` as equivalent
  to `"assigned"` wherever you compare `status` directly. §3's algorithm already does this for you.
- **⚠️ Landmine: `order.payment_method` and payment *evidence* method are two different, overlapping
  enums.** `FirebaseOrder.payment_method` above is `"card" | "cash" | "wallet" | "eft" | "apple_pay" |
  "google_pay"`. The separate payment-evidence record at `orders/{id}/payment` (§5.6) uses its own
  `PaymentMethodId`: `"card" | "cash_on_delivery" | "cash_on_pickup" | "eft"` — narrower, and
  `"cash"`/`"wallet"` on the order don't map cleanly onto it. They only agree on the literals `"card"`
  and `"eft"`. The proof-of-payment gate in §5.6 checks `order.payment_method === "eft"` specifically
  because that literal is safe across both enums — don't assume any other value lines up.

---

## 3. Computing the display stage (copy this algorithm verbatim)

This is `orderStage()` from `src/lib/dispatch.functions.ts`. It is the **only** correct way to decide
what an order's status badge should say. Do not switch on `status` alone (§1.2).

```ts
type OrderStage =
  | "pending" | "accepted" | "preparing"
  | "ready"                  // pickup orders only — waiting for the customer to collect
  | "unassigned"             // delivery, status "ready", no driver picked yet
  | "waiting_accept"         // delivery, status "ready", driver picked, hasn't accepted
  | "heading_to_restaurant"  // delivery, status "assigned", driver accepted, not yet arrived
  | "at_restaurant"          // delivery, status "assigned", driver_status "arrived_at_restaurant"
  | "picked_up"
  | "on_the_way"
  | "at_customer"            // delivery, status "on_the_way", driver_status "arrived_at_customer"
  | "delivered" | "rejected" | "cancelled" | "refunded";

function orderStage(o: {
  status: OrderStatus;
  order_type: OrderType;
  driver_id: string | null;
  driver_status: DriverStatus | null;
}): OrderStage {
  const raw = o.status as string;

  if (o.order_type === "pickup") {
    // No driver is ever involved for pickup orders — the stage is the raw status.
    return raw as OrderStage;
  }

  if (raw === "ready" || raw === "offered") {
    return o.driver_id ? "waiting_accept" : "unassigned";
  }
  if (raw === "assigned" || raw === "arrived") {
    return raw === "arrived" || o.driver_status === "arrived_at_restaurant"
      ? "at_restaurant"
      : "heading_to_restaurant";
  }
  if (raw === "on_the_way") {
    return o.driver_status === "arrived_at_customer" ? "at_customer" : "on_the_way";
  }
  return raw as OrderStage; // pending, accepted, preparing, picked_up, delivered, rejected, cancelled, refunded
}
```

Suggested badge copy for each stage (used verbatim in this console — keeping the same wording avoids
confusing staff who use both apps):

| Stage | Badge text |
|---|---|
| `pending` | Pending |
| `accepted` | Accepted |
| `preparing` | Preparing |
| `ready` | Ready for pickup |
| `unassigned` | Unassigned |
| `waiting_accept` | Waiting for driver to accept |
| `heading_to_restaurant` | Waiting for driver to get to the restaurant |
| `at_restaurant` | Driver at restaurant — picking up order |
| `picked_up` | Order picked up — driver en route |
| `on_the_way` | On the way to customer |
| `at_customer` | Driver at customer's door |
| `delivered` | Delivered |
| `rejected` / `cancelled` / `refunded` | Rejected / Cancelled / Refunded |

---

## 4. What a restaurant admin should be able to do

This maps directly onto the `rm.orders.*` permission codes already reserved in
`src/lib/restaurant-permissions.ts` (see §6).

| Stage | Restaurant admin action | Who normally does it |
|---|---|---|
| `pending` | **Accept** or **Reject** (reason required) | Restaurant (this is the restaurant's own decision — never the driver's or the platform's) |
| `accepted` → `preparing` → `ready` | Advance through kitchen prep | Restaurant kitchen staff — see the Kitchen handover doc, same three-step flow |
| `unassigned` | **Assign a driver** — gated on `rm.orders.assign` (new, 2026-09-20 — see §6) | Restaurant staff with `rm.orders.assign`, or a platform dispatcher |
| `waiting_accept` | **Reassign to a different driver** — same `rm.orders.assign` gate, same mutation as `unassigned` (§5.3) | Driver app (accept) |
| `heading_to_restaurant` | View only | Driver app (arrival) |
| `at_restaurant` | **Optional fallback:** "Mark picked up" — see §5.4. Recommended to gate this behind `rm.orders.manage`, shown only at this exact stage | Driver app (normal path — PIN-verified pickup) |
| `picked_up` / `on_the_way` / `at_customer` | View only | Driver app |
| `delivered` / `rejected` / `cancelled` / `refunded` | View only (historical record) | — |
| Any non-terminal stage | **Cancel** — see the open decision in §5.5 before wiring this up for real | Restaurant or platform support |

**Assigning a driver from the restaurant Orders screen is now in scope** (revised 2026-09-20 — an
earlier version of this doc said not to build this). Gate it on the new `rm.orders.assign` permission
(§6), not on `rm.orders.manage` — a restaurant may want staff who can accept/reject/advance orders
without also being able to pick which driver takes them, or vice versa. This is intentionally a
narrower capability than this console's full Dispatch board (`/dispatch`): just "pick an eligible
driver for this one ready order," not ETA editing, bulk reassignment, or the live map. If your
Restaurant Admin app wants that fuller feature set too, treat it as a separate project informed by
`src/routes/_authenticated/dispatch.tsx` and `src/lib/drivers.firebase.ts`, gated on the existing
`rm.delivery.*` permissions instead.

---

## 5. Mutations (must preserve field names and semantics)

### 5.1 Accept / reject (`status: "pending"` only)

```ts
// Accept
await setFirebaseOrderStatus({ orderId, status: "accepted", actor: session.email });

// Reject — reason is mandatory, shown to the customer
await rejectFirebaseOrder({ orderId, reason, actor: session.email });
// sets status: "rejected", rejected_at, rejection_reason, clears driver_* fields
```

**⚠️ Accept has a precondition as of 2026-09-20: `order.payment_method === "eft"` orders cannot be
accepted until their proof of payment is approved.** See §5.6 before implementing Accept — calling
`setFirebaseOrderStatus` directly for an unreviewed EFT order (as the snippet above does) bypasses
that check entirely; this console's own `acceptOrder()` throws first if the check fails, and your
Accept implementation must do the same.

### 5.2 Kitchen advance (`accepted → preparing → ready`)

Identical to the existing Kitchen handover doc — no changes here:

```ts
await setFirebaseOrderStatus({
  orderId,
  status: nextStatus, // "preparing" or "ready"
  etaMinutes: nextStatus === "ready" ? Math.max(5, order.eta_minutes ?? 15) : null,
  actor: session.email,
});
```

### 5.3 Assigning a driver — gated on `rm.orders.assign` (§6)

```ts
// Only valid while status is "ready" (or legacy "offered"). Notice: status is
// NOT part of this patch — it stays "ready" until the driver accepts.
await fsSet(`orders/${orderId}`, {
  ...order,
  driver_id, driver_name, driver_phone, driver_photo, driver_rating,
  eta_minutes, eta_at,
  updated_at: new Date().toISOString(),
});
```

Reassigning to a different driver uses the exact same write and is only valid while `status` is still
`"ready"` — once the driver accepts (`status: "assigned"`), no one may casually overwrite `driver_id`
through this path.

**Eligibility — do not just list every driver.** A driver may only be assigned if they already hold
an active `driverAssignments/{driverId__restaurantId__branchId}` record for this order's exact
restaurant + branch — a standing roster grant, not something created per-order (see
`ORDER_WORKFLOW_HANDOVER.md` §1 and `DELIVERY_APP_FIRESTORE_HANDOVER.md` §3.2). If you assign a driver
without one, their Accept fails server-side with "not authorized for this delivery," and the order
sits at `waiting_accept` forever with no way for the driver to clear it. Filter your driver picker the
same way `src/lib/drivers.firebase.ts`'s `hasActiveAssignment()` / `isDriverEligibleForBranch()` do —
port that logic rather than re-deriving it, the branch-id/restaurant-id normalization it does (legacy
prefix mismatches like `"rst-"` vs bare ids) is easy to get subtly wrong.

### 5.4 "Mark picked up" fallback (optional — only valid at stage `at_restaurant`)

This console added this as a pragmatic safety valve after real orders got permanently stuck waiting on
a driver-app write that hadn't shipped yet. If you build it, gate it exactly the same way — **only**
show/allow it when `orderStage(order) === "at_restaurant"`, never earlier:

```ts
// Writes the SAME fields the driver app's own PIN-verified pickup would.
await setFirebaseOrderStatus({ orderId, status: "picked_up", actor: session.email });
// → patch: { status: "picked_up", driver_status: "picked_up", picked_up_at: now }
```

There is **no** equivalent fallback for driver acceptance or arrival — those stages have no override
anywhere in this platform. If that becomes painful in practice (as it did here), that's a product
decision to make explicitly, not something to route around silently.

### 5.5 Cancel — ⚠️ open decision, do not assume behaviour

Nothing in this platform currently defines what cancelling mid-delivery *does* beyond flipping
`status: "cancelled"` — no driver push notification, no partial-earnings logic. Before wiring a Cancel
button up for real use, confirm with product what should happen; see `ORDER_WORKFLOW_HANDOVER.md` §5
open decision #1, which applies here unchanged.

### 5.6 Proof of payment approval — EFT orders only (added 2026-09-20)

A restaurant may enable "Bank transfer (EFT)" as a payment method (§11) — the customer transfers the
money themselves and uploads proof (image or PDF) at checkout. That upload is **not** self-verifying:
someone has to actually look at it and confirm the amount/reference are right before the order is
real money in the bank. This console's Payments page has a dedicated **"Proof of payment"** tab for
exactly that review, and — critically — **`acceptOrder()` now refuses to accept an EFT order until
that review has happened.** Your Restaurant Admin app's Accept action must enforce the same rule (see
§5.1); it must also give restaurant staff *somewhere* to do the review itself, or their own EFT orders
will get permanently stuck at `pending` with no visible way to unblock them.

**The data**, from `src/lib/payments.firebase.ts` — a separate record per order at
`orders/{orderId}/payment` (this is payment *evidence*, unrelated to the two `timeline`s in §7):

```ts
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export interface OrderPaymentEvidence {
  order_id: string;
  method: string;           // see the §2 landmine — usually "eft" here
  status: PaymentStatus;    // "pending" = not yet reviewed; gates Accept while payment_method is "eft"
  amount: number;
  currency: string;         // "ZAR"
  receipt_number: string;
  proof_url: string | null; // the uploaded image/PDF — null until the customer uploads
  rejection_reason: string | null; // set when staff reject (status -> "failed")
  reviewed_by: string | null;      // who approved or rejected, and reviewed_at when
  reviewed_at: string | null;
  paid_at: string | null;
  recorded_by: string | null;
  // + gateway/reference/card_brand/card_last4 fields, not relevant to EFT
  updated_at: string;
}
```

**The gate** — port this exactly, it's the whole point of this section:

```ts
// Inside your Accept handler, before writing status: "accepted":
if (order.payment_method === "eft") {
  const evidence = await getOrderPaymentEvidence(order.id); // orders/{id}/payment, one-shot read
  if (!evidence || evidence.status !== "paid") {
    throw new Error(
      "This order was paid by bank transfer — approve the uploaded proof of payment before accepting.",
    );
  }
}
```

**The review actions** — a restaurant-scoped equivalent of this console's "Proof of payment" tab
needs, at minimum, a list of the restaurant's own EFT orders with `evidence.status === "pending"`,
each with:

- A link to `evidence.proof_url` (disable Approve until this is set — nothing to approve yet).
- **Approve** → `markOrderPaid({ order_id, order_number, total, payment_method: "eft", recorded_by:
  session.email })`. Sets `status: "paid"`, `paid_at`, `reviewed_by`/`reviewed_at`. This is the exact
  same function the receipt dialog's existing "Mark as paid" button already calls for cash orders —
  reuse it, don't fork it.
- **Reject** → `rejectOrderPayment({ order_id, reason, actor: session.email })` — reason is mandatory
  (mirrors §5.1's reject). Sets `status: "failed"`, `rejection_reason`, `reviewed_by`/`reviewed_at`.
  **Does not touch the order's own `status`** — rejecting the payment leaves the order sitting at
  `pending`; staff separately decide whether to also reject the order itself via §5.1.

There is currently **no dedicated `rm.*` permission for this review action** in
`restaurant-permissions.ts` — this console gates it with the platform permission `finance.manage`
("Initiate payouts, approve refunds, reconcile batches"), which has no Restaurant Admin equivalent.
Until product defines one, the closest existing fit is `rm.payments.manage` ("Configure payment
methods and reconcile" — §11); use that rather than reusing `rm.orders.manage` or `rm.orders.assign`,
which are about the order lifecycle and driver assignment, not payment verification. Flag this gap to
product if a dedicated `rm.orders.approve_payment`-style code turns out to be needed later — don't
silently decide it yourself.

Query all of a restaurant's orders awaiting review the way this console's
`listOrdersAwaitingPaymentApproval()` does: fetch the restaurant's orders, filter to
`payment_method === "eft"`, one-shot-read `orders/{id}/payment` for each, keep `status === "pending"`.
There's no live subscription for this queue yet in this console either — it polls on an interval; a
`onSnapshot`-based version would be a genuine improvement if you build one.

---

## 6. Permissions

Already reserved in `src/lib/restaurant-permissions.ts` — use these, don't invent new codes:

| Action | Permission |
|---|---|
| View orders | `rm.orders.view` |
| Accept / reject / advance / cancel / mark picked up | `rm.orders.manage` |
| **Assign or reassign a driver on a ready order** | **`rm.orders.assign`** *(new — added 2026-09-20)* |
| View kitchen queue | `rm.kitchen.view` |
| Advance kitchen prep | `rm.kitchen.manage` |
| View dispatch/delivery board (if you build that too) | `rm.delivery.view` |
| Full dispatch management — bulk reassignment, ETA, live map (if you build that too) | `rm.delivery.manage` |
| View a restaurant's enabled payment methods (§11) | `rm.payments.view` |
| Configure payment methods; **best current fit for reviewing/approving proof of payment (§5.6)** — no dedicated code exists yet | `rm.payments.manage` |

`rm.orders.assign` is deliberately **separate from `rm.orders.manage`** — a restaurant may want staff
who can accept/reject/advance orders without letting them pick drivers, or the reverse. Check both
independently; don't assume one implies the other. `rm.payments.manage` covers *both* "configure which
methods this restaurant accepts" (§11) and, until product says otherwise, "approve/reject proof of
payment" (§5.6) — these are conceptually distinct enough that a future dedicated code for the latter
wouldn't be surprising; don't hard-code the assumption that they'll always share one permission.

Role defaults already granted in `restaurant-permissions.ts`: `restaurant_owner` gets everything;
`restaurant_manager` and `branch_manager` get `rm.orders.assign` alongside their existing
`rm.orders.manage`; `kitchen_manager`, `kitchen_staff`, `cashier` and `inventory_manager` do **not**
get it by default (same as they don't get `rm.delivery.manage` today) — driver assignment isn't
kitchen, cashier, or inventory work. Adjust these defaults in the platform Access Control screen
(`/access` in this console) per-restaurant if a restaurant's actual staffing looks different; the
catalog entry itself (`RESTAURANT_PERMISSIONS` in `restaurant-permissions.ts`) is what makes the
permission grantable at all and needs no further code change to show up in that screen's permission
picker. Hide action buttons the signed-in user's permissions don't cover — don't just disable them.

---

## 7. ⚠️ Known landmine: two different, unrelated "timeline"s

Do not assume `orders/{id}/timeline/{eventId}` (Firestore subcollection, written by
`appendTimeline()` in this console) and the driver app's `timeline` **array field** on the order
document itself (described in `ORDER_WORKFLOW_HANDOVER.md` §1, used for the driver app's own
`needsAcceptance` check) are the same thing. They are not:

- **This console** appends kitchen/staff actions (accept, reject, advance, cancel, the picked-up
  fallback) to the **subcollection**.
- **The driver app** appends its own actions (accept, arrived, picked up, on the way, delivered) to
  the **inline array field** `order.timeline`.

Neither app currently reads the other's timeline. If your Restaurant Admin app wants a single,
merged activity log for an order, you must read **both** locations and merge them — there is no
existing helper that does this for you, in this console or elsewhere. If you only need the current
stage (§3), you don't need either timeline source at all.

---

## 8. Acceptance checklist

- [ ] Orders list is filtered client-side to `restaurant_id === session.restaurantId` (§1.3) — never
      trust Firestore rules to do this for you
- [ ] Status badge is computed via `orderStage()` (§3), never a raw `status` switch
- [ ] Badge copy matches §3's table so staff moving between this console and your app aren't confused
- [ ] Accept/Reject only shown at `pending`; reject requires a non-empty reason
- [ ] Kitchen advance only shown at `accepted`/`preparing`, gated on `rm.kitchen.manage`
- [ ] Driver assign/reassign picker only shown at `unassigned`/`waiting_accept`, gated on
      `rm.orders.assign` (checked independently of `rm.orders.manage`) — picker lists only drivers
      with an active `driverAssignments` grant for this order's restaurant + branch (§5.3)
- [ ] "Mark picked up" (if built) only appears at stage `at_restaurant`, gated on `rm.orders.manage`
- [ ] Legacy `status: "offered"`/`"arrived"` records still resolve to a sensible stage (§2, §3)
- [ ] Cancel behaviour matches whatever product decides for §5.5 — not shipped silently as a bare
      status flip
- [ ] Accept is blocked for `payment_method === "eft"` orders until `orders/{id}/payment.status ===
      "paid"` (§5.6) — verified by actually trying to accept an unreviewed EFT order and confirming
      it's refused, not just by reading the code
- [ ] A "Proof of payment" review screen exists somewhere in the app for EFT orders, scoped to
      `restaurant_id === session.restaurantId`, with Approve (disabled until `proof_url` exists) and
      Reject (reason required) (§5.6)
- [ ] Restaurant payment-method settings (§11) let a restaurant enable/disable EFT specifically — if
      EFT is enabled, there had better be a working review screen (previous item) reachable by
      someone, or orders will get stuck with no way to clear them
- [ ] Realtime: orders update without a manual refresh (subscribe, don't poll)

---

## 9. AI implementation prompt (copy-paste)

```
You are updating the Orders section of the Restaurant Management app ("Orderly Hub") to match the
current order status model in the ForkFleet Super Admin console (reference:
docs/SUPER_ADMIN_TO_RESTAURANT_ADMIN_ORDERS_HANDOVER.md and docs/ORDER_WORKFLOW_HANDOVER.md in the
forkfleetadminconsole repo). Do not invent a different status model — copy the one in those docs
exactly, including the orderStage() algorithm.

## Goal
Restaurant admins must see the SAME order status labels the platform ops console shows — not a raw
`status` value, which is ambiguous (see §1.2 of the handover doc: "ready" means either "no driver
yet" or "driver hasn't accepted"; "assigned" means either "heading to restaurant" or "at restaurant").

## Required behaviour

### 1. Scoping
- Filter every order query/subscription to order.restaurant_id === session.restaurantId, client-side.
- Firestore rules do NOT enforce this for orders today — do not rely on them.

### 2. Status model
- Use the exact OrderStatus / DriverStatus / FirebaseOrder types from the handover doc §2.
- Implement orderStage() from §3 verbatim, including the legacy "offered"/"arrived" handling.
- Render badge text from the §3 table, matching the ops console's wording.

### 3. Actions (gate each behind the matching rm.* permission from §6)
- pending: Accept / Reject (reason required) → rm.orders.manage. Accept must first check §5.6's
  proof-of-payment gate for payment_method === "eft" orders — do not skip this.
- accepted → preparing → ready: kitchen advance → rm.kitchen.manage
- unassigned / waiting_accept: assign or reassign a driver → rm.orders.assign (check this
  INDEPENDENTLY of rm.orders.manage — a user can have one without the other). Only list drivers with
  an active driverAssignments grant for this order's restaurant + branch (handover doc §5.3) —
  port the eligibility check from src/lib/drivers.firebase.ts, don't re-derive it.
- at_restaurant only: optional "Mark picked up" fallback → rm.orders.manage
- Proof of payment review (handover doc §5.6): a screen listing this restaurant's EFT orders with
  evidence.status === "pending", with Approve (disabled until proof_url is set) and Reject (reason
  required) → rm.payments.manage (no dedicated code exists yet — see §6).
- Restaurant payment-method settings (handover doc §11): enable/disable card, cash_on_delivery,
  cash_on_pickup, eft → rm.payments.view to see it, rm.payments.manage to change it.
- Do NOT build the full Dispatch board here (bulk reassignment, ETA editing, live map) — that's a
  separate Delivery module (rm.delivery.*), out of scope for this task.
- Cancel: implement the button, but confirm the actual cancellation side-effects with product first
  (see handover doc §5.5) — do not assume "just flip status" is complete.

### 4. Data layer
- Reuse or port src/lib/orders.firebase.ts's setFirebaseOrderStatus / rejectFirebaseOrder,
  src/lib/dispatch.functions.ts's orderStage, src/lib/drivers.firebase.ts's
  hasActiveAssignment / isDriverEligibleForBranch for the assign picker, and
  src/lib/payments.firebase.ts's getOrderPaymentEvidence / markOrderPaid / rejectOrderPayment /
  listOrdersAwaitingPaymentApproval / getPaymentConfig / savePaymentConfig, exactly as documented.
- Firestore paths: orders/{id}, orders/{id}/items/{lineId}, orders/{id}/payment (payment evidence —
  §5.6), restaurants/{id}/payment_config (§11). Do NOT use the driver app's inline `timeline` array
  field for anything except reading it if you specifically need driver-side history — see handover
  doc §7 for why it's a separate, unmerged log from this console's own orders/{id}/timeline
  subcollection (itself unrelated to orders/{id}/payment — three different sub-records per order,
  don't conflate them).

### 5. Realtime
- Subscribe (Firestore onSnapshot), don't poll.

## Non-goals
- Do not build the full Dispatch board (bulk reassignment, ETA editing, live map) on this screen —
  a simple "assign this one ready order to an eligible driver" picker is in scope; that fuller
  feature set is not.
- Do not invent new status or driver_status values.
- Do not treat Firestore rules as sufficient restaurant-level access control.
- Do not let rm.orders.manage imply rm.orders.assign, or vice versa — check them independently.
- Do not let a proof-of-payment rejection also reject the order itself — those are separate actions.
- Do not assume order.payment_method and payment-evidence method are the same enum (handover doc §2).

## Reference files (ForkFleet Console repo)
- src/lib/orders.firebase.ts
- src/lib/dispatch.functions.ts (orderStage, STAGE_LABEL, DispatchOrder)
- src/routes/_authenticated/orders.tsx (reference UI + gating logic)
- src/lib/drivers.firebase.ts (hasActiveAssignment, isDriverEligibleForBranch — driver eligibility)
- src/lib/payments.firebase.ts (proof-of-payment evidence + restaurant payment-method config)
- src/routes/_authenticated/payments.tsx (reference "Proof of payment" tab UI)
- src/components/restaurants/payment-methods-editor.tsx (reference payment-method toggle UI)
- src/lib/restaurant-permissions.ts (rm.orders.*, rm.kitchen.*, rm.delivery.*, rm.payments.*)
- docs/ORDER_WORKFLOW_HANDOVER.md (driver-app contract)
- docs/KITCHEN_UI_RESTAURANT_MANAGEMENT_HANDOVER.md (kitchen advance flow — Firestore paths, not RTDB)
```

---

## 10. Source map (Super Admin repo)

| File | Role |
|---|---|
| `src/lib/orders.firebase.ts` | `OrderStatus`, `DriverStatus`, `FirebaseOrder`, `setFirebaseOrderStatus`, `rejectFirebaseOrder`, `markArrivedAtRestaurant` |
| `src/lib/dispatch.functions.ts` | `DispatchOrder` view model, `orderStage()`, `STAGE_LABEL`, `assignDriver`, `advanceDelivery` |
| `src/lib/drivers.firebase.ts` | `hasActiveAssignment()`, `isDriverEligibleForBranch()` — the eligibility check for §5.3's driver picker |
| `src/routes/_authenticated/orders.tsx` | Reference Orders UI — stage badges, accept/reject, kitchen advance, driver assign/reassign, the "Mark picked up" fallback |
| `src/routes/_authenticated/dispatch.tsx` | Reference Dispatch board — driver assignment, lane-by-stage layout (out of scope here, useful if you build Delivery too) |
| `src/lib/kitchen.functions.ts` | Kitchen queue filter + mutations (see the older Kitchen handover doc) |
| `src/lib/payments.firebase.ts` | `OrderPaymentEvidence`, `getOrderPaymentEvidence`, `markOrderPaid`, `rejectOrderPayment`, `listOrdersAwaitingPaymentApproval`, `RestaurantPaymentConfig`, `PAYMENT_METHOD_CATALOG` — see §5.6 and §11 |
| `src/routes/_authenticated/payments.tsx` | Reference "Proof of payment" tab UI — §5.6 |
| `src/components/restaurants/payment-methods-editor.tsx` | Reference payment-method toggle UI — §11 |
| `src/lib/restaurant-permissions.ts` | `rm.orders.*`, `rm.kitchen.*`, `rm.delivery.*`, `rm.payments.*` permission codes |
| `src/lib/restaurant-users.firebase.ts` | Restaurant admin sign-in + `RestaurantUserSession.restaurantId` |
| `firestore.rules` | Current (unscoped) restaurant access to `orders` — see §1.3 |

---

## 11. Restaurant payment-method configuration (added 2026-09-20)

This is the restaurant-level settings piece that §5.6 depends on: a restaurant chooses *which*
payment methods it accepts, and enabling EFT is what puts orders into the §5.6 review queue at all.
This belongs in your Restaurant Admin app's own **Payments** section (`rm.payments.view` /
`rm.payments.manage` — already reserved in `restaurant-permissions.ts`, described as "View payment
methods and transaction history" / "Configure payment methods and reconcile"), separate from the
order-review "Proof of payment" tab in §5.6 (which is about individual orders, not restaurant
settings) — you may end up placing both under one "Payments" tab in your app; that's a UI choice, not
a data-model one.

**The data**, from `src/lib/payments.firebase.ts` — one record per restaurant at
`restaurants/{restaurantId}/payment_config`:

```ts
export type PaymentMethodId = "card" | "cash_on_delivery" | "cash_on_pickup" | "eft";

export interface PaymentMethodSetting {
  enabled: boolean;
  instructions: string | null; // optional customer-facing note
}

export interface RestaurantPaymentConfig {
  restaurant_id: string;
  methods: Record<PaymentMethodId, PaymentMethodSetting>;
  updated_at: string;
  updated_by: string | null;
}
```

The **customer app** reads this config to decide which payment methods to *offer at checkout* for
that restaurant — it is not itself part of the order-acceptance flow, but it's the reason an order
ever has `payment_method: "eft"` in the first place. `PAYMENT_METHOD_CATALOG` in the same file is the
static list of the four methods above plus their customer-facing labels/hints, and which order type
(`delivery`/`pickup`) each applies to — card and EFT apply to both; `cash_on_delivery` is delivery
only; `cash_on_pickup` is pickup only.

**Reference functions** (all in `payments.firebase.ts`): `getPaymentConfig(restaurantId)`,
`subscribePaymentConfig(restaurantId, cb)`, `savePaymentConfig({ restaurant_id, methods, updated_by })`
— the last one requires at least one method to stay enabled (customers must always be able to pay
somehow) and throws otherwise. When no config exists yet for a restaurant, `defaultPaymentConfig()`
applies — card only, everything else off — so a restaurant that has never touched this screen still
works correctly; don't treat a missing config as an error state.

Reference UI to mirror: `src/components/restaurants/payment-methods-editor.tsx` (used inside this
console's Restaurant detail page, gated there by platform permissions — map that to `rm.payments.view`
/ `rm.payments.manage` in your app).

---

*Prepared as a handover reference — update alongside any change to the order/driver status model.*
