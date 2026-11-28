import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = DatabaseSync;

export const DEFAULT_DB_PATH = process.env.RESOLVE_DB_PATH
  ?? fileURLToPath(new URL('../../data/resolve.db', import.meta.url));

export function openDatabase(path: string = DEFAULT_DB_PATH): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  return db;
}

let savepointId = 0;

// Runs fn atomically. Uses savepoints so calls can nest.
export function transaction<T>(db: DB, fn: () => T): T {
  const name = `sp_${++savepointId}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  }
}
