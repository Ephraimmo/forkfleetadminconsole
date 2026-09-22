# Handover: Restaurant Admin Media (Cloudinary) → Super Admin Console

> **Audience:** AI / developer updating the **ForkFleet Super Admin console**
> (`forkfleet-admin-console`, this repo) so each restaurant gets its own Media (Cloudinary)
> configuration tab, matching Restaurant Admin ("Orderly Hub").
> **Direction:** same direction as `RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_HANDOVER.md` — Orderly
> Hub is the **source of truth**, Super Admin is the one being brought up to date.
> **Source of truth:** Restaurant Admin (`orderlyhub-main`), `src/pages/Settings.tsx`,
> `src/lib/cloudinary.ts`, `src/lib/restaurants.firebase.ts` — snapshot as of **2026-09-20**.
> **Scope:** give each restaurant its own Cloudinary cloud name + unsigned upload preset (its own
> "account" for pictures/assets), so Super Admin and Restaurant Admin read/write the *same*
> per-restaurant fields and stay linked — not a shared, platform-wide Cloudinary account.

Related docs: `RESTAURANT_ADMIN_TO_SUPER_ADMIN_PAYMENTS_HANDOVER.md` documents the sibling
`payment_config` field on the same restaurant record and the shape/landmine conventions this doc
follows (exact-shape schema blocks, "decide deliberately" landmines, flag-don't-redesign security
notes). Read that one first if any convention here is unclear — this doc doesn't repeat those
ground rules, only the Media-specific content.

---

## 0. Two corrections to make before you start

**0.1 — Orderly Hub's own `docs/CLOUDINARY_MEDIA_HANDOVER.md` is partially stale.** It describes a
`businessId` / `settings/business` / `settings/businesses/{id}` path scheme via
`src/lib/businessSettingsPath.ts`. That file exists but is **dead code** — `getBusinessSettingsPath`
is defined there and never imported anywhere else in `src/`. Do not copy that scheme. The actual,
live path is the flat one in §1.1 below.

**0.2 — This app is Firebase Realtime Database, not Firestore**, despite the companion Payments
handover doc calling it "Cloud Firestore". There are zero matches for `firestore` anywhere in
Orderly Hub's `src/` — it's `firebase/database` (`getDatabase(app)`), and every path below is an
RTDB node path (slash-delimited), not a Firestore document path. This naming inconsistency already
exists across both docs and both apps' own code comments (this repo's `payments.firebase.ts` says
"Realtime Database" in one comment and is read/written through an `fs*`-prefixed helper module
elsewhere) — worth knowing so you don't go looking for a Firestore SDK call that isn't there, but
not something to "fix" by renaming things; match whichever term the file you're editing already
uses.

---

## 1. What you must understand first

### 1.1 Two flat fields on the restaurant's own record — not nested, not a separate document

```
restaurants/{restaurantId}                          -> the restaurant record (name, phone, hours,
                                                        image_url, payment_config, ...)
restaurants/{restaurantId}.cloudinaryCloudName       -> string
restaurants/{restaurantId}.cloudinaryUploadPreset    -> string
```

Path helper, `src/lib/restaurant-scope.ts`:

```ts
export function restaurantPath(restaurantId: string): string {
  return `restaurants/${restaurantId}`;
}
```

These two fields are **siblings of `payment_config`** on the exact same record (see the Payments
handover doc §1.1) — not a nested `media` or `branding` object, and not a separate document. The
type declaration confirms it, `src/lib/restaurants.firebase.ts` (`FirebaseRestaurant` interface):

```ts
cloudinaryCloudName?: string;
cloudinaryUploadPreset?: string;
```

sitting alongside `name`, `phone`, `opens_at`, `closes_at`, `prep_time_minutes`, `image_url`, etc.

### 1.2 Each restaurant configures its own separate Cloudinary *account* — there is no folder namespacing

This is the important architectural point behind "under each account" in the ask that produced this
doc. Orderly Hub's upload call (`src/lib/cloudinary.ts`) only ever sends `file` and `upload_preset`
in the form body — **no `folder`, `tags`, `public_id`, or restaurant-id-derived path parameter is
ever passed to Cloudinary.** Isolation between restaurants' image libraries is achieved purely by
convention: every restaurant is expected to create its own Cloudinary account (or at least its own
cloud) and paste in its own cloud name + its own unsigned preset. If two restaurants were
misconfigured with the same cloud name, their uploads would land in the same Cloudinary media
library with zero collision-avoidance in this codebase.

