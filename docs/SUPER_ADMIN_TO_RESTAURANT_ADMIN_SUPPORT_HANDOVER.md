# Handover: Super Admin Support Desk → Restaurant Admin "My Inquiries"

> **Audience:** AI / developer building the **Restaurant Management (Restaurant Admin) app** ("Orderly Hub").
> **Goal:** Add a **Support / Inquiries** section to Restaurant Admin where a signed-in restaurant admin sees **only** the support tickets that belong to **their assigned restaurant** (`ticket.restaurant_id === session.restaurantId`) — nothing else.
> **Source of truth:** ForkFleet Super Admin console (`forkfleetadminconsole`) — the feature already works there at route `/support`; you are building a **restaurant-scoped subset** of it.

Related docs in this repo:

- [SUPER_ADMIN_RESTAURANT_MANAGEMENT_HANDOVER.md](../SUPER_ADMIN_RESTAURANT_MANAGEMENT_HANDOVER.md) — auth, restaurant scoping, provisioning, permissions
- [CUSTOMER_APP_SUPPORT_INTEGRATION.md](./CUSTOMER_APP_SUPPORT_INTEGRATION.md) — the exact ticket/message JSON contract shared with the customer app
- [SUPER_ADMIN_TO_RESTAURANT_ADMIN_MENU_HANDOVER.md](./SUPER_ADMIN_TO_RESTAURANT_ADMIN_MENU_HANDOVER.md) — same integration pattern, applied to menus

---

## 1. What you must understand first

| App | Role for support |
|-----|------------------|
| **Customer app** | Creates tickets + customer messages, reads agent replies/status |
| **ForkFleet Super Admin** (`forkfleetadminconsole`) | Platform help desk. Reads **all** tickets, replies, sets status/priority/assignment |
| **Restaurant Admin** (your app) | NEW: reads **only** tickets where `restaurant_id` equals its user's assigned restaurant, and (optionally) replies/resolves them |

### 1.1 CRITICAL: the data lives in Firebase Realtime Database — NOT Supabase

There is **no** `tickets`, `support_tickets`, or `inquiries` table in Supabase. Do **not** look for one and do **not** create one. The Supabase schema in `supabase/migrations/` is unused for support.

All support data lives in the shared Firebase RTDB project `e-comm-bd997` (same database as the customer app and Super Admin):

```
/support/tickets/{ticketId}              -> SupportTicket
/support/messages/{ticketId}/{messageId} -> SupportMessage
```

### 1.2 One user → one restaurant

Your signed-in user's profile is at `/restaurantUsers/{uid}` (Firebase Auth email/password is the shared credential store). It contains `restaurant_id`, `role`, and `permissions`. There is **no** restaurant picker and **no** join table: whatever `restaurant_id` says is the *only* restaurant the user may ever see. Tickets with `restaurant_id: null` are **platform-level** tickets (created manually by console staff via phone/email) and must be **hidden** from restaurant admins.

---

## 2. Exact data model (copy these types verbatim)

From `src/lib/support.firebase.ts` in the Super Admin repo:

```ts
export type SupportChannel = "chat" | "email" | "phone" | "in_app";
export type SupportStatus = "open" | "in_progress" | "waiting" | "resolved";
export type SupportPriority = "low" | "medium" | "high" | "urgent";

export interface SupportTicket {
  id: string;
  subject: string;
  channel: SupportChannel;
  status: SupportStatus;
  priority: SupportPriority;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  order_id: string | null;
  order_number: string | null;
  restaurant_id: string | null;     // ← THE SCOPING FIELD
  restaurant_name: string | null;   // denormalized alongside restaurant_id
  assigned_to: string | null;       // platform agent uid (console-owned)
  assigned_name: string | null;
  last_message: string | null;      // ≤160-char preview, kept on the ticket
  last_message_at: string | null;
  last_message_from: "customer" | "agent" | null;
  unread_for_agent: number;         // badge count for staff-side readers
  unread_for_customer: number;      // badge count shown in the customer app
  created_at: string;               // ISO 8601 strings everywhere
  updated_at: string;
  resolved_at: string | null;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  from: "customer" | "agent" | "system";
  author_id: string | null;
  author_name: string;
  body: string;
  attachment_url: string | null;
  at: string;
}
```

Rules of the schema:

- **snake_case everywhere.** Unlike menus, the support module has **no camelCase aliases**. Do not invent any.
- All timestamps are ISO 8601 strings, compared lexicographically (`localeCompare`) for sorting.
- Ticket ids look like `tkt_xxx`, message ids like `msg_xxx`.
- There is **no category/topic field**. Channels: `chat | email | phone | in_app`.
- Legacy/partial records exist — default missing fields like Super Admin's `coerceTicket()` does: status `open`, priority `medium`, channel `chat`, `customer_name "Customer"`, numeric counters `0`.

