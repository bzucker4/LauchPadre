import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export class CustomerAuth {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS customer_accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','indie_solo','academic_tier'))
    );
    CREATE TABLE IF NOT EXISTS customer_sessions (
      token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );`);
  }
  register(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Invalid email');
    if (password.length < 12 || password.length > 1024) throw new Error('Password must be 12-1024 characters');
    const salt = randomBytes(16).toString('hex');
    const passwordHash = `${salt}:${scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex')}`;
    const id = randomBytes(16).toString('hex');
    this.db.prepare('INSERT INTO customer_accounts (id,email,password_hash,created_at) VALUES (?,?,?,?)').run(id,email,passwordHash,new Date().toISOString());
    return { id, email, plan: 'free' as const };
  }
  login(emailInput: string, password: string) {
    const email = emailInput.trim().toLowerCase();
    const row = this.db.prepare('SELECT id,password_hash FROM customer_accounts WHERE email=?').get(email) as {id:string,password_hash:string}|undefined;
    const [salt, expected] = (row?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const actual = scryptSync(password, Buffer.from(salt,'hex'),64);
    if (!row || !timingSafeEqual(actual,Buffer.from(expected,'hex'))) return null;
    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now()+8*60*60*1000;
    this.db.prepare('INSERT INTO customer_sessions (token_hash,customer_id,expires_at) VALUES (?,?,?)').run(this.hash(token),row.id,expiresAt);
    return {token, expiresAt};
  }
  session(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    return this.db.prepare(`SELECT a.id,a.email,a.plan FROM customer_sessions s JOIN customer_accounts a ON a.id=s.customer_id WHERE s.token_hash=? AND s.expires_at>?`).get(this.hash(token),Date.now()) as {id:string,email:string,plan:string}|undefined || null;
  }
  logout(token:string) { this.db.prepare('DELETE FROM customer_sessions WHERE token_hash=?').run(this.hash(token)); }
  private hash(token:string) { return createHash('sha256').update(token).digest('hex'); }
}
