// Dev 3 checks: structured intake, clarification, duplicates, tool failures, hazards, outages, baseline.
// A scripted model stands in for the real one, so these run offline and deterministically.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import type { DB } from '../src/db/connection.ts';
import { HAZARD_NOT_ROUTED_MESSAGE, detectHazards } from '../src/ai/hazards.ts';
import { AiUnavailableError, type AssistantBlock, type ModelClient, type ModelRequest, type ModelResponse } from '../src/ai/model.ts';
import { REPLY_TOOL_NAME } from '../src/ai/prompts.ts';
import { ACTION_TOOLS } from '../src/ai/tools.ts';
import { URGENT_HAZARD_MESSAGE } from '../src/workflow/followups.service.ts';
import { eventTypes, freshDb } from './helpers.ts';

type Step = AssistantBlock[] | Error | ((req: ModelRequest) => AssistantBlock[]);

// Plays back one step per model call and records every request it received.
class ScriptedModel implements ModelClient {
  readonly name = 'scripted-test-model';
  readonly requests: ModelRequest[] = [];
  private steps: Step[] = [];

  queue(...steps: Step[]) {
    this.steps.push(...steps);
    return this;
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(req));
    const step = this.steps.shift();
    if (!step) throw new Error('ScriptedModel ran out of steps');
    if (step instanceof Error) throw step;
    const content = typeof step === 'function' ? step(req) : step;
    return { content, stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
  }

  get remaining() {
    return this.steps.length;
  }
}

let n = 0;
const use = (name: string, input: unknown): AssistantBlock => ({ type: 'tool_use', id: `tu_${++n}`, name, input });
const reply = (input: Record<string, unknown>): AssistantBlock => use(REPLY_TOOL_NAME, input);

// The tool_result the model received for its previous call, parsed.
function lastResults(req: ModelRequest): { ok: boolean; result?: any; error?: any }[] {
  const last = req.messages[req.messages.length - 1];
  if (last.role !== 'user') return [];
  return last.content.filter(b => b.type === 'tool_result').map(b => JSON.parse((b as { content: string }).content));
}

let db: DB;
let model: ScriptedModel;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = freshDb();
  model = new ScriptedModel();
  app = createApp(db, { model });
});

const say = (body: Record<string, unknown>, residentId = 'mina') =>
  request(app).post(`/api/residents/${residentId}/assistant/messages`).send(body);

const ticketCount = () => (db.prepare('SELECT COUNT(*) AS c FROM tickets').get() as { c: number }).c;

