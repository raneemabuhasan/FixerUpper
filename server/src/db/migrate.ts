import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { STATUSES } from '../workflow/status.ts';
import { transaction, type DB } from './connection.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

const statusList = STATUSES.map(s => `'${s.replaceAll("'", "''")}'`).join(', ');

function render(sql: string): string {
  return sql.replaceAll('/*TICKET_STATUSES*/', statusList);
}

// Applies every not-yet-applied .sql file in filename order. Returns the names applied.
export function migrate(db: DB): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    (db.prepare('SELECT name FROM migrations').all() as { name: string }[]).map(r => r.name),
  );
  const pending = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql') && !applied.has(f)).sort();
  for (const name of pending) {
    transaction(db, () => {
      db.exec(render(readFileSync(join(MIGRATIONS_DIR, name), 'utf8')));
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
    });
  }
  assertStatusConstraintCurrent(db);
  return pending;
}

// The CHECK constraint is baked in when the table is created. If status.ts has
// changed since, fail loudly instead of letting inserts of the new status fail later.
function assertStatusConstraintCurrent(db: DB) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tickets'").get() as { sql: string } | undefined;
  if (row && !row.sql.includes(`CHECK (status IN (${statusList}))`))
    throw new Error('Ticket statuses in server/src/workflow/status.ts changed since this database was created. Run `npm run db:reset`.');
}
