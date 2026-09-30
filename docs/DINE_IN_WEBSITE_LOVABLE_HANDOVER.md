# Handover: Hearth Dine-in — the table ordering website (for Lovable)

> **Audience:** Lovable AI, building a new website from scratch. The top section is for the person
> handing it over.
> **Source of truth:** the Hearth Admin console (`fleet-admin-hub-main`) —
> `docs/DINE_IN_TABLES_QR_HANDOVER.md`, `src/lib/table-sessions.firebase.ts`,
> `src/lib/waiter-requests.firebase.ts`, `firestore.rules`. Snapshot as of **2026-09-27**.
> The data-layer code in Parts 1–3 was run end to end against `firestore.rules` in the Firebase
> emulator (guest flows, and the writes the rules must refuse).

## How to use this document (for the person, not for Lovable)

**Before you start (once):**

1. **Deploy the Firestore rules** from the console repo: `firebase deploy --only firestore:rules`.
   Guests can't order until the rules in this repo's `firestore.rules` are live. Deploying
   replaces whatever rules are live now: first open Firebase console → Firestore → Rules and check
   nothing else depends on rules that aren't in this file (see "Known gaps" below).
2. **Turn on anonymous sign-in**: Firebase console → Authentication → Sign-in method →
   **Anonymous** → Enable. Guests are signed in silently; they never see a login screen.

**Building it:**

3. Create a new Lovable project. Paste **Part 1** as the first message and wait for Lovable's
   reply. Then paste **Part 2**, **Part 3** and **Part 4**, one message each, waiting for a reply
   in between. Each part is under 30 KB, so it fits in one message.
4. Publish the site in Lovable and copy its address, e.g. `https://hearth-dine-in.lovable.app`.

**Connecting it to the console:**

5. In the console: **Restaurants** → a restaurant → **Tables** tab → open any table's **QR code**
   → **Change link** → paste the address into **Customer app address** → **Save**. It applies
   to every table of every restaurant: each code now opens `<address>/dine-in/<code>`.
6. **Download or print the QR codes again.** A code already printed carries the old address.
   There's no need to regenerate the codes; their table codes don't change.

**Testing with two phones:** scan a table's code, order an item with a required choice, check it
appears under **Dine-in orders** as "Waiting for waiter confirmation", confirm it, and watch the
phone update. Then call a waiter, accept the call in the console, and check the phone shows "on the
way". Finally, press **Regenerate** on the table's QR code and check the phone says the code has
changed.

**Known gaps:**

- **Live Firestore rules.** `firestore.rules` in the console repo lets customers read neither
  restaurants nor orders, and write no orders, except through the dine-in guest pass. The Customer
  app handovers expect customers to do both. If the rules live in Firebase today differ from the
  file (for example, looser ones the delivery Customer app depends on), deploying the file will
  change that. Compare them before deploying.
- **Prices come from the guest's phone.** The rules check where and when a guest may order, but
  can't re-price items against the menu. The waiter's confirmation is the check: they see each
  line's price before confirming.
- **Starting a fresh seating.** The rules can't tell whether a seating has gone idle, so a guest
  holding the table's current code could start a new seating early. Their orders are unaffected,
  but the table's running bill on guests' phones restarts. Staff still see every order.
- **Multiple mode.** A guest at a multiple-mode table can read (not change) the other guests'
  orders at that table if they know an order's id. The site only ever shows their own.

---

# PART 1 of 4 — Project setup and the data layer (1 of 3)

We're building **Hearth Dine-in**: the website a restaurant guest opens by scanning the QR code on
their table. It shows that one restaurant's menu. The guest orders from their phone, follows the
order live, calls a waiter and sees the running bill. **Guests pay the waiter at the end, and the
site takes no payments.**

The site is the guest side of an existing system. The **Hearth Admin console** (a separate app)
manages restaurants, menus and tables, and prints the QR codes. It's also where waiters confirm
orders, the kitchen cooks them and waiters serve them. Both apps share one Firebase project
(Firestore and Auth). There is no other backend.

Parts 1–3 give you the **data layer**: ready-made TypeScript files that do every Firestore read and
write the site needs, already tested against the console's Firestore security rules. Create them
exactly as given. Part 4 describes the screens to build on top of them.

## Stack

- React, Vite, TypeScript, Tailwind CSS, shadcn/ui and React Router (your defaults), with `@/`
  resolving to `src/`.
- Add the npm package **`firebase`** at version **12**.
- **Don't** enable Lovable Cloud or Supabase, and don't add server code, sign-up or login screens,
  or a payment provider. Firebase is the only backend. Guests are signed in anonymously by the data
  layer and never see it.

## Rules for the whole project

1. **Every Firestore read and write goes through `@/lib/dine-in`.** Don't import
   `firebase/firestore` or `firebase/auth` anywhere else.
2. **Don't change `src/lib/firebase.ts` or anything in `src/lib/dine-in/`.** Their field names and
   the way they write are exactly what the console and the security rules expect, so even a
   "tidy-up" can stop ordering from working. If you need something they don't offer, build it in
   the UI from the functions they export.
3. **The table comes only from the QR code in the URL** (`/dine-in/:token`). Don't add a table
   picker, a restaurant picker, query parameters or a "change table" control.

## Files to create now

Create these three files with exactly this content.

### `src/lib/firebase.ts`

```ts
// Firebase for the dine-in website. This is the same Firebase project the
// Hearth Admin console, the kitchen and the waiters use, so everything the
// site writes shows up for staff straight away. These values are the
// project's public web config (safe to ship to the browser); access is
// controlled by the Firestore security rules, not by hiding them.

import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyBCTflur84nQjEc-YdsD_p2sR8eI7BD6nA",
  authDomain: "e-comm-bd997.firebaseapp.com",
  projectId: "e-comm-bd997",
  storageBucket: "e-comm-bd997.appspot.com",
  messagingSenderId: "280613901400",
  appId: "1:280613901400:web:bf168e55508b9102dda62d",
};

const app = getApps()[0] ?? initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
```

### `src/lib/dine-in/index.ts`

```ts
// The dine-in data layer. Import everything from "@/lib/dine-in".
export * from "./core";
export * from "./menu";
export * from "./orders";
```

### `src/lib/dine-in/core.ts`

```ts
// Dine-in data layer, part 1 of 3: basics, errors, signing the guest in,
// opening the table from its QR code, and the restaurant.
//
// The data belongs to the Hearth Admin console (repo fleet-admin-hub). These
// files follow its contract field for field: the console's waiter screens,
// kitchen board and table overview read exactly what is written here. Build
// the UI on the exports of "@/lib/dine-in", never call Firestore from
// anywhere else, and never rename a field.

import { signInAnonymously } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

/* ================================================================== basics */

export type OrderMode = "single" | "multiple";

export type DineInErrorCode =
  | "dine-in/invalid-code" // no such QR code
  | "dine-in/code-revoked" // the table's code was regenerated, or the guest scanned another table
  | "dine-in/table-inactive" // the table isn't taking orders
  | "dine-in/table-not-found"
  | "dine-in/invalid-items"
  | "dine-in/not-signed-in"
  | "dine-in/unavailable"; // network or Firebase trouble

/** Every error the data layer throws or reports. `message` is ready to show to the guest. */
export class DineInError extends Error {
  readonly code: DineInErrorCode;
  constructor(code: DineInErrorCode, message: string) {
    super(message);
    this.name = "DineInError";
    this.code = code;
  }
}

export const WAITING_FOR_WAITER = "waiting_for_waiter_confirmation";
/** A seating nobody has ordered in (or called a waiter from) for this long is over. */
export const SESSION_IDLE_TIMEOUT_MS = 3 * 60 * 60 * 1000;
export const SERVICE_FEE_RATE = 0.05;
export const MAX_ITEMS_PER_ORDER = 50;
export const MAX_QUANTITY = 99;
export const MAX_NOTE = 500;
export const MAX_NAME = 60;
export const MAX_WAITER_MESSAGE = 200;

// ---- Small helpers shared by the data-layer files (the UI doesn't need them).

export const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const QR_TOKEN = /^[A-Za-z0-9_-]{32}$/;
/** An order still takes new items only while it waits for the waiter. */
export const ADDABLE_STATUSES = [WAITING_FOR_WAITER, "pending"];

export type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
export const strOrNull = (v: unknown): string | null => str(v) || null;
export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const count = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
export const isMap = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
export const round2 = (n: number) => Math.round(n * 100) / 100;

export function randomId(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Date.now().toString(36)}${Array.from(bytes, (b) => (b % 36).toString(36)).join("")}`;
}

/** "FF-" plus six random digits, as the console numbers orders. */
export function newOrderNumber(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return `FF-${String(bytes[0]! % 1_000_000).padStart(6, "0")}`;
}

// ---- Public helpers.

export function resolveOrderMode(raw: unknown): OrderMode {
  return raw === "multiple" ? "multiple" : "single";
}

/** "12" -> "Table 12"; "Patio 3" stays as it is. */
export function tableDisplayName(label: string): string {
  const trimmed = label.trim();
  return /^\d+[a-z]?$/i.test(trimmed) ? `Table ${trimmed}` : trimmed;
}

/** R 129,00 — the restaurant's currency, South African formatting. */
export function formatMoney(amount: number, currency = "ZAR"): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: currency || "ZAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export const invalidCode = () =>
  new DineInError(
    "dine-in/invalid-code",
    "This code isn't valid. Please ask a member of staff for help.",
  );
