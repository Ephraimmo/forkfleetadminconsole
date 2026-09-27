# Handover: Dine-in tables, table QR codes, dine-in orders and waiter requests

> **Audience:** developers (or an AI) building the dine-in flow in the **Customer app**, and table
> management in the **Restaurant Admin ("Orderly Hub")** app.
> **Source of truth:** Super Admin (`fleet-admin-hub-main`, this repo) —
> `src/lib/tables.firebase.ts`, `src/lib/table-sessions.firebase.ts`, `src/lib/dine-in.ts`,
> `src/lib/dine-in-order-edit.ts`, `src/lib/dine-in-orders.firebase.ts`,
> `src/lib/waiter-requests.firebase.ts`, `src/lib/table-overview.ts`, `firestore.rules`.
> Snapshot as of **2026-09-27**.
> **Status:** the admin side is live — table configuration, QR codes, seatings, the Dine-in
> orders view with waiter requests and waiter confirmation/editing, and the Table overview. The
> **customer ordering flow is not built yet**. This doc is the contract it must follow.

---

## 1. Data

All three apps share the Firestore project `e-comm-bd997`.

### 1.1 Tables — `restaurants/{restaurantId}/tables/{tableId}`

This is a real sub-collection, with one document per table.

| Field | Type | Notes |
| --- | --- | --- |
| `label` | string | Table number or name (`"12"`, `"Patio 3"`). Unique per restaurant, case/space-insensitive, and `"Table 12"` counts as `"12"`. |
| `capacity` | integer 1–50 | Seats. **Independent of `order_mode`.** |
| `active` | boolean | `false` = listed but not taking orders. Missing = `true`. |
| `order_mode` | `"single"` \| `"multiple"` | Missing or unrecognised = **`"single"`**. |
| `qr_token` | string \| null | Current QR token (§2). `null` until one is generated. |
| `qr_generated_at` / `qr_generated_by` | string \| null | When and by whom the current token was issued. |
| `session` | object \| null | The seating currently at the table (§1.4). `null` when free. |
| `last_session` | object | The last seating staff cleared: `{ id, opened_at, closed_at, closed_by, order_count }`. |
| `created_at` / `updated_at` / `updated_by` | string | ISO timestamps / staff email. |

- **Single Order Per Table:** everyone at the table adds to one shared order and one bill.
- **Multiple Orders Per Table:** each guest places, and pays for, their own order.

Editing a table only writes `label`, `capacity`, `active`, `order_mode`, `updated_at` and
`updated_by`. Other fields you keep on a table survive. Tables written before `order_mode` existed
read as `"single"`, and no migration is needed. Deactivate a table rather than deleting it.

### 1.2 QR token index — `tableQrTokens/{token}`

```ts
{
  restaurant_id: string;
  table_id: string;
  table_label: string;   // mirrors the table
  order_mode: "single" | "multiple";  // mirrors the table
  active: boolean;       // mirrors the table
  created_at: string;
  updated_at: string;
}
```

The console keeps the mirrored fields in step whenever a table is saved, in the same atomic write.

### 1.3 QR link base — `settings/dine_in`

`{ customer_app_url }` is the customer app's base address. It is set from any table's QR dialog.
The fallback is the `VITE_CUSTOMER_APP_URL` build variable.

### 1.4 Seatings — `session` on the table

A **seating** groups everything ordered at a table from the first order until staff clear the
table ("Clear table" on the Table overview). Every order placed meanwhile carries its id.

```ts
session: {
  id: string;                  // "ses_…" — orders carry it as dine_in.table_session_id
  opened_at: string;
  last_activity_at: string;    // last time anyone ordered or called a waiter
  order_mode: "single" | "multiple";  // fixed for the whole seating
  current_order_id: string | null;    // single mode: the table's most recent order
  order_count: number;
  guests: {
    [guestId: string]: {
      label: string;               // "Customer 2", or the guest's name
      joined_at: string;
      current_order_id: string | null;  // multiple mode: this guest's most recent order
      order_count: number;
      waiter_request_id: string | null; // this guest's latest waiter call (§1.5)
    };
  };
}
```

- The seating's `order_mode` is copied from the table when the seating starts. **Changing a table's
  mode mid-meal applies from the next seating**, so a shared order is never split halfway.
