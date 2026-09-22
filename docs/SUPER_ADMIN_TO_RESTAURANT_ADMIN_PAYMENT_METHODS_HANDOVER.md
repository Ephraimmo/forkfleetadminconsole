# Handover: Super Admin Payment Methods UX → Restaurant Admin Console

> **Audience:** AI / developer updating **Restaurant Admin ("Orderly Hub")** so its payment-methods
> editing experience matches the Super Admin console.
> **Direction:** the reverse of `RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_HANDOVER.md` — that
> document made Orderly Hub the source of truth for the **schema** (`payment_config.methods.*`,
> including `card.stripePublishableKey`/`stripeSecretKey`) and Super Admin's Stripe-key handling was
> brought up to match it. That schema is unchanged and still governs both apps — nothing here
> supersedes it. This document is narrower: now that Super Admin's per-restaurant payment editor is
> built on top of that schema, its **editing UX** has ended up more capable than Orderly Hub's flat
> Settings-page toggles in a few concrete ways, and this doc is the reference for bringing Orderly
> Hub's UI up to the same standard.
> **Source of truth:** Super Admin (`fleet-admin-hub-main`, this repo),
> `src/lib/payments.firebase.ts`, `src/components/restaurants/payment-methods-editor.tsx` — snapshot
> as of **2026-09-20**, the same day the Stripe-key fields described in the Payments doc went live
> here.
> **Scope:** UI/UX parity only. No field, no schema, and no verification-gate behavior changes —
> everything in `RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_HANDOVER.md` stays exactly as written.

---

## 0. This is a UX doc, not a schema migration — read this before anything else

The `payment_config.methods` shape (`card` with `enabled`/`instructions`/`stripePublishableKey`/
`stripeSecretKey`, `cash_on_delivery.enabled`, `cash_on_pickup.enabled`, `eft.enabled`) documented in
`RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_HANDOVER.md` §2.1 is **unchanged**. Super Admin's
implementation of it is now live in this repo (`src/lib/payments.firebase.ts`) and matches that
schema field-for-field, including the deliberately-inconsistent camelCase on the two Stripe key
fields. Do not use this document to justify adding new fields, renaming anything, or touching the
payment-verification gate (`paymentRequiresVerification`/`isPaymentVerified`/
`reviewOrderPayment()`) described in that doc's §3 — none of that is in scope here. This document
only concerns **how the four methods are presented and edited**, on top of that unchanged schema.

---

## 1. What's different, concretely

### 1.1 Cash on delivery and Cash on pickup are independent toggles here — not one coupled switch

The Payments handover doc's §2.4 flagged Orderly Hub's behavior as a landmine to decide on
deliberately: *"One 'Cash on Delivery' switch... sets `cash_on_delivery.enabled` **and**
`cash_on_pickup.enabled` to the same value simultaneously. There is no independent control per
fulfillment type today, despite the schema supporting it."*

Super Admin's answer, already built and live: **split them.** `PAYMENT_METHOD_CATALOG`
(`src/lib/payments.firebase.ts`) lists `cash_on_delivery` and `cash_on_pickup` as two fully separate
catalogue entries, each rendered as its own card with its own `Switch`
(`src/components/restaurants/payment-methods-editor.tsx`) — a restaurant can offer cash on delivery
without offering cash on pickup, or vice versa, with no coupling in either the UI or the write path.

Recommendation for Orderly Hub: adopt the split. It's a strict UX improvement on the same schema —
no data migration needed, since `cash_on_pickup.enabled` already exists in the schema and is simply
never exposed independently today.

### 1.2 Each method declares which order type(s) it applies to, and the UI shows it

```ts
// src/lib/payments.firebase.ts
export const PAYMENT_METHOD_CATALOG: {
  id: PaymentMethodId;
  label: string;
  customer_hint: string;
  description: string;
  applies_to: OrderType[];   // "delivery" | "pickup"
}[] = [
  { id: "card", applies_to: ["delivery", "pickup"], /* ... */ },
  { id: "cash_on_delivery", applies_to: ["delivery"], /* ... */ },
  { id: "cash_on_pickup", applies_to: ["pickup"], /* ... */ },
  { id: "eft", applies_to: ["delivery", "pickup"], /* ... */ },
];
```

Each method card shows a badge — "Delivery & pickup", "Delivery orders only", or "Pickup orders
only" — driven by this static catalogue, not a per-restaurant setting. Orderly Hub's flat toggle
list has no equivalent: today an operator has no in-UI indication that "Cash on pickup" literally
cannot apply to a delivery order, for instance. Adopting this requires no new data — `applies_to` is
a static property of the method, not something stored per restaurant — just a small constants table
and a badge in the UI.

### 1.3 A live "what customers see" preview panel

Alongside the editable list, Super Admin renders a second card, **"What customers see"**, that
recomputes — from the current *draft* state, before saving — which methods are actually offered for
delivery orders and for pickup orders, using the same `applies_to` + `enabled` intersection the
customer app itself uses (see `availablePaymentMethods()` in the same file). If a restaurant would
end up with zero payment methods for one of the two order types, that's visible immediately, in the
same screen, before the operator clicks Save — rather than discovering it later as a customer-facing
bug. Orderly Hub has no equivalent preview; its only safeguard today is a single blanket check on
save ("Enable at least one payment method").