export const revokedCode = () =>
  new DineInError(
    "dine-in/code-revoked",
    "This table's code has changed. Scan the QR code on your table again.",
  );

/** Turn anything Firebase throws into a DineInError the UI can show as is. */
export function toDineInError(e: unknown): DineInError {
  if (e instanceof DineInError) return e;
  const code = String((e as { code?: string } | null)?.code ?? "");
  if (code === "permission-denied" || code === "firestore/permission-denied") return revokedCode();
  if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") {
    // Anonymous sign-in is switched off in the Firebase project.
    console.error("[dine-in] Enable Anonymous sign-in in Firebase Authentication.", e);
    return new DineInError(
      "dine-in/unavailable",
      "Ordering from your phone isn't switched on yet. Please ask a member of staff.",
    );
  }
  if (code === "unauthenticated") {
    return new DineInError("dine-in/not-signed-in", "Please reload the page and try again.");
  }
  console.error("[dine-in]", e);
  return new DineInError(
    "dine-in/unavailable",
    "We can't reach the restaurant right now. Check your connection and try again.",
  );
}

export function currentUid(): string {
  const uid = auth.currentUser?.uid ?? "";
  if (!SAFE_ID.test(uid)) {
    throw new DineInError("dine-in/not-signed-in", "Please reload the page and try again.");
  }
  return uid;
}

/* ===================================================== sign-in and the table */

/**
 * Sign the guest in anonymously, or reuse the session this browser already
 * has. The uid is the guest's identity at the table ("Customer 2"), so a
 * reload must keep it: wait for Firebase to restore the session first.
 */
export async function signInGuest(): Promise<string> {
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser.uid;
  const { user } = await signInAnonymously(auth);
  return user.uid;
}

/** Where the guest is sitting — taken only from the scanned QR code. */
export interface TableContext {
  token: string;
  restaurant_id: string;
  table_id: string;
  /** As staff typed it: "12", "Patio 3". */
  table_label: string;
  /** How to show it: "Table 12", "Patio 3". */
  table_name: string;
  /** The table's mode. Once a seating is open its own mode applies (TableState.order_mode). */
  order_mode: OrderMode;
  active: boolean;
}

/**
 * Step 1 on /dine-in/:token. Signs the guest in, looks the code up, and saves
 * the guest's pass (dineInGuests/{uid}), which is what lets them read this
 * restaurant and table and order there. Throws DineInError "dine-in/invalid-code"
 * for an unknown code. An inactive table still opens (active: false), so the
 * menu can be shown without ordering.
 */
export async function openTable(token: string): Promise<TableContext> {
  if (!QR_TOKEN.test(token)) throw invalidCode();
  try {
    const uid = await signInGuest();
    const snap = await getDoc(doc(db, "tableQrTokens", token));
    if (!snap.exists()) throw invalidCode();
    const r = snap.data();
    const restaurant_id = str(r["restaurant_id"]);
    const table_id = str(r["table_id"]);
    if (!SAFE_ID.test(restaurant_id) || !SAFE_ID.test(table_id)) throw invalidCode();
    await setDoc(doc(db, "dineInGuests", uid), {
      token,
      restaurant_id,
      table_id,
      updated_at: new Date().toISOString(),
    });
    const label = str(r["table_label"]) || table_id;
    return {
      token,
      restaurant_id,
      table_id,
      table_label: label,
      table_name: tableDisplayName(label),
      order_mode: resolveOrderMode(r["order_mode"]),
      active: r["active"] !== false,
    };
  } catch (e) {
    throw toDineInError(e);
  }
}

/* ============================================================== restaurant */

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string | null;
  /** Cover photo. */
  image_url: string | null;
  currency: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  /** "08:00" / "22:00". */
  opens_at: string | null;
  closes_at: string | null;
}

/** The restaurant the guest is seated at (call after openTable). */
export async function getRestaurant(restaurantId: string): Promise<Restaurant> {
  try {
    const snap = await getDoc(doc(db, "restaurants", restaurantId));
    const r: Raw = snap.exists() ? snap.data() : {};
    return {
      id: restaurantId,
      name: str(r["name"]) || "Restaurant",
      cuisine: strOrNull(r["cuisine"]),
      image_url: strOrNull(r["image_url"]),
      currency: str(r["currency"]) || "ZAR",
      address: strOrNull(r["address"]),
      city: strOrNull(r["city"]),
      phone: strOrNull(r["phone"]),
      opens_at: strOrNull(r["opens_at"]),
      closes_at: strOrNull(r["closes_at"]),
    };
  } catch (e) {
    throw toDineInError(e);
  }
}
```

If this message ends here, create the three files and reply **"Ready for part 2"**. Don't build
any screens yet: `index.ts` imports two more files that arrive in Parts 2 and 3.

---

# PART 2 of 4 — The data layer (2 of 3): menu, options and pricing

Create `src/lib/dine-in/menu.ts` with exactly this content. It reads the restaurant's menu live and
prices lines exactly as the console does, so the waiter sees the same totals the guest saw.

### `src/lib/dine-in/menu.ts`

```ts
// Dine-in data layer, part 2 of 3: the menu (live), item options (sizes,
// modifier groups, add-ons), cart lines and pricing. Pricing matches the
// console exactly: the waiter sees the same totals the guest saw.

import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import {
  DineInError,
  MAX_ITEMS_PER_ORDER,
  MAX_NOTE,
  MAX_QUANTITY,
  SERVICE_FEE_RATE,
  isMap,
  num,
  round2,
  str,
  strOrNull,
  toDineInError,
  type Raw,
} from "./core";

/* ==================================================================== menu */

export interface MenuCategory {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_available: boolean;
}

export interface ModifierChoiceConfig {
  selected: boolean;
  price: number;
}

export interface MenuItem {
  id: string;
  category_id: string | null;
  /** Category name (older items only have this). */
  category: string;
  name: string;
  description: string | null;
  price: number;
  /** While set and lower than `price`, the item is on special at this price. */
  discount_price: number | null;
  image_url: string | null;
  allergens: string[];
  is_available: boolean;
  is_featured: boolean;
  prep_time_minutes: number;
  modifier_ids: string[];
  /** Per-item choice overrides: modifier id -> choice index -> { selected, price }. */
  modifier_config: Record<string, Record<string, ModifierChoiceConfig>>;
}

/** A size / version of an item, e.g. "Large" +R20. */
export interface MenuVariant {
  id: string;
  menu_item_id: string;
  name: string;
  price_delta: number;
  is_default: boolean;
  is_available: boolean;
  sort_order: number;
}

/** A paid extra for one item, e.g. "Extra cheese" R15, up to max_quantity. */
export interface MenuAddon {
  id: string;
  menu_item_id: string;
  name: string;
  price: number;
  max_quantity: number;
  is_available: boolean;
}

/** A shared choice group, e.g. "Cooking": Rare / Medium / Well done. */
export interface MenuModifier {
  id: string;
  name: string;
  type: "option" | "extra";
  required: boolean;
  include_pricing: boolean;
  min_selections: number;
  max_selections: number;
  choices: { label: string; price: number }[];
  sort_order: number;
  is_available: boolean;
}

export interface Menu {
  categories: MenuCategory[];
  items: MenuItem[];
  variants: MenuVariant[];
  addons: MenuAddon[];
  modifiers: MenuModifier[];
}

// Menu records come from two admin apps, so fields may be snake_case or camelCase.
const menuItemIdOf = (r: Raw) => str(r["menu_item_id"] ?? r["menuItemId"]);
const available = (r: Raw) =>
  r["is_available"] !== false && r["isAvailable"] !== false && r["available"] !== false;

function normalizeCategory(id: string, r: Raw): MenuCategory {
  return {
    id,
    name: str(r["name"]),
    description: strOrNull(r["description"]),
    sort_order: num(r["sort_order"]),
    is_available: r["is_available"] !== false,
  };
}

function normalizeItem(id: string, r: Raw): MenuItem {
  const discount = r["discount_price"] ?? r["discountPrice"];
  const ids = r["modifier_ids"] ?? r["modifierIds"];
  const cfg = r["modifier_config"] ?? r["modifierConfig"];
  const modifier_config: MenuItem["modifier_config"] = {};
  if (isMap(cfg)) {
    for (const [modId, choices] of Object.entries(cfg)) {
      if (!isMap(choices)) continue;
      const mapped: Record<string, ModifierChoiceConfig> = {};
      for (const [index, value] of Object.entries(choices)) {
        const v: Raw = isMap(value) ? value : {};
        mapped[index] = { selected: v["selected"] === true, price: num(v["price"]) };
      }
      modifier_config[modId] = mapped;
    }
  }
  const categoryId = r["category_id"] ?? r["categoryId"];
  return {
    id,
    category_id: categoryId != null && String(categoryId) !== "" ? String(categoryId) : null,
    category: str(r["category"]) || "General",
    name: str(r["name"]),
    description: strOrNull(r["description"]),
    price: num(r["price"]),
    discount_price: discount != null ? num(discount) : null,
    image_url: strOrNull(r["image_url"] ?? r["imageUrl"]),
    allergens: Array.isArray(r["allergens"])
      ? r["allergens"].filter((a: unknown): a is string => typeof a === "string")
      : [],
    is_available: available(r),
    is_featured: r["is_featured"] === true || r["isFeatured"] === true,
    prep_time_minutes: num(r["prep_time_minutes"] ?? r["prepTime"]) || 15,
    modifier_ids: Array.isArray(ids)
      ? ids.filter((v: unknown): v is string => typeof v === "string" && v !== "")
      : [],
    modifier_config,
  };
}

