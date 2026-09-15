# Prompt — Integrate payments & proof of payment with the customer app

**How to use this file**

1. Attach the integration guide `docs/CUSTOMER_APP_PROMOTIONS_INTEGRATION.md`
   (sections **§3.6 payment methods** and **§3.8 payment evidence** are the
   contract for this task).
2. Paste **everything below the line** into the customer app's AI tool.

Live reference data already exists in the shared Firebase DB
(`e-comm-bd997`): restaurant `rst_5jqj45emntl` has **card + cash on pickup**
enabled, and demo orders `ord_demo_delivery_01` (card, paid) and
`ord_demo_pickup_01` (cash on pickup, pending) carry evidence records at
`/orders/{id}/payment` you can inspect while building.

---

## PROMPT — copy everything below this line

### Task — make payments fully synced with the ForkFleet Console

This app (customer-facing) and the operator portal share one Firebase RTDB.
The portal now configures **per-restaurant payment options** and displays a
**payment receipt (proof of payment)** per order. Implement both sides of that
contract in this app, exactly per the attached guide.

#### 1. Read what each restaurant accepts (§3.6)

- Subscribe live to `/restaurants/{restaurantId}/payment_config` whenever the
  cart's restaurant changes.
- At checkout offer ONLY methods that are `enabled` **and** applicable to the
  selected fulfilment type: `card` = delivery & pickup · `cash_on_delivery` =
  delivery only · `cash_on_pickup` = pickup only. Never offer a cash method for
  the wrong order type.
- Show each method's `instructions` note (when set) under its label.
- **Missing config → card only.** The portal guarantees ≥1 method; mirror the
  guard (never render an empty payment step — fall back to card).
- The selection writes `order.payment_method` (exact id string).

#### 2. Write the proof of payment at placement (§3.8)

- In the same transaction that creates `/orders/{orderId}`, write
  `/orders/{orderId}/payment` as an `OrderPaymentEvidence` record (copy the
  type from §3.8 verbatim).
- `card` ⇒ `status: "paid"`, real `gateway` + `reference`, `paid_at: now`,
  `recorded_by: "customer_app"`, plus `card_brand` + `card_last4` from the
  gateway response (the full PAN/CVV may NEVER be stored anywhere).
- `cash_on_delivery` / `cash_on_pickup` ⇒ `status: "pending"`, `paid_at: null`,
  `recorded_by: "customer_app"`, and set `order.payment_status: "pending"`.
- `eft` ⇒ same pending shape, PLUS the uploaded proof-of-payment file's public
  URL in `proof_url` (image or PDF — required; the order can't be placed
  without it). Staff verify the transfer in the console and mark it paid.
- `receipt_number` = `"R-" + order.order_number` (deterministic — required).
- `amount` = the final `order.total` **after** coupons/combos/points discounts
  (§5 of the guide). Currency `"ZAR"`.

#### 3. Keep the receipt in sync (two-way)

- Subscribe to `/orders/{id}/payment` on the order detail / tracking screen.
  Staff can mark a cash order **Paid** from the console (handover) — the app
  must reflect it within ~1 s: status chip, `paid_at`, recorded_by.
- Add a **Receipt screen** in order history showing: receipt number (mono),
  payment method, status (Paid / Awaiting payment / Failed / Refunded), amount,
  `paid_at`, gateway reference for card orders, and the full order breakdown
  (lines, subtotal, discounts, delivery fee, tip, total). This is the
  customer's proof of payment — the console shows the identical dialog, so the
  numbers must match exactly.

#### 4. Cash flow UX

- Pickup + cash on pickup: tracking copy tells the customer to pay at the
  counter; when the console records the payment (or the order is closed), show
  **"Paid at counter — receipt R-…"**.
- EFT: tracking shows **"Verifying your proof of payment"** while
  `status: "pending"` with a link to the uploaded document; when staff mark it
  paid in the console, flip to **"Payment verified — receipt R-…"** live.
- Card receipts/shows show the brand + last 4 (`Visa •••• 4832`) using
  `card_brand`/`card_last4`.
- Delivery + cash on delivery: copy tells the customer to have cash ready for
  the driver; flip to Paid when the evidence record flips.
- Failed card payments: set evidence `status: "failed"` and allow retry —
  retry updates the same record and the same `receipt_number`.

### Acceptance tests (must all pass against the live DB)

| # | Scenario | Expected |
|---|---|---|
| 1 | Restaurant with card + cash_on_pickup enabled, pickup order | checkout offers exactly: Card payment, Cash on pickup |
| 2 | Same restaurant, delivery order | checkout offers Card payment only (no cash on pickup!) |
| 3 | Restaurant with NO `payment_config` | Card payment only |
| 4 | Portal toggles cash_on_pickup off | method disappears from checkout within ~1 s, no restart |
| 5 | Card order placed | `/orders/{id}/payment` exists immediately: `status "paid"`, gateway+reference set, `receipt_number "R-<order_number>"`, `amount == order.total` |
| 6 | Cash-on-pickup order placed | evidence `status "pending"`, `paid_at null`, receipt number correct |
| 7 | Console marks test pickup order paid | app receipt flips to Paid with `paid_at`, within ~1 s |
| 8 | Order with a combo + coupon discount | evidence `amount` equals the discounted total, never the pre-discount total |
| 9 | Receipt screen vs console receipt dialog on the same order | identical receipt number, method, amount, status |

### Rules

- Never hardcode the payment config snapshot above — resolve live. The
  snapshot is only the test fixture.
- Writes allowed: `/orders/**` (order + payment evidence), coupon
  `usage_count`, `/loyalty/**`. Never write `/promotions/**`, `/menus/**`,
  `/restaurants/**`.
- Copy types from the guide verbatim (`RestaurantPaymentConfig` §3.6,
  `OrderPaymentEvidence` §3.8). If existing code conflicts with these rules,
  the guide wins — flag the conflict to me.

When done, show me: the checkout payment step for both order types at the
live test restaurant, the evidence records written for one card + one cash
order, and acceptance results 1–9 line by line.