### 1.4 Per-method "Enabled" badge, enabled-count summary, and explicit Save/Discard with dirty tracking

- Each card gets a green "Enabled" badge when active, so the on/off state is visible at a glance
  even when scrolling past the switch itself.
- A footer line reads "N of 4 methods enabled".
- Edits are held in local draft state (`dirty` flag) with explicit **Save payment options** /
  **Discard changes** actions, rather than saving inline on every toggle. This matters more for
  Orderly Hub's page than it might seem: Orderly Hub's Settings page already uses one shared
  "Save All Settings" button for business profile + Cloudinary + payment methods together (see the
  Payments doc §2.2) — so this specific dirty/save/discard *pattern* doesn't need to be copied
  wholesale, since Orderly Hub's save semantics are already page-wide, not section-scoped. What's
  worth copying is narrower: the **enabled-count summary** and the **"Enabled" badge**, which are
  purely presentational and don't depend on how saving is wired.

### 1.5 Card's Stripe fields — already at parity, nothing to change here

Super Admin's Card method box, when enabled, now shows Stripe Publishable Key and Stripe Secret Key
inputs directly beneath the toggle (secret masked by default, with an eye/eye-off reveal button),
plus the caption *"Keys are saved to Firebase and used by the customer app for Stripe checkout."* —
matching `RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_HANDOVER.md` §2.2/§2.3 exactly, including reusing
the same `stripePublishableKey`/`stripeSecretKey` field names. This is listed here only for
completeness — **no action needed on Orderly Hub's side**, since Orderly Hub was the source of truth
for this part and Super Admin simply caught up to it.

---

## 2. Exact current Super Admin shape (reference)

```ts
// src/lib/payments.firebase.ts
export type PaymentMethodId = "card" | "cash_on_delivery" | "cash_on_pickup" | "eft";
export type OrderType = "delivery" | "pickup";

export interface PaymentMethodSetting {
  enabled: boolean;
  instructions: string | null;         // optional customer-facing note (all methods except Card)
  stripePublishableKey?: string;       // Card only
  stripeSecretKey?: string;            // Card only
}
```

