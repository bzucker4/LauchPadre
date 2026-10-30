import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// One process owns the document. SQLite makes each replacement crash-atomic.
export class StateStore<T> {
  private connection: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
    this.connection = new DatabaseSync(filename);
    if (filename !== ':memory:') fs.chmodSync(filename, 0o600);
    this.connection.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, body TEXT NOT NULL)');
  }
  load(initial: () => T): T {
    const row = this.connection.prepare('SELECT version, body FROM workspace WHERE id=1').get();
    if (!row) { const value = initial(); this.save(value); return value; }
    if (row.version !== 1) throw new Error('Unsupported workspace state version');
    return JSON.parse(String(row.body)) as T;
  }
  save(value: T) {
    this.connection.prepare('INSERT INTO workspace(id, version, body) VALUES(1,1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(value));
  }
  close() { this.connection.close(); }
}
