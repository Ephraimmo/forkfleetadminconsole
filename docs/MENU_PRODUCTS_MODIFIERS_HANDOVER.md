# Handover: Menu Products — Variants, Add-ons & Modifiers (ForkFleet Super Admin)

This document explains how **products** display customization options in the ForkFleet Super Admin Console, what was fixed, and how the **Restaurant Management app (Orderly Hub)** should stay aligned. It complements:

- [MODIFIERS_SUPER_ADMIN_HANDOVER.md](https://github.com/Ephraimmo/orderlyhub/blob/main/docs/MODIFIERS_SUPER_ADMIN_HANDOVER.md) (Orderly Hub source spec)
- [SUPER_ADMIN_RESTAURANT_MANAGEMENT_HANDOVER.md](../SUPER_ADMIN_RESTAURANT_MANAGEMENT_HANDOVER.md) (platform integration)

---

## Summary

| Concern | Before | After (this repo) |
|--------|--------|-------------------|
| Variants / add-ons on product UI | Hidden when RTDB used `menuItemId` (camelCase) | **Normalized** — reads `menu_item_id` **or** `menuItemId` |
| Modifier groups | Not in Super Admin | **CRUD** at `/menus/{restaurantId}/modifiers/{id}` |
| Product detail panel | Name + price only in collapsed row | Counts + full detail block (prep, points, ID, allergens) |
| Modifier assignment | N/A | Per-product choice toggles → `modifier_ids` + `modifier_config` |
| Cross-app field names | snake_case only | Writes **both** snake_case and camelCase aliases on items |

---

## Three customization concepts (do not merge)

| Concept | Purpose | RTDB path | Linked to product via |
|---------|---------|-----------|------------------------|
| **Variant** | Size / version with price delta | `/menus/{restaurantId}/variants/{id}` | `menu_item_id` (or `menuItemId`) |
| **Add-on** | Optional paid extra for one product | `/menus/{restaurantId}/addons/{id}` | `menu_item_id` (or `menuItemId`) |
| **Modifier** | Shared choice group (e.g. “Spice level”) | `/menus/{restaurantId}/modifiers/{id}` | `modifier_ids` / `modifierIds` on item |

---

## Root cause: variants & add-ons “not showing”

Products in Firebase often store the product link as **`menuItemId`** (camelCase, Orderly Hub / legacy) while the Super Admin reader only matched **`menu_item_id`** (snake_case).

**Fix:** `normalizeMenuVariant()` and `normalizeMenuAddon()` in `src/lib/menus.firebase.ts`:

```typescript
menu_item_id: String(raw.menu_item_id ?? raw.menuItemId ?? "")
```

UI helpers:

```typescript
variantsForMenuItem(variants, item.id)
addonsForMenuItem(addons, item.id)
```

Always use these helpers — never filter with `v.menu_item_id === item.id` on raw RTDB objects.

---

## RTDB paths (Super Admin menu tree)

```
/menus/{restaurantId}/categories/{catId}
/menus/{restaurantId}/items/{itemId}
/menus/{restaurantId}/variants/{varId}
/menus/{restaurantId}/addons/{addonId}
/menus/{restaurantId}/modifiers/{modId}    ← NEW
```

**Legacy (do not write new data):** `/modifiers/{id}` — global, unscoped. Migrate to scoped path per Orderly Hub handover.

---

## Schemas

### Menu item (customization fields)

```json
{
  "id": "itm_abc123",
  "restaurant_id": "rst-nonna",
  "name": "Margherita Pizza",
  "price": 129,
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

### Variant / add-on (link field)

```json
{
  "id": "var_large",
  "menu_item_id": "itm_abc123",
  "menuItemId": "itm_abc123",
  "name": "Large",
  "price_delta": 25
}
```

---

## Super Admin UI (`/menus`)

**File:** `src/routes/_authenticated/menus.tsx`

### Left column

1. **Categories** — unchanged  
2. **Modifier groups** — create/list/delete groups for the selected restaurant  

### Products accordion (expand each product)

| Section | Shows |
|---------|--------|
| **Summary strip** | Category, description, prep time, points, item ID, allergens |
| **Collapsed row** | `{n} variants · {n} add-ons · {n} modifiers · {n} min prep` |
| **Variants** | All linked variants (+ price delta, default flag) + add form |
| **Add-ons** | All linked add-ons (+ price, max qty) + add form |
| **Modifier groups** | All restaurant groups; check choices to assign to product; optional per-choice price override |

### Permissions

Platform staff: `menus.view` / `menus.manage` (same as before).

---

## Source map (ForkFleet Console)

| File | Role |
|------|------|
| `src/lib/menus.firebase.ts` | Types, normalize*, CRUD, subscribe, `variantsForMenuItem`, `addonsForMenuItem`, `modifiersForMenuItem` |
| `src/routes/_authenticated/menus.tsx` | Menu UI — products, variants, add-ons, modifiers |
| `docs/KITCHEN_UI_RESTAURANT_MANAGEMENT_HANDOVER.md` | Kitchen queue (separate concern) |

---

## Restaurant Management app (Orderly Hub) alignment

Orderly Hub must:

1. **Read modifiers** from `/menus/{restaurantId}/modifiers` — not global `/modifiers`  
2. **Write modifiers** to the same scoped path with `restaurant_id` set  
3. **Products page** — use the same `modifier_ids` / `modifier_config` fields on items  
4. **Normalize** `menu_item_id` / `menuItemId` when listing variants and add-ons (see `menu-catalog.ts`)  
5. **Orders** — load scoped modifiers into `MenuCatalog.fromRtdb()` for line-item display  

See Orderly Hub: `docs/MODIFIERS_SUPER_ADMIN_HANDOVER.md` for full migration steps.

---

## Acceptance checklist

### Super Admin (this repo)

- [x] Modifier groups CRUD under `/menus/{restaurantId}/modifiers`
- [x] Product accordion shows variant / add-on / modifier counts on collapsed row
- [x] Variants and add-ons visible when Firebase uses `menuItemId`
- [x] Modifier assignment saves `modifier_ids` + `modifier_config` on item
- [x] Item writes include camelCase aliases (`modifierIds`, `modifierConfig`)
- [ ] Legacy `/modifiers` migrated to scoped path (operator one-time task)

### Restaurant Management app

- [ ] Modifiers page uses `menus/{restaurantId}/modifiers` only
- [ ] Products page lists variants, add-ons, and assigned modifier groups for each product
- [ ] Orders resolve modifier selections on line items
- [ ] Customer app snapshots modifier choices on order lines

---

## AI prompt — fix Product section in Restaurant Management app

```
You are updating the Products page in the Restaurant Management app (Orderly Hub) so it shows ALL product customization details and stays aligned with ForkFleet Super Admin.

Read docs/MODIFIERS_SUPER_ADMIN_HANDOVER.md and docs/MENU_PRODUCTS_MODIFIERS_HANDOVER.md (ForkFleet Console repo).

## Problems to fix
1. Variants and add-ons exist in Firebase but do not show — likely menu_item_id vs menuItemId mismatch. Normalize both when reading /menus/{restaurantId}/variants and /addons.
2. Modifier groups are at legacy /modifiers — migrate reads/writes to /menus/{restaurantId}/modifiers.
3. Product list/detail does not surface modifier_ids, modifier_config, variant count, or add-on count.

## Required UI (Products page)
For each product row or edit dialog, show:
- Base price, sale price, prep time, points, category, description, image(s)
- **Variants** linked via menu_item_id / menuItemId (name + price_delta)
- **Add-ons** linked the same way (name + price + max_quantity)
- **Modifier groups** assigned via modifier_ids — list group name and selected choices from modifier_config

Use MenuCatalog.fromRtdb({ items, variants, addons, modifiers }) for order resolution; same normalizers as Super Admin.

## Data paths (mandatory)
- items: menus/{restaurantId}/items
- variants: menus/{restaurantId}/variants
- addons: menus/{restaurantId}/addons
- modifiers: menus/{restaurantId}/modifiers  (NOT global /modifiers)

## Permissions
rm.menu.view (read), rm.menu.manage (write). Scope everything to session.restaurantId.

## Deliverables
1. Normalized variant/addon linking in product UI
2. Scoped modifier CRUD + product assignment
3. Product detail shows counts: N variants · N add-ons · N modifier groups
4. Brief migration note for legacy /modifiers nodes
```

---

## Using the Menus module

### Before you start

| Requirement | Detail |
|-------------|--------|
| **Route** | Super Admin → **Catalogue → Menus** (`/menus`) |
| **Permissions** | `menus.view` to browse; `menus.manage` to create, edit, or delete |
| **Restaurant scope** | Use the **restaurant picker** (top right). All categories, products, variants, add-ons, and modifier groups are scoped to the selected restaurant. The URL stores `?restaurant={id}` so you can bookmark a menu. |
| **Live sync** | Changes save to Firebase RTDB immediately and appear without a page refresh. |

If products look missing after opening Menus, check that the correct restaurant is selected — the picker auto-selects a restaurant with existing menu items when possible.

---

### Which customization type to use

| Need | Use | Example |
|------|-----|---------|
| Required size or version with a price change | **Variant** | Small / Medium / Large (+R 25 for Large) |
| Optional paid extra tied to one product | **Add-on** | Extra cheese (+R 15) |
| Shared choice group across many products | **Modifier group** | Spice level, cooking preference, portion size |

Do not combine these into one field. Variants and add-ons link via `menu_item_id`; modifiers link via `modifier_ids` on the product.

---

### Recommended setup order

1. **Categories** (left column) — group products (e.g. Pizzas, Drinks).  
2. **Products** — add base items with price, prep time, points, and image.  
3. **Modifier groups** (left column) — create reusable choice groups before assigning them.  
4. **Per product** (expand accordion) — add variants, add-ons, and assign modifier choices.

---

### Step-by-step

#### 1. Create modifier groups (left column)

1. Enter a **group name** (e.g. `Spice level`).  
2. Choose **type**:  
   - **Option** — required, single pick (min 1, max 1). Use for size, spice, doneness.  
   - **Extra** — optional, multi pick (up to 3). Use for toppings or add-on-style choices shared across products.  
3. Enter **choices** as comma-separated labels: `Mild, Medium, Hot`.  
4. Optionally check **Include pricing per choice** to set or override prices per choice when assigning to a product.  
5. Click **Add modifier group**. The group appears in the list and is available to all products for this restaurant.

To remove a group, use the trash icon. Deleting a group does not automatically remove its ID from product `modifier_ids` — re-open affected products and clear assignments if needed.

#### 2. Add and manage products

1. Use **Add a product** to create an item (name, category, price, optional sale price, points, prep time, description, image).  
2. In the **Products** accordion, click a row to expand it. The collapsed row shows:  
   `{n} variants · {n} add-ons · {n} modifiers · {n} min prep`  
3. Inside the expanded panel you can:  
   - Toggle **Available** on/off  
   - Update **Price**, **Sale price**, and **Points** → **Save pricing**  
   - Upload or change the product image (Cloudinary)

#### 3. Add variants (inside expanded product)

1. In the **Variants** column, enter a name (e.g. `Large`) and optional **price delta** (+R).  
2. Click **+** — the variant saves with `menu_item_id` set to this product (and `menuItemId` alias for cross-app compatibility).  
3. Confirm the collapsed row count increases and the variant appears in the list with `+R {delta}`.

Variants are product-specific. Use them when the customer must pick one size/version.

#### 4. Add add-ons (inside expanded product)

1. In the **Add-ons** column, enter a name (e.g. `Extra cheese`) and price.  
2. Click **+** — the add-on links to this product via `menu_item_id`.  
3. Confirm it appears with price and max quantity in the list.

Add-ons are optional extras for a single product. Use them when the extra does not need to be shared as a modifier group.

#### 5. Assign modifier groups (inside expanded product)

1. In the **Modifier groups** column, each restaurant group is listed with its choices.  
2. **Check** the choices that apply to this product — checking any choice assigns the group and saves immediately to Firebase.  
3. If **Include pricing** is enabled on the group, edit the price field next to a selected choice to override the default for this product only.  
4. **Uncheck** all choices in a group to remove that group from the product’s `modifier_ids`.

Assignment writes both `modifier_ids` / `modifierIds` and `modifier_config` / `modifierConfig` on the menu item.

---

### Verify in Firebase Console

After setup, confirm data under the selected restaurant:

```
/menus/{restaurantId}/items/{itemId}
  modifier_ids: ["mod_spice"]
  modifier_config.mod_spice.0: { selected: true, price: 0 }

/menus/{restaurantId}/variants/{varId}
  menu_item_id: "{itemId}"
  menuItemId: "{itemId}"    ← alias written for Orderly Hub

/menus/{restaurantId}/addons/{addonId}
  menu_item_id: "{itemId}"

/menus/{restaurantId}/modifiers/{modId}
  restaurant_id: "{restaurantId}"
  choices: [...]
```

Do **not** write new modifier data to legacy `/modifiers/{id}` — use the scoped path above.

---

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Variants or add-ons missing in UI but present in Firebase | Record uses `menuItemId` only | Already fixed in this repo via normalizers — ensure you are on current Super Admin build; do not filter raw RTDB with `menu_item_id` alone |
| Modifier groups empty on product | No groups created for restaurant | Add groups in the left column first |
| Counts show `0 variants` after adding one | Wrong restaurant selected | Switch restaurant picker; variant may be under another `restaurantId` |
| Changes not visible in Restaurant Management app | RM still reads legacy `/modifiers` or skips normalization | Align RM per [Orderly Hub handover](https://github.com/Ephraimmo/orderlyhub/blob/main/docs/MODIFIERS_SUPER_ADMIN_HANDOVER.md) |
| Product shows modifier group but customer app does not | Customer app not loading scoped modifiers | Ensure checkout loads `/menus/{restaurantId}/modifiers` into catalog |

---

### Operator quick reference

1. Menus → pick restaurant  
2. Left: categories + modifier groups  
3. Add products → expand accordion  
4. Variants / add-ons: add in product columns  
5. Modifiers: check choices per product  
6. Spot-check Firebase paths listed above  

---

*Document version: 2026-08-23 · ForkFleet Super Admin menus module*