function normalizeVariant(id: string, r: Raw): MenuVariant {
  return {
    id,
    menu_item_id: menuItemIdOf(r),
    name: str(r["name"]),
    price_delta: num(r["price_delta"] ?? r["priceDelta"]),
    is_default: r["is_default"] === true || r["isDefault"] === true,
    is_available: available(r),
    sort_order: num(r["sort_order"] ?? r["sortOrder"]),
  };
}

function normalizeAddon(id: string, r: Raw): MenuAddon {
  return {
    id,
    menu_item_id: menuItemIdOf(r),
    name: str(r["name"]),
    price: num(r["price"]),
    max_quantity: Math.max(1, num(r["max_quantity"] ?? r["maxQuantity"] ?? 3) || 3),
    is_available: available(r),
  };
}

function normalizeModifier(id: string, r: Raw): MenuModifier {
  const type = r["type"] === "extra" ? "extra" : "option";
  return {
    id,
    name: str(r["name"]),
    type,
    required: r["required"] === true,
    include_pricing: r["include_pricing"] === true || r["includePricing"] === true,
    min_selections: num(r["min_selections"] ?? r["minSelections"] ?? (type === "option" ? 1 : 0)),
    max_selections: num(r["max_selections"] ?? r["maxSelections"] ?? (type === "option" ? 1 : 3)),
    choices: (Array.isArray(r["choices"]) ? r["choices"] : []).map((c: unknown) => {
      const row: Raw = isMap(c) ? c : {};
      return { label: str(row["label"]), price: num(row["price"]) };
    }),
    sort_order: num(r["sort_order"] ?? r["sortOrder"]),
    is_available: available(r),
  };
}

const MENU_PARTS = ["categories", "items", "variants", "addons", "modifiers"] as const;
type MenuPart = (typeof MENU_PARTS)[number];

/**
 * The restaurant's menu, live: price and availability changes made in the
 * console show up without a reload. Calls back once all five parts have
 * loaded, then on every change.
 */
export function watchMenu(
  restaurantId: string,
  onChange: (menu: Menu) => void,
  onError: (e: DineInError) => void,
): () => void {
  const loaded: Partial<Record<MenuPart, Raw[]>> = {};
  const emit = () => {
    const [categories, items, variants, addons, modifiers] = MENU_PARTS.map((p) => loaded[p]);
    if (!categories || !items || !variants || !addons || !modifiers) return;
    onChange({
      categories: categories
        .map((r) => normalizeCategory(r["__id"], r))
        .sort((a, b) => a.sort_order - b.sort_order),
      items: items.map((r) => normalizeItem(r["__id"], r)),
      variants: variants.map((r) => normalizeVariant(r["__id"], r)),
      addons: addons.map((r) => normalizeAddon(r["__id"], r)),
      modifiers: modifiers
        .map((r) => normalizeModifier(r["__id"], r))
        .sort((a, b) => a.sort_order - b.sort_order),
    });
  };
  const unsubs = MENU_PARTS.map((part) =>
    onSnapshot(
      collection(db, "menus", restaurantId, part),
      (snap) => {
        loaded[part] = snap.docs
          .filter((d) => d.id !== "_")
          .map((d) => ({ ...d.data(), __id: d.id }));
        emit();
      },
      (e) => onError(toDineInError(e)),
    ),
  );
  return () => unsubs.forEach((u) => u());
}

export interface MenuSection {
  key: string;
  name: string;
  description: string | null;
  /** Includes sold-out items (is_available false): show them greyed out, not orderable. */
  items: MenuItem[];
}

/** The menu grouped by category, in the restaurant's category order. Hidden categories are left out. */
export function menuSections(menu: Menu): MenuSection[] {
  const categories = new Map(menu.categories.map((c, rank) => [c.id, { ...c, rank }]));
  const sections = new Map<string, MenuSection & { rank: number }>();
  for (const item of menu.items) {
    if (!item.name) continue;
    const category = item.category_id ? categories.get(item.category_id) : undefined;
    if (category && !category.is_available) continue;
    const key = category ? category.id : `name:${item.category}`;
    const section = sections.get(key) ?? {
      key,
      name: category?.name || item.category || "Menu",
      description: category?.description ?? null,
      rank: category ? category.rank : 999,
      items: [],
    };
    section.items.push(item);
    sections.set(key, section);
  }
  return [...sections.values()]
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .map((s) => ({
      key: s.key,
      name: s.name,
      description: s.description,
      items: s.items.sort(
        (a, b) => Number(b.is_featured) - Number(a.is_featured) || a.name.localeCompare(b.name),
      ),
    }));
}

/** What one of an item costs: its special price while it has one, else its price. */
export function itemPrice(item: Pick<MenuItem, "price" | "discount_price">): number {
  const price = num(item.price);
  const discount = item.discount_price == null ? NaN : Number(item.discount_price);
  return round2(Number.isFinite(discount) && discount >= 0 && discount < price ? discount : price);
}

export interface ModifierChoiceOption {
  index: number;
  label: string;
  price: number;
}

export interface ModifierGroupOptions {
  group: MenuModifier;
  choices: ModifierChoiceOption[];
  /** Fewest choices the guest must pick (0 = optional). */
  min: number;
  /** Most choices the guest may pick; 1 = pick one (radio buttons). */
  max: number;
}

export interface ItemOptions {
  /** Sizes: pick exactly one when there are any. */
  variants: MenuVariant[];
  /** Extras with a quantity stepper (0..max_quantity). */
  addons: MenuAddon[];
  modifiers: ModifierGroupOptions[];
}

function maxChoices(group: Pick<MenuModifier, "max_selections">): number {
  return Math.max(1, Math.floor(num(group.max_selections) || 1));
}

/**
 * What the guest can choose for an item. A modifier group offers the choices
 * ticked for this item in the console (all of them when none are ticked), at
 * the item's price for that choice when the group is priced.
 */
export function itemOptions(menu: Menu, item: MenuItem): ItemOptions {
  const ids = new Set(item.modifier_ids);
  return {
    variants: menu.variants
      .filter((v) => v.menu_item_id === item.id && v.is_available)
      .sort((a, b) => a.sort_order - b.sort_order),
    addons: menu.addons.filter((a) => a.menu_item_id === item.id && a.is_available),
    modifiers: menu.modifiers
      .filter((group) => ids.has(group.id) && group.is_available)
      .map((group) => {
        const config = item.modifier_config[group.id] ?? {};
        const configured = Object.values(config).some((c) => c.selected);
        const choices = group.choices
          .map((choice, index) => ({ choice, index, cfg: config[String(index)] }))
          .filter(({ cfg }) => !configured || cfg?.selected === true)
          .map(({ choice, index, cfg }) => ({
            index,
            label: choice.label,
            price: group.include_pricing ? round2(num(cfg?.price ?? choice.price)) : 0,
          }));
        const max = maxChoices(group);
        const min = group.required
          ? Math.min(Math.max(1, Math.floor(num(group.min_selections))), max, choices.length)
          : 0;
        return { group, choices, min, max };
      })
      .filter((m) => m.choices.length > 0),
  };
}

/* ============================================================== cart lines */

export interface OrderLineVariant {
  id: string;
  name: string;
  price_delta: number;
}

/**
 * An extra on a line. A modifier choice has id "mod:{modifierId}:{choiceIndex}"
 * and name "{Group}: {Choice}" (e.g. "Cooking: Medium"), and its quantity
 * follows the line's. A plain add-on keeps its own id and quantity.
 */
