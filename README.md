# LaunchPadre

A Git workflow dashboard with snapshot, Kanban, billing, source inspection, and academic archive views.

## Current status

The Node application is a **demo**, with seeded users and repositories and SQLite-backed state. Checkout URLs and DOI creation are still simulated. Seeded repositories use simulated snapshots and rollback. Registered local repositories use real Git operations. A green health check means the demo server is running; it does not verify external services. Do not enter real payment information. Keep independent backups of live repositories.

The Python backend contains separate implementations for PostgreSQL, GitPython, Stripe, and Zenodo. It is not connected to the Node dashboard server and has not been validated for production. Its presence does not make those integrations live.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
cp .env.example .env
# Set ADMIN_PASSWORD in .env to protect the workspace.
npm run dev
```

Open http://localhost:3000. Development and production now use the same Express API. `PORT` changes the listening port. Environment values are loaded from `.env`.

## Build and run a demo deployment

```sh
npm run lint
npm run build
NODE_ENV=production LAUNCHPADRE_DEMO=true npm start
```

Production startup requires explicit acknowledgment of demo mode. The dashboard displays the same limitation. Set ADMIN_PASSWORD to a unique password of at least 16 characters before production startup. Use HTTPS: production session cookies are Secure and will not work over plain HTTP. Set APP_ORIGIN to the exact external origin (for example https://workspace.example.com). This is a single-owner workspace: the password grants access to all sample records, not separate tenant accounts. Sessions expire after eight hours and are invalidated on restart.

`GET /healthz` returns `{ "status": "ok", "mode": "demo" }`. Unknown API paths return JSON 404 responses instead of the frontend HTML.

## Verification

```sh
npm test
```

The smoke test starts the built application on a temporary local port and verifies health, repository loading, snapshot retrieval using the dashboard route, unauthenticated access rejection, sign-in/sign-out, cross-origin mutation rejection, malformed webhook signatures, and unknown API responses. A separate test checks SQLite state survives reopening.

## Work required before a live product

- Remove the unused alternative demo backend and reconcile the Python implementation before using it.
- Add user accounts, repository ownership checks, and per-user authorization if expanding beyond the single-owner workspace.
- Add remote repository import and background synchronization; local repository registration, snapshots, and guarded rollback are implemented.
- Replace fabricated checkout sessions with Stripe API calls and validate signed webhook replay handling.
- Connect Zenodo with sandbox validation before allowing irreversible publication.
- Expand state migrations and backup/recovery checks; configure deployment secrets and integration tests.
- Audit the Python backend and reconcile every frontend endpoint and response contract.

No license has been selected for this repository. Repository ownership alone does not select MIT or another license.

## Workspace security and storage

The Node workspace stores its versioned state document in SQLite at `STATE_DB_PATH` (default `./data/workspace.db`). It uses WAL and full synchronous writes; the application acknowledges successful mutations after saving state. Keep the database on persistent storage, run exactly one server process, and use SQLite-aware backups (including WAL handling). Never share one workspace database among independent server instances. Sample users, subscriptions and DOI records remain demonstrations.

With `ADMIN_PASSWORD` set, API routes require an HttpOnly, SameSite=Strict session cookie. Production requires a password; local development without one is intentionally open, so bind access accordingly. Browser mutation origins are checked against `APP_ORIGIN` or the request origin. Login attempts are rate limited in process. Use an HTTPS reverse proxy and keep the application port private.

Webhook routes currently require workspace authentication as well as signatures; external webhook delivery will be connected in the integration phase. Stripe signatures use a five-minute timestamp tolerance. Git HMAC signatures reject malformed lengths and JSON rather than crashing. Event deduplication and real ingestion are still pending.

## Real local Git workspaces

Configure `GIT_REPOSITORIES_ROOT` to an existing directory containing trusted Git working repositories and set `ADMIN_PASSWORD`. Register a relative folder name from the dashboard. Repositories must have a regular local `.git` directory; linked worktrees, bare repositories, path traversal, and escaping symlinks are rejected. Registration does not clone, push, or change the repository.

Live snapshots create immutable tags at committed HEAD. They do not include staged, unstaged, untracked, or ignored files. Empty repositories require an initial commit made by you.

Live rollback requires explicit UI confirmation and the current HEAD, verifies the saved snapshot still matches its tag, and refuses all dirty, untracked, and ignored files. It creates `refs/launchpadre/recovery/<id>` at the previous HEAD before resetting. It never runs `git clean`. The response and dashboard show the recovery ref. Inspect that ref with Git to recover the previous branch state. Reset State and demo file generation are disabled for live repositories.

Give this process exclusive ownership of managed worktrees while operations run. The application lock does not coordinate with external editors, Git processes, or additional app instances. Trust repository configuration and apply OS access controls to the Git root.
