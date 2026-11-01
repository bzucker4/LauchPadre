import { PLANS, effectivePlan, repositoryLimitReached, snapshotLimitReached } from './src/plans.ts';
import { ZenodoClient } from './src/zenodoClient.ts';
import { StripeClient } from './src/stripeClient.ts';
import { GitWorkspace } from './src/gitWorkspace.ts';
import { installAuthentication } from './src/serverSecurity.ts';
import { StateStore } from './src/stateStore.ts';
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// In AI Studio Cloud Run containers, Nginx reverse proxy binds to 8080 and routes to 3000.
// Node Express dev server must strictly bind to port 3000 (or CLI --port).
const portArgIdx = process.argv.indexOf('--port');
const cliPort = portArgIdx !== -1 && process.argv[portArgIdx + 1] ? Number(process.argv[portArgIdx + 1]) : null;
const PORT = cliPort ?? Number(process.env.PORT || 3000);
const localOnly = process.env.LOCAL_ONLY === 'true';
if (localOnly) process.env.APP_ORIGIN = `http://127.0.0.1:${PORT}`;
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
const demoMode = process.env.LAUNCHPADRE_DEMO === 'true' || (process.env.NODE_ENV !== 'production' && process.env.LAUNCHPADRE_DEMO !== 'false');
if (!demoMode && (!process.env.ADMIN_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.ADMIN_EMAIL))) {
  throw new Error('Live mode requires ADMIN_EMAIL for the workspace owner');
}
const WEBHOOK_SECRET =
  process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');
const STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');

// ============================================================================
// 1. TIMEZONE FORMATTER & AUDIT LOGGING
// ============================================================================

export function formatLocalIsoOffset(dateInput: Date = new Date()): string {
  const tzOffsetMin = -dateInput.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const year = dateInput.getFullYear();
  const month = pad(dateInput.getMonth() + 1);
  const day = pad(dateInput.getDate());
  const hours = pad(dateInput.getHours());
  const minutes = pad(dateInput.getMinutes());
  const seconds = pad(dateInput.getSeconds());
  const offsetHours = pad(tzOffsetMin / 60);
  const offsetMinutes = pad(tzOffsetMin % 60);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMinutes}`;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARNING' | 'ERROR';
  event: string;
  correlation_id: string;
  status_code: number;
  details: string;
}

const auditLogs: AuditLogEntry[] = [];

function recordLog(
  level: 'INFO' | 'WARNING' | 'ERROR',
  event: string,
  statusCode: number,
  details: string,
  correlationId: string = crypto.randomUUID()
): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: crypto.randomUUID(),
    timestamp: formatLocalIsoOffset(new Date()),
    level,
    event,
    correlation_id: correlationId,
    status_code: statusCode,
    details,
  };
  auditLogs.unshift(entry);
  if (auditLogs.length > 80) auditLogs.pop();
  return entry;
}

// ============================================================================
// 2. DATA SOVEREIGNTY DEFINITIONS
// ============================================================================

const BANNED_AI_SCRAPERS = [
  'gptbot',
  'chatgpt-user',
  'claudebot',
  'claude-web',
  'perplexitybot',
  'anthropic-ai',
  'google-extended',
  'bytespider',
  'ccbot',
  'facebookbot',
  'amazonbot',
  'applebot-extended',
  'omgilibot',
  'diffbot',
  'cohere-ai',
  'timpibot',
  'ai2bot',
];

const DYNAMIC_ROBOTS_TXT_CONTENT = `# ==============================================================================
# LaunchPadre Data Sovereignty Architecture — Anti-Scraper Directives
# Notice: Autonomous AI training and dataset extraction are strictly prohibited.
# ==============================================================================

User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Anthropic-AI
Disallow: /

User-agent: PerplexityBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: CCBot
Disallow: /

