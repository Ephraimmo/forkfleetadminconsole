# Run It Locally — ForkFleet Admin & Operations Console

## 1. Requirements

- **Node.js 22+** recommended (the app runs on Node 20, but TanStack Start prefers 22)
- npm (or bun)

## 2. Install & run

```bash
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5173`).

Other scripts:

```bash
npm test          # unit tests (vitest)
npm run build     # production build
npm run preview   # preview the production build
```

## 3. Sign in

### Demo quick accounts (password for all: `demo12345`)

| Who | Email | Role preview |
| --- | --- | --- |
| Avery Cole | `avery.cole@forkfleet.demo` | Super Admin |
| Sipho Dlamini | `dispatch.lead@forkfleet.demo` | Dispatcher |
| Nadia Petersen | `kitchen.lead@forkfleet.demo` | Kitchen Manager |
| Ravi Naidoo | `finance@forkfleet.demo` | Finance Manager |
| Zanele Nkosi | `support@forkfleet.demo` | Customer Support |
| Chloe Meyer | `owner.nonnas@forkfleet.demo` | Restaurant Owner |

### Real Firebase account (provisioned through Access Control)

| Who | Email | Password |
| --- | --- | --- |
| Lerato Mabaso | `lerato.mabaso@forkfleet.dev` | `ForkFleet#2026` |

Admins can create more real users in **Access control → Add user**
(email + password + roles, stored in Firebase Auth + Realtime Database).

## 4. Backends (already wired, no extra setup)

- **Firebase Realtime Database** — `e-comm-bd997` (drivers, orders, restaurants,
  `/staffUsers`, `/settings`, `/notificationAlerts`, `/notificationTriggers`)
- **Firebase Auth** — Email/Password provider enabled
- **Supabase** — config in `.env` (publishable keys only)

The Firebase + Supabase credentials ship in `src/lib/firebase.ts` and `.env`.

## 5. Feature map

- `/auth` — sign-in (Firebase Auth first, demo fallback)
- `/access` — provision users, grant roles, suspend, password resets (live)
- `/settings` — org profile, branding (live preview), security, locale, API
  keys (shown-once secrets), webhooks — stored in `/settings`
- `/notifications` — send in-app alerts (all staff / roles / one person),
  event triggers with fire-now, live read receipts + bell badge
- `/drivers`, `/dispatch`, `/orders`, `/kitchen`, `/live-map`, `/restaurants`,
  `/menus`, `/inventory`, `/customers`, `/payments`, `/promotions`, `/reports`,
  `/support`, `/audit-logs` — operational modules

## 6. Troubleshooting

- **Port 5173 in use** — `npx vite --port 5174`
- **Empty driver/order lists** — the Realtime Database paths may be empty;
  the console shows live data only
- **Node engine warnings** — safe to ignore on Node 20