---

## 3. The scoping rule (the entire point of this feature)

```
visible(ticket, session)  ⇔  ticket.restaurant_id === session.restaurantId
```

Implementation requirements:

1. Subscribe to `support/tickets` with RTDB `onValue` for live updates (Super Admin helper equivalent: `subscribeSupportTickets()` in `src/lib/support.firebase.ts`).
2. **Filter client-side** by `restaurant_id === session.restaurantId`. RTDB cannot deep-filter nested fields server-side, and this mirrors the existing pattern used for orders in Restaurant Admin.
3. Sort the filtered list by `(last_message_at ?? created_at)` descending — same as Super Admin's inbox.
4. Never render, count, or act on tickets whose `restaurant_id` is `null` or belongs to another restaurant — including in badges/search.

Suggested data-layer function (adapted from `src/lib/support.firebase.ts`):

```ts
export function subscribeRestaurantTickets(
  restaurantId: string,
  cb: (tickets: SupportTicket[]) => void,
): () => void {
  return rtdbSubscribe<Record<string, Partial<SupportTicket>> | null>(
    "support/tickets",
    (raw) => cb(toList(raw).filter((t) => t.restaurant_id === restaurantId)),
  );
}
```

Thread view: subscribe to `support/messages/{ticketId}`, sort by `at` ascending, and re-check that the parent ticket passed your scoping filter before rendering.

---

## 4. Where `session.restaurantId` comes from

Reuse the prepared sign-in flow from `src/lib/restaurant-users.firebase.ts` (recommended: copy these files into your app, as the main handover doc §22–23 advises):

- `signInRestaurantUserWithFirebase({ email, password })` → returns a `RestaurantUserSession`:
- `refreshRestaurantUserSession(stored)` → re-resolves the profile on app start.

```ts
export interface RestaurantUserSession {
  userId: string;
  email: string;
  fullName: string | null;
  jobTitle: string | null;
  phone: string | null;
  restaurantId: string;   // ← use THIS for scoping, always
  role: RestaurantRole;
  permissions: string[];
}
```

Never take a restaurant id from URL params, localStorage of a previous login, or a dropdown. If the profile is missing/suspended, sign the user out — do not fall back to showing unscoped data.

---

## 5. Permissions you must add (they do not exist yet)

The restaurant permission catalog (`src/lib/restaurant-permissions.ts` in this repo) has **no support module yet** — its 26 codes stop at `rm.settings.manage`. Add two entries following the existing convention:

```ts
{
  code: "rm.support.view",
  module: "support",
  description: "View support inquiries for this restaurant",
  actions: ["view"],
},
{
  code: "rm.support.manage",
  module: "support",
  description: "Reply to and resolve support inquiries for this restaurant",
  actions: ["edit", "manage"],
},
```

Then extend the role defaults in the same file:

- `restaurant_owner` → gets everything automatically (it grants `RESTAURANT_PERMISSION_CODES`).
- `restaurant_manager` → add `rm.support.view`, `rm.support.manage`.
- `branch_manager` → add `rm.support.view` (manage optional, decide with product).
- All kitchen/cashier/inventory roles → none.

Storage notes:

- In RTDB, permission codes are stored with dots encoded as underscores: `rm.support.view` → key `rm_support_view` under `/restaurantUsers/{uid}/permissions` (`encodePermissionKeyForRtdb`). The security rules below reference the **encoded** keys.
- Existing users keep their stored permission map; only newly provisioned users pick up role defaults automatically. Use the Super Admin **Access Control → Restaurant Management** tab to tick the new permission for existing users.
- Gate your UI: hide the Support nav entry unless the session has `rm.support.view`; enable reply/composer and status controls only with `rm.support.manage`.

> **Coordination:** adding the catalog entries means touching this Super Admin repo (`src/lib/restaurant-permissions.ts`). Merge that small change here first so provisioning and rules stay in sync.

---

## 6. Firebase RTDB security rules to add

`database.rules.json` currently has **no `/support` node**, and the root denies everything. Copy the established patterns (collection-permission reads like `promotions`/`settings`; per-record data-match writes like `orders`):

