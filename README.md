# LaunchPadre

LaunchPadre is a multi-tenant developer workspace built with Express, React, Vite, and embedded SQLite (`node:sqlite`). It provides isolated customer accounts, repository and task tracking, guarded local Git checkpoints with recovery-ref rollback, Stripe subscription billing (sandbox & live), Zenodo academic DOI archival, and three-layer AI-scraper data sovereignty.

## Features

- **Isolated customer workspaces**: Salted `scrypt` password authentication, `HttpOnly; SameSite=Lax` cookie sessions with CSRF `Origin` / `Sec-Fetch-Site` enforcement, password rotation that revokes other active sessions, and per-customer SQLite data isolation with foreign-key cascading.
- **Email verification & password reset**: New accounts must verify their email before signing in (accounts created before this feature are grandfathered as verified). Single-use, hashed tokens (verification 24h, reset 1h) are sent through Resend; links use the configured `PUBLIC_ORIGIN`, never the request Host header. Reset and resend endpoints answer identically whether or not an account exists, and completing a reset signs out every session.
- **Legal pages**: Terms of Service and Privacy Policy drafts in `docs/legal` are served at `/terms` and `/privacy`; sign-up requires explicit acceptance, recorded with a timestamp.
- **Guarded Git checkpoints & restore** ([`docs/customer-checkpoints.md`](docs/customer-checkpoints.md)): Operator-provisioned tenant directories (`<LAUNCHPADRE_CUSTOMER_GIT_ROOT>/<customer ID>/<repo>`), path-traversal/symlink/worktree rejection, disabled Git hooks/filters/fsmonitor, immutable `panic_room_launchpadre_<name>` tags, clean-worktree enforcement (including untracked & ignored files), and automatic `refs/launchpadre/recovery/<UUID>` creation before resetting HEAD.
- **Stripe billing (test & live)**: Server-verified USD Price catalog (`Indie Solo` \$5/mo or \$39/yr; `Academic Researcher` \$9/mo or \$69/yr), strict test vs live mode matching across prices/webhooks/subscriptions, raw-body HMAC webhook reconciliation, and Stripe Billing Portal self-service management.
- **Academic DOI archival (Zenodo)**: Available on the `Academic Researcher` plan. Packages committed `HEAD` via hardened `git archive --format=zip` (never includes `.git` or untracked files), uploads a draft deposition to Zenodo Sandbox or Production, and mints a permanent DOI with Markdown badge only after explicit confirmation.
- **Three-layer AI-scraper data sovereignty**:
  - Layer A: Dynamic `/robots.txt` disallowing major AI training crawlers and source/API paths.
  - Layer B: Request-time User-Agent interception returning `403 Forbidden` for known LLM scrapers.
  - Layer C: Global `X-Robots-Tag: noindex, nofollow, noarchive` and hardened security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, HSTS in production).

## Requirements

- **Node.js 22.14+** (uses built-in `node:sqlite`)
- **Git** installed on `PATH` (for Git checkpoints and Zenodo archive packaging)

## Quickstart (Local Development)

```bash
npm ci
cp .env.example .env
npm run dev
```

The server listens on `http://localhost:3000` (or `PORT` / `--port <n>`).

## Verification & Tests

```bash
npm run typecheck
npm run build
npm test
```

The test suite (`tests/*.test.ts`) exercises:
- Real temporary Git repositories, tenant isolation, symlink/traversal rejection, disabled Git filters, recovery refs, and restart persistence (`tests/customerCheckpoints.test.ts`).
- Stripe test and live mode verification, HTTPS origin enforcement, webhook signature & replay handling, and Billing Portal sessions (`tests/customerBilling.test.ts`).
- Zenodo Academic plan enforcement, committed-tree ZIP verification, explicit publish confirmation, and downgrade read access (`tests/customerZenodo.test.ts`).
- Verification/reset token lifecycle, legacy-account migration, enumeration-safe responses, and production mail config checks (`tests/customerRecovery.test.ts`).
- Full HTTP integration against the Express app covering health checks, `robots.txt`, AI scraper 403 blocking, auth, CSRF protection, repository/task CRUD & quotas, password rotation, and checkpoint restore (`tests/serverApi.test.ts`).