# General Crawlers (Strict Code Privacy Boundaries)
User-agent: *
Disallow: /*/src/
Disallow: /*/commits/
Disallow: /*/raw/
Disallow: /*/archive/
Disallow: /*/tree/
Disallow: /*/blob/
Disallow: /api/
Allow: /$
Allow: /robots.txt$
`;

interface ScraperProbeRecord {
  id: string;
  timestamp: string;
  user_agent: string;
  matched_signature: string;
  status: 'intercepted_403' | 'allowed_200';
  client_ip: string;
  path: string;
}

const scraperProbeRecords: ScraperProbeRecord[] = [];

// ============================================================================
// 3. PHASE 3 ENTITIES & DATABASE STATE
// ============================================================================

export interface UserRow {
  id: number;
  username: string;
  email: string;
  plan: 'free' | 'indie_solo' | 'academic_tier';
  is_premium: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AcademicDoiRow {
  status?: 'uploading' | 'upload_failed' | 'draft' | 'publishing' | 'published';
  environment?: string;
  id: number;
  repository_id: number;
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

export interface PanicSnapshot {
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
  is_head_commit: boolean;
  message?: string;
}

export interface UntrackedSlopItem {
  id: string;
  repository_id: number;
  file_path: string;
  size_bytes: number;
  created_by_slop: string;
  generated_at: string;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface RepositoryRow {
  local_path?: string;
  mode?: 'demo' | 'live';
  id: number;
  owner_id: number;
  forgejo_repo_id: number;
  name: string;
  full_name: string;
  default_branch: string;
  head_commit_sha: string;
  is_unborn_head: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: number;
  repository_id: number;
  title: string;
  status: TaskStatus;
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

export interface TaskCommitLinkRow {
  task_id: number;
  commit_id: number;
  action_type: string;
  linked_at: string;
}

interface RelationalStore {
  workspace_mode?: 'demo' | 'live';
  stripe_events?: string[];
  users: UserRow[];
  repositories: RepositoryRow[];
  tasks: TaskRow[];
  commits: CommitRow[];
  task_commit_links: TaskCommitLinkRow[];
  academic_dois: AcademicDoiRow[];
  panic_snapshots: PanicSnapshot[];
  untracked_slop: UntrackedSlopItem[];
  counters: {
    userId: number;
    repoId: number;
    taskId: number;
    commitId: number;
    doiId: number;
  };
}

function createInitialStore(): RelationalStore {
  const now = formatLocalIsoOffset(new Date(Date.now() - 3600_000 * 5));
  const later = formatLocalIsoOffset(new Date(Date.now() - 3600_000 * 2));
  const recent = formatLocalIsoOffset(new Date(Date.now() - 1800_000));

  const headCommit1 = '91b7e4d20a8c3f567890123456789abcdef98765';
  const baselineCommit1 = '8f3d9a12b4e6c7d890123456789abcdef0123456';

  return {
    users: [
      {
        id: 1,
        username: 'elena_solo',
        email: 'elena@launchpadre.dev',
        plan: 'indie_solo',
        is_premium: true,
        stripe_customer_id: 'cus_launchpadre_elena_4092',
        stripe_subscription_id: 'sub_launchpadre_solo_active_01',
        created_at: now,
        updated_at: recent,
      },
      {
        id: 2,
        username: 'prof_turner',
        email: 'turner@stanford.edu',
        plan: 'academic_tier',
        is_premium: true,
        stripe_customer_id: 'cus_launchpadre_turner_8814',
        stripe_subscription_id: 'sub_launchpadre_academic_active_02',
        created_at: now,
        updated_at: later,
      },
    ],
    repositories: [
      {
        id: 1,
        owner_id: 1,
        forgejo_repo_id: 4092,
        name: 'launchpadre-core',
        full_name: 'craftgit/launchpadre-core',
        default_branch: 'main',
        head_commit_sha: headCommit1,
        is_unborn_head: false,
        created_at: now,
        updated_at: recent,
      },
      {
        id: 2,
        owner_id: 2,
        forgejo_repo_id: 8814,
        name: 'zenodo-doi-engine',
        full_name: 'craftgit/zenodo-doi-engine',
        default_branch: 'main',
        head_commit_sha: '2a4e6b8c0d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a',
        is_unborn_head: false,
        created_at: now,
        updated_at: later,
      },
      {
        id: 3,
        owner_id: 1,
        forgejo_repo_id: 9940,
        name: 'fresh-unborn-repo',
        full_name: 'craftgit/fresh-unborn-repo',
        default_branch: 'main',
        head_commit_sha: '',
        is_unborn_head: true,
        created_at: recent,
        updated_at: recent,
      },
    ],
    tasks: [
      {
        id: 1,
        repository_id: 1,
        title: 'Implement constant-time X-Gitea-Signature HMAC-SHA256 verification',
        status: 'done',
        markdown_file_path: '.launchpadre/tasks/implement-constant-time-x-gitea-signature-hmac-sha256-verificati.md',
        created_at: now,
        updated_at: later,
      },
      {
        id: 2,
        repository_id: 1,
        title: 'Configure asyncpg connection pool with SQLAlchemy 2.0 session factory',
        status: 'done',
        markdown_file_path: 'docs/kanban/asyncpg-connection-pool.md',
        created_at: now,
        updated_at: later,
      },
      {
        id: 3,
        repository_id: 1,
        title: 'Add bidirectional AST parser for Markdown frontmatter synchronization',
        status: 'in_progress',
        markdown_file_path: '.launchpadre/tasks/add-bidirectional-ast-parser-for-markdown-frontmatter-synchroniz.md',
        created_at: later,
        updated_at: recent,
      },
      {
        id: 4,
        repository_id: 1,
        title: 'Support Zenodo REST API deposition lifecycle with DOI citation badges',
        status: 'done',
        markdown_file_path: 'docs/kanban/zenodo-academic-doi-minting.md',
        created_at: recent,
        updated_at: recent,
      },
      {
        id: 5,
        repository_id: 1,
        title: 'Implement Stripe checkout session with client_reference_id mapping',
        status: 'done',
        markdown_file_path: 'docs/kanban/stripe-monetization-framework.md',
        created_at: recent,
        updated_at: recent,
      },
    ],
    commits: [
      {
        id: 1,
        repository_id: 1,
        commit_sha: baselineCommit1,
        message: 'feat(core): initial production bootstrap\ntodo: Implement constant-time X-Gitea-Signature HMAC-SHA256 verification',
        author_name: 'Elena Rostova',
        author_email: 'elena@launchpadre.dev',
        committed_at: now,
        ingested_at: now,
      },
      {
        id: 2,
        repository_id: 1,
        commit_sha: 'c4a91e07d2b5f8a3190456789abcdef012345678',
        message: 'sec(hmac): verify raw bytes\nfix: Implement constant-time X-Gitea-Signature HMAC-SHA256 verification',
        author_name: 'Elena Rostova',
        author_email: 'elena@launchpadre.dev',
        committed_at: later,
        ingested_at: later,
      },
      {
        id: 3,
        repository_id: 1,
        commit_sha: headCommit1,
        message: 'feat(fintech): ship Stripe & Zenodo engine\nclose: Support Zenodo REST API deposition lifecycle with DOI citation badges\nclose: Implement Stripe checkout session with client_reference_id mapping',
        author_name: 'Elena Rostova',
        author_email: 'elena@launchpadre.dev',
        committed_at: recent,
        ingested_at: recent,
      },
    ],
    task_commit_links: [
      { task_id: 1, commit_id: 1, action_type: 'created_todo', linked_at: now },
      { task_id: 1, commit_id: 2, action_type: 'resolved_fix', linked_at: later },
      { task_id: 4, commit_id: 3, action_type: 'resolved_close', linked_at: recent },
      { task_id: 5, commit_id: 3, action_type: 'resolved_close', linked_at: recent },
    ],
    academic_dois: [
      {
        id: 1,
        repository_id: 1,
        commit_sha: headCommit1,
        deposition_id: '10884920',
        doi: '10.5281/zenodo.10884920',
        doi_url: 'https://doi.org/10.5281/zenodo.10884920',
        badge_url: 'https://zenodo.org/badge/DOI/10.5281/zenodo.10884920.svg',
        title: 'LaunchPadre Core Engine v1.0.0 — Open Source Git Forge Architecture',
        archive_filename: 'launchpadre_core_91b7e4d2.zip',
        archive_size_bytes: 428900,
        creator_name: 'Elena Rostova',
        creator_affiliation: 'LaunchPadre Systems Research',
        minted_at: recent,
      },
    ],
    panic_snapshots: [
      {
        id: 'ps_1',
        repository_id: 1,
        forgejo_repo_id: 4092,
        tag_name: 'panic_room_launchpadre_baseline_stable',
        sanitized_name: 'baseline_stable',
        target_commit_sha: baselineCommit1,
        commit_message: 'feat(core): initial production bootstrap',
        author_name: 'Elena Rostova',
        author_email: 'elena@launchpadre.dev',
        created_at: now,
        is_head_commit: false,
        message: 'Pre-migration verified baseline release snapshot',
      },
      {
        id: 'ps_2',
        repository_id: 1,
        forgejo_repo_id: 4092,
        tag_name: 'panic_room_launchpadre_pre_fintech_deployment',
        sanitized_name: 'pre_fintech_deployment',
        target_commit_sha: headCommit1,
        commit_message: 'feat(fintech): ship Stripe & Zenodo engine',
        author_name: 'Elena Rostova',
        author_email: 'elena@launchpadre.dev',
        created_at: recent,
        is_head_commit: true,
        message: 'Checkpoint before Stripe webhook listener activation',
      },
    ],
    untracked_slop: [],
    counters: {
      userId: 2,
      repoId: 3,
      taskId: 5,
      commitId: 3,
      doiId: 1,
    },
  };
}

const stateStore = new StateStore<RelationalStore>(process.env.STATE_DB_PATH || './data/workspace.db');
const initialWorkspace = (): RelationalStore => {
  const seed = createInitialStore();
  seed.workspace_mode = demoMode ? 'demo' : 'live';
  if (!demoMode) {
    const now = formatLocalIsoOffset();
    seed.users = [{ id: 1, username: process.env.ADMIN_NAME || 'Workspace owner', email: process.env.ADMIN_EMAIL!,
      plan: 'free', is_premium: false, stripe_customer_id: null, stripe_subscription_id: null, created_at: now, updated_at: now }];
    seed.repositories = []; seed.tasks = []; seed.commits = []; seed.task_commit_links = [];
    seed.academic_dois = []; seed.panic_snapshots = []; seed.untracked_slop = [];
    seed.counters = { userId: 1, repoId: 0, taskId: 0, commitId: 0, doiId: 0 };
  }
  return seed;
};
let db: RelationalStore = stateStore.load(initialWorkspace);
if ((db.workspace_mode || 'demo') !== (demoMode ? 'demo' : 'live')) {
  throw new Error('Workspace mode does not match the database. Use a separate STATE_DB_PATH for live and demo workspaces.');
}
const gitWorkspace = process.env.GIT_REPOSITORIES_ROOT && process.env.ADMIN_PASSWORD
  ? new GitWorkspace(process.env.GIT_REPOSITORIES_ROOT) : null;
const zenodoClient = process.env.ZENODO_ACCESS_TOKEN && process.env.ADMIN_PASSWORD
  ? new ZenodoClient(process.env.ZENODO_BASE_URL || 'https://sandbox.zenodo.org', process.env.ZENODO_ACCESS_TOKEN) : null;
const stripeClient = process.env.STRIPE_SECRET_KEY && process.env.APP_ORIGIN && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD
  ? new StripeClient(process.env.STRIPE_SECRET_KEY, process.env.APP_ORIGIN, {
      indie_solo: process.env.STRIPE_PRICE_INDIE || '', academic_tier: process.env.STRIPE_PRICE_ACADEMIC || '',
      indie_solo_year: process.env.STRIPE_PRICE_INDIE_ANNUAL || '', academic_tier_year: process.env.STRIPE_PRICE_ACADEMIC_ANNUAL || '',
    }) : null;
if (process.env.ADMIN_EMAIL) {
  const owner = db.users[0];
  owner.email = process.env.ADMIN_EMAIL; owner.username = process.env.ADMIN_NAME || 'Workspace owner';
  if (owner.stripe_customer_id?.startsWith('cus_launchpadre_')) {
    owner.plan = 'free'; owner.is_premium = false; owner.stripe_customer_id = null; owner.stripe_subscription_id = null;
  }
  stateStore.save(db);
}

recordLog(
  'INFO',
  'ENGINE_BOOT',
  200,
  'Initialized LaunchPadre Core Engine: Phases 1, 2 & 3 (Demo integrations; SQLite state active)'
);

// Mutex locks per repository
const repoExecutionLocks = new Map<number, boolean>();
async function acquireRepoLock(repoId: number): Promise<() => void> {
  while (repoExecutionLocks.get(repoId)) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  repoExecutionLocks.set(repoId, true);
  return () => {
    repoExecutionLocks.delete(repoId);
  };
}

function sanitizeSnapshotName(name: string): string {
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return (clean || 'manual_checkpoint').slice(0, 64);
}

function hydrateTask(task: TaskRow, store: RelationalStore) {
  const repo = store.repositories.find((r) => r.id === task.repository_id);
  const links = store.task_commit_links.filter((l) => l.task_id === task.id);
  const commits = links
    .map((link) => {
      const commit = store.commits.find((c) => c.id === link.commit_id);
      if (!commit) return null;
      return {
        commit_sha: commit.commit_sha,
        action_type: link.action_type,
        message: commit.message,
        author_name: commit.author_name,
        committed_at: commit.committed_at,
        linked_at: link.linked_at,
      };
    })
    .filter(Boolean);

  return {
    id: task.id,
    repository_id: task.repository_id,
    forgejo_repo_id: repo ? repo.forgejo_repo_id : task.repository_id,
    title: task.title,
    status: task.status,
    markdown_file_path: task.markdown_file_path,
    created_at: task.created_at,
    updated_at: task.updated_at,
    commits,
  };
}

// ============================================================================
// 4. EXPRESS SERVER SETUP
// ============================================================================

async function startServer() {
  const app = express();

  app.get('/healthz', (_req, res) => res.json({ status: 'ok', mode: demoMode ? 'demo' : 'live' }));

  // Layer B & Layer C Data Sovereignty Middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const userAgent = (req.header('user-agent') || '').toLowerCase().trim();
    if (userAgent) {
      for (const sig of BANNED_AI_SCRAPERS) {
        if (userAgent.includes(sig)) {
          const clientIp = req.ip || 'unknown';
          recordLog('WARNING', 'SCRAPER_BLOCKED_403', 403, `Blocked AI bot '${userAgent.slice(0, 50)}'`);
          scraperProbeRecords.unshift({
            id: crypto.randomUUID(),
            timestamp: formatLocalIsoOffset(new Date()),
            user_agent: userAgent,
            matched_signature: sig,
            status: 'intercepted_403',
            client_ip: clientIp,
            path: req.path,
          });
          if (scraperProbeRecords.length > 500) scraperProbeRecords.length = 500;
          res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
          res.status(403).type('text/plain').send(`403 Forbidden: AI scrapers blocked by LaunchPadre. Matched: ${sig}\n`);
          return;
        }
      }
    }
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // Raw body captures for webhooks
  app.use('/api/v1/webhooks/git-core', express.raw({ type: '*/*', limit: '5mb' }));
  app.use('/api/v1/billing/webhooks/stripe', express.raw({ type: '*/*', limit: '2mb' }));
  app.use(express.json({ limit: '5mb' }));

  installAuthentication(app);

  let persistenceHealthy = true;

  // Persist successful mutations before acknowledging them to the client.
  app.use('/api', (req, res, next) => {
    if (!persistenceHealthy) {
      res.status(503).json({ error: 'Workspace storage is unavailable. Restart after resolving storage errors.' }); return;
    }
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && res.statusCode < 400) {
        try { stateStore.save(db); } catch (error) {
          persistenceHealthy = false;
          console.error('Workspace persistence failed', error);
          res.status(503);
          return sendJson({ error: 'Workspace could not be saved. Restart the server before retrying.' });
        }
      }
      return sendJson(body);
    };
    next();
  });

  // Layer A: robots.txt
  app.get('/robots.txt', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(DYNAMIC_ROBOTS_TXT_CONTENT);
  });

  // ==========================================================================
  // PHASE 3: STRIPE BILLING LIFECYCLE
  // ==========================================================================

  app.get('/api/v1/integrations', (_req, res) => {
    res.json({ mode: demoMode ? 'demo' : 'live', git: Boolean(gitWorkspace), stripe: Boolean(stripeClient), zenodo: Boolean(zenodoClient), zenodo_origin: zenodoClient?.origin || null });
  });

  app.get('/api/v1/billing/plans', (_req, res) => {
    res.json({ currency: 'USD', plans: Object.entries(PLANS).map(([id, plan]) => ({ id, ...plan,
      monthly_checkout: Boolean(stripeClient?.priceId(id, 'month')), annual_checkout: Boolean(stripeClient?.priceId(id, 'year')),
    })) });
  });

  app.post('/api/v1/billing/checkout-session', async (req: Request, res: Response) => {
    if (!stripeClient) { res.status(503).json({ error: 'Configure Stripe credentials, prices, ADMIN_EMAIL, and APP_ORIGIN before checkout' }); return; }
    const user = db.users[0];
    if (Number(req.body?.user_id) !== user.id) { res.status(403).json({ error: 'Only the workspace owner can subscribe' }); return; }
    const plan = req.body?.plan_id;
    if (!['indie_solo', 'academic_tier'].includes(plan)) { res.status(400).json({ error: 'Invalid plan' }); return; }
    if (user.stripe_subscription_id) { res.status(409).json({ error: 'A subscription already exists. Manage it in Stripe before creating another.' }); return; }
    const interval = req.body?.billing_interval ?? 'month';
    if (!['month', 'year'].includes(interval)) { res.status(400).json({ error: 'Invalid billing interval' }); return; }
    try { res.json(await stripeClient.checkout(user, plan, interval)); }
    catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : 'Checkout failed' }); }
  });

  app.post('/api/v1/billing/webhooks/stripe', async (req: Request, res: Response) => {
    if (!process.env.STRIPE_WEBHOOK_SECRET) { res.status(503).json({ error: 'Stripe webhook is not configured' }); return; }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const parts = (req.header('Stripe-Signature') || '').split(',').map(part => part.trim().split('='));
    const timestamp = parts.find(([key]) => key === 't')?.[1] || '';
    const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${timestamp}.`).update(raw).digest('hex');
    const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value || '');
    if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
        !signatures.some(sig => /^[a-f0-9]{64}$/i.test(sig) && crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex')))) {
      res.status(401).json({ error: 'Invalid Stripe signature' }); return;
    }
    let event: any;
    try { event = JSON.parse(raw.toString('utf8')); } catch { res.status(400).json({ error: 'Malformed Stripe JSON' }); return; }
    if (typeof event?.id !== 'string' || !event?.data?.object) { res.status(400).json({ error: 'Invalid Stripe event' }); return; }
    const release = await acquireRepoLock(-1);
    try {
      db.stripe_events ||= [];
      if (db.stripe_events.includes(event.id)) { res.json({ status: 'duplicate' }); return; }
      const user = db.users[0];
      const object = event.data.object;
      if (event.type === 'checkout.session.completed' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        if (!stripeClient) { res.status(503).json({ error: 'Stripe client is not configured' }); return; }
        const id = event.type === 'checkout.session.completed' ? object.subscription : object.id;
        const subscription = await stripeClient.subscription(id);
        const plan = subscription.metadata?.plan_id;
        const ownerId = Number(subscription.metadata?.user_id);
        if (ownerId !== user.id || !['indie_solo', 'academic_tier'].includes(plan)) {
          res.status(400).json({ error: 'Subscription does not belong to this workspace' }); return;
        }
        if (user.stripe_subscription_id && user.stripe_subscription_id !== subscription.id) {
          res.status(409).json({ error: 'Subscription does not match the current workspace subscription' }); return;
        }
        const active = ['active', 'trialing'].includes(subscription.status);
        user.plan = active ? plan : 'free'; user.is_premium = active;
        user.stripe_customer_id = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
        user.stripe_subscription_id = subscription.status === 'canceled' ? null : subscription.id;
        user.updated_at = formatLocalIsoOffset();
      }
      db.stripe_events.push(event.id);
      res.json({ status: 'processed', event_id: event.id });
    } catch { res.status(502).json({ error: 'Unable to verify subscription state with Stripe' }); }
    finally { release(); }
  });

  // ==========================================================================
  // PHASE 3: ZENODO ACADEMIC DOI MINTING
  // ==========================================================================

  // Prepare an unpublished archive. Publication is a separate explicit action.
  app.post('/api/v1/academic/doi/mint', async (req: Request, res: Response) => {
    if (!PLANS[effectivePlan(db.users[0])].zenodo) { res.status(402).json({ error: 'Zenodo archives require the Academic Researcher plan' }); return; }
    if (!zenodoClient || !gitWorkspace) { res.status(503).json({ error: 'Configure Zenodo and the Git workspace before preparing an archive' }); return; }
    const repo = db.repositories.find(r => r.id === Number(req.body?.repo_id) || r.forgejo_repo_id === Number(req.body?.repo_id));
    if (!repo || repo.mode !== 'live' || !repo.local_path) { res.status(400).json({ error: 'Select a registered live repository' }); return; }
    const title = String(req.body?.title || '').trim();
    const creator = String(req.body?.creator_name || '').trim();
    const description = String(req.body?.description || '').trim();
    const license = String(req.body?.license || '').trim();
    if (!title || !creator || !description || !/^[a-zA-Z0-9_.-]+$/.test(license)) { res.status(400).json({ error: 'Title, creator, description, and a Zenodo license identifier are required' }); return; }
    const release = await acquireRepoLock(repo.id);
    let record: AcademicDoiRow | undefined;
    try {
      const { head } = gitWorkspace.inspect(repo.local_path);
      if (!head) { res.status(409).json({ error: 'Create an initial commit before archiving' }); return; }
      record = db.academic_dois.find(d => d.repository_id === repo.id && d.commit_sha === head && d.environment === zenodoClient.origin);
      if (record && ['draft', 'published', 'publishing'].includes(record.status || '')) { res.json(record); return; }
      const archive = gitWorkspace.archive(repo.local_path, head);
      if (!record) {
        const deposition = await zenodoClient.create({ title, upload_type: 'software', description,
          creators: [{ name: creator, affiliation: String(req.body?.creator_affiliation || '') }], access_right: 'open', license });
        if (!deposition.id || !/^\d+$/.test(String(deposition.id))) throw new Error('Unexpected Zenodo draft response');
        record = { id: ++db.counters.doiId, repository_id: repo.id, commit_sha: head, deposition_id: String(deposition.id),
          doi: '', doi_url: '', badge_url: '', title, archive_filename: `repository-${head}.zip`, archive_size_bytes: archive.length,
          creator_name: creator, creator_affiliation: String(req.body?.creator_affiliation || ''), minted_at: '',
          status: 'uploading', environment: zenodoClient.origin };
        db.academic_dois.push(record);
        // Retain the remote draft id even if upload later fails.
        stateStore.save(db);
      }
      const deposition = await zenodoClient.get(record.deposition_id);
      await zenodoClient.upload(deposition, record.archive_filename, archive);
      record.status = 'draft';
      res.status(201).json(record);
    } catch (error) {
      if (record) { record.status = 'upload_failed'; try { stateStore.save(db); } catch { /* return failure without claiming success */ } }
      res.status(502).json({ error: error instanceof Error ? error.message : 'Zenodo preparation failed', deposition_id: record?.deposition_id });
    } finally { release(); }
  });

  app.post('/api/v1/academic/doi/:id/publish', async (req: Request, res: Response) => {
    if (!PLANS[effectivePlan(db.users[0])].zenodo) { res.status(402).json({ error: 'Zenodo publication requires the Academic Researcher plan' }); return; }
    if (!zenodoClient) { res.status(503).json({ error: 'Zenodo is not configured' }); return; }
    if (req.body?.confirm_publication !== true) { res.status(400).json({ error: 'Explicit publication confirmation is required' }); return; }
    const record = db.academic_dois.find(d => d.id === Number(req.params.id) && d.environment === zenodoClient.origin);
    if (!record || !['draft', 'publishing', 'published'].includes(record.status || '')) { res.status(409).json({ error: 'A prepared draft in the configured Zenodo environment is required' }); return; }
    const release = await acquireRepoLock(record.repository_id);
    try {
      let deposition = await zenodoClient.get(record.deposition_id);
      if (!deposition.submitted && deposition.state !== 'inprogress') {
        deposition = await zenodoClient.publish(record.deposition_id);
      }
      const published = Boolean(deposition.submitted && deposition.metadata?.doi);
      record.status = published ? 'published' : 'publishing';
      if (published) {
        record.doi = deposition.metadata.doi; record.doi_url = `https://doi.org/${record.doi}`;
        record.badge_url = `${zenodoClient.origin}/badge/DOI/${record.doi}.svg`; record.minted_at = formatLocalIsoOffset();
      }
      res.status(published ? 200 : 202).json(record);
    } catch { res.status(502).json({ error: 'Zenodo publication status is uncertain. Review the saved deposition in Zenodo before retrying.', deposition_id: record.deposition_id }); }
    finally { release(); }
  });

  // GET /api/v1/academic/doi/:repo_id
  app.get('/api/v1/academic/doi/:repo_id', (req: Request, res: Response) => {
    const repoId = Number(req.params.repo_id);
    const repo = db.repositories.find((r) => r.id === repoId || r.forgejo_repo_id === repoId);
    if (!repo) {
      res.status(404).json({ error: `Repository '${repoId}' not found.` });
      return;
    }

    const dois = db.academic_dois
      .filter((d) => d.repository_id === repo.id)
      .map((d) => ({ ...d, forgejo_repo_id: repo.forgejo_repo_id }));

    res.json(dois);
  });

  // ==========================================================================
  // PHASE 2: PANIC ROOM WITH UNBORN HEAD RESILIENCY PATCH
  // ==========================================================================

  // POST /api/v1/panic/snapshots
  app.post('/api/v1/panic/snapshots', async (req: Request, res: Response) => {
    const repoIdParam = Number(req.body?.repo_id);
    const customSnapshotName = String(req.body?.snapshot_name || '').trim();
    const repo = db.repositories.find((r) => r.forgejo_repo_id === repoIdParam || r.id === repoIdParam);

    if (!repo) {
      res.status(404).json({ error: `Repository '${repoIdParam}' not found.` });
      return;
    }

    const releaseLock = await acquireRepoLock(repo.id);

    try {
      const snapshotCount = db.panic_snapshots.filter(snapshot => snapshot.repository_id === repo.id).length;
      if (snapshotLimitReached(effectivePlan(db.users[0]), snapshotCount)) {
        res.status(402).json({ error: 'Free Developer includes one checkpoint per repository. Upgrade to create additional checkpoints.' }); return;
      }
      if (repo.mode === 'live' && repo.local_path) {
        if (!gitWorkspace) { res.status(503).json({ error: 'Git workspace is not configured' }); return; }
        const sanitized = sanitizeSnapshotName(customSnapshotName);
        try {
          const result = gitWorkspace.snapshot(repo.local_path, sanitized);
          const now = formatLocalIsoOffset();
          const snapshot: PanicSnapshot = {
            id: crypto.randomUUID(), repository_id: repo.id, forgejo_repo_id: repo.forgejo_repo_id,
            tag_name: result.tag, sanitized_name: sanitized, target_commit_sha: result.head,
            commit_message: 'Live Git checkpoint', author_name: 'Workspace owner', author_email: '',
            created_at: now, is_head_commit: true, message: String(req.body?.message || ''),
          };
          repo.head_commit_sha = result.head; repo.is_unborn_head = false; repo.updated_at = now;
          db.panic_snapshots.unshift(snapshot);
          res.status(201).json({ ...snapshot, mode: 'live' });
        } catch (error) {
          res.status(409).json({ error: error instanceof Error ? error.message : 'Git snapshot failed' });
        }
        return;
      }
      // TASK 1: UNBORN HEAD SYSTEM RESILIENCY PATCH
      if (repo.is_unborn_head || !repo.head_commit_sha) {
        db.counters.commitId += 1;
        const initSha = '01a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f901';
        const initCommit: CommitRow = {
          id: db.counters.commitId,
          repository_id: repo.id,
          commit_sha: initSha,
          message: 'Initial empty commit for LaunchPadre snapshot tracking verification\ntracker: .launchpadre_init staged',
          author_name: 'LaunchPadre System Guard',
          author_email: 'guard@launchpadre.local',
          committed_at: formatLocalIsoOffset(new Date()),
          ingested_at: formatLocalIsoOffset(new Date()),
        };
        db.commits.unshift(initCommit);
        repo.head_commit_sha = initSha;
        repo.is_unborn_head = false;
        repo.updated_at = formatLocalIsoOffset(new Date());

        recordLog(
          'INFO',
          'UNBORN_HEAD_RESILIENCY_TRIGGERED',
          200,
          `Patched unborn HEAD for repository #${repo.forgejo_repo_id}: staged .launchpadre_init and committed baseline ${initSha.slice(0, 8)}`
        );
      }

      const sanitized = sanitizeSnapshotName(customSnapshotName);
      const tagName = `panic_room_launchpadre_${sanitized}`;
      const nowIso = formatLocalIsoOffset(new Date());

      const snapshotRecord: PanicSnapshot = {
        id: `ps_${Date.now()}`,
        repository_id: repo.id,
        forgejo_repo_id: repo.forgejo_repo_id,
        tag_name: tagName,
        sanitized_name: sanitized,
        target_commit_sha: repo.head_commit_sha,
        commit_message: 'Current HEAD Snapshot checkpoint',
        author_name: 'LaunchPadre Guard',
        author_email: 'guard@launchpadre.local',
        created_at: nowIso,
        is_head_commit: true,
        message: req.body?.message,
      };

      const existingIdx = db.panic_snapshots.findIndex((s) => s.repository_id === repo.id && s.tag_name === tagName);
      if (existingIdx >= 0) {
        db.panic_snapshots[existingIdx] = snapshotRecord;
      } else {
        db.panic_snapshots.unshift(snapshotRecord);
      }

      res.status(201).json({
        status: 'created',
        repository_id: repo.id,
        forgejo_repo_id: repo.forgejo_repo_id,
        tag_name: snapshotRecord.tag_name,
        sanitized_name: snapshotRecord.sanitized_name,
        target_commit_sha: snapshotRecord.target_commit_sha,
        commit_message: snapshotRecord.commit_message,
        author_name: snapshotRecord.author_name,
        author_email: snapshotRecord.author_email,
        created_at: snapshotRecord.created_at,
        is_head_commit: true,
      });
    } finally {
      releaseLock();
    }
  });

  // POST /api/v1/panic/rollback
  app.post('/api/v1/panic/rollback', async (req: Request, res: Response) => {
    const repoIdParam = Number(req.body?.repo_id);
    const targetSnapshotName = String(req.body?.snapshot_name || '').trim();
    const repo = db.repositories.find((r) => r.forgejo_repo_id === repoIdParam || r.id === repoIdParam);

    if (!repo) {
      res.status(404).json({ error: `Repository '${repoIdParam}' not found.` });
      return;
    }

    const releaseLock = await acquireRepoLock(repo.id);

    try {
      const sanitized = sanitizeSnapshotName(targetSnapshotName);
      const tagName = `panic_room_launchpadre_${sanitized}`;
      const snapshot = db.panic_snapshots.find(
        (s) => s.repository_id === repo.id && (s.tag_name === tagName || s.sanitized_name === sanitized)
      );

      if (!snapshot) {
        res.status(404).json({ error: `Snapshot '${tagName}' not found.` });
        return;
      }

      if (repo.mode === 'live' && repo.local_path) {
        if (!gitWorkspace) { res.status(503).json({ error: 'Git workspace is not configured' }); return; }
        if (req.body?.confirm !== true || typeof req.body?.expected_head !== 'string') {
          res.status(400).json({ error: 'Live rollback requires confirmation and the current HEAD' }); return;
        }
        try {
          const result = gitWorkspace.rollback(repo.local_path, snapshot.tag_name, req.body.expected_head, snapshot.target_commit_sha);
          repo.head_commit_sha = result.target; repo.updated_at = formatLocalIsoOffset();
          res.json({ status: 'rolled_back', mode: 'live', repository_id: repo.id,
            tag_name: snapshot.tag_name, target_commit_sha: result.target, previous_head_sha: result.previousHead,
            recovery_ref: result.recoveryRef, purged_untracked_count: 0, purged_entries: [], executed_at: formatLocalIsoOffset(),
          });
        } catch (error) {
          res.status(409).json({ error: error instanceof Error ? error.message : 'Git rollback failed' });
        }
        return;
      }
      const previousHeadSha = repo.head_commit_sha;
      repo.head_commit_sha = snapshot.target_commit_sha;
      repo.updated_at = formatLocalIsoOffset(new Date());

      const purgedFiles = db.untracked_slop.filter((s) => s.repository_id === repo.id).map((s) => s.file_path);
      db.untracked_slop = db.untracked_slop.filter((s) => s.repository_id !== repo.id);

      recordLog(
        'WARNING',
        'EMERGENCY_ROLLBACK_EXECUTED',
        200,
        `Hard reset repo #${repo.forgejo_repo_id} to ${snapshot.target_commit_sha.slice(0, 8)} (${snapshot.tag_name}). Purged ${purgedFiles.length} file(s) via git clean -fd.`
      );

      res.json({
        status: 'rolled_back',
        repository_id: repo.id,
        forgejo_repo_id: repo.forgejo_repo_id,
        tag_name: snapshot.tag_name,
        target_commit_sha: snapshot.target_commit_sha,
        previous_head_sha: previousHeadSha,
        purged_untracked_count: purgedFiles.length,
        purged_entries: purgedFiles,
        executed_at: formatLocalIsoOffset(new Date()),
        repository_path: `/var/git/repositories/${repo.full_name.replace('/', '_')}`,
      });
    } finally {
      releaseLock();
    }
  });

  // GET /api/v1/panic/snapshots/:repo_id
  app.get(['/api/v1/panic/snapshots/:repo_id', '/api/v1/repositories/:repo_id/snapshots'], (req: Request, res: Response) => {
    const repoIdParam = Number(req.params.repo_id);
    const repo = db.repositories.find((r) => r.forgejo_repo_id === repoIdParam || r.id === repoIdParam);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const snapshots = db.panic_snapshots.filter((s) => s.repository_id === repo.id);
    res.json({ total_snapshots: snapshots.length, snapshots });
  });

  // POST /api/v1/panic/slop/generate
  app.post('/api/v1/panic/slop/generate', (req: Request, res: Response) => {
    const repoId = Number(req.body?.repo_id) || 1;
    const repo = db.repositories.find((r) => r.id === repoId || r.forgejo_repo_id === repoId) || db.repositories[0];
    if (repo.mode === 'live') { res.status(409).json({ error: 'Demo file generation is disabled for live repositories' }); return; }
    const pathName = `src/broken_ai_slop_${Date.now().toString().slice(-4)}.py`;
    const slop: UntrackedSlopItem = {
      id: `slop_${Date.now()}`,
      repository_id: repo.id,
      file_path: pathName,
      size_bytes: 4200,
      created_by_slop: 'Malfunctioning assistant loop',
      generated_at: formatLocalIsoOffset(new Date()),
    };
    db.untracked_slop.unshift(slop);
    res.json({ status: 'slop_generated', file: pathName });
  });

  // Test probe
  app.post('/api/v1/sovereignty/test-probe', (req: Request, res: Response) => {
    const agent = String(req.body?.user_agent || '').toLowerCase().trim();
    let matched: string | null = null;
    for (const s of BANNED_AI_SCRAPERS) {
      if (agent.includes(s)) {
        matched = s;
        break;
      }
    }
    if (matched) {
      res.status(403).json({
        decision: 'BLOCKED',
        status_code: 403,
        matched_signature: matched,
        message: `403 Forbidden: AI scraper intercepted (${matched})`,
        injected_headers: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
      });
      return;
    }
    res.json({
      decision: 'ALLOWED',
      status_code: 200,
      matched_signature: null,
      message: 'Legitimate developer client authenticated.',
      injected_headers: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
    });
  });

  // Phase 1: Webhooks sign preview
  app.post('/api/v1/webhooks/sign-preview', (req: Request, res: Response) => {
    if (!process.env.WEBHOOK_SECRET) { res.status(503).json({ error: 'Git webhook secret is not configured' }); return; }
    const raw = typeof req.body?.rawPayload === 'string' ? req.body.rawPayload : JSON.stringify(req.body?.payload || {});
    const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(raw)).digest('hex');
    res.json({ signature: sig });
  });

  // Phase 1: Ingestion
  app.post('/api/v1/webhooks/git-core', (req: Request, res: Response) => {
    if (!process.env.WEBHOOK_SECRET) { res.status(503).json({ error: 'Git webhook secret is not configured' }); return; }
    const sig = req.header('X-Gitea-Signature');
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    if (!sig) {
      res.status(401).json({ error: 'Missing signature' });
      return;
    }
    const digest = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    const normalizedSignature = sig.toLowerCase().replace(/^sha256=/, '');
    if (!/^[a-f0-9]{64}$/.test(normalizedSignature) || !crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(normalizedSignature, 'hex'))) {
      res.status(401).json({ error: 'Signature mismatch' });
      return;
    }
    let payload: any;
    try { payload = JSON.parse(raw.toString('utf-8')); } catch {
      res.status(400).json({ error: 'Malformed webhook JSON' }); return;
    }
    const repo = db.repositories.find(r => r.mode === 'live' && (
      r.full_name === payload?.repository?.full_name || r.forgejo_repo_id === Number(payload?.repository?.id)));
    if (!repo) { res.status(404).json({ error: 'Webhook repository is not registered' }); return; }
    if (!Array.isArray(payload?.commits) || payload.commits.length > 1000 || payload.commits.some((c: any) => !c || !/^[a-f0-9]{40,64}$/i.test(c.id || '') || typeof c.message !== 'string')) {
      res.status(400).json({ error: 'Invalid commit payload' }); return;
    }
    let processed = 0;
    for (const incoming of payload.commits) {
      if (db.commits.some(c => c.repository_id === repo.id && c.commit_sha === incoming.id)) continue;
      const now = formatLocalIsoOffset();
      const commit: CommitRow = { id: ++db.counters.commitId, repository_id: repo.id, commit_sha: incoming.id,
        message: incoming.message.slice(0, 100_000), author_name: String(incoming.author?.name || ''),
        author_email: String(incoming.author?.email || ''), committed_at: now, ingested_at: now };
      db.commits.push(commit); processed++;
      for (const line of commit.message.split('\n')) {
        const directive = /^\s*(todo|fix|close):\s*(.{1,240})\s*$/i.exec(line);
        if (!directive) continue;
        const action = directive[1].toLowerCase(); const title = directive[2].trim();
        let task = db.tasks.find(t => t.repository_id === repo.id && t.title.toLowerCase() === title.toLowerCase());
        if (!task && action === 'todo') {
          task = { id: ++db.counters.taskId, repository_id: repo.id, title, status: 'todo', markdown_file_path: '', created_at: now, updated_at: now };
          db.tasks.push(task);
        }
        if (task) {
          if (action !== 'todo') task.status = 'done';
          task.updated_at = now;
          db.task_commit_links.push({ task_id: task.id, commit_id: commit.id, action_type: action, linked_at: now });
        }
      }
    }
    res.json({ status: 'ingested', repository_id: repo.id, processed_commits: processed });
  });

  // Phase 1: Kanban tasks
  app.get('/api/v1/repositories/:repo_id/tasks', (req: Request, res: Response) => {
    const repoId = Number(req.params.repo_id);
    const repo = db.repositories.find((r) => r.forgejo_repo_id === repoId || r.id === repoId);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const repoTasks = db.tasks.filter((t) => t.repository_id === repo.id).map((t) => hydrateTask(t, db));
    res.json({
      repository_id: repo.id,
      forgejo_repo_id: repo.forgejo_repo_id,
      repository_name: repo.full_name,
      todo: repoTasks.filter((t) => t.status === 'todo'),
      in_progress: repoTasks.filter((t) => t.status === 'in_progress'),
      done: repoTasks.filter((t) => t.status === 'done'),
    });
  });

  app.post('/api/v1/repositories/:repo_id/tasks', (req: Request, res: Response) => {
    const repo = db.repositories.find(r => r.id === Number(req.params.repo_id) || r.forgejo_repo_id === Number(req.params.repo_id));
    if (!repo) { res.status(404).json({ error: 'Repository not found' }); return; }
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title || title.length > 240) { res.status(400).json({ error: 'Task title must contain 1–240 characters' }); return; }
    const now = formatLocalIsoOffset();
    const task: TaskRow = { id: ++db.counters.taskId, repository_id: repo.id, title, status: 'todo', markdown_file_path: '', created_at: now, updated_at: now };
    db.tasks.push(task);
    res.status(201).json(hydrateTask(task, db));
  });

  // PATCH /api/v1/tasks/:task_id/status
  app.patch('/api/v1/tasks/:task_id/status', (req: Request, res: Response) => {
    const task = db.tasks.find((t) => t.id === Number(req.params.task_id));
    if (task) {
      if (!['todo', 'in_progress', 'done'].includes(req.body?.status)) { res.status(400).json({ error: 'Invalid task status' }); return; }
      task.status = req.body.status; task.updated_at = formatLocalIsoOffset();
      res.json(hydrateTask(task, db));
    } else {
      res.status(404).json({ error: 'Task not found' });
    }
  });

  // Targeted Endpoints for Clean Partial Reads
  app.post('/api/v1/repositories', (req: Request, res: Response) => {
    if (repositoryLimitReached(effectivePlan(db.users[0]), db.repositories.filter(r => r.mode === 'live').length)) {
      res.status(402).json({ error: 'Free Developer includes three registered repositories. Upgrade to register more.' }); return;
    }
    if (!gitWorkspace) { res.status(503).json({ error: 'Configure ADMIN_PASSWORD and GIT_REPOSITORIES_ROOT before registering live repositories' }); return; }
    const relative = req.body?.local_path;
    if (typeof relative !== 'string' || !relative.trim()) { res.status(400).json({ error: 'local_path is required' }); return; }
    if (db.repositories.some(r => r.local_path === relative)) { res.status(409).json({ error: 'Repository is already registered' }); return; }
    try {
      const info = gitWorkspace.inspect(relative);
      const now = formatLocalIsoOffset();
      const id = ++db.counters.repoId;
      const repo: RepositoryRow = { id, forgejo_repo_id: id, owner_id: 1, mode: 'live', local_path: relative,
        name: path.basename(relative), full_name: relative, default_branch: info.branch, head_commit_sha: info.head,
        is_unborn_head: info.unborn, created_at: now, updated_at: now };
      db.repositories.push(repo);
      res.status(201).json(repo);
    } catch { res.status(400).json({ error: 'Repository is not a supported Git working directory inside the configured root' }); }
  });

  app.get('/api/v1/repositories', (_req: Request, res: Response) => {
    res.json(db.repositories);
  });

  app.get('/api/v1/repositories/:repo_id', (req: Request, res: Response) => {
    const repoId = Number(req.params.repo_id);
    const repo = db.repositories.find((r) => r.forgejo_repo_id === repoId || r.id === repoId);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    if (repo.mode === 'live' && repo.local_path) {
      if (!gitWorkspace) { res.status(503).json({ error: 'Git workspace is not configured' }); return; }
      try {
        const info = gitWorkspace.inspect(repo.local_path);
        repo.head_commit_sha = info.head; repo.is_unborn_head = info.unborn; repo.default_branch = info.branch;
      } catch { res.status(409).json({ error: 'Git working directory is unavailable' }); return; }
    }
    res.json(repo);
  });

  app.get('/api/v1/repositories/:repo_id/dois', (req: Request, res: Response) => {
    const repoId = Number(req.params.repo_id);
    const repo = db.repositories.find((r) => r.forgejo_repo_id === repoId || r.id === repoId);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const dois = db.academic_dois.filter((d) => d.repository_id === repo.id);
    res.json(dois);
  });

  app.get('/api/v1/repositories/:repo_id/slop', (req: Request, res: Response) => {
    const repoId = Number(req.params.repo_id);
    const repo = db.repositories.find((r) => r.forgejo_repo_id === repoId || r.id === repoId);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const slop = db.untracked_slop.filter((s) => s.repository_id === repo.id);
    res.json(slop);
  });

  app.get('/api/v1/billing/subscription', (_req: Request, res: Response) => {
    const user = db.users[0];
    res.json(user ? { ...user, plan: effectivePlan(user) } : null);
  });

  app.get('/api/v1/sovereignty/stats', (_req: Request, res: Response) => {
    const blockedCount = scraperProbeRecords.filter((p) => p.status === 'intercepted_403').length;
    res.json({
      blocked_count: blockedCount,
      recent_probes: scraperProbeRecords.slice(0, 20),
      banned_signatures: BANNED_AI_SCRAPERS,
    });
  });

  // Async file cache to prevent blocking event loop on disk reads
  const serverFileCache = new Map<string, { mtimeMs: number; content: string }>();
  async function getAsyncFile(fileName: string): Promise<string> {
    const safe = path.basename(fileName);
    if (!['main.py', 'models.py', 'panic_room.py', 'billing.py', 'zenodo.py', 'middleware.py', 'schema.sql', 'requirements.txt'].includes(safe)) return '';
    const p = path.join(__dirname, 'backend_python', safe);
    try {
      const stat = await fs.promises.stat(p);
      const cached = serverFileCache.get(safe);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.content;
      }
      const content = await fs.promises.readFile(p, 'utf-8');
      serverFileCache.set(safe, { mtimeMs: stat.mtimeMs, content });
      return content;
    } catch {
      return '';
    }
  }

  // On-demand async source file endpoint with mtime caching
  app.get('/api/v1/source/:filename', async (req: Request, res: Response) => {
    const fileName = req.params.filename;
    const content = await getAsyncFile(fileName);
    if (!content) {
      res.status(404).json({ error: `File '${fileName}' not found` });
      return;
    }
    res.json({ filename: fileName, content });
  });

  // Full state query (Non-blocking async)
  app.get('/api/v1/state', async (req: Request, res: Response) => {
    const includeFiles = req.query.include_files === 'true';
    const sourceFiles: Record<string, string> = {};
    if (includeFiles) {
      const files = ['main.py', 'models.py', 'panic_room.py', 'billing.py', 'zenodo.py', 'middleware.py', 'schema.sql', 'requirements.txt'];
      for (const f of files) {
        sourceFiles[f] = await getAsyncFile(f);
      }
    }

    res.json({
      users: db.users,
      repositories: db.repositories,
      tasks: db.tasks.map((t) => hydrateTask(t, db)),
      commits: db.commits,
      task_commit_links: db.task_commit_links,
      academic_dois: db.academic_dois,
      panic_snapshots: db.panic_snapshots,
      untracked_slop: db.untracked_slop,
      scraper_probes: scraperProbeRecords,
      audit_logs: auditLogs,
      source_files: sourceFiles,
    });
  });

  // State reset
  app.post('/api/v1/state/reset', (_req: Request, res: Response) => {
    if (db.repositories.some(r => r.mode === 'live')) {
      res.status(409).json({ error: 'Reset is disabled while live repositories are registered' }); return;
    }
    if (!demoMode) { res.status(409).json({ error: 'State reset is only available in demo mode' }); return; }
    db = initialWorkspace();
    res.json({ status: 'reset' });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found' }));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.use('*', async (req: Request, res: Response, next: NextFunction) => {
      const url = req.originalUrl;
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        let template = await fs.promises.readFile(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        next(e);
      }
    });
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, localOnly ? '127.0.0.1' : '0.0.0.0', () => {
    console.log(localOnly ? `LaunchPadre is ready at http://127.0.0.1:${PORT}` : `LaunchPadre listening on port ${PORT}`);
  });
}

startServer();


