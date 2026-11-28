import { describe, expect, test } from 'vitest';
import { applyAction, RULES, type Action, type Actor } from '../src/workflow/transitions.ts';
import { STATUSES, type Status } from '../src/workflow/status.ts';
import { WorkflowError, type WorkflowErrorCode } from '../src/workflow/errors.ts';
import { getTicket } from '../src/db/tickets.ts';
import { listEvents } from '../src/workflow/events.ts';
import { ai, alex, eventTypes, freshDb, insertTicket, manager, mina, system, tech } from './helpers.ts';

function expectCode(fn: () => unknown, code: WorkflowErrorCode) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(WorkflowError);
    expect((err as WorkflowError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}, but nothing was thrown`);
}

// One representative action per action type, with the actor allowed to perform it.
const CASES: { action: Action; actor: Actor; to: Status; events: string[] }[] = [
  { action: { type: 'assign', assigneeId: 'tech-sam' }, actor: manager, to: 'assigned', events: ['assigned'] },
  { action: { type: 'inspected_only' }, actor: tech, to: 'awaiting update', events: ['inspected'] },
  { action: { type: 'repair_attempted', note: 'Replaced washer.' }, actor: tech, to: 'awaiting update', events: ['repair_attempted'] },
  { action: { type: 'request_confirmation' }, actor: tech, to: 'awaiting resident confirmation', events: ['confirmation_requested'] },
  { action: { type: 'resident_confirm', resolved: true }, actor: mina, to: 'resolved', events: ['resident_confirmed'] },
  { action: { type: 'resident_confirm', resolved: false }, actor: mina, to: 'awaiting update', events: ['resident_rejected', 'reopened'] },
  { action: { type: 'cancel' }, actor: mina, to: 'cancelled', events: ['cancelled'] },
];

describe('transition matrix', () => {
  for (const { action, actor, to, events } of CASES) {
    const label = action.type === 'resident_confirm' ? `resident_confirm(${action.resolved})` : action.type;
    for (const from of STATUSES) {
      const allowed = RULES[action.type].from.includes(from);
      test(`${label} from "${from}" ${allowed ? `-> "${to}"` : 'throws INVALID_TRANSITION'}`, () => {
        const db = freshDb();
        const id = insertTicket(db, from, { withRepairAttempt: true });
        const before = listEvents(db, id);
        if (allowed) {
          const t = applyAction(db, id, action, actor);
          expect(t.status).toBe(to);
          expect(t.id).toBe(id);
          expect(eventTypes(db, id)).toEqual([...before.map(e => e.type), ...events]);
        } else {
          expectCode(() => applyAction(db, id, action, actor), 'INVALID_TRANSITION');
          expect(getTicket(db, id)!.status).toBe(from);
          expect(listEvents(db, id)).toEqual(before);
        }
      });
    }
  }

  test('nothing leaves resolved or cancelled', () => {
    expect(RULES.cancel.from).not.toContain('resolved');
    expect(RULES.cancel.from).not.toContain('cancelled');
    for (const rule of Object.values(RULES)) {
      expect(rule.from).not.toContain('resolved');
      expect(rule.from).not.toContain('cancelled');
    }
  });
});

describe('who can resolve', () => {
  for (const actor of [tech, manager, ai, system, { type: 'staff', id: 'mina' } as Actor, { type: 'ai', id: 'mina' } as Actor]) {
    test(`${actor.type}:${actor.id} cannot resolve`, () => {
      const db = freshDb();
      expectCode(() => applyAction(db, 'RES-101', { type: 'resident_confirm', resolved: true }, actor), 'FORBIDDEN');
      expect(getTicket(db, 'RES-101')!.status).toBe('awaiting resident confirmation');
    });
  }

  test('ai and system actors cannot perform staff actions either', () => {
    const db = freshDb();
    for (const actor of [ai, system, mina])
      expectCode(() => applyAction(db, 'RES-103', { type: 'assign', assigneeId: 'tech-sam' }, actor), 'FORBIDDEN');
  });

  test('unknown staff id is forbidden', () => {
    const db = freshDb();
    expectCode(() => applyAction(db, 'RES-103', { type: 'assign', assigneeId: 'tech-sam' }, { type: 'staff', id: 'nobody' }), 'FORBIDDEN');
  });
});

describe('resident scope', () => {
  test('a different resident cannot confirm, reject or cancel', () => {
    const db = freshDb();
    for (const action of [{ type: 'resident_confirm', resolved: true }, { type: 'resident_confirm', resolved: false }, { type: 'cancel' }] as Action[])
      expectCode(() => applyAction(db, 'RES-101', action, alex), 'FORBIDDEN');
    expect(getTicket(db, 'RES-101')!.status).toBe('awaiting resident confirmation');
    expect(eventTypes(db, 'RES-101')).toEqual(['created', 'repair_attempted']);
  });

  test('unknown ticket is NOT_FOUND', () => {
    expectCode(() => applyAction(freshDb(), 'RES-999', { type: 'cancel' }, mina), 'NOT_FOUND');
  });

  test('malformed action or actor is INVALID_INPUT', () => {
    const db = freshDb();
    expectCode(() => applyAction(db, 'RES-101', { type: 'resolve' }, mina), 'INVALID_INPUT');
    expectCode(() => applyAction(db, 'RES-101', { type: 'resident_confirm', resolved: true }, { type: 'landlord', id: 'x' }), 'INVALID_INPUT');
    expectCode(() => applyAction(db, 'RES-103', { type: 'assign', assigneeId: 'ghost' }, manager), 'INVALID_INPUT');
  });
});

describe('rejection and repair attempts', () => {
  test('rejection reopens with the same ID and full history', () => {
    const db = freshDb();
    const before = listEvents(db, 'RES-101');
    const t = applyAction(db, 'RES-101', { type: 'resident_confirm', resolved: false }, mina);
    expect(t.id).toBe('RES-101');
    expect(t.status).toBe('awaiting update');
    const after = listEvents(db, 'RES-101');
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length).map(e => [e.type, e.actorType, e.actorId])).toEqual([
      ['resident_rejected', 'resident', 'mina'],
      ['reopened', 'resident', 'mina'],
    ]);
  });

  test('request_confirmation fails without a repair attempt', () => {
    const db = freshDb();
    applyAction(db, 'RES-102', { type: 'inspected_only' }, tech);
    expectCode(() => applyAction(db, 'RES-102', { type: 'request_confirmation' }, tech), 'INVALID_TRANSITION');
    expect(getTicket(db, 'RES-102')!.status).toBe('awaiting update');
  });

  test('a repair attempt from before a reopen does not count', () => {
    const db = freshDb();
    applyAction(db, 'RES-101', { type: 'resident_confirm', resolved: false }, mina);
    expectCode(() => applyAction(db, 'RES-101', { type: 'request_confirmation' }, tech), 'INVALID_TRANSITION');
    applyAction(db, 'RES-101', { type: 'repair_attempted', note: 'Replaced cartridge.' }, tech);
    applyAction(db, 'RES-101', { type: 'request_confirmation' }, tech);
    const t = applyAction(db, 'RES-101', { type: 'resident_confirm', resolved: true }, mina);
    expect(t.status).toBe('resolved');
    expect(eventTypes(db, 'RES-101')).toEqual([
      'created', 'repair_attempted', 'resident_rejected', 'reopened',
      'repair_attempted', 'confirmation_requested', 'resident_confirmed',
    ]);
  });

  test('full happy path from submitted to resolved', () => {
    const db = freshDb();
    applyAction(db, 'RES-103', { type: 'assign', assigneeId: 'tech-sam' }, manager);
    applyAction(db, 'RES-103', { type: 'repair_attempted' }, tech);
    applyAction(db, 'RES-103', { type: 'request_confirmation' }, tech);
    const t = applyAction(db, 'RES-103', { type: 'resident_confirm', resolved: true }, mina);
    expect(t).toMatchObject({ status: 'resolved', assigneeId: 'tech-sam', nextAction: 'No action needed' });
  });
});
