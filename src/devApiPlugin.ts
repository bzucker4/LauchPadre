import type { Plugin, ViteDevServer } from 'vite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { database, RepositoryRow, PanicSnapshotRow, AcademicDoiRow, TaskRow } from './db';

// ============================================================================
// 1. DATA SOVEREIGNTY CONSTANTS & ROBOTS.TXT
// ============================================================================

const BANNED_AI_SCRAPERS = new Set([
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
]);

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

// Cryptographically secure ephemeral secrets if not provided via environment
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex');

// ============================================================================
// 2. NON-BLOCKING ASYNCHRONOUS FILE I/O & MTIME CACHE LAYER
// ============================================================================

interface FileCacheEntry {
  mtimeMs: number;
  content: string;
  size: number;
}

const fileCache = new Map<string, FileCacheEntry>();

export async function getAsyncSourceFile(fileName: string): Promise<{ content: string; size: number } | null> {
  const safeName = path.basename(fileName);
  const filePath = path.resolve(process.cwd(), 'backend_python', safeName);
  try {
    const stat = await fs.promises.stat(filePath);
    const cached = fileCache.get(safeName);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return { content: cached.content, size: cached.size };
    }
    const content = await fs.promises.readFile(filePath, 'utf-8');
    fileCache.set(safeName, { mtimeMs: stat.mtimeMs, content, size: stat.size });
    return { content, size: stat.size };
  } catch {
    return null;
  }
}

const KNOWN_BACKEND_FILES = [
  'main.py',
  'models.py',
  'panic_room.py',
  'billing.py',
  'zenodo.py',
  'middleware.py',
  'schema.sql',
  'requirements.txt',
] as const;

// ============================================================================
// 3. HTTP HELPER UTILITIES
// ============================================================================

function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: any) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res: any, status: number, data: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}

function resolveRepo(idOrForgejoId: number): RepositoryRow | null {
  const stmt = database.db.prepare(`
    SELECT * FROM repositories WHERE forgejo_repo_id = ? OR id = ? LIMIT 1
  `);
  return (stmt.get(idOrForgejoId, idOrForgejoId) as unknown as RepositoryRow) || null;
}

// ============================================================================
// 4. VITE DEV API PLUGIN WITH TARGETED REST ENDPOINTS & SQL QUERIES
// ============================================================================

