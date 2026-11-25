import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmRepair } from './workflow.ts';
const ticket: any = { id: 'R-1', status: 'awaiting resident confirmation', events: [] };
test('explicit resident approval resolves', () => assert.equal(confirmRepair(ticket, true).status, 'resolved'));
test('rejection preserves identity and history', () => {
  const t = confirmRepair(ticket, false);
  assert.equal(t.id, ticket.id);
  assert.equal(t.status, 'awaiting update');
  assert.equal(t.events.length, 1);
});
test('other states cannot be confirmed', () => assert.throws(() => confirmRepair({ ...ticket, status: 'assigned' }, true)));
