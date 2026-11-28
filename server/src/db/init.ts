import { openDatabase, type DB } from './connection.ts';
import { migrate } from './migrate.ts';
import { seed } from './seed.ts';

// Server startup: open, apply pending migrations, and seed only a brand-new database.
// Existing data is never touched, so it survives restarts.
export function initDatabase(path?: string): DB {
  const db = openDatabase(path);
  migrate(db);
  if (!db.prepare('SELECT 1 FROM clock').get()) seed(db);
  return db;
}
