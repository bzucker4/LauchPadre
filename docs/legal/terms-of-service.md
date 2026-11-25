# LaunchPadre Terms of Service

**Effective date:** [EFFECTIVE_DATE]
**Provider:** [COMPANY], [ADDRESS] ("LaunchPadre", "we", "us")
**Contact:** [CONTACT_EMAIL]

These Terms govern your use of LaunchPadre at [PRODUCT_URL] (the "Service"). By creating an account or using the Service you agree to them. If you do not agree, do not use the Service.

## 1. The Service
LaunchPadre is a developer workspace that provides account-based repository and task tracking, Git checkpoints with guarded restore, subscription billing, and (on the Academic Researcher plan) archiving of committed repository snapshots to Zenodo. We may change, add or remove features. If we make a change that materially reduces what a paid plan includes, we will give you reasonable notice and you may cancel for a pro-rated refund of the unused period.

## 2. Eligibility and accounts
- You must be at least 16 and able to form a binding contract. If you use the Service for an organization, you confirm you may bind it.
- Provide an accurate email address and verify it. You are responsible for keeping your password confidential and for activity under your account. Tell us promptly at [CONTACT_EMAIL] if you suspect unauthorized access.
- One person or entity per account. Do not share credentials.

## 3. Plans, billing and cancellation
- **Plans.** Free Developer (up to 3 repositories and 1 checkpoint per repository), Indie Solo ($5/month or $39/year) and Academic Researcher ($9/month or $69/year). Prices are in US dollars and may change for future billing periods with at least 30 days' notice.
- **Payment.** Paid plans are billed in advance through Stripe and renew automatically until cancelled. You authorize us and Stripe to charge your payment method each period. Taxes are added where required.
- **Cancellation.** You can cancel any time in the Stripe billing portal ("Manage subscription"). Cancellation takes effect at the end of the current paid period; you keep paid features until then.
- **Refunds.** Fees are non-refundable except where required by law, as stated in section 1, or where we agree in writing.
- **Downgrades.** After a downgrade or lapse, your existing repositories and checkpoints remain visible and restorable, but plan limits apply to new items, and features that require a paid plan (such as Zenodo archiving) stop being available for new actions.
- **Failed payment.** If a payment fails we may retry and may downgrade the account to Free.

## 4. Your content
- You keep all rights in the repositories, code, task text and other content you put into the Service ("Your Content").
- You grant us a limited, non-exclusive licence to host, store, process and back up Your Content solely to operate and support the Service for you.
- You are responsible for Your Content and for having the right to use it in the Service, including the right to publish it if you use Zenodo archiving.
- We do not use Your Content to train AI models and we do not sell it. The Service blocks known AI-training crawlers from our public pages and API.

## 5. Git checkpoints and restore
Checkpoints are Git tags on committed history. **Restoring a checkpoint resets the repository's HEAD** after you confirm. The Service refuses to restore when the working tree has uncommitted, untracked or ignored changes and records the previous HEAD under a recovery ref. You are responsible for committing your work and for confirming restores. Recovery refs and checkpoints depend on your repository's Git data staying intact; they are not a substitute for your own backups.

Repositories are provisioned by the Service operator on our infrastructure. Do not store secrets, credentials or regulated data (for example health or payment-card data) in repositories you connect unless we have agreed otherwise in writing.

## 6. Zenodo archiving (Academic Researcher plan)
When you choose to archive, the Service packages the committed HEAD of your repository (never `.git` or uncommitted files), uploads it to Zenodo as a draft, and mints a DOI only after you explicitly confirm publication.
- **Publication to Zenodo is public and effectively permanent.** A DOI and the archived files generally cannot be withdrawn or deleted by us or by you. Zenodo's own terms and policies apply to what you publish and are controlled by Zenodo, not us.
- Confirm that you hold the rights to publish the contents and that they contain no secrets, personal data or confidential material. You are solely responsible for that review. Sandbox deposits are for testing only and may be deleted by Zenodo at any time.

## 7. Acceptable use
You will not:
- break the law or infringe others' rights, including by storing or publishing content you do not have the right to use;
- store or distribute malware, or use the Service to attack other systems;
- probe, scan or test the Service's security without our written permission (report vulnerabilities to [CONTACT_EMAIL] instead);
- bypass plan limits, rate limits or access controls, or access another customer's data;
- scrape, crawl or harvest the Service, or use it or its content to train machine-learning models;
- overload or disrupt the Service or resell it without our agreement.

We may suspend or remove content or accounts that violate these Terms or threaten the Service or other users. Where reasonable we will tell you why and give you a chance to fix the problem first.

## 8. Intellectual property
We and our licensors own the Service, its software, design and branding. We grant you a limited, revocable, non-transferable right to use the Service under these Terms. Feedback you send us may be used without obligation to you.

## 9. Availability, backups and changes
We aim to keep the Service available but do not guarantee uninterrupted or error-free operation, and we may take it down for maintenance. We take backups for our own operational recovery but do not promise to restore individual items. Keep your own copies of anything important.

## 10. Ending the relationship
You may stop using the Service and request account deletion at any time at [CONTACT_EMAIL]; see our Privacy Policy for what is deleted and when. We may suspend or terminate your account for material breach of these Terms, non-payment, or legal requirement, and may discontinue the Service on at least 30 days' notice (with a pro-rated refund of prepaid fees if we discontinue it). Sections that by nature should survive (including 4, 6, 8, 11–14) survive termination.

## 11. Disclaimers
THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE". TO THE FULLEST EXTENT PERMITTED BY LAW WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND THAT THE SERVICE WILL BE SECURE, UNINTERRUPTED OR FREE OF DATA LOSS. Nothing here limits rights you have under mandatory consumer law.

## 12. Limitation of liability
TO THE FULLEST EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, DATA OR GOODWILL. OUR TOTAL LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE IS LIMITED TO THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM AND (B) US$50. These limits do not apply to liability that cannot be limited by law, such as for fraud or for death or personal injury caused by negligence.

## 13. Indemnity
You will defend and indemnify us against third-party claims and resulting losses arising from Your Content or your breach of these Terms, except to the extent caused by us. This section does not apply to consumers where prohibited by law.

## 14. Governing law and disputes
These Terms are governed by the laws of [GOVERNING_LAW], without regard to conflict-of-law rules. Courts located in [GOVERNING_LAW] have exclusive jurisdiction, except that mandatory consumer-protection rules of your country of residence continue to apply. Before filing a claim, please contact [CONTACT_EMAIL] so we can try to resolve it informally.

## 15. Changes to these Terms
We may update these Terms. For material changes we will notify you by email or in the Service at least 30 days before they take effect. Continuing to use the Service after that date means you accept the update; if you do not, you may cancel before it takes effect.

## 16. General
These Terms and the Privacy Policy are the entire agreement between us about the Service. If a provision is unenforceable the rest remains in effect. Our failure to enforce a provision is not a waiver. You may not assign these Terms without our consent; we may assign them in a merger or sale of the business. Notices to you may be sent to your account email; notices to us go to [CONTACT_EMAIL].
