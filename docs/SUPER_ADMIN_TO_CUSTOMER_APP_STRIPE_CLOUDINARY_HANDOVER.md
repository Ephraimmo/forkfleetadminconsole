# Handover: Per-Restaurant Stripe Checkout & Cloudinary Proof-of-Payment → Customer App

> **Audience:** AI / developer updating the **customer-facing ordering app**
> (`customerapp-main`, package name `tanstack_start_ts`, branded "Flavor Finder" / "Hearth" in-app).
> **Direction:** Super Admin console (`fleet-admin-hub-main`, this repo) is the **source of truth**
> for both the Stripe-key schema and the Cloudinary-account schema. This document tells the
> customer app how to consume them.
> **Source of truth:** this repo, `src/lib/payments.firebase.ts`, `src/lib/restaurants.firebase.ts`,
> `src/lib/firestore.ts` — snapshot as of **2026-09-23**.
> **Scope:** two related changes to checkout, both keyed to the specific restaurant the order is
> placed with, not a single global config:
> 1. **Card payments** must use *that restaurant's own* Stripe keys.
> 2. **EFT proof-of-payment uploads** must land in *that restaurant's own* Cloudinary account.

Related docs already in the customer app's backlog: `docs/CUSTOMER_APP_PAYMENT_METHODS_PROMPT.md`
and `docs/CUSTOMER_APP_PROMOTIONS_INTEGRATION.md` §3.6/§3.8 (both in the Super Admin repo) describe
the payment-method schema and `OrderPaymentEvidence` contract this document builds on. **This
document supersedes exactly two things in those two docs and nothing else:**
- Card payment is **Stripe specifically**, keyed per restaurant — not a generically-described
  "your gateway."
- EFT proof-of-payment uploads go to **Cloudinary, per restaurant** — not "your storage, e.g.
  Firebase Storage."

Everything else in those docs (the `PaymentMethodId` set, applicability rules, `OrderPaymentEvidence`
shape, receipt UX, acceptance criteria) is unchanged and still governs.

---

## 0. Read this before anything else — three apps, two databases, and a live bug

**0.1 — Orderly Hub and Super Admin are on genuinely different databases.** Both apps share the
same Firebase *project* (`e-comm-bd997`), but:

- **Super Admin** (`fleet-admin-hub-main`, this repo) — confirmed **Cloud Firestore**
  (`src/lib/firestore.ts`: real `getFirestore`/`onSnapshot`/`setDoc` calls, no `databaseURL` in its
  Firebase config).
- **Customer app** (`customerapp-main`) — confirmed **Cloud Firestore** (`src/lib/firebase.ts`:
  `firebase/firestore` imports only, zero `firebase/database`, no `databaseURL`).
- **Restaurant Admin / "Orderly Hub"** (`orderlyhub-main`) — confirmed **Realtime Database**
  (`src/lib/firebase.ts`: `getDatabase(app)` with a real
  `databaseURL: "https://e-comm-bd997-default-rtdb.firebaseio.com"`).

Firestore and Realtime Database are two separate database products — even under the same Firebase
project, they do not sync with each other automatically, and nothing in any of the three repos
bridges them. **A Stripe key or Cloudinary account entered into Orderly Hub's Settings page today
lands in RTDB and will never reach the customer app.** The customer app can only read Firestore. So
regardless of which app a restaurant operator is *told* to use for this configuration, the only copy
that is technically reachable from here is **Super Admin's Firestore `restaurants/{id}` document**.
This document is written against that copy. If your team intends Orderly Hub to be the actual editing
surface operators use, that requires a sync bridge between RTDB and Firestore that does not exist
today — flag that to whoever owns the platform roadmap; do not attempt to build one as part of this
task.

**0.2 — The customer app's own path resolver already misroutes `payment_config` — fix this first.**
`src/lib/firebase.ts`'s `resolveTarget()` (around lines 169–174) special-cases
`restaurants/{rid}/payment_config` to a **separate top-level collection**, `restaurant_payment_config/{rid}`:

