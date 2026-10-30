import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { GitWorkspace } from '../src/gitWorkspace.ts';

test('live snapshots and rollback preserve a recovery ref and reject unsafe worktrees', () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'launchpadre-git-'));
  const directory = path.join(root, 'project'); fs.mkdirSync(directory);
  const git = (...args: string[]) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();
  try {
    git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(directory, 'file.txt'), 'baseline'); git('add', '.'); git('commit', '-qm', 'baseline');
    const workspace = new GitWorkspace(root);
    assert.throws(() => workspace.resolve('../outside'));
    assert.throws(() => workspace.resolve(directory));
    const checkpoint = workspace.snapshot('project', 'baseline');
    assert.throws(() => workspace.snapshot('project', 'baseline'));
    fs.writeFileSync(path.join(directory, 'file.txt'), 'updated');
    assert.throws(() => workspace.rollback('project', checkpoint.tag, checkpoint.head, checkpoint.head), /clean worktree/);
    git('add', '.'); git('commit', '-qm', 'update');
    const latest = workspace.inspect('project').head;
    assert.throws(() => workspace.rollback('project', checkpoint.tag, checkpoint.head, checkpoint.head), /HEAD changed/);
    fs.writeFileSync(path.join(directory, 'untracked.txt'), 'keep me');
    assert.throws(() => workspace.rollback('project', checkpoint.tag, latest, checkpoint.head), /clean worktree/);
    assert.equal(fs.readFileSync(path.join(directory, 'untracked.txt'), 'utf8'), 'keep me');
    fs.unlinkSync(path.join(directory, 'untracked.txt'));
    const result = workspace.rollback('project', checkpoint.tag, latest, checkpoint.head);
    assert.equal(workspace.inspect('project').head, checkpoint.head);
    assert.equal(git('rev-parse', result.recoveryRef), latest);
    assert.equal(fs.readFileSync(path.join(directory, 'file.txt'), 'utf8'), 'baseline');
    git('tag', '-f', checkpoint.tag, latest);
    assert.throws(() => workspace.rollback('project', checkpoint.tag, checkpoint.head, checkpoint.head), /tag changed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