export interface OrderLineAddon {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

/** One line in the guest's cart, exactly as it is sent. */
export interface CartItem {
  item_id: string;
  name: string;
  quantity: number;
  /** The item's price (its special price when on special), without size or extras. */
  unit_price: number;
  notes: string | null;
  variant: OrderLineVariant | null;
  addons: OrderLineAddon[];
}

const MODIFIER_ADDON = /^mod:([^:]+):(\d+)$/;

export function modifierAddonId(modifierId: string, choiceIndex: number): string {
  return `mod:${modifierId}:${choiceIndex}`;
}

function modifierIdOf(addon: Pick<OrderLineAddon, "id">): string | null {
  return MODIFIER_ADDON.exec(addon.id)?.[1] ?? null;
}

/** A new cart line for an item: quantity 1, its default size, nothing else picked. */
export function newCartItem(menu: Menu, item: MenuItem): CartItem {
  const sizes = itemOptions(menu, item).variants;
  const size = sizes.find((v) => v.is_default) ?? sizes[0];
  return {
    item_id: item.id,
    name: item.name,
    quantity: 1,
    unit_price: itemPrice(item),
    notes: null,
    variant: size ? { id: size.id, name: size.name, price_delta: size.price_delta } : null,
    addons: [],
  };
}

export function withVariant(line: CartItem, variant: MenuVariant): CartItem {
  return {
    ...line,
    variant: { id: variant.id, name: variant.name, price_delta: variant.price_delta },
  };
}

/**
 * Pick or unpick a modifier choice. In a pick-one group a new pick replaces
 * the old one; a group already at its maximum ignores further picks.
 */
export function toggleChoice(
  line: CartItem,
  group: Pick<MenuModifier, "id" | "name" | "max_selections">,
  choice: ModifierChoiceOption,
): CartItem {
  const id = modifierAddonId(group.id, choice.index);
  if (line.addons.some((a) => a.id === id)) {
    return { ...line, addons: line.addons.filter((a) => a.id !== id) };
  }
  const inGroup = (a: OrderLineAddon) => modifierIdOf(a) === group.id;
  const max = maxChoices(group);
  let addons = line.addons;
  if (max === 1) addons = addons.filter((a) => !inGroup(a));
  else if (addons.filter(inGroup).length >= max) return line;
  return {
    ...line,
    addons: [
      ...addons,
      { id, name: `${group.name}: ${choice.label}`, price: choice.price, quantity: line.quantity },
    ],
  };
}

export function isChoicePicked(line: CartItem, groupId: string, choiceIndex: number): boolean {
  return line.addons.some((a) => a.id === modifierAddonId(groupId, choiceIndex));
}

/** Set how many of a plain add-on the line has (0 removes it). */
export function setAddonQuantity(line: CartItem, addon: MenuAddon, quantity: number): CartItem {
  const qty = Math.max(0, Math.min(addon.max_quantity, Math.floor(quantity)));
  const rest = line.addons.filter((a) => a.id !== addon.id);
  if (qty === 0) return { ...line, addons: rest };
  const next = { id: addon.id, name: addon.name, price: round2(addon.price), quantity: qty };
  const at = line.addons.findIndex((a) => a.id === addon.id);
  return {
    ...line,
    addons:
      at === -1 ? [...line.addons, next] : line.addons.map((a) => (a.id === addon.id ? next : a)),
  };
}

export function addonQuantity(line: CartItem, addonId: string): number {
  return line.addons.find((a) => a.id === addonId)?.quantity ?? 0;
}

/** Change the line's quantity (1..99); its modifier choices follow it. */
export function withQuantity(line: CartItem, quantity: number): CartItem {
  const qty = Math.max(1, Math.min(MAX_QUANTITY, Math.floor(quantity)));
  return {
    ...line,
    quantity: qty,
    addons: line.addons.map((a) => (modifierIdOf(a) ? { ...a, quantity: qty } : a)),
  };
}

/** Required groups the guest hasn't picked enough from yet. Empty = ready to add. */
export function missingChoices(options: ItemOptions, line: CartItem): ModifierGroupOptions[] {
  return options.modifiers.filter(
    (m) => m.min > 0 && line.addons.filter((a) => modifierIdOf(a) === m.group.id).length < m.min,
  );
}

/** Line total: unit_price × qty + Σ(addon.price × addon.qty) + size delta × qty. */
export function lineTotal(
  line: Pick<CartItem, "unit_price" | "quantity" | "variant" | "addons">,
): number {
  const addons = (line.addons ?? []).reduce((sum, a) => sum + a.price * a.quantity, 0);
  const sizeDelta = (line.variant?.price_delta ?? 0) * line.quantity;
  return round2(line.unit_price * line.quantity + addons + sizeDelta);
}

export interface Totals {
  subtotal: number;
  /** 5% of the subtotal. */
  service_fee: number;
  total: number;
}

export function priceLines(
  lines: { line_total: number }[],
  extras: { delivery_fee: number; tax: number; tip: number; discount: number } = {
    delivery_fee: 0,
    tax: 0,
    tip: 0,
    discount: 0,
  },
): Totals {
  const subtotal = round2(lines.reduce((sum, l) => sum + (Number(l.line_total) || 0), 0));
  const service_fee = round2(subtotal * SERVICE_FEE_RATE);
  const total = round2(
    subtotal + extras.delivery_fee + service_fee + extras.tax + extras.tip - extras.discount,
  );
  return { subtotal, service_fee, total };
}

/** Totals for the cart before it's sent. */
export function cartTotals(cart: CartItem[]): Totals {
  return priceLines(cart.map((l) => ({ line_total: lineTotal(l) })));
}

/** A line's size and extras as short labels: ["Large", "Cooking: Rare", "Extra cheese ×2"]. */
export function describeLineOptions(line: {
  variant?: OrderLineVariant | null;
  addons?: OrderLineAddon[] | null;
}): string[] {
  return [
    ...(line.variant?.name ? [line.variant.name] : []),
    ...(line.addons ?? []).map((a) =>
      modifierIdOf(a) || a.quantity <= 1 ? a.name : `${a.name} ×${a.quantity}`,
    ),
  ];
}

/** Check a cart before it's sent (placeOrder does this for you). */
export function validateItems(items: CartItem[]): CartItem[] {
  const bad = (message: string) => new DineInError("dine-in/invalid-items", message);
  if (!Array.isArray(items) || items.length === 0) {
    throw bad("Add at least one item to your order.");
  }
  if (items.length > MAX_ITEMS_PER_ORDER) {
    throw bad(`You can send at most ${MAX_ITEMS_PER_ORDER} items at a time.`);
  }
  return items.map((item) => {
    const name = str(item.name);
    if (!name || name.length > 120) throw bad("Every item needs a name.");
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) {
      throw bad(`Quantity for ${name} must be 1–${MAX_QUANTITY}.`);
    }
    if (!Number.isFinite(item.unit_price) || item.unit_price < 0) {
      throw bad(`${name} has an invalid price.`);
    }
    if (item.variant && !Number.isFinite(item.variant.price_delta)) {
      throw bad(`${name} has an invalid size.`);
    }
    for (const addon of item.addons ?? []) {
      if (
        !Number.isFinite(addon.price) ||
        addon.price < 0 ||
        !Number.isInteger(addon.quantity) ||
        addon.quantity < 1
      ) {
        throw bad(`${name} has an invalid extra.`);
      }
    }
    return {
      item_id: str(item.item_id),
      name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      notes: str(item.notes).slice(0, MAX_NOTE) || null,
      variant: item.variant ?? null,
      addons: item.addons ?? [],
    };
  });
}
```

If this message ends here, create the file and reply **"Ready for part 3"**. Don't build any
screens yet.

---

# PART 3 of 4 — The data layer (3 of 3): ordering, the bill and waiter calls

Create `src/lib/dine-in/orders.ts` with exactly this content. It places orders and waiter calls,
each as one Firestore transaction, and follows orders, the bill and waiter calls live.

### `src/lib/dine-in/orders.ts`

```ts
// Dine-in data layer, part 3 of 3: the seating at the table, placing orders,
// following them, the running bill, and calling a waiter.
//
// Placing an order and calling a waiter each run as one Firestore
// transaction that reads the table and writes the order (or call) and the
// table's seating together, so guests at the same table never clash. The
// Firestore security rules check every write field by field; change nothing.

import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  type DocumentData,
  type Transaction,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import {
  ADDABLE_STATUSES,
  DineInError,
  MAX_NAME,
  MAX_NOTE,
  MAX_WAITER_MESSAGE,
  SAFE_ID,
  SESSION_IDLE_TIMEOUT_MS,
  WAITING_FOR_WAITER,
  count,
  currentUid,
  isMap,
  newOrderNumber,
  num,
  randomId,
  resolveOrderMode,
  revokedCode,
  round2,
  str,
  strOrNull,
  tableDisplayName,
  toDineInError,
  type OrderMode,
  type Raw,
  type TableContext,
} from "./core";
import {
  lineTotal,
  priceLines,
  validateItems,
  type CartItem,
  type OrderLineAddon,
  type OrderLineVariant,
} from "./menu";

/* ============================================================ the seating */

export interface Seat {
  /** "Customer 2", or the name the guest gave. */
  label: string;
  joined_at: string;
  current_order_id: string | null;
  order_count: number;
  /** The guest's latest waiter call — watch it with watchWaiterCall(). */
  waiter_request_id: string | null;
}

export interface Seating {
  id: string;
  opened_at: string;
  last_activity_at: string;
  order_mode: OrderMode;
  current_order_id: string | null;
  order_count: number;
  order_ids: string[];
  guests: Record<string, Seat>;
}

export interface TableState {
  label: string;
  name: string;
  active: boolean;
  /** The mode that applies now: the open seating's, else the table's. */
  order_mode: OrderMode;
  /** The party at the table now. null when the table is free, was cleared, or went idle. */
  seating: Seating | null;
  /** This guest's seat in it. null until they order or call a waiter. */
  my_seat: Seat | null;
}

function isIdle(session: Raw, now: number): boolean {
  const last = Date.parse(str(session["last_activity_at"]) || str(session["opened_at"]));
  return !Number.isFinite(last) || now - last > SESSION_IDLE_TIMEOUT_MS;
}

function isOpenSeating(session: unknown, now: number): session is Raw {
  return (
    isMap(session) &&
    !!str(session["id"]) &&
    !!str(session["opened_at"]) &&
    isMap(session["guests"]) &&
    !isIdle(session, now)
  );
}

function normalizeSeat(raw: Raw, fallbackTime: string): Seat {
  return {
    label: str(raw["label"]) || "Guest",
    joined_at: str(raw["joined_at"]) || fallbackTime,
    current_order_id: strOrNull(raw["current_order_id"]),
    order_count: count(raw["order_count"]),
    waiter_request_id: strOrNull(raw["waiter_request_id"]),
  };
}

function toTableState(raw: Raw, uid: string | null, now = Date.now()): TableState {
  const label = str(raw["label"]);
  const session = raw["session"];
  let seating: Seating | null = null;
  if (isOpenSeating(session, now)) {
    const opened = str(session["opened_at"]);
    const guests: Record<string, Seat> = {};
    for (const [id, g] of Object.entries(session["guests"] as Raw)) {
      if (isMap(g)) guests[id] = normalizeSeat(g, opened);
    }
    seating = {
      id: str(session["id"]),
      opened_at: opened,
      last_activity_at: str(session["last_activity_at"]) || opened,
      order_mode: resolveOrderMode(session["order_mode"]),
      current_order_id: strOrNull(session["current_order_id"]),
      order_count: count(session["order_count"]),
      order_ids: Array.isArray(session["order_ids"])
        ? session["order_ids"].filter((v: unknown): v is string => typeof v === "string" && v !== "")
        : [],
      guests,
    };
  }
  return {
    label,
    name: tableDisplayName(label),
    active: raw["active"] !== false,
    order_mode: seating ? seating.order_mode : resolveOrderMode(raw["order_mode"]),
    seating,
    my_seat: seating && uid ? (seating.guests[uid] ?? null) : null,
  };
}

