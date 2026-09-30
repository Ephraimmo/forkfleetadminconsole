# Handover: Dine-in tables, table QR codes, dine-in orders and waiter requests

> **Audience:** developers (or an AI) building the dine-in flow in the **Customer app**, and table
> management in the **Restaurant Admin ("Orderly Hub")** app.
> **Source of truth:** Super Admin (`fleet-admin-hub-main`, this repo) —
> `src/lib/tables.firebase.ts`, `src/lib/table-sessions.firebase.ts`, `src/lib/dine-in.ts`,
> `src/lib/dine-in-order-edit.ts`, `src/lib/dine-in-orders.firebase.ts`,
> `src/lib/waiter-requests.firebase.ts`, `src/lib/table-overview.ts`, `firestore.rules`.
> Snapshot as of **2026-09-27**.
> **Status:** the admin side is live. That covers table configuration, QR codes, seatings,
> waiter requests, the Table overview, and the Dine-in orders view, where a waiter edits an order
> (with edit history), confirms it, sends it to the kitchen and marks it served, and gets an
> "Order Ready" alert. The Firestore rules for guests are in place (§1.6, §2). The guest side is
> being built as a separate website, **Hearth Dine-in**, from
> [DINE_IN_WEBSITE_LOVABLE_HANDOVER.md](DINE_IN_WEBSITE_LOVABLE_HANDOVER.md), whose data layer
> follows this contract. Any other guest app must follow it too.

---

## 1. Data

All three apps share the Firestore project `e-comm-bd997`.

### 1.1 Tables — `restaurants/{restaurantId}/tables/{tableId}`

This is a real sub-collection, with one document per table.

| Field | Type | Notes |
| --- | --- | --- |
| `label` | string | Table number or name (`"12"`, `"Patio 3"`). Unique within its branch, case/space-insensitive, and `"Table 12"` counts as `"12"`. |
| `branch_id` / `branch_name` | string \| null | The branch the table is at (from `restaurantBranches/{restaurantId}`). Required when the restaurant has branches; decides which waiters serve it (§1.7). |
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
  order_ids: string[];         // every order started in this seating, oldest first (the running bill)
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
- `order_ids` gains an id each time an order is started in the seating, and nothing is ever
  removed. A guest's app lists the running bill from it: the whole table's orders in single mode,
  and the guest's own (`dine_in.guest_id`) in multiple mode. Seatings opened before the field
  existed list only the orders started since.
- A guest's app writes the seating back exactly as it read it, changing only that guest's seat and
  the seating's own counters. The rules (§2) refuse any change to another guest's seat.

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

### 1.6 Guest passes — `dineInGuests/{uid}`

A guest's app signs the guest in (anonymous auth is enough) and, after resolving the scanned token,
saves the guest's pass. Everything a guest may read or write is scoped to it (§2).

```ts
{
  token: string;          // the QR token they scanned
  restaurant_id: string;  // copied from tableQrTokens/{token}; the rules check they match
  table_id: string;       //   … likewise
  updated_at: string;
}
```

- No other fields are allowed. Only the guest reads or writes their own pass.
- A pass is live only while its token exists. **Regenerating a table's QR code deletes the old
  token, which revokes every pass issued from it**: those guests can no longer read the table or
  order there until they scan the new code.
- One pass per guest. Scanning another table's code replaces it, so the guest moves tables.

### 1.7 Waiters — `restaurantUsers/{uid}` and `waiterRosters/{restaurantId}`

A waiter is a restaurant login (`restaurantUsers/{uid}`, role `"waiter"`) with a `branch_id`:
one branch, or `null` for every branch of the restaurant. Admins create them on the
restaurant's **Waiters** tab. `waiterRosters/{restaurantId}` holds what assignment needs:

```ts
{
  restaurant_id: string;
  waiters: {
    [uid: string]: {
      uid: string; name: string;
      branch_id: string | null; branch_name: string | null;
      active: boolean;             // false = deactivated, gets no tables
      online: boolean;             // on shift
      online_since: string | null;
      last_assigned_at: string | null;   // round-robin order
      assigned_count: number;
    };
  };
}
```

The roster holds no emails or phone numbers. Staff of that restaurant can read and write it;
guests can't read it at all.

