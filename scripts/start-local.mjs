import 'dotenv/config';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24 for LaunchPadre.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 16 || !process.env.ADMIN_EMAIL) throw new Error('Run npm run setup:local first, or configure ADMIN_EMAIL and ADMIN_PASSWORD in .env.');
const build = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, stdio: 'inherit' });
if (build.error || build.status !== 0) throw new Error('Frontend build failed. Run npm ci and try again.');
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production', LOCAL_ONLY: 'true', APP_ORIGIN: `http://127.0.0.1:${port}` },
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