const tableGone = () =>
  new DineInError(
    "dine-in/table-not-found",
    "This table no longer exists. Please ask a member of staff.",
  );

/** The guest's table, live: the seating, their seat, whether it's taking orders. */
export function watchTable(
  table: TableContext,
  onChange: (state: TableState) => void,
  onError: (e: DineInError) => void,
): () => void {
  return onSnapshot(
    doc(db, "restaurants", table.restaurant_id, "tables", table.table_id),
    (snap) => {
      if (!snap.exists()) return onError(tableGone());
      onChange(toTableState(snap.data(), auth.currentUser?.uid ?? null));
    },
    (e) => onError(toDineInError(e)),
  );
}

/**
 * The seating the guest joins right now, and their seat in it. Works on the
 * stored seating as read, changing only this guest's seat and the seating's
 * own counters, so every other guest's seat is written back exactly as it was
 * (the security rules check this). A table with no seating, or one that has
 * gone idle, starts a new seating in the table's mode.
 */
function joinSeating(rawTable: Raw, uid: string, name: string | null, now: number) {
  const ts = new Date(now).toISOString();
  const stored = rawTable["session"];
  const session: Raw = isOpenSeating(stored, now)
    ? structuredClone(stored)
    : {
        id: randomId("ses"),
        opened_at: ts,
        last_activity_at: ts,
        order_mode: resolveOrderMode(rawTable["order_mode"]),
        current_order_id: null,
        order_count: 0,
        order_ids: [],
        guests: {},
      };
  if (!Array.isArray(session["order_ids"])) session["order_ids"] = [];
  session["order_count"] = count(session["order_count"]);
  const guests = session["guests"] as Raw;
  const existing = guests[uid];
  const seat: Raw = isMap(existing)
    ? { ...existing, ...normalizeSeat(existing, ts) }
    : {
        label: name ?? `Customer ${Object.keys(guests).length + 1}`,
        joined_at: ts,
        current_order_id: null,
        order_count: 0,
        waiter_request_id: null,
      };
  return { session, seat, mode: resolveOrderMode(session["order_mode"]) };
}

/**
 * Read the guest's table inside a transaction and check it can take them: the
 * scanned code must still be the table's current one, and the table active.
 */
async function readActiveTable(tx: Transaction, table: TableContext): Promise<Raw> {
  const token = await tx.get(doc(db, "tableQrTokens", table.token));
  if (!token.exists() || str(token.data()["table_id"]) !== table.table_id) throw revokedCode();
  const snap = await tx.get(doc(db, "restaurants", table.restaurant_id, "tables", table.table_id));
  if (!snap.exists()) throw tableGone();
  const raw = snap.data();
  if (str(raw["qr_token"]) !== table.token) throw revokedCode();
  if (raw["active"] === false) {
    const name = tableDisplayName(str(raw["label"]) || table.table_label);
    throw new DineInError(
      "dine-in/table-inactive",
      `${name} isn't taking orders right now. Please ask a member of staff.`,
    );
  }
  return raw;
}

/* ========================================================== placing orders */

export interface PlaceOrderResult {
  order_id: string;
  order_number: string;
  /** true when a new order was started, false when the items joined one still waiting for the waiter. */
  created: boolean;
  session_id: string;
  guest_label: string;
  round: number;
}

/**
 * Send the cart to the waiter. Depending on the seating's mode the items join
 * an order that is still waiting for the waiter, or start a new one:
 *   single   – the whole table shares one order while it waits; once the waiter
 *              confirms it, the next items start the table's next order.
 *   multiple – the guest's own order while it waits, else a new one of theirs.
 * Every order waits for a waiter to confirm it before the kitchen sees it.
 */
export async function placeOrder(input: {
  table: TableContext;
  items: CartItem[];
  /** Optional first name. Used only the first time the guest joins the seating; otherwise "Customer N". */
  guestName?: string | null;
  /** For the whole order, e.g. "We're sharing the starters". */
  specialInstructions?: string | null;
}): Promise<PlaceOrderResult> {
  const uid = currentUid();
  const name = str(input.guestName).slice(0, MAX_NAME) || null;
  const items = validateItems(input.items);
  const instructions = str(input.specialInstructions).slice(0, MAX_NOTE) || null;
  const { restaurant_id, table_id } = input.table;
  try {
    // Display-only restaurant fields, read once outside the transaction.
    const restaurant = await getDoc(doc(db, "restaurants", restaurant_id));
    const restaurantName = str(restaurant.data()?.["name"]) || "Restaurant";
    const restaurantImage = strOrNull(restaurant.data()?.["image_url"]);

    return await runTransaction(db, async (tx) => {
      // ---- Reads (Firestore needs every read before the first write) ----
      const rawTable = await readActiveTable(tx, input.table);
      const now = Date.now();
      const ts = new Date(now).toISOString();
      const { session, seat, mode } = joinSeating(rawTable, uid, name, now);

      const candidateId = strOrNull(
        mode === "single" ? session["current_order_id"] : seat["current_order_id"],
      );
      const candidateSnap =
        candidateId && SAFE_ID.test(candidateId)
          ? await tx.get(doc(db, "orders", candidateId))
          : null;
      const candidate = candidateSnap?.exists() ? candidateSnap.data() : null;
      const target =
        candidate &&
        candidate["order_type"] === "dine_in" &&
        isMap(candidate["dine_in"]) &&
        candidate["restaurant_id"] === restaurant_id &&
        candidate["dine_in"]["table_id"] === table_id &&
        candidate["dine_in"]["table_session_id"] === session["id"] &&
        ADDABLE_STATUSES.includes(candidate["status"]) &&
        (mode === "single" || candidate["dine_in"]["guest_id"] === uid)
          ? candidate
          : null;

      // ---- Writes ----
      const label = str(seat["label"]);
      const lines = buildLines(items, { guest_id: uid, label }, ts);
      const added = items.reduce((sum, i) => sum + i.quantity, 0);
      let result: PlaceOrderResult;

      if (target && candidateId) {
        const price = priceLines(
          [...Object.values(target["items"] ?? {}), ...Object.values(lines)] as {
            line_total: number;
          }[],
          {
            delivery_fee: num(target["delivery_fee"]),
            tax: num(target["tax"]),
            tip: num(target["tip"]),
            discount: num(target["discount"]),
          },
        );
        const existing = target["dine_in"]["contributors"]?.[uid];
        const event = timelineEvent("note", `${label} added ${describeItems(items)}`, label, ts);
        const patch: Raw = {
          ...price,
          updated_at: ts,
          [`timeline.${event.id}`]: event,
          [`dine_in.contributors.${uid}`]: {
            label,
            first_added_at: str(existing?.["first_added_at"]) || ts,
            item_count: count(existing?.["item_count"]) + added,
          },
        };
        for (const [id, line] of Object.entries(lines)) patch[`items.${id}`] = line;
        if (instructions) {
          patch["special_instructions"] = [
            str(target["special_instructions"]),
            `${label}: ${instructions}`,
          ]
            .filter(Boolean)
            .join("\n");
        }
        tx.update(doc(db, "orders", candidateId), patch);
        result = {
          order_id: candidateId,
          order_number: str(target["order_number"]),
          created: false,
          session_id: session["id"],
          guest_label: label,
          round: count(target["dine_in"]["round"]) || 1,
        };
      } else {
        const round = (mode === "single" ? session["order_count"] : count(seat["order_count"])) + 1;
        const order = newDineInOrder({
          table: {
            id: table_id,
            restaurant_id,
            label: str(rawTable["label"]) || input.table.table_label,
          },
          sessionId: session["id"],
          mode,
          uid,
          label,
          round,
          lines,
          added,
          instructions,
          restaurantName,
          restaurantImage,
          at: ts,
        });
        tx.set(doc(db, "orders", order.id), order);
        session["order_count"] += 1;
        session["order_ids"] = [...session["order_ids"], order.id];
        seat["order_count"] = count(seat["order_count"]) + 1;
        if (mode === "single") session["current_order_id"] = order.id;
        else seat["current_order_id"] = order.id;
        result = {
          order_id: order.id,
          order_number: order.order_number,
          created: true,
          session_id: session["id"],
          guest_label: label,
          round,
        };
      }

      session["guests"][uid] = seat;
      session["last_activity_at"] = ts;
      tx.update(doc(db, "restaurants", restaurant_id, "tables", table_id), { session });
      return result;
    });
  } catch (e) {
    throw toDineInError(e);
  }
}

function buildLines(
  items: CartItem[],
  addedBy: { guest_id: string; label: string },
  at: string,
): Raw {
  const lines: Raw = {};
  for (const item of items) {
    const id = randomId("ln");
    lines[id] = {
      id,
      item_id: item.item_id || id,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: lineTotal(item),
      notes: item.notes,
      variant: item.variant,
      addons: item.addons,
      added_by: addedBy,
      added_at: at,
    };
  }
  return lines;
}