```ts
case "restaurants": {
  // restaurants/{rid}/payment_config → dedicated config collection
  if (segs.length === 3 && b && c === "payment_config")
    return { kind: "doc", path: `restaurant_payment_config/${b}` };
  break;
}
```

This is wrong on two counts: it disagrees with this same app's own migration spec
(`CUSTOMER_APP_FIRESTORE_MIGRATION_PROMPT.md` §2's mapping table, which states
`restaurants/{rid}/payment_config` → *field* `payment_config` on `restaurants/{rid}`), and it
disagrees with what Super Admin actually does. Super Admin's `resolvePath()`
(`src/lib/firestore.ts`) declares `restaurants` as a one-segment collection prefix, so
`restaurants/{id}/payment_config` resolves to the **nested field** `payment_config` on the Firestore
document `restaurants/{id}` — not a separate collection. Nothing in Super Admin ever writes to a
`restaurant_payment_config` collection; it does not exist there.

**Net effect today: the customer app's `useRestaurantPaymentConfig` hook is reading from a document
that Super Admin never writes to.** Toggling a payment method, editing its note, or (after this
handover) setting Stripe keys or Cloudinary credentials in Super Admin currently has **zero effect**
on what the customer app sees, because the two apps are pointed at different Firestore locations.
Fix `resolveTarget()` to route `restaurants/{rid}/payment_config` to the nested field on
`restaurants/{rid}` — either remove the special case entirely (letting it fall through to the
default `restaurants` collection handling) or repoint it explicitly — before doing anything else in
this document. The `useRestaurantPaymentConfig` comment ("at `/restaurants/{restaurantId}/payment_config`")
is actually the *correct* description of where it should read from; only the code disagrees with its
own comment.

**0.3 — Nested folder.** The real project root is `customerapp-main/customerapp-main/` (the zip
extracted with a duplicate inner folder) — `src/` lives under that path.

---

## 1. Card payments — exact current state (fully simulated, no Stripe integration exists)

There is no Stripe SDK, no `VITE_STRIPE_*` env var, and no backend call of any kind for card
payments today. `src/routes/checkout.tsx`'s `submit()` (lines ~255–268) fabricates everything:

