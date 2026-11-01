import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { GitWorkspace } from '../src/gitWorkspace.ts';
import { StateStore } from '../src/stateStore.ts';

function fixture() {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'launchpadre-recovery-'));
  const workspace = path.join(directory, 'workspace');
  const projects = path.join(workspace, 'projects');
  const project = path.join(projects, 'project'); fs.mkdirSync(project, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(project, 'file.txt'), 'baseline'); git('add', '.'); git('commit', '-qm', 'baseline');
  const manager = new GitWorkspace(projects);
  const checkpoint = manager.snapshot('project', 'baseline');
  fs.writeFileSync(path.join(project, 'file.txt'), 'new work'); git('add', '.'); git('commit', '-qm', 'new work');
  return { directory, workspace, projects, project, git, manager, checkpoint, latest: manager.inspect('project').head };
}

test('staged and ignored work and an existing Git lock are rejected without deleting files', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.project, 'file.txt'), 'staged work'); f.git('add', '.');
    assert.throws(() => f.manager.rollback('project', f.checkpoint.tag, f.latest, f.checkpoint.head), /clean worktree/);
    assert.equal(fs.readFileSync(path.join(f.project, 'file.txt'), 'utf8'), 'staged work');
    f.git('reset', '--hard', f.latest);
    fs.writeFileSync(path.join(f.project, '.gitignore'), 'scratch.tmp\n'); f.git('add', '.'); f.git('commit', '-qm', 'ignore scratch');
    const head = f.manager.inspect('project').head;
    fs.writeFileSync(path.join(f.project, 'scratch.tmp'), 'keep this ignored content');
    assert.throws(() => f.manager.rollback('project', f.checkpoint.tag, head, f.checkpoint.head), /clean worktree/);
    assert.equal(fs.readFileSync(path.join(f.project, 'scratch.tmp'), 'utf8'), 'keep this ignored content');
    fs.unlinkSync(path.join(f.project, 'scratch.tmp'));
    fs.writeFileSync(path.join(f.project, '.git', 'index.lock'), '');
    assert.throws(() => f.manager.rollback('project', f.checkpoint.tag, head, f.checkpoint.head), /busy|index\.lock/i);
    assert.equal(f.manager.inspect('project').head, head);
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('a stopped workspace backup restores its database, Git checkpoint and recovery ability independently', () => {
  const f = fixture();
  try {
    const filename = path.join(f.workspace, 'data', 'state.db');
    const store = new StateStore<{ tag: string; head: string; tasks: string[] }>(filename);
    store.load(() => ({ tag: f.checkpoint.tag, head: f.checkpoint.head, tasks: ['Verify backup'] }));
    store.close(); // Copy only after all writers have stopped and SQLite has closed.
    const restored = path.join(f.directory, 'restored'); fs.cpSync(f.workspace, restored, { recursive: true });
    const copy = new StateStore<{ tag: string; head: string; tasks: string[] }>(path.join(restored, 'data', 'state.db'));
    let saved: { tag: string; head: string; tasks: string[] };
    try { saved = copy.load(() => { throw new Error('Backup was not restored'); }); }
    finally { copy.close(); }
    assert.deepEqual(saved.tasks, ['Verify backup']);
    const manager = new GitWorkspace(path.join(restored, 'projects'));
    const result = manager.rollback('project', saved.tag, f.latest, saved.head);
    assert.equal(manager.inspect('project').head, f.checkpoint.head);
    assert.equal(fs.readFileSync(path.join(restored, 'projects', 'project', 'file.txt'), 'utf8'), 'baseline');
    assert.equal(f.manager.inspect('project').head, f.latest); // Original workspace is unaffected.
    assert.equal(execFileSync('git', ['-C', path.join(restored, 'projects', 'project'), 'rev-parse', result.recoveryRef], { encoding: 'utf8' }).trim(), f.latest);
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test('killing rollback after the recovery ref is written preserves the old HEAD and allows a retry', { skip: process.platform === 'win32', timeout: 15_000 }, async () => {
  const f = fixture();
  let child: ReturnType<typeof spawn> | undefined;
  let completion: Promise<unknown> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const module = fileURLToPath(new URL('../src/gitWorkspace.ts', import.meta.url));
    const runner = path.join(f.directory, 'runner.mjs');
    // Interrupt the process immediately before reset, after the real update-ref command.
    fs.writeFileSync(runner, `import {GitWorkspace} from ${JSON.stringify(module)};class Interrupted extends GitWorkspace {run(directory,args){if(args[0]==='reset'){process.kill(process.pid,'SIGKILL');}return super.run(directory,args);}}new Interrupted(${JSON.stringify(f.projects)}).rollback('project',${JSON.stringify(f.checkpoint.tag)},${JSON.stringify(f.latest)},${JSON.stringify(f.checkpoint.head)});`);
    child = spawn(process.execPath, ['--import', 'tsx', runner], { stdio: 'ignore' });
    completion = once(child, 'exit');
    const exit = await Promise.race([completion, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Interruption test timed out')), 8000); })]) as [number | null, NodeJS.Signals | null];
    assert.equal(exit[1], 'SIGKILL');
    assert.equal(f.manager.inspect('project').head, f.latest);
    const references = f.git('for-each-ref', '--format=%(objectname)', 'refs/launchpadre/recovery/').split('\n');
    assert.ok(references.includes(f.latest));
    assert.equal(fs.readFileSync(path.join(f.project, 'file.txt'), 'utf8'), 'new work');
    assert.equal(f.manager.rollback('project', f.checkpoint.tag, f.latest, f.checkpoint.head).target, f.checkpoint.head);
  } finally {
    if (timer) clearTimeout(timer);
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (completion) await completion;
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});
