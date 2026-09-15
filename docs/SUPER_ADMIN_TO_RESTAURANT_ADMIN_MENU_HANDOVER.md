# Handover: Super Admin Menu Management → Restaurant Admin Menu

> **Audience:** AI / developer building the **Restaurant Management app** (restaurant admin / “Orderly Hub”).  
> **Goal:** Make Restaurant Admin **Menu / Products** show **every detail** that Super Admin creates under **Catalogue → Menus**, using the **same Firebase Realtime Database**.  
> **Problem this solves:** Products (and related details) appear correctly in Super Admin but are **missing, incomplete, or blank** in Restaurant Admin.

Related docs in this repo:

- [MENU_PRODUCTS_MODIFIERS_HANDOVER.md](./MENU_PRODUCTS_MODIFIERS_HANDOVER.md) — variants / add-ons / modifiers deep dive  
- [SUPER_ADMIN_RESTAURANT_MANAGEMENT_HANDOVER.md](../SUPER_ADMIN_RESTAURANT_MANAGEMENT_HANDOVER.md) — auth, restaurant scoping, permissions  

---

## 1. What you must understand

| App | Role for menus |
|-----|----------------|
| **ForkFleet Super Admin** (`forkfleetadminconsole`) | Can edit **any** restaurant’s menu. Writes to `/menus/{restaurantId}/…` |
| **Restaurant Admin** (your app) | Must edit **only** `session.restaurantId`. Reads/writes the **same** `/menus/{restaurantId}/…` paths |

There is **one menu per restaurant**. Super Admin and Restaurant Admin are **not** separate databases. If Restaurant Admin does not show a field that Super Admin saved, the bug is almost always:

1. Wrong RTDB path  
2. Wrong field name (snake_case vs camelCase)  
3. Not loading sibling nodes (`variants`, `addons`, `modifiers`)  
4. Filtering with only one casing of `menu_item_id`  
5. UI that only renders `name` + `price` and ignores the rest  

**Do not invent a second menu schema.** Mirror Super Admin.

---

## 2. Mandatory Firebase paths

All menu data for a restaurant lives under:

```
/menus/{restaurantId}/categories/{categoryId}
/menus/{restaurantId}/items/{itemId}
/menus/{restaurantId}/variants/{variantId}
/menus/{restaurantId}/addons/{addonId}
/menus/{restaurantId}/modifiers/{modifierId}
```

| Node | What it is |
|------|------------|
| `categories` | Menu sections (Pizzas, Drinks, …) |
| `items` | Products |
| `variants` | Per-product sizes / versions (linked by product id) |
| `addons` | Per-product optional extras (linked by product id) |
| `modifiers` | Shared choice groups for the restaurant (assigned on the product) |

### Forbidden / legacy

| Path | Status |
|------|--------|
| `/modifiers/{id}` (global, not under a restaurant) | **Do not use for new reads/writes.** Migrate to `/menus/{restaurantId}/modifiers` |
| Separate Firestore collections for menu | **Not used** by Super Admin menus |
| Hardcoded demo product lists | **Not allowed** for production menu UI |

`{restaurantId}` for Restaurant Admin **must** come from the signed-in user profile (`/restaurantUsers/{uid}.restaurant_id`), not from a free-form picker (unless Super Admin style multi-restaurant is intentional).

---

## 3. Load the full menu (required)

Restaurant Admin must subscribe to **all five** children in parallel for `session.restaurantId`:

```ts
// Pseudocode — mirror Super Admin getFirebaseMenu / subscribeFirebaseMenu
Promise.all([
  rtdbGet(`menus/${restaurantId}/categories`),
  rtdbGet(`menus/${restaurantId}/items`),
  rtdbGet(`menus/${restaurantId}/variants`),
  rtdbGet(`menus/${restaurantId}/addons`),
  rtdbGet(`menus/${restaurantId}/modifiers`),
]);
```

If you only load `items`, products will look “empty” of variants, add-ons, and modifiers even when Super Admin shows them.

Live updates: use RTDB `onValue` (or equivalent) on each path so Super Admin edits appear in Restaurant Admin without refresh.

---

## 4. Field compatibility (snake_case + camelCase)

Super Admin **writes both** where needed. Restaurant Admin **must read both**.

### Product link on variants & add-ons

```ts
const menuItemId = String(raw.menu_item_id ?? raw.menuItemId ?? "");
```

