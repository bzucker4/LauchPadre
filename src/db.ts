import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';

// ============================================================================
// RELATIONAL DATABASE INITIALIZATION & INDEXED SCHEMAS
// ============================================================================

export interface UserRow {
  id: number;
  username: string;
  email: string;
  plan: 'free' | 'indie_solo' | 'academic_tier';
  is_premium: number; // 0 or 1
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepositoryRow {
  id: number;
  owner_id: number;
  forgejo_repo_id: number;
  name: string;
  full_name: string;
  default_branch: string;
  head_commit_sha: string;
  is_unborn_head: number; // 0 or 1
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: number;
  repository_id: number;
  title: string;
  status: 'todo' | 'in_progress' | 'done';
  markdown_file_path: string;
  created_at: string;
  updated_at: string;
}

export interface CommitRow {
  id: number;
  repository_id: number;
  commit_sha: string;
  message: string;
  author_name: string;
  author_email: string;
  committed_at: string;
  ingested_at: string;
}

export interface AcademicDoiRow {
  id: number;
  repository_id: number;
  forgejo_repo_id: number;
  commit_sha: string;
  deposition_id: string;
  doi: string;
  doi_url: string;
  badge_url: string;
  title: string;
  archive_filename: string;
  archive_size_bytes: number;
  creator_name: string;
  creator_affiliation: string;
  minted_at: string;
}

export interface PanicSnapshotRow {
  id: string;
  repository_id: number;
  forgejo_repo_id: number;
  tag_name: string;
  sanitized_name: string;
  target_commit_sha: string;
  commit_message: string;
  author_name: string;
  author_email: string;
  created_at: string;
  is_head_commit: number; // 0 or 1
  message: string | null;
}

export interface UntrackedSlopRow {
  id: string;
  repository_id: number;
  file_path: string;
  size_bytes: number;
  created_by_slop: string;
  generated_at: string;
}

export interface AuditLogRow {
  id: string;
  timestamp: string;
  level: string;
  event: string;
  correlation_id: string;
  status_code: number;
  details: string;
}

export interface ScraperProbeRow {
  id: string;
  timestamp: string;
  user_agent: string;
  matched_signature: string;
  status: string;
  client_ip: string;
  path: string;
}

export class LaunchPadreDatabase {
  public db: DatabaseSync;

  constructor(dbPath: string = ':memory:') {
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
    this.seedInitialData();
  }

  private initSchema() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        plan TEXT NOT NULL DEFAULT 'free',
        is_premium INTEGER NOT NULL DEFAULT 0,
        stripe_customer_id TEXT UNIQUE,
        stripe_subscription_id TEXT UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);

      CREATE TABLE IF NOT EXISTS repositories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        forgejo_repo_id INTEGER NOT NULL UNIQUE,
        name TEXT NOT NULL,
        full_name TEXT NOT NULL,
        default_branch TEXT NOT NULL DEFAULT 'main',
        head_commit_sha TEXT NOT NULL DEFAULT '',
        is_unborn_head INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_repos_forgejo ON repositories(forgejo_repo_id);

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
        markdown_file_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_repo_status ON tasks(repository_id, status);

      CREATE TABLE IF NOT EXISTS commits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        commit_sha TEXT NOT NULL UNIQUE,
        message TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_email TEXT NOT NULL,
        committed_at TEXT NOT NULL,
        ingested_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_commits_repo ON commits(repository_id);
      CREATE INDEX IF NOT EXISTS idx_commits_sha ON commits(commit_sha);

      CREATE TABLE IF NOT EXISTS task_commit_links (
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        commit_id INTEGER NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
        action_type TEXT NOT NULL,
        linked_at TEXT NOT NULL,
        PRIMARY KEY (task_id, commit_id)
      );
      CREATE INDEX IF NOT EXISTS idx_links_task ON task_commit_links(task_id);

