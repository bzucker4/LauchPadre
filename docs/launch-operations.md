# LauchPadre deployment and account operations

The application uses Node.js 24+, Git, Python 3 for backup/restore, a persistent SQLite workspace database, and persistent customer Git directories. Run `npm ci`, `npm run typecheck`, `npm test` and `npm run build` before a release. `npm start` loads `.env` without overriding variables already supplied by the environment.

## Runtime

Configure the database and Git root using absolute persistent paths. Generate independent random values of at least 32 characters for `LAUNCHPADRE_ACCESS_TOKEN` and `WEBHOOK_SECRET`. Keep environment files private and outside version control. The existing database gains account-verification and billing-mode columns through additive migrations. Existing customer, task, Git-binding and test-customer records are retained.

Use `LAUNCHPADRE_BIND_HOST=127.0.0.1` when serving through a reverse proxy on the same computer. Set `LAUNCHPADRE_TRUST_PROXY=loopback` only when that proxy is the trusted incoming path. Public traffic needs HTTPS. The app's customer cookies use Secure in production. The listener also supports other deployment bind addresses through `LAUNCHPADRE_BIND_HOST`.

`GET /healthz` reports process liveness. `GET /readyz` checks database access and the built client. Configure your process supervisor to restart on failure and your uptime monitor to request `/readyz`. SIGTERM and SIGINT drain HTTP requests before the database closes. A Chromebook deployment depends on its Linux environment staying running and the device remaining awake and connected.

`npm run doctor` checks local configuration. `npm run doctor -- --public` checks public configuration as well. These commands report presence and format only. They do not certify delivery, payments, external reachability or policies.

## Email and accounts

The included sender uses Resend's email API. Set `RESEND_API_KEY`, `LAUNCHPADRE_EMAIL_FROM` to an authorized sender on your verified sending domain, and `LAUNCHPADRE_PUBLIC_ORIGIN` to the application's exact origin. For local testing, that origin may be HTTP on localhost. Public deployment uses HTTPS. The sender module can be replaced if another delivery service is preferred.

Customers request verification from the Account panel. Enable `LAUNCHPADRE_REQUIRE_VERIFIED_EMAIL=true` to require verified addresses before checkout. Enabling it requires email configuration at startup. Existing accounts remain unverified until they complete verification.

Forgot-password requests return the same accepted message for known and unknown addresses. Verification links expire after 24 hours, reset links after 30 minutes, and each link works once. Email requests have a persistent one-minute cooldown per address and purpose, in addition to the IP request limit. Requesting a newer link invalidates the older link of the same type. Reset-request responses use the same minimum delay and do not await the email provider. Tokens are hashed in SQLite and placed in URL fragments to avoid sending them in HTTP request paths. Resetting a password revokes every session and outstanding action token for that account and requests a password-change notification. The UI requires the new password twice.

Without email configuration, the UI and API report that email operations are unavailable. Provider failures are logged without email addresses, links or keys. Validate a delivered verification email and password reset email before public signup. The November 18 browser check used locally issued disposable tokens, so actual delivery remains unverified.

## Billing environments and customer management

`STRIPE_MODE=test` is the default. Live mode requires `STRIPE_MODE=live`, matching live restricted/secret credentials, live price IDs and the live webhook signing secret. Use separate databases, keys and webhook endpoints for development and production. Customer mappings and checkout attempts are separated by mode. Session and checkpoint entitlement queries grant a stored paid plan only in the mode that established it.

Use the configured Indie Solo prices of USD 5 monthly or USD 39 annually. Academic checkout is unavailable while customer Zenodo workflows are unfinished. Existing Academic mappings and subscriptions remain recognized by webhook reconciliation.

Webhook forwarding or the production Stripe endpoint must include these events.

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`
- `invoice.paid`
- `invoice.payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `radar.early_fraud_warning.created`

All events require the raw-body signature check and the configured mode. Subscription access is reconciled against current Stripe state, including retries and older events. A durable reconciliation generation prevents a slow earlier request from overwriting a newer reconciliation result. The success URL grants no access. Refund, dispute and fraud-warning events create durable operator-review records in `stripe_billing_reviews`. They do not automatically issue refunds or cancel subscriptions. Operators inspect unresolved rows, resolve the underlying Stripe event, and set `resolved_at` after review. The customer workspace displays that a review is pending.

Configure Stripe's Customer Portal for subscription cancellation, payment-method updates and invoices. Optionally set `STRIPE_PORTAL_CONFIGURATION` to this application's portal configuration. The app creates portal sessions only for the signed-in account's mapped customer in the current mode.

Concurrent checkout requests share a durable attempt and Stripe idempotency key. Open sessions are reused. Customers can cancel an open checkout before choosing another offer. Completed sessions are retained while subscription reconciliation is pending. A fresh checkout after subscription cancellation uses a new attempt. An unresolved attempt older than 23 hours needs operator reconciliation against Stripe request logs before the attempt is removed, because Stripe can expire idempotency records after 24 hours.

Stripe requests pin API version `2026-10-28.endive`. Keep webhook destination versions aligned when configuring production. Automatic tax remains off. Confirm applicable registrations, product tax classification and price tax behavior before enabling collection.

## Backup and restore

Pause external Git edits during a backup. The command takes a SQLite write lock while copying the database and Git root, so app writes may briefly fail or wait. Schedule a maintenance window for larger repositories. Git working files, tags and recovery refs are copied together. Symlinks are preserved without following their targets.

```bash
npm run backup -- /absolute/path/workspace.db /absolute/path/new-backup --git-root /absolute/path/customer-git
npm run restore -- /absolute/path/new-backup /absolute/path/new-restore
```

The destination must be new. The backup includes a versioned manifest and SHA-256 inventory, and an incomplete marker remains if a backup fails. Restore checks the manifest, file contents and SQLite integrity before copying. It refuses an existing destination. The command never replaces the active database. Keep backups private because they contain password hashes, sessions and customer repositories.

After restoring, start a separate app with `LAUNCHPADRE_WORKSPACE_DB=<restore>/workspace.db` and `LAUNCHPADRE_CUSTOMER_GIT_ROOT=<restore>/customer-git`. Verify account access, repository and task counts, Git checkpoints and recovery refs before switching the production service to those paths. Keep an independently protected off-device backup for device failure.

On November 18, 2026, actual Chromebook preview and billing databases were backed up. A separate restore matched account, repository, task and Git-binding records and retained the prior Git recovery object. Automated tests also verify corrupted-backup rejection and refusal to overwrite an existing restore directory.

## Owner information still required for public launch

Choose the public hostname and support email, configure the authorized email sender, and supply the seller identity and operational details for the privacy notice and terms. Set LAUNCHPADRE_SUPPORT_EMAIL, LAUNCHPADRE_PRIVACY_URL and LAUNCHPADRE_TERMS_URL to show the reviewed support and policy links in the app. Only HTTPS policy URLs are accepted. In particular, identify where production data and backups will be stored, retention/deletion handling, customer support and cancellation/refund terms. No public policy or seller identity has been invented for this project.

Verify public HTTPS access and email delivery after those settings are available. Complete a live billing test only after the live Stripe catalog, portal, webhook, tax decisions and policies are configured. The local development build and sandbox evidence do not establish these production facts. The expanded live-mode, Customer Portal and pinned-version code has passed simulated-provider tests, but a fresh direct sandbox run is pending after the Chromebook connection timed out.