function describeItems(items: CartItem[]): string {
  return items.map((i) => `${i.name} ×${i.quantity}`).join(", ");
}

function timelineEvent(status: string, note: string, actor: string, at: string) {
  return { id: randomId("tl"), status, at, note, actor };
}

/** A new dine-in order record, field for field as the console writes one. */
function newDineInOrder(input: {
  table: { id: string; restaurant_id: string; label: string };
  sessionId: string;
  mode: OrderMode;
  uid: string;
  label: string;
  round: number;
  lines: Raw;
  added: number;
  instructions: string | null;
  restaurantName: string;
  restaurantImage: string | null;
  at: string;
}) {
  const { table, mode, uid, label, at } = input;
  const perGuest = mode === "multiple";
  const tableName = tableDisplayName(table.label);
  const price = priceLines(Object.values(input.lines));
  const placed = timelineEvent("placed", `Ordered at ${tableName} by ${label}`, label, at);
  return {
    id: randomId("ord"),
    order_number: newOrderNumber(),
    // Out of the kitchen until a waiter confirms it.
    status: WAITING_FOR_WAITER,
    order_type: "dine_in",
    placed_at: at,
    accepted_at: null,
    ready_at: null,
    driver_status: null,
    assigned_at: null,
    arrived_at_restaurant: null,
    picked_up_at: null,
    on_the_way_at: null,
    arrived_at_customer: null,
    delivered_at: null,
    cancelled_at: null,
    eta_minutes: null,
    eta_at: null,
    ...price,
    delivery_fee: 0,
    tax: 0,
    discount: 0,
    tip: 0,
    coupon_code: null,
    // Guests pay the waiter at the end; staff settle payment in the console.
    payment_method: "card",
    payment_status: "pending",
    delivery_address: null,
    special_instructions: input.instructions ? `${label}: ${input.instructions}` : null,
    scheduled_for: null,
    restaurant_id: table.restaurant_id,
    restaurant_name: input.restaurantName,
    restaurant_image: input.restaurantImage,
    branch_id: null,
    branch_name: null,
    // A multiple-mode order is one guest's; a single-mode order is the table's.
    customer_id: null,
    customer_name: perGuest ? label : tableName,
    customer_phone: null,
    customer_email: null,
    driver_id: null,
    driver_name: null,
    driver_phone: null,
    driver_photo: null,
    driver_rating: null,
    rejection_reason: null,
    rejected_by: null,
    rejected_at: null,
    created_at: at,
    updated_at: at,
    dine_in: {
      table_id: table.id,
      table_label: table.label,
      order_mode: mode,
      table_session_id: input.sessionId,
      guest_id: uid,
      guest_label: label,
      round: input.round,
      contributors: { [uid]: { label, first_added_at: at, item_count: input.added } },
      waiter_id: null,
      waiter_name: null,
      confirmed_at: null,
      confirmed_by: null,
    },
    items: input.lines,
    timeline: { [placed.id]: placed },
  };
}

/* ============================================================ order status */

/** Where an order is, for a progress bar. */
export const ORDER_STEPS = [
  "Waiting for the waiter",
  "Confirmed",
  "Sent to the kitchen",
  "Being prepared",
  "Ready",
  "Served",
] as const;

const STATUS: Record<string, { label: string; step: number }> = {
  waiting_for_waiter_confirmation: { label: "Waiting for the waiter to confirm", step: 0 },
  pending: { label: "Waiting for the waiter to confirm", step: 0 },
  waiter_confirmed: { label: "Confirmed by your waiter", step: 1 },
  accepted: { label: "Sent to the kitchen", step: 2 },
  preparing: { label: "Being prepared", step: 3 },
  ready: { label: "Ready — on its way to you", step: 4 },
  delivered: { label: "Served", step: 5 },
  rejected: { label: "Not accepted", step: -1 },
  cancelled: { label: "Cancelled", step: -1 },
  refunded: { label: "Refunded", step: -1 },
};

export interface GuestOrderLine extends CartItem {
  id: string;
  line_total: number;
  /** Who added it: "Customer 2", or null for a line the waiter added. */
  added_by_label: string | null;
  added_at: string | null;
  /** This guest added it. */
  mine: boolean;
}

export interface GuestOrder {
  id: string;
  /** "FF-123456" — what staff call the order. */
  order_number: string;
  status: string;
  status_label: string;
  /** Index into ORDER_STEPS, or -1 when rejected / cancelled / refunded. */
  step: number;
  /** The guest's next items still join this order. */
  open_for_additions: boolean;
  /** The table's (single) or the guest's (multiple) nth order this seating. */
  round: number;
  order_mode: OrderMode;
  table_session_id: string;
  guest_id: string;
  guest_label: string;
  /** Multiple mode: this guest's own order. Single mode: this guest started it. */
  mine: boolean;
  lines: GuestOrderLine[];
  subtotal: number;
  service_fee: number;
  total: number;
  special_instructions: string | null;
  rejection_reason: string | null;
  placed_at: string;
  updated_at: string;
}

function toGuestOrder(id: string, r: Raw, uid: string | null): GuestOrder {
  const d: Raw = isMap(r["dine_in"]) ? r["dine_in"] : {};
  const status = str(r["status"]);
  const known = STATUS[status] ?? { label: status.replace(/_/g, " "), step: -1 };
  const lines: GuestOrderLine[] = Object.values(isMap(r["items"]) ? r["items"] : {})
    .filter(isMap)
    .map((l) => ({
      id: str(l["id"]),
      item_id: str(l["item_id"]),
      name: str(l["name"]),
      quantity: count(l["quantity"]),
      unit_price: num(l["unit_price"]),
      line_total: num(l["line_total"]),
      notes: strOrNull(l["notes"]),
      variant: isMap(l["variant"]) ? (l["variant"] as OrderLineVariant) : null,
      addons: Array.isArray(l["addons"]) ? (l["addons"] as OrderLineAddon[]) : [],
      added_by_label: isMap(l["added_by"]) ? str(l["added_by"]["label"]) || null : null,
      added_at: strOrNull(l["added_at"]),
      mine: isMap(l["added_by"]) && l["added_by"]["guest_id"] === uid,
    }))
    .sort((a, b) => (a.added_at ?? "").localeCompare(b.added_at ?? ""));
  return {
    id,
    order_number: str(r["order_number"]),
    status,
    status_label: known.label,
    step: known.step,
    open_for_additions: ADDABLE_STATUSES.includes(status),
    round: count(d["round"]) || 1,
    order_mode: resolveOrderMode(d["order_mode"]),
    table_session_id: str(d["table_session_id"]),
    guest_id: str(d["guest_id"]),
    guest_label: str(d["guest_label"]),
    mine: d["guest_id"] === uid,
    lines,
    subtotal: num(r["subtotal"]),
    service_fee: num(r["service_fee"]),
    total: num(r["total"]),
    special_instructions: strOrNull(r["special_instructions"]),
    rejection_reason: strOrNull(r["rejection_reason"]),
    placed_at: str(r["placed_at"]),
    updated_at: str(r["updated_at"]),
  };
}

/** One order, live. Calls back with null if it disappears. */
export function watchOrder(
  orderId: string,
  onChange: (order: GuestOrder | null) => void,
  onError: (e: DineInError) => void,
): () => void {
  return onSnapshot(
    doc(db, "orders", orderId),
    (snap) =>
      onChange(
        snap.exists() ? toGuestOrder(snap.id, snap.data(), auth.currentUser?.uid ?? null) : null,
      ),
    (e) => onError(toDineInError(e)),
  );
}

export interface Bill {
  /** The seating the bill is for; null when the table is free (nothing ordered yet). */
  seating_id: string | null;
  order_mode: OrderMode;
  /** Single mode: the whole table's orders. Multiple mode: this guest's own. Oldest first. */
  orders: GuestOrder[];
  /** Everything not rejected, cancelled or refunded. */
  subtotal: number;
  service_fee: number;
  total: number;
  /** Some order is still waiting, cooking or not yet served. */
  has_open_orders: boolean;
}

/**
 * The running bill, live: every order in the current seating that this guest
 * pays for (the whole table's in single mode, their own in multiple mode),
 * with each order's status as it changes. Resets when staff clear the table.
 */
export function watchBill(
  table: TableContext,
  onChange: (bill: Bill) => void,
  onError: (e: DineInError) => void,
): () => void {
  const subs = new Map<string, () => void>();
  const orders = new Map<string, GuestOrder>();
  let state: TableState | null = null;

  const emit = () => {
    if (!state) return;
    const seating = state.seating;
    const uid = auth.currentUser?.uid ?? null;
    const shown = seating
      ? [...orders.values()]
          .filter((o) => o.table_session_id === seating.id)
          .filter((o) => seating.order_mode === "single" || o.guest_id === uid)
          .sort((a, b) => a.placed_at.localeCompare(b.placed_at))
      : [];
    const billable = shown.filter((o) => o.step !== -1);
    onChange({
      seating_id: seating?.id ?? null,
      order_mode: state.order_mode,
      orders: shown,
      subtotal: round2(billable.reduce((s, o) => s + o.subtotal, 0)),
      service_fee: round2(billable.reduce((s, o) => s + o.service_fee, 0)),
      total: round2(billable.reduce((s, o) => s + o.total, 0)),
      has_open_orders: shown.some((o) => o.step >= 0 && o.step < 5),
    });
  };

  const stopTable = watchTable(
    table,
    (next) => {
      state = next;
      const s = next.seating;
      const wanted = new Set(
        s
          ? [...s.order_ids, s.current_order_id, next.my_seat?.current_order_id].filter(
              (id): id is string => !!id && SAFE_ID.test(id),
            )
          : [],
      );
      for (const [id, stop] of subs) {
        if (wanted.has(id)) continue;
        stop();
        subs.delete(id);
        orders.delete(id);
      }
      for (const id of wanted) {
        if (subs.has(id)) continue;
        subs.set(
          id,
          watchOrder(
            id,
            (order) => {
              if (order) orders.set(id, order);
              else orders.delete(id);
              emit();
            },
            onError,
          ),
        );
      }
      emit();
    },
    onError,
  );

  return () => {
    stopTable();
    subs.forEach((stop) => stop());
    subs.clear();
  };
}