```ts
const isCard = paymentId === "card";
const orderId = await placeOrder({
  ...
  paymentGateway: isCard ? "demo-gateway" : null,
  paymentReference: isCard
    ? `SIM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
    : null,
  cardBrand: isCard ? "Visa" : null,
  cardLast4: isCard ? "4242" : null,
});
```

The UI literally displays "Visa •••• 4242 (Instant secure payment)" regardless of what the customer
typed. `payment_status` is set to `"paid"` immediately, with no real confirmation step. This is not
"swap a global Stripe key for a per-restaurant one" — it is building real Stripe checkout from
scratch. Section 3 below is the replacement.

---

## 2. Exact shape to add (copy verbatim from Super Admin)

```ts
// Firestore: restaurants/{restaurantId}, nested field `payment_config`
// (see §0.2 for why this must be a field on the restaurant doc, not a separate collection)
interface RestaurantPaymentMethodConfig {
  enabled: boolean;
  instructions: string | null;
  // Card only — add these two fields to the type. They do not exist in the
  // customer app's RestaurantPaymentConfig type today (src/lib/data.ts lines 42-58).
  stripePublishableKey?: string;   // safe to read client-side — see §3
  stripeSecretKey?: string;        // NEVER read this into any client-visible state — see §4
}
```

**camelCase is deliberate** — matches the field names already live in Super Admin's production data
(see `RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_HANDOVER.md` §2.1 in this repo for the full history).
Extend `RestaurantPaymentConfig`/`RestaurantPaymentMethodConfig` in `src/lib/data.ts` (lines 42–58)
and thread the new field through `useRestaurantPaymentConfig` (`src/lib/firebase-adapters.ts` lines
764–804) so `checkout.tsx` can read `paymentConfig?.methods?.card?.stripePublishableKey` alongside
the `.enabled`/`.instructions` it already reads.

Separately, add to the `Restaurant` type (`src/lib/data.ts` lines 281–316) and its mapper
(`mapRestaurant()` in `src/lib/firebase-adapters.ts`, e.g. lines 400–441):

```ts
cloudinaryCloudName?: string;
cloudinaryUploadPreset?: string;
```

**This step is easy to skip and silently break everything downstream.** `mapRestaurant()` only
copies an explicit allow-list of fields from the raw Firestore document — any field not added there
is dropped before your checkout code ever sees it, even though it exists on the underlying document
in Super Admin. Confirmed by reading the mapper: neither of these two fields, nor any Stripe key, is
in its current allow-list.

---

## 3. Real Stripe checkout, keyed to the restaurant

1. Add `@stripe/stripe-js` to the client. Do **not** add the `stripe` npm package (the server SDK)
   to any file that ships to the browser.
2. When the customer selects **Card** at checkout, initialize Stripe with *this restaurant's own*
   publishable key, not an app-wide constant:

   ```ts
   import { loadStripe } from "@stripe/stripe-js";
   const stripePromise = loadStripe(restaurantPaymentConfig.methods.card.stripePublishableKey);
   ```

   Publishable keys are designed to be public/client-side — this is safe. If the field is empty for
   a restaurant that has `card.enabled === true`, treat Card as unavailable for that restaurant
   (fail closed) rather than falling back to some other key.
3. **Replace the current raw card-number form.** `CUSTOMER_APP_PAYMENT_METHODS_PROMPT.md` §4
   specified a custom cardholder-name/number/expiry/CVV form with Luhn validation — that spec
   predates this integration and is **superseded for the card path only**: use **Stripe Elements**
   (Card Element or Payment Element) instead. Elements tokenizes input inside Stripe's own iframe, so
   the raw PAN/CVV never touches this app's state or bundle at all — a stronger version of the
   existing rule that "the full card number and CVV must never be written to Firebase, logs, or
   analytics." Keep the optional "save card" checkbox concept if you like, backed by Stripe's own
   setup-intent flow — don't build your own tokenization.
4. On submit, call the new server function from §4 to create a PaymentIntent scoped to this
   restaurant, then confirm it client-side with Stripe.js
   (`stripe.confirmCardPayment`/`confirmPayment`).
5. Replace every fabricated field in `checkout.tsx`'s `submit()` (§1) with the real result:
   - `paymentGateway: "stripe"` (not `"demo-gateway"`)
   - `paymentReference: paymentIntent.id` (not `SIM-...`)
   - `cardBrand` / `cardLast4` from the confirmed PaymentMethod's `card.brand`/`card.last4` (not the
     hardcoded `"Visa"`/`"4242"`)
   - `payment_status: "paid"` only after Stripe confirms success — not immediately/optimistically.
6. On failure, write `OrderPaymentEvidence.status: "failed"` and allow retry against the same
   `receipt_number`, exactly as already specified in `CUSTOMER_APP_PAYMENTS_PROMPT.md` — that rule
   doesn't change, only the thing that can now genuinely fail (a real gateway call) does.

---

## 4. New server-side function — this is where the secret key lives, and *only* here

Nothing in this app touches a Stripe secret key today (confirmed — zero matches for
`stripeSecretKey`/`STRIPE_SECRET` anywhere in `src`), so there is no existing call site to extend;
this is new. This app already depends on `@tanstack/react-start`, which provides server functions —
use one (or a Cloud Function, if your team prefers keeping payment logic out of the SSR server) for
this exact job:

1. Receives `{ restaurantId, amount }` from the client.
2. Reads `restaurants/{restaurantId}.payment_config.methods.card.stripeSecretKey` **server-side
   only**.
3. Creates a Stripe PaymentIntent (using the real `stripe` npm package, server-side) against that
   restaurant's own Stripe account.
4. Returns **only** the PaymentIntent's `client_secret` to the browser — never the secret key
   itself, never the full PaymentIntent object if it contains anything sensitive beyond that.

**Hard rule:** `stripeSecretKey` must never appear in any file under `src/routes`, `src/components`,
or any client-bundled module — and never in a `VITE_*` env var, since Vite inlines those into the
client bundle. If this framework's server functions don't cleanly separate server-only code from
client-bundled code in this codebase today, that boundary needs to be established carefully as part
of this work, not assumed.

**Flag, don't silently fix:** the underlying storage of `stripeSecretKey` — a plain field on a
Firestore document that Super Admin's own security rules currently let an authenticated customer-app
client read directly — is the same anti-pattern already flagged in
`RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_HANDOVER.md` §2.5. The server function in this section
avoids compounding that exposure *at the point of use* (the secret never reaches the browser), but it
does not fix the point of *storage* (a sufficiently determined authenticated user could still read
the raw document if Firestore rules allow it). That's a platform-level decision for whoever owns the
payments roadmap — flag it, don't quietly redesign Super Admin's storage model as a side effect of
this task.

---

## 5. Cloudinary for EFT proof-of-payment, per restaurant

Today's "upload" is entirely fake. `checkout.tsx` lines ~662–677:

```ts
onChange={(e) => {
  const file = e.target.files?.[0];
  if (file) {
    setEftProofFile(file);
    setEftProofName(file.name);
    setEftProofUrl(`https://storage.hearth.app/proofs/${Date.now()}_${file.name}`);
    toast.success(`Attached proof of payment: ${file.name}`);
  }
}}
```

`storage.hearth.app` is not a real, reachable host. The actual `File` object (`eftProofFile`) is
captured in state and **never read again anywhere in the codebase** — it's silently discarded, and
only the fabricated URL string is persisted onto the order's `payment_proof_url` /
`OrderPaymentEvidence.proof_url`. There is no fallback either: if no file is chosen, `submit()`
fabricates a second fake URL (`storage.hearth.app/proofs/pop_${Date.now()}.pdf`) rather than blocking
placement — this also needs fixing to match the existing rule ("the order cannot be placed until a
file is attached").

Replace this with a real unsigned Cloudinary upload, using the already-captured `eftProofFile`:

```ts
const formData = new FormData();
formData.append("file", eftProofFile);
formData.append("upload_preset", restaurant.cloudinaryUploadPreset);

