import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : [full];
  });
}

test('browser-facing code loads no third-party fonts or assets (privacy policy relies on this)', () => {
  const files = [path.join(root, 'index.html'), path.join(root, 'launchpadre-theme.css'), ...sourceFiles(path.join(root, 'src'))];
  const offenders = files.filter((file) =>
    /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare/.test(fs.readFileSync(file, 'utf8'))
  );
  assert.deepEqual(offenders, []);
});

test('every font family the UI names is bundled locally', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
  for (const [family, pkg] of [
    ['Public Sans', 'public-sans'],
    ['Plus Jakarta Sans', 'plus-jakarta-sans'],
    ['JetBrains Mono', 'jetbrains-mono'],
  ]) {
    assert.ok(css.includes(`'${family}'`), `${family} is referenced by the UI`);
    assert.ok(main.includes(`@fontsource/${pkg}/latin-`), `${family} is imported from @fontsource/${pkg}`);
  }
});
