import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('local setup writes private configuration and preserves an existing .env', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'launchpadre-setup-'));
  const script = fileURLToPath(new URL('../scripts/setup-local.mjs', import.meta.url));
  try {
    const child = spawn(process.execPath, [script], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill(), 5000);
    let output = ''; let sentEmail = false; let sentFolder = false;
    child.stdout.on('data', chunk => {
      output += chunk;
      if (!sentEmail && output.includes('Your email')) { sentEmail = true; child.stdin.write('owner@example.com\n'); }
      if (!sentFolder && output.includes('Folder containing')) { sentFolder = true; child.stdin.end('projects\n'); }
    });
    try {
      const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
      assert.equal(code, 0);
    } finally { clearTimeout(timer); }
    const config = readFileSync(path.join(directory, '.env'), 'utf8');
    assert.ok(config.includes('LOCAL_ONLY="true"'));
    assert.ok(config.includes('ADMIN_EMAIL="owner@example.com"'));
    assert.match(config, /ADMIN_PASSWORD="[a-zA-Z0-9_-]{32}"/);
    assert.ok(existsSync(path.join(directory, 'projects')));
    const second = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8' });
    assert.notEqual(second.status, 0);
    assert.equal(readFileSync(path.join(directory, '.env'), 'utf8'), config);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