const res = await fetch(
  `https://api.cloudinary.com/v1_1/${restaurant.cloudinaryCloudName}/auto/upload`,
  { method: "POST", body: formData },
);
const data = await res.json();
setEftProofUrl(data.secure_url);
```

**Use the `/auto/upload` endpoint, not `/image/upload`.** `CUSTOMER_APP_PAYMENT_METHODS_PROMPT.md`
§5 requires accepting both images *and* PDFs for the proof-of-payment upload — Cloudinary's
`/image/upload` endpoint is image-only; `/auto/upload` (or `/raw/upload` for the PDF case
specifically) is needed so a PDF proof doesn't fail to upload.

**No account configured → fail closed, don't guess a fallback.** Unlike Super Admin's own Media tab
(which falls back to a platform-wide Cloudinary account when a restaurant hasn't set its own — see
`RESTAURANT_ADMIN_TO_SUPER_ADMIN_MEDIA_HANDOVER.md` §6), this customer app has no platform-wide tier
of its own today. If `restaurant.cloudinaryCloudName` is empty for a restaurant that has `eft.enabled
=== true`, treat EFT as unavailable for that restaurant rather than uploading to an undefined
destination. If your team wants a platform-wide fallback here too, that's a new decision to make
explicitly (and would need its own env vars / config surface) — don't invent one silently.

This is architecturally identical to what both Super Admin and Orderly Hub already do for their own
Cloudinary uploads (unsigned preset, raw `fetch`/`axios` POST, only `secure_url` persisted, no SDK,
no API secret anywhere) — you're replicating an established pattern, not inventing a new one.

---

## 6. Landmines

- **§0.1 and §0.2 are blocking, not optional** — without fixing the `payment_config` path
  resolution, none of the per-restaurant behavior in this document (old or new) will ever reflect
  what's actually configured in Super Admin.
- **`mapRestaurant()`'s allow-list will silently drop the two new Cloudinary fields** (and would do
  the same to a Stripe key if it were placed on the general restaurant mapper instead of the
  payment-config path) unless explicitly added — see §2.
- **A hardcoded fallback restaurant id already exists**: `checkout.tsx:108`,
  `const targetRestaurantId = restaurant?.id || restaurantSlug || "rst_5jqj45emntl";`. Once real
  Stripe keys and real Cloudinary accounts are wired to a specific restaurant id, this fallback
  becomes actively dangerous — if it ever triggers, an order could silently charge/upload against a
  *different* restaurant's credentials. Recommend hard-failing checkout (block placing the order,
  show an error) if no real restaurant can be resolved, rather than silently falling back to this
  fixture id, now that real payment processing is on the line.
- **Never let `stripeSecretKey` reach client-bundled code** — see §4's hard rule.
- **Don't conflate the two allow-lists.** `stripePublishableKey` lives inside `payment_config.methods.card`
  and flows through `useRestaurantPaymentConfig` (§2/§3). `cloudinaryCloudName`/`cloudinaryUploadPreset`
  live flat on the restaurant document and flow through `Restaurant`/`mapRestaurant()` (§2/§5). They
  are two different read paths in this codebase — extending one does not extend the other.
- **This document does not touch `OrderPaymentEvidence`'s schema** — only how `gateway`, `reference`,
  `card_brand`, `card_last4`, and `proof_url` get populated with real values instead of fabricated
  ones. The record shape itself is still governed by `CUSTOMER_APP_PROMOTIONS_INTEGRATION.md` §3.8.
- **The RTDB/Firestore split in §0.1 is out of scope to fix here.** Don't attempt to build a sync
  bridge to Orderly Hub as part of this task — flag it to whoever owns the platform roadmap.

---

## 7. Acceptance checklist

- [ ] `restaurants/{rid}/payment_config` resolves to the nested `payment_config` field on the
      Firestore document `restaurants/{rid}` — not a separate `restaurant_payment_config` collection
      (§0.2). Verify by toggling a payment method in Super Admin and confirming checkout reflects it
      within ~1 s.
- [ ] `RestaurantPaymentMethodConfig` includes `stripePublishableKey` (client-safe) and
      `stripeSecretKey` (server-only, never read into client state) (§2).
- [ ] `Restaurant` type + `mapRestaurant()` surface `cloudinaryCloudName` / `cloudinaryUploadPreset`
      (§2).
- [ ] Card checkout uses Stripe Elements, initialized with the specific restaurant's own publishable
      key, and writes real `gateway`/`reference`/`card_brand`/`card_last4` from a confirmed
      PaymentIntent — no more `demo-gateway`, `SIM-...`, or hardcoded `Visa 4242` (§3).
- [ ] A new server-side function creates the PaymentIntent using the restaurant's secret key,
      read and used server-side only, returning just the client secret (§4).
- [ ] EFT proof-of-payment uploads the already-selected file to
      `https://api.cloudinary.com/v1_1/{restaurant.cloudinaryCloudName}/auto/upload` with the
      restaurant's own unsigned preset, and persists the real `secure_url` — no more
      `storage.hearth.app` fabrication, and the previously-captured-but-discarded `File` object is
      now actually used (§5).
