import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelRequest, confirmRepair } from './workflow.ts';
const ticket: any = { id: 'R-1', status: 'awaiting resident confirmation', events: [] };
test('explicit resident approval resolves', () => assert.equal(confirmRepair(ticket, true).status, 'resolved'));
test('rejection preserves identity and history', () => {
  const t = confirmRepair(ticket, false);
  assert.equal(t.id, ticket.id);
  assert.equal(t.status, 'awaiting update');
  assert.equal(t.events.length, 1);
});
test('other states cannot be confirmed', () => assert.throws(() => confirmRepair({ ...ticket, status: 'assigned' }, true)));

test('cancellation preserves identity and history without mutating the original', () => {
  const original = { ...ticket, events: [{ at: '2026-01-01', kind: 'resident', text: 'Submitted' }] };
  const cancelled = cancelRequest(original);
  assert.equal(cancelled.id, original.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.events.slice(0, -1), original.events);
  assert.equal(cancelled.events.at(-1)?.kind, 'resident');
  assert.equal(original.status, 'awaiting resident confirmation');
  assert.equal(original.events.length, 1);
  assert.ok(Number.isFinite(Date.parse(cancelled.updatedAt)));
});

test('closed requests cannot be cancelled or confirmed', () => {
  for (const status of ['resolved', 'cancelled']) {
    assert.throws(() => cancelRequest({ ...ticket, status }));
    assert.throws(() => confirmRepair({ ...ticket, status }, true));
  }
});
