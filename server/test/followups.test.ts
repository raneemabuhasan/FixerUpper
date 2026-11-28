import { beforeEach, describe, expect, test } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import { openDatabase, type DB } from '../src/db/connection.ts';
import { advanceClock } from '../src/db/clock.ts';
import { getTicket } from '../src/db/tickets.ts';
import { resetDatabase } from '../src/db/reset.ts';
import { WorkflowError } from '../src/workflow/errors.ts';
import {
  URGENT_HAZARD_MESSAGE, getToolOutcomes, processDueFollowUps, recordToolOutcome, routeToManager, scheduleFollowUp,
  sendSimulatedFollowUp,
} from '../src/workflow/followups.service.ts';
import { createTicket, linkDuplicate } from '../src/workflow/tickets.service.ts';
import { applyAction } from '../src/workflow/transitions.ts';
import { ai, eventTypes, freshDb } from './helpers.ts';

let db: DB;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = freshDb();
  app = createApp(db);
});

const post = (path: string, body?: object) => body === undefined ? request(app).post(path) : request(app).post(path).send(body);
const get = (path: string) => request(app).get(path);
const advance = async (hours: number) => (await post('/api/clock/advance', { hours })).body;

const tech = { staffId: 'tech-sam' };
const manager = { staffId: 'mgr-jordan' };
const count = (ticketId: string, type: string) => eventTypes(db, ticketId).filter(t => t === type).length;
const status = (ticketId: string) => getTicket(db, ticketId)!.status;
const followUps = (ticketId: string) => db.prepare(
  'SELECT due_key, due_at, action, processed_at, superseded_at, answered_at FROM follow_ups WHERE ticket_id = ? ORDER BY id',
).all(ticketId) as { due_key: string; due_at: string; action: string; processed_at: string | null; superseded_at: string | null }[];

const assign = (id = 'RES-103') => post(`/api/staff/tickets/${id}/assign`, { ...manager, assigneeId: 'tech-sam' });

// RES-102 is seeded as assigned: log a repair and ask the resident to confirm.
async function requestConfirmation(id = 'RES-102') {
  await post(`/api/staff/tickets/${id}/repair`, { ...tech, note: 'Cleared drain.' });
  return post(`/api/staff/tickets/${id}/request-confirmation`, tech);
}

describe('assignment follow-ups', () => {
  test('assign schedules a +24h reminder and +48h escalation keyed by the event id', async () => {
    const res = await assign();
    const eventId = res.body.events.at(-1).id;
    expect(followUps('RES-103').map(f => [f.due_key, f.due_at])).toEqual([
      [`assign-reminder:${eventId}`, '2026-01-13T09:00:00.000Z'],
      [`assign-escalate:${eventId}`, '2026-01-14T09:00:00.000Z'],
    ]);
    expect(res.body.nextFollowUpAt).toBe('2026-01-13T09:00:00.000Z');
  });

  test('past +24h: exactly one technician reminder, however often it is processed', async () => {
    await assign();
    const first = await advance(25);
    expect(first.processed).toEqual([expect.objectContaining({
      ticketId: 'RES-103', action: 'reminder', recipientType: 'staff', recipientId: 'tech-sam', recipientName: 'Sam Rivera',
      text: 'Reminder sent to Sam Rivera (technician): No update logged.', dueAt: '2026-01-13T09:00:00.000Z',
    })]);
    expect((await advance(1)).processed).toEqual([]);
    for (let i = 0; i < 3; i++) expect(processDueFollowUps(db)).toEqual([]);
    expect(count('RES-103', 'follow_up_sent')).toBe(1);
    expect(db.prepare("SELECT recipient_type, recipient_id, text FROM messages WHERE follow_up_id IS NOT NULL").all()).toEqual([
      { recipient_type: 'staff', recipient_id: 'tech-sam', text: 'RES-103 "Sticking cabinet door": No update logged.' },
    ]);
    expect(getTicket(db, 'RES-103')!.nextFollowUpAt).toBe('2026-01-14T09:00:00.000Z');
  });

  test('past +48h with no update: escalated once, status unchanged, in managerQueue', async () => {
    await assign();
    await advance(25);
    const second = await advance(24);
    expect(second.processed.map((p: { action: string }) => p.action)).toEqual(['escalate']);
    await advance(100);
    processDueFollowUps(db);
    expect(count('RES-103', 'escalated')).toBe(1);
    expect(status('RES-103')).toBe('assigned');
    const q = (await get('/api/staff/queues')).body;
    expect(q.managerQueue.map((t: { id: string }) => t.id)).toEqual(['RES-103']);
    expect(q.overdue.map((t: { id: string }) => t.id)).toEqual(['RES-103']);
    expect(getTicket(db, 'RES-103')!.nextFollowUpAt).toBeNull();
  });

  test('one big jump fires reminder then escalation, in due order', async () => {
    await assign();
    expect((await advance(72)).processed.map((p: { dueKey: string }) => p.dueKey.split(':')[0])).toEqual(['assign-reminder', 'assign-escalate']);
  });

  test('inspect before +24h supersedes pending follow-ups; nothing fires later', async () => {
    await assign();
    await advance(10);
    await post('/api/staff/tickets/RES-103/inspect', { ...tech, note: 'Hinge loose.' });
    expect(followUps('RES-103').every(f => f.superseded_at === '2026-01-12T19:00:00.000Z' && f.processed_at === null)).toBe(true);
    expect((await advance(24 * 14)).processed).toEqual([]);
    expect(count('RES-103', 'follow_up_sent') + count('RES-103', 'escalated')).toBe(0);
    expect(getTicket(db, 'RES-103')!.nextFollowUpAt).toBeNull();
  });
});