- [ ] A restaurant with EFT enabled but no Cloudinary account configured cannot proceed with EFT
      checkout (fails closed, per §5) rather than uploading nowhere.
- [ ] The hardcoded `rst_5jqj45emntl` fallback (§6) has been reviewed and, at minimum, no longer
      silently proceeds with checkout when the real restaurant can't be resolved.
- [ ] Nothing under `src/routes`, `src/components`, or any `VITE_*` env var references
      `stripeSecretKey` (§4/§6).

---

## 8. AI implementation prompt (copy-paste)

```
You are updating the customer-facing ordering app (customerapp-main, real project root
customerapp-main/customerapp-main/) so checkout uses per-restaurant Stripe keys for card payments and
per-restaurant Cloudinary accounts for EFT proof-of-payment uploads (reference:
docs/SUPER_ADMIN_TO_CUSTOMER_APP_STRIPE_CLOUDINARY_HANDOVER.md in the fleet-admin-hub-main repo, this
file). Do not invent a different shape — copy the schema and behavior in that doc exactly.

## Fix this first (blocking)
src/lib/firebase.ts's resolveTarget() currently redirects `restaurants/{rid}/payment_config` to a
separate collection `restaurant_payment_config/{rid}`. This is wrong — it must resolve to the nested
`payment_config` field on the Firestore document `restaurants/{rid}`, matching both this app's own
migration spec (CUSTOMER_APP_FIRESTORE_MIGRATION_PROMPT.md §2) and what the Super Admin console
actually writes to. Fix this before anything else — none of the per-restaurant config below will work
until this is corrected.

## Goal
1. Card payments must use the specific restaurant's own Stripe publishable/secret keys, not a single
   app-wide key. There is no Stripe integration in this app today — build it from scratch (Stripe
   Elements client-side, a new server function for the PaymentIntent).
2. EFT proof-of-payment files must upload to the specific restaurant's own Cloudinary account
   (cloudName + unsigned preset), not a fabricated URL. The current "upload" captures the file and
   then discards it, writing a fake storage.hearth.app URL instead.

## Required behaviour

### 1. Schema
- Add stripePublishableKey?: string and stripeSecretKey?: string to RestaurantPaymentMethodConfig
  (src/lib/data.ts) — camelCase, card method only.
- Add cloudinaryCloudName?: string and cloudinaryUploadPreset?: string to the Restaurant type
  (src/lib/data.ts) AND to mapRestaurant()'s allow-list (src/lib/firebase-adapters.ts) — fields not
  added to the mapper are silently dropped even if present on the underlying document.

### 2. Stripe checkout (client)
- Add @stripe/stripe-js. Never add the `stripe` server package to client-bundled code.
- Initialize Stripe with loadStripe(restaurantPaymentConfig.methods.card.stripePublishableKey) — this
  restaurant's own key, not a constant.
- Replace the current custom card-number/CVV form with Stripe Elements (Card Element or Payment
  Element) — this supersedes CUSTOMER_APP_PAYMENT_METHODS_PROMPT.md §4's raw-input form spec for the
  card path specifically.
- On submit, call the new server function (below) to create a PaymentIntent, then confirm it
  client-side. Replace every fabricated field in checkout.tsx's submit() — paymentGateway,
  paymentReference, cardBrand, cardLast4 — with real values from the confirmed PaymentIntent/PaymentMethod.
  payment_status becomes "paid" only after real confirmation, not optimistically.
- If the restaurant has no stripePublishableKey configured, treat Card as unavailable for that
  restaurant (fail closed).

### 3. New server-side function (server-only — holds the secret key)
- Use this app's existing @tanstack/react-start server functions (or a Cloud Function).
- Input: { restaurantId, amount }. Reads restaurants/{restaurantId}.payment_config.methods.card.stripeSecretKey
  SERVER-SIDE ONLY. Creates a Stripe PaymentIntent with the `stripe` npm package. Returns ONLY the
  client_secret to the browser.
- stripeSecretKey must never appear in any client-bundled file or VITE_* env var.

### 4. Cloudinary EFT upload
- Use the already-captured File object (eftProofFile in checkout.tsx) — it is currently captured but
  never uploaded anywhere; wire it to a real unsigned POST:
  fetch(`https://api.cloudinary.com/v1_1/${restaurant.cloudinaryCloudName}/auto/upload`, { method:
  "POST", body: formData }) with upload_preset = restaurant.cloudinaryUploadPreset. Use /auto/upload
  (not /image/upload) since PDF proofs must be accepted per existing spec.