export function launchPadreApiPlugin(): Plugin {
  return {
    name: 'launchpadre-api-plugin',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const urlObj = new URL(req.url || '/', 'http://localhost');
        const pathname = urlObj.pathname;
        const method = req.method || 'GET';

        // robots.txt
        if (pathname === '/robots.txt') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(DYNAMIC_ROBOTS_TXT_CONTENT);
          return;
        }

        // ====================================================================
        // TARGETED GET READS
        // ====================================================================

        // GET /api/v1/repositories (List all repos with indexed summary)
        if (pathname === '/api/v1/repositories' && method === 'GET') {
          const repos = database.db.prepare(`SELECT * FROM repositories ORDER BY id ASC`).all() as unknown as RepositoryRow[];
          sendJson(res, 200, repos);
          return;
        }

        // GET /api/v1/repositories/:repoId (Single repo details)
        const repoDetailMatch = pathname.match(/^\/api\/v1\/repositories\/(\d+)$/);
        if (repoDetailMatch && method === 'GET') {
          const repoId = Number(repoDetailMatch[1]);
          const repo = resolveRepo(repoId);
          if (!repo) {
            sendJson(res, 404, { error: 'Repository not found' });
            return;
          }
          sendJson(res, 200, repo);
          return;
        }

        // GET /api/v1/repositories/:repoId/snapshots (Targeted snapshots)
        const snapshotsMatch = pathname.match(/^\/api\/v1\/repositories\/(\d+)\/snapshots$/);
        if (snapshotsMatch && method === 'GET') {
          const repoId = Number(snapshotsMatch[1]);
          const repo = resolveRepo(repoId);
          if (!repo) {
            sendJson(res, 404, { error: 'Repository not found' });
            return;
          }
          const snapshots = database.db.prepare(`
            SELECT * FROM panic_snapshots WHERE repository_id = ? ORDER BY created_at DESC
          `).all(repo.id) as unknown as PanicSnapshotRow[];
          sendJson(res, 200, {
            repository_id: repo.id,
            forgejo_repo_id: repo.forgejo_repo_id,
            total: snapshots.length,
            snapshots,
          });
          return;
        }

        // GET /api/v1/repositories/:repoId/dois (Targeted academic DOIs)
        const doisMatch = pathname.match(/^\/api\/v1\/repositories\/(\d+)\/dois$/);
        if (doisMatch && method === 'GET') {
          const repoId = Number(doisMatch[1]);
          const repo = resolveRepo(repoId);
          if (!repo) {
            sendJson(res, 404, { error: 'Repository not found' });
            return;
          }
          const dois = database.db.prepare(`
            SELECT * FROM academic_dois WHERE repository_id = ? ORDER BY minted_at DESC
          `).all(repo.id) as unknown as AcademicDoiRow[];
          sendJson(res, 200, dois);
          return;
        }

        // GET /api/v1/academic/doi/:repoId (Compatibility endpoint)
        const doiCompatMatch = pathname.match(/^\/api\/v1\/academic\/doi\/(\d+)$/);
        if (doiCompatMatch && method === 'GET') {
          const repoId = Number(doiCompatMatch[1]);
          const repo = resolveRepo(repoId);
          if (!repo) {
            sendJson(res, 404, { error: 'Repository not found' });
            return;
          }
          const dois = database.db.prepare(`
            SELECT * FROM academic_dois WHERE repository_id = ? ORDER BY minted_at DESC
          `).all(repo.id) as unknown as AcademicDoiRow[];
          sendJson(res, 200, dois);
          return;
        }

        // GET /api/v1/repositories/:repoId/slop (Targeted slop files)
        const slopMatch = pathname.match(/^\/api\/v1\/repositories\/(\d+)\/slop$/);
        if (slopMatch && method === 'GET') {
          const repoId = Number(slopMatch[1]);
          const repo = resolveRepo(repoId);
          if (!repo) {
            sendJson(res, 404, { error: 'Repository not found' });
            return;
          }
          const slop = database.db.prepare(`
            SELECT * FROM untracked_slop WHERE repository_id = ? ORDER BY generated_at DESC
          `).all(repo.id);
          sendJson(res, 200, slop);
          return;
        }

        // GET /api/v1/repositories/:repoId/tasks (Targeted tasks with SQL join)
        const tasksMatch = pathname.match(/^\/api\/v1\/repositories\/(\d+)\/tasks$/);
        if (tasksMatch && method === 'GET') {
          const repoId = Number(tasksMatch[1]);
          const repo = resolveRepo(repoId);
          if (!repo) {
            sendJson(res, 404, { error: 'Repository not found' });
            return;
          }
          const tasks = database.db.prepare(`
            SELECT * FROM tasks WHERE repository_id = ? ORDER BY id ASC
          `).all(repo.id) as unknown as TaskRow[];

          const taskWithCommits = tasks.map((t) => {
            const commits = database.db.prepare(`
              SELECT c.commit_sha, c.message, c.author_name, c.committed_at, l.action_type
              FROM task_commit_links l
              JOIN commits c ON c.id = l.commit_id
              WHERE l.task_id = ?
            `).all(t.id);
            return { ...t, commits };
          });

          sendJson(res, 200, {
            repository_id: repo.id,
            forgejo_repo_id: repo.forgejo_repo_id,
            repository_name: repo.full_name,
            tasks: taskWithCommits,
            todo: taskWithCommits.filter((t) => t.status === 'todo'),
            in_progress: taskWithCommits.filter((t) => t.status === 'in_progress'),
            done: taskWithCommits.filter((t) => t.status === 'done'),
          });
          return;
        }

        // GET /api/v1/billing/subscription (Targeted user subscription query)
        if (pathname === '/api/v1/billing/subscription' && method === 'GET') {
          const user = database.db.prepare(`SELECT * FROM users ORDER BY id ASC LIMIT 1`).get();
          sendJson(res, 200, user);
          return;
        }

        // GET /api/v1/sovereignty/stats (Targeted sovereignty telemetry)
        if (pathname === '/api/v1/sovereignty/stats' && method === 'GET') {
          const blockedCount = database.db.prepare(`
            SELECT COUNT(*) as count FROM scraper_probes WHERE status = 'intercepted_403'
          `).get() as { count: number };
          const recentProbes = database.db.prepare(`
            SELECT * FROM scraper_probes ORDER BY timestamp DESC LIMIT 20
          `).all();
          sendJson(res, 200, {
            blocked_count: blockedCount.count,
            recent_probes: recentProbes,
            banned_signatures: Array.from(BANNED_AI_SCRAPERS),
          });
          return;
        }

        // GET /api/v1/source/:filename (Targeted lazy async source file with mtime caching)
        if (pathname.startsWith('/api/v1/source/') && method === 'GET') {
          const rawFileName = pathname.replace('/api/v1/source/', '').trim();
          const fileData = await getAsyncSourceFile(rawFileName);
          if (!fileData) {
            sendJson(res, 404, { error: `File '${rawFileName}' not found` });
            return;
          }
          sendJson(res, 200, {
            filename: rawFileName,
            content: fileData.content,
            size_bytes: fileData.size,
          });
          return;
        }

        // GET /api/v1/audit-logs (Paginated audit trail via SQL LIMIT / OFFSET)
        if (pathname === '/api/v1/audit-logs' && method === 'GET') {
          const page = Math.max(1, Number(urlObj.searchParams.get('page') || 1));
          const limit = Math.min(100, Math.max(1, Number(urlObj.searchParams.get('limit') || 20)));
          const offset = (page - 1) * limit;

          const totalRow = database.db.prepare(`SELECT COUNT(*) as count FROM audit_logs`).get() as { count: number };
          const items = database.db.prepare(`
            SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?
          `).all(limit, offset);

          sendJson(res, 200, {
            total: totalRow.count,
            page,
            limit,
            items,
          });
          return;
        }

        // GET /api/v1/state (Lean backwards-compatible query backed by SQL indexes)
        if (pathname === '/api/v1/state' && method === 'GET') {
          const users = database.db.prepare(`SELECT * FROM users`).all();
          const repos = database.db.prepare(`SELECT * FROM repositories`).all();
          const tasks = database.db.prepare(`SELECT * FROM tasks`).all() as unknown as TaskRow[];
          const tasksHydrated = tasks.map((t) => {
            const commits = database.db.prepare(`
              SELECT c.commit_sha, c.message, c.author_name, c.committed_at, l.action_type
              FROM task_commit_links l
              JOIN commits c ON c.id = l.commit_id
              WHERE l.task_id = ?
            `).all(t.id);
            return { ...t, commits };
          });

          const commits = database.db.prepare(`SELECT * FROM commits ORDER BY committed_at DESC`).all();
          const dois = database.db.prepare(`SELECT * FROM academic_dois ORDER BY minted_at DESC`).all();
          const snapshots = database.db.prepare(`SELECT * FROM panic_snapshots ORDER BY created_at DESC`).all();
          const slop = database.db.prepare(`SELECT * FROM untracked_slop ORDER BY generated_at DESC`).all();
          const probes = database.db.prepare(`SELECT * FROM scraper_probes ORDER BY timestamp DESC LIMIT 30`).all();
          const audit = database.db.prepare(`SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 30`).all();

          sendJson(res, 200, {
            users,
            repositories: repos,
            tasks: tasksHydrated,
            commits,
            academic_dois: dois,
            panic_snapshots: snapshots,
            untracked_slop: slop,
            scraper_probes: probes,
            audit_logs: audit,
            known_source_files: KNOWN_BACKEND_FILES,
          });
          return;
        }

        // ====================================================================
        // MUTATION ENDPOINTS (SQL TRANSACTIONS & PREPARED INSERTS)
        // ====================================================================

        // POST /api/v1/panic/snapshots (Create snapshot with unborn HEAD auto-init)
        if (pathname === '/api/v1/panic/snapshots' && method === 'POST') {
          const body = await readBody(req);
          const repoId = Number(body.repo_id);
          const repo = resolveRepo(repoId);

          if (!repo) {
            sendJson(res, 404, { error: 'Repository not found' });
            return;
          }

          let headSha = repo.head_commit_sha;

          // Unborn HEAD Resiliency Patch
          if (repo.is_unborn_head || !headSha) {
            headSha = '01a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f901';
            const now = new Date().toISOString();
            database.db.prepare(`
              INSERT INTO commits (repository_id, commit_sha, message, author_name, author_email, committed_at, ingested_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              repo.id,
              headSha,
              'Initial empty commit for LaunchPadre snapshot tracking verification\ntracker: .launchpadre_init staged',
              'LaunchPadre System Guard',
              'guard@launchpadre.local',
              now,
              now
            );

            database.db.prepare(`
              UPDATE repositories SET head_commit_sha = ?, is_unborn_head = 0, updated_at = ? WHERE id = ?
            `).run(headSha, now, repo.id);
          }

          const rawName = String(body.snapshot_name || 'checkpoint').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
          const tagName = `panic_room_launchpadre_${rawName}`;
          const snapshotId = `ps_${Date.now()}`;
          const nowIso = new Date().toISOString();

          database.db.prepare(`
            INSERT INTO panic_snapshots (id, repository_id, forgejo_repo_id, tag_name, sanitized_name, target_commit_sha, commit_message, author_name, author_email, created_at, is_head_commit, message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(repository_id, tag_name) DO UPDATE SET
              sanitized_name = excluded.sanitized_name,
              target_commit_sha = excluded.target_commit_sha,
              created_at = excluded.created_at,
              message = excluded.message
          `).run(
            snapshotId,
            repo.id,
            repo.forgejo_repo_id,
            tagName,
            rawName,
            headSha,
            'Current HEAD Snapshot checkpoint',
            'LaunchPadre Guard',
            'guard@launchpadre.local',
            nowIso,
            body.message || null
          );

          database.recordLog('INFO', 'SNAPSHOT_CREATED', 201, `Created snapshot ${tagName} for repo #${repo.forgejo_repo_id}`);

          sendJson(res, 201, {
            id: snapshotId,
            repository_id: repo.id,
            forgejo_repo_id: repo.forgejo_repo_id,
            tag_name: tagName,
            sanitized_name: rawName,
            target_commit_sha: headSha,
            commit_message: 'Current HEAD Snapshot checkpoint',
            created_at: nowIso,
            is_head_commit: true,
          });
          return;
        }

        // POST /api/v1/panic/rollback (Emergency rollback with slop purging)
        if (pathname === '/api/v1/panic/rollback' && method === 'POST') {
          const body = await readBody(req);
          const repoId = Number(body.repo_id);
          const targetName = String(body.snapshot_name || '').trim();
          const repo = resolveRepo(repoId);

          if (!repo) {
            sendJson(res, 404, { error: 'Repository not found' });
            return;
          }

          const snapshot = database.db.prepare(`
            SELECT * FROM panic_snapshots
            WHERE repository_id = ? AND (sanitized_name = ? OR tag_name = ? OR tag_name = ?)
            LIMIT 1
          `).get(repo.id, targetName, targetName, `panic_room_launchpadre_${targetName}`) as PanicSnapshotRow | undefined;

          if (!snapshot) {
            sendJson(res, 404, { error: 'Snapshot not found' });
            return;
          }

          const prevSha = repo.head_commit_sha;
          const nowIso = new Date().toISOString();

          // Update repository HEAD in SQL
          database.db.prepare(`
            UPDATE repositories SET head_commit_sha = ?, updated_at = ? WHERE id = ?
          `).run(snapshot.target_commit_sha, nowIso, repo.id);

          // Purge slop files via SQL
          const slopRows = database.db.prepare(`
            SELECT file_path FROM untracked_slop WHERE repository_id = ?
          `).all(repo.id) as Array<{ file_path: string }>;
          const purged = slopRows.map((s) => s.file_path);

          database.db.prepare(`DELETE FROM untracked_slop WHERE repository_id = ?`).run(repo.id);

          database.recordLog(
            'WARNING',
            'ROLLBACK_EXECUTED',
            200,
            `Hard reset repo #${repo.forgejo_repo_id} to ${snapshot.target_commit_sha.slice(0, 8)} (${snapshot.tag_name}). Purged ${purged.length} file(s).`
          );

          sendJson(res, 200, {
            status: 'rolled_back',
            tag_name: snapshot.tag_name,
            target_commit_sha: snapshot.target_commit_sha,
            previous_head_sha: prevSha,
            purged_untracked_count: purged.length,
            purged_entries: purged,
            executed_at: nowIso,
          });
          return;
        }

        // POST /api/v1/panic/slop/generate (Simulate AI slop)
        if (pathname === '/api/v1/panic/slop/generate' && method === 'POST') {
          const body = await readBody(req);
          const repoId = Number(body.repo_id) || 1;
          const repo = resolveRepo(repoId) || resolveRepo(1)!;
          const fileName = `src/broken_ai_slop_${Date.now().toString().slice(-4)}.py`;

          database.db.prepare(`
            INSERT INTO untracked_slop (id, repository_id, file_path, size_bytes, created_by_slop, generated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            `slop_${Date.now()}`,
            repo.id,
            fileName,
            3840,
            'Malfunctioning assistant loop',
            new Date().toISOString()
          );

          sendJson(res, 200, { status: 'slop_generated', file: fileName });
          return;
        }

        // POST /api/v1/sovereignty/test-probe (Layer B test)
        if (pathname === '/api/v1/sovereignty/test-probe' && method === 'POST') {
          const body = await readBody(req);
          const agent = String(body.user_agent || '').toLowerCase().trim();
          let matched: string | null = null;
          for (const s of BANNED_AI_SCRAPERS) {
            if (agent.includes(s)) {
              matched = s;
              break;
            }
          }

          if (matched) {
            database.db.prepare(`
              INSERT INTO scraper_probes (id, timestamp, user_agent, matched_signature, status, client_ip, path)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              `probe_${Date.now()}`,
              new Date().toISOString(),
              agent,
              matched,
              'intercepted_403',
              '127.0.0.1',
              '/src/main.py'
            );

            sendJson(res, 403, {
              decision: 'BLOCKED',
              status_code: 403,
              matched_signature: matched,
              message: `403 Forbidden: AI scraper intercepted (${matched})`,
              injected_headers: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
            });
            return;
          }

          sendJson(res, 200, {
            decision: 'ALLOWED',
            status_code: 200,
            matched_signature: null,
            message: 'Legitimate developer client authenticated.',
            injected_headers: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
          });
          return;
        }

        // POST /api/v1/billing/checkout-session
        if (pathname === '/api/v1/billing/checkout-session' && method === 'POST') {
          const body = await readBody(req);
          const userId = Number(body.user_id || 1);
          const planId = String(body.plan_id || 'indie_solo');
          const sessionId = `cs_test_${crypto.randomBytes(12).toString('hex')}`;

          sendJson(res, 200, {
            session_id: sessionId,
            checkout_url: `https://checkout.stripe.com/c/pay/${sessionId}`,
            plan_id: planId,
            plan_name: planId === 'academic_tier' ? 'Academic Researcher Tier' : 'Indie Solo Tier',
            amount_usd: planId === 'academic_tier' ? 29 : 12,
            user_id: userId,
          });
          return;
        }

        // POST /api/v1/billing/webhooks/stripe
        if (pathname === '/api/v1/billing/webhooks/stripe' && method === 'POST') {
          const body = await readBody(req);
          const eventType = body.type || 'checkout.session.completed';
          const nowIso = new Date().toISOString();

          if (eventType === 'checkout.session.completed') {
            const planId = body.plan_id || 'academic_tier';
            database.db.prepare(`
              UPDATE users SET plan = ?, is_premium = 1, updated_at = ? WHERE id = 1
            `).run(planId, nowIso);

            database.recordLog('INFO', 'SUBSCRIPTION_UPGRADED', 200, `Upgraded user #1 to ${planId}`);
            sendJson(res, 200, {
              status: 'user_upgraded_to_premium',
              user_id: 1,
              customer_id: 'cus_simulated_99',
              processed: true,
            });
            return;
          } else if (eventType === 'customer.subscription.deleted') {
            database.db.prepare(`
              UPDATE users SET plan = 'free', is_premium = 0, updated_at = ? WHERE id = 1
            `).run(nowIso);

            database.recordLog('WARNING', 'SUBSCRIPTION_DOWNGRADED', 200, `Downgraded user #1 to free tier`);
            sendJson(res, 200, {
              status: 'user_downgraded_to_free',
              user_id: 1,
              processed: true,
            });
            return;
          }

          sendJson(res, 200, { status: 'acknowledged', event_type: eventType });
          return;
        }

        // POST /api/v1/academic/doi/mint
        if (pathname === '/api/v1/academic/doi/mint' && method === 'POST') {
          const body = await readBody(req);
          const repoId = Number(body.repo_id || 1);
          const repo = resolveRepo(repoId) || resolveRepo(1)!;
          const depId = String(Math.floor(Math.random() * 9000000 + 1000000));
          const doi = `10.5281/zenodo.${depId}`;
          const nowIso = new Date().toISOString();
          const headSha = repo.head_commit_sha || '91b7e4d20a8c3f567890123456789abcdef98765';
          const archiveName = `${repo.name}_${headSha.slice(0, 8)}.zip`;

          const insertDoi = database.db.prepare(`
            INSERT INTO academic_dois (repository_id, forgejo_repo_id, commit_sha, deposition_id, doi, doi_url, badge_url, title, archive_filename, archive_size_bytes, creator_name, creator_affiliation, minted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          insertDoi.run(
            repo.id,
            repo.forgejo_repo_id,
            headSha,
            depId,
            doi,
            `https://doi.org/${doi}`,
            `https://zenodo.org/badge/DOI/${doi}.svg`,
            String(body.title || `${repo.full_name} Research Code Archive`),
            archiveName,
            412800,
            String(body.creator_name || 'Elena Rostova'),
            String(body.creator_affiliation || 'LaunchPadre Systems Research'),
            nowIso
          );

          database.recordLog('INFO', 'ZENODO_DOI_MINTED', 201, `Minted DOI ${doi} for ${repo.full_name}`);

          sendJson(res, 201, {
            repository_id: repo.id,
            forgejo_repo_id: repo.forgejo_repo_id,
            commit_sha: headSha,
            deposition_id: depId,
            doi,
            doi_url: `https://doi.org/${doi}`,
            badge_url: `https://zenodo.org/badge/DOI/${doi}.svg`,
            title: String(body.title || `${repo.full_name} Research Code Archive`),
            archive_filename: archiveName,
            creator_name: String(body.creator_name || 'Elena Rostova'),
            creator_affiliation: String(body.creator_affiliation || 'LaunchPadre Systems Research'),
            minted_at: nowIso,
          });
          return;
        }

        // POST /api/v1/state/reset
        if (pathname === '/api/v1/state/reset' && method === 'POST') {
          database.resetAll();
          sendJson(res, 200, { status: 'reset' });
          return;
        }

        next();
      });
    },
  };
}
