# Prompt — Update the Customer App (promotions, loyalty & pickup orders)

**How to use this file**

1. Open the AI/agent tool you use for your **customer-facing app** (Cursor, Copilot,
   ChatGPT, Claude, Lovable, etc.).
2. Give it the integration guide first — attach or paste the contents of
   `docs/CUSTOMER_APP_PROMOTIONS_INTEGRATION.md` (from the ForkFleet Console repo).
3. Then paste **everything below the line** as your instruction prompt.

The prompt assumes the AI has the integration guide in context. It must treat that
guide as the single source of truth.

---

## PROMPT — copy everything below this line

### Role & context

This repository is the **customer-facing food-ordering app** for a
multi-restaurant delivery platform. A separate operator portal — **ForkFleet
Console** — manages restaurants, menus, orders and all promotions. Both apps
share one **Firebase Realtime Database** (project `e-comm-bd997`,
URL `https://e-comm-bd997-default-rtdb.firebaseio.com`). The portal owns all
promo configuration; this app only reads it and evaluates it live.

The portal was just extended with four things you must now implement in this app:

1. **Coupon promotions**, now scoped per coupon as *all restaurants* /
   *specific restaurants (multi-select)* / *first order only*.
2. **Combo deals** — per restaurant, two kinds: *bundle discounts* (add every
   listed item → % or fixed R off) and *multi-buy* (e.g. 3-for-2: order N, pay for M).
3. **Points & Rewards loyalty programme** — global rules plus **per-restaurant
   overrides**, with earn-on-delivery, redeem-at-checkout, and a customer wallet.
4. **`order_type: "delivery" | "pickup"`** on every order — pickup orders take
   no address, no delivery fee, no driver, and follow a different status
   lifecycle (…→ ready → **picked_up = customer collected** → delivered = closed).

The attached document **`CUSTOMER_APP_PROMOTIONS_INTEGRATION.md` is the single
source of truth**. Every RTDB path, TypeScript type, formula, rounding rule,
stacking rule, error string and acceptance test in it is **normative**. Copy its
code literally where reference code is given; adapt only naming/style to this
codebase. If the document and existing code conflict, the document wins — flag
the conflict to me.

### Phase 0 — Orient first (no code changes yet)

1. Read the integration guide fully (§1–§12).
2. Map this codebase and report back: where restaurant menus/items are fetched,
   cart state management, checkout totals computation, order creation (the
   write to `/orders`), customer identity (`customerId`) derivation, order
   history (needed for first-order detection and the wallet), and the order
   tracking/status UI.
3. Report which Firebase client setup exists. If the app already initializes
   Firebase for this project, reuse that instance for the RTDB subscriptions.
4. Present a plan: files you'll modify, new modules you'll add, plus any
   questions. **Stop and ask me before guessing on anything ambiguous.**

### Phase 1 — Promotion data layer

5. Copy the TypeScript contracts from §3.1–§3.7 **verbatim** into a new
   promotions module — including `promoRestaurantIds`, `comboKind`,
   `resolveEffectivePointsConfig` and `sellPrice` exactly as written.
6. Add live subscriptions per §4 (`promotions/codes`, `promotions/combos`,
   `promotions/global/points_config`, `promotions/restaurant_points`,
   `menus/{restaurantId}/items`) using `onValue`, held in the app's existing
   state layer. Re-run cart/checkout evaluation whenever any of them **or the
   cart** changes. Where the realtime SDK is unavailable, poll the REST
   fallback every 30 s.

### Phase 2 — Checkout engine

7. Implement the checkout pipeline **exactly in the documented order** (§5):
   Step 1 combos → Step 2 coupon (max one per order) → Step 3 resolve the
   loyalty config for the current restaurant → Step 4 points redemption
   (customer opt-in toggle) → Step 5 final totals. Use the reference code as
   the implementation. Round once per discount (`r2`), clamp item discounts at
   the items subtotal, and never discount delivery/service/tax/tip except via a
   `free_delivery` coupon.
8. Enforce all stacking & precedence rules in §7.

### Phase 3 — Order placement & pickup flow

9. On successful order placement: set `order.discount`, `order.coupon_code`,
   the `promo_breakdown` object (§5), and increment the coupon's `usage_count`
   **inside an RTDB transaction**.
10. Add the delivery-vs-pickup flow per §3.5: checkout offers **Delivery** or
    **Customer pickup**. Pickup sends `order_type: "pickup"`,
    `delivery_address: null`, `delivery_fee: 0` and **never** any driver
    fields. Delivery behaviour stays as today (fee from
    `/restaurants/{rid}/delivery_tiers`), with `order_type: "delivery"`.
11. Update order tracking UI for pickup orders: driver ETA / "driver assigned"
    UI must never appear; status copy follows §3.5, ending at a terminal
    **"Collected — enjoy!"** state at `picked_up`/`delivered`.

### Phase 4 — Loyalty wallet, ledger & earning

12. Implement `/loyalty/wallets` and `/loyalty/ledger` per §9 using
    `runTransaction` for every balance mutation. Make earning idempotent via
    `/loyalty/earned_orders/{customerId}/{orderId}`; credit points exactly once
    when an order reaches `status === "delivered"` (§6). Refund a redemption
    if order placement fails after the debit.
13. Build the **Rewards wallet screen** and the checkout **points toggle** plus
    the *"you'll earn ~N pts"* preview (same formula as §6), per §8.

### Phase 5 — UI polish & verification

14. Implement every UI requirement in §8: combo badges on menu items ("Bundle
    deal" / "3 for 2"), cart savings rows per combo + coupon + points with
    amounts in green, coupon apply/clear field, wallet progress toward
    `points_required`, full totals breakdown, and surface coupon failure
    **reason strings verbatim** from Step 2.
15. Write tests mirroring the **12 acceptance tests in §11 with the exact
    numbers given there**, then run the app's typecheck, linter and full
    production build — all must pass.

### Hard rules

- **Never hard-code** a promotion, combo, points value, or restaurant list —
  everything comes from RTDB.
- **Never write** to `/promotions/**`, `/menus/**` or `/restaurants/**`
  (portal-owned). This app writes only: `/orders/**`, coupon `usage_count`
  increments, and `/loyalty/**`.
- All money is **ZAR**, rounded only as specified; totals must match §5 exactly.
- Keep diffs minimal — follow the existing code style, no unrelated refactors.
- If promo data fails to load, check out with no promotions and retry — never
  cache promo config beyond the session (§7 rule 6).

### How to work

Work phase by phase. After each phase, give me a short summary of changed
files + how you verified, then continue. Don't batch everything into one giant
unreviewable change.

### Definition of done

- All 12 acceptance tests from §11 pass, with results listed test-by-test.
- Typecheck, lint and build are clean.
- A final walkthrough: cart with a bundle + a multi-buy + a scoped coupon +
  points redemption, showing every number reproduces the handbook formulas.