- Persist the real secure_url from the response as eftProofUrl / OrderPaymentEvidence.proof_url —
  remove the storage.hearth.app fabrication entirely, including the pop_${Date.now()}.pdf fallback
  when no file is chosen (the order must not be placeable without a real uploaded file).
- If the restaurant has no cloudinaryCloudName configured, treat EFT as unavailable for that
  restaurant (fail closed) — do not fall back to any other account.

### 5. Do not
- Touch OrderPaymentEvidence's schema, applicability rules, or receipt UX — those are unchanged,
  governed by CUSTOMER_APP_PROMOTIONS_INTEGRATION.md §3.6/§3.8.
- Build a sync bridge to Orderly Hub's Realtime Database — out of scope; Super Admin's Firestore
  restaurants/{id} document is the only reachable source for this app.
- Invent a platform-wide Cloudinary or Stripe fallback — if a restaurant hasn't configured its own,
  fail that payment method closed for that restaurant rather than guessing a fallback.
- Leave the hardcoded restaurant id fallback (checkout.tsx:108, "rst_5jqj45emntl") silently in place
  once real payment credentials are wired to a specific restaurant — at minimum, hard-fail checkout
  if the real restaurant can't be resolved.

## Reference files (Super Admin repo, fleet-admin-hub-main)
- src/lib/payments.firebase.ts (PAYMENT_METHOD_CATALOG, card.stripePublishableKey/stripeSecretKey shape)
- src/lib/restaurants.firebase.ts (FirebaseRestaurant.cloudinaryCloudName/cloudinaryUploadPreset)
- src/lib/firestore.ts (resolvePath — the correct restaurants/{id}/payment_config → nested-field mapping)
- docs/RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_HANDOVER.md (full Stripe-key schema history + §2.5 security note)
- docs/RESTAURANT_ADMIN_TO_SUPER_ADMIN_MEDIA_HANDOVER.md (Cloudinary per-restaurant pattern + fallback-chain reasoning)

