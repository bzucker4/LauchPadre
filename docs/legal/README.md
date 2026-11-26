# Legal drafts: read before publishing

`terms-of-service.md` and `privacy-policy.md` are **drafts written from what the code actually does**. They are not legal advice and have not been reviewed by a lawyer. Have a qualified attorney review them for your jurisdiction before launch, especially because you take payments and store customer data.

## How the pages are served
The server renders these two files at `/terms` and `/privacy` and links them from the sign-in screen. Each `[PLACEHOLDER]` is filled from an environment variable: `LEGAL_COMPANY`, `LEGAL_ADDRESS`, `LEGAL_CONTACT_EMAIL`, `LEGAL_GOVERNING_LAW`, `LEGAL_EFFECTIVE_DATE`, `LEGAL_HOSTING_PROVIDER`, `LEGAL_LOG_RETENTION`, `LEGAL_BACKUP_RETENTION`; `[PRODUCT_URL]` comes from `PUBLIC_ORIGIN`. **In production the server refuses to start while any are unset**, so placeholders can never go live. Edit the wording in these Markdown files (headings, `-` lists, tables, `**bold**` and `` `code` `` are supported). New sign-ups must tick a consent box; the acceptance time is stored in `customer_accounts.terms_accepted_at` (empty for accounts created earlier).

## Facts the drafts rely on (re-check if the product changes)
- Data collected: email, scrypt password hash, session cookie `lp_customer` (8 h), repository names, task titles, checkpoint names/Git refs, plan and billing status. No analytics or advertising cookies.
- Sub-processors named: Stripe (billing), Resend (email), Zenodo (only when the customer publishes), and your hosting provider. Fonts are self-hosted (bundled from `@fontsource`), so no third party sees visitors' IP addresses for fonts.
- Customer Git repositories are provisioned by the operator on the server, so the operator can technically access that source.
- Plans and prices come from `src/plans.ts` ($5/mo or $39/yr; $9/mo or $69/yr; Free = 3 repositories, 1 checkpoint per repository).

## Gaps the drafts expose (product work, not wording)
1. **Account deletion and data export are self-serve** ("Your Data" panel). The policy still offers email requests as a fallback. Deletion removes the account and workspace rows, deletes the customer's Git directory under `LAUNCHPADRE_CUSTOMER_GIT_ROOT`, deletes the Stripe customer (cancelling the subscription immediately, no refund) and removes unpublished Zenodo drafts. It aborts without deleting the account if Stripe or Zenodo cannot be reached. Published DOIs, Stripe's own retained records and encrypted backups are not affected. The JSON export excludes repository source and Git checkpoints (see its `not_included` field); the policy's "export" promise should be read as covering that, or offer a Git bundle on request.
2. **No data-retention job** exists. The policy commits to deleting account data after deletion requests and on a backup cycle; confirm your backup rotation matches the number in section 8 of the policy.
3. **Tax, refund and cancellation behavior** in the Terms assumes Stripe handles tax collection and that cancellation takes effect at period end. Confirm your Stripe settings match.
4. **Age floor** is set to 16. Adjust if you target another market.
5. If you change the Terms materially, you currently have no mechanism to re-collect acceptance from existing users (the Terms promise 30 days' notice by email).
