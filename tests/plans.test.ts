import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, effectivePlan, repositoryLimitReached, snapshotLimitReached } from '../src/plans.ts';

test('free quotas apply until a supported paid plan is active', () => {
  assert.equal(effectivePlan({ plan: 'academic_tier', is_premium: false }), 'free');
  assert.equal(effectivePlan({ plan: 'unknown', is_premium: true }), 'free');
  assert.equal(repositoryLimitReached('free', 2), false);
  assert.equal(repositoryLimitReached('free', 3), true);
  assert.equal(snapshotLimitReached('free', 0), false);
  assert.equal(snapshotLimitReached('free', 1), true);
  assert.equal(repositoryLimitReached('indie_solo', 100), false);
  assert.equal(snapshotLimitReached('academic_tier', 100), false);
  assert.equal(PLANS.indie_solo.zenodo, false);
  assert.equal(PLANS.academic_tier.zenodo, true);
});
