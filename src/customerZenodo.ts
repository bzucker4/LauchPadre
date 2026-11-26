import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { PLANS, type PlanId } from './plans.ts';
import type { CustomerCheckpoints } from './customerCheckpoints.ts';

type Customer = { id: string; plan: PlanId };

export interface CustomerZenodoArchive {
  id: string;
  repository_id: string;
  commit_sha: string;
  deposition_id: string;
  status: 'draft' | 'published';
  doi: string | null;
  doi_url: string | null;
  badge_url: string | null;
  sandbox: boolean;
  title: string;
  description: string;
  creator_name: string;
  creator_affiliation: string;
  archive_filename: string;
  archive_size_bytes: number;
  created_at: string;
  published_at: string | null;
}

export class ZenodoArchiveError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const ALLOWED_ZENODO_ORIGINS = new Set(['https://sandbox.zenodo.org', 'https://zenodo.org']);

export class CustomerZenodo {
  private token: string;
  private baseUrl: string;

  constructor(
    private db: DatabaseSync,
    private checkpoints: CustomerCheckpoints,
    private request: typeof fetch = fetch,
    options?: { token?: string; baseUrl?: string }
  ) {
    const rawToken = (options?.token ?? process.env.ZENODO_ACCESS_TOKEN ?? '').trim();
    this.token = rawToken && !rawToken.startsWith('<REPLACE_') ? rawToken : '';
    const rawBase = (options?.baseUrl ?? process.env.ZENODO_BASE_URL ?? 'https://sandbox.zenodo.org')
      .trim()
      .replace(/\/+$/, '');
    this.baseUrl = ALLOWED_ZENODO_ORIGINS.has(rawBase) ? rawBase : '';

    db.exec(`CREATE TABLE IF NOT EXISTS customer_zenodo_archives (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL REFERENCES customer_repositories(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
      commit_sha TEXT NOT NULL,
      deposition_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','published')),
      doi TEXT,
      doi_url TEXT,
      badge_url TEXT,
      sandbox INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      creator_name TEXT NOT NULL,
      creator_affiliation TEXT NOT NULL,
      archive_filename TEXT NOT NULL,
      archive_size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      published_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_customer_zenodo_repo ON customer_zenodo_archives(repository_id, customer_id);`);
  }

  configured(): boolean {
    return Boolean(this.token && this.baseUrl);
  }

  isSandbox(): boolean {
    return this.baseUrl !== 'https://zenodo.org';
  }

  private ownedRepo(customer: Customer, repositoryId: string): { id: string; name: string } {
    const repo = this.db
      .prepare('SELECT id, name FROM customer_repositories WHERE id=? AND customer_id=?')
      .get(repositoryId, customer.id) as { id: string; name: string } | undefined;
    if (!repo) throw new ZenodoArchiveError(404, 'Repository not found');
    return repo;
  }

  private currentPlan(customerId: string): PlanId {
    const row = this.db
      .prepare('SELECT plan FROM customer_accounts WHERE id=?')
      .get(customerId) as { plan: PlanId } | undefined;
    return row?.plan ?? 'free';
  }

  private ensureEligible(customer: Customer) {
    const plan = this.currentPlan(customer.id);
    if (!PLANS[plan].zenodo) {
      throw new ZenodoArchiveError(402, 'Academic Researcher plan is required to prepare or publish Zenodo archives');
    }
    if (!this.configured()) {
      throw new ZenodoArchiveError(503, 'Zenodo archival is not configured by the workspace operator');
    }
  }

  private formatRow(row: any): CustomerZenodoArchive {
    return {
      id: String(row.id),
      repository_id: String(row.repository_id),
      commit_sha: String(row.commit_sha),
      deposition_id: String(row.deposition_id),
      status: row.status === 'published' ? 'published' : 'draft',
      doi: row.doi ? String(row.doi) : null,
      doi_url: row.doi_url ? String(row.doi_url) : null,
      badge_url: row.badge_url ? String(row.badge_url) : null,
      sandbox: Boolean(row.sandbox),
      title: String(row.title),
      description: String(row.description),
      creator_name: String(row.creator_name),
      creator_affiliation: String(row.creator_affiliation),
      archive_filename: String(row.archive_filename),
      archive_size_bytes: Number(row.archive_size_bytes),
      created_at: String(row.created_at),
      published_at: row.published_at ? String(row.published_at) : null,
    };
  }

