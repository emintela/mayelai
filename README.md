# Mayel AI

A React (Vite) single-page app with a Go ([Fiber](https://gofiber.io)) backend. Users sign in with Clerk; chats are stored in Postgres (Neon) so users can come back to, search, and delete their history.

## Project layout

- `src/` — React frontend (Vite, React Router, Tailwind v4, Clerk via `@clerk/clerk-react`)
  - `lib/api.js` — API client (adds the Clerk token)
  - `context/ConversationsContext.jsx` — chat history shared by the sidebar and chat page
  - `components/chat-history.jsx` — sidebar history with search and delete
- `server/` — Go + Fiber backend
  - `main.go` — app setup, serves the built frontend in production
  - `internal/config` — all settings (env vars), including cost controls
  - `internal/auth` — Clerk session-token verification
  - `internal/db` — Postgres store; `schema.sql` is applied automatically on startup
  - `internal/chat` — reply generation, history window, summaries, caching, quotas
  - `internal/billing` — Stripe Checkout, Customer Portal and webhook
  - `internal/openai` — minimal OpenAI Chat Completions client
  - `internal/routes` — HTTP API

## API

All routes require a signed-in Clerk user (`Authorization: Bearer <token>`).

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/chat` | `{ conversationId?, message, mode?: "chat" \| "search" }` — omit `conversationId` to start a new chat. `mode: "search"` answers with live web search. |
| `GET` | `/api/conversations?q=` | List chats, newest first. `q` searches titles and message text. |
| `GET` | `/api/conversations/:id` | A chat and its messages. |
| `DELETE` | `/api/conversations/:id` | Delete one chat. |
| `DELETE` | `/api/conversations` | Delete all of the user's history. |
| `GET` | `/api/usage` | Today's usage and limits. |
| `PUT` | `/api/messages/:id/feedback` | `{ value: 1 \| -1 \| 0 }` — like/dislike a reply. |
| `GET` | `/api/billing` | Plan, subscription, today's usage, plan limits, Pro price. |
| `POST` | `/api/billing/checkout` | Returns `{ url }` of a Stripe Checkout page. |
| `POST` | `/api/billing/portal` | Returns `{ url }` of the Stripe Customer Portal. |
| `POST` | `/webhooks/stripe` | Stripe webhook (signature-verified, no Clerk auth). |
| `GET` | `/healthz` | Health check (no auth). |

## Cost controls

All configurable in `server/.env` (see `server/.env.example`):

- **Cheap default model** — `gpt-5-nano` with minimal reasoning (no billed reasoning tokens). AI Search uses `gpt-5-search-api` only when the user clicks it.
- **History window + rolling summary** — only the last ~10–20 messages are sent; older ones are folded into a short summary in the background, so long chats don't get more expensive per message.
- **Response cache** — identical first questions in a new chat reuse a stored answer (free) for 7 days.
- **Prompt caching** — the system prompt is fixed and sent first with a `prompt_cache_key`, so OpenAI bills repeated prompt prefixes at a discount.
- **Limits** — max reply length, max message length, per-plan daily message and AI-search quotas, and a per-minute burst limit.
- **Usage tracking** — the `usage_daily` table records requests and tokens per user per day.

## Billing (Stripe)

Free and Pro plans with per-day limits (`FREE_DAILY_*`, `PRO_DAILY_*`). Pro is paid through Stripe Checkout (cards, Apple Pay, Google Pay); users manage or cancel in Stripe's Customer Portal. A webhook keeps the `subscriptions` table in sync, and that table decides each user's plan.

**Setup (test mode first):**

1. In the [Stripe dashboard](https://dashboard.stripe.com/test), create a product **Mayel'AI Pro** with a recurring price (e.g. $5/month). Optionally add EUR/GBP prices under *currency options* so European customers pay in their currency. Copy the price ID (`price_...`).
2. In **Settings → Billing → Customer portal**, save the portal settings once (enable cancellation and payment-method updates).
3. Add to `server/.env`: `STRIPE_SECRET_KEY` (`sk_test_...`), `STRIPE_PRO_PRICE_ID`, and `APP_URL` (`http://localhost:5173` in dev).
4. Forward webhooks locally with the [Stripe CLI](https://docs.stripe.com/stripe-cli):
   ```bash
   stripe listen --forward-to localhost:3001/webhooks/stripe \
     --events customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.paused,customer.subscription.resumed
   ```
   It prints a `whsec_...` secret — put it in `STRIPE_WEBHOOK_SECRET` and restart the server.
5. Open **Settings → Upgrade to Pro** in the app and pay with the test card `4242 4242 4242 4242` (any future date, any CVC).

**Production:** use live keys, set `APP_URL` to your domain, and create a webhook endpoint in the dashboard pointing to `https://your-domain/webhooks/stripe` with the five `customer.subscription.*` events above. For EU VAT / US sales tax, consider enabling Stripe Tax.

## Getting started

Requires Node.js (frontend) and Go 1.26+ (backend).

```bash
npm install
cd server && go mod download
```

Environment variables:

- `.env` (root) — `VITE_CLERK_PUBLISHABLE_KEY`
- `server/.env` — copy `server/.env.example`; requires `OPENAI_API_KEY`, `CLERK_SECRET_KEY`, `DATABASE_URL`

Run the frontend (http://localhost:5173) and backend (http://localhost:3001) together:

```bash
npm run dev
```

The Vite dev server proxies `/api/*` to the Go server.

### Tests

```bash
cd server && go test ./...
# Full end-to-end check against the real DB and OpenAI (costs a few cents):
MAYELAI_SMOKE=1 go test ./internal/routes -run TestSmoke -v
```

## Production (Docker)

The Dockerfile builds the frontend and the Go server into one image; the server serves both the site and `/api`.

```bash
docker build --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_... -t mayelai .
docker run -p 8080:8080 --env-file server/.env mayelai
```

Deploy it in the same region as the database (Neon `aws-eu-central-1`, Frankfurt), e.g. Fly.io `fra` or Render Frankfurt. Set `OPENAI_API_KEY`, `CLERK_SECRET_KEY`, `DATABASE_URL` and `CLERK_AUTHORIZED_PARTIES=https://your-domain` as secrets on the host, and add the production domain in the Clerk dashboard.
