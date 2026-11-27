import type { DB } from './connection.ts';

// Simulated "now" for the demo. All workflow timestamps come from here.
export function getNow(db: DB): string {
  const row = db.prepare('SELECT now FROM clock WHERE id = 1').get() as { now: string } | undefined;
  if (!row) throw new Error('Clock is not initialised. Run `npm run db:reset`.');
  return row.now;
}

export function setNow(db: DB, iso: string): void {
  db.prepare('INSERT INTO clock (id, now) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET now = excluded.now').run(iso);
}
