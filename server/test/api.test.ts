import { beforeEach, describe, expect, test, vi } from 'vitest';
import request from 'supertest';
import type { Ticket as SharedTicket, Status as SharedStatus } from '../../shared/types.ts';
import { createApp } from '../src/app.ts';
import type { DB } from '../src/db/connection.ts';
import { SEED_CLOCK } from '../src/db/seed.ts';
import type { Status } from '../src/workflow/status.ts';
import type { TicketView } from '../src/workflow/tickets.service.ts';
import { freshDb } from './helpers.ts';

// Compile-time contract with shared/types.ts (checked by `npm run typecheck:server`).
// Everything except status must be assignable; the server's only extra status is 'cancelled'
// (already added on Raneem's branch).
type Assert<T extends true> = T;
export type ViewMatchesShared = Assert<Omit<TicketView, 'status'> extends Omit<SharedTicket, 'status'> ? true : false>;
export type OnlyExtraStatusIsCancelled = Assert<Exclude<Status, SharedStatus> extends 'cancelled' ? true : false>;
export type NoSharedStatusMissing = Assert<Exclude<SharedStatus, Status> extends never ? true : false>;

let db: DB;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = freshDb();
  app = createApp(db);
});

const get = (path: string) => request(app).get(path);
const post = (path: string, body?: object) => body === undefined ? request(app).post(path) : request(app).post(path).send(body);

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({ error: { code, message: expect.any(String) } });
}

function expectSharedTicketShape(t: unknown) {
  const ticket = t as Record<string, unknown>;
  for (const key of ['id', 'residentId', 'title', 'category', 'location', 'description', 'status', 'updatedAt', 'nextAction'])
    expect(typeof ticket[key], key).toBe('string');
  expect(Array.isArray(ticket.events)).toBe(true);
  for (const e of ticket.events as Record<string, unknown>[]) {
    expect(typeof e.at).toBe('string');
    expect(typeof e.text).toBe('string');
    expect(['resident', 'worker', 'system']).toContain(e.kind);
  }
}

const tech = { staffId: 'tech-sam' };

describe('shape', () => {
  test('tickets match shared Ticket plus documented extras', async () => {
    const res = await get('/api/residents/mina/tickets/RES-101');
    expect(res.status).toBe(200);
    expectSharedTicketShape(res.body);
    expect(Object.keys(res.body).sort()).toEqual([
      'assigneeId', 'category', 'createdAt', 'description', 'escalated', 'events', 'id', 'location',
      'nextAction', 'nextFollowUpAt', 'residentId', 'status', 'title', 'updatedAt',
    ]);
    expect(Object.keys(res.body.events[0]).sort()).toEqual(['actorId', 'actorType', 'at', 'id', 'kind', 'text', 'type']);
  });
});