A seating records its waiter as `session.waiter_id`, `session.waiter_name` and
`session.waiter_assigned_at`, and every open order at it carries `dine_in.waiter_id` and
`dine_in.waiter_name`.

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
- **What a guest with a live pass (§1.6) may do**, and nothing more:
  - `get` their restaurant, their table, and the dine-in orders at their table. They can never
    `list` tables, orders or waiter requests.
  - Update only the table's `session`. Within a seating they may change only their own seat, and
    may not change the seating's id, opening time or mode, or drop an id from `order_ids`. A new
    seating must hold just them, in the table's mode.
  - Create an order at their table only as `waiting_for_waiter_confirmation`, with
    `dine_in.guest_id` as their uid, no `confirmed_at`, `payment_status` `pending`, and at least one
    item. It must belong to the table's current seating, in that seating's mode, and be listed in its
    `order_ids`, all written in the same transaction.
  - Add to an order at their table while it is waiting for confirmation (in multiple mode only
    their own). They can only add items and timeline entries, update their own contributor entry,
    the totals, the special instructions and `updated_at`, and never change or remove an existing
    line.
  - Create a waiter request for their table and seating (`open`, `request_count` 1, recorded as
    their seat's `waiter_request_id`). They can re-press their own open or accepted call
    (`request_count + 1`), but never accept or resolve one.
- The Hearth Dine-in data layer was run against these rules in the Firebase emulator, both the
  guest flows and the writes above that must be refused.

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
| `single` | Into the **table's current order** while it is waiting for confirmation, whoever started it. Once a waiter has confirmed it (even before it's sent to the kitchen), or it was rejected or cancelled, the next items start the table's **next** order (`dine_in.round` 2, 3…) in the same seating. Everyone then adds to that one, and it waits for confirmation in turn. A single-order table never has two orders waiting for confirmation at once. |
| `multiple` | Into **this guest's own** order while it waits for confirmation, or a new order for them. **Never into another guest's order.** Each order has its own status, kitchen progress and bill. |

**A guest's items never reach the kitchen without a waiter confirming them.** In single mode a
seating's bill is therefore the sum of its rounds.

---

## 4. Customer app: what the dine-in flow must do

1. Serve `/dine-in/:token`. Sign the guest in (anonymous is fine), then read
   `tableQrTokens/{token}`, which is the same logic as `resolveTableQrToken()`. If there is no doc,
   show "This code isn't valid". Otherwise save the guest's pass (§1.6). If `active` is `false`,
   show "This table isn't taking orders right now".
2. Take `restaurant_id`, `table_id`, `table_label` and `order_mode` **only from the token doc**.
   Never take them from query parameters, form fields or anything else the guest controls.
3. **Lock the table for the visit.** Keep the token (not a table id) and pass it to every
   placement. Offer no "change table" control. Moving tables means scanning the other table's code.
4. Place orders only through the §3 logic. Never write order documents or the table's `session`
   directly. After placing, show the order as **waiting for the waiter to confirm it**, then follow
   its `status` with the labels in §5 (Confirmed → Sent to kitchen → Preparing → Ready → Served).
5. **Request waiter:** call `requestWaiter({ table: { token }, guest, message? })` from
   `src/lib/waiter-requests.firebase.ts`. It is one transaction: it joins the guest to the seating
   (starting one if nobody has ordered yet, exactly as ordering would) and creates or re-presses
   their call (§1.5). The guest may read their own call document, so they can be shown
   "A waiter is on the way" once `status` is `accepted`. Never write `waiterRequests` or the
   table's `session` directly.

## 5. Dine-in orders — `orders/{orderId}`

