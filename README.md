# LaunchPadre

A single-owner Git workspace with persistent tasks, checkpoint tags, guarded rollback, Stripe subscription checkout, and Zenodo software archives.

## Implemented

- Password sign-in, eight-hour server sessions, sign-out, login throttling, and browser-origin checks.
- SQLite workspace persistence with WAL and full synchronous writes.
- Registration of existing local Git working repositories, immutable checkpoint tags, and rollback recovery refs.
- Kanban task creation and status changes; signed Git push webhooks can derive tasks from commit messages.
- Stripe Checkout API integration with configured recurring prices, signature validation, event deduplication, and authoritative subscription retrieval.
- Zenodo draft creation and committed-file upload, with publication as a separate confirmed action. Sandbox is the default.
- Separate demo and live databases, a health endpoint, CI, and automated tests.

Stripe and Zenodo request behavior is tested with substitutes. Actual account transactions and uploads have not been run. The Dockerfile is provided but has not been built in this workspace.

## Run on your own computer

Install Node.js 24 and Git first. Clone the implementation branch, then use the local setup commands:

```sh
git clone --branch codex/production-readiness https://github.com/bzucker4/LauchPadre.git
cd LauchPadre
npm ci
npm run setup:local
npm run local
```

Setup asks for your email and the folder containing your Git projects. Your email is just the local owner identity; setup does not send email. It generates a password and saves configuration in `.env`, without overwriting an existing file. Keep the displayed password for sign-in. If `.env` already exists, edit it using `.env.example` as a reference instead of rerunning setup.

Open **http://127.0.0.1:3000** after the server reports it is ready. `npm run local` builds the frontend and starts a production process in local-only mode. It binds to `127.0.0.1`, uses cookies appropriate for local HTTP, and leaves the password requirement in place. Network deployments keep HTTPS-only cookies. Stop with Ctrl+C; start again with `npm run local`. Your database remains at `data/local-workspace.db`.

The default project folder is `repositories` inside the application folder. You can choose an existing folder instead. Clone or put your Git working repositories in that folder and register them by relative name in the dashboard. The local database, Git project folder, and `.env` are excluded from source control.

This setup has no cloud hosting bill. Your computer must be awake and the server running to use it. Its loopback address is not a public website: outside Stripe and Git webhook senders cannot reach it directly. Stripe/Zenodo are optional and can stay unconfigured for local Git and task use. Do not enable port forwarding or expose local-only HTTP mode to the internet.

## Troubleshooting local checkout availability

If the page reports a missing endpoint, stop the previous server with Ctrl+C before updating or starting another one. The launcher checks the port before building so that it cannot replace frontend files underneath an older running server. It never stops another process automatically.

After updating and starting `npm run local`, use a **second terminal**:

```sh
cd ~/LauchPadre
npm run doctor
```

The diagnostic checks health, API compatibility, local authentication, and the billing endpoint. It uses your local configuration to sign in temporarily, signs that session out, and does not print passwords, tokens, or customer data. Keep its output when requesting support. Missing Stripe configuration is reported as expected for local Git/task use rather than a network failure. The browser redirects expired sessions back to sign-in and provides a retry button for temporary availability failures.

Run the disposable recovery checks in the same second terminal:

```sh
npm run test:recovery
```

They create their own temporary repositories and databases and remove them afterward. They do not use registered repositories or your workspace database. They verify checkpoint rollback, a stopped-workspace backup restore, and a process interrupted after saving its recovery ref but before reset. They do not simulate a power loss during Git's filesystem update. See `RELEASE_CHECKLIST.md` for remaining launch gates.

## Local setup

Use Node.js 24, npm, and Git.

```sh
npm ci
cp .env.example .env
```

Edit `.env` before starting:

| Variable | Purpose |
| --- | --- |
| `LAUNCHPADRE_DEMO` | `false` for an empty real workspace; `true` for sample data |
| `ADMIN_EMAIL` | Required owner email in live mode |
| `ADMIN_PASSWORD` | At least 16 characters; required in live mode and production |
| `ADMIN_NAME` | Optional owner display name |
| `APP_ORIGIN` | Exact browser origin, e.g. `http://localhost:3000` locally |
| `STATE_DB_PATH` | SQLite file; use different paths for demo and live mode |
| `GIT_REPOSITORIES_ROOT` | Existing directory containing trusted local repositories |