describe('resident routes', () => {
  test('GET /api/residents', async () => {
    const res = await get('/api/residents');
    expect(res.body).toEqual([{ id: 'alex', name: 'Alex', unit: '108' }, { id: 'mina', name: 'Mina', unit: '204' }]);
  });

  test('GET tickets lists newest updated first, scoped to the resident', async () => {
    await post('/api/clock/advance', { hours: 1 });
    await post('/api/residents/mina/tickets/RES-102/link', { reportText: 'Still not draining' });
    const res = await get('/api/residents/mina/tickets');
    expect(res.status).toBe(200);
    res.body.forEach(expectSharedTicketShape);
    expect(res.body.map((t: SharedTicket) => t.id)).toEqual(['RES-102', 'RES-103', 'RES-101']);
    expect((await get('/api/residents/alex/tickets')).body).toEqual([]);
  });

  test('unknown resident is 404', async () => {
    expectError(await get('/api/residents/bob/tickets'), 404, 'NOT_FOUND');
  });

  test('POST tickets creates RES-104, then RES-105', async () => {
    const res = await post('/api/residents/alex/tickets', { description: 'Bathroom fan is loud', location: 'Bathroom' });
    expect(res.status).toBe(201);
    expectSharedTicketShape(res.body);
    expect(res.body).toMatchObject({
      id: 'RES-104', residentId: 'alex', title: 'Bathroom fan is loud', category: 'Maintenance',
      status: 'submitted', createdAt: SEED_CLOCK, assigneeId: null, escalated: false,
    });
    expect(res.body.events.map((e: { type: string }) => e.type)).toEqual(['created']);
    const second = await post('/api/residents/alex/tickets', { description: 'x', location: 'y', title: 'Fan', category: 'Electrical' });
    expect(second.body).toMatchObject({ id: 'RES-105', title: 'Fan', category: 'Electrical' });
  });

  test('confirm resolved:true resolves', async () => {
    const res = await post('/api/residents/mina/tickets/RES-101/confirm', { resolved: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'RES-101', status: 'resolved', nextAction: 'No action needed' });
  });

  test('confirm resolved:false reopens with the same ID and full history', async () => {
    const before = (await get('/api/residents/mina/tickets/RES-101')).body;
    const res = await post('/api/residents/mina/tickets/RES-101/confirm', { resolved: false });
    expect(res.body).toMatchObject({ id: 'RES-101', status: 'awaiting update', nextAction: 'Maintenance will review your feedback' });
    expect(res.body.events.slice(0, before.events.length)).toEqual(before.events);
    expect(res.body.events.slice(before.events.length).map((e: { type: string }) => e.type)).toEqual(['resident_rejected', 'reopened']);
    expect((await get('/api/residents/mina/tickets')).body).toHaveLength(3);
  });

  test('link adds a duplicate_linked event without creating a ticket', async () => {
    const res = await post('/api/residents/mina/tickets/RES-101/link', { reportText: 'Faucet is dripping again' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('awaiting resident confirmation');
    expect(res.body.events.at(-1)).toMatchObject({ type: 'duplicate_linked', kind: 'resident', actorId: 'mina' });
    expect((await get('/api/residents/mina/tickets')).body).toHaveLength(3);
    expect(db.prepare('SELECT ticket_id, linked_report_text, confirmed_by_resident_id FROM duplicate_links').all()).toEqual([
      { ticket_id: 'RES-101', linked_report_text: 'Faucet is dripping again', confirmed_by_resident_id: 'mina' },
    ]);
  });

  test('link to a resolved or cancelled ticket is 409', async () => {
    await post('/api/residents/mina/tickets/RES-101/confirm', { resolved: true });
    await post('/api/residents/mina/tickets/RES-103/cancel');
    for (const id of ['RES-101', 'RES-103'])
      expectError(await post(`/api/residents/mina/tickets/${id}/link`, { reportText: 'again' }), 409, 'INVALID_TRANSITION');
  });

  test('cancel works with or without a body', async () => {
    expect((await post('/api/residents/mina/tickets/RES-103/cancel')).body.status).toBe('cancelled');
    expect((await post('/api/residents/mina/tickets/RES-102/cancel', { reason: 'Fixed it myself' })).body.status).toBe('cancelled');
  });

  test("another resident's ticket is 404 on every route, and nothing changes", async () => {
    const before = (await get('/api/residents/mina/tickets/RES-101')).body;
    expectError(await get('/api/residents/alex/tickets/RES-101'), 404, 'NOT_FOUND');
    expectError(await post('/api/residents/alex/tickets/RES-101/confirm', { resolved: true }), 404, 'NOT_FOUND');
    expectError(await post('/api/residents/alex/tickets/RES-101/link', { reportText: 'x' }), 404, 'NOT_FOUND');
    expectError(await post('/api/residents/alex/tickets/RES-101/cancel'), 404, 'NOT_FOUND');
    expect((await get('/api/residents/mina/tickets/RES-101')).body).toEqual(before);
  });
});

describe('staff routes', () => {
  test('GET /api/staff and /api/staff/tickets', async () => {
    expect((await get('/api/staff')).body).toEqual([
      { id: 'mgr-jordan', name: 'Jordan Lee', role: 'manager' },
      { id: 'tech-sam', name: 'Sam Rivera', role: 'technician' },
    ]);
    const tickets = (await get('/api/staff/tickets')).body;
    expect(tickets).toHaveLength(3);
    expect(tickets[0]).toMatchObject({ residentName: 'Mina', residentUnit: '204' });
  });

  test('queues', async () => {
    await post('/api/residents/mina/tickets/RES-103/cancel');
    const q = (await get('/api/staff/queues')).body;
    expect(q.open.map((t: SharedTicket) => t.id)).toEqual(['RES-102', 'RES-101']);
    expect(q.awaitingConfirmation.map((t: SharedTicket) => t.id)).toEqual(['RES-101']);
    expect(q.overdue).toEqual([]);
    expect(q.managerQueue).toEqual([]);
  });

  test('assign, inspect, repair, request-confirmation', async () => {
    let res = await post('/api/staff/tickets/RES-103/assign', { staffId: 'mgr-jordan', assigneeId: 'tech-sam' });
    expect(res.body).toMatchObject({ status: 'assigned', assigneeId: 'tech-sam' });
    res = await post('/api/staff/tickets/RES-103/inspect', { ...tech, note: 'Hinge is loose.' });
    expect(res.body.status).toBe('awaiting update');
    expect(res.body.events.at(-1)).toMatchObject({ type: 'inspected', text: 'Hinge is loose.', kind: 'worker' });
    res = await post('/api/staff/tickets/RES-103/repair', { ...tech, note: 'Tightened hinge.' });
    expect(res.body.events.at(-1).type).toBe('repair_attempted');
    res = await post('/api/staff/tickets/RES-103/request-confirmation', tech);
    expect(res.body.status).toBe('awaiting resident confirmation');
  });

  test('unknown staffId is 403', async () => {
    expectError(await post('/api/staff/tickets/RES-103/assign', { staffId: 'mina', assigneeId: 'tech-sam' }), 403, 'FORBIDDEN');
  });

  test('staff cannot resolve by any route', async () => {
    const attempts: [string, object][] = [
      ['/api/staff/tickets/RES-101/resolve', tech],
      ['/api/staff/tickets/RES-101/confirm', { ...tech, resolved: true }],
      ['/api/staff/tickets/RES-101/assign', { ...tech, assigneeId: 'tech-sam' }],
      ['/api/staff/tickets/RES-101/inspect', { ...tech, note: 'Resolved.' }],
      ['/api/staff/tickets/RES-101/repair', { ...tech, note: 'Resolved.' }],
      ['/api/staff/tickets/RES-101/request-confirmation', { ...tech, note: 'Resolved.' }],
    ];
    for (const [path, b] of attempts) {
      const res = await post(path, b);
      expect(res.status, path).toBeGreaterThanOrEqual(400);
      expect(res.body.status, path).toBeUndefined();
    }
    expect((await get('/api/residents/mina/tickets/RES-101')).body.status).toBe('awaiting resident confirmation');
    expect(db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status = 'resolved'").get()).toEqual({ n: 0 });
  });

  test('invalid transitions are 409', async () => {
    expectError(await post('/api/staff/tickets/RES-101/assign', { ...tech, assigneeId: 'tech-sam' }), 409, 'INVALID_TRANSITION');
    expectError(await post('/api/staff/tickets/RES-102/request-confirmation', tech), 409, 'INVALID_TRANSITION');
    expectError(await post('/api/residents/mina/tickets/RES-102/confirm', { resolved: true }), 409, 'INVALID_TRANSITION');
    await post('/api/residents/mina/tickets/RES-103/cancel');
    expectError(await post('/api/residents/mina/tickets/RES-103/cancel'), 409, 'INVALID_TRANSITION');
  });
});

describe('validation', () => {
  test('bad bodies and params give 400 in the error format', async () => {
    const bad: [string, object | string][] = [
      ['/api/residents/mina/tickets/RES-101/confirm', { resolved: 'yes' }],
      ['/api/residents/mina/tickets/RES-101/confirm', {}],
      ['/api/residents/mina/tickets', { location: 'Kitchen' }],
      ['/api/residents/mina/tickets', { description: '   ', location: 'Kitchen' }],
      ['/api/residents/mina/tickets/RES-101/link', { reportText: '' }],
      ['/api/staff/tickets/RES-103/assign', { assigneeId: 'tech-sam' }],
      ['/api/staff/tickets/RES-102/inspect', { staffId: 'tech-sam' }],
      ['/api/clock/advance', { hours: -1 }],
      ['/api/clock/advance', { hours: '2' }],
      ['/api/residents/mina%20x/tickets', { description: 'a', location: 'b' }],
    ];
    for (const [path, b] of bad) expectError(await post(path, b as object), 400, 'INVALID_INPUT');
  });

  test('malformed JSON is 400', async () => {
    const res = await request(app).post('/api/clock/advance').set('Content-Type', 'application/json').send('{"hours":');
    expectError(res, 400, 'INVALID_INPUT');
  });

  test('unknown /api route is 404', async () => {
    expectError(await get('/api/nope'), 404, 'NOT_FOUND');
  });

  test('unexpected errors are 500 INTERNAL without a stack trace', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.close();
    const res = await get('/api/residents');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong.' } });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts/);
    spy.mockRestore();
  });
});

describe('demo routes', () => {
  test('clock and advance', async () => {
    expect((await get('/api/clock')).body).toEqual({ clock: SEED_CLOCK });
    expect((await post('/api/clock/advance', { hours: 49.5 })).body).toEqual({ clock: '2026-01-14T10:30:00.000Z' });
    expect((await get('/api/clock')).body).toEqual({ clock: '2026-01-14T10:30:00.000Z' });
  });

  test('reset restores seed data', async () => {
    const seeded = (await get('/api/staff/tickets')).body;
    await post('/api/residents/mina/tickets', { description: 'New', location: 'Here' });
    await post('/api/residents/mina/tickets/RES-101/confirm', { resolved: false });
    await post('/api/clock/advance', { hours: 5 });
    expect((await get('/api/staff/tickets')).body).not.toEqual(seeded);

    expect((await post('/api/demo/reset')).body).toEqual({ ok: true, clock: SEED_CLOCK });
    expect((await get('/api/staff/tickets')).body).toEqual(seeded);
  });
});