**Decide this deliberately, the same way the Payments doc's §2.4 asked you to decide on the coupled
cash toggle:**
- **Option A — copy Orderly Hub exactly:** one Cloudinary account per restaurant, manually
  configured by each restaurant operator. Simple, matches the source of truth 1:1, but doesn't
  scale well once Super Admin is managing this centrally for many restaurants (an operator has to
  go create N Cloudinary accounts).
- **Option B — one shared platform Cloudinary account, folder-per-restaurant** (e.g.
  `folder: restaurants/{restaurantId}` in the upload form body). Scales better centrally, but is a
  *behavior change* from what Orderly Hub does today, and Orderly Hub would need to either adopt it
  too or the two apps would diverge on how isolation works.

This doc describes Option A (Orderly Hub's actual current behavior) as the schema to replicate for
field-level parity. Which option Super Admin's UI actually pushes operators toward is a product
decision — flag it, don't silently pick one.

### 1.3 Only two fields exist — no API secret, ever

Confirmed by reading the full `cloudinary.ts` and grepping the whole `src/` tree for "cloudinary":
`cloudinaryCloudName` and `cloudinaryUploadPreset` are the **only** two Cloudinary-related fields
anywhere in Orderly Hub. No API key, no API secret, no folder, no tags field. All uploads are
**unsigned** — this is the one part of the Payments doc's §2.5 security warning that does *not*
apply here: there is no secret to accidentally ship to the browser, because Cloudinary's unsigned
upload flow was designed not to need one client-side.

---

## 2. Exact shape (copy verbatim)

```ts
// restaurants/{restaurantId} — two of many sibling fields, alongside payment_config
interface FirebaseRestaurant {
  // ...existing fields (name, phone, opens_at, closes_at, prep_time_minutes, image_url, ...)
  cloudinaryCloudName?: string;      // "" / undefined when unset — camelCase
  cloudinaryUploadPreset?: string;   // "" / undefined when unset — camelCase, MUST be an
                                      // unsigned preset (Cloudinary dashboard → Upload →
                                      // Upload presets → Signing mode: Unsigned)
}
```

**Preserve the camelCase naming**, same reasoning as `stripePublishableKey`/`stripeSecretKey` in the
Payments doc — these two fields already exist under these exact names in production Orderly Hub
data; renaming them here would just create an unreadable second copy of the same setting.

---

## 3. UI (reference: Orderly Hub `src/pages/Settings.tsx` lines ~185–212)

- Section heading **"Media (Cloudinary)"**, its own card, sitting between "Business Information" and
  "Payment Methods" on Orderly Hub's single flat Settings page.
- Caption above the fields: *"Images for products, categories, and this logo upload go to
  Cloudinary. Create an **unsigned** upload preset in Cloudinary and enter its name below. The API
  secret is not stored here and is not used in the browser."*
- Two fields side by side:
  - **Cloud name** — placeholder `e.g. dnmcti0xs`
  - **Upload preset (unsigned)** — placeholder `e.g. ml_default or my_app_uploads`
- Caption below: *"If these are empty, the app falls back to `VITE_CLOUDINARY_*` in `.env` for local
  development only."*
- The restaurant's **logo** upload control is a *separate* section above this one ("Business
  Information"), not inside the Media card — but it consumes these same two fields once saved.
- Gating: the whole Settings form is disabled from saving when read-only; the two inputs themselves
  are not individually `disabled` — only the Save button is gated (`disabled={saving || readOnly}`).

---

## 4. Upload mechanism (reference: `src/lib/cloudinary.ts`, full file — unsigned only)

```ts
export function resolveCloudinaryOptions(overrides?: CloudinaryUploadOverrides | null) {
  const fromEnvName = (env.VITE_CLOUDINARY_CLOUD_NAME ?? "").trim();
  const fromEnvPreset = (env.VITE_CLOUDINARY_UPLOAD_PRESET ?? "").trim() || "ml_default";
  const cloudName = (overrides?.cloudName?.trim() || fromEnvName).trim();
  const uploadPreset = (overrides?.uploadPreset?.trim() || fromEnvPreset).trim() || "ml_default";
  return { cloudName, uploadPreset };
}

export const uploadToCloudinary = async (file: File, overrides?: CloudinaryUploadOverrides | null) => {
  const { cloudName, uploadPreset } = resolveCloudinaryOptions(overrides ?? undefined);
  if (!cloudName) throw new Error("Cloudinary cloud name is missing. ...");
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);
  const { data } = await axios.post(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    formData,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  if (!data?.secure_url) throw new Error("Cloudinary upload succeeded but no secure_url was returned.");
  return data.secure_url;
};
```

- **No Cloudinary SDK, no upload widget** — a raw multipart POST. Only `secure_url` is ever
  persisted; the binary never touches Firebase.
- Optional best-effort audit log at `uploads/images` (global, not per-restaurant): `{ url, createdAt,
  context, userId }`. Logging failures are swallowed (`console.error`), never surfaced to the user.
- This is architecturally **identical** to what this repo (Super Admin) already does for the
  *platform-wide* Cloudinary config — see `src/lib/cloudinary.ts`,
  `src/hooks/use-cloudinary-config.ts`, `src/components/cloudinary-image-upload.tsx`. You are not
  building new upload machinery; you're adding a second, per-restaurant *source* of `cloudName` /
  `uploadPreset` that the existing machinery already accepts via its `overrides` prop.

---

## 5. What Super Admin already has today (starting point)

This repo already has a **platform-wide** Media (Cloudinary) config — one cloud name + one preset
for the whole platform:

| File | Role |
|---|---|
| `src/lib/settings.firebase.ts` | `MediaSettings` type + `PlatformSettings.media`, stored at RTDB `settings.media` |
| `src/lib/cloudinary.ts` | `resolveCloudinaryOptions()` / `uploadToCloudinary()` — priority: `overrides` → `VITE_CLOUDINARY_*` → `"ml_default"` |
| `src/hooks/use-cloudinary-config.ts` | Subscribes to `settings.media`, exposes it as `overrides` for `CloudinaryImageUpload` |
| `src/components/cloudinary-image-upload.tsx` | The upload widget — already accepts an `overrides` prop that takes priority over the subscribed platform settings |
| `src/routes/_authenticated/settings.tsx` (tab `media`, ~lines 610–677) | The existing platform-wide "Media (Cloudinary)" UI — this is the pattern to copy per-restaurant, not a second unrelated thing to build |

Every current per-restaurant image upload call site uses this **platform-wide** config today —
there is no restaurant-level override yet, because `FirebaseRestaurant` doesn't have the field:

| # | File | Line | `context` | Uses |
|---|---|---|---|---|
| 1 | `src/routes/_authenticated/restaurants/index.tsx` | 881 | `"restaurant_cover"` | Create-restaurant dialog cover image |
| 2 | `src/routes/_authenticated/restaurants/$id.tsx` | 614 | `"restaurant_cover"` | Restaurant detail → cover image (Profile tab) |
| 3 | `src/routes/_authenticated/menus.tsx` | 602 | `"product"` | Menu item photo (one dialog) |
| 4 | `src/routes/_authenticated/menus.tsx` | 1143 | `"product"` | Menu item photo (second dialog) |

**Adding the field to `FirebaseRestaurant` alone accomplishes nothing** — you must also update these
four call sites (and the new Media tab's own logo/cover fields, if any) to pass
`overrides={{ cloudName: restaurant.cloudinaryCloudName, uploadPreset: restaurant.cloudinaryUploadPreset }}`,
falling through to the platform-wide config when the restaurant hasn't set its own (see §6).

---

## 6. Config resolution priority — extend the existing chain, don't replace it

Super Admin's `resolveCloudinaryOptions()` already implements: `overrides` (passed in) →
`VITE_CLOUDINARY_*` env → `"ml_default"` preset fallback. Insert a new tier so a restaurant's own
credentials take priority over the platform ones, without breaking any restaurant that hasn't
configured its own yet:

1. **Restaurant's own** `cloudinaryCloudName` / `cloudinaryUploadPreset` (new — this doc)
2. **Platform-wide** `settings.media.cloudinary_cloud_name` / `cloudinary_upload_preset` (existing
   global Settings → Media tab)
3. `VITE_CLOUDINARY_CLOUD_NAME` / `VITE_CLOUDINARY_UPLOAD_PRESET` env (existing, dev-only)
4. `"ml_default"` preset default (existing)

This mirrors Orderly Hub's own priority chain (its settings → its env fallback); Super Admin just has
one extra tier in the middle because it has a platform-wide concept that a single-tenant app like
Orderly Hub doesn't need. Build this resolution where the call site already knows both the
restaurant record and the platform settings (e.g. compose the two `overrides` objects before
passing them to `CloudinaryImageUpload`, restaurant-level values first) — don't duplicate
`resolveCloudinaryOptions()`'s internal logic a second time.

---

## 7. New "Media" tab on the restaurant detail page

Add a tab titled **"Media"** to the existing `TabsList` in
`src/routes/_authenticated/restaurants/$id.tsx` (alongside `Profile & commission | Business hours |
Branches | Delivery fees | Points & Rewards | Payments | Team`), gated on the same
`canManage = staff.hasPermission("restaurants.manage")` already used by every other tab on this
page. Orderly Hub also bundles Cloudinary editing into its general settings/profile permission
(`rm.settings.manage` / `rm.profile.manage`) rather than a dedicated one — see §8 — so this keeps
parity; deviate only if you have a specific reason to.

Tab content, adapted from §3:
- Cloud name input + Upload preset (unsigned) input, same captions.
- Unlike Orderly Hub (single-tenant, nothing to distinguish), Super Admin needs an indicator of
  **which tier is actually active** for this restaurant right now — e.g. "Using this restaurant's
  own Cloudinary account" vs "Using the platform default (Settings → Media)" — since §6 introduces a
  fallback chain Orderly Hub doesn't have to reason about.
- Reuse `CloudinaryImageUpload` for any preview/test-upload affordance you add here, the same
  component already used everywhere else in this repo.

---

## 8. Permissions

From Orderly Hub's `src/lib/restaurant-permissions.ts` — editing Media sits behind the same
permission as business profile, **not** a dedicated Cloudinary/media permission:
- `rm.settings.manage` — "Configure restaurant settings and integrations"
- `rm.profile.manage` — "Edit restaurant profile, hours and contact details"

Either grants edit access to the whole Settings page (business info + Cloudinary fields + payment
methods). Note Products/Categories image *uploads* are gated separately, by `rm.menu.manage` — not
by the settings/profile permission. If Super Admin wants a dedicated media permission instead of
overloading `restaurants.manage`, that's a deliberate deviation to call out, not something to assume.

| Action | Orderly Hub permission | Super Admin permission (existing pattern) |
|---|---|---|
| Edit a restaurant's Cloudinary cloud name / preset | `rm.settings.manage` or `rm.profile.manage` | `restaurants.manage` |
| Upload a menu item / category image | `rm.menu.manage` | `restaurants.manage` (menus.tsx currently has no finer-grained gate — verify before assuming parity) |

---

## 9. Landmines

- **`businessSettingsPath.ts` is dead code** in Orderly Hub — don't copy its `businessId` /
  `settings/business(es)` scheme (§0.1).
- **RTDB, not Firestore** — don't build against a Firestore SDK because a sibling doc said Firestore
  (§0.2).
- **No folder namespacing exists to copy** — decide deliberately between account-per-restaurant
  (matches source) and folder-per-restaurant under one shared account (§1.2).
- **Four existing call sites in this repo will silently keep using the platform-wide account**
  unless you explicitly wire in restaurant-level overrides — adding the field to the type alone is a
  no-op (§5).
- **No dedicated media library / asset browser page exists in Orderly Hub** to mirror — this doc is
  about the config tab + wiring existing upload call sites only. Don't build a media library as part
  of this handover unless separately asked; it would be new scope, not parity.
- **Never add an API key or secret field.** Unlike the Stripe secret key situation in the Payments
  doc, there is no secret to carry over here at all — if a future ask wants *signed* uploads, that
  needs a server-side signing endpoint (Cloud Function) and is explicitly out of scope for this doc,
  same as the Payments doc keeps server-side Checkout Session creation out of scope.

---

## 10. Acceptance checklist

- [ ] `FirebaseRestaurant` gains `cloudinaryCloudName?: string` and `cloudinaryUploadPreset?: string`
      (§2), camelCase, optional/blank-safe.
- [ ] New "Media" tab on the restaurant detail page reads and writes these two fields on
      `restaurants/{id}` directly (§7) — not a nested object, not a separate document.
- [ ] The four existing `CloudinaryImageUpload` call sites (§5) — plus any new ones this tab
      introduces — are updated to pass restaurant-level overrides ahead of the platform-wide config
      (§6), verified by: set a restaurant's own cloud name/preset, upload an image there, confirm
      the resulting `secure_url` is hosted under that cloud name, not the platform one.
- [ ] Restaurants that have **not** set their own Cloudinary credentials continue to upload via the
      platform-wide config exactly as they do today — no regression for existing restaurants.
- [ ] The per-restaurant vs platform-wide vs env fallback priority (§6) is implemented as one
      resolution, not duplicated logic.
- [ ] Permission gating decision (§8) made deliberately and documented, not assumed from parity.
- [ ] The account-per-restaurant vs folder-per-restaurant decision (§1.2) made deliberately and
      flagged to whoever owns the Super Admin media roadmap, not silently picked.

---

## 11. AI implementation prompt (copy-paste)

```
You are updating the Super Admin console (forkfleet-admin-console, this repo) to add a per-restaurant
Media (Cloudinary) configuration tab, matching how Restaurant Admin ("Orderly Hub") lets each
restaurant configure its own Cloudinary cloud name + unsigned upload preset (reference:
docs/RESTAURANT_ADMIN_TO_SUPER_ADMIN_MEDIA_HANDOVER.md, this file, in this repo). Copy the schema
exactly; the UI and resolution-priority integration are yours to adapt to this repo's existing
platform-wide Cloudinary settings.

## Goal
Give each restaurant its own optional Cloudinary account (cloud name + unsigned upload preset), so
its own product photos, category images, cover image and logo can be isolated from other
restaurants' assets and from the platform-wide default — while restaurants that don't configure
their own keep working exactly as they do today via the platform-wide config.

## Required behaviour

### 1. Schema
- Add `cloudinaryCloudName?: string` and `cloudinaryUploadPreset?: string` to `FirebaseRestaurant`
  (src/lib/restaurants.firebase.ts) — exact field names, camelCase, matching Orderly Hub's
  production data.
- These live directly on `restaurants/{id}`, siblings of `payment_config` — not nested, not a
  separate document.

### 2. New "Media" tab
- Add a "Media" tab to the restaurant detail page (src/routes/_authenticated/restaurants/$id.tsx),
  alongside the existing tabs, gated on the same `restaurants.manage` permission as the rest of the
  page.
- Fields: Cloud name, Upload preset (unsigned) — same captions/placeholders as
  src/routes/_authenticated/settings.tsx's existing platform-wide "Media (Cloudinary)" section
  (reuse that copy, don't reinvent it).
- Show which config tier is currently active for this restaurant (its own vs the platform default).

### 3. Resolution priority
Extend (don't duplicate) src/lib/cloudinary.ts's resolveCloudinaryOptions() priority chain:
restaurant's own fields → platform-wide settings.media fields → VITE_CLOUDINARY_* env → "ml_default".
Compose this at each call site by building the `overrides` object with the restaurant's fields
first, falling back to the platform `useCloudinaryConfig()` overrides.

### 4. Wire existing call sites
Update ALL current CloudinaryImageUpload usages under a restaurant context — currently:
src/routes/_authenticated/restaurants/index.tsx:881, src/routes/_authenticated/restaurants/$id.tsx:614,
src/routes/_authenticated/menus.tsx:602 and :1143 — to pass the resolved per-restaurant overrides
instead of relying solely on the platform-wide config.

### 5. Do not
- Add any API key/secret field — Cloudinary uploads here are unsigned only, by design, on both sides.
- Invent folder/tag namespacing unless explicitly asked — Orderly Hub has none; flag the
  account-per-restaurant vs shared-account-with-folders decision to product instead of picking
  silently.
- Build a media library / asset browser page — out of scope, Orderly Hub has none to mirror.
- Regress any restaurant that hasn't configured its own Cloudinary account — it must keep using the
  platform-wide default exactly as today.

## Reference files (Orderly Hub repo)
- src/pages/Settings.tsx (Media (Cloudinary) UI, lines ~185-212; save lines ~92-103; read lines ~36-50)
- src/lib/cloudinary.ts (resolve + upload + optional audit, full file)
- src/lib/restaurants.firebase.ts (FirebaseRestaurant.cloudinaryCloudName/cloudinaryUploadPreset)
- src/lib/restaurant-scope.ts (restaurantPath)
- src/hooks/useBusinessSettings.ts (subscribes to restaurants/{id}, exposes Cloudinary fields)
- src/pages/Products.tsx, src/pages/Categories.tsx (per-restaurant call sites)
- src/lib/restaurant-permissions.ts (rm.settings.manage / rm.profile.manage / rm.menu.manage)
- docs/CLOUDINARY_MEDIA_HANDOVER.md (Orderly Hub's own doc — useful as background, but its path
  scheme section is stale; don't copy businessSettingsPath.ts)

## Reference files (this repo, Super Admin — existing platform-wide pattern to extend)
- src/lib/settings.firebase.ts (MediaSettings, PlatformSettings.media)
- src/lib/cloudinary.ts (resolveCloudinaryOptions, uploadToCloudinary)
- src/hooks/use-cloudinary-config.ts
- src/components/cloudinary-image-upload.tsx
- src/routes/_authenticated/settings.tsx (existing platform-wide Media (Cloudinary) tab, ~lines 610-677)
- src/routes/_authenticated/restaurants/$id.tsx, src/routes/_authenticated/restaurants/index.tsx,
  src/routes/_authenticated/menus.tsx (call sites to wire up)
```

---

## 12. Source map

**Orderly Hub (`orderlyhub-main`)**

| File | Role |
|---|---|
| `src/lib/cloudinary.ts` | Upload + resolve + optional RTDB audit (full impl) |
| `src/lib/restaurants.firebase.ts` | `FirebaseRestaurant.cloudinaryCloudName` / `.cloudinaryUploadPreset` |
| `src/lib/restaurant-scope.ts` | `restaurantPath` |
| `src/hooks/useBusinessSettings.ts` | Subscribes to `restaurants/{id}`, exposes Cloudinary fields to Products/Categories |
| `src/pages/Settings.tsx` | The only place these fields are written; UI ~185–212, save ~92–103, read ~36–50, logo upload ~68–83 |
| `src/pages/Products.tsx` | Multi-image upload call site (~193–212) |
| `src/pages/Categories.tsx` | Single-image upload call site (~56–71) |
| `src/lib/restaurant-permissions.ts` | `rm.profile.manage` / `rm.settings.manage` / `rm.menu.manage` |
| `.env.example`, `src/vite-env.d.ts` | Dev-only env fallback typing |
| `src/lib/businessSettingsPath.ts` | **Dead code** — do not use as a reference |
| `docs/CLOUDINARY_MEDIA_HANDOVER.md` | Orderly Hub's own doc — background only, path section is stale |

**Super Admin (this repo, `fleet-admin-hub-main`)**

| File | Role |
|---|---|
| `src/lib/cloudinary.ts` | Same upload/resolve pattern, currently platform-wide only |
| `src/lib/settings.firebase.ts` | `MediaSettings`, `PlatformSettings.media` |
| `src/hooks/use-cloudinary-config.ts` | Subscribes to platform `settings.media` |
| `src/components/cloudinary-image-upload.tsx` | Shared upload widget, already accepts per-call `overrides` |
| `src/routes/_authenticated/settings.tsx` | Existing platform-wide Media (Cloudinary) tab (~610–677) |
| `src/routes/_authenticated/restaurants/$id.tsx` | Restaurant detail page — add the new Media tab here |
| `src/routes/_authenticated/restaurants/index.tsx`, `src/routes/_authenticated/menus.tsx` | Existing call sites to wire up with restaurant-level overrides |
| `src/lib/restaurants.firebase.ts` | `FirebaseRestaurant` — add the two new fields here |

---

*Prepared as a handover reference — update alongside any change to per-restaurant media
configuration.*