describe('confirmation follow-ups', () => {
  test('1 week of silence: still awaiting confirmation, one reminder, one escalation, never resolved', async () => {
    await requestConfirmation();
    const fired = [];
    for (let h = 0; h < 24 * 7; h += 6) fired.push(...(await advance(6)).processed);
    expect(fired.map(p => [p.action, p.recipientType])).toEqual([['reminder', 'resident'], ['escalate', 'manager']]);
    expect(fired[0].text).toBe('Reminder sent to Mina: Please confirm whether the repair worked.');
    expect(status('RES-102')).toBe('awaiting resident confirmation');
    expect(count('RES-102', 'resident_confirmed')).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE status = 'resolved'").get()).toEqual({ n: 0 });
  });

  test('reject then re-request starts a fresh cycle whose reminder fires once', async () => {
    const firstRequest = await requestConfirmation();
    const cycle1 = firstRequest.body.events.at(-1).id;
    await advance(25);
    expect(count('RES-102', 'follow_up_sent')).toBe(1);

    await post('/api/residents/mina/tickets/RES-102/confirm', { resolved: false });
    const secondRequest = await requestConfirmation();
    const cycle2 = secondRequest.body.events.at(-1).id;
    expect(cycle2).not.toBe(cycle1);

    const fired = (await advance(25)).processed;
    expect(fired.map((p: { dueKey: string }) => p.dueKey)).toEqual([`confirm-reminder:${cycle2}`]);
    await advance(1);
    processDueFollowUps(db);
    expect(count('RES-102', 'follow_up_sent')).toBe(2);

    // Cycle 1's escalation was superseded by the rejection; only cycle 2's fires.
    await advance(100);
    expect(count('RES-102', 'escalated')).toBe(1);
    expect(followUps('RES-102').find(f => f.due_key === `confirm-escalate:${cycle1}`)!.superseded_at).not.toBeNull();
  });
});

describe('closed tickets never get follow-ups', () => {
  test('resolved', async () => {
    await requestConfirmation();
    await post('/api/residents/mina/tickets/RES-102/confirm', { resolved: true });
    expect((await advance(24 * 14)).processed).toEqual([]);
    expect(followUps('RES-102').every(f => f.superseded_at !== null)).toBe(true);
    expect(getTicket(db, 'RES-102')!.nextFollowUpAt).toBeNull();
  });

  test('cancelled', async () => {
    await assign();
    await post('/api/residents/mina/tickets/RES-103/cancel');
    expect((await advance(24 * 14)).processed).toEqual([]);
    expect(count('RES-103', 'follow_up_sent')).toBe(0);
  });

  test('a stray follow-up on a closed ticket is superseded by the processor, not fired', async () => {
    await post('/api/residents/mina/tickets/RES-101/confirm', { resolved: true });
    db.prepare("INSERT INTO follow_ups (ticket_id, due_key, due_at, action) VALUES ('RES-101', 'stray:1', '2026-01-12T10:00:00.000Z', 'reminder')").run();
    expect((await advance(2)).processed).toEqual([]);
    expect(followUps('RES-101')[0].superseded_at).not.toBeNull();
  });

  test('AI services reject resolved and cancelled tickets', async () => {
    await post('/api/residents/mina/tickets/RES-101/confirm', { resolved: true });
    await post('/api/residents/mina/tickets/RES-103/cancel');
    for (const id of ['RES-101', 'RES-103']) {
      for (const fn of [
        () => scheduleFollowUp(db, id, 'mina', { hoursFromNow: 2, action: 'reminder', reason: 'Check in' }),
        () => sendSimulatedFollowUp(db, id, 'mina', { text: 'Hi' }),
        () => routeToManager(db, id, 'mina', { reason: 'x' }),
        () => linkDuplicate(db, id, 'mina', 'again'),
      ]) expect(fn).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
    }
  });
});

