import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { PlanId } from './plans.ts';

export type CustomerAccount = { id: string; email: string; plan: PlanId };

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
    CREATE INDEX IF NOT EXISTS idx_customer_sessions_expires ON customer_sessions(expires_at);`);
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

  login(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const row = this.db
      .prepare('SELECT id,password_hash FROM customer_accounts WHERE email=?')
      .get(email) as { id: string; password_hash: string } | undefined;
    if (!this.verifyPassword(password, row?.password_hash) || !row) return null;
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

  logout(token: string) {
    this.db.prepare('DELETE FROM customer_sessions WHERE token_hash=?').run(this.hash(token));
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
