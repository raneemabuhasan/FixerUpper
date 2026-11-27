import { describe, expect, test } from 'vitest';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../src/db/connection.ts';
import { migrate } from '../src/db/migrate.ts';
import { resetDatabase } from '../src/db/reset.ts';
import { SEED_CLOCK } from '../src/db/seed.ts';
import { getTicketForResident, listTicketsForResident } from '../src/db/tickets.ts';
import { getNow } from '../src/db/clock.ts';
import { applyAction } from '../src/workflow/transitions.ts';
import { createApp } from '../src/app.ts';
import { dumpAll, eventTypes, freshDb, mina, tech } from './helpers.ts';

describe('migrations', () => {
  test('are tracked and only applied once', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db)).toEqual(['001_init.sql']);
    expect(migrate(db)).toEqual([]);
  });

  test('status CHECK rejects unknown statuses', () => {
    const db = freshDb();
    expect(() => db.prepare("UPDATE tickets SET status = 'in progress' WHERE id = 'RES-101'").run()).toThrow(/CHECK/);
    expect(() => db.prepare("UPDATE tickets SET status = 'cancelled' WHERE id = 'RES-101'").run()).not.toThrow();
  });

  test('follow_ups cannot double-fire for the same due key', () => {
    const db = freshDb();
    const insert = db.prepare("INSERT INTO follow_ups (ticket_id, due_key, due_at, action) VALUES ('RES-101', 'confirm-48h', ?, 'reminder')");
    insert.run(SEED_CLOCK);
    expect(() => insert.run(SEED_CLOCK)).toThrow(/UNIQUE/);
  });
});

describe('seed', () => {
  test('matches the web mock', () => {
    const db = freshDb();
    expect(getNow(db)).toBe(SEED_CLOCK);
    expect(listTicketsForResident(db, 'mina').map(t => [t.id, t.title, t.status])).toEqual([
      ['RES-103', 'Sticking cabinet door', 'submitted'],
      ['RES-102', 'Dishwasher not draining', 'assigned'],
      ['RES-101', 'Kitchen faucet dripping', 'awaiting resident confirmation'],
    ]);
    expect(eventTypes(db, 'RES-101')).toEqual(['created', 'repair_attempted']);
    expect(eventTypes(db, 'RES-102')).toEqual(['created']);
    expect(listTicketsForResident(db, 'alex')).toEqual([]);
  });

  test('is deterministic, and reset restores identical data', () => {
    const a = freshDb();
    const b = freshDb();
    const seeded = dumpAll(a);
    expect(dumpAll(b)).toEqual(seeded);

    applyAction(a, 'RES-101', { type: 'resident_confirm', resolved: false }, mina);
    applyAction(a, 'RES-101', { type: 'repair_attempted' }, tech);
    expect(dumpAll(a)).not.toEqual(seeded);

    resetDatabase(a);
    expect(dumpAll(a)).toEqual(seeded);
  });
});

describe('resident-scoped queries', () => {
  test('never return another resident\'s tickets', () => {
    const db = freshDb();
    expect(getTicketForResident(db, 'RES-101', 'mina')?.id).toBe('RES-101');
    expect(getTicketForResident(db, 'RES-101', 'alex')).toBeNull();
  });
});

test('GET /api/health', async () => {
  const server = createApp(freshDb()).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, clock: SEED_CLOCK });
  } finally {
    server.close();
  }
});