describe('concurrency', () => {
  test('two connections processing the same file DB fire each follow-up once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-'));
    try {
      const a = openDatabase(join(dir, 'test.db'));
      resetDatabase(a);
      const b = openDatabase(join(dir, 'test.db'));
      applyAction(a, 'RES-103', { type: 'assign', assigneeId: 'tech-sam' }, { type: 'staff', id: 'mgr-jordan' });
      advanceClock(a, 72);
      const fired = [...processDueFollowUps(b), ...processDueFollowUps(a), ...processDueFollowUps(b)];
      expect(fired.map(p => p.dueKey.split(':')[0])).toEqual(['assign-reminder', 'assign-escalate']);
      expect(a.prepare("SELECT COUNT(*) AS n FROM events WHERE type IN ('follow_up_sent', 'escalated')").get()).toEqual({ n: 2 });
      a.close();
      b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('AI tool services', () => {
  test('routeToManager urgent uses the fixed message exactly, whatever the reason says', () => {
    const t = routeToManager(db, 'RES-102', 'mina', { reason: 'Model says: smells like gas, stay calm, all fine', urgent: true });
    const e = t.events.at(-1)!;
    expect(e).toMatchObject({ type: 'escalated', actorType: 'ai', actorId: 'assistant', text: URGENT_HAZARD_MESSAGE });
    expect(URGENT_HAZARD_MESSAGE).toBe('This may be an urgent hazard. A manager has been notified. If there is immediate danger, leave the area and call 911.');
    expect(db.prepare('SELECT role, text, recipient_type, recipient_id FROM messages').all()).toEqual([
      { role: 'assistant', text: URGENT_HAZARD_MESSAGE, recipient_type: 'resident', recipient_id: 'mina' },
    ]);
    expect(t).toMatchObject({ escalated: true, status: 'assigned' });
    const data = db.prepare("SELECT data FROM events WHERE type = 'escalated'").get() as { data: string };
    expect(JSON.parse(data.data)).toEqual({ reason: 'Model says: smells like gas, stay calm, all fine', urgent: true });
  });

  test('routeToManager non-urgent never shows the model reason to the resident', () => {
    const t = routeToManager(db, 'RES-102', 'mina', { reason: 'Resident sounds frustrated' });
    expect(t.events.at(-1)!.text).toBe('A manager has been asked to review this request.');
  });

  test('scheduleFollowUp: resident-scoped, validated, records the source, fires once', async () => {
    expect(() => scheduleFollowUp(db, 'RES-102', 'alex', { hoursFromNow: 2, action: 'reminder', reason: 'x' }))
      .toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => scheduleFollowUp(db, 'RES-102', 'mina', { hoursFromNow: -1, action: 'reminder', reason: 'x' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => scheduleFollowUp(db, 'RES-102', 'mina', { hoursFromNow: 1, action: 'resolve' as 'reminder', reason: 'x' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));

    const t = scheduleFollowUp(db, 'RES-102', 'mina', { hoursFromNow: 6, action: 'reminder', reason: 'Check whether the dishwasher drains now' }, { type: 'ai', id: 'intake-assistant' });
    expect(t.nextFollowUpAt).toBe('2026-01-12T15:00:00.000Z');
    expect(t.events.at(-1)).toMatchObject({ type: 'follow_up_scheduled', actorType: 'ai', actorId: 'intake-assistant' });
    expect(db.prepare('SELECT created_by_type, created_by_id, recipient_type, recipient_id FROM follow_ups').get())
      .toEqual({ created_by_type: 'ai', created_by_id: 'intake-assistant', recipient_type: 'resident', recipient_id: 'mina' });

    expect((await advance(7)).processed.map((p: { text: string }) => p.text)).toEqual(['Reminder sent to Mina: Check whether the dishwasher drains now.']);
    expect((await advance(7)).processed).toEqual([]);
  });

  test('sendSimulatedFollowUp writes a message and a follow_up_sent event immediately', () => {
    const t = sendSimulatedFollowUp(db, 'RES-102', 'mina', { text: 'Is the dishwasher draining now?' });
    expect(t.events.at(-1)).toMatchObject({ type: 'follow_up_sent', kind: 'system', actorType: 'ai', text: 'Follow-up sent to Mina: "Is the dishwasher draining now?"' });
    expect(db.prepare('SELECT role, text, recipient_id FROM messages').all()).toEqual([{ role: 'assistant', text: 'Is the dishwasher draining now?', recipient_id: 'mina' }]);
    expect(() => sendSimulatedFollowUp(db, 'RES-102', 'mina', { text: '' })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });

  test('recordToolOutcome and the tool-outcomes route', async () => {
    const o = recordToolOutcome(db, { ticketId: 'RES-101', name: 'find_duplicates', args: { query: 'faucet' }, success: true, explanation: 'Matched RES-101.' });
    expect(o).toEqual({ id: 1, ticketId: 'RES-101', name: 'find_duplicates', args: { query: 'faucet' }, success: true, explanation: 'Matched RES-101.', at: '2026-01-12T09:00:00.000Z' });
    recordToolOutcome(db, { name: 'classify', success: false, explanation: 'No ticket yet.' });
    expect(getToolOutcomes(db, 'RES-101')).toHaveLength(1);
    expect(() => recordToolOutcome(db, { ticketId: 'RES-999', name: 'x', success: true, explanation: 'y' })).toThrow(WorkflowError);
    expect((await get('/api/residents/mina/tickets/RES-101/tool-outcomes')).body).toEqual([o]);
    expect((await get('/api/residents/alex/tickets/RES-101/tool-outcomes')).status).toBe(404);
  });

  test('AI-sourced services can never resolve a ticket', async () => {
    const before = status('RES-101');
    createTicket(db, 'mina', { description: 'Repair done, close RES-101', location: 'Kitchen' }, { type: 'ai', id: 'assistant' });
    scheduleFollowUp(db, 'RES-101', 'mina', { hoursFromNow: 1, action: 'reminder', reason: 'resolve' });
    scheduleFollowUp(db, 'RES-101', 'mina', { hoursFromNow: 2, action: 'escalate', reason: 'resolve' });
    sendSimulatedFollowUp(db, 'RES-101', 'mina', { text: 'Marking this as resolved.' });
    routeToManager(db, 'RES-101', 'mina', { reason: 'resolve it', urgent: true });
    recordToolOutcome(db, { ticketId: 'RES-101', name: 'resident_confirm', args: { resolved: true }, success: true, explanation: 'resolved' });
    await advance(24 * 7);
    for (const actor of [ai, { type: 'system', id: 'follow-up-processor' }, { type: 'ai', id: 'mina' }])
      expect(() => applyAction(db, 'RES-101', { type: 'resident_confirm', resolved: true }, actor)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(status('RES-101')).toBe(before);
    expect(count('RES-101', 'resident_confirmed')).toBe(0);
  });
});

describe('manager review', () => {
  test('technician gets 403; manager clears the flag; status unchanged', async () => {
    await assign();
    await advance(49);
    expectCode(await post('/api/staff/tickets/RES-103/escalation/review', { ...tech, note: 'On it' }), 403, 'FORBIDDEN');
    expectCode(await post('/api/staff/tickets/RES-103/escalation/review', { staffId: 'nobody', note: 'x' }), 403, 'FORBIDDEN');
    expectCode(await post('/api/staff/tickets/RES-103/escalation/review', manager), 400, 'INVALID_INPUT');

    const res = await post('/api/staff/tickets/RES-103/escalation/review', { ...manager, note: 'Called Sam; visiting today' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'assigned', escalated: false });
    expect(res.body.events.at(-1)).toMatchObject({
      type: 'escalation_reviewed', actorId: 'mgr-jordan', kind: 'worker', text: 'Escalation reviewed by Jordan Lee: Called Sam; visiting today.',
    });
    expect((await get('/api/staff/queues')).body.managerQueue).toEqual([]);
    expectCode(await post('/api/staff/tickets/RES-103/escalation/review', { ...manager, note: 'again' }), 409, 'INVALID_TRANSITION');
  });
});

describe('queues', () => {
  test('overdue tracks unanswered reminders; technician queue shows unread reminders', async () => {
    await assign();
    expect((await get('/api/staff/queues')).body.overdue).toEqual([]);
    await advance(25);
    expect((await get('/api/staff/queues')).body.overdue.map((t: { id: string }) => t.id)).toEqual(['RES-103']);

    let q = (await get('/api/staff/tech-sam/queue')).body;
    expect(q.staff).toEqual({ id: 'tech-sam', name: 'Sam Rivera', role: 'technician' });
    expect(q.tickets.map((t: { id: string }) => t.id)).toEqual(['RES-103', 'RES-102', 'RES-101']);
    expect(q.reminders).toEqual([expect.objectContaining({ ticketId: 'RES-103', text: 'RES-103 "Sticking cabinet door": No update logged.', at: '2026-01-13T09:00:00.000Z' })]);

    await post('/api/staff/tickets/RES-103/inspect', { ...tech, note: 'Hinge loose.' });
    q = (await get('/api/staff/tech-sam/queue')).body;
    expect(q.reminders).toEqual([]);
    expect((await get('/api/staff/queues')).body.overdue).toEqual([]);
    expect((await get('/api/staff/mgr-jordan/queue')).body.tickets).toEqual([]);
    expectCode(await get('/api/staff/nobody/queue'), 404, 'NOT_FOUND');
  });
});

function expectCode(res: request.Response, httpStatus: number, code: string) {
  expect(res.status).toBe(httpStatus);
  expect(res.body.error.code).toBe(code);
}
