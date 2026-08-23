# Customer App — Promotions & Loyalty Integration Guide

> **Hand this document to your AI agent or developer to implement promotions in the
> customer-facing app.** It is self-contained: it defines every Realtime Database
> path, every data shape, and the exact checkout algorithms (with reference code)
> used by the ForkFleet management portal. Follow it literally and the customer
> app will stay in lock-step with everything an operator configures in the portal.
>
> Scope: **coupon promotions, combo deals (bundles + 3-for-2 multi-buy), the
> Points & Rewards loyalty programme (global rules + per-restaurant overrides),
> order fulfilment types, and per-restaurant payment options.**

---

## 1. Architecture — how the link works

```
┌───────────────────────────┐         ┌─────────────────────────────┐
│ ForkFleet Console (portal)│ writes  │  Firebase Realtime Database │
│  – Promotions & Loyalty   ├────────►│  e-comm-bd997               │
│  – Restaurant profiles    │         └─────────────┬───────────────┘
└───────────────────────────┘                       │ live subscribe (onValue)
                                            ┌───────▼────────┐
                                            │  CUSTOMER APP  │
                                            │  menus · cart  │
                                            │  checkout ·    │
                                            │  rewards wallet│
                                            └────────────────┘
```

- **Single source of truth = RTDB.** The customer app **must not** hard-code any
  promotion. It subscribes to the paths below and re-evaluates the cart whenever
  data changes.
- Everything the portal changes is visible to the customer app **within ~1 second** —
  no app release, no deploy.
- The customer app **only writes** three things back: orders, coupon `usage_count`
  increments, and loyalty wallet/ledger entries (§9). All promo *configuration*
  writes come from the portal.

### Connection

| Setting | Value |
|---|---|
| Project ID | `e-comm-bd997` |
| RTDB URL | `https://e-comm-bd997-default-rtdb.firebaseio.com` |
| REST fallback | `GET {RTDB_URL}/{path}.json` (append `?shallow=true` for key lists) |

---

## 2. RTDB data map

| Path | Shape | Written by | Purpose |
|---|---|---|---|
| `/promotions/codes/{promoId}` | `PromoCampaign` | portal | Coupon codes |
| `/promotions/combos/{comboId}` | `ComboDeal` | portal | Bundle & multi-buy deals |
| `/promotions/global/points_config` | `GlobalPointsConfig` | portal | Loyalty defaults (all restaurants) |
| `/promotions/restaurant_points/{restaurantId}` | `RestaurantPointsOverride` | portal | Per-restaurant loyalty overrides |
| `/menus/{restaurantId}/items/{itemId}` | `MenuItem` | portal | Menu items (incl. `points_value`) |
| `/restaurants/{restaurantId}/delivery_tiers` | `DeliveryTier[]` | portal | Distance-based delivery fees |
| `/restaurants/{restaurantId}/payment_config` | `RestaurantPaymentConfig` | portal | Payment methods offered at checkout |
| `/orders/{orderId}` + `/orders/{orderId}/items/{lineId}` | `FirebaseOrder` / `OrderLine` | customer app | Orders (existing flow) |
| `/orders/{orderId}/payment` | `OrderPaymentEvidence` | customer app + console | Proof of payment / receipt (§3.8) |
| `/loyalty/wallets/{customerId}` | `LoyaltyWallet` | customer app | Points balance (§9) |
| `/loyalty/ledger/{customerId}/{entryId}` | `LedgerEntry` | customer app | Points earn/spend history (§9) |

---

## 3. Data contracts (copy these TypeScript types verbatim)

### 3.1 Coupon campaigns — `/promotions/codes`

```ts
export type PromoType = "percent" | "fixed" | "free_delivery" | "bogo";
export type PromoScope = "platform" | "restaurant" | "first_order";

export interface PromoCampaign {
  id: string;
  code: string;                    // uppercase, unique — e.g. "WELCOME20"
  name: string;
  description: string | null;
  type: PromoType;
  value: number;                   // % or ZAR (ignored for free_delivery/bogo)
  scope: PromoScope;
  /** Legacy single-restaurant field. READ VIA promoRestaurantIds(), never directly. */
  restaurant_id: string | null;
  /** Restaurants the coupon works at when scope === "restaurant". Empty otherwise. */
  restaurant_ids: string[] | null;
  min_order: number;               // minimum subtotal (R) to apply
  max_discount: number | null;     // cap on the discount (R)
  usage_limit: number | null;      // total redemptions platform-wide (null = unlimited)
  usage_count: number;             // increment atomically on each successful use
  starts_at: string;               // ISO 8601
  expires_at: string;              // ISO 8601
  is_active: boolean;
  applies_to: "all" | "orders" | "delivery" | "items";
  created_at: string;
  updated_at: string;
}

/** Canonical read of a coupon's restaurant allow-list (handles legacy records). */
export function promoRestaurantIds(p: PromoCampaign): string[] {
  if (p.scope !== "restaurant") return [];
  if (Array.isArray(p.restaurant_ids)) return p.restaurant_ids;
  return p.restaurant_id ? [p.restaurant_id] : [];
}
```