- A seating nobody has ordered in (or called a waiter from) for **3 hours**
  (`SESSION_IDLE_TIMEOUT_MS`) counts as over. The next guest starts a fresh one even if staff never
  cleared the table.
- Anything that writes the seating must keep every field above, including each guest's
  `waiter_request_id`. It is how a guest's repeat presses of "Request waiter" find their open
  call. The shared placement and waiter-call functions already do this.

### 1.5 Waiter requests — `waiterRequests/{requestId}`

One document per call. A guest presses **Request waiter** and staff see it live on the Dine-in orders
and Table overview pages.

| Field | Type | Notes |
| --- | --- | --- |
| `restaurant_id` / `restaurant_name` | string | From the table. The name is a display snapshot. |
| `table_id` / `table_label` | string | From the table. The label is a snapshot, e.g. `"12"`. |
| `table_session_id` | string | The seating the guest is in, the same id their orders carry. |
| `order_mode` | `"single"` \| `"multiple"` | The seating's mode. |
| `guest_id` / `guest_label` | string | The guest's stable id (their Firebase Auth uid) and their seating label, e.g. `"Customer 2"`. |
| `customer_id` | string \| null | When the guest is a known customer. |
| `order_id` | string \| null | The guest's current order in the seating when they called (single mode: the table's). |
| `message` | string \| null | What the guest said, up to 200 characters. `null` shows as **"Customer needs assistance."** |
| `status` | `"open"` \| `"accepted"` \| `"resolved"` | `open` → `accepted` (a waiter is on it) → `resolved`. It can also go straight from `open` to `resolved`. |
| `request_count` | integer | How many times the guest pressed the button while this call was unanswered. |
| `created_at` / `last_requested_at` / `updated_at` | string | ISO timestamps. |
| `accepted_at` / `accepted_by_id` / `accepted_by` | string \| null | Who took the call: their staff id or email, and their name. |
| `resolved_at` / `resolved_by_id` / `resolved_by` | string \| null | Who closed it. |

- **One live call per guest.** While a guest's call is `open` or `accepted`, pressing again
  updates that call (`request_count + 1`, `last_requested_at`, and `message` if one is given) instead
  of creating a second one. After it's resolved, the next press opens a new call.
- **Only one waiter can accept a call.** A second waiter's accept fails and says who has it. Any
  waiter can resolve a call.

---

## 2. QR codes

A table's QR code encodes exactly:

```
{customer_app_url}/dine-in/{token}
```

- `token` is 32 URL-safe characters (192 random bits). It contains no restaurant id, table id or
  anything else. It is meaningless without the index doc.
- **Regenerate** issues a new token and deletes the old index doc in one atomic write. The old
  printed code stops resolving immediately.
- **Rules** (`firestore.rules`): a signed-in client may `get` a token doc it already holds. **No one
  may `list` the collection**, so codes can't be enumerated. Only platform staff or active members
  of that restaurant may create, update or delete tokens. A token can never be re-pointed at
  another restaurant or table. Guests need a Firebase session to resolve a code; anonymous auth is
  enough.

---

## 3. How orders attach to a table

All placement goes through **`placeDineInOrder({ table: { token }, guest, items })`** in
`src/lib/table-sessions.firebase.ts`. It runs as **one Firestore transaction**, reading the token,
the table and the candidate order, then writing the order and the seating. Guests ordering at the
same moment therefore can't create duplicate orders or overwrite each other's items. The
customer app must do exactly the same, ideally by sharing this module.

`guest.id` is the guest's stable id: their Firebase Auth uid, and anonymous auth is fine. A new
guest in a seating is labelled "Customer N" unless their name is known.

**Every new order starts as `waiting_for_waiter_confirmation`** and stays out of the kitchen until a
waiter confirms it (§6). **An order is open for additions only while it is waiting for
confirmation.** Dine-in orders written before this step existed are `pending`, and they are
treated the same way.

| Mode | Where a guest's items go |
| --- | --- |
| `single` | Into the **table's current order** while it is waiting for confirmation, whoever started it. Once a waiter has confirmed it (it has gone to the kitchen), or it was rejected or cancelled, the next items start the table's **next** order (`dine_in.round` 2, 3…) in the same seating. Everyone then adds to that one, and it waits for confirmation in turn. A single-order table never has two orders waiting for confirmation at once. |
| `multiple` | Into **this guest's own** order while it waits for confirmation, or a new order for them. **Never into another guest's order.** Each order has its own status, kitchen progress and bill. |