```sh
npm run dev
```

Open http://localhost:3000 and sign in. Development and production use the same Express API. Optional integrations remain unavailable until their environment variables are configured. Never put credentials in source control.

For a production process:

```sh
npm run lint
npm run build
NODE_ENV=production npm start
```

Production requires HTTPS for its Secure, HttpOnly, SameSite=Strict cookies. Set `APP_ORIGIN` to the actual external HTTPS origin. Put the app behind an HTTPS proxy and keep the application port private. Sessions are invalidated on restart. The owner password grants access to the entire workspace: this is not a multi-tenant SaaS.

## Local Git repositories

Configure `GIT_REPOSITORIES_ROOT`, then register a relative folder from the dashboard. Registration does not clone or push. Bare repositories, linked worktrees, symlink aliases, and paths outside the configured root are rejected. Register only repositories and Git configuration you trust.

Snapshots tag committed HEAD. They exclude uncommitted work and cannot overwrite existing checkpoint tags. Make an initial commit yourself before snapshotting a new repository.

Live rollback requires confirmation and the HEAD displayed by the dashboard. It verifies the snapshot tag still matches its saved commit and rejects dirty, untracked, and ignored files. It saves the previous HEAD under `refs/launchpadre/recovery/<id>` before `git reset --hard`. It never runs `git clean`. The dashboard displays the recovery ref, which you can inspect with Git to recover the previous state.

Use one application process and give it exclusive control of managed worktrees while operations run. Application locks do not coordinate with outside Git processes. Keep independent repository backups. Demo reset is disabled when live repositories are registered.

## Tasks and Git webhooks

Create tasks directly on the Kanban board and change their status using its selector. Tasks are stored in SQLite; manual tasks do not create Markdown files.

For push ingestion, set `WEBHOOK_SECRET` and configure your Git forge to POST to `/api/v1/webhooks/git-core` with an HMAC-SHA256 `X-Gitea-Signature` over the raw request body. The repository must be registered, with a matching repository id or full name. Payloads use the Gitea/Forgejo push format (`repository` and `commits`).

Commit-message directives `todo: Task title` create tasks; `fix: Task title` and `close: Task title` mark matching tasks done. Commits are deduplicated per repository. Ingestion records commit metadata and task links; it does not fetch remote changes into the local checkout. Keep local repositories synchronized separately.

## Plans and pricing

| Plan | Monthly | Annual | Included limits |
| --- | --- | --- | --- |
| Free Developer | $0 | $0 | 3 registered local repositories, 1 checkpoint per repository, guarded rollback and Kanban |
| Indie Solo | $5 | $39 | Unlimited registered local repositories and checkpoints; Kanban and signed Git webhook ingestion |
| Academic Researcher | $9 | $69 | Indie features plus Zenodo draft creation and confirmed publication |

All amounts are USD. Annual subscriptions are billed once per year. The UI and server use the same plan catalog. Free limits are checked on the server before adding repositories or snapshots; academic access is checked before preparing or publishing Zenodo archives. Existing data remains accessible after a downgrade, including rollback; new additions over the free limits are blocked. Registering a repository does not import every repository on your computer.

These are workspace plan checks, not copy protection for distributed source code. A self-hosted owner controls the application and its database. Selling downloadable licenses would require a separate licensing model; no one-time or lifetime entitlement is implemented.

## Stripe

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `APP_ORIGIN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_INDIE`, and `STRIPE_PRICE_ACADEMIC`. Monthly Price ids must match $5/month for Indie and $9/month for Academic. Set `STRIPE_PRICE_INDIE_ANNUAL` to a $39/year recurring Price and `STRIPE_PRICE_ACADEMIC_ANNUAL` to a $69/year recurring Price to enable annual checkout. These must be USD per-unit licensed prices with one month or one year per billing interval. Checkout retrieves the configured Price and refuses a mismatched amount or interval before creating a session. Existing subscriptions and Stripe prices are not modified by editing this repository. Start with test credentials. Checkout uses the owner identity and server-controlled return URLs; it never accepts a client-supplied price or redirect origin.

