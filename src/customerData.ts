import type { DatabaseSync } from 'node:sqlite';
import type { CustomerAuth } from './customerAuth.ts';
import type { CustomerBilling } from './customerBilling.ts';
import type { CustomerCheckpoints } from './customerCheckpoints.ts';
import type { CustomerZenodo } from './customerZenodo.ts';

export const EXPORT_FORMAT_VERSION = 1;

/** Personal-data export and account deletion for a customer. */
export class CustomerData {
  constructor(
    private db: DatabaseSync,
    private auth: CustomerAuth,
    private billing: CustomerBilling,
    private checkpoints: CustomerCheckpoints,
    private zenodo: CustomerZenodo
  ) {}

  /** Everything we store about the customer, excluding credentials (password hash, session and email tokens). */
  export(customerId: string) {
    const account = this.db
      .prepare('SELECT id,email,plan,created_at,email_verified_at,terms_accepted_at FROM customer_accounts WHERE id=?')
      .get(customerId);
    if (!account) return null;
    const tasks = this.db.prepare(
      `SELECT t.id,t.repository_id,t.title,t.status,t.created_at FROM customer_tasks t
       JOIN customer_repositories r ON r.id=t.repository_id WHERE r.customer_id=? ORDER BY t.created_at,t.id`
    );
    const repositories = (
      this.db
        .prepare(
          `SELECT r.id,r.name,r.created_at,b.relative_path AS git_path FROM customer_repositories r
           LEFT JOIN customer_git_bindings b ON b.repository_id=r.id WHERE r.customer_id=? ORDER BY r.created_at,r.id`
        )
        .all(customerId) as { id: string }[]
    ).map((repo) => ({
      ...repo,
      tasks: (tasks.all(customerId) as { repository_id: string }[])
        .filter((t) => t.repository_id === repo.id)
        .map(({ repository_id: _ignored, ...task }) => task),
    }));
    const archives = this.db
      .prepare(
        `SELECT id,repository_id,commit_sha,deposition_id,status,doi,doi_url,sandbox,title,description,creator_name,
                creator_affiliation,archive_filename,archive_size_bytes,created_at,published_at
         FROM customer_zenodo_archives WHERE customer_id=? ORDER BY created_at,id`
      )
      .all(customerId);
    const stripe = this.db
      .prepare('SELECT stripe_customer_id FROM stripe_customer_accounts WHERE account_id=?')
      .get(customerId) as { stripe_customer_id: string } | undefined;
    return {
      format_version: EXPORT_FORMAT_VERSION,
      exported_at: new Date().toISOString(),
      account,
      repositories,
      zenodo_archives: archives,
      billing: stripe ? { stripe_customer_id: stripe.stripe_customer_id } : null,
      not_included: [
        'Password hash, session tokens and email tokens (credentials are never exported).',
        'Repository source code and Git checkpoints: these live in your own Git repositories. Contact support for a Git bundle of anything held on our servers.',
        'Payment details and invoices: these are held by Stripe and available from the billing portal.',
      ],
    };
  }

  /**
   * Permanently deletes the customer's data. External systems and files go first (idempotent, and any failure
   * aborts before the account is touched so the customer can retry); the database row, which cascades to
   * everything else, goes last.
   */
  async deleteAccount(customerId: string) {
    const zenodoDraftsRemoved = await this.zenodo.deleteDrafts(customerId);
    await this.billing.deleteStripeCustomer(customerId);
    const gitDataRemoved = this.checkpoints.removeTenantData(customerId);
    this.auth.deleteAccount(customerId);
    return { zenodoDraftsRemoved, gitDataRemoved };
  }
}