  list(customer: Customer, repositoryId: string) {
    this.ownedRepo(customer, repositoryId);
    const plan = this.currentPlan(customer.id);
    const rows = this.db
      .prepare(
        `SELECT * FROM customer_zenodo_archives WHERE repository_id=? AND customer_id=? ORDER BY created_at DESC`
      )
      .all(repositoryId, customer.id);
    return {
      configured: this.configured(),
      sandbox: this.isSandbox(),
      allowed: PLANS[plan].zenodo,
      archives: rows.map(row => this.formatRow(row)),
    };
  }

  /**
   * Deletes the customer's unpublished draft depositions from Zenodo. Published records are permanent
   * and untouched. Throws if any draft cannot be removed so the account is not deleted with data left behind.
   */
  async deleteDrafts(customerId: string): Promise<number> {
    const drafts = this.db
      .prepare("SELECT deposition_id, sandbox FROM customer_zenodo_archives WHERE customer_id=? AND status='draft'")
      .all(customerId) as { deposition_id: string; sandbox: number }[];
    let removed = 0;
    for (const draft of drafts) {
      const targetBase = draft.sandbox ? 'https://sandbox.zenodo.org' : 'https://zenodo.org';
      if (!this.token || targetBase !== this.baseUrl) {
        throw new ZenodoArchiveError(503, 'Zenodo is not configured for your draft archives; contact support to finish deletion');
      }
      const response = await this.request(
        `${this.baseUrl}/api/deposit/depositions/${encodeURIComponent(String(draft.deposition_id))}`,
        {
          method: 'DELETE',
          redirect: 'error',
          headers: { Authorization: `Bearer ${this.token}` },
          signal: AbortSignal.timeout(20_000),
        }
      );
      if (response.ok) removed += 1;
      else if (response.status !== 404 && response.status !== 410) {
        throw new ZenodoArchiveError(502, 'Zenodo could not remove your draft archives; try again later');
      }
    }
    return removed;
  }

  async createDraft(
    customer: Customer,
    repositoryId: string,
    input: { title?: unknown; description?: unknown; creator_name?: unknown; creator_affiliation?: unknown }
  ): Promise<CustomerZenodoArchive> {
    const repo = this.ownedRepo(customer, repositoryId);
    this.ensureEligible(customer);

    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const description =
      typeof input.description === 'string' && input.description.trim()
        ? input.description.trim()
        : 'Research software archive prepared via LaunchPadre.';
    const creatorName = typeof input.creator_name === 'string' ? input.creator_name.trim() : '';
    const creatorAffiliation =
      typeof input.creator_affiliation === 'string' ? input.creator_affiliation.trim() : '';

    if (title.length < 3 || title.length > 300) {
      throw new ZenodoArchiveError(400, 'Enter a publication title between 3 and 300 characters');
    }
    if (description.length > 5000) {
      throw new ZenodoArchiveError(400, 'Description must be 5000 characters or fewer');
    }
    if (!creatorName || creatorName.length > 200) {
      throw new ZenodoArchiveError(400, 'Enter a creator name');
    }
    if (creatorAffiliation.length > 300) {
      throw new ZenodoArchiveError(400, 'Affiliation must be 300 characters or fewer');
    }

    const { head, zip } = this.checkpoints.archive(customer, repositoryId);
    const safeName = repo.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'repository';
    const filename = `${safeName}_${head.slice(0, 8)}.zip`;

    const headers = { Authorization: `Bearer ${this.token}` };
    const depRes = await this.request(`${this.baseUrl}/api/deposit/depositions`, {
      method: 'POST',
      redirect: 'error',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(20_000),
    });
    if (!depRes.ok) throw new ZenodoArchiveError(502, 'Zenodo could not create a draft deposition');
    const dep = (await depRes.json()) as { id?: string | number; links?: { bucket?: string } };
    const depositionId = dep.id !== undefined && dep.id !== null ? String(dep.id) : '';
    const bucketUrl = dep.links?.bucket || '';
    if (!depositionId || !bucketUrl) {
      throw new ZenodoArchiveError(502, 'Invalid response from Zenodo deposition API');
    }
    let parsedBucket: URL;
    try {
      parsedBucket = new URL(bucketUrl);
    } catch {
      throw new ZenodoArchiveError(502, 'Invalid Zenodo upload bucket URL');
    }
    if (parsedBucket.origin !== this.baseUrl) {
      throw new ZenodoArchiveError(502, 'Rejected unexpected Zenodo upload origin');
    }

    const uploadRes = await this.request(`${bucketUrl.replace(/\/+$/, '')}/${encodeURIComponent(filename)}`, {
      method: 'PUT',
      redirect: 'error',
      headers: { ...headers, 'Content-Type': 'application/zip' },
      body: new Uint8Array(zip),
      signal: AbortSignal.timeout(60_000),
    });
    if (!uploadRes.ok) {
      throw new ZenodoArchiveError(502, 'Failed to upload repository archive to Zenodo');
    }

    const creator: { name: string; affiliation?: string } = { name: creatorName };
    if (creatorAffiliation) creator.affiliation = creatorAffiliation;
    const metaRes = await this.request(
      `${this.baseUrl}/api/deposit/depositions/${encodeURIComponent(depositionId)}`,
      {
        method: 'PUT',
        redirect: 'error',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: {
            title,
            upload_type: 'software',
            description,
            version: head.slice(0, 12),
            creators: [creator],
          },
        }),
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!metaRes.ok) {
      throw new ZenodoArchiveError(502, 'Failed to attach metadata to Zenodo draft');
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const sandbox = this.isSandbox() ? 1 : 0;
    this.db
      .prepare(
        `INSERT INTO customer_zenodo_archives
         (id, repository_id, customer_id, commit_sha, deposition_id, status, doi, doi_url, badge_url, sandbox,
          title, description, creator_name, creator_affiliation, archive_filename, archive_size_bytes, created_at, published_at)
         VALUES (?,?,?,?,?,'draft',NULL,NULL,NULL,?,?,?,?,?,?,?,?,NULL)`
      )
      .run(
        id,
        repositoryId,
        customer.id,
        head,
        depositionId,
        sandbox,
        title,
        description,
        creatorName,
        creatorAffiliation,
        filename,
        zip.length,
        createdAt
      );

    return this.formatRow(
      this.db.prepare('SELECT * FROM customer_zenodo_archives WHERE id=?').get(id)
    );
  }