Configure Stripe's webhook endpoint as `/api/v1/billing/webhooks/stripe`, subscribing to `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`. The endpoint verifies the raw-body signature and a five-minute timestamp tolerance, retrieves current subscription state, validates workspace metadata, and persists processed event ids. Redirecting back from checkout does not grant a plan. Signed webhook endpoints do not require a browser session.

Manage subscription changes through Stripe. The application does not yet offer a customer billing portal. Final pricing is shown by Stripe. No fabricated checkout URL is returned when configuration is missing.

## Zenodo

Set `ZENODO_ACCESS_TOKEN` and `ZENODO_BASE_URL=https://sandbox.zenodo.org` initially. Use a token with the scopes required for creating/uploading and, if needed, publishing depositions. Production Zenodo uses a separate token and `https://zenodo.org`.

Select a live repository, enter its title, creator, description, and a valid Zenodo license identifier. Preparing an archive creates a draft and uploads a ZIP made with `git archive` from committed HEAD. The application limits archives to 50 MiB and does not include submodule contents. Review committed files for private data and confirm your license choice before uploading.

Review the draft in Zenodo before confirming publication. Publication is a separate endpoint and UI action and may be irreversible. Only an actually submitted record with a DOI is shown as published. An accepted request still in progress is shown as publishing. Failed uploads retain their deposition id so that preparing the same commit retries the existing draft.

External calls can have uncertain outcomes after network failures. Review the existing deposition before retrying; a process failure between remote creation and saving its id can leave an orphan draft. Existing metadata is retained when retrying a saved draft; edit metadata in Zenodo if necessary. One deposition is tracked per repository commit and Zenodo environment.

## Storage and deployment

`STATE_DB_PATH` defaults to `./data/workspace.db`. Mount persistent storage for the database and Git repositories. SQLite stores a versioned workspace document and acknowledges successful mutations after saving. A persistence failure blocks subsequent workspace API access until storage is fixed and the process restarted. Use SQLite-aware backups that account for WAL files.

Run exactly one server process. Do not share the same workspace database among separate application instances. Startup rejects switching a database between demo and live modes; use a new path rather than overwriting existing data.

A multi-stage Dockerfile installs Git, builds the frontend, and runs as the non-root `node` user. Mount writable storage at `/app/data` and `/repositories` and provide configuration through the hosting platform's secret/environment settings. The runtime uses Node 24 and includes `tsx` as a production dependency. Container build and hosting verification remain deployment checks.

`GET /healthz` returns `{ "status": "ok", "mode": "live" }` (or `demo`). It is a process health check, not a validation of Stripe, Zenodo, Git, or disk health. `/api/v1/integrations` reports configuration presence after sign-in; it does not prove credentials are valid.

## Verification

```sh
npm run lint
npm run build
npm test
```

Tests exercise Git snapshots and recovery, refusal of unsafe worktrees, SQLite reopening, monthly/annual checkout construction and mismatched-price rejection, plan quotas, Zenodo draft/publication separation and host restrictions, and authenticated API smoke tests in demo and live modes. Smoke tests cover registration, snapshots, tasks, signed webhook ingestion and replay handling, session controls, invalid signatures, and API errors.

## Remaining operational work

- Supply hosting configuration, a unique owner password, and optional integration credentials privately.
- Validate Stripe test-mode checkout and subscription lifecycle against your account.
- Validate Zenodo sandbox upload and publication with a repository you explicitly intend to archive.
- Build and run the container on the chosen host; verify persistent mounts, HTTPS, backups, restore, and restart behavior.
- Add remote cloning/synchronization and multi-user tenancy only if needed; neither is implemented.

The `backend_python` directory is a legacy reference implementation. It is not started by the Node app and has not been validated for production. The dashboard source viewer displays that reference, not the active Node implementation. No repository license has been selected.

API references: [Stripe Checkout creation](https://docs.stripe.com/api/checkout/sessions/create) and [Zenodo REST API](https://developers.zenodo.org/).