```json
"support": {
  "tickets": {
    ".read": "auth != null && (root.child('staffUsers').child(auth.uid).child('roles').hasChild('super_admin') || root.child('staffUsers').child(auth.uid).child('roles').hasChild('platform_admin') || root.child('staffUsers').child(auth.uid).child('roles').hasChild('operations_manager') || root.child('staffUsers').child(auth.uid).child('roles').hasChild('customer_support') || root.child('restaurantUsers').child(auth.uid).child('permissions').child('rm_support_view').val() == true)",
    "$ticketId": {
      ".write": "auth != null && (root.child('staffUsers').child(auth.uid).child('roles').hasChild('super_admin') || root.child('staffUsers').child(auth.uid).child('roles').hasChild('platform_admin') || root.child('staffUsers').child(auth.uid).child('roles').hasChild('operations_manager') || root.child('staffUsers').child(auth.uid).child('roles').hasChild('customer_support') || (root.child('restaurantUsers').child(auth.uid).child('permissions').child('rm_support_manage').val() == true && data.exists() && data.child('restaurant_id').val() == root.child('restaurantUsers').child(auth.uid).child('restaurant_id').val()))"
    }
  },
  "messages": {
    "$ticketId": {
      ".read": "auth != null && (root.child('staffUsers').child(auth.uid).child('roles').hasChild('super_admin') || root.child('staffUsers').child(auth.uid).child('roles').hasChild('platform_admin') || root.child('staffUsers').child(auth.uid).child('roles').hasChild('operations_manager') || root.child('staffUsers').child(auth.uid).child('roles').hasChild('customer_support') || (root.child('restaurantUsers').child(auth.uid).child('permissions').child('rm_support_view').val() == true && root.child('support').child('tickets').child($ticketId).child('restaurant_id').val() == root.child('restaurantUsers').child(auth.uid).child('restaurant_id').val()))",
      ".write": "auth != null && (root.child('staffUsers').child(auth.uid).child('roles').hasChild('super_admin') || root.child('staffUsers').child(auth.uid).child('roles').hasChild('platform_admin') || root.child('staffUsers').child(auth.uid).child('roles').hasChild('operations_manager') || root.child('staffUsers').child(auth.uid).child('roles').hasChild('customer_support') || (root.child('restaurantUsers').child(auth.uid).child('permissions').child('rm_support_manage').val() == true && root.child('support').child('tickets').child($ticketId).child('restaurant_id').val() == root.child('restaurantUsers').child(auth.uid).child('restaurant_id').val()))"
    }
  }
}
```

Design notes and warnings — read carefully:

1. **RTDB rules are not filters.** The collection-level `.read` on `support/tickets` lets a permitted restaurant user download the list and filter client-side (accepted pattern in this codebase). The per-ticket/per-thread rules above still block any *targeted* read or write outside the restaurant, and messages are protected by the cross-node check against `/support/tickets/$ticketId/restaurant_id`.
2. **Deploying rules affects the customer app.** The customer app currently reads/writes `/support` successfully only because rules are not deployed. Once you deploy, the customer app's access will be governed by these rules too — coordinate with the customer-app team (add explicit clauses for their auth identity, or stage the deploy). Deploy with `firebase deploy --only database` from this repo.
3. Restaurant users can only **update existing** tickets (`data.exists()`), never create platform tickets, and only when the ticket's `restaurant_id` equals theirs.
4. Known accepted trade-off: the client-side-filtered collection read means other restaurants' ticket payloads transit to the client. Future hardening option: maintain a denormalized index `/support/ticketsByRestaurant/{restaurantId}/{ticketId}` and scope reads to that node. Do not build the v1 on it unless the customer app agrees to maintain it.

---

## 7. What Restaurant Admin may and may not write

Follow the same ownership boundaries the customer app contract defines (see `docs/CUSTOMER_APP_SUPPORT_INTEGRATION.md` §5.2), extended for the restaurant role:

| Field / action | Super Admin | Restaurant Admin |
|---|---|---|
| Read scoped tickets + threads | ✅ | ✅ (own restaurant only) |
| Send reply (new message) | ✅ | ✅ with `rm.support.manage` |
| Status `open → in_progress` on reply | ✅ automatic | ✅ automatic (same logic) |
| Mark `resolved` / reopen | ✅ | ✅ with `rm.support.manage` (sets/clears `resolved_at`) |
| Reset own unread counter | ✅ (`unread_for_agent: 0` on thread open) | ✅ same counter |
| Change `priority` | ✅ | ❌ console-owned — do not expose |
| Change `assigned_to` / `assigned_name` | ✅ | ❌ console-owned — do not expose |
| Edit `subject`, customer identity, channel, `restaurant_id` | ✅ | ❌ never |
| Create tickets | ✅ | ❌ |

### Replying correctly (mirror `sendAgentReply()`)

Write the message with `from: "agent"` so the **customer app renders it unchanged** — do not introduce a new `from` value. Make the origin clear via names:

```ts
const message: SupportMessage = {
  id: newId("msg"),
  ticket_id,
  from: "agent",
  author_id: session.userId,
  author_name: `${session.fullName ?? session.email}${session.restaurantId ? " · Restaurant Support" : ""}`,
  body,
  attachment_url: null,
  at: new Date().toISOString(),
};
```

