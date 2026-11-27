import { openDatabase, type DB } from '../src/db/connection.ts';
import { migrate } from '../src/db/migrate.ts';
import { seed, SEED_CLOCK } from '../src/db/seed.ts';
import { appendEvent, listEvents } from '../src/workflow/events.ts';
import type { Status } from '../src/workflow/status.ts';
import type { Actor } from '../src/workflow/transitions.ts';

export const mina: Actor = { type: 'resident', id: 'mina' };
export const alex: Actor = { type: 'resident', id: 'alex' };
export const tech: Actor = { type: 'staff', id: 'tech-sam' };
export const manager: Actor = { type: 'staff', id: 'mgr-jordan' };
export const ai: Actor = { type: 'ai', id: 'intake-assistant' };
export const system: Actor = { type: 'system', id: 'scheduler' };

export function freshDb(): DB {
  const db = openDatabase(':memory:');
  migrate(db);
  seed(db);
  return db;
}

let n = 0;

// Inserts a ticket for mina directly in the given status, bypassing the state machine.
export function insertTicket(db: DB, status: Status, opts: { withRepairAttempt?: boolean } = {}): string {
  const id = `T-${++n}`;
  db.prepare(
    `INSERT INTO tickets (id, resident_id, title, category, location, description, status, assignee_id, created_at, updated_at, next_action)
     VALUES (?, 'mina', 'Test', 'Plumbing', 'Kitchen', 'Test', ?, ?, ?, ?, 'n/a')`,
  ).run(id, status, status === 'submitted' ? null : 'tech-sam', SEED_CLOCK, SEED_CLOCK);
  appendEvent(db, { ticketId: id, at: SEED_CLOCK, kind: 'resident', actorType: 'resident', actorId: 'mina', type: 'created', text: 'Submitted.' });
  if (opts.withRepairAttempt)
    appendEvent(db, { ticketId: id, at: SEED_CLOCK, kind: 'worker', actorType: 'staff', actorId: 'tech-sam', type: 'repair_attempted', text: 'Fixed.' });
  return id;
}

export const eventTypes = (db: DB, id: string) => listEvents(db, id).map(e => e.type);

export function dumpAll(db: DB): Record<string, unknown[]> {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'migrations' ORDER BY name").all() as { name: string }[];
  return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY 1`).all()]));
}
