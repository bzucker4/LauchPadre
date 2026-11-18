export type BillingInterval = 'month' | 'year';
export type PlanId = 'free' | 'indie_solo' | 'academic_tier';

export const PLANS = {
  free: { name: 'Free Developer', monthly: 0, annual: 0, repositories: 3, snapshotsPerRepository: 1, zenodo: false },
  indie_solo: { name: 'Indie Solo', monthly: 500, annual: 3900, repositories: null, snapshotsPerRepository: null, zenodo: false },
  academic_tier: { name: 'Academic Researcher', monthly: 900, annual: 6900, repositories: null, snapshotsPerRepository: null, zenodo: true },
} as const;

export function effectivePlan(user: { plan?: string; is_premium?: boolean } | undefined): PlanId {
  return user?.is_premium && (user.plan === 'indie_solo' || user.plan === 'academic_tier') ? user.plan : 'free';
}

export function repositoryLimitReached(plan: PlanId, count: number) {
  const limit = PLANS[plan].repositories;
  return limit !== null && count >= limit;
}

export function snapshotLimitReached(plan: PlanId, count: number) {
  const limit = PLANS[plan].snapshotsPerRepository;
  return limit !== null && count >= limit;
}