describe('structured intake', () => {
  it('checks for duplicates, creates a ticket through the tool, and logs the call', async () => {
    model.queue(
      [use('get_resident_tickets', { query: 'bathroom sink slow drain' })],
      [use('create_ticket', { title: 'Bathroom sink draining slowly', category: 'Plumbing', location: 'Bathroom sink', description: 'The bathroom sink drains very slowly.' })],
      [reply({ message: 'I filed your request.', intent: 'ticket_created', extracted: { category: 'Plumbing', location: 'Bathroom sink' } })],
    );
    const res = await say({ text: 'My bathroom sink drains really slowly.' });

    expect(res.status).toBe(200);
    expect(res.body.reply).toEqual({ message: 'I filed your request.', intent: 'ticket_created', missing: [] });
    expect(res.body.toolCalls.map((c: { name: string; success: boolean }) => [c.name, c.success]))
      .toEqual([['get_resident_tickets', true], ['create_ticket', true]]);
    const [ticket] = res.body.tickets;
    expect(ticket).toMatchObject({ id: 'RES-104', status: 'submitted', category: 'Plumbing', location: 'Bathroom sink' });
    expect(ticket.events[0]).toMatchObject({ type: 'created', actorType: 'ai' });

    const outcomes = await request(app).get('/api/residents/mina/tickets/RES-104/tool-outcomes');
    expect(outcomes.body).toHaveLength(1);
    expect(outcomes.body[0]).toMatchObject({ name: 'create_ticket', success: true });
  });

  it('sends the model only real tools, all with JSON schemas, and no way to resolve a ticket', async () => {
    model.queue([reply({ message: 'Hi!', intent: 'info' })]);
    await say({ text: 'hello' });
    const names = model.requests[0].tools.map(t => t.name);
    expect(names).toEqual([
      'get_resident_tickets', 'create_ticket', 'link_confirmed_duplicate', 'schedule_follow_up', 'send_simulated_follow_up', 'route_to_manager', REPLY_TOOL_NAME,
    ]);
    expect(names.some(n => /resolve|confirm_repair|close/.test(n))).toBe(false);
    for (const t of model.requests[0].tools) expect(t.input_schema.type).toBe('object');
  });

  it('ranks the most similar open request first', async () => {
    model.queue([use('get_resident_tickets', { query: 'kitchen tap is leaking again' })], req => {
      const [r] = lastResults(req);
      expect(r.result.tickets[0].id).toBe('RES-101');
      return [reply({ message: 'Checking.', intent: 'info' })];
    });
    expect((await say({ text: 'kitchen tap is leaking again' })).status).toBe(200);
  });

  it('keeps unrelated issues as separate tickets', async () => {
    model.queue(
      [
        use('create_ticket', { title: 'Bedroom window will not latch', category: 'Maintenance', location: 'Bedroom window', description: 'Window latch is broken.' }),
        use('create_ticket', { title: 'Bathroom fan is noisy', category: 'Maintenance', location: 'Bathroom', description: 'Fan rattles loudly.' }),
      ],
      [reply({ message: 'I filed two requests.', intent: 'ticket_created' })],
    );
    const res = await say({ text: 'My bedroom window won’t latch, and separately the bathroom fan rattles.' });
    expect(res.body.tickets.map((t: { id: string }) => t.id)).toEqual(['RES-104', 'RES-105']);
  });

  it('refuses to file the same issue twice in one chat', async () => {
    const args = { title: 'Hall light flickers', category: 'Maintenance', location: 'Hallway', description: 'The hall light flickers.' };
    model.queue([use('create_ticket', args)], [reply({ message: 'Filed.', intent: 'ticket_created' })]);
    const first = await say({ text: 'The hall light flickers.' });
    model.queue([use('create_ticket', args)], req => {
      expect(lastResults(req)[0]).toMatchObject({ ok: false });
      return [reply({ message: 'That is already filed as RES-104.', intent: 'info' })];
    });
    const second = await say({ conversationId: first.body.conversationId, text: 'Also the hall light flickers.' });
    expect(second.body.toolCalls[0]).toMatchObject({ name: 'create_ticket', success: false });
    expect(ticketCount()).toBe(4);
  });
});

describe('clarification', () => {
  it('asks for a missing detail without creating a ticket', async () => {
    model.queue([reply({ message: 'Which faucet is dripping, kitchen or bathroom?', intent: 'clarify', missing: ['where'] })]);
    const res = await say({ text: 'A faucet is dripping.' });
    expect(res.body.reply).toMatchObject({ intent: 'clarify', missing: ['where'] });
    expect(res.body.tickets).toEqual([]);
    expect(ticketCount()).toBe(3);
  });

  it('keeps the conversation so the answer arrives with context', async () => {
    model.queue([reply({ message: 'Where is it?', intent: 'clarify', missing: ['where'] })]);
    const first = await say({ text: 'Something is dripping.' });
    model.queue([reply({ message: 'Thanks.', intent: 'info' })]);
    await say({ conversationId: first.body.conversationId, text: 'The bathroom sink.' });
    const texts = model.requests[1].messages.map(m => m.content.map(b => ('text' in b ? b.text : '')).join(''));
    expect(texts[0]).toContain('Something is dripping.');
    expect(texts[1]).toBe('Where is it?');
    expect(texts[2]).toContain('The bathroom sink.');
  });
});

