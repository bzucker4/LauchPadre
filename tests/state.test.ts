import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StateStore } from '../src/stateStore.ts';

test('state survives closing and reopening without reseeding', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'launchpadre-state-'));
  const filename = path.join(directory, 'workspace.db');
  try {
    const first = new StateStore<{ snapshots: string[] }>(filename);
    const initial = first.load(() => ({ snapshots: [] }));
    initial.snapshots.push('checkpoint');
    first.save(initial);
    first.close();
    const reopened = new StateStore<{ snapshots: string[] }>(filename);
    try {
      assert.deepEqual(reopened.load(() => { throw new Error('Must not reseed'); }), { snapshots: ['checkpoint'] });
    } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