**Never** filter with only `raw.menu_item_id === item.id` — many records only have `menuItemId`.

### Product fields — read either casing

| Display / meaning | Prefer (canonical) | Also accept |
|-------------------|--------------------|-------------|
| Restaurant | `restaurant_id` | `restaurantId` |
| Category id | `category_id` | `categoryId` |
| Category name | `category` | — |
| Name | `name` | — |
| Description | `description` | — |
| Price | `price` | — |
| Sale price | `discount_price` | `discountPrice` |
| Prep minutes | `prep_time_minutes` | `prepTime` |
| Loyalty points | `points_value` | `pointsValue` |
| Available | `is_available` | `available` / `isAvailable` |
| Featured | `is_featured` | `isFeatured` |
| Image | `image_url` | `imageUrl` |
| Allergens | `allergens` (string[]) | — |
| Modifier group ids | `modifier_ids` | `modifierIds` |
| Modifier choice config | `modifier_config` | `modifierConfig` |

### Variant fields

| Meaning | Prefer | Also accept |
|---------|--------|-------------|
| Product link | `menu_item_id` | `menuItemId` |
| Name | `name` | — |
| Extra price | `price_delta` | `priceDelta` |
| Default | `is_default` | `isDefault` |
| Available | `is_available` | `isAvailable` |
| Sort | `sort_order` | `sortOrder` |

### Add-on fields

| Meaning | Prefer | Also accept |
|---------|--------|-------------|
| Product link | `menu_item_id` | `menuItemId` |
| Name | `name` | — |
| Price | `price` | — |
| Max qty | `max_quantity` | `maxQuantity` |
| Available | `is_available` | `isAvailable` |

### Modifier group fields

| Meaning | Prefer | Also accept |
|---------|--------|-------------|
| Restaurant | `restaurant_id` | `restaurantId` |
| Name | `name` | — |
| Type | `type` (`"option"` \| `"extra"`) | — |
| Required | `required` | — |
| Pricing enabled | `include_pricing` | `includePricing` |
| Min / max picks | `min_selections` / `max_selections` | `minSelections` / `maxSelections` |
| Choices | `choices: [{ label, price }]` | — |
| Sort / available | `sort_order` / `is_available` | camelCase aliases |

---

## 5. Product details that MUST show in Restaurant Admin

For **every** product in list + detail/edit views, surface at least:

### A. Core product (from `items/{id}`)

| Field | UI expectation |
|-------|----------------|
| `name` | Title |
| `description` | Subtitle / edit textarea |
| `category` + `category_id` | Category label + select |
| `price` | Base price (R) |
| `discount_price` | Sale price (show badge if set) |
| `points_value` | Loyalty points |
| `prep_time_minutes` | Prep time |
| `image_url` | Thumbnail / upload |
| `is_available` | Availability toggle |
| `is_featured` | Featured flag (if your UI supports it) |
| `allergens` | List (may be empty `[]`) |
| `id` | Visible in detail/debug (optional in list) |

### B. Counts on list row (like Super Admin)

Show something equivalent to:

```text
{n} variants · {n} add-ons · {n} modifiers · {prep} min prep
```

### C. Variants (from `variants` where link = product id)

For each linked variant show: **name**, **price_delta** (+R), **is_default**, **is_available**.  
Allow create/edit/delete when user has `rm.menu.manage`.

### D. Add-ons (from `addons` where link = product id)

For each linked add-on show: **name**, **price**, **max_quantity**, **is_available**.

### E. Modifier groups (from `modifiers` + item assignment)

1. Load all restaurant modifiers from `/menus/{restaurantId}/modifiers`.  
2. Assigned groups = modifiers whose `id` is in `item.modifier_ids` (or `modifierIds`).  
3. For each assigned group show: **name**, **type**, **choices**, and selected overrides from `modifier_config[modId][choiceIndex] = { selected, price }`.

**Assignment rule (same as Super Admin):** selecting any choice writes `modifier_ids` / `modifierIds` and `modifier_config` / `modifierConfig` on the item.

---

## 6. How to join products ↔ customizations

```ts
function variantsForItem(variants, itemId) {
  return variants.filter(v => (v.menu_item_id || v.menuItemId) === itemId);
}

function addonsForItem(addons, itemId) {
  return addons.filter(a => (a.menu_item_id || a.menuItemId) === itemId);
}

function modifiersForItem(modifiers, item) {
  const ids = new Set(item.modifier_ids ?? item.modifierIds ?? []);
  return modifiers.filter(m => ids.has(m.id));
}
```

