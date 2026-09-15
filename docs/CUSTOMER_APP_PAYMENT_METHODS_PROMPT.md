# Prompt — Link per-restaurant payment methods to the customer app

**How to use this file**

1. Attach the integration guide `docs/CUSTOMER_APP_PROMOTIONS_INTEGRATION.md`
   (section **§3.6 payment methods** is the contract for this task).
2. Paste **everything below the line** into the customer app's AI tool.

Scope of THIS prompt: syncing the **payment method options** (what the customer
is offered at checkout). Proof-of-payment receipts / payment evidence are a
separate contract (§3.8) — use `CUSTOMER_APP_PAYMENTS_PROMPT.md` for that.

Live fixture in the shared DB (`e-comm-bd997`): restaurant `rst_5jqj45emntl`
("Restaurant test 1") currently has **card + cash on pickup** enabled at
`/restaurants/rst_5jqj45emntl/payment_config`.

---

## PROMPT — copy everything below this line

### Task — checkout must offer the payment methods each restaurant allows

The ForkFleet Console (operator portal) configures, **per restaurant**, which
payment methods customers may use — **card payment, cash on delivery, cash on
pickup, and bank transfer (EFT) with proof-of-payment upload** — each with an
on/off switch and an optional customer note. This app must read that
configuration **live** and apply it at checkout. Nothing is hardcoded:
toggling a switch in the portal changes the checkout within ~1 s, with no app
update.

#### 1. Data contract (copy verbatim from guide §3.6)

```ts
export type PaymentMethodId =
  | "card"
  | "cash_on_delivery"
  | "cash_on_pickup"
  | "eft";

export interface PaymentMethodSetting {
  enabled: boolean;
  instructions: string | null;    // optional note shown at checkout
}

export interface RestaurantPaymentConfig {
  restaurant_id: string;
  methods: Record<PaymentMethodId, PaymentMethodSetting>;
  updated_at: string;
  updated_by: string | null;
}
```

Path: `/restaurants/{restaurantId}/payment_config` — **read-only** for this app.

#### 2. Subscribe live

```ts
import { getDatabase, ref, onValue } from "firebase/database";
const db = getDatabase(app);

// resubscribe whenever the cart's restaurant changes
onValue(ref(db, `restaurants/${restaurantId}/payment_config`), (s) =>
  setPaymentConfig(s.val()),   // may be null — see rule (b)
);
```

Re-evaluate the checkout payment step whenever this value changes **and**
whenever the customer switches between delivery and pickup.

#### 3. Checkout rules (normative)

1. **Applicability is fixed per method:**
   - `card` → delivery **and** pickup — shows the **card input form** (below)
   - `cash_on_delivery` → **delivery only**
   - `cash_on_pickup` → **pickup only**
   - `eft` → delivery **and** pickup — shows the **proof-of-payment upload**
     (below)
2. Offer only methods where `enabled === true` AND the method applies to the
   currently selected order type. Never offer `cash_on_pickup` on a delivery
   order or `cash_on_delivery` on a pickup order.
3. **No config record (null) → offer `card` only** (legacy behaviour).
4. The portal enforces at least one enabled method, but guard anyway: if the
   current order type ends up with zero applicable methods, fall back to
   offering `card` rather than rendering an empty payment step.
5. Show the method's `instructions` note under its label when set
   (e.g. *"Please have exact change ready"*).
6. The customer must pick exactly one method; persist the choice as
   `order.payment_method` using the exact id string (`"card"` /
   `"cash_on_delivery"` / `"cash_on_pickup"` / `"eft"`).
7. Suggested labels (match the console): *Card payment* — "Pay securely
   online" · *Cash on delivery* — "Pay the driver in cash" · *Cash on
   pickup* — "Pay at the counter" · *Bank transfer (EFT)* — "Upload your proof
   of payment".

#### 4. Selecting **Card payment** → show the full card form

All fields REQUIRED (guide §3.6 "Card payment form"):

- **Cardholder name** — letters, 2–50 chars
- **Card number** — 13–19 digits, **Luhn-valid**, grouped in 4s, brand
  detection with logo (Visa/Mastercard/Amex)
- **Expiry** — `MM/YY`, month 01–12, not in the past
- **CVV** — 3–4 digits, masked input
- Optional *save card* checkbox — tokenized via your gateway only

> 🔒 The full card number and CVV may NEVER touch Firebase, logs or analytics.
> A hosted gateway page may replace the form, but the evidence record still
> needs the gateway `reference`. Store only `card_brand` + `card_last4`.

#### 5. Selecting **Bank transfer (EFT)** → show proof-of-payment upload

- Bank details / reference instructions visible (use `instructions` + order
  number as the reference).
- **Required file upload** accepting **`image/*` and `application/pdf`**, max
  5 MB, with preview (image thumbnail or PDF chip showing name + size) and
  remove/replace.
- The order canNOT be placed until a file is attached.
- Upload it to your storage (e.g. Firebase Storage
  `payment_proofs/{orderId}/…`) and keep the public URL for the evidence
  record (`proof_url`, guide §3.8) — the payments/receipts task writes the
  record itself.

#### 6. UX polish

- Payment step shows method name, one-line hint, optional note, and a clear
  selected state. Default-select the first offered method.
- After checkout, echo the chosen method's expectation on the tracking screen
  ("Pay the driver in cash", "Pay at the counter when you collect", "We are
  verifying your EFT — we'll confirm shortly").
- (Proof-of-payment receipts/payment evidence are handled by a separate task —
  don't build them here.)

### Acceptance tests — run against the live database

| # | Scenario | Expected |
|---|---|---|
| 1 | `rst_5jqj45emntl`, order type = **pickup** | Offers: **Card payment**, **Cash on pickup** ("exact change" note), **Bank transfer (EFT)** |
| 2 | Same restaurant, order type = **delivery** | Offers **Card payment** and **Bank transfer (EFT)** — cash on pickup must NOT appear |
| 3 | A restaurant with **no** `payment_config` node | Offers **Card payment only** |
| 4 | Portal disables "cash on pickup" while checkout is open | It disappears within ~1 s, no restart/refresh |
| 5 | Toggle delivery ↔ pickup on checkout | Method list updates instantly per rules 1–2 |
| 6 | Place an order with cash on pickup | `order.payment_method === "cash_on_pickup"` in the written record |
| 7 | Select Card payment | Full form appears (cardholder, number, MM/YY, CVV); Luhn-invalid number / past expiry / short CVV all block placing the order; brand logo shows |
| 8 | Select Bank transfer (EFT) | Upload field appears accepting image or PDF; **order cannot be placed** until a file is attached; file uploads and its URL is available for `proof_url` |

### Rules

- Never hardcode method lists or the fixture values above — resolve live from
  RTDB. The fixture is only for tests.
- Do NOT write anything under `/restaurants/**` — this config is portal-owned,
  read-only for this app.
- Copy the types verbatim; if existing checkout code disagrees with these
  rules, the rules win — flag conflicts to me.

When done, show me: (a) screenshots/states for tests 1–3, (b) the live-toggle
behaviour from test 4, and (c) the written `payment_method` value from test 6.