**Scope meanings:**
| `scope` | Meaning |
|---|---|
| `platform` | Valid at **every** restaurant. |
| `restaurant` | Valid **only** at the checked restaurants (`promoRestaurantIds(p)`). Order's `restaurant_id` must be in the list. |
| `first_order` | Any restaurant, but only for a customer's **first delivered order** (check order history: no prior order with `status === "delivered"`). |

### 3.2 Combo deals — `/promotions/combos`

```ts
export type ComboKind = "bundle" | "multibuy";
export type ComboDiscountType = "percent" | "fixed";

export interface ComboDeal {
  id: string;
  restaurant_id: string;          // combos ALWAYS belong to one restaurant
  name: string;                   // e.g. "Family Feast" / "3-for-2 Burger Deal"
  description: string | null;
  kind: ComboKind;                // missing on old records → treat as "bundle"
  item_ids: string[];             // bundle: 2+ item ids · multibuy: exactly 1 item id
  discount_type: ComboDiscountType | null;  // bundle only
  discount_value: number | null;            // bundle only (percent 0–100 or R>0)
  buy_qty: number | null;         // multibuy only: units the customer receives
  pay_qty: number | null;         // multibuy only: units the customer pays for
  is_active: boolean;
  starts_at: string;              // ISO 8601
  expires_at: string;             // ISO 8601
  created_at: string;
  updated_at: string;
}

export function comboKind(deal: ComboDeal): ComboKind {
  return deal.kind === "multibuy" ? "multibuy" : "bundle";
}
```

- **bundle** — the customer who adds **every** listed item to the cart gets
  `discount_type`/`discount_value` off the bundle total (percent 0–100, or fixed R).
- **multibuy** — the customer who orders `buy_qty` units of the item pays for only
  `pay_qty` units (e.g. 3 for 2 ⇒ pay less). Applies per complete group
  (e.g. 6 units of a 3-for-2 = pay 4).

### 3.3 Loyalty — points config + overrides

```ts
export interface GlobalPointsConfig {
  enabled: boolean;
  method: "none" | "per_order" | "per_item" | "both";
  points_per_order: number;              // flat pts per delivered order
  points_per_item_default: number;       // pts per item unit (fallback)
  redemption_enabled: boolean;
  points_required: number;               // pts needed for one redemption
  discount_percent: number;              // % off subtotal when redeemed
  updated_at: string;
  updated_by: string | null;
}

export interface RestaurantPointsOverride {
  restaurant_id: string;
  enabled: boolean;                      // false = this restaurant opted out
  method: "none" | "per_order" | "per_item" | "both" | null;   // null = inherit
  points_per_order: number | null;
  points_per_item_default: number | null;
  redemption_enabled: boolean | null;
  points_required: number | null;
  discount_percent: number | null;
  updated_at: string;
  updated_by: string | null;
}
```

> ⚠️ Override fields are **`null` = inherit the global value**. Never treat `null`
> as zero. Use the canonical merge below — do not re-implement it differently.

```ts
export function resolveEffectivePointsConfig(
  global: GlobalPointsConfig,
  override: RestaurantPointsOverride | null,
): GlobalPointsConfig & { rewards_disabled_for_restaurant: boolean } {
  if (!override) return { ...global, rewards_disabled_for_restaurant: false };
  return {
    enabled: global.enabled && override.enabled,
    method: override.method ?? global.method,
    points_per_order: override.points_per_order ?? global.points_per_order,
    points_per_item_default: override.points_per_item_default ?? global.points_per_item_default,
    redemption_enabled:
      global.redemption_enabled &&
      override.redemption_enabled !== false &&
      (override.redemption_enabled === true || global.redemption_enabled),
    points_required: override.points_required ?? global.points_required,
    discount_percent: override.discount_percent ?? global.discount_percent,
    updated_at: override.updated_at ?? global.updated_at,
    updated_by: override.updated_by ?? global.updated_by,
    rewards_disabled_for_restaurant: !override.enabled,
  };
}
```