Then update the parent ticket exactly like `sendAgentReply()` in `src/lib/support.firebase.ts` does (read-modify-write):

```ts
await rtdbUpdate(`support/tickets/${ticketId}`, {
  last_message: body.slice(0, 160),
  last_message_at: at,
  last_message_from: "agent",
  unread_for_agent: 0,
  unread_for_customer: Number(existing?.unread_for_customer ?? 0) + 1,
  status: existing?.status === "open" ? "in_progress" : (existing?.status ?? "in_progress"),
  updated_at: at,
});
```

Resolving / reopening (mirror `updateTicket()`):

- set status `resolved` → also write `resolved_at: <now>`;
- set any other status → also write `resolved_at: null`;
- always bump `updated_at`.

Caveat to accept: `unread_for_agent` is **shared** between the console inbox and your inbox. Opening a thread in Restaurant Admin clears the badge in Super Admin too. That is correct behavior (one staff-facing queue), not a bug.

---

## 8. UI guidance (match Super Admin's `/support` capabilities, minus console powers)

Build, at minimum:

- **Inbox list**: subject, customer name, channel label (`chat→Chat`, `email→Email`, `phone→Phone`, `in_app→In-app`), status badge, priority badge, `last_message` preview, relative time from `last_message_at ?? created_at` (Super Admin's `relativeTime()` format: `just now`, `Xm`, `Xh`, `Xd`), unread dot/count from `unread_for_agent`.
- **Tabs/filters**: by status (`open`, `in_progress`, `waiting`, `resolved`) + free-text search over subject/customer name/order number — applied **after** the restaurant filter.
- **Thread view**: messages ascending, customer vs agent bubbles, composer enabled only with `rm.support.manage`, Resolve / Reopen buttons, disabled priority/assignment fields displayed as read-only context.
- Live updates via `onValue` subscriptions; clean up unsubscribers on unmount.

## 9. Edge cases & gotchas checklist

- `restaurant_id: null` tickets (manual console-created ones) → hidden, always.
- Legacy records missing fields → run them through a `coerceTicket()`-style normalizer before render.
- Sorting uses string comparison of ISO timestamps — do not convert to numbers.
- Empty states: distinguish "no inquiries" from "no permission" (`rm.support.view` absent → hide module entirely, show nothing about support).
- A user whose restaurant assignment changes (via Super Admin Access Control) must see the new restaurant's tickets after `refreshRestaurantUserSession()` — never stale cache across restaurants.
- Never display `restaurant_name` as a column/filter in your UI — it is constant for your users and displaying it invites multi-restaurant thinking.
- Do **not** copy demo-store mock tickets into production paths; the live source is RTDB only.

## 10. Acceptance criteria

1. Signed-in Restaurant Admin sees only tickets with `restaurant_id === session.restaurantId`; a second account assigned to a different restaurant sees a disjoint set.
2. Platform-level (`null`) tickets are never visible.
3. New customer tickets for the restaurant appear in real time without refresh.
4. Thread history loads fully and sorted oldest→newest; replies appear in the **customer app** and **Super Admin console** with correct `last_message*`, `unread_for_customer`, and `open → in_progress` transition.
5. Resolve sets `resolved_at`; reopen clears it; priority/assignment controls are absent.
6. Without `rm.support.view` the module is invisible; with view-only rights the composer is disabled.
7. With deployed rules, a restaurant-user token cannot read or write another restaurant's ticket or message thread (verify with a REST/SDK probe using two test accounts).

## 11. Source files in this repo (read these first)

| File | Why |
|---|---|
| `src/lib/support.firebase.ts` | Canonical data layer: types, `coerceTicket`, `subscribeSupportTickets`, `subscribeTicketMessages`, `sendAgentReply`, `updateTicket`, `markTicketReadByAgent` |
| `src/routes/_authenticated/support.tsx` | Full inbox/thread/reply/status UI to mirror |
| `src/lib/restaurant-users.firebase.ts` | Sign-in + `RestaurantUserSession` (`restaurantId`) |
| `src/lib/restaurant-permissions.ts` | Where to add `rm.support.view` / `rm.support.manage` |
| `database.rules.json` | Where to add the `/support` rules (§6) |
| `docs/CUSTOMER_APP_SUPPORT_INTEGRATION.md` | Shared contract with the customer app |
| `SUPER_ADMIN_RESTAURANT_MANAGEMENT_HANDOVER.md` | Overall architecture, security gaps (§14), deploy notes (§26) |

End of handover. Scope hard: **one session, one restaurant, `restaurant_id` equality, deny-by-default.**
