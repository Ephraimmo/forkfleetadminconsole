# Customer Support ↔ Customer App — Firebase Integration

Give this document to the AI building the **customer app**. It describes the
exact Firebase Realtime Database contract the ForkFleet operations console
already implements, so a customer can ask a question in the app and an agent
answers it live from the console.

---

## 1. Firebase project

Both apps use the same Realtime Database:

```js
const firebaseConfig = {
  apiKey: "AIzaSyBCTflur84nQjEc-YdsD_p2sR8eI7BD6nA",
  authDomain: "e-comm-bd997.firebaseapp.com",
  databaseURL: "https://e-comm-bd997-default-rtdb.firebaseio.com",
  projectId: "e-comm-bd997",
  storageBucket: "e-comm-bd997.appspot.com",
  messagingSenderId: "280613901400",
  appId: "1:280613901400:web:bf168e55508b9102dda62d",
};
```

REST fallback (no SDK): `https://e-comm-bd997-default-rtdb.firebaseio.com/<path>.json`

---

## 2. Paths

| Path | Written by | Read by |
| --- | --- | --- |
| `/support/tickets/{ticketId}` | customer app (create) + console (status/assign/summary) | both |
| `/support/messages/{ticketId}/{messageId}` | both | both |

Nothing else is required. Orders, menus, promotions and payments keep the
paths already documented in `CUSTOMER_APP_PROMOTIONS_INTEGRATION.md`.

---

## 3. `SupportTicket` shape

```ts
{
  id: string,                    // same as the key, e.g. "tkt_m8x1a2b3c4"
  subject: string,               // "Driver never arrived"
  channel: "chat" | "email" | "phone" | "in_app",
  status: "open" | "in_progress" | "waiting" | "resolved",
  priority: "low" | "medium" | "high" | "urgent",

  customer_id: string | null,
  customer_name: string,
  customer_email: string | null,
  customer_phone: string | null,

  order_id: string | null,       // link the ticket to an order when relevant
  order_number: string | null,
  restaurant_id: string | null,
  restaurant_name: string | null,

  assigned_to: string | null,    // set by the console
  assigned_name: string | null,

  last_message: string | null,   // first 160 chars, for list previews
  last_message_at: string | null,      // ISO 8601
  last_message_from: "customer" | "agent" | null,
  unread_for_agent: number,      // console badge — console resets to 0
  unread_for_customer: number,   // customer app badge — app resets to 0

  created_at: string,            // ISO 8601
  updated_at: string,
  resolved_at: string | null
}
```

## 4. `SupportMessage` shape

```ts
{
  id: string,
  ticket_id: string,
  from: "customer" | "agent" | "system",
  author_id: string | null,
  author_name: string,
  body: string,
  attachment_url: string | null,
  at: string                     // ISO 8601
}
```

---

## 5. What the customer app must do

### 5.1 Open a ticket ("Ask a question" / "Get help with this order")

1. Generate `ticketId = "tkt_" + Date.now().toString(36) + random6`.
2. `PUT /support/tickets/{ticketId}` with the full ticket object:
   `status: "open"`, `channel: "in_app"` (or `"chat"`), `unread_for_agent: 1`,
   `unread_for_customer: 0`, `last_message_from: "customer"`.
3. `PUT /support/messages/{ticketId}/{messageId}` with the first message.

### 5.2 Send a follow-up message

1. `PUT /support/messages/{ticketId}/{messageId}` with `from: "agent"` → **no**,
   from the customer app always use `from: "customer"`.
2. `PATCH /support/tickets/{ticketId}`:

```json
{
  "last_message": "<first 160 chars>",
  "last_message_at": "<ISO now>",
  "last_message_from": "customer",
  "unread_for_agent": <previous + 1>,
  "updated_at": "<ISO now>"
}
```

Do **not** overwrite `status`, `priority` or `assigned_to` — those belong to
the console. (A customer re-opening a resolved ticket may set
`status: "open"`.)

### 5.3 Live updates

Subscribe with `onValue`:

- `/support/tickets` filtered client-side by `customer_id` — the ticket list.
- `/support/messages/{ticketId}` — the open conversation.

When the customer opens a thread, `PATCH` the ticket with
`{ "unread_for_customer": 0 }`.

### 5.4 Suggested UI in the customer app

- A **Help** entry in the account menu → list of the customer's tickets with
  the status badge, `last_message` preview and an unread dot from
  `unread_for_customer`.
- A **"Need help with this order?"** button on the order tracking screen that
  pre-fills `order_id`, `order_number`, `restaurant_id`, `restaurant_name`.
- A chat thread screen: customer bubbles right, agent bubbles left, with a
  composer that performs 5.2.

---

## 6. What the console (this app) does

- Live-subscribes to `/support/tickets` and shows KPIs, filters and search.
- Opens a thread on `/support/messages/{ticketId}`, resets `unread_for_agent`.
- Sends agent replies (`from: "agent"`), bumps `unread_for_customer`, moves an
  `open` ticket to `in_progress` automatically.
- Lets agents change status/priority and assign the ticket.
- Can open a ticket on behalf of a phone/email customer.

---

## 7. Minimal REST example (works from any stack)

```js
const DB = "https://e-comm-bd997-default-rtdb.firebaseio.com";
const now = new Date().toISOString();
const ticketId = "tkt_" + Date.now().toString(36);
const messageId = "msg_" + Date.now().toString(36);

await fetch(`${DB}/support/tickets/${ticketId}.json`, {
  method: "PUT",
  body: JSON.stringify({
    id: ticketId, subject: "Where is my order?", channel: "in_app",
    status: "open", priority: "medium",
    customer_id: "demo-thabo", customer_name: "Thabo Mokoena",
    customer_email: null, customer_phone: "+27 82 555 1234",
    order_id: "ord_demo_delivery_01", order_number: "FF-DELIV01",
    restaurant_id: "rst_5jqj45emntl", restaurant_name: "Restaurant  test 1",
    assigned_to: null, assigned_name: null,
    last_message: "Where is my order?", last_message_at: now,
    last_message_from: "customer",
    unread_for_agent: 1, unread_for_customer: 0,
    created_at: now, updated_at: now, resolved_at: null,
  }),
});

await fetch(`${DB}/support/messages/${ticketId}/${messageId}.json`, {
  method: "PUT",
  body: JSON.stringify({
    id: messageId, ticket_id: ticketId, from: "customer",
    author_id: "demo-thabo", author_name: "Thabo Mokoena",
    body: "Where is my order? It's been 50 minutes.",
    attachment_url: null, at: now,
  }),
});
```

The ticket appears in the console's Support inbox within a second, and the
agent's reply appears in the customer app the same way.