/* ============================================================ waiter calls */

export interface WaiterCall {
  id: string;
  /** open: waiting for a waiter · accepted: a waiter is on the way · resolved: done. */
  status: "open" | "accepted" | "resolved";
  message: string | null;
  request_count: number;
  /** The waiter who took it, once accepted. */
  accepted_by: string | null;
  created_at: string;
  last_requested_at: string;
}

export interface CallWaiterResult {
  request_id: string;
  /** false when the guest's call was still waiting and this pressed it again. */
  created: boolean;
  session_id: string;
  guest_label: string;
}

/**
 * The guest asks for a waiter ("Can we have the bill?"). Joins the seating the
 * way ordering does, so a guest who calls before ordering starts it. While
 * their call is still open or accepted, pressing again re-sends the same call
 * instead of opening a second one. Staff see it on the Dine-in orders and
 * Table overview pages.
 */
export async function callWaiter(input: {
  table: TableContext;
  /** Optional, up to 200 characters. Staff see "Customer needs assistance." without one. */
  message?: string | null;
  guestName?: string | null;
}): Promise<CallWaiterResult> {
  const uid = currentUid();
  const name = str(input.guestName).slice(0, MAX_NAME) || null;
  const message = str(input.message).slice(0, MAX_WAITER_MESSAGE) || null;
  const { restaurant_id, table_id } = input.table;
  try {
    const restaurant = await getDoc(doc(db, "restaurants", restaurant_id));
    const restaurantName = strOrNull(restaurant.data()?.["name"]);

    return await runTransaction(db, async (tx) => {
      // ---- Reads ----
      const rawTable = await readActiveTable(tx, input.table);
      const now = Date.now();
      const ts = new Date(now).toISOString();
      const { session, seat, mode } = joinSeating(rawTable, uid, name, now);
      const previousId = strOrNull(seat["waiter_request_id"]);
      const previousSnap =
        previousId && SAFE_ID.test(previousId)
          ? await tx.get(doc(db, "waiterRequests", previousId))
          : null;
      const previous = previousSnap?.exists() ? previousSnap.data() : null;

      // ---- Writes ----
      const label = str(seat["label"]);
      let result: CallWaiterResult;
      if (
        previous &&
        previousId &&
        previous["status"] !== "resolved" &&
        previous["table_session_id"] === session["id"] &&
        previous["table_id"] === table_id
      ) {
        // Pressed again while still waiting: the same call, asked once more.
        tx.update(doc(db, "waiterRequests", previousId), {
          request_count: (count(previous["request_count"]) || 1) + 1,
          last_requested_at: ts,
          updated_at: ts,
          ...(message ? { message } : {}),
        });
        result = {
          request_id: previousId,
          created: false,
          session_id: session["id"],
          guest_label: label,
        };
      } else {
        const id = randomId("wr");
        tx.set(doc(db, "waiterRequests", id), {
          id,
          restaurant_id,
          restaurant_name: restaurantName,
          table_id,
          table_label: str(rawTable["label"]) || input.table.table_label,
          table_session_id: session["id"],
          order_mode: mode,
          guest_id: uid,
          guest_label: label,
          customer_id: null,
          order_id: strOrNull(
            mode === "single" ? session["current_order_id"] : seat["current_order_id"],
          ),
          message,
          status: "open",
          request_count: 1,
          created_at: ts,
          last_requested_at: ts,
          accepted_at: null,
          accepted_by_id: null,
          accepted_by: null,
          resolved_at: null,
          resolved_by_id: null,
          resolved_by: null,
          updated_at: ts,
        });
        seat["waiter_request_id"] = id;
        result = { request_id: id, created: true, session_id: session["id"], guest_label: label };
      }

      session["guests"][uid] = seat;
      session["last_activity_at"] = ts;
      tx.update(doc(db, "restaurants", restaurant_id, "tables", table_id), { session });
      return result;
    });
  } catch (e) {
    throw toDineInError(e);
  }
}

/** The guest's waiter call, live (id from TableState.my_seat.waiter_request_id). */
export function watchWaiterCall(
  requestId: string,
  onChange: (call: WaiterCall | null) => void,
  onError: (e: DineInError) => void,
): () => void {
  return onSnapshot(
    doc(db, "waiterRequests", requestId),
    (snap) => {
      if (!snap.exists()) return onChange(null);
      const r: DocumentData = snap.data();
      const status = r["status"] === "accepted" || r["status"] === "resolved" ? r["status"] : "open";
      onChange({
        id: snap.id,
        status,
        message: strOrNull(r["message"]),
        request_count: count(r["request_count"]) || 1,
        accepted_by: strOrNull(r["accepted_by"]),
        created_at: str(r["created_at"]),
        last_requested_at: str(r["last_requested_at"]) || str(r["created_at"]),
      });
    },
    (e) => onError(toDineInError(e)),
  );
}
```

If this message ends here, create the file, check that the project builds, and reply **"Ready for
part 4"**. Don't build any screens yet.

---

# PART 4 of 4 — Build the website

The data layer (`@/lib/dine-in`) is in place. Now build the guest website on top of it. Mobile
first: most guests are on a phone at the table.

## What happens at the restaurant

1. A guest scans the QR code on their table. It opens `https://<this site>/dine-in/<code>`.
2. They see the restaurant's name and cover photo, their table ("Table 12"), and the menu.
3. They add items, with sizes, required choices ("Cooking: Medium"), extras and notes, and press
   **Send to waiter**.
4. The order appears on the waiters' screen in the console, **waiting for the waiter to confirm
   it**. The waiter checks it with the table (and may edit it), confirms it, and sends it to the
   kitchen. The kitchen cooks it, and the waiter serves it.
5. The guest's phone follows each step live. **Call waiter** asks for help or the bill at any
   time. They pay the waiter at the end.

A table works in one of two **order modes**, set by staff:

- **Single** (one order per table): everyone who scans the table's code adds to the same shared
  order and one bill. Once the waiter confirms that order, the next items start the table's next
  order ("round 2").
- **Multiple** (separate orders): each guest's items go into their own order, and they pay only
  for their own.

The data layer handles both. The UI only changes some wording and shows the right bill.

## Routes

| Path | Shows |
| --- | --- |
| `/dine-in/:token` | The dine-in app (everything below). |
| `/` and anything else | A simple page: the heading "Scan the QR code on your table", the line "Point your phone's camera at the code on your table to see the menu and order.", and a QR icon. No restaurant list and no links. |

## The data layer at a glance

Everything is exported from `@/lib/dine-in`. Each `watch*` function returns an unsubscribe
function: call it in your `useEffect` cleanup. Every error is a `DineInError` with a `code` and a
`message` that is ready to show to the guest.

| For | Use |
| --- | --- |
| Opening the table from the URL | `openTable(token)` → `TableContext` (`table_name` is "Table 12", `active`, `order_mode`). Call it **once per token**: guard against React StrictMode running the effect twice, e.g. by caching the promise per token. |
| The header | `getRestaurant(table.restaurant_id)` → `Restaurant` (`name`, `image_url`, `cuisine`, `city`, `currency`). |
| The menu | `watchMenu(restaurantId, onChange, onError)` → `Menu`, then `menuSections(menu)` for display. |
| Prices | `itemPrice(item)` (the special price when there is one), `formatMoney(amount, restaurant.currency)`. |
| The item sheet | `itemOptions(menu, item)`, `newCartItem(menu, item)`, `withVariant`, `toggleChoice`, `isChoicePicked`, `setAddonQuantity`, `addonQuantity`, `withQuantity`, `missingChoices`, `lineTotal`. |
| The cart | `cartTotals(cart)`, `describeLineOptions(line)`. A cart is a `CartItem[]`. |
| Sending | `placeOrder({ table, items, guestName, specialInstructions })` → `PlaceOrderResult` (`created` is false when the items joined an order still waiting for the waiter). |
| The seating | `watchTable(table, onChange, onError)` → `TableState`: `active`, `order_mode`, `my_seat` (null until the guest has ordered or called a waiter), and `my_seat.waiter_request_id`. |
| The bill | `watchBill(table, onChange, onError)` → `Bill`: `orders` (each with `order_number`, `status_label`, `step`, `lines`, `total`), `subtotal`, `service_fee`, `total`. `ORDER_STEPS` has the six step names. |
| Calling a waiter | `callWaiter({ table, message, guestName })`, then `watchWaiterCall(requestId, onChange, onError)` → `WaiterCall` (`status`: `open`, `accepted` or `resolved`, and `accepted_by`). |

Keep everything for one visit in a React context provider on the `/dine-in/:token` route: the
table, restaurant, menu, table state, bill and cart.

**Starting up:** call `openTable(token)`. Once it resolves, run `getRestaurant` and start
`watchMenu`, `watchTable` and `watchBill`. Show the loading state until the table, the restaurant
and the first menu have arrived.

## Screens

### Loading

