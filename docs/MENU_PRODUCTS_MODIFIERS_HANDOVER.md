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

## Operator quick start

1. **Super Admin** → Menus → select restaurant  
2. **Modifier groups** (left) → add e.g. “Spice level” with choices `Mild, Medium, Hot`  
3. **Products** → expand a product → check modifier choices → saves assignment  
4. **Variants / add-ons** → add under the product; confirm they appear immediately (expand accordion)  
5. Verify in Firebase Console:  
   - `/menus/{restaurantId}/variants/{id}.menu_item_id`  
   - `/menus/{restaurantId}/items/{id}.modifier_ids`  

---

*Document version: 2026-08-23 · ForkFleet Super Admin menus module*