Normalize raw RTDB objects **once** into typed models, then use helpers everywhere. Do not re-parse inconsistently in each screen.

---

## 7. Example payloads (what Super Admin writes)

### Item

```json
{
  "id": "itm_abc123",
  "restaurant_id": "rst-nonna",
  "category_id": "cat_pizza",
  "category": "Pizzas",
  "name": "Margherita Pizza",
  "description": "Tomato, mozzarella, basil",
  "price": 129,
  "discount_price": 99,
  "prep_time_minutes": 15,
  "points_value": 5,
  "is_available": true,
  "is_featured": false,
  "image_url": "https://res.cloudinary.com/…/margherita.jpg",
  "allergens": [],
  "modifier_ids": ["mod_spice"],
  "modifierIds": ["mod_spice"],
  "modifier_config": {
    "mod_spice": {
      "0": { "selected": true, "price": 0 },
      "1": { "selected": true, "price": 5 }
    }
  },
  "modifierConfig": { }
}
```

> Note: Super Admin always writes `modifier_ids` + `modifierIds` and `modifier_config` + `modifierConfig`. Your writes should do the same.

### Variant

```json
{
  "id": "var_large",
  "menu_item_id": "itm_abc123",
  "menuItemId": "itm_abc123",
  "name": "Large",
  "price_delta": 25,
  "priceDelta": 25,
  "is_default": false,
  "is_available": true
}
```

### Add-on

```json
{
  "id": "add_cheese",
  "menu_item_id": "itm_abc123",
  "menuItemId": "itm_abc123",
  "name": "Extra cheese",
  "price": 15,
  "max_quantity": 3,
  "maxQuantity": 3,
  "is_available": true
}
```

### Modifier group

```json
{
  "id": "mod_spice",
  "restaurant_id": "rst-nonna",
  "name": "Spice level",
  "type": "option",
  "required": true,
  "include_pricing": true,
  "min_selections": 1,
  "max_selections": 1,
  "choices": [
    { "label": "Mild", "price": 0 },
    { "label": "Hot", "price": 5 }
  ],
  "sort_order": 0,
  "is_available": true
}
```

---

## 8. Writes from Restaurant Admin (keep Super Admin compatible)

When Restaurant Admin saves:

1. **Same paths** under `/menus/{session.restaurantId}/…`  
2. **Both casings** for link/customization fields (`menuItemId`, `modifierIds`, `modifierConfig`, `priceDelta`, `maxQuantity`, …)  
3. **Never** write modifiers to global `/modifiers`  
4. Set `restaurant_id` on categories, items, and modifiers  
5. Scope all mutations with `rm.menu.manage`; read with `rm.menu.view`

### Permissions (from Super Admin Access Control)

| Code | Meaning |
|------|---------|
| `rm.menu.view` | See categories / products / customizations |
| `rm.menu.manage` | Create, edit, delete, toggle availability |

Deny writes if permission missing (UI + rely on RTDB rules).

---

## 9. Why details disappear — troubleshooting matrix

| Symptom in Restaurant Admin | Likely cause | Fix |
|-----------------------------|--------------|-----|
| No products at all | Wrong `restaurantId` / not reading `menus/{id}/items` | Use `restaurantUsers.{uid}.restaurant_id`; verify path in Firebase Console |
| Products show name/price only | UI not bound to description, image, prep, points, sale | Bind full item schema (§5A) |
| Variants/add-ons empty but exist in Firebase | Only reading `menu_item_id` | Normalize `menu_item_id \|\| menuItemId` |
| Modifiers empty | Reading `/modifiers` or not loading `menus/{id}/modifiers` | Switch to scoped path |
| Modifier assigned in Super Admin but not on product | Ignoring `modifier_ids` / `modifierIds` | Read both; join to modifiers list |
| Sale price / points missing | Only reading `price` | Also read `discount_price` / `points_value` (+ camelCase) |
| Image missing | Only checking `image_url` | Also accept `imageUrl` |
| Changes from Super Admin never appear | One-shot fetch, no live subscribe | Subscribe to all five menu nodes |
| Duplicate / conflicting menu screens | Local mock data + RTDB | Remove mocks; RTDB is source of truth |

### Verify in Firebase Console