A skeleton of the header and three menu rows. No spinner-only screen.

### Error screens

Full screen and centred, with a large icon, a title and the error's `message` underneath:

| `error.code` | Title | Action |
| --- | --- | --- |
| `dine-in/invalid-code` | This QR code isn't valid | none |
| `dine-in/code-revoked` | This table's code has changed | none (the message tells them to scan again) |
| `dine-in/table-not-found` | This table isn't available | none |
| anything else | Something went wrong | **Try again**, which starts up again |

These screens are for errors during start-up. After that, if any `onError` reports
`dine-in/code-revoked`, switch to that error screen, because the table's code was regenerated
while they were at the table. Show any other error as a toast and keep the page.

### Header (the restaurant's own look)

- The restaurant's cover photo (`restaurant.image_url`) as a banner about 176px tall, with a dark
  gradient at the bottom. On it, in white: the restaurant name (large and bold), then
  `cuisine · city` in smaller text, then a pill with the table name ("Table 12"). Without a photo,
  use a warm dark solid background instead.
- A **Call waiter** button (bell icon) at the top right of the banner. See "Call waiter" below.
- Under the banner, one line of mode text in muted colour:
  - single: "You're ordering for the whole table. Everyone who scans this code adds to one order
    and one bill."
  - multiple: "Your order is just yours. Everyone at the table orders and pays separately."
- When the table isn't taking orders (`table.active` or `tableState.active` is false), show an
  amber banner instead: "{Table 12} isn't taking orders right now. You can still look at the
  menu." Then hide every add button, the cart bar and Call waiter. `tableState` is live, so if
  staff switch the table back on, ordering returns without a reload.

### Menu tab

- Sticky, horizontally scrolling category chips from `menuSections(menu)`. Tapping one scrolls to
  its section, and the chip of the section in view is highlighted.
- A search field ("Search the menu") that filters items by name, across all sections.
- Each section has a heading (and its description, if any). Each item is a row with:
  - its name, and a "Popular" badge when `is_featured`;
  - its description, cut to two lines;
  - its price, `formatMoney(itemPrice(item), currency)`. When `itemPrice(item) < item.price`,
    also show `item.price` struck through;
  - its allergens as small chips;
  - its photo on the right, an 88px rounded square, lazy-loaded. With no photo, show no box.
- **Sold out** (`is_available` false): the row is greyed out with a "Sold out" badge, and tapping
  it does nothing.
- An empty menu shows "The menu isn't ready yet. Please ask a member of staff."

### Item sheet

Tapping an item opens a bottom sheet (a centred dialog on wide screens) with:

1. The photo (if any), the name, the description and the allergens.
2. **Size**, if `options.variants` isn't empty: radio buttons, each showing its price change
   (`+R 20,00`) when `price_delta` isn't 0. It starts on the default size from `newCartItem`.
3. Each **choice group** in `options.modifiers`: the group name, then "Choose 1" when `max` is 1 or
   "Choose up to {max}" otherwise, and a "Required" badge when `min > 0`. Use radio buttons when
   `max` is 1 and checkboxes otherwise, showing `+price` when a choice costs extra. Pick with
   `toggleChoice(line, group, choice)` and show picks with `isChoicePicked`. When a group is full,
   disable its unpicked checkboxes.
4. **Extras** (`options.addons`): each one's name and price, with a stepper from 0 to
   `max_quantity`. Use `setAddonQuantity(line, addon, n)` and `addonQuantity(line, addon.id)`.
5. **"Anything the kitchen should know?"**: a text field of up to 500 characters that goes into
   the line's `notes`.
6. A quantity stepper from 1 to 99 (`withQuantity`).
7. A sticky button at the bottom: **Add to order · {formatMoney(lineTotal(line))}**. While
   `missingChoices(options, line)` isn't empty, pressing it shows "Please choose one" in red under
   each group that still needs a pick and scrolls to the first one, without adding anything.

Tapping a line in the cart reopens this sheet with that line filled in. The button then reads
**Update**.

### Cart

- While the cart has items, show a bar fixed at the bottom of the Menu tab:
  **View order · {n} items · {total}**, where the total is `cartTotals(cart).total`. Pad it for the
  phone's safe area.
- The cart sheet is titled "Your order" (single mode: "Your order for the table"). It lists every
  line with its quantity, name, options (`describeLineOptions`), note and line total, plus a
  stepper, a remove button and tap-to-edit.
- If a line's item has become sold out or left the menu (look it up in the live menu by
  `item_id`), mark the line "No longer available. Remove it to send your order." and disable
  sending until it's removed.
- A **"Notes for your waiter"** field of up to 500 characters (`specialInstructions`).
- **Name**: when `tableState.my_seat` is null, show "Your first name (optional)", with the hint "So
  your waiter knows whose order is whose." Remember it in localStorage (`hearth-dine-in:name`) and
  pass it as `guestName`. Once the guest has a seat, show "Ordering as {my_seat.label}" instead.
- Totals: Subtotal, Service fee (5%) and Total, from `cartTotals`.
- The **Send to waiter** button calls `placeOrder`. While it runs, disable it and show a spinner.
  - When it succeeds, clear the cart, close the sheet and switch to the Bill tab. Then show a toast:
    "Sent! Your waiter will confirm your order shortly." When `created` is false, the toast says
    "Added to your table's order. Your waiter will confirm it." instead.
  - When it fails, show `error.message` in a toast and keep the cart.
- Keep the cart in localStorage under `hearth-dine-in:cart:{token}` so a reload doesn't lose it,
  and clear it once it's sent. Wrap every localStorage call in try/catch.

### Bill tab

A bottom tab bar has two tabs: **Menu** and **Bill**. Bill shows a badge with the number of orders
that aren't served yet (`step` 0–4).

- The heading is "Table bill" in single mode and "Your bill" in multiple mode.
- With no orders: "Nothing ordered yet. Your orders will appear here."
- One card per order in `bill.orders` (oldest first):
  - "Order #FF-123456" (`order_number`). In single mode, add "Round {round}" when there's more
    than one order.
  - `status_label`, with a six-step progress bar from `ORDER_STEPS` filled up to `step`. When
    `step` is -1 (not accepted, cancelled or refunded), show the status in red, with
    `rejection_reason` if there is one, and no progress bar.
  - While `open_for_additions` is true: "Waiting for the waiter to confirm. Anything you add now
    joins this order."
  - The lines: quantity × name, options, note and line total. In single mode, show who added each
    line in small muted text (`added_by_label`, or "You" when `mine`, or "Added by your waiter"
    when it's null).
  - The order total.
- A summary card: Subtotal, Service fee, **Total**. Under it: "Pay your waiter when you're ready.
  Tap Call waiter to ask for the bill." Totals leave out orders that weren't accepted or were
  cancelled.
- When an order reaches "Ready" (`step` 4) while the page is open, show a toast: "Your order is
  ready. It's on its way to you."
- The bill follows the seating. When staff clear the table after the meal, it empties by itself.

### Call waiter

- The bell button opens a small sheet with quick messages as chips: "Can we have the bill?",
  "We're ready to order", "Could we have some water?", and "Something else", which opens a text
  field of up to 200 characters. It also shows the optional name field when `my_seat` is null. The
  **Call waiter** button calls `callWaiter({ table, message, guestName })`.
- When `my_seat.waiter_request_id` is set, follow it with `watchWaiterCall`. The bell button shows:
  - `open`: "Waiter called", with a pulsing dot. Pressing again re-sends the same call; toast
    "We've reminded your waiter."
  - `accepted`: "{accepted_by} is on the way", or "A waiter is on the way" when there's no name.
  - `resolved`, or no call: the normal "Call waiter".
- After sending, toast "Your waiter has been called."

### Footer

"Powered by Hearth", small and muted, at the bottom of the Menu tab.

## Design

- **The restaurant's own look.** The cover photo carries the colour. Everything else is calm and
  neutral, so food photos stand out.
- Use one accent colour, as a CSS variable `--accent` (default warm terracotta `#C2410C`), for
  primary buttons, the active tab, the active category chip and the progress bar. Keep text contrast
  at WCAG AA or better.
- Surfaces use Tailwind's stone palette: a light background, white cards and `rounded-2xl`
  corners. Follow the phone's dark mode (`prefers-color-scheme`), with dark stone surfaces.
- Use Inter or the system font, with `tabular-nums` on every price.
- Keep it to one column, at most 480px wide and centred on larger screens.
- Make tap targets at least 44px. Use shadcn Sheet or Drawer for the sheets so focus is trapped
  and Escape closes them. Give every icon-only button an `aria-label`.
- Set the page title to "{restaurant name} · {Table 12}".

## Done when

- Opening `/dine-in/<a real code>` shows the restaurant, the table name and the live menu. A price
  changed in the console updates without a reload.
- An item with a required choice can't be added until the choice is made, and the price shown
  matches `lineTotal`.
- **Send to waiter** creates an order the console shows under Dine-in orders as "Waiting for
  waiter confirmation". A second phone at the same single-mode table adds to that same order.
- The Bill tab follows the order live as the waiter confirms it, and on through the kitchen to
  "Served".
- **Call waiter** reaches the console, and the phone shows "on the way" once a waiter accepts.
- `/dine-in/<nonsense>` shows "This QR code isn't valid", a regenerated code shows "This table's
  code has changed", and an inactive table shows the menu without ordering.
- Reloading the page keeps the guest's cart, name and seat.
- Nothing outside `src/lib/dine-in/` and `src/lib/firebase.ts` imports from `firebase/*`.