describe('duplicates', () => {
  async function propose() {
    model.queue(
      [use('get_resident_tickets', { query: 'kitchen faucet dripping' })],
      [reply({ message: 'Is this the same as your faucet request RES-101?', intent: 'propose_duplicate', proposedDuplicateTicketId: 'RES-101' })],
    );
    return say({ text: 'The kitchen faucet is dripping again.' });
  }

  it('proposes a match and waits for the resident', async () => {
    const res = await propose();
    expect(res.body.proposedDuplicate).toMatchObject({ ticketId: 'RES-101', title: 'Kitchen faucet dripping' });
    expect(ticketCount()).toBe(3);
  });

  it('blocks creating a ticket while the duplicate question is open', async () => {
    const first = await propose();
    model.queue([use('create_ticket', { title: 'Kitchen faucet dripping', category: 'Plumbing', location: 'Kitchen sink', description: 'Dripping again.' })],
      [reply({ message: 'Please answer with the buttons.', intent: 'info' })]);
    const res = await say({ conversationId: first.body.conversationId, text: 'just make a new one' });
    expect(res.body.toolCalls[0]).toMatchObject({ name: 'create_ticket', success: false });
    expect(res.body.proposedDuplicate.ticketId).toBe('RES-101');
    expect(ticketCount()).toBe(3);
  });

  it('cannot link on the model’s own guess', async () => {
    model.queue(
      [use('link_confirmed_duplicate', { ticketId: 'RES-101', reportText: 'Dripping again.' })],
      [reply({ message: 'I could not link that yet.', intent: 'info' })],
    );
    const res = await say({ text: 'The kitchen faucet is dripping again.' });
    expect(res.body.toolCalls[0]).toMatchObject({ name: 'link_confirmed_duplicate', success: false });
    expect(res.body.toolCalls[0].explanation).toMatch(/not confirmed/);
    expect(eventTypes(db, 'RES-101')).not.toContain('duplicate_linked');
  });

  it('links after the resident presses yes, using their own words', async () => {
    const first = await propose();
    model.queue(
      [use('link_confirmed_duplicate', { ticketId: 'RES-101', reportText: 'model paraphrase' })],
      [reply({ message: 'Added to RES-101.', intent: 'duplicate_linked' })],
    );
    const res = await say({ conversationId: first.body.conversationId, decision: { type: 'confirm_duplicate', ticketId: 'RES-101' } });
    expect(res.status).toBe(200);
    expect(res.body.toolCalls).toHaveLength(1);
    expect(res.body.proposedDuplicate).toBeNull();
    expect(eventTypes(db, 'RES-101')).toContain('duplicate_linked');
    const link = db.prepare('SELECT linked_report_text FROM duplicate_links').get() as { linked_report_text: string };
    expect(link.linked_report_text).toBe('The kitchen faucet is dripping again.');
    expect(ticketCount()).toBe(3);
  });

  it('still links if the model forgets to, because the resident decided', async () => {
    const first = await propose();
    model.queue([reply({ message: 'Got it.', intent: 'info' })]);
    const res = await say({ conversationId: first.body.conversationId, decision: { type: 'confirm_duplicate', ticketId: 'RES-101' } });
    expect(res.body.reply.intent).toBe('duplicate_linked');
    expect(res.body.toolCalls).toEqual([expect.objectContaining({ name: 'link_confirmed_duplicate', success: true })]);
  });

  it('after "no", files a new ticket and never proposes the same match again', async () => {
    const first = await propose();
    model.queue(
      [reply({ message: 'Same as RES-101?', intent: 'propose_duplicate', proposedDuplicateTicketId: 'RES-101' })],
      req => {
        expect(req.messages[req.messages.length - 1].content[0]).toMatchObject({ type: 'tool_result', is_error: true });
        return [use('create_ticket', { title: 'Kitchen faucet dripping', category: 'Plumbing', location: 'Kitchen sink', description: 'Dripping from the base.' })];
      },
      [reply({ message: 'Filed as a new request.', intent: 'ticket_created' })],
    );
    const res = await say({ conversationId: first.body.conversationId, decision: { type: 'reject_duplicate', ticketId: 'RES-101' } });
    expect(res.body.tickets[0].id).toBe('RES-104');
    expect(res.body.proposedDuplicate).toBeNull();
  });

  it('rejects a decision about a ticket that was never proposed', async () => {
    const res = await say({ decision: { type: 'confirm_duplicate', ticketId: 'RES-102' } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_DECISION');
    expect(model.requests).toHaveLength(0);
  });

  it('does not let the model propose another resident’s ticket', async () => {
    model.queue(
      [reply({ message: 'Same as RES-101?', intent: 'propose_duplicate', proposedDuplicateTicketId: 'RES-101' })],
      [reply({ message: 'What is wrong, and where?', intent: 'clarify', missing: ['what', 'where'] })],
    );
    const res = await say({ text: 'faucet dripping' }, 'alex');
    expect(res.body.proposedDuplicate).toBeNull();
    expect(res.body.reply.intent).toBe('clarify');
  });
});

describe('tool failures', () => {
  it('reports a failed call as a failure and makes the model answer again', async () => {
    model.queue(
      [use('schedule_follow_up', { ticketId: 'RES-999', hoursFromNow: 24, action: 'reminder', reason: 'check in' }), reply({ message: 'Done!', intent: 'info' })],
      req => {
        expect(lastResults(req)[0]).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
        return [reply({ message: 'I could not find that request.', intent: 'info' })];
      },
    );
    const res = await say({ text: 'remind me about RES-999 tomorrow' });
    expect(res.body.reply.message).toBe('I could not find that request.');
    expect(res.body.toolCalls[0]).toMatchObject({ name: 'schedule_follow_up', success: false, ticketId: null });
  });

  it('rejects invalid arguments before anything runs', async () => {
    model.queue(
      [use('create_ticket', { title: 'Leak', category: 'Plumbing', description: 'Leaking.' })],
      [reply({ message: 'Where is the leak?', intent: 'clarify', missing: ['where'] })],
    );
    const res = await say({ text: 'leak' });
    expect(res.body.toolCalls[0].success).toBe(false);
    expect(res.body.toolCalls[0].explanation).toMatch(/location/);
    expect(ticketCount()).toBe(3);
  });

  it('cannot touch another resident’s ticket, and does not log on it', async () => {
    model.queue(
      [use('route_to_manager', { ticketId: 'RES-101', reason: 'escalate please' })],
      [reply({ message: 'I could not find that request.', intent: 'info' })],
    );
    const res = await say({ text: 'escalate RES-101' }, 'alex');
    expect(res.body.toolCalls[0]).toMatchObject({ success: false, ticketId: null });
    expect(eventTypes(db, 'RES-101')).not.toContain('escalated');
    expect((await request(app).get('/api/residents/mina/tickets/RES-101/tool-outcomes')).body).toEqual([]);
  });

  it('treats an unknown tool, such as a resolve attempt, as a failure', async () => {
    model.queue(
      [use('resolve_ticket', { ticketId: 'RES-101' })],
      [reply({ message: 'Only you can confirm the repair, using the buttons on RES-101.', intent: 'info' })],
    );
    const res = await say({ text: 'it works now, close it' });
    expect(res.body.toolCalls[0]).toMatchObject({ name: 'resolve_ticket', success: false });
    expect((await request(app).get('/api/residents/mina/tickets/RES-101')).body.status).toBe('awaiting resident confirmation');
  });

  it('shows a plain-text answer when the model skips the reply tool', async () => {
    model.queue([{ type: 'text', text: 'Hello, how can I help?' }]);
    const res = await say({ text: 'hi' });
    expect(res.body.reply).toMatchObject({ message: 'Hello, how can I help?', intent: 'info' });
  });

  it('gives up cleanly if the model never replies', async () => {
    for (let i = 0; i < 8; i++) model.queue([use('get_resident_tickets', {})]);
    const res = await say({ text: 'faucet' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_INCOMPLETE');
  });
});

describe('AI outages', () => {
  it('returns a recoverable error, keeps data, and the same chat works on retry', async () => {
    model.queue(new AiUnavailableError('network down'));
    const failed = await say({ text: 'The dishwasher is full of water.' });
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe('AI_UNAVAILABLE');
    expect(ticketCount()).toBe(3);

    model.queue([reply({ message: 'Is it the kitchen dishwasher?', intent: 'clarify', missing: ['where'] })]);
    const retry = await say({ conversationId: failed.body.conversationId, text: 'The dishwasher is full of water.' });
    expect(retry.status).toBe(200);
    expect(retry.body.conversationId).toBe(failed.body.conversationId);
    // The failed attempt is not replayed, so the model sees the message once.
    expect(model.requests[1].messages).toHaveLength(1);
  });

  it('keeps a ticket that was saved before the model went down, and says so', async () => {
    model.queue(
      [use('create_ticket', { title: 'Dishwasher not draining', category: 'Appliance', location: 'Kitchen', description: 'Water stays at the bottom.' })],
      new AiUnavailableError('timeout'),
    );
    const res = await say({ text: 'Dishwasher in the kitchen is not draining.' });
    expect(res.status).toBe(503);
    expect(res.body.tickets[0].id).toBe('RES-104');
    expect((await request(app).get('/api/residents/mina/tickets/RES-104')).status).toBe(200);
  });

  it('reports unavailable when no model is configured', async () => {
    const off = createApp(db, { model: null });
    expect((await request(off).get('/api/assistant/status')).body).toEqual({ available: false, model: null });
    const res = await request(off).post('/api/residents/mina/assistant/messages').send({ text: 'hi' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });
});

describe('urgent hazards', () => {
  it('detects common hazards', () => {
    expect(detectHazards('I smell gas near the stove')).toEqual(['gas smell']);
    expect(detectHazards('the outlet is sparking')).toEqual(['electrical hazard']);
    expect(detectHazards('the kitchen faucet is dripping')).toEqual([]);
  });

  it('always shows the fixed safety message and escalates even if the model forgets', async () => {
    model.queue(
      [use('create_ticket', { title: 'Gas smell in kitchen', category: 'Maintenance', location: 'Kitchen', description: 'Strong gas smell near the stove.' })],
      [reply({ message: 'Filed.', intent: 'ticket_created' })],
    );
    const res = await say({ text: 'I smell gas near the stove in the kitchen.' });
    expect(res.body.safetyNotice).toBe(URGENT_HAZARD_MESSAGE);
    expect(res.body.toolCalls.map((c: { name: string }) => c.name)).toEqual(['create_ticket', 'route_to_manager']);
    expect(res.body.tickets[0].escalated).toBe(true);
  });

  it('shows a safety message during an outage without claiming a manager was notified', async () => {
    model.queue(new AiUnavailableError('down'));
    const res = await say({ text: 'There are sparks coming from the outlet' });
    expect(res.status).toBe(503);
    expect(res.body.safetyNotice).toBe(HAZARD_NOT_ROUTED_MESSAGE);
  });

  it('does not claim escalation when no ticket was filed yet', async () => {
    model.queue([reply({ message: 'Which room is the smoke in?', intent: 'clarify', missing: ['where'] })]);
    const res = await say({ text: 'there is smoke coming out' });
    expect(res.body.safetyNotice).toBe(HAZARD_NOT_ROUTED_MESSAGE);
    expect(res.body.toolCalls).toEqual([]);
  });
});

describe('baseline', () => {
  it('only offers create_ticket and files immediately', async () => {
    model.queue(
      [use('create_ticket', { title: 'Faucet dripping', category: 'Plumbing', location: 'Unit', description: 'Faucet dripping.' })],
      [reply({ message: 'Ticket created.', intent: 'ticket_created' })],
    );
    const res = await say({ mode: 'baseline', text: 'faucet dripping' });
    expect(model.requests[0].tools.map(t => t.name)).toEqual(['create_ticket', REPLY_TOOL_NAME]);
    expect(res.body.mode).toBe('baseline');
    expect(res.body.tickets[0].id).toBe('RES-104');
  });
});

describe('demo reset', () => {
  it('starts a fresh chat after reset', async () => {
    model.queue([reply({ message: 'Where?', intent: 'clarify' })]);
    const first = await say({ text: 'drip' });
    await request(app).post('/api/demo/reset');
    model.queue([reply({ message: 'Hi', intent: 'info' })]);
    const after = await say({ conversationId: first.body.conversationId, text: 'hi' });
    expect(after.body.conversationId).not.toBe(first.body.conversationId);
  });
});

it('has six action tools, matching the plan', () => {
  expect(ACTION_TOOLS).toHaveLength(6);
  expect(model.remaining).toBe(0);
});
