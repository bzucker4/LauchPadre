import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CustomerAuth } from '../src/customerAuth.ts';
import { CustomerCheckpoints } from '../src/customerCheckpoints.ts';

function git(directory: string, ...args: string[]) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('customer checkpoints preserve real Git commits, quotas, isolation and recovery across restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-checkpoints-'));
  const filename = path.join(root, 'workspace.db');
  let db = new DatabaseSync(filename);
  try {
    const auth = new CustomerAuth(db);
    const a = auth.register('checkpoint-a@example.com', 'example-password');
    const b = auth.register('checkpoint-b@example.com', 'example-password');
    db.exec(`CREATE TABLE customer_repositories (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customer_accounts(id));`);
    db.prepare('INSERT INTO customer_repositories VALUES (?,?)').run('a-repo', a.id);
    db.prepare('INSERT INTO customer_repositories VALUES (?,?)').run('a-alias', a.id);
    db.prepare('INSERT INTO customer_repositories VALUES (?,?)').run('b-repo', b.id);
    const directory = path.join(root, a.id, 'project');
    fs.mkdirSync(directory, { recursive: true });
    git(directory, 'init');
    git(directory, 'config', 'user.name', 'Checkpoint Test');
    git(directory, 'config', 'user.email', 'checkpoint@example.com');
    let checkpoints = new CustomerCheckpoints(db, root);
    assert.equal(checkpoints.info(a, 'a-repo').relative_path, null);
    checkpoints.bind(a, 'a-repo', 'project');
    assert.throws(() => checkpoints.create(a, 'a-repo', 'unborn'), /initial work/);
    assert.throws(() => checkpoints.info(b, 'a-repo'), /not found/);
    assert.throws(() => checkpoints.bind(a, 'a-alias', 'project'), /already connected/);
    assert.throws(() => checkpoints.bind(b, 'b-repo', '../' + a.id + '/project'), /provision/);
    fs.mkdirSync(path.join(root, b.id));
    assert.throws(() => checkpoints.bind(b, 'b-repo', '../' + a.id + '/project'), /relative/);
    fs.symlinkSync(directory, path.join(root, b.id, 'alias'));
    assert.throws(() => checkpoints.bind(b, 'b-repo', 'alias'), /Symlink/);
    fs.writeFileSync(path.join(directory, 'work.txt'), 'first\n');
    git(directory, 'add', '.'); git(directory, 'commit', '-m', 'First');
    const first = checkpoints.create(a, 'a-repo', 'first');
    assert.equal(first.head, git(directory, 'rev-parse', 'HEAD'));
    assert.equal(checkpoints.create(a, 'a-repo', 'first').head, first.head);
    assert.throws(() => checkpoints.create(a, 'a-repo', 'second'), /one checkpoint/);
    db.prepare("UPDATE customer_accounts SET plan='indie_solo' WHERE id=?").run(a.id);
    fs.writeFileSync(path.join(directory, 'work.txt'), 'second\n');
    git(directory, 'commit', '-am', 'Second');
    const secondHead = git(directory, 'rev-parse', 'HEAD');
    checkpoints.create(a, 'a-repo', 'second');
    const input = { tag: first.tag, expected_head: secondHead, expected_target: first.head };
    assert.throws(() => checkpoints.rollback(b, 'a-repo', input), /not found/);
    assert.throws(() => checkpoints.rollback(a, 'a-repo', { ...input, expected_head: first.head }), /HEAD changed/);
    fs.writeFileSync(path.join(directory, 'untracked.txt'), 'keep me');
    assert.throws(() => checkpoints.rollback(a, 'a-repo', input), /clean worktree/);
    assert.equal(fs.readFileSync(path.join(directory, 'untracked.txt'), 'utf8'), 'keep me');
    fs.unlinkSync(path.join(directory, 'untracked.txt'));
    fs.writeFileSync(path.join(directory, '.git', 'info', 'exclude'), 'ignored.txt\n');
    fs.writeFileSync(path.join(directory, 'ignored.txt'), 'keep ignored work');
    assert.throws(() => checkpoints.rollback(a, 'a-repo', input), /clean worktree/);
    fs.unlinkSync(path.join(directory, 'ignored.txt'));
    git(directory, 'tag', '-f', first.tag, secondHead);
    assert.throws(() => checkpoints.rollback(a, 'a-repo', input), /tag changed/);
    git(directory, 'tag', '-f', first.tag, first.head);
    const marker = path.join(root, 'filter-executed');
    git(directory, 'config', 'filter.test.smudge', `touch ${marker}; cat`);
    git(directory, 'config', 'filter.test.clean', `touch ${marker}; cat`);
    fs.writeFileSync(path.join(directory, '.git', 'info', 'attributes'), 'work.txt filter=test\n');
    const restored = checkpoints.rollback(a, 'a-repo', input);
    assert.equal(fs.existsSync(marker), false, 'customer Git filters must never execute');
    assert.equal(fs.readFileSync(path.join(directory, 'work.txt'), 'utf8'), 'first\n');
    assert.equal(git(directory, 'rev-parse', restored.recoveryRef), secondHead);
    db.close(); db = new DatabaseSync(filename);
    checkpoints = new CustomerCheckpoints(db, root);
    assert.equal(checkpoints.info(a, 'a-repo').head, first.head);
    assert.equal(checkpoints.info(a, 'a-repo').snapshots.length, 2);
    db.prepare("UPDATE customer_accounts SET plan='free' WHERE id=?").run(a.id);
    assert.throws(() => checkpoints.create(a, 'a-repo', 'third'), /one checkpoint/);
    assert.equal(checkpoints.info(a, 'a-repo').snapshots.length, 2);
    const recovered = checkpoints.rollback(a, 'a-repo', { tag: 'panic_room_launchpadre_second', expected_head: first.head, expected_target: secondHead });
    assert.equal(recovered.target, secondHead);

    // archiveZip exports committed HEAD only and never includes untracked files
    fs.writeFileSync(path.join(directory, 'secret-untracked.txt'), 'do not archive');
    const archived = checkpoints.archive(a, 'a-repo');
    assert.equal(archived.head, secondHead);
    assert.equal(archived.zip.subarray(0, 2).toString('utf8'), 'PK');
    assert.equal(archived.zip.includes(Buffer.from('work.txt')), true);
    assert.equal(archived.zip.includes(Buffer.from('secret-untracked.txt')), false);
    fs.unlinkSync(path.join(directory, 'secret-untracked.txt'));

    // Non-existent Git root returns clean 503 CheckpointError
    const missingRoot = new CustomerCheckpoints(db, path.join(root, 'does-not-exist'));
    assert.throws(() => missingRoot.info(a, 'a-repo'), /does not exist/);
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