After Super Admin edits a product, open:

```
menus/{restaurantId}/items/{itemId}
menus/{restaurantId}/variants   ← find entries with menuItemId / menu_item_id = itemId
menus/{restaurantId}/addons
menus/{restaurantId}/modifiers
```

If data is present in Firebase but not in Restaurant Admin UI → **client bug** (this handover).  
If data is missing in Firebase → fix Super Admin write or restaurant selection first.

---

## 10. Recommended Restaurant Admin UI parity

Match Super Admin’s information architecture so operators are not confused:

1. **Categories** — list / add / delete (rename optional)  
2. **Products** — searchable list grouped by category  
3. **Product detail** — core fields + availability + image + pricing  
4. **Per product** — Variants | Add-ons | Modifier assignment  
5. **Modifier groups** (restaurant-level) — create groups before assigning  

Minimum product list row:

- Image thumbnail  
- Name + description snippet  
- Price (+ sale badge)  
- Category  
- Availability badge  
- Counts: variants / add-ons / modifiers  

---

## 11. Acceptance checklist (Restaurant Admin)

- [ ] Menu loads from `/menus/{session.restaurantId}/` only (all five nodes)  
- [ ] Products show: name, description, category, price, sale price, points, prep time, image, availability  
- [ ] Variants appear when Super Admin created them (both `menu_item_id` and `menuItemId`)  
- [ ] Add-ons appear the same way  
- [ ] Modifier groups load from scoped path (not global `/modifiers`)  
- [ ] Assigned modifiers show from `modifier_ids` / `modifierIds` + config  
- [ ] List rows show customization counts  
- [ ] Writes dual-write snake_case + camelCase aliases  
- [ ] Permissions: `rm.menu.view` / `rm.menu.manage`  
- [ ] Live sync: Super Admin change appears in Restaurant Admin without hard refresh  
- [ ] No demo/mock products mixed into the live catalogue  

---

## 12. Copy-paste prompt for the Restaurant Admin AI

```
You are fixing the Restaurant Management (Restaurant Admin) Menu / Products module so it shows ALL details that ForkFleet Super Admin saves under Catalogue → Menus.

Read this handover fully:
docs/SUPER_ADMIN_TO_RESTAURANT_ADMIN_MENU_HANDOVER.md
(also MENU_PRODUCTS_MODIFIERS_HANDOVER.md if present)

## Shared source of truth
Firebase Realtime Database (NOT Firestore):
  menus/{restaurantId}/categories
  menus/{restaurantId}/items
  menus/{restaurantId}/variants
  menus/{restaurantId}/addons
  menus/{restaurantId}/modifiers

restaurantId = session.restaurantId from /restaurantUsers/{uid}.restaurant_id

## Bugs to fix
1. Products missing fields (description, image, sale price, prep, points, category, availability).
2. Variants/add-ons not showing — normalize menu_item_id OR menuItemId when joining.
3. Modifiers not showing — stop using global /modifiers; use menus/{restaurantId}/modifiers.
4. Assigned modifiers ignored — read modifier_ids OR modifierIds and modifier_config OR modifierConfig.
5. Only loading items node — must load all five menu children and live-subscribe.

## Required product UI
List + detail must show for each product:
- Core: name, description, category, price, discount_price, points_value, prep_time_minutes, image_url, is_available, allergens
- Counts: N variants · N add-ons · N modifiers
- Nested: full variants list, add-ons list, assigned modifier groups with choices/prices

## Writes
When saving, dual-write snake_case + camelCase (menuItemId, priceDelta, maxQuantity, modifierIds, modifierConfig, etc.) so Super Admin and Customer app stay compatible.

## Permissions
rm.menu.view (read), rm.menu.manage (write).

## Done when
Acceptance checklist in §11 of the handover doc is complete. Do not invent a second menu schema.
```

---

## 13. Source of truth in Super Admin repo

| File | Role |
|------|------|
| `src/lib/menus.firebase.ts` | Types, normalizers, CRUD, subscribe, join helpers |
| `src/routes/_authenticated/menus.tsx` | Super Admin Menu Management UI |
| `src/lib/restaurant-permissions.ts` | `rm.menu.view` / `rm.menu.manage` |

Treat `menus.firebase.ts` normalizers as the **reference implementation** for Restaurant Admin.

---

*Document version: 2026-08-24 · ForkFleet Super Admin → Restaurant Admin menu parity*