### 3.4 Menu items — `/menus/{restaurantId}/items/{itemId}`

```ts
export interface MenuItem {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  category: string;
  name: string;
  price: number;
  discount_price: number | null;   // item-level sale price (wins over price)
  points_value: number;            // per-unit loyalty points override (default 5)
  is_available: boolean;
  // ...other fields exist; only these are promotion-relevant
}

/** Unit price for all promo math. */
const sellPrice = (i: MenuItem) =>
  i.discount_price != null && i.discount_price > 0 ? i.discount_price : i.price;
```

### 3.5 Order fulfilment type — delivery vs customer pickup (REQUIRED)

Every order carries an `order_type`. The customer app **must set it when placing
the order** because it changes the entire lifecycle in the portal:

```ts
export type OrderType = "delivery" | "pickup";
```

| | `"delivery"` (default) | `"pickup"` |
|---|---|---|
| Who brings it | Driver assigned by dispatch | Customer collects at the counter |
| Required fields | `delivery_address`, `delivery_fee` | Neither — app must send `delivery_address: null`, `delivery_fee: 0` |
| Status flow | pending → accepted → preparing → ready → **assigned** → picked_up → **on_the_way** → delivered | pending → accepted → preparing → ready → **picked_up** (customer collected) → **delivered** (= closed/completed) |
| Driver fields | populated at assignment | always `null` — the portal **rejects** driver assignment & `assigned`/`on_the_way` for pickup orders |

**What "picked_up" means depends on the type:** for delivery it means the *driver*
left the restaurant; for pickup it means the *customer collected* their order.
Staff then close it ("delivered"), so show pickup customers a terminal state like
**"Collected — enjoy!"** once status reaches `picked_up` or `delivered`.

If the field is missing (legacy orders), the portal treats the order as `"delivery"`.

### 3.6 Payment methods — `/restaurants/{restaurantId}/payment_config`

Operators toggle which payment methods each restaurant accepts. Read this path
**before rendering the checkout payment step**:

```ts
export type PaymentMethodId =
  | "card"
  | "cash_on_delivery"
  | "cash_on_pickup"
  | "eft";

export interface PaymentMethodSetting {
  enabled: boolean;
  instructions: string | null;    // optional note shown next to the method
}

export interface RestaurantPaymentConfig {
  restaurant_id: string;
  methods: Record<PaymentMethodId, PaymentMethodSetting>;
  updated_at: string;
  updated_by: string | null;
}
```

**Applicability is fixed by the method — enforce it at checkout:**

| Method | Offered for | Checkout behaviour | `order.payment_status` |
|---|---|---|---|
| `card` | delivery **and** pickup | Card input form (below) | `"paid"` (after gateway success) |
| `cash_on_delivery` | **delivery only** | hint only | `"pending"` → `"paid"` when the driver collects the cash |
| `cash_on_pickup` | **pickup only** | hint only | `"pending"` → `"paid"` when staff close the collected order |
| `eft` | delivery **and** pickup | proof-upload field (image or PDF) + bank details shown | `"pending"` → `"paid"` once staff verify the transfer |

**Card payment form — shown when `card` is selected.** All fields required:

| Field | Rules |
|---|---|
| Cardholder name | Letters/spaces, 2–50 chars, as printed on the card |
| Card number | 13–19 digits, **Luhn-valid**; display grouped in 4s; detect brand (Visa/Mastercard/Amex) and show its logo |
| Expiry | `MM/YY`, month 01–12, must not be in the past |
| CVV | 3–4 digits, password-style masked input |
| Save card | Optional checkbox — **tokenize via the gateway**; never store the raw number |

> 🔒 **Security (normative):** the full card number and CVV must NEVER be
> written to Firebase, logs, or analytics. If your gateway offers a hosted
> payment page you may redirect to it instead — but you must still write the
> evidence record with the returned `reference`, and you may store only
> `card_brand` + `card_last4` (§3.8).

**EFT proof-of-payment upload — shown when `eft` is selected (required):**

- File input accepting **`image/*` and `application/pdf`**, max 5 MB, with a
  preview (image thumbnail or PDF file chip + name + size).