## Reference files (this repo, customer app)
- src/routes/checkout.tsx (submit(), the fake card branch, the fake EFT upload — lines cited in the
  handover doc)
- src/lib/data.ts (RestaurantPaymentConfig/RestaurantPaymentMethodConfig, Restaurant type, placeFirebaseOrder)
- src/lib/firebase-adapters.ts (useRestaurantPaymentConfig, mapRestaurant)
- src/lib/firebase.ts (resolveTarget — the bug to fix first)
```

---

## 9. Source map

**Customer app (`customerapp-main/customerapp-main`)**

| File | Role |
|---|---|
| `src/lib/firebase.ts` | Firestore init, `rtdb*`-named legacy-path shim, `resolveTarget()` (§0.2 bug) |
| `src/lib/data.ts` | `RestaurantPaymentConfig`/`RestaurantPaymentMethodConfig`, `Restaurant` type, `placeFirebaseOrder()`, `OrderPaymentEvidence` |
| `src/lib/firebase-adapters.ts` | `useRestaurantPaymentConfig()`, `mapRestaurant()` allow-list |
| `src/routes/checkout.tsx` | Checkout UI + `submit()` — today's fake card branch and fake EFT upload |
| `src/lib/cart.tsx` | `placeOrder()` — forwards payment fields into `placeFirebaseOrder()` |
| `src/routes/orders.$orderId.tsx` | Order detail — renders `proof_url` as a link |

**Super Admin (this repo, `fleet-admin-hub-main`)**

| File | Role |
|---|---|
| `src/lib/payments.firebase.ts` | `PAYMENT_METHOD_CATALOG`, card's Stripe key fields, `savePaymentConfig()` |
| `src/lib/restaurants.firebase.ts` | `FirebaseRestaurant.cloudinaryCloudName`/`.cloudinaryUploadPreset` |
| `src/lib/firestore.ts` | `resolvePath()` — the authoritative path→Firestore-location mapping |
| `docs/RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_HANDOVER.md` | Full Stripe-key schema + security note |
| `docs/RESTAURANT_ADMIN_TO_SUPER_ADMIN_MEDIA_HANDOVER.md` | Per-restaurant Cloudinary pattern |

**Restaurant Admin / Orderly Hub (`orderlyhub-main`) — for context only, not a data source for this app**

| File | Role |
|---|---|
| `src/lib/firebase.ts` | Confirmed Realtime Database — separate, unsynced from the above (§0.1) |

---

*Prepared as a handover reference — update alongside any future change to checkout payment
processing or proof-of-payment storage.*
