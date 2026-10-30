import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24 for LaunchPadre.');
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { throw new Error('Install Git before running local setup.'); }
if (fs.existsSync('.env')) throw new Error('.env already exists. Existing settings were preserved. Edit that file to change your configuration.');
const input = createInterface({ input: process.stdin, output: process.stdout });
try {
  let email = '';
  while (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = (await input.question('Your email (workspace identity; no email will be sent): ')).trim();
  const root = path.resolve((await input.question('Folder containing your Git projects [./repositories]: ')).trim() || './repositories');
  if (/[\r\n"]/.test(root)) throw new Error('Choose a folder path without quotes or newlines.');
  fs.mkdirSync(root, { recursive: true });
  const password = crypto.randomBytes(24).toString('base64url');
  const values = {
    LAUNCHPADRE_DEMO: 'false', LOCAL_ONLY: 'true', ADMIN_EMAIL: email, ADMIN_PASSWORD: password,
    APP_ORIGIN: 'http://127.0.0.1:3000', PORT: '3000', STATE_DB_PATH: './data/local-workspace.db',
    GIT_REPOSITORIES_ROOT: root.replaceAll('\\', '/'),
  };
  fs.writeFileSync('.env', Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  console.log('\nLocal setup saved. Your workspace password is:');
  console.log(password);
  console.log('\nKeep this password. You can also find it in your local .env file.');
  console.log('Start with: npm run local');
} finally { input.close(); }