  async publishDraft(
    customer: Customer,
    repositoryId: string,
    archiveId: string,
    confirm: unknown
  ): Promise<CustomerZenodoArchive> {
    this.ownedRepo(customer, repositoryId);
    this.ensureEligible(customer);
    if (confirm !== true) {
      throw new ZenodoArchiveError(400, 'Explicit confirmation is required before publishing a permanent DOI');
    }
    const existing = this.db
      .prepare('SELECT * FROM customer_zenodo_archives WHERE id=? AND repository_id=? AND customer_id=?')
      .get(archiveId, repositoryId, customer.id) as any;
    if (!existing) throw new ZenodoArchiveError(404, 'Zenodo archive draft not found');
    if (existing.status === 'published') return this.formatRow(existing);

    const targetBase = existing.sandbox ? 'https://sandbox.zenodo.org' : 'https://zenodo.org';
    if (targetBase !== this.baseUrl) {
      throw new ZenodoArchiveError(409, 'This draft belongs to a different Zenodo environment than currently configured');
    }

    const publishRes = await this.request(
      `${this.baseUrl}/api/deposit/depositions/${encodeURIComponent(String(existing.deposition_id))}/actions/publish`,
      {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!publishRes.ok) {
      throw new ZenodoArchiveError(502, 'Zenodo rejected the publish request');
    }
    const body = (await publishRes.json()) as {
      doi?: string;
      doi_url?: string;
      links?: { badge?: string; doi?: string };
    };
    const doi = typeof body.doi === 'string' && body.doi ? body.doi : '';
    if (!doi) throw new ZenodoArchiveError(502, 'Zenodo did not return a DOI after publishing');
    const doiUrl = body.doi_url || body.links?.doi || `https://doi.org/${doi}`;
    const badgeUrl = body.links?.badge || `${this.baseUrl}/badge/DOI/${doi}.svg`;
    const publishedAt = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE customer_zenodo_archives SET status='published', doi=?, doi_url=?, badge_url=?, published_at=?
         WHERE id=? AND customer_id=?`
      )
      .run(doi, doiUrl, badgeUrl, publishedAt, archiveId, customer.id);

    return this.formatRow(
      this.db.prepare('SELECT * FROM customer_zenodo_archives WHERE id=?').get(archiveId)
    );
  }
}