**A guest's items never reach the kitchen without a waiter confirming them.** In single mode a
seating's bill is therefore the sum of its rounds.

---

## 4. Customer app: what the dine-in flow must do

1. Serve `/dine-in/:token`. Read `tableQrTokens/{token}`, which is the same logic as
   `resolveTableQrToken()`. If there is no doc, show "This code isn't valid". If `active` is
   `false`, show "This table isn't taking orders right now".
2. Take `restaurant_id`, `table_id`, `table_label` and `order_mode` **only from the token doc**.
   Never take them from query parameters, form fields or anything else the guest controls.
3. **Lock the table for the visit.** Keep the token (not a table id) and pass it to every
   placement. Offer no "change table" control. Moving tables means scanning the other table's code.
4. Place orders only through the §3 logic. Never write order documents or the table's `session`
   directly. After placing, show the order as **waiting for the waiter to confirm it**.
5. **Request waiter:** call `requestWaiter({ table: { token }, guest, message? })` from
   `src/lib/waiter-requests.firebase.ts`. It is one transaction: it joins the guest to the seating
   (starting one if nobody has ordered yet, exactly as ordering would) and creates or re-presses
   their call (§1.5). The guest may read their own call document, so they can be shown
   "A waiter is on the way" once `status` is `accepted`. Never write `waiterRequests` or the
   table's `session` directly.

## 5. Dine-in orders — `orders/{orderId}`

A dine-in order is a normal order record, with **one dine-in-only status**:
`waiting_for_waiter_confirmation` (the constant `WAITING_FOR_WAITER_CONFIRMATION` in `dine-in.ts`).
The console refuses that status on delivery and pickup orders. It has `order_type: "dine_in"` plus:

```ts
dine_in: {
  table_id: string;
  table_label: string;               // snapshot at order time
  order_mode: "single" | "multiple";  // the seating's mode
  table_session_id: string;          // the seating — shared by every order at the table
  guest_id: string;                  // multiple: the owner; single: who started it
  guest_label: string;               // "Customer 2", or the guest's name
  round: number;                     // nth order of the table (single) / of the guest (multiple)
  contributors: {                    // everyone who added items, keyed by guest id
    [guestId: string]: { label: string; first_added_at: string; item_count: number };
  };
  waiter_id: string | null;          // set to the confirming waiter unless already set
  waiter_name: string | null;
  confirmed_at: string | null;       // when a waiter confirmed it and sent it to the kitchen
  confirmed_by: string | null;       // that waiter's name
}
```

- Each line in `items` records who added it and when: `added_by: { guest_id, label }` and `added_at`.
  A line a waiter added has `added_by: null` and `added_by_staff: "<name>"`. A line a waiter changed
  has `edited_at` / `edited_by`.
- **Sizes, add-ons and modifiers** (`dine-in-order-edit.ts`): the size is `variant`, and every
  extra is an entry in `addons`. A choice from a menu modifier group is an addon with
  `id: "mod:{modifierId}:{choiceIndex}"` and `name: "{Group}: {Choice}"`, e.g. `"Cooking: Medium"`.
  Its `quantity` follows the line's quantity, so a priced choice is charged per item. Plain menu
  add-ons keep their own quantity. The line total is `unit_price × qty + Σ(addon.price × addon.qty)
  + variant.price_delta × qty`, and the service fee is 5% of the subtotal. Use `lineTotal()` and
  `priceOrder()` rather than re-implementing them.
- `customer_name` is the guest's label (multiple) or the table's name, e.g. "Table 10" (single).
- `delivery_address` is `null`, `delivery_fee` is `0` and there are no `driver_*` values.

**Lifecycle:** `waiting_for_waiter_confirmation` (shown as "Waiting for waiter confirmation") →
`accepted` ("Confirmed", now on the kitchen board) → `preparing` → `ready` → `delivered` ("Served").
From waiting, an order can also be `rejected` (with a reason). `cancelled` and `refunded` work as
for any other order. The console refuses `assigned`, `picked_up` and `on_the_way`, and refuses
driver assignment, for dine-in orders. They never appear on the Dispatch board. The Kitchen board
only shows `accepted`, `preparing` and `ready`.

