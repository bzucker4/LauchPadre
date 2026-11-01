# LaunchPadre release evidence

This checklist separates automated evidence from checks that still require a real installation, payment account, or outside tester. Passing the automated suite does not mean the product is ready to charge customers.

## Automated checks in this branch

Run `npm run build` and `npm test`. CI also runs `npm run lint`.

- API handling distinguishes unavailable servers, expired sessions, missing endpoints, and valid responses with payments disabled.
- The local launcher refuses an occupied port before building frontend files.
- `npm run doctor` checks the running API version, sign-in, and billing availability without printing secrets.
- Temporary-repository tests verify immutable checkpoints, stale-HEAD/tag rejection, dirty/staged/untracked/ignored-file rejection, and Git lock rejection.
- A stopped-workspace copy restores SQLite tasks and Git history and can roll back independently of the source workspace.
- A subprocess is killed after writing a real recovery ref and immediately before running reset. The old HEAD remains recoverable and retry succeeds.
- Monthly/annual checkout construction rejects configured Stripe amounts that differ from advertised prices.
- Free quotas, signed ingestion, webhook replay handling, sign-in/out, and local HTTP behavior are covered by smoke tests.

The interruption check does **not** simulate a power loss halfway through Git's filesystem update. Backup copying in the test is performed after SQLite is closed; it does not validate copying a running WAL database.

## Local owner validation — still required

- [ ] Update the Chromebook installation, restart once, and run `npm run doctor` from a second terminal. Confirm no checkout-availability error when payments are merely unconfigured.
- [ ] Run `npm run test:recovery` locally and retain its result.
- [ ] Install from the README in a clean Linux environment, without reusing an existing configuration or database.
- [ ] Confirm stopping/restarting the app preserves tasks and registered repository metadata.
- [ ] Confirm a user understands that a checkpoint contains committed files, not their uncommitted AI edits.
- [ ] Stop the app, back up the complete data and repository directories, restore into a separate location, and validate them before relying on that backup.

## Payment and distribution gates — still required

- [ ] Choose the product being sold: a self-hosted source kit or a licensed customer application. Current source-level plan checks are not license protection.
- [ ] Provide a purchase-to-access design where buyers never receive the seller's Stripe secret key or need their own merchant account.
- [ ] Test successful payment, decline, abandoned checkout, renewal, cancellation, refund policy, webhook retries, and duplicate events with Stripe test credentials.
- [ ] Demonstrate correct paid access on a separate customer installation, including an offline/restart policy and downgrade behavior.
- [ ] Verify any public webhook/licensing service over HTTPS. A loopback-only customer installation cannot directly receive outside webhooks.

These gates are not completed by adding Stripe credentials to the seller's local workspace. No live charge should be used as a substitute for a complete test-mode purchase flow.

## Academic feature — still required if advertised

- [ ] Use a disposable committed repository with Zenodo sandbox credentials.
- [ ] Inspect the uploaded ZIP and metadata before publication.
- [ ] Publish only through the separate confirmation and verify the resulting DOI record.
- [ ] Interrupt/retry an upload and confirm the saved deposition is reused appropriately.

## Outside-user evidence — still required

- [ ] Have five target users install, sign in, register a disposable repository, create a checkpoint, and recover a commit without live coaching.
- [ ] Record completion time, failures, support questions, and whether they understand the committed-work limitation.
- [ ] Verify they would pay the displayed price for that demonstrated workflow; distinguish willingness to pay from compliments.
- [ ] Resolve every data-loss failure before a paid beta and publish accurate support, update, and refund terms.

The current build remains a local single-owner application. Central customer licensing, external-account validation, and independent tester evidence are outstanding.
