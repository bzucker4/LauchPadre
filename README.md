# LaunchPadre

A Git workflow dashboard with snapshot, Kanban, billing, source inspection, and academic archive views.

## Current status

The Node application is a **demo**, with seeded users and repositories and in-memory state. Checkout URLs, DOI creation, snapshots, and rollbacks in this server are simulated. A green health check means the demo server is running; it does not verify external services. Do not enter real payment information or rely on this dashboard to protect a repository.

The Python backend contains separate implementations for PostgreSQL, GitPython, Stripe, and Zenodo. It is not connected to the Node dashboard server and has not been validated for production. Its presence does not make those integrations live.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Development and production now use the same Express API. `PORT` changes the listening port. Environment values are loaded from `.env`.

## Build and run a demo deployment

```sh
npm run lint
npm run build
NODE_ENV=production LAUNCHPADRE_DEMO=true npm start
```

Production startup requires explicit acknowledgment of demo mode. The dashboard displays the same limitation. State resets on restart. Run this as a local or access-controlled demo only: there is no user authentication or tenant isolation.

`GET /healthz` returns `{ "status": "ok", "mode": "demo" }`. Unknown API paths return JSON 404 responses instead of the frontend HTML.

## Verification

```sh
npm test
```

The smoke test starts the built application on a temporary local port and verifies health, repository loading, snapshot retrieval using the dashboard route, and unknown API responses.

## Work required before a live product

- Select and connect one authoritative persistent backend; remove the alternative demo data path.
- Implement authentication, repository ownership checks, and authorization for every destructive operation.
- Connect real repository registration and Git operations, including rollback recovery and per-repository locking tests.
- Replace fabricated checkout sessions with Stripe API calls and validate signed webhook replay handling.
- Connect Zenodo with sandbox validation before allowing irreversible publication.
- Add database migrations, backup and recovery checks, integration tests, and deployment secrets.
- Audit the Python backend and reconcile every frontend endpoint and response contract.

No license has been selected for this repository. Repository ownership alone does not select MIT or another license.
