import { pathToFileURL } from 'node:url';
import { DEFAULT_DB_PATH, openDatabase, type DB } from './connection.ts';
import { migrate } from './migrate.ts';
import { seed } from './seed.ts';

// Drops every table, then migrates and seeds from scratch.
export function resetDatabase(db: DB): void {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const { name } of tables) db.exec(`DROP TABLE "${name}"`);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  migrate(db);
  seed(db);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDatabase();
  resetDatabase(db);
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  console.log(`Reset ${DEFAULT_DB_PATH}`);
  console.log(`residents=${count('residents')} staff=${count('staff')} tickets=${count('tickets')} events=${count('events')}`);
  db.close();
}
