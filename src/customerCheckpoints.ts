import type { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { GitWorkspace } from './gitWorkspace.ts';
import { snapshotLimitReached, type PlanId } from './plans.ts';

type Customer = { id: string; plan: PlanId };

export class CheckpointError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class CustomerCheckpoints {
  constructor(private db: DatabaseSync, private root: string | undefined) {
    db.exec(`CREATE TABLE IF NOT EXISTS customer_git_bindings (
      repository_id TEXT PRIMARY KEY REFERENCES customer_repositories(id) ON DELETE CASCADE,
      customer_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      UNIQUE(customer_id,relative_path)
    )`);
  }

  private owned(customer: Customer, repositoryId: string) {
    const repo = this.db.prepare('SELECT id FROM customer_repositories WHERE id=? AND customer_id=?')
      .get(repositoryId, customer.id);
    if (!repo) throw new CheckpointError(404, 'Repository not found');
  }

  private workspace(customer: Customer) {
    if (!this.root) throw new CheckpointError(503, 'Git checkpoints need a configured customer Git root');
    if (!/^[a-f0-9]{32}$/.test(customer.id)) throw new CheckpointError(400, 'Invalid customer');
    const base = fs.realpathSync(this.root);
    const tenant = path.join(base, customer.id);
    // The operator provisions each customer's directory. Never follow a tenant symlink.
    if (!fs.existsSync(tenant) || fs.realpathSync(tenant) !== tenant || !fs.lstatSync(tenant).isDirectory()) {
      throw new CheckpointError(409, 'Ask the workspace operator to provision your customer Git directory');
    }
    return new GitWorkspace(tenant);
  }

  private binding(customer: Customer, repositoryId: string) {
    this.owned(customer, repositoryId);
    const row = this.db.prepare('SELECT relative_path FROM customer_git_bindings WHERE repository_id=? AND customer_id=?')
      .get(repositoryId, customer.id) as { relative_path: string } | undefined;
    if (!row) throw new CheckpointError(409, 'Connect this repository to Git first');
    return row.relative_path;
  }

  info(customer: Customer, repositoryId: string) {
    this.owned(customer, repositoryId);
    const row = this.db.prepare('SELECT relative_path FROM customer_git_bindings WHERE repository_id=? AND customer_id=?')
      .get(repositoryId, customer.id) as { relative_path: string } | undefined;
    if (!row) return { enabled: Boolean(this.root), customer_directory: customer.id, relative_path: null, head: '', branch: '', unborn: true, snapshots: [] };
    const git = this.workspace(customer);
    return {
      enabled: true, customer_directory: customer.id, relative_path: row.relative_path,
      ...git.inspect(row.relative_path), snapshots: git.snapshots(row.relative_path),
    };
  }

  bind(customer: Customer, repositoryId: string, relative: unknown) {
    this.owned(customer, repositoryId);
    if (typeof relative !== 'string' || relative.length > 500) throw new CheckpointError(400, 'Enter a relative Git repository path');
    const git = this.workspace(customer);
    git.resolve(relative);
    const existing = this.db.prepare('SELECT relative_path FROM customer_git_bindings WHERE repository_id=?').get(repositoryId);
    if (existing && existing.relative_path !== relative) throw new CheckpointError(409, 'This repository already has a Git connection');
    const used = this.db.prepare('SELECT repository_id FROM customer_git_bindings WHERE customer_id=? AND relative_path=?').get(customer.id, relative);
    if (used && used.repository_id !== repositoryId) throw new CheckpointError(409, 'This Git repository is already connected');
    this.db.prepare('INSERT OR IGNORE INTO customer_git_bindings VALUES (?,?,?)').run(repositoryId, customer.id, relative);
    return this.info(customer, repositoryId);
  }

  create(customer: Customer, repositoryId: string, name: unknown) {
    if (typeof name !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(name)) {
      throw new CheckpointError(400, 'Use 1–64 lowercase letters, numbers, underscores or hyphens');
    }
    // The SQLite write lock serializes quota checks and Git writes across app processes.
    // Git refs are the durable checkpoint records, including after an interrupted request.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const relative = this.binding(customer, repositoryId);
      const git = this.workspace(customer);
      const current = git.snapshots(relative);
      const tag = `panic_room_launchpadre_${name}`;
      const existing = current.find(snapshot => snapshot.tag === tag);
      if (existing) return existing;
      const account = this.db.prepare("SELECT CASE WHEN billing_mode=? THEN plan ELSE 'free' END AS plan FROM customer_accounts WHERE id=?")
        .get(process.env.STRIPE_MODE || 'test', customer.id);
      if (snapshotLimitReached(account?.plan as PlanId, current.length)) {
        throw new CheckpointError(402, 'Free Developer allows one checkpoint per repository');
      }
      return git.snapshot(relative, name);
    } finally { this.db.exec('COMMIT'); }
  }

  rollback(customer: Customer, repositoryId: string, input: { tag?: unknown; expected_head?: unknown; expected_target?: unknown }) {
    if (typeof input.tag !== 'string' || typeof input.expected_head !== 'string' || typeof input.expected_target !== 'string' ||
        !/^[a-f0-9]{40,64}$/.test(input.expected_head) || !/^[a-f0-9]{40,64}$/.test(input.expected_target)) {
      throw new CheckpointError(400, 'Refresh the repository and select a checkpoint before restoring');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const relative = this.binding(customer, repositoryId);
      return this.workspace(customer).rollback(relative, input.tag, input.expected_head, input.expected_target);
    } finally { this.db.exec('COMMIT'); }
  }
}