**Where they show up in the console:**

- Operations → **Dine-in orders** (`/dine-in`) is the waiter's screen. It shows live **waiter
  requests** (🔔 Waiter Request / Table 12 / Customer needs assistance, with **Accept** and
  **Resolve**) and the orders **waiting for waiter confirmation** (Table 12 / Order FF-123456, with
  **Edit order**, **Confirm & send to kitchen** and **Reject**). Below them is every dine-in order;
  selecting one opens its items, modifiers, notes and history. A toast pops up when a guest calls.
- Operations → **Table overview** (`/tables`) shows each table live: capacity, mode, active orders,
  any open waiter requests (with Accept/Resolve), and whether it's Occupied, Available or Inactive.
  A table with an open call from its current seating counts as Occupied, even before anyone orders.
- The **Orders** page has a "Dine-in — waiting for waiter confirmation" column with the same Edit /
  Confirm / Reject actions. The Kitchen page works as for any other order, and its tickets now list
  each line's modifiers.

## 6. Waiter confirmation and order editing — `src/lib/dine-in-orders.firebase.ts`

Both actions run as one Firestore transaction on the order.

- **`confirmDineInOrder({ order_id, reviewed_line_ids?, actor })`** moves a waiting order to
  `accepted` and sets `accepted_at`, `dine_in.confirmed_at` / `confirmed_by`, and the waiter if
  none is set. It refuses an order that isn't waiting, or one with no items. With
  `reviewed_line_ids` (the lines the waiter was shown) it refuses with `dine-in/order-changed` if
  a guest has added anything since, so the kitchen never gets items no waiter has seen. Only one
  waiter's confirm can succeed.
- **`editDineInOrder({ order_id, base_line_ids, lines, special_instructions?, note?, actor })`**
  works only while the order is waiting for confirmation, and refuses once it has gone to the
  kitchen (`dine-in/order-locked`). The waiter can:
  - add items, remove items and change quantities;
  - add, remove and change modifiers, add-ons and the size;
  - change each item's note (the kitchen sees it) and the order's special instructions;
  - add a note to the order's history (staff only).

  An existing line keeps its guest, name and price. Totals and each guest's `item_count` are
  recalculated, and the changes are written to the order's history ("Edited by Sam: Burger: ×1 →
  ×2; Added Salad ×1"). Lines a guest added while the waiter was editing (not in
  `base_line_ids`) are kept. The edit refuses (`dine-in/order-changed`) rather than overwrite
  special instructions someone else changed meanwhile. An order can't be edited down to no items;
  reject it instead.

---

## 7. Known gaps (not built yet)

- The customer ordering and waiter-call flows (§4).
- **Firestore rules for guests.** Today only platform staff and restaurant members may write orders,
  tables and waiter requests (guests may read their own call). When the flow lands, guests (signed
  in, anonymous is fine) need rules that allow:
  - creating a dine-in order whose `restaurant_id` / `dine_in.table_id` match an existing, active
    `tableQrTokens` doc, with `dine_in.guest_id == request.auth.uid` and
    `status == "waiting_for_waiter_confirmation"`;
  - adding items to an order only while it is waiting for confirmation, and in multiple mode only
    when `resource.data.dine_in.guest_id == request.auth.uid`;
  - creating a waiter request (`status == "open"`, `guest_id == request.auth.uid`) for the table
    the token points at, and bumping `request_count` on their own open call;
  - updating only the `session` field of the table the token points at.

  Alternatively, run `placeDineInOrder()` and `requestWaiter()` server-side (Cloud Functions) and
  keep guests out of direct writes.
- **Restaurant Admin app:** it must recognise `waiting_for_waiter_confirmation` (label "Waiting
  for waiter confirmation", not a kitchen status) and `waiterRequests`, if it shows dine-in orders.
- Waiter assignment beyond confirmation. Confirming sets the waiter when none is set; there's no
  "reassign waiter" action, and accepting a waiter request doesn't assign one.
- A staff "Mark served" action (`ready` → `delivered`) for dine-in orders.
