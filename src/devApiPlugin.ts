import type { Plugin, ViteDevServer } from 'vite';
import fs from 'fs';
import path from 'path';

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

function createInitialStore() {
  const now = new Date(Date.now() - 3600_000 * 5).toISOString();
  const later = new Date(Date.now() - 3600_000 * 2).toISOString();
  const recent = new Date(Date.now() - 1800_000).toISOString();
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
    untracked_slop: [] as Array<{ id: string; repository_id: number; file_path: string; size_bytes: number; created_by_slop: string; generated_at: string }>,
    scraper_probes: [] as Array<any>,
    audit_logs: [
      {
        id: 'audit_init',
        timestamp: new Date().toISOString(),
        level: 'INFO',
        event: 'STANDALONE_VITE_ACTIVE',
        correlation_id: 'boot_001',
        status_code: 200,
        details: 'LaunchPadre Standalone Vite Dev Server bound to 0.0.0.0:3000 (strictPort: true, hmr clientPort: 443)',
      },
    ],
  };
}

let store = createInitialStore();

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

export function launchPadreApiPlugin(): Plugin {
  return {
    name: 'launchpadre-api-plugin',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        const method = req.method || 'GET';

        // robots.txt
        if (url === '/robots.txt') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(DYNAMIC_ROBOTS_TXT_CONTENT);
          return;
        }

        // Full State Query
        if (url.startsWith('/api/v1/state') && method === 'GET') {
          const readBackend = (f: string) => {
            const p = path.resolve(process.cwd(), 'backend_python', f);
            return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
          };

          const tasksHydrated = store.tasks.map((task) => {
            const links = store.task_commit_links.filter((l) => l.task_id === task.id);
            const commits = links
              .map((link) => {
                const commit = store.commits.find((c) => c.id === link.commit_id);
                return commit
                  ? {
                      commit_sha: commit.commit_sha,
                      action_type: link.action_type,
                      message: commit.message,
                      author_name: commit.author_name,
                      committed_at: commit.committed_at,
                    }
                  : null;
              })
              .filter(Boolean);
            return { ...task, commits };
          });

          sendJson(res, 200, {
            users: store.users,
            repositories: store.repositories,
            tasks: tasksHydrated,
            commits: store.commits,
            task_commit_links: store.task_commit_links,
            academic_dois: store.academic_dois,
            panic_snapshots: store.panic_snapshots,
            untracked_slop: store.untracked_slop,
            scraper_probes: store.scraper_probes,
            audit_logs: store.audit_logs,
            source_files: {
              'main.py': readBackend('main.py'),
              'models.py': readBackend('models.py'),
              'panic_room.py': readBackend('panic_room.py'),
              'billing.py': readBackend('billing.py'),
              'zenodo.py': readBackend('zenodo.py'),
              'middleware.py': readBackend('middleware.py'),
              'schema.sql': readBackend('schema.sql'),
              'requirements.txt': readBackend('requirements.txt'),
            },
          });
          return;
        }

        // Create Snapshot
        if (url.startsWith('/api/v1/panic/snapshots') && method === 'POST') {
          const body = await readBody(req);
          const repoId = Number(body.repo_id);
          const repo = store.repositories.find((r) => r.forgejo_repo_id === repoId || r.id === repoId);

          if (!repo) {
            sendJson(res, 404, { error: 'Repository not found' });
            return;
          }

          if (repo.is_unborn_head || !repo.head_commit_sha) {
            const initSha = '01a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f901';
            repo.head_commit_sha = initSha;
            repo.is_unborn_head = false;
            store.commits.unshift({
              id: store.commits.length + 1,
              repository_id: repo.id,
              commit_sha: initSha,
              message: 'Initial empty commit for LaunchPadre snapshot tracking verification\ntracker: .launchpadre_init staged',
              author_name: 'LaunchPadre System Guard',
              author_email: 'guard@launchpadre.local',
              committed_at: new Date().toISOString(),
              ingested_at: new Date().toISOString(),
            });
          }

          const rawName = String(body.snapshot_name || 'checkpoint').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
          const tagName = `panic_room_launchpadre_${rawName}`;
          const snapshot = {
            id: `ps_${Date.now()}`,
            repository_id: repo.id,
            forgejo_repo_id: repo.forgejo_repo_id,
            tag_name: tagName,
            sanitized_name: rawName,
            target_commit_sha: repo.head_commit_sha,
            commit_message: 'Current HEAD Snapshot checkpoint',
            author_name: 'LaunchPadre Guard',
            author_email: 'guard@launchpadre.local',
            created_at: new Date().toISOString(),
            is_head_commit: true,
            message: body.message,
          };
          store.panic_snapshots.unshift(snapshot);
          sendJson(res, 201, snapshot);
          return;
        }

        // Rollback
        if (url.startsWith('/api/v1/panic/rollback') && method === 'POST') {
          const body = await readBody(req);
          const repoId = Number(body.repo_id);
          const targetName = String(body.snapshot_name || '').trim();
          const repo = store.repositories.find((r) => r.forgejo_repo_id === repoId || r.id === repoId);
          if (!repo) {
            sendJson(res, 404, { error: 'Repository not found' });
            return;
          }

          const snapshot = store.panic_snapshots.find(
            (s) => s.repository_id === repo.id && (s.sanitized_name === targetName || s.tag_name.includes(targetName))
          );
          if (!snapshot) {
            sendJson(res, 404, { error: 'Snapshot not found' });
            return;
          }

          const prevSha = repo.head_commit_sha;
          repo.head_commit_sha = snapshot.target_commit_sha;
          const purged = store.untracked_slop.filter((s) => s.repository_id === repo.id).map((s) => s.file_path);
          store.untracked_slop = store.untracked_slop.filter((s) => s.repository_id !== repo.id);

          sendJson(res, 200, {
            status: 'rolled_back',
            tag_name: snapshot.tag_name,
            target_commit_sha: snapshot.target_commit_sha,
            previous_head_sha: prevSha,
            purged_untracked_count: purged.length,
            purged_entries: purged,
            executed_at: new Date().toISOString(),
          });
          return;
        }

        // Generate Slop
        if (url.startsWith('/api/v1/panic/slop/generate') && method === 'POST') {
          const body = await readBody(req);
          const repoId = Number(body.repo_id) || 1;
          const repo = store.repositories.find((r) => r.id === repoId || r.forgejo_repo_id === repoId) || store.repositories[0];
          const fileName = `src/broken_ai_slop_${Date.now().toString().slice(-4)}.py`;
          store.untracked_slop.unshift({
            id: `slop_${Date.now()}`,
            repository_id: repo.id,
            file_path: fileName,
            size_bytes: 3840,
            created_by_slop: 'Malfunctioning assistant loop',
            generated_at: new Date().toISOString(),
          });
          sendJson(res, 200, { status: 'slop_generated', file: fileName });
          return;
        }

        // Sovereignty probe
        if (url.startsWith('/api/v1/sovereignty/test-probe') && method === 'POST') {
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
            store.scraper_probes.unshift({
              id: `probe_${Date.now()}`,
              timestamp: new Date().toISOString(),
              user_agent: agent,
              matched_signature: matched,
              status: 'intercepted_403',
              client_ip: '127.0.0.1',
              path: '/src/main.py',
            });
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

        // Stripe Checkout
        if (url.startsWith('/api/v1/billing/checkout-session') && method === 'POST') {
          const body = await readBody(req);
          const userId = Number(body.user_id || 1);
          const planId = String(body.plan_id || 'indie_solo');
          const sessionId = `cs_test_${Math.random().toString(36).slice(2, 12)}`;
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

        // Stripe Webhook
        if (url.startsWith('/api/v1/billing/webhooks/stripe') && method === 'POST') {
          const body = await readBody(req);
          const eventType = body.type || 'checkout.session.completed';
          const user = store.users[0];
          if (eventType === 'checkout.session.completed') {
            user.plan = (body.plan_id || 'indie_solo') as any;
            user.is_premium = true;
            sendJson(res, 200, {
              status: 'user_upgraded_to_premium',
              user_id: user.id,
              customer_id: 'cus_simulated_99',
              processed: true,
            });
            return;
          } else if (eventType === 'customer.subscription.deleted') {
            user.plan = 'free';
            user.is_premium = false;
            sendJson(res, 200, {
              status: 'user_downgraded_to_free',
              user_id: user.id,
              processed: true,
            });
            return;
          }
          sendJson(res, 200, { status: 'acknowledged', event_type: eventType });
          return;
        }

        // Zenodo DOI Mint
        if (url.startsWith('/api/v1/academic/doi/mint') && method === 'POST') {
          const body = await readBody(req);
          const repoId = Number(body.repo_id || 1);
          const repo = store.repositories.find((r) => r.id === repoId || r.forgejo_repo_id === repoId) || store.repositories[0];
          const depId = String(Math.floor(Math.random() * 9000000 + 1000000));
          const doi = `10.5281/zenodo.${depId}`;
          const newDoi = {
            id: store.academic_dois.length + 1,
            repository_id: repo.id,
            forgejo_repo_id: repo.forgejo_repo_id,
            commit_sha: repo.head_commit_sha || '91b7e4d20a8c3f567890123456789abcdef98765',
            deposition_id: depId,
            doi,
            doi_url: `https://doi.org/${doi}`,
            badge_url: `https://zenodo.org/badge/DOI/${doi}.svg`,
            title: String(body.title || `${repo.full_name} Research Code Archive`),
            archive_filename: `${repo.name}_${(repo.head_commit_sha || '91b7e4d2').slice(0, 8)}.zip`,
            archive_size_bytes: 412800,
            creator_name: String(body.creator_name || 'Elena Rostova'),
            creator_affiliation: String(body.creator_affiliation || 'LaunchPadre Systems Research'),
            minted_at: new Date().toISOString(),
          };
          store.academic_dois.unshift(newDoi);
          sendJson(res, 201, newDoi);
          return;
        }

        next();
      });
    },
  };
}
