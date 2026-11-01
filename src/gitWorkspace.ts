import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class GitWorkspace {
  private root: string;
  constructor(root: string) { this.root = fs.realpathSync(root); }

  resolve(relative: string): string {
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..' || part === '.git')) {
      throw new Error('Use a repository path relative to the configured Git root');
    }
    const directory = fs.realpathSync(path.join(this.root, relative));
    if (directory !== path.resolve(this.root, relative)) throw new Error('Symlink aliases are not supported');
    const contained = path.relative(this.root, directory);
    if (!contained || contained.startsWith('..') || path.isAbsolute(contained)) throw new Error('Repository must stay inside the configured Git root');
    const gitPath = path.join(directory, '.git');
    if (!fs.lstatSync(gitPath).isDirectory() || fs.realpathSync(gitPath) !== gitPath) {
      throw new Error('Only regular working repositories with a local .git directory are supported');
    }
    if (fs.realpathSync(this.run(directory, ['rev-parse', '--show-toplevel'])) !== directory) throw new Error('Repository root mismatch');
    return directory;
  }

  protected run(directory: string, args: string[]) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
    return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', directory, ...args], {
      encoding: 'utf8', timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
      env: { ...env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  inspect(relative: string) {
    const directory = this.resolve(relative);
    let head = '';
    try { head = this.run(directory, ['rev-parse', '--verify', 'HEAD']); } catch {}
    let branch = 'HEAD';
    try { branch = this.run(directory, ['symbolic-ref', '--short', 'HEAD']); } catch {}
    return { head, branch, unborn: !head };
  }

  snapshot(relative: string, name: string) {
    const directory = this.resolve(relative);
    if (!/^[a-z0-9_-]{1,64}$/.test(name)) throw new Error('Invalid snapshot name');
    const { head } = this.inspect(relative);
    if (!head) throw new Error('Commit your initial work before creating a live snapshot');
    const tag = `panic_room_launchpadre_${name}`;
    // No force: an existing checkpoint can never be silently overwritten.
    this.run(directory, ['tag', tag, head]);
    return { tag, head };
  }

  archive(relative: string, commit: string): Buffer {
    const directory = this.resolve(relative);
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Invalid archive commit');
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
    return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', directory, 'archive', '--format=zip', commit], {
      timeout: 30_000, maxBuffer: 50 * 1024 * 1024, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  rollback(relative: string, tag: string, expectedHead: string, expectedTarget: string) {
    const directory = this.resolve(relative);
    if (!/^panic_room_launchpadre_[a-z0-9_-]{1,64}$/.test(tag)) throw new Error('Invalid snapshot tag');
    const head = this.run(directory, ['rev-parse', '--verify', 'HEAD']);
    if (head !== expectedHead) throw new Error('HEAD changed. Refresh before retrying rollback');
    const target = this.run(directory, ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
    if (target !== expectedTarget) throw new Error('Snapshot tag changed outside LaunchPadre. Refusing rollback');
    // Include ignored files: reset --hard can overwrite obstructing untracked files.
    if (this.run(directory, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored'])) {
      throw new Error('Live rollback requires a completely clean worktree, including ignored files. Commit or move your changes first');
    }
    if (fs.existsSync(path.join(directory, '.git', 'index.lock'))) throw new Error('Git is busy');
    const recoveryRef = `refs/launchpadre/recovery/${crypto.randomUUID()}`;
    this.run(directory, ['update-ref', recoveryRef, head]);
    this.run(directory, ['reset', '--hard', target]);
    return { previousHead: head, target, recoveryRef };
  }
}
