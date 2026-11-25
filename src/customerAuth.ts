import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { PlanId } from './plans.ts';

export type CustomerAccount = { id: string; email: string; plan: PlanId };
export type TokenPurpose = 'verify_email' | 'reset_password';
export type LoginResult = { token: string; expiresAt: number } | { unverified: true } | null;

const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  verify_email: 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
};
// A new emailed token is not issued for the same account/purpose more often than this.
const TOKEN_COOLDOWN_MS = 60 * 1000;

export class CustomerAuth {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS customer_accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','indie_solo','academic_tier'))
    );
    CREATE TABLE IF NOT EXISTS customer_sessions (
      token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_customer_sessions_expires ON customer_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS customer_tokens (
      token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL CHECK(purpose IN ('verify_email','reset_password')),
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_customer_tokens_customer ON customer_tokens(customer_id, purpose);`);
    // Accounts created before email verification existed are grandfathered as verified.
    const columns = db.prepare('PRAGMA table_info(customer_accounts)').all() as { name: string }[];
    if (!columns.some((c) => c.name === 'email_verified_at')) {
      db.exec('ALTER TABLE customer_accounts ADD COLUMN email_verified_at TEXT');
      db.exec('UPDATE customer_accounts SET email_verified_at=created_at');
    }
  }

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    return `${salt}:${scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex')}`;
  }

  private verifyPassword(password: string, storedHash?: string) {
    const [salt, expected] = (storedHash || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const actual = scryptSync(password, Buffer.from(salt, 'hex'), 64);
    return Boolean(storedHash) && timingSafeEqual(actual, Buffer.from(expected, 'hex'));
  }

  register(emailInput: string, password: string): CustomerAccount {
    const email = emailInput.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new Error('Enter a valid email address');
    }
    if (password.length < 12 || password.length > 1024) {
      throw new Error('Password must be between 12 and 1024 characters');
    }
    const passwordHash = this.hashPassword(password);
    const id = randomBytes(16).toString('hex');
    this.db
      .prepare('INSERT INTO customer_accounts (id,email,password_hash,created_at) VALUES (?,?,?,?)')
      .run(id, email, passwordHash, new Date().toISOString());
    return { id, email, plan: 'free' };
  }

  login(emailInput: string, password: string): LoginResult {
    const email = emailInput.trim().toLowerCase();
    const row = this.db
      .prepare('SELECT id,password_hash,email_verified_at FROM customer_accounts WHERE email=?')
      .get(email) as { id: string; password_hash: string; email_verified_at: string | null } | undefined;
    if (!this.verifyPassword(password, row?.password_hash) || !row) return null;
    if (!row.email_verified_at) return { unverified: true };
    const now = Date.now();
    this.db.prepare('DELETE FROM customer_sessions WHERE expires_at <= ?').run(now);
    const token = randomBytes(32).toString('hex');
    const expiresAt = now + 8 * 60 * 60 * 1000;
    this.db
      .prepare('INSERT INTO customer_sessions (token_hash,customer_id,expires_at) VALUES (?,?,?)')
      .run(this.hash(token), row.id, expiresAt);
    return { token, expiresAt };
  }

  session(token: string): CustomerAccount | null {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    return (
      (this.db
        .prepare(
          `SELECT a.id,a.email,a.plan FROM customer_sessions s JOIN customer_accounts a ON a.id=s.customer_id WHERE s.token_hash=? AND s.expires_at>?`
        )
        .get(this.hash(token), Date.now()) as CustomerAccount | undefined) || null
    );
  }

  changePassword(customerId: string, currentPassword: string, newPassword: string, keepToken?: string) {
    if (newPassword.length < 12 || newPassword.length > 1024) {
      throw new Error('New password must be between 12 and 1024 characters');
    }
    const row = this.db
      .prepare('SELECT password_hash FROM customer_accounts WHERE id=?')
      .get(customerId) as { password_hash: string } | undefined;
    if (!row || !this.verifyPassword(currentPassword, row.password_hash)) {
      return false;
    }
    const nextHash = this.hashPassword(newPassword);
    this.db.prepare('UPDATE customer_accounts SET password_hash=? WHERE id=?').run(nextHash, customerId);
    if (keepToken && /^[a-f0-9]{64}$/.test(keepToken)) {
      this.db
        .prepare('DELETE FROM customer_sessions WHERE customer_id=? AND token_hash<>?')
        .run(customerId, this.hash(keepToken));
    } else {
      this.db.prepare('DELETE FROM customer_sessions WHERE customer_id=?').run(customerId);
    }
    return true;
  }

  /**
   * Issues a single-use emailed token. Returns null when a token for this account and purpose
   * was issued within the cooldown, so callers can silently skip sending another email.
   * Issuing a token invalidates any earlier unused token of the same purpose.
   */
  issueToken(customerId: string, purpose: TokenPurpose): string | null {
    const now = Date.now();
    const recent = this.db
      .prepare('SELECT 1 FROM customer_tokens WHERE customer_id=? AND purpose=? AND created_at>?')
      .get(customerId, purpose, now - TOKEN_COOLDOWN_MS);
    if (recent) return null;
    this.db.prepare('DELETE FROM customer_tokens WHERE customer_id=? AND purpose=?').run(customerId, purpose);
    this.db.prepare('DELETE FROM customer_tokens WHERE expires_at<=? OR used_at IS NOT NULL').run(now);
    const token = randomBytes(32).toString('hex');
    this.db
      .prepare('INSERT INTO customer_tokens (token_hash,customer_id,purpose,created_at,expires_at) VALUES (?,?,?,?,?)')
      .run(this.hash(token), customerId, purpose, now, now + TOKEN_TTL_MS[purpose]);
    return token;
  }

  /** Atomically consumes a valid token and returns its customer id, or null. */
  private consumeToken(token: string, purpose: TokenPurpose): string | null {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const hash = this.hash(token);
    const now = Date.now();
    const result = this.db
      .prepare(
        'UPDATE customer_tokens SET used_at=? WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>?'
      )
      .run(now, hash, purpose, now);
    if (Number(result.changes) !== 1) return null;
    const row = this.db.prepare('SELECT customer_id FROM customer_tokens WHERE token_hash=?').get(hash) as
      | { customer_id: string }
      | undefined;
    return row?.customer_id ?? null;
  }

  /** Looks up an account by email for a token-issuing flow. */
  findForToken(emailInput: string): { id: string; email: string; verified: boolean } | null {
    const row = this.db
      .prepare('SELECT id,email,email_verified_at FROM customer_accounts WHERE email=?')
      .get(emailInput.trim().toLowerCase()) as
      | { id: string; email: string; email_verified_at: string | null }
      | undefined;
    return row ? { id: row.id, email: row.email, verified: Boolean(row.email_verified_at) } : null;
  }

  verifyEmail(token: string): boolean {
    const customerId = this.consumeToken(token, 'verify_email');
    if (!customerId) return false;
    this.db
      .prepare('UPDATE customer_accounts SET email_verified_at=COALESCE(email_verified_at,?) WHERE id=?')
      .run(new Date().toISOString(), customerId);
    return true;
  }

  /**
   * Sets a new password from a reset token and signs out every session. Completing a reset also
   * proves control of the mailbox, so it verifies the email. Throws on an invalid password
   * before consuming the token so the user can retry with the same link.
   */
  resetPassword(token: string, newPassword: string): boolean {
    if (newPassword.length < 12 || newPassword.length > 1024) {
      throw new Error('New password must be between 12 and 1024 characters');
    }
    const customerId = this.consumeToken(token, 'reset_password');
    if (!customerId) return false;
    this.db
      .prepare('UPDATE customer_accounts SET password_hash=?, email_verified_at=COALESCE(email_verified_at,?) WHERE id=?')
      .run(this.hashPassword(newPassword), new Date().toISOString(), customerId);
    this.db.prepare('DELETE FROM customer_sessions WHERE customer_id=?').run(customerId);
    return true;
  }

  logout(token: string) {
    this.db.prepare('DELETE FROM customer_sessions WHERE token_hash=?').run(this.hash(token));
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
