# Legal drafts: read before publishing

`terms-of-service.md` and `privacy-policy.md` are **drafts written from what the code actually does**. They are not legal advice and have not been reviewed by a lawyer. Have a qualified attorney review them for your jurisdiction before launch, especially because you take payments and store customer data.

## Fill in every `[BRACKET]`
`[COMPANY]` legal entity name, `[ADDRESS]`, `[CONTACT_EMAIL]`, `[GOVERNING_LAW]` (jurisdiction/venue), `[EFFECTIVE_DATE]`, and `[PRODUCT_URL]`.

## Facts the drafts rely on (re-check if the product changes)
- Data collected: email, scrypt password hash, session cookie `lp_customer` (8 h), repository names, task titles, checkpoint names/Git refs, plan and billing status. No analytics or advertising cookies.
- Sub-processors named: Stripe (billing), Resend (email), Zenodo (only when the customer publishes), your hosting provider, and Google Fonts (loaded by `index.html`).
- Customer Git repositories are provisioned by the operator on the server, so the operator can technically access that source.
- Plans and prices come from `src/plans.ts` ($5/mo or $39/yr; $9/mo or $69/yr; Free = 3 repositories, 1 checkpoint per repository).

## Gaps the drafts expose (product work, not wording)
1. **No self-serve account deletion or data export exists.** The policy promises deletion/export *on request by email within 30 days*. Either keep that manual process or build the feature and update the text.
2. **Google Fonts** sends visitor IPs to Google. Self-host the fonts to remove that disclosure and avoid GDPR concerns.
3. **No data-retention job** exists. The policy commits to deleting account data after deletion requests and on a backup cycle; confirm your backup rotation matches the number in section 8 of the policy.
4. **Tax, refund and cancellation behavior** in the Terms assumes Stripe handles tax collection and that cancellation takes effect at period end. Confirm your Stripe settings match.
5. **Age floor** is set to 16. Adjust if you target another market.
6. The links are not yet wired into the app. Add `/terms` and `/privacy` routes plus a "By creating an account you agree…" line on the sign-up form.
