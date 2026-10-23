# Recoverly — independent sales recovery demo

This is a small backend and product demo for routing abandoned carts to sales reps and recording simulated recovered orders.

**Independent demo · Fake data · Simulated revenue**

Every brand, rep, cart and order is fictional. The project contains no ISFY customer information and does not connect to real stores, calls, messages or payments.

## Run it locally

```bash
pnpm install
pnpm dlx supabase start
pnpm dlx supabase db reset --local
cp .env.example .env.local
pnpm dev
```

Set `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `DEMO_EVENT_SIGNING_SECRET` in `.env.local`. Use the local server-only secret printed by the Supabase CLI and set the signing secret to at least 32 random characters. Keep both secrets on the server; do not add a `NEXT_PUBLIC_` prefix.

Open http://localhost:3000. The app creates a random 24-hour visitor session and a separate copy of its two fictional brands and reps. The browser receives only an HttpOnly session cookie; Postgres stores its SHA-256 hash. **Start again** creates a new isolated session.

## Checks

Run the checks against the local Supabase stack:

```bash
pnpm lint
pnpm typecheck
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
pnpm test:db
pnpm test:concurrency
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

The SQL checks cover duplicate events, changed event contents, recovery totals, access boundaries, database permissions and rollback. The concurrency check uses parallel connections to real Postgres for competing claims, suppression and repeated recovered orders. The browser test runs the visitor flow, reloads it, and checks a second visitor has an empty session. GitHub Actions runs the same checks with a fresh local Supabase stack.

## Try the one-minute demo

![Recoverly demo showing a fictional recovered order](artifacts/demo-workflow.png)

[Watch the 70-second browser walkthrough](artifacts/demo-walkthrough.webm).

1. Choose a fictional brand and select **Add fake cart**.
2. Claim the eligible lead as one of its fictional reps.
3. Select **Simulate sale** to record a fake recovered order.
4. Try **Duplicate cart**, **Two reps claim at once**, and **Repeat a sale event** to see the safeguards.

The screen reloads its state from the current visitor session. It does not call stores, send messages, place calls or process payments. Suppression applies to an individual fake lead in this demo.

## API routes

- `GET /api/demo/state` returns only the current visitor's brands, reps, leads, recoveries and recent activity.
- `POST /api/demo/cart-events` accepts a signed fake abandoned-cart event.
- `POST /api/demo/leads/:leadId/claim` and `/suppress` change one scoped lead.
- `POST /api/demo/recovery-events` accepts a signed fake recovered-order event.
- `POST /api/demo/scenarios` runs server-signed scenarios for the screen.
- `POST /api/demo/session/reset` starts a separate fresh visitor session.

## Data boundaries

- Every record is scoped to a 24-hour visitor session and fictional brand; database foreign keys reinforce those boundaries.
- Cart and order amounts use integer USD cents. Unique rules prevent duplicate carts, event IDs, orders and per-lead recoveries.
- Row Level Security is enabled. Direct anonymous and signed-in browser access to tables and state-changing functions is revoked. Only the server uses the Supabase secret key.
- State changes and their activity entries happen inside one Postgres function, so a failed operation rolls back its partial work.
- Inbound fake events use HMAC signatures. The demo screen signs its events on the server, so the signing secret never reaches the browser.
- Expired sessions are removed when a new one is created; active sessions are capped at 25 leads and 120 events per brand.
- **Before making the demo public, configure a host-level rate limit on session creation.** The database caps a visitor's lead and event volume, but session creation itself still needs protection from automated abuse.

## AI development record

See [`docs/AI_WORKFLOW.md`](docs/AI_WORKFLOW.md) for the actual tools used, the review attempt and the validation results. Claude Code was not used to generate or change this code in the current session, so the project does not claim that it was.