A dine-in order is a normal order record, with **two dine-in-only statuses**:
`waiting_for_waiter_confirmation` and `waiter_confirmed` (the constants
`WAITING_FOR_WAITER_CONFIRMATION` and `WAITER_CONFIRMED` in `dine-in.ts`). The console refuses both
on delivery and pickup orders. It has `order_type: "dine_in"` plus:

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
  waiter_id: string | null;          // set to the first waiter who confirms or serves it
  waiter_name: string | null;
  confirmed_at: string | null;       // a waiter confirmed it with the table
  confirmed_by: string | null;       //   … that waiter's name
  sent_to_kitchen_at: string | null; // a waiter sent it to the kitchen
  sent_to_kitchen_by: string | null;
  served_at: string | null;          // a waiter served it at the table
  served_by: string | null;          //   … that waiter's name
  served_by_id: string | null;       //   … and staff id
}
```

- Each line in `items` records who added it and when: `added_by: { guest_id, label }` and `added_at`.
  A line a waiter added has `added_by: null` and `added_by_staff: "<name>"`. A line a waiter changed
  has `edited_at` / `edited_by`, and the change is recorded in `edits` (§6.2).
- **Sizes, add-ons and modifiers** (`dine-in-order-edit.ts`): the size is `variant`, and every
  extra is an entry in `addons`. A choice from a menu modifier group is an addon with
  `id: "mod:{modifierId}:{choiceIndex}"` and `name: "{Group}: {Choice}"`, e.g. `"Cooking: Medium"`.
  Its `quantity` follows the line's quantity, so a priced choice is charged per item. Plain menu
  add-ons keep their own quantity. The line total is `unit_price × qty + Σ(addon.price × addon.qty)
  + variant.price_delta × qty`, and the service fee is 5% of the subtotal. Use `lineTotal()` and
  `priceOrder()` rather than re-implementing them.
- `customer_name` is the guest's label (multiple) or the table's name, e.g. "Table 10" (single).
- `delivery_address` is `null`, `delivery_fee` is `0` and there are no `driver_*` values.

**Lifecycle** (labels from `DINE_IN_STATUS_LABEL`):

| `status` | Shown as | What happens next |
| --- | --- | --- |
| `waiting_for_waiter_confirmation` | Waiting for waiter confirmation | The waiter reviews and may edit it, then **Confirm order**. Guests can still add to it. |
| `waiter_confirmed` | Confirmed — not sent yet | Guests can't add to it any more. The waiter **Sends it to the kitchen**. |
| `accepted` | Sent to kitchen | The first column of the kitchen board. |
| `preparing` | Preparing | The kitchen marks it ready, and waiters get a **🔔 Order Ready** alert. |
| `ready` | Ready | The waiter takes it to the table and taps **Mark as served**. |
| `delivered` | Served | Done. |

**An unconfirmed order never reaches the kitchen.** Only the waiter actions in §6 move an order
into `waiter_confirmed`, `accepted` or `delivered`. `setFirebaseOrderStatus()` refuses those three
for dine-in orders, and refuses `preparing`/`ready` for an order that hasn't been sent. The
kitchen board also checks `dine_in.confirmed_at` before it shows a dine-in order. Whichever app
writes the order, `firestore.rules` refuses any write that puts a dine-in order in `accepted`,
`preparing`, `ready` or `delivered` without `dine_in.confirmed_at`. (Until 2026-09-27, the
`orders/{orderId}/{document=**}` match also matched the order itself, because in rules v2 a
recursive wildcard matches zero segments. Staff and drivers could skip this check through it. It
now only matches sub-collections.)

An order that is waiting or confirmed can also be `rejected`, with a reason. `cancelled` and
`refunded` work as for any other order. The console refuses `assigned`, `picked_up` and
`on_the_way` for dine-in orders, and refuses driver assignment. They never appear on the Dispatch
board.

**Where they show up in the console:**

- Operations → **Dine-in orders** (`/dine-in`) is the waiter's screen. It shows three live
  queues:
  - **waiter requests**;
  - orders **ready to serve**, with **Mark as served**;
  - orders still with the waiter, with **Edit order**, **Confirm order** or **Send to kitchen**,
    and **Reject**.

  Below the queues is every dine-in order. Selecting one opens its items, modifiers and notes,
  who confirmed, sent and served it, its **edit history** and its timeline.
  `/dine-in?order={orderId}` opens an order directly.
- **🔔 Order Ready:** on every console page, a toast appears the moment the kitchen marks a
  dine-in order ready. It reads *Order Ready · Table 12 · Order #FF-123456 · [View Order]*. It
  stays until someone dismisses or views it, and goes by itself once the order is served. Orders
  that were already ready when the console opened raise no alert; they're listed under "Ready to
  serve".
- Operations → **Table overview** (`/tables`) shows each table live:
  - capacity, mode and active orders;
  - open waiter requests;
  - whether it's Occupied, Available or Inactive;
  - its **service**: *Ready to serve* (with Mark as served), *Waiting for the waiter*, *In the
    kitchen* or *All served*.

  A table stays Occupied after everything is served, until staff clear it.
- The **Orders** page has a "Dine-in — with the waiter" column with the same actions, and Mark as
  served on ready dine-in orders. Its Accept button never applies to dine-in orders. Kitchen
  tickets show the table and each line's modifiers.

## 6. Waiter actions — `src/lib/dine-in-orders.firebase.ts`

Each action runs as one Firestore transaction on the order, records who took it, and adds a line
to the order's `timeline`. Each refuses with `dine-in/order-locked` when the order isn't at its
step.

### 6.1 Confirm, send to kitchen, serve

- **`confirmDineInOrder({ order_id, reviewed_line_ids?, actor })`** moves the order from
  `waiting_for_waiter_confirmation` to `waiter_confirmed`.
  - Sets `dine_in.confirmed_at` / `confirmed_by`, and the waiter if none is set.
  - Refuses an order with no items.
  - Pass `reviewed_line_ids`, the lines the waiter was shown. If a guest has added anything since,
    it refuses with `dine-in/order-changed`, so a waiter never confirms items they haven't seen.
  - Only one waiter's confirm can succeed. From here on, guests can't add to the order.
- **`sendDineInOrderToKitchen({ order_id, actor })`** moves the order from `waiter_confirmed` to
  `accepted`. It sets `accepted_at` and `dine_in.sent_to_kitchen_at` / `sent_to_kitchen_by`, and
  refuses unless the order has been confirmed.
- **`markDineInOrderServed({ order_id, actor })`** moves the order from `ready` to `delivered`.
  - Sets `delivered_at` and `dine_in.served_at` / `served_by` / `served_by_id`, plus the waiter if
    none is set.
  - Returns `{ order_id, order_number, table_label, served_at, served_by }`.
  - The timeline reads "Served at Table 12 by John".

### 6.2 Editing, and the edit history

**`editDineInOrder({ order_id, base_line_ids, lines, special_instructions?, note?, actor })`**
works while the order is with the waiter (waiting or confirmed). It refuses once the order has
been sent to the kitchen. The waiter can:

- add items, remove items and change quantities;
- add, remove and change modifiers, add-ons and the size;
- change each item's note (the kitchen sees it) and the order's special instructions;
- add a note to the order's history (staff only).

How an edit is applied:

- An existing line keeps its guest, name and price.
- Totals and each guest's `item_count` are recalculated.
- Lines a guest added while the waiter was editing (not in `base_line_ids`) are kept.
- The edit refuses with `dine-in/order-changed` rather than overwrite special instructions that
  someone else changed meanwhile.
- An order can't be edited down to no items. Reject it instead.
- **Changing a confirmed order withdraws the confirmation.** It goes back to
  `waiting_for_waiter_confirmation`, and must be confirmed again before it can be sent. A note on
  its own doesn't count as a change.

**The customer's original order is never overwritten without a record.** Every save that changes
the order adds one entry to `edits`. That's a map on the order keyed by edit id;
`normalizeOrderEdits()` reads it back oldest first.

```ts
edits: {
  [editId: string]: {
    id: string;
    at: string;                        // when
    by: string;                        // the waiter's name ("Edited by: John")
    by_id: string | null;
    status_before: string;             // e.g. "waiter_confirmed"
    summary: string;                   // "Steak: Mushroom Sauce removed" — also in the timeline
    lines: {                           // one per line changed
      line_id: string;
      kind: "added" | "removed" | "changed";
      item_name: string;               // "Steak"
      original: string | null;         // "Steak + Mushroom Sauce" (null for a line the waiter added)
      updated: string | null;          // "Steak" (null when removed)
      changes: string[];               // ["Mushroom Sauce removed"]
      before: OrderLine | null;        // the line exactly as it was
      after: OrderLine | null;         // …and as it became
    }[];
    special_instructions: { from: string | null; to: string | null } | null;
    total_before: number;
    total_after: number;
    confirmation_withdrawn: boolean;   // it had been confirmed; this edit meant confirming again
  };
}
```

Changes are worded like this: "Mushroom Sauce removed", "Extra cheese ×1 → ×2", "Cooking: Rare →
Medium", "size Regular → Large", `note "No onions"`, "Removed Chips ×1" and "Added Salad ×1".
The console shows each changed line as *Order #FF-123456 · Original: Steak + Mushroom Sauce ·
Edited by: John · Change: Mushroom Sauce removed · Time: 18:47*.

The kitchen only ever sees the order's current `items`, and only after the order has been
confirmed and sent. So it receives the final confirmed order and nothing else.

### 6.3 Order Ready alerts

`readyOrderAlerts(seen, orders)` in `dine-in.ts` is the rule the console's alert follows:

- one alert for each dine-in order that has become `ready` since the last snapshot (`seen`);
- no alerts on the first snapshot;
- a `cleared` list of orders that are no longer ready.

The Restaurant Admin app should raise the same alert from the same data. Nothing extra is written
to the database; the alert is worked out from the live order book.

### 6.4 Payment

`confirmDineInPayment({ order_id, method, actor })` records that the table paid its waiter:
`"cash"`, `"card"` or `"eft"`.

- **When:** any time after the order was confirmed with the table (before or after the kitchen,
  before or after serving), once only.
- **What it writes:** `payment_status: "paid"`, `payment_method`, the receipt in `payment` (the
  same shape as every other paid order), `dine_in.paid_at`, `paid_by`, `paid_by_id` and
  `paid_with`, plus a line in the history.
- **Afterwards:** the order can't be edited, so what was paid stays what was ordered.

### 6.5 Waiter assignment — `src/lib/waiters.firebase.ts`

- **Who gets a new seating:** the next **online, active** waiter who covers the table's branch,
  meaning the one with the oldest `last_assigned_at`. So tables go round the waiters in turn, and
  a branch with a single waiter on shift gets every table.
- **For how long:** the waiter keeps the table for the whole seating. Every order the table
  places goes to them.
- **When nobody is online:** the seating waits unassigned and goes to the first waiter who comes
  online.
- **Going offline or being deactivated:** the waiter's open tables pass to the next online
  waiter, or wait if nobody else is on.
- **Managers** can move a table to another waiter from the Table overview.
- **Where it runs:** on staff devices only (`useAutoAssignWaiters()` on every online waiter's
  Waiter screen and on the console's Table overview). Each assignment is one transaction, so
  several devices racing assign a seating exactly once.

**The Waiter screen** (`/waiter`) is where waiters work. They sign in with their waiter login and
switch **Online** when their shift starts. From then on they see only their own tables, and for
each order they can:
- edit, confirm, send to the kitchen or reject it;
- serve it once the kitchen marks it ready (they get an Order Ready alert);
- take payment.

It also shows the calls from their tables, and tables still waiting for a waiter.

---

## 7. Known gaps (not built yet)

- The guest website itself (§4), which is being built from
  [DINE_IN_WEBSITE_LOVABLE_HANDOVER.md](DINE_IN_WEBSITE_LOVABLE_HANDOVER.md).
- **Deploying the rules.** The guest rules (§2) and the `dineInConfirmedBeforeKitchen()` check only
  apply once the rules are deployed (`firebase deploy --only firestore:rules`), and guests need
  **Anonymous** sign-in switched on in Firebase Authentication. Deploying replaces the live rules,
  so compare them first. This file lets customers read neither restaurants nor orders, and write no
  orders, except through a dine-in guest pass, whereas the Customer app handovers expect
  customers to do both.
- **Guest-side limits the rules can't close:**
  - A guest's app prices the lines, and the rules can't re-price them against the menu. The
    waiter's confirmation is the check.
  - The rules can't tell whether a seating has gone idle, so a guest holding the table's current
    code could start a new seating early. Orders are unaffected; guests' running bill restarts.
  - At a multiple-mode table, a guest can read (not change) other guests' orders there if they know
    an order's id.

  Moving placement to a server (Cloud Functions running `placeDineInOrder()` and
  `requestWaiter()`) would close all three.
- **Restaurant Admin app.** If it shows dine-in orders, it must:
  - recognise `waiting_for_waiter_confirmation` and `waiter_confirmed` (neither is a kitchen
    status);
  - use the §6 actions rather than writing `status` itself;
  - show the Order Ready alert (§6.3) and `waiterRequests`.
- **Waiter assignment** runs on staff devices (§6.5):
  - A new seating is assigned as soon as any online waiter's Waiter screen, or a Table overview,
    is open. If none is open, it's assigned when one opens. A Cloud Function would make this
    independent of open screens.
  - Any staff member of the restaurant can edit its whole roster, not only their own line.
  - The Waiter screen shares the browser's Firebase sign-in with the console, so use it on the
    waiter's own device.
  - Accepting a waiter request doesn't change the table's waiter.
