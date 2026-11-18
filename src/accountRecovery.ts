import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CustomerAuth } from './customerAuth.ts';

type Action = 'verify' | 'reset';

export class AccountMailer {
  readonly origin: string;
  readonly configured: boolean;
  constructor(private env: NodeJS.ProcessEnv = process.env, private request: typeof fetch = fetch) {
    this.origin = '';
    try {
      const url = new URL(env.LAUNCHPADRE_PUBLIC_ORIGIN || '');
      const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if ((url.protocol === 'https:' || (url.protocol === 'http:' && local)) &&
          !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) this.origin = url.origin;
    } catch {}
    this.configured = Boolean(this.origin && env.RESEND_API_KEY && env.LAUNCHPADRE_EMAIL_FROM);
  }
  async send(action: Action, email: string, token: string) {
    if (!this.configured) throw new Error('Account email is unavailable');
    const link = `${this.origin}/#action=${action}&token=${token}`;
    const subject = action === 'reset' ? 'Reset your LauchPadre password' : 'Verify your LauchPadre email';
    const text = action === 'reset'
      ? `Use this link within 30 minutes to reset your password. Resetting signs out your existing sessions.\n\n${link}\n\nIf you did not request this, you can ignore this email.`
      : `Use this link within 24 hours to verify your email address.\n\n${link}\n\nIf you did not request this, you can ignore this email.`;
    await this.deliver(email, subject, text);
  }
  async passwordChanged(email: string) {
    await this.deliver(email, 'Your LauchPadre password changed', 'Your LauchPadre password was reset and existing sessions were signed out. If you did not make this change, contact your workspace operator immediately.');
  }
  private async deliver(email: string, subject: string, text: string) {
    if (!this.configured) throw new Error('Account email is unavailable');
    const response = await this.request('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.env.LAUNCHPADRE_EMAIL_FROM, to: [email], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('Account email delivery failed');
  }
}

export class AccountRecovery {
  constructor(private db: DatabaseSync, private auth: CustomerAuth) {
    db.exec(`CREATE TABLE IF NOT EXISTS customer_action_tokens (
      token_hash TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')), expires_at INTEGER NOT NULL,
      UNIQUE(customer_id,purpose)
    );
    CREATE TABLE IF NOT EXISTS customer_email_requests (
      email_hash TEXT NOT NULL, purpose TEXT NOT NULL, next_allowed_at INTEGER NOT NULL,
      PRIMARY KEY(email_hash,purpose)
    );
    CREATE INDEX IF NOT EXISTS idx_customer_email_requests_expiry ON customer_email_requests(next_allowed_at)`);
  }
  allowEmail(email: string, purpose: Action) {
    const now = Date.now();
    this.db.prepare('DELETE FROM customer_email_requests WHERE next_allowed_at<=?').run(now);
    return Boolean(this.db.prepare(`INSERT INTO customer_email_requests VALUES (?,?,?)
      ON CONFLICT(email_hash,purpose) DO NOTHING RETURNING email_hash`)
      .get(this.hash(email.trim().toLowerCase()), purpose, now + 60_000));
  }
  issue(emailInput: string, purpose: Action) {
    const account = this.db.prepare('SELECT id,email,email_verified_at FROM customer_accounts WHERE email=?')
      .get(emailInput.trim().toLowerCase()) as { id: string; email: string; email_verified_at: string | null } | undefined;
    if (!account || (purpose === 'verify' && account.email_verified_at)) return null;
    const token = randomBytes(32).toString('hex');
    const expires = Date.now() + (purpose === 'reset' ? 30 * 60_000 : 24 * 60 * 60_000);
    this.db.prepare('DELETE FROM customer_action_tokens WHERE expires_at<=?').run(Date.now());
    this.db.prepare(`INSERT INTO customer_action_tokens VALUES (?,?,?,?)
      ON CONFLICT(customer_id,purpose) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at`)
      .run(this.hash(token), account.id, purpose, expires);
    return { email: account.email, token };
  }
  consume(token: unknown, purpose: Action, password?: unknown) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('This link is invalid or expired');
    if (purpose === 'reset' && (typeof password !== 'string' || password.length < 12 || password.length > 1024)) {
      throw new Error('Use a password between 12 and 1024 characters');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`DELETE FROM customer_action_tokens WHERE token_hash=? AND purpose=? AND expires_at>?
        RETURNING customer_id`).get(this.hash(token), purpose, Date.now()) as { customer_id: string } | undefined;
      if (!row) throw new Error('This link is invalid or expired');
      if (purpose === 'verify') {
        this.db.prepare('UPDATE customer_accounts SET email_verified_at=? WHERE id=?').run(new Date().toISOString(), row.customer_id);
      } else {
        this.auth.setPassword(row.customer_id, password as string);
        this.db.prepare('DELETE FROM customer_action_tokens WHERE customer_id=?').run(row.customer_id);
      }
      const account = this.db.prepare('SELECT email FROM customer_accounts WHERE id=?').get(row.customer_id);
      this.db.exec('COMMIT');
      return String(account!.email);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private hash(token: string) { return createHash('sha256').update(token).digest('hex'); }
}
