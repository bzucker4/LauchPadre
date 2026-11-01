import crypto from 'node:crypto';
import type { Express, Request } from 'express';

const digest = (value: string) => crypto.createHash('sha256').update(value).digest();
export function secretsEqual(left: string, right: string): boolean {
  return crypto.timingSafeEqual(digest(left), digest(right));
}

// A single-owner workspace. Sessions are deliberately invalidated on restart.
export function installAuthentication(app: Express) {
  const password = process.env.ADMIN_PASSWORD;
  const production = process.env.NODE_ENV === 'production';
  if ((production || process.env.LAUNCHPADRE_DEMO === 'false') && (!password || password.length < 16)) {
    throw new Error('Production requires ADMIN_PASSWORD with at least 16 characters');
  }
  const enabled = Boolean(password);
  const secureCookies = production && process.env.LOCAL_ONLY !== 'true';
  const sessions = new Map<string, number>();
  const attempts = new Map<string, { count: number; until: number }>();
  const cookieName = secureCookies ? '__Host-launchpadre_session' : 'launchpadre_session';
  const tokenOf = (req: Request) => (req.headers.cookie || '').split(';').map(v => v.trim())
    .find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
  const valid = (req: Request) => (sessions.get(tokenOf(req)) || 0) > Date.now();
  const options = { httpOnly: true, secure: secureCookies, sameSite: 'strict' as const, path: '/' };

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (enabled && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const expected = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
      if (origin && origin !== expected) {
        res.status(403).json({ error: 'Cross-origin request rejected' });
        return;
      }
      if (req.get('sec-fetch-site') === 'cross-site') {
        res.status(403).json({ error: 'Cross-site request rejected' });
        return;
      }
    }
    next();
  });
  app.get('/api/auth/session', (req, res) => {
    res.json({ authenticated: !enabled || valid(req), required: enabled });
  });
  app.post('/api/auth/login', (req, res) => {
    if (!enabled) { res.json({ authenticated: true }); return; }
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    for (const [key, expiry] of sessions) if (expiry <= now) sessions.delete(key);
    const ip = req.ip || 'unknown';
    const attempt = attempts.get(ip) || { count: 0, until: now + 900_000 };
    if (attempt.count >= 10 || attempts.size > 10_000) {
      res.setHeader('Retry-After', '900');
      res.status(429).json({ error: 'Too many login attempts. Try again later.' });
      return;
    }
    attempt.count++;
    attempts.set(ip, attempt);
    if (typeof req.body?.password !== 'string' || !secretsEqual(req.body.password, password!)) {
      res.status(401).json({ error: 'Invalid workspace password' });
      return;
    }
    attempts.delete(ip);
    sessions.delete(tokenOf(req));
    if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value!);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, now + 8 * 3600_000);
    res.cookie(cookieName, token, { ...options, maxAge: 8 * 3600_000 });
    res.json({ authenticated: true });
  });
  app.post('/api/auth/logout', (req, res) => {
    sessions.delete(tokenOf(req));
    res.clearCookie(cookieName, options);
    res.json({ authenticated: false });
  });
  app.use('/api', (req, res, next) => {
    const signedWebhook = req.method === 'POST' && ['/api/v1/billing/webhooks/stripe', '/api/v1/webhooks/git-core'].includes(req.originalUrl.split('?')[0]);
    if (enabled && !signedWebhook && !valid(req)) { res.status(401).json({ error: 'Sign in required' }); return; }
    next();
  });
}
