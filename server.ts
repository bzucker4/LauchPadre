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
const PORT = cliPort && !isNaN(cliPort) ? cliPort : 3000;
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

let db: RelationalStore = createInitialStore();

recordLog(
  'INFO',
  'ENGINE_BOOT',
  200,
  'Initialized LaunchPadre Core Engine: Phases 1, 2 & 3 (Stripe & Zenodo Active)'
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

  // Layer A: robots.txt
  app.get('/robots.txt', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(DYNAMIC_ROBOTS_TXT_CONTENT);
  });

  // ==========================================================================
  // PHASE 3: STRIPE BILLING LIFECYCLE
  // ==========================================================================

  // POST /api/v1/billing/checkout-session
  app.post('/api/v1/billing/checkout-session', (req: Request, res: Response) => {
    const userId = Number(req.body?.user_id);
    const planId = String(req.body?.plan_id || '').trim().toLowerCase();

    const planPrices: Record<string, { name: string; price: number }> = {
      indie_solo: { name: 'Indie Solo Tier', price: 12 },
      academic_tier: { name: 'Academic Researcher Tier', price: 29 },
    };

    if (!planPrices[planId]) {
      res.status(400).json({ error: `Invalid plan_id '${planId}'. Allowed: indie_solo, academic_tier` });
      return;
    }

    const sessionId = `cs_test_${crypto.randomBytes(16).toString('hex')}`;
    const checkoutUrl = `https://checkout.stripe.com/c/pay/${sessionId}`;

    recordLog(
      'INFO',
      'STRIPE_CHECKOUT_CREATED',
      200,
      `Created Stripe checkout session ${sessionId} for user #${userId} (${planId}) with client_reference_id='${userId}'`
    );

    res.json({
      session_id: sessionId,
      checkout_url: checkoutUrl,
      plan_id: planId,
      plan_name: planPrices[planId].name,
      amount_usd: planPrices[planId].price,
      user_id: userId,
    });
  });

  // POST /api/v1/billing/webhooks/stripe
  app.post('/api/v1/billing/webhooks/stripe', (req: Request, res: Response) => {
    const stripeSig = req.header('Stripe-Signature') || req.header('stripe-signature');
    let payload: any;

    try {
      const rawString = Buffer.isBuffer(req.body) ? req.body.toString('utf-8') : JSON.stringify(req.body || {});
      payload = JSON.parse(rawString);
    } catch {
      res.status(400).json({ error: 'Malformed Stripe webhook JSON payload' });
      return;
    }

    const eventType = payload.type || req.body?.type;
    const eventObject = payload.data?.object || req.body?.data?.object || {};

    if (eventType === 'checkout.session.completed') {
      const clientRefId = Number(eventObject.client_reference_id || req.body?.user_id || 1);
      const planId = eventObject.metadata?.plan_id || 'indie_solo';
      const customerId = eventObject.customer || `cus_${crypto.randomBytes(6).toString('hex')}`;
      const subId = eventObject.subscription || `sub_${crypto.randomBytes(8).toString('hex')}`;

      const user = db.users.find((u) => u.id === clientRefId) || db.users[0];
      if (user) {
        user.plan = planId as any;
        user.is_premium = true;
        user.stripe_customer_id = customerId;
        user.stripe_subscription_id = subId;
        user.updated_at = formatLocalIsoOffset(new Date());

        recordLog(
          'INFO',
          'STRIPE_SUBSCRIPTION_ACTIVATED',
          200,
          `Upgraded user #${user.id} ('${user.username}') to ${planId}. Stripe Customer: ${customerId}`
        );
      }

      res.json({
        status: 'user_upgraded_to_premium',
        event_type: eventType,
        user_id: user?.id,
        customer_id: customerId,
        processed: true,
      });
      return;
    } else if (eventType === 'customer.subscription.deleted') {
      const customerId = eventObject.customer || req.body?.customer_id;
      const user = db.users.find((u) => u.stripe_customer_id === customerId) || db.users[0];
      if (user) {
        user.plan = 'free';
        user.is_premium = false;
        user.stripe_subscription_id = null;
        user.updated_at = formatLocalIsoOffset(new Date());

        recordLog(
          'WARNING',
          'STRIPE_SUBSCRIPTION_DELETED',
          200,
          `Downgraded user #${user.id} ('${user.username}') to free tier. Customer: ${customerId}`
        );
      }

      res.json({
        status: 'user_downgraded_to_free',
        event_type: eventType,
        customer_id: customerId,
        processed: true,
      });
      return;
    }

    res.json({ status: 'acknowledged', event_type: eventType, processed: false });
  });

  // ==========================================================================
  // PHASE 3: ZENODO ACADEMIC DOI MINTING
  // ==========================================================================

  // POST /api/v1/academic/doi/mint
  app.post('/api/v1/academic/doi/mint', (req: Request, res: Response) => {
    const repoId = Number(req.body?.repo_id);
    const repo = db.repositories.find((r) => r.id === repoId || r.forgejo_repo_id === repoId);
    if (!repo) {
      res.status(404).json({ error: `Repository '${repoId}' not found.` });
      return;
    }

    const title = String(req.body?.title || `${repo.full_name} Research Code Archive`);
    const creatorName = String(req.body?.creator_name || 'Elena Rostova');
    const creatorAffiliation = String(req.body?.creator_affiliation || 'LaunchPadre Research Lab');
    const commitSha = String(req.body?.commit_sha || repo.head_commit_sha || '91b7e4d20a8c3f567890123456789abcdef98765');

    db.counters.doiId += 1;
    const depositionId = String(Math.floor(Math.random() * 9000000 + 1000000));
    const doi = `10.5281/zenodo.${depositionId}`;
    const doiUrl = `https://doi.org/${doi}`;
    const badgeUrl = `https://zenodo.org/badge/DOI/${doi}.svg`;
    const archiveName = `${repo.name.replace(/[^a-z0-9_-]+/gi, '_')}_${commitSha.slice(0, 8)}.zip`;

    const newDoiRecord: AcademicDoiRow = {
      id: db.counters.doiId,
      repository_id: repo.id,
      commit_sha: commitSha,
      deposition_id: depositionId,
      doi,
      doi_url: doiUrl,
      badge_url: badgeUrl,
      title,
      archive_filename: archiveName,
      archive_size_bytes: Math.floor(Math.random() * 400000 + 150000),
      creator_name: creatorName,
      creator_affiliation: creatorAffiliation,
      minted_at: formatLocalIsoOffset(new Date()),
    };

    db.academic_dois.unshift(newDoiRecord);

    recordLog(
      'INFO',
      'ZENODO_DOI_MINTED',
      201,
      `Minted permanent academic DOI: ${doi} for ${repo.full_name} at commit ${commitSha.slice(0, 8)}`
    );

    res.status(201).json({
      ...newDoiRecord,
      forgejo_repo_id: repo.forgejo_repo_id,
    });
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
  app.get('/api/v1/panic/snapshots/:repo_id', (req: Request, res: Response) => {
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
    const raw = typeof req.body?.rawPayload === 'string' ? req.body.rawPayload : JSON.stringify(req.body?.payload || {});
    const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(raw)).digest('hex');
    res.json({ signature: sig });
  });

  // Phase 1: Ingestion
  app.post('/api/v1/webhooks/git-core', (req: Request, res: Response) => {
    const sig = req.header('X-Gitea-Signature');
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    if (!sig) {
      res.status(401).json({ error: 'Missing signature' });
      return;
    }
    const digest = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(sig.toLowerCase().replace('sha256=', '')))) {
      res.status(401).json({ error: 'Signature mismatch' });
      return;
    }
    const payload = JSON.parse(raw.toString('utf-8'));
    res.json({ status: 'committed', repository_id: payload.repository?.id, processed_commits: payload.commits?.length || 0 });
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

  // PATCH /api/v1/tasks/:task_id/status
  app.patch('/api/v1/tasks/:task_id/status', (req: Request, res: Response) => {
    const task = db.tasks.find((t) => t.id === Number(req.params.task_id));
    if (task) {
      task.status = req.body?.status;
      res.json(hydrateTask(task, db));
    } else {
      res.status(404).json({ error: 'Task not found' });
    }
  });

  // Targeted Endpoints for Clean Partial Reads
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
    res.json(db.users[0] || null);
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
    db = createInitialStore();
    res.json({ status: 'reset' });
  });

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LaunchPadre Phase 2 Engine listening on port ${PORT}`);
  });
}

startServer();
