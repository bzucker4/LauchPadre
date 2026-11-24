import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CustomerAuth } from '../src/customerAuth.ts';
import { CustomerCheckpoints } from '../src/customerCheckpoints.ts';
import { CustomerZenodo } from '../src/customerZenodo.ts';

function git(directory: string, ...args: string[]) {
  return execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

test('customer Zenodo archival enforces Academic plan, uploads committed ZIP, and requires confirmation to publish', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-zenodo-'));
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    const auth = new CustomerAuth(db);
    const researcher = auth.register('researcher@university.edu', 'example-password');
    const other = auth.register('other@university.edu', 'example-password');

    db.exec(
      `CREATE TABLE customer_repositories (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );`
    );
    db.prepare('INSERT INTO customer_repositories VALUES (?,?,?,?)').run(
      'repo-1',
      researcher.id,
      'climate-sim',
      new Date().toISOString()
    );

    const repoDir = path.join(root, researcher.id, 'climate-sim');
    fs.mkdirSync(repoDir, { recursive: true });
    git(repoDir, 'init');
    git(repoDir, 'config', 'user.name', 'Dr. Researcher');
    git(repoDir, 'config', 'user.email', 'researcher@university.edu');
    fs.writeFileSync(path.join(repoDir, 'model.py'), 'print("ok")\n');
    git(repoDir, 'add', '.');
    git(repoDir, 'commit', '-m', 'Initial release');
    fs.writeFileSync(path.join(repoDir, 'untracked-secret.env'), 'SECRET=123\n');

    const checkpoints = new CustomerCheckpoints(db, root);
    checkpoints.bind(researcher, 'repo-1', 'climate-sim');

    const uploads: Uint8Array[] = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://sandbox.zenodo.org');
      assert.equal((init?.headers as Record<string, string>)?.Authorization, 'Bearer zeno_test_pat');

      if (url.pathname === '/api/deposit/depositions' && init?.method === 'POST') {
        return Response.json(
          { id: 424242, links: { bucket: 'https://sandbox.zenodo.org/api/files/bucket-1' } },
          { status: 201 }
        );
      }
      if (url.pathname.startsWith('/api/files/bucket-1/') && init?.method === 'PUT') {
        uploads.push(init.body as Uint8Array);
        return Response.json({ key: url.pathname.split('/').pop() }, { status: 200 });
      }
      if (url.pathname === '/api/deposit/depositions/424242' && init?.method === 'PUT') {
        const parsed = JSON.parse(String(init.body));
        assert.equal(parsed.metadata.upload_type, 'software');
        assert.equal(parsed.metadata.title, 'Climate Sim v1.0');
        return Response.json({ id: 424242 }, { status: 200 });
      }
      if (url.pathname === '/api/deposit/depositions/424242/actions/publish' && init?.method === 'POST') {
        return Response.json(
          {
            doi: '10.5072/zenodo.424242',
            doi_url: 'https://doi.org/10.5072/zenodo.424242',
            links: { badge: 'https://sandbox.zenodo.org/badge/DOI/10.5072/zenodo.424242.svg' },
          },
          { status: 202 }
        );
      }
      throw new Error(`Unexpected Zenodo request: ${init?.method} ${url.toString()}`);
    };

    const zenodo = new CustomerZenodo(db, checkpoints, mockFetch, {
      token: 'zeno_test_pat',
      baseUrl: 'https://sandbox.zenodo.org',
    });

    // Free plan cannot create drafts
    await assert.rejects(
      zenodo.createDraft(researcher, 'repo-1', { title: 'Climate Sim v1.0', creator_name: 'Dr. Researcher' }),
      /Academic Researcher plan/
    );

    // Upgrade to Academic Researcher
    db.prepare("UPDATE customer_accounts SET plan='academic_tier' WHERE id=?").run(researcher.id);
    const draft = await zenodo.createDraft(
      { ...researcher, plan: 'academic_tier' },
      'repo-1',
      {
        title: 'Climate Sim v1.0',
        creator_name: 'Dr. Researcher',
        creator_affiliation: 'Open Science Lab',
      }
    );

    assert.equal(draft.status, 'draft');
    assert.equal(draft.deposition_id, '424242');
    assert.equal(draft.sandbox, true);
    assert.equal(uploads.length, 1);
    const uploadedZip = Buffer.from(uploads[0]);
    assert.ok(uploadedZip.length > 0);
    assert.equal(uploadedZip.subarray(0, 2).toString('utf8'), 'PK');
    assert.equal(uploadedZip.includes(Buffer.from('model.py')), true);
    assert.equal(uploadedZip.includes(Buffer.from('untracked-secret.env')), false);

    // Other customer cannot access or publish
    assert.throws(() => zenodo.list(other, 'repo-1'), /not found/);
    await assert.rejects(zenodo.publishDraft(other, 'repo-1', draft.id, true), /not found/);

    // Explicit confirmation is required to publish
    await assert.rejects(
      zenodo.publishDraft({ ...researcher, plan: 'academic_tier' }, 'repo-1', draft.id, false),
      /Explicit confirmation/
    );

    // Confirmed publish records permanent DOI
    const published = await zenodo.publishDraft({ ...researcher, plan: 'academic_tier' }, 'repo-1', draft.id, true);
    assert.equal(published.status, 'published');
    assert.equal(published.doi, '10.5072/zenodo.424242');
    assert.equal(published.doi_url, 'https://doi.org/10.5072/zenodo.424242');

    // After downgrade to free, published archive remains visible while new drafts are blocked
    db.prepare("UPDATE customer_accounts SET plan='free' WHERE id=?").run(researcher.id);
    const listed = zenodo.list(researcher, 'repo-1');
    assert.equal(listed.allowed, false);
    assert.equal(listed.archives.length, 1);
    assert.equal(listed.archives[0].doi, '10.5072/zenodo.424242');

    // Unconfigured Zenodo rejects gracefully without fabricating DOIs
    db.prepare("UPDATE customer_accounts SET plan='academic_tier' WHERE id=?").run(researcher.id);
    const unconfigured = new CustomerZenodo(db, checkpoints, mockFetch, { token: '' });
    assert.equal(unconfigured.configured(), false);
    await assert.rejects(
      unconfigured.createDraft({ ...researcher, plan: 'academic_tier' }, 'repo-1', {
        title: 'Should Fail',
        creator_name: 'Dr. Researcher',
      }),
      /not configured/
    );
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