      CREATE TABLE IF NOT EXISTS academic_dois (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        forgejo_repo_id INTEGER NOT NULL,
        commit_sha TEXT NOT NULL,
        deposition_id TEXT NOT NULL,
        doi TEXT NOT NULL UNIQUE,
        doi_url TEXT NOT NULL,
        badge_url TEXT NOT NULL,
        title TEXT NOT NULL,
        archive_filename TEXT NOT NULL,
        archive_size_bytes INTEGER NOT NULL DEFAULT 0,
        creator_name TEXT NOT NULL,
        creator_affiliation TEXT NOT NULL,
        minted_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dois_repo ON academic_dois(repository_id);

      CREATE TABLE IF NOT EXISTS panic_snapshots (
        id TEXT PRIMARY KEY,
        repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        forgejo_repo_id INTEGER NOT NULL,
        tag_name TEXT NOT NULL,
        sanitized_name TEXT NOT NULL,
        target_commit_sha TEXT NOT NULL,
        commit_message TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        is_head_commit INTEGER NOT NULL DEFAULT 0,
        message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_repo ON panic_snapshots(repository_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_repo_tag ON panic_snapshots(repository_id, tag_name);

      CREATE TABLE IF NOT EXISTS untracked_slop (
        id TEXT PRIMARY KEY,
        repository_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_by_slop TEXT NOT NULL,
        generated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_slop_repo ON untracked_slop(repository_id);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        event TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        details TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(timestamp DESC);

      CREATE TABLE IF NOT EXISTS scraper_probes (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        matched_signature TEXT NOT NULL,
        status TEXT NOT NULL,
        client_ip TEXT NOT NULL,
        path TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_probes_time ON scraper_probes(timestamp DESC);
    `);
  }

  public seedInitialData() {
    const now = new Date(Date.now() - 3600_000 * 5).toISOString();
    const later = new Date(Date.now() - 3600_000 * 2).toISOString();
    const recent = new Date(Date.now() - 1800_000).toISOString();
    const headCommit1 = '91b7e4d20a8c3f567890123456789abcdef98765';
    const baselineCommit1 = '8f3d9a12b4e6c7d890123456789abcdef0123456';

    const insertUser = this.db.prepare(`
      INSERT INTO users (id, username, email, plan, is_premium, stripe_customer_id, stripe_subscription_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertUser.run(1, 'elena_solo', 'elena@launchpadre.dev', 'indie_solo', 1, 'cus_launchpadre_elena_4092', 'sub_launchpadre_solo_active_01', now, recent);
    insertUser.run(2, 'prof_turner', 'turner@stanford.edu', 'academic_tier', 1, 'cus_launchpadre_turner_8814', 'sub_launchpadre_academic_active_02', now, later);

    const insertRepo = this.db.prepare(`
      INSERT INTO repositories (id, owner_id, forgejo_repo_id, name, full_name, default_branch, head_commit_sha, is_unborn_head, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertRepo.run(1, 1, 4092, 'launchpadre-core', 'craftgit/launchpadre-core', 'main', headCommit1, 0, now, recent);
    insertRepo.run(2, 2, 8814, 'zenodo-doi-engine', 'craftgit/zenodo-doi-engine', 'main', '2a4e6b8c0d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a', 0, now, later);
    insertRepo.run(3, 1, 9940, 'fresh-unborn-repo', 'craftgit/fresh-unborn-repo', 'main', '', 1, recent, recent);

    const insertCommit = this.db.prepare(`
      INSERT INTO commits (id, repository_id, commit_sha, message, author_name, author_email, committed_at, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertCommit.run(1, 1, baselineCommit1, 'feat(core): initial production bootstrap\ntodo: Implement constant-time X-Gitea-Signature HMAC-SHA256 verification', 'Elena Rostova', 'elena@launchpadre.dev', now, now);
    insertCommit.run(2, 1, 'c4a91e07d2b5f8a3190456789abcdef012345678', 'sec(hmac): verify raw bytes\nfix: Implement constant-time X-Gitea-Signature HMAC-SHA256 verification', 'Elena Rostova', 'elena@launchpadre.dev', later, later);
    insertCommit.run(3, 1, headCommit1, 'feat(fintech): ship Stripe & Zenodo engine\nclose: Support Zenodo REST API deposition lifecycle with DOI citation badges\nclose: Implement Stripe checkout session with client_reference_id mapping', 'Elena Rostova', 'elena@launchpadre.dev', recent, recent);

    const insertTask = this.db.prepare(`
      INSERT INTO tasks (id, repository_id, title, status, markdown_file_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertTask.run(1, 1, 'Implement constant-time X-Gitea-Signature HMAC-SHA256 verification', 'done', '.launchpadre/tasks/implement-constant-time-x-gitea-signature-hmac-sha256-verificati.md', now, later);
    insertTask.run(2, 1, 'Configure asyncpg connection pool with SQLAlchemy 2.0 session factory', 'done', 'docs/kanban/asyncpg-connection-pool.md', now, later);
    insertTask.run(3, 1, 'Add bidirectional AST parser for Markdown frontmatter synchronization', 'in_progress', '.launchpadre/tasks/add-bidirectional-ast-parser-for-markdown-frontmatter-synchroniz.md', later, recent);
    insertTask.run(4, 1, 'Support Zenodo REST API deposition lifecycle with DOI citation badges', 'done', 'docs/kanban/zenodo-academic-doi-minting.md', recent, recent);
    insertTask.run(5, 1, 'Implement Stripe checkout session with client_reference_id mapping', 'done', 'docs/kanban/stripe-monetization-framework.md', recent, recent);

    const insertLink = this.db.prepare(`
      INSERT INTO task_commit_links (task_id, commit_id, action_type, linked_at)
      VALUES (?, ?, ?, ?)
    `);
    insertLink.run(1, 1, 'created_todo', now);
    insertLink.run(1, 2, 'resolved_fix', later);
    insertLink.run(4, 3, 'resolved_close', recent);
    insertLink.run(5, 3, 'resolved_close', recent);

    const insertDoi = this.db.prepare(`
      INSERT INTO academic_dois (id, repository_id, forgejo_repo_id, commit_sha, deposition_id, doi, doi_url, badge_url, title, archive_filename, archive_size_bytes, creator_name, creator_affiliation, minted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertDoi.run(
      1,
      1,
      4092,
      headCommit1,
      '10884920',
      '10.5281/zenodo.10884920',
      'https://doi.org/10.5281/zenodo.10884920',
      'https://zenodo.org/badge/DOI/10.5281/zenodo.10884920.svg',
      'LaunchPadre Core Engine v1.0.0 — Open Source Git Forge Architecture',
      'launchpadre_core_91b7e4d2.zip',
      428900,
      'Elena Rostova',
      'LaunchPadre Systems Research',
      recent
    );

    const insertSnapshot = this.db.prepare(`
      INSERT INTO panic_snapshots (id, repository_id, forgejo_repo_id, tag_name, sanitized_name, target_commit_sha, commit_message, author_name, author_email, created_at, is_head_commit, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertSnapshot.run('ps_1', 1, 4092, 'panic_room_launchpadre_baseline_stable', 'baseline_stable', baselineCommit1, 'feat(core): initial production bootstrap', 'Elena Rostova', 'elena@launchpadre.dev', now, 0, 'Pre-migration verified baseline release snapshot');
    insertSnapshot.run('ps_2', 1, 4092, 'panic_room_launchpadre_pre_fintech_deployment', 'pre_fintech_deployment', headCommit1, 'feat(fintech): ship Stripe & Zenodo engine', 'Elena Rostova', 'elena@launchpadre.dev', recent, 1, 'Checkpoint before Stripe webhook listener activation');

    const insertAudit = this.db.prepare(`
      INSERT INTO audit_logs (id, timestamp, level, event, correlation_id, status_code, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertAudit.run('audit_init', new Date().toISOString(), 'INFO', 'SQLITE_RELATIONAL_ACTIVE', 'boot_sql_001', 200, 'Embedded SQLite DatabaseSync engine initialized with B-tree indexed schemas');
  }

  public recordLog(level: string, event: string, statusCode: number, details: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_logs (id, timestamp, level, event, correlation_id, status_code, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(crypto.randomUUID(), new Date().toISOString(), level, event, crypto.randomUUID(), statusCode, details);
  }

  public resetAll() {
    this.db.exec(`
      DELETE FROM audit_logs;
      DELETE FROM scraper_probes;
      DELETE FROM untracked_slop;
      DELETE FROM panic_snapshots;
      DELETE FROM academic_dois;
      DELETE FROM task_commit_links;
      DELETE FROM tasks;
      DELETE FROM commits;
      DELETE FROM repositories;
      DELETE FROM users;
    `);
    this.seedInitialData();
  }
}

// Global database instance
export const database = new LaunchPadreDatabase();