UI structure per method card (`payment-methods-editor.tsx`):
1. Icon (per-method, `lucide-react`) in a tinted box.
2. Label + `applies_to` badge + conditional "Enabled" badge.
3. Description line.
4. Method-specific body:
   - **Card:** Stripe Publishable Key / Stripe Secret Key inputs (only when enabled and the viewer
     can manage payments) — see §1.5.
   - **Everything else:** an optional free-text "customer note" input (e.g. "Please have exact
     change ready"), shown read-only as an italic quote to viewers who can't edit.
5. `Switch` toggling `enabled`.

Sidebar: the "What customers see" preview (§1.3) plus the raw customer-app read path
(`/restaurants/{restaurantId}/payment_config`) shown for operator reference.

---

## 3. What to change in Orderly Hub

Concretely, in `src/pages/Settings.tsx`'s "Payment Methods" card:

1. **Split the single "Cash on Delivery" switch into two** — "Cash on delivery" and "Cash on
   pickup" — each writing only its own `cash_on_delivery.enabled` / `cash_on_pickup.enabled`,
   independently. No schema change; `cash_on_pickup.enabled` already exists and is already written
   on every save (per the Payments doc §1.2), it's just currently always set equal to
   `cash_on_delivery.enabled`.
2. **Add a static `applies_to` badge per method** (Card/EFT: delivery & pickup; Cash on delivery:
   delivery only; Cash on pickup: pickup only) — this is a constant, not new per-restaurant state.
3. **Optional but recommended:** add a small live preview of what's offered per order type, computed
   client-side from current form state the same way Super Admin's `availablePaymentMethods()` does —
   this can be a single derived list rendered inline, it doesn't need Super Admin's two-column
   layout if that doesn't fit Orderly Hub's page.
4. **Optional:** an "N of 4 enabled" summary line and an "Enabled" badge per method — purely
   cosmetic, cheap to add, no data model impact.
5. **Do not change** how/when the page saves — Orderly Hub's single "Save All Settings" button
   covers this section along with business profile and Cloudinary; keep that.

---

## 4. Landmines / non-goals

- **Do not touch the schema.** `RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_HANDOVER.md` remains
  authoritative for field names and shape. This doc adds no new fields.
- **Do not touch the payment-verification gate** (§3 of the Payments doc — `payment_status`,
  `reviewOrderPayment()`, Accept-button gating). Entirely separate concern, entirely unaffected by
  this UX work.
- **Don't invent a new mechanism for order-type restriction.** `cash_on_delivery` /
  `cash_on_pickup` already *are* the mechanism — their names encode the restriction. `card`/`eft`
  apply to both by convention; keep that convention rather than adding a configurable per-restaurant
  `applies_to` override unless product explicitly asks for one (Super Admin's `applies_to` is a
  static catalogue property, not a per-restaurant setting — don't accidentally promote it to one).
- **Don't force Super Admin's dirty/Save/Discard pattern onto Orderly Hub's page** if it doesn't fit
  the page-wide save model already there (§1.4) — take the presentational pieces (badges, counts,
  preview), leave the save-mechanics pieces.
- **Don't re-litigate the Stripe key UI** — that direction already ran, already shipped, already
  matches (§1.5). Nothing to do there.

---

## 5. Acceptance checklist

- [ ] Cash on delivery and Cash on pickup are two independent switches in Orderly Hub's Settings
      page, each writing only its own `enabled` flag (§1.1, §3.1).
- [ ] Each of the four methods shows which order type(s) it applies to (§1.2, §3.2).
- [ ] (Recommended) A live preview of what's offered per order type exists somewhere on the page,
      computed from current form state before save (§1.3, §3.3).
- [ ] (Recommended) An enabled-count summary and per-method "Enabled" indicator exist (§1.4, §3.4).
- [ ] No change to `payment_config`'s field names/shape, and no change to the payment-verification
      gate — confirmed by diffing against `RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_HANDOVER.md`
      §2.1 and §3.
- [ ] Orderly Hub's existing single "Save All Settings" button/flow is unchanged (§3.5, §4).

---

## 6. AI implementation prompt (copy-paste)

```
You are updating Restaurant Admin ("Orderly Hub") so its Payment Methods section in Settings.tsx
matches the editing UX the Super Admin console now has for the same, unchanged payment_config schema
(reference: docs/SUPER_ADMIN_TO_RESTAURANT_ADMIN_PAYMENT_METHODS_HANDOVER.md in this repo, and the
schema doc it points back to, RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_HANDOVER.md — do not deviate
from that schema). This is a UI/UX-only change. No field names change. No new fields are added. The
payment-verification gate (payment_status, reviewOrderPayment, Accept-button gating) is untouched.

## Goal
Bring the Payment Methods editing UX up to what Super Admin already has on top of the same schema:
independent Cash on delivery / Cash on pickup toggles, and order-type awareness in the UI.

## Required behaviour

### 1. Split the coupled cash toggle
Replace the single "Cash on Delivery" switch with two independent switches — "Cash on delivery" and
"Cash on pickup" — writing only cash_on_delivery.enabled and cash_on_pickup.enabled respectively.
Both fields already exist and are already written on every save; today they're just always set to
the same value. No other part of the save payload changes.

### 2. Order-type badges
Add a small static badge per method showing which order type(s) it applies to: Card and EFT apply to
both delivery and pickup; Cash on delivery applies to delivery only; Cash on pickup applies to pickup
only. This is a hardcoded per-method constant, not a new per-restaurant field.

### 3. (Recommended) Live "what's offered" preview
Add a small section that computes, from current in-form draft state (before save), which methods are
offered for delivery orders and which for pickup orders — same logic as Super Admin's
availablePaymentMethods(): enabled methods whose applies_to includes that order type. Surface clearly
if an order type would end up with zero methods.

### 4. (Recommended) Enabled-count summary + per-method "Enabled" badge
Cosmetic additions: an "N of 4 methods enabled" line, and a small "Enabled" badge on each active
method card. No data model impact.

### 5. Do NOT
- Change any field name or add any new field to payment_config.
- Touch payment_status, reviewOrderPayment(), or any Accept-button gating logic.
- Change how/when the page saves — keep the existing single "Save All Settings" flow covering this
  section along with business profile and Cloudinary settings.
- Touch the Stripe key fields/UI — those already match Super Admin and are out of scope here.

## Reference files (Super Admin repo, fleet-admin-hub-main — read for the UX pattern only)
- src/lib/payments.firebase.ts (PAYMENT_METHOD_CATALOG, applies_to, availablePaymentMethods)
- src/components/restaurants/payment-methods-editor.tsx (badges, preview panel, enabled-count, Card's
  Stripe fields — this last part is reference only, already matched on your side)

## Reference files (this repo, Orderly Hub — what you're actually editing)
- src/pages/Settings.tsx — Payment Methods section (see RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_
  HANDOVER.md §2.2 for its current shape and the coupled-cash-toggle landmine at §2.4)
```

---

## 7. Source map (Super Admin repo, `fleet-admin-hub-main` — reference implementation)

| File | Role |
|---|---|
| `src/lib/payments.firebase.ts` | `PAYMENT_METHOD_CATALOG` (labels, descriptions, `applies_to`), `availablePaymentMethods()`, `defaultPaymentConfig`, `resolvePaymentConfig`, `savePaymentConfig` |
| `src/components/restaurants/payment-methods-editor.tsx` | The editor UI: per-method cards, badges, Stripe key fields, "What customers see" preview, dirty/Save/Discard |
| `src/routes/_authenticated/restaurants/$id.tsx` | Mounts the editor on the restaurant detail page's Payments tab, passes `canManage` |
| `RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_HANDOVER.md` | The unchanged schema this document builds its UX recommendations on top of |

---

*Prepared as a handover reference — update alongside any future change to payment method editing UX
on either side.*
