# Prompt — Fix the customer app's loyalty points (30 pts → 3 pts)

**How to use this file**

1. Attach the integration guide `docs/CUSTOMER_APP_PROMOTIONS_INTEGRATION.md`
   (it now includes **§6.1 common mistakes** and **§6.2 worked example**).
2. Paste **everything below the line** into the customer app's AI tool.

---

## PROMPT — copy everything below this line

### Bug report — points are calculated wrong

After an order was completed at the restaurant `rst_5jqj45emntl`
("Restaurant test 1"), the app credited the customer's wallet with **30 points**.
The configured, correct amount is **3 points**.

Evidence in Firebase RTDB (`e-comm-bd997`):

```jsonc
// /loyalty/wallets/demo-amara  — WRONG, written by this app
{ "balance": 30, "lifetime_earned": 30, "lifetime_redeemed": 0,
  "updated_at": "2026-08-09T06:27:46.904Z" }

// /promotions/global/points_config — set by the operator in the admin portal
{ "enabled": true, "method": "none", "points_per_order": 10,
  "points_per_item_default": 5, "redemption_enabled": true,
  "points_required": 100, "discount_percent": 10 }

// /promotions/restaurant_points/rst_5jqj45emntl — per-restaurant override
{ "enabled": true, "method": "per_order", "points_per_order": 3 }
```

The operator's intent: **no global rewards** (`method: "none"`), and at
Restaurant test 1 exactly **3 points per delivered order** (flat, per order).
Global rewards, per-restaurant rewards, coupons and combo deals are configured
in the admin portal; this app must only READ and apply them.

### Your task

**Locate and fix the loyalty earning code** so it resolves and awards points
exactly per the integration guide. Specifically:

1. **Resolution (§3.3 of the guide) is the only allowed way to combine global
   config with a per-restaurant override.** Copy `resolveEffectivePointsConfig`
   from the guide verbatim if your implementation differs in any way. A
   non-`null` override field REPLACES the global field; `null` = inherit.
   **Never add, concatenate, or multiply the two layers' values together.**
2. **`method` is authoritative** (§6 of the guide):
   - `"none"` → award 0 (placeholder numbers in the JSON are ignored)
   - `"per_order"` → award `points_per_order` **once**, never multiplied by
     item quantity, line count, or order total
   - `"per_item"` → per-unit points only (`item.points_value ?? points_per_item_default`)
   - `"both"` → flat + per-unit
3. **When to credit:** only when an order's `status` **transitions to
   `delivered`**, exactly once per order, guarded by
   `/loyalty/earned_orders/{customerId}/{orderId}` before writing (§6/§9).
   Do not credit at checkout, at payment, or at placement.
4. **Use `resolveEffectivePointsConfig` at BOTH places:** the earn-on-delivered
   job AND the "you'll earn ~N pts" checkout preview, so the preview shows the
   same number that will actually be credited (3, per the config above).
5. **Parse numbers as numbers** (`Number(...)`, `Math.round(...)`, clamp ≥ 0)
   so a `3` can never become `30`.

### Repair the bad credit

The wallet `demo-amara` currently holds a wrong credit of 30 (should be 3).
Write a one-time repair: inside a single `runTransaction`, append a ledger
entry at `/loyalty/ledger/demo-amara/{entryId}` with
`delta: -27`, `reason: "adjustment"`, `balance_after: 3`, `created_at: <now>`
and update the wallet to `balance: 3`, `lifetime_earned: 3`. Make the repair
**idempotent** — skip it if an `adjustment` entry for this correction already
exists. Do NOT silently delete history; the adjustment ledger line is the
audit trail.

### Acceptance tests — these must all pass against the LIVE database

| # | Scenario | Expected |
|---|---|---|
| 1 | Order (any size, any total) at `rst_5jqj45emntl` reaches `delivered` | **+3 pts** exactly, one `earn_order` ledger entry |
| 2 | Order at any restaurant **without** an override reaches `delivered` | **+0 pts**, no ledger entry (global `method: "none"`) |
| 3 | Test-1 scenario runs twice (retries, app restart, double event) | still exactly **3 pts total** |
| 4 | Checkout preview for that restaurant | shows *"you'll earn ~3 pts"* — matching test 1 |
| 5 | `demo-amara` after repair | balance & `lifetime_earned` = **3**, ledger shows the −27 `adjustment` |
| 6 | Regression — coupons & combos unchanged: `WELCOME20`, `TEST15`, the 10% "Test Duo" bundle and the 3-for-2 deal still price exactly per guide §5/§11 | unchanged totals |

Add automated tests reproducing tests 1–4 with the JSON config above as the
fixture (e.g. `expect(earnedPoints(globalCfg, override, deliveredOrder)).toBe(3)`),
so this regression cannot come back.

### Rules

- Never hardcode the snapshot values above in app logic — resolve live from
  `/promotions/global/points_config` and `/promotions/restaurant_points/{rid}`
  on every evaluation (subscribe per guide §4). The snapshot is the **test
  fixture** only.
- Do not touch anything under `/promotions/**` or `/menus/**` — read-only.
  The only writes allowed: `/orders/**`, coupon `usage_count`, `/loyalty/**`.
- If you find points logic that disagrees with guide §6.1's mistake table,
  replace it rather than patching around it.

When done, show me: (a) the diff of the earning/resolution code, (b) the
ledger + wallet state for `demo-amara` after the repair, and (c) the output of
all six acceptance tests.