## Production Deployment

1. **Build the frontend bundle**:
   ```bash
   npm ci
   npm run build
   ```
2. **Set required production environment variables** (see [`.env.example`](.env.example)):
   - `NODE_ENV=production`
   - `PORT=3000` (or platform-injected port)
   - `TRUST_PROXY=1` (when behind Nginx, Cloud Run, Fly.io, Render, or Caddy)
   - `PUBLIC_ORIGIN` (your `https://` origin, used in emailed links)
   - `RESEND_API_KEY` and `MAIL_FROM` (sender on a domain verified in Resend; the server refuses to start without them)
   - `LEGAL_COMPANY`, `LEGAL_ADDRESS`, `LEGAL_CONTACT_EMAIL`, `LEGAL_GOVERNING_LAW`, `LEGAL_EFFECTIVE_DATE`, `LEGAL_HOSTING_PROVIDER`, `LEGAL_LOG_RETENTION`, `LEGAL_BACKUP_RETENTION` (fill the Terms and Privacy Policy served at `/terms` and `/privacy`; see [`docs/legal`](docs/legal/README.md))
   - `LAUNCHPADRE_ACCESS_TOKEN` (32+ random characters)
   - `WEBHOOK_SECRET` (32+ random characters)
   - `LAUNCHPADRE_WORKSPACE_DB=/data/workspace-runtime.db` (on persistent storage)
3. **Optional integrations**:
   - **Git checkpoints**: Set `LAUNCHPADRE_CUSTOMER_GIT_ROOT` to an existing absolute directory on persistent storage and provision `<root>/<customer ID>/<repository>`. See [`docs/customer-checkpoints.md`](docs/customer-checkpoints.md).
   - **Stripe billing**: Set `STRIPE_SECRET_KEY` (`sk_test_...` for sandbox or `sk_live_...` for live), `STRIPE_WEBHOOK_SECRET`, `STRIPE_RETURN_ORIGIN` (must be `https://` in live mode), and the relevant `STRIPE_PRICE_*` IDs. Point Stripe webhooks for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted` to `POST /api/v1/billing/webhooks/stripe`. Enable the Stripe Customer Portal in your Stripe Dashboard to support the **Manage subscription** button.
   - **Zenodo archival**: Set `ZENODO_ACCESS_TOKEN` and `ZENODO_BASE_URL` (`https://sandbox.zenodo.org` for sandbox testing or `https://zenodo.org` for live DOIs).
4. **Start the production server**:
   ```bash
   NODE_ENV=production npm start
   ```

### Docker

```bash
docker build -t launchpadre .
docker run -p 3000:3000 \
  -v launchpadre_data:/data \
  -e NODE_ENV=production \
  -e TRUST_PROXY=1 \
  -e PUBLIC_ORIGIN=https://app.example.com \
  -e RESEND_API_KEY=re_... \
  -e MAIL_FROM="LaunchPadre <no-reply@example.com>" \
  -e LAUNCHPADRE_WORKSPACE_DB=/data/workspace-runtime.db \
  -e LAUNCHPADRE_ACCESS_TOKEN="$(openssl rand -hex 32)" \
  -e WEBHOOK_SECRET="$(openssl rand -hex 32)" \
  launchpadre
```

Health check endpoint: `GET /healthz` returns `{"status":"ok","version":"1.0.0"}`.

## Architecture Notes

- `server.ts` is the production Node/Express application server.
- `src/App.tsx`, `src/CustomerWorkspace.tsx`, `src/CustomerCheckpoints.tsx`, and `src/CustomerZenodo.tsx` implement the customer workspace UI.
- `src/customerAuth.ts`, `src/customerBilling.ts`, `src/customerCheckpoints.ts`, `src/customerZenodo.ts`, `src/gitWorkspace.ts`, and `src/plans.ts` implement the domain logic and persistence layer.
- `backend_python/` contains the original FastAPI/PostgreSQL reference specification (not executed at runtime by the Node server).