- Show the restaurant's bank details / reference instructions next to the
  upload (use the method's `instructions` note plus the order number).
- The order **cannot** be placed until a file is chosen.
- Upload to your storage (e.g. Firebase Storage `payment_proofs/{orderId}/…`),
  then write the public URL to `evidence.proof_url` (§3.8) with
  `status: "pending"`. Staff verify the transfer in the console and mark it
  paid — subscribe so the app flips to Paid live.

Rules (normative):

1. Offer only methods that are `enabled` **and** applicable to the order's
   `order_type`. Never offer `cash_on_pickup` on a delivery order (or vice versa).
2. **Record missing → card only.** Restaurants without a config behave exactly as
   before.
3. The portal enforces at least one enabled method; mirror the guard — a
   restaurant with zero applicable methods must not present a dead checkout.
4. Write `order.payment_method` = the chosen id. Cash and EFT orders stay
   `payment_status: "pending"` until handover/verification.
5. Show `instructions` (when set) under the method name at checkout.
6. Subscribe live — toggle changes apply within ~1 s; re-evaluate the payment
   step whenever the config changes.

### 3.7 Cart line (your existing shape must map to this)

The portal's order lines look like:

```ts
export interface OrderLine {
  item_id: string;
  name: string;
  quantity: number;
  unit_price: number;   // = sellPrice(menu item) + variant/add-on deltas
  line_total: number;   // unit_price × quantity
}
```

> Note: variants/add-ons are baked into `unit_price`. Combo detection matches on
> `item_id` only; discount math uses the **menu item's `sellPrice`**, not variant
> pricing (keep it simple and predictable).

### 3.8 Payment evidence (receipt) — `/orders/{orderId}/payment`

Every order must carry a proof-of-payment record. The customer app writes it at
placement; the console displays it as the **Payment receipt** and may flip cash
methods to `paid` on handover. Both sides subscribe to the same node — the
receipt stays in sync everywhere.

```ts
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export interface OrderPaymentEvidence {
  order_id: string;
  method: PaymentMethodId | string;   // from §3.6 (tolerate legacy ids)
  status: PaymentStatus;
  amount: number;                     // == order.total
  currency: "ZAR";
  receipt_number: string;             // "R-" + order.order_number
  reference: string | null;           // gateway transaction id (card only)
  gateway: string | null;             // e.g. "yoco" | "payfast" | "ozow"
  proof_url: string | null;           // EFT: uploaded proof (image or PDF URL)
  card_brand: string | null;          // card only: "visa" | "mastercard" | …
  card_last4: string | null;          // card only: last 4 digits — never full PAN
  paid_at: string | null;             // ISO — null until status === "paid"
  recorded_by: string | null;         // "customer_app" | "driver" | "console"
  updated_at: string;
}
```

Rules (normative):

1. Write the record **in the same transaction as the order placement**.
2. `card` ⇒ `status: "paid"`, real `gateway` + `reference`, `paid_at: now`,
   and `card_brand`/`card_last4` from the gateway response (never the full PAN).
   `cash_on_delivery` / `cash_on_pickup` / `eft` ⇒ `status: "pending"`,
   `paid_at: null`. `eft` additionally sets `proof_url` (image or PDF) — staff
   verify the upload in the console and mark it `paid`.
3. `receipt_number` = `"R-" + order.order_number` — deterministic, so every app
   renders the identical receipt number even before the record exists.
4. `amount` must equal `order.total` (after all promotions). Never the pre-discount total.
5. **Two-way sync on cash handover:** the console may mark the record `paid`
   (cash collected by driver, or customer paid at the counter). Subscribe and
   reflect it immediately in the app's order history — the customer then sees
   "Paid" + the receipt as their proof of payment.
6. The app's order history must include a **Receipt screen** showing: receipt
   number, method, status, amount, `paid_at`, gateway reference (card), and the
   order breakdown — the same numbers the console displays.

---

## 4. Live sync — keep the app current

Subscribe (JavaScript Web SDK v9+ modular):

```ts
import { getDatabase, ref, onValue } from "firebase/database";
const db = getDatabase(app);

onValue(ref(db, "promotions/codes"),            (s) => setCoupons(s.val() ? Object.values(s.val()) : []));
onValue(ref(db, "promotions/combos"),           (s) => setCombos(s.val() ? Object.values(s.val()) : []));
onValue(ref(db, "promotions/global/points_config"), (s) => setPointsConfig(s.val()));
onValue(ref(db, "promotions/restaurant_points"), (s) => setOverrides(s.val() ?? {}));
onValue(ref(db, `menus/${restaurantId}/items`),  (s) => setMenuItems(s.val() ?? {}));
onValue(ref(db, `restaurants/${restaurantId}/payment_config`), (s) => setPaymentConfig(s.val()));
```

Re-run checkout evaluation (§5–§8) whenever **any** of these change, and whenever
the cart changes. If the SDK is unavailable, poll the REST endpoints every 30 s.

---

## 5. Checkout engine — run these steps **in order**

Input: `cart: OrderLine[]`, `restaurantId`, `restaurant`, `customerId`,
`isFirstOrder: boolean`, live data from §4.

All money is ZAR. **Round only once per discount, to cents, half-up:**
`const r2 = (n) => Math.round(n * 100) / 100;`

### Step 1 — Combo deals (always first)

```ts
interface ComboSaving {
  comboId: string;
  name: string;
  kind: ComboKind;
  timesApplied: number;
  discount: number;          // total R saved
}

function evaluateCombos(
  cart: OrderLine[],
  restaurantId: string,
  combos: ComboDeal[],
  itemsById: Map<string, MenuItem>,
): { savings: ComboSaving[]; totalDiscount: number } {
  const now = Date.now();
  const savings: ComboSaving[] = [];

  for (const deal of combos) {
    if (deal.restaurant_id !== restaurantId) continue;
    if (!deal.is_active) continue;
    if (Date.parse(deal.starts_at) > now || Date.parse(deal.expires_at) < now) continue;

    if (comboKind(deal) === "multibuy") {
      const item = itemsById.get(deal.item_ids[0] ?? "");
      const line = cart.find((l) => l.item_id === deal.item_ids[0]);
      if (!item || !line || deal.buy_qty == null || deal.pay_qty == null) continue;
      if (deal.buy_qty < 2 || deal.pay_qty < 1 || deal.pay_qty >= deal.buy_qty) continue; // guard bad data
      const groups = Math.floor(line.quantity / deal.buy_qty);
      if (groups === 0) continue;
      const freeUnits = groups * (deal.buy_qty - deal.pay_qty);
      const discount = r2(freeUnits * sellPrice(item));
      savings.push({ comboId: deal.id, name: deal.name, kind: "multibuy", timesApplied: groups, discount });
    } else {
      // bundle: complete sets = min quantity across required items
      const lines = deal.item_ids.map((id) => cart.find((l) => l.item_id === id));
      if (lines.some((l) => !l)) continue;
      const sets = Math.min(...lines.map((l) => l!.quantity));
      if (sets <= 0) continue;
      const bundleTotalPerSet = deal.item_ids.reduce((sum, id) => {
        const item = itemsById.get(id);
        return sum + (item ? sellPrice(item) : 0);
      }, 0);
      if (bundleTotalPerSet <= 0) continue;
      const gross = bundleTotalPerSet * sets;
      const off = deal.discount_type === "fixed"
        ? Math.min(gross, Number(deal.discount_value) || 0) * sets
        : gross * (Math.min(100, Math.max(0, Number(deal.discount_value) || 0)) / 100);
      const discount = r2(Math.min(gross, off));
      savings.push({ comboId: deal.id, name: deal.name, kind: "bundle", timesApplied: sets, discount });
    }
  }
  const totalDiscount = r2(savings.reduce((s, x) => s + x.discount, 0));
  return { savings, totalDiscount };
}
```

### Step 2 — Coupon (at most ONE per order)

```ts
interface CouponResult {
  ok: boolean;
  reason: string | null;    // human-readable failure for the UI
  discount: number;         // R off items (percent/fixed/bogo) or not used
  freeDelivery: boolean;
}

function validateAndPriceCoupon(
  p: PromoCampaign | null,
  ctx: {
    subtotalAfterCombos: number;   // items subtotal − step-1 discount
    deliveryFee: number;
    cheapestItemUnit: number;      // cheapest cart item unit price (for bogo)
    restaurantId: string;
    isFirstOrder: boolean;
  },
): CouponResult {
  const fail = (reason: string): CouponResult => ({ ok: false, reason, discount: 0, freeDelivery: false });
  if (!p) return fail("No coupon entered");
  if (!p.is_active) return fail("This code is no longer active");
  const now = Date.now();
  if (Date.parse(p.starts_at) > now) return fail("This code is not active yet");
  if (Date.parse(p.expires_at) < now) return fail("This code has expired");
  if (p.usage_limit != null && p.usage_count >= p.usage_limit) return fail("This code has been fully used");
  if (p.scope === "restaurant" && !promoRestaurantIds(p).includes(ctx.restaurantId))
    return fail("This code is not valid at this restaurant");
  if (p.scope === "first_order" && !ctx.isFirstOrder)
    return fail("This code is for first orders only");
  if (ctx.subtotalAfterCombos < p.min_order)
    return fail(`Minimum order of R ${p.min_order} required`);

  let discount = 0;
  let freeDelivery = false;
  switch (p.type) {
    case "percent":
      discount = ctx.subtotalAfterCombos * (p.value / 100);
      break;
    case "fixed":
      discount = p.value;
      break;
    case "free_delivery":
      freeDelivery = true;  // value irrelevant; delivery fee becomes 0
      break;
    case "bogo":
      // buy-one-get-one: cheapest unit on the house
      discount = ctx.cheapestItemUnit;
      break;
  }
  if (!freeDelivery && p.max_discount != null) discount = Math.min(discount, p.max_discount);
  if (!freeDelivery) discount = Math.min(discount, ctx.subtotalAfterCombos);   // never negative
  return { ok: true, reason: null, discount: r2(discount), freeDelivery };
}
```

### Step 3 — Resolve loyalty config for THIS restaurant

```ts
const override = overrides[restaurantId] ?? null;              // from §4
const eff = resolveEffectivePointsConfig(pointsConfig, override);
// eff.enabled === false  → customer neither earns nor redeems at this restaurant
```

### Step 4 — Points redemption at checkout (opt-in by the customer)

```ts
const wantsToRedeem = /* customer toggle at checkout */;
let pointsRedemption = { applied: false, pointsSpent: 0, discount: 0 };

if (eff.enabled && eff.redemption_enabled && wantsToRedeem) {
  const wallet = await getWallet(customerId);                  // §9
  const base = subtotalAfterCombos - coupon.discount;          // after steps 1–2
  if (wallet.balance >= eff.points_required && base > 0) {
    pointsRedemption = {
      applied: true,
      pointsSpent: eff.points_required,
      discount: r2(base * (eff.discount_percent / 100)),
    };
  }
}
```

### Step 5 — Final totals (must match the order fields)

```ts
const itemsSubtotal   = cart.reduce((s, l) => s + l.line_total, 0);
const comboDiscount   = step1.totalDiscount;
const couponDiscount  = step2.discount;
const pointsDiscount  = pointsRedemption.discount;
const discount        = r2(comboDiscount + couponDiscount + pointsDiscount);  // → order.discount
const deliveryFee     = step2.freeDelivery ? 0 : baseDeliveryFee;             // from /delivery_tiers
const serviceFee      = yourExistingServiceFee;
const tax             = yourExistingTax;
const tip             = customerTip;
const total = r2(Math.max(0,
    r2(itemsSubtotal - discount)   // clamp item discounts at line level
  + deliveryFee + serviceFee + tax + tip));
```

> ⚠️ Item-level discounts must never exceed the items subtotal:
> `discount = Math.min(discount, itemsSubtotal)`. Delivery fee and fees are never discounted.

**Order write-back:** set `order.discount = discount`,
`order.coupon_code = coupon code or null`, and (recommended) store a breakdown:

```json
"promo_breakdown": {
  "combos": [{"id": "cmb_x", "name": "3-for-2 Burgers", "timesApplied": 1, "discount": 85}],
  "coupon": {"code": "WELCOME20", "discount": 30},
  "points": {"spent": 500, "discount": 24.50}
}
```

---

## 6. Points EARNING (after delivery, not at checkout)

When an order transitions to `status === "delivered"` (once — guard against double writes):

```ts
const eff = resolveEffectivePointsConfig(pointsConfig, overrides[order.restaurant_id] ?? null);
let earned = 0;
if (eff.enabled) {
  if (eff.method === "per_order" || eff.method === "both") earned += eff.points_per_order;
  if (eff.method === "per_item" || eff.method === "both") {
    for (const line of order.items) {
      const item = itemsById.get(line.item_id);
      // item-level override wins; otherwise restaurant-resolved default
      earned += (item?.points_value ?? eff.points_per_item_default) * line.quantity;
    }
  }
  earned = Math.max(0, Math.round(earned));
  if (earned > 0) creditWallet(order.customer_id, order.restaurant_id, earned, order.id); // §9
}
```

Show an earnings preview on the cart/checkout screen using the same formula
(so customers see "you'll earn ~42 pts").

### 6.1 ⚠️ Common earning mistakes (observed in the field — do NOT ship these)

A customer app awarded **30 pts** on an order where the portal was configured to
award **3 pts**. These are the failure modes that cause it:

| Mistake | Wrong result | Correct behaviour |
|---|---|---|
| Multiplying `points_per_order` by item quantity, line count or order total | `3 × 10 = 30` | `per_order` awards the flat value **once per order**, regardless of basket contents |
| Combining the two layers arithmetically (global + override, or global × override) | inflated | Resolve **field-by-field**: a non-null override field REPLACES the global field. Never add or multiply the layers |
| Ignoring `method` and awarding per-item points anyway | wrong | `method` is authoritative: `none` = 0 · `per_order` = flat only · `per_item` = per-unit only · `both` = flat + per-unit |
| Using global numeric fields when `method: "none"` | phantom points | `method: "none"` earns **zero** even though placeholder numbers (e.g. 10) remain in the JSON |
| Reading `null` in an override as zero instead of "inherit" | broken | `null` = inherit the global value. Earning is suppressed **only** by `enabled: false` or `method: "none"` |
| Crediting at checkout / order placement | double credits | Credit exactly once, when `status` becomes `delivered`, keyed by `/loyalty/earned_orders/{customerId}/{orderId}` |

### 6.2 Worked example — resolve THIS live configuration

```jsonc
// /promotions/global/points_config
{ "enabled": true, "method": "none", "points_per_order": 10,
  "points_per_item_default": 5, "redemption_enabled": true,
  "points_required": 100, "discount_percent": 10 }

// /promotions/restaurant_points/rst_5jqj45emntl
{ "enabled": true, "method": "per_order", "points_per_order": 3 }
```

Resolving with §3.3's `resolveEffectivePointsConfig` for `rst_5jqj45emntl` gives
`method = "per_order"`, `points_per_order = 3` (override replaces global),
`points_per_item_default = 5` (inherited — but **unused**, because the method is
`per_order`). Therefore:

- Delivered order at `rst_5jqj45emntl` ⇒ **exactly 3 pts** — 1 item or 20 items,
  R30 or R3 000 total: still 3.
- Delivered order at any restaurant without an override ⇒ **`method: "none"` ⇒ 0 pts**,
  no ledger entry.
- The same order reprocessed ⇒ **still exactly 3 pts total** (idempotency key).

Your app MUST reproduce these three answers against the live data.

---

## 7. Stacking & precedence rules (normative)

1. **Combos → Coupon → Points**, in that order, never the reverse. Each step
   discounts the remainder of the previous step's total.
2. **One coupon per order.** If the customer enters a second code it replaces the first.
3. Combos always apply **automatically** — no opt-in needed; show them as cart savings.
4. Points redemption is **opt-in** (toggle at checkout) and requires the restaurant's
   resolved `redemption_enabled` plus sufficient balance.
5. Item-level discounts (combos + coupon + points) never exceed the items subtotal;
   delivery/service/tax/tip are never discounted except `free_delivery` coupons.
6. If promo data fails to load, check out with no promotions, but **retry** —
   never cache promo config longer than the session.

---

## 8. Customer-app UI requirements

| Surface | Requirement |
|---|---|
| Menu item | Badge when an item is part of an active combo: “Bundle deal” or “3 for 2”. |
| Cart | Savings rows: combo name(s) + “Coupon WELCOME20” + “Points discount”, each with the R amount in green. |
| Checkout | Coupon text field (apply/clear), points toggle showing cost in pts and saving in R, “you’ll earn ~N pts” line, final breakdown Subtotal → Savings → Delivery → Fees → Tip → Total. |
| Payment step | Only methods enabled at `/payment_config` for the current `order_type` (§3.6); cash methods display their `instructions` note; selected id becomes `order.payment_method`. |
| Rewards wallet screen | Balance, progress toward `points_required`, earning rates for the current restaurant (resolved config), recent ledger entries. |
| Errors | Surface the exact `reason` strings from Step 2 for invalid coupons. |

---

## 9. Loyalty wallet & ledger (customer-app owned paths)

The portal configures *rules*; the customer app owns *balances*. Recommended shape:

```
/loyalty/wallets/{customerId}
  { balance: number, lifetime_earned: number, lifetime_redeemed: number, updated_at: ISO }

/loyalty/ledger/{customerId}/{entryId}
  { id, customer_id, order_id: string|null, delta: number,   // +earn / −spend
    reason: "earn_order" | "redeem_discount" | "adjustment",
    restaurant_id: string|null, balance_after: number, created_at: ISO }
```

- **Always use RTDB transactions** (`runTransaction`) when mutating `balance`
  and coupon `usage_count` to avoid race conditions across devices.
- A redemption (Step 4) writes a `redeem_discount` ledger entry **and** decrements
  the balance in the same transaction *before* placing the order; refund it if the
  order fails to be placed.
- Earning (§6) credits once per delivered order — key the credit by
  `/loyalty/earned_orders/{customerId}/{orderId}` to make it idempotent.

---

## 10. Edge cases to handle

| Case | Rule |
|---|---|
| Combo item becomes unavailable mid-session | Re-evaluate on subscribe; the combo simply stops matching. |
| Restaurant removed from coupon's `restaurant_ids` | Next validation run fails with "not valid at this restaurant". |
| `expires_at` passes while cart is open | Next evaluation drops it; totals recompute. |
| Cart qty drops below combo threshold | Saving row disappears automatically. |
| Negative or zero totals | Clamp: item discounts ≤ items subtotal; `total ≥ 0`. |
| Customer balance drops (other device) | Re-read wallet in a transaction at order placement; if insufficient, skip redemption. |
| First-order detection | `isFirstOrder` = customer has **zero** orders with `status === "delivered"`. |

---

## 11. Acceptance test checklist

Work through these in a staging client before shipping:

1. **Bundle:** menu Burger R85 + Chips R35 + Drink R25, deal = −15% bundle ⇒ cart saving `R21.75`.
2. **Bundle ×2 sets:** same deal, cart has 2 of each ⇒ saving `R43.50`.
3. **Multi-buy:** Burger R85, deal 3 for 2 ⇒ qty 3 pays `R170` (save `R85`); qty 6 ⇒ two groups, pays `R340` (save `R170`); qty 5 ⇒ one complete group + 2 loose units, pays for 4 units = `R340` (save `R85`). Implement exactly this (`floor(qty / buy_qty)` complete groups).
4. **Coupon percent:** 10% off, subtotal R300, cap R20 ⇒ discount `R20` (cap wins).
5. **Coupon restaurant scoping:** code checked on restaurants A,B only ⇒ at C fails with the documented reason.
6. **first_order:** second order with a first-order code must fail.
7. **free_delivery:** delivery fee R35 ⇒ becomes `R0`, other totals unchanged.
8. **Points redemption:** config 500 pts → 10%, base R200 ⇒ toggle on ⇒ `R20` off and wallet −500; insufficient balance ⇒ toggle hidden/disabled.
9. **Per-restaurant override:** global 10 pts/order, restaurant override 25 pts/order ⇒ delivered order at that restaurant earns +25 + per-item points using its override defaults.
10. **Opt-out:** restaurant override `enabled: false` ⇒ no earning, no redemption at that restaurant, global wallet untouched.
11. **Live update:** change `points_per_order` in the portal ⇒ cart earnings preview updates within ~1 s, no app restart.
12. **Idempotency:** delivering the same order twice credits points exactly once.
13. **Payment methods:** restaurant config has `card` + `cash_on_pickup` enabled ⇒
    checkout offers exactly those two for **pickup** orders, **card only** for
    delivery orders; a restaurant missing `/payment_config` offers **card only**;
    toggling a method off in the portal removes it from checkout within ~1 s.
14. **Proof of payment:** a card order writes `/orders/{id}/payment` at placement
    with `status: "paid"`, gateway + reference and
    `receipt_number: "R-<order_number>"`; a cash-on-pickup order starts
    `"pending"` → staff mark it **Paid** in the console ⇒ the app receipt flips to
    Paid within ~1 s, showing the identical receipt number and amount
    (= `order.total`).
15. **EFT + proof upload:** portal enables `eft` ⇒ checkout shows Bank transfer
    with bank details + a required upload field accepting image or PDF (≤5 MB);
    placing the order is blocked until a file is attached; evidence is written
    `status: "pending"` with `proof_url` set; the console receipt shows the
    upload via "View document"; staff mark Paid ⇒ the app flips within ~1 s.
16. **Card form:** selecting `card` shows the four required fields with live
    validation (Luhn, MM/YY future, CVV length, brand logo); invalid input
    blocks placement; on success evidence holds `gateway`, `reference`,
    `card_brand`, `card_last4` — and the full PAN/CVV appear NOWHERE in the
    database or logs.

---

## 12. Quick reference — portal paths you can watch while testing

- Coupons: `/promotions/codes` — create/edit in **Promotions & Loyalty → Coupon promos**.
- Combos: `/promotions/combos` — **Combo deals** tab (per restaurant).
- Global loyalty: `/promotions/global/points_config` — **Global rewards** tab.
- Per-restaurant loyalty: `/promotions/restaurant_points/{rid}` — **Per-restaurant rewards** tab or the restaurant profile → **Points & Rewards**.

Everything else in the customer app (menus, orders, delivery fees) already flows
through the existing Firebase integration — this document only adds the
promotion layer on top.
