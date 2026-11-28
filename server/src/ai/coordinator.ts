// Runs one chat turn: resident message in, model and tool calls, one structured reply out.
// Human decisions (duplicate yes/no) come from interface buttons and are never inferred by the model.
import type { DB } from '../db/connection.ts';
import { getResident } from '../db/people.ts';
import { WorkflowError } from '../workflow/errors.ts';
import { URGENT_HAZARD_MESSAGE } from '../workflow/followups.service.ts';
import { isTerminal } from '../workflow/status.ts';
import { getResidentTicket, type TicketView } from '../workflow/tickets.service.ts';
import { trimHistory, type AssistantMode, type Conversation, type ConversationStore } from './conversations.ts';
import { HAZARD_NOT_ROUTED_MESSAGE, detectHazards } from './hazards.ts';
import type { AssistantBlock, ChatTurn, ModelClient, UserBlock } from './model.ts';
import {
  BASELINE_PROMPT, COORDINATOR_PROMPT, REPLY_TOOL_DESCRIPTION, REPLY_TOOL_NAME, replySchema, type ModelReply, type ReplyIntent,
} from './prompts.ts';
import {
  ACTION_TOOLS, BASELINE_TOOLS, TOOL_NAMES, executeTool, toToolSpec, type AiTool, type ToolCallRecord, type ToolContext,
} from './tools.ts';

export const MAX_MODEL_CALLS = 8;

export type Decision = { type: 'confirm_duplicate' | 'reject_duplicate'; ticketId: string };

export interface TurnInput {
  conversationId?: string;
  mode?: AssistantMode;
  text?: string;
  decision?: Decision;
}

export interface TurnResult {
  conversationId: string;
  mode: AssistantMode;
  model: string;
  reply: { message: string; intent: ReplyIntent; missing: ('what' | 'where')[] };
  proposedDuplicate: { ticketId: string; title: string; status: string; location: string } | null;
  safetyNotice: string | null;
  hazards: string[];
  // Tickets created, linked or escalated this turn, in their saved state.
  tickets: TicketView[];
  toolCalls: ToolCallRecord[];
}

export type AssistantErrorCode = 'AI_UNAVAILABLE' | 'AI_INCOMPLETE' | 'BUSY' | 'INVALID_DECISION' | 'INVALID_INPUT';

// Partial carries what already happened this turn, so the interface can show saved work after a failure.
export class AssistantError extends Error {
  constructor(
    readonly code: AssistantErrorCode,
    message: string,
    readonly partial: Pick<TurnResult, 'conversationId' | 'safetyNotice' | 'hazards' | 'tickets' | 'toolCalls'> | null = null,
  ) {
    super(message);
    this.name = 'AssistantError';
  }
}

const UNAVAILABLE_MESSAGE =
  'The assistant is unavailable right now. Your saved requests are unchanged. Please try again in a moment.';

interface TurnState {
  ctx: ToolContext;
  tools: AiTool[];
  toolCalls: ToolCallRecord[];
  tickets: Map<string, TicketView>;
}

function runTool(state: TurnState, name: string, args: unknown) {
  const exec = executeTool(state.ctx, state.tools, name, args);
  state.toolCalls.push(exec.record);
  if (exec.ticket) state.tickets.set(exec.ticket.id, exec.ticket);
  return exec;
}

function openTicket(db: DB, residentId: string, id: string): TicketView | null {
  try {
    const t = getResidentTicket(db, residentId, id);
    return isTerminal(t.status) ? null : t;
  } catch {
    return null;
  }
}

// Checks the model's structured reply. Returns an error string to send back to the model, or the reply.
function checkReply(db: DB, convo: Conversation, raw: unknown): { reply: ModelReply } | { error: string } {
  const parsed = replySchema.safeParse(raw ?? {});
  if (!parsed.success) return { error: `Invalid reply: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  const reply = parsed.data;
  if (reply.intent === 'propose_duplicate') {
    const id = reply.proposedDuplicateTicketId;
    if (!id) return { error: 'intent "propose_duplicate" needs proposedDuplicateTicketId.' };
    if (convo.rejectedDuplicateIds.has(id)) return { error: `The resident already said this is not the same issue as ${id}.` };
    if (!openTicket(db, convo.residentId, id)) return { error: `${id} is not one of this resident's open requests.` };
  }
  return { reply };
}

function contextNote(db: DB, convo: Conversation, hazards: string[]): string {
  const resident = getResident(db, convo.residentId)!;
  const lines = [`Resident: ${resident.name}, unit ${resident.unit}.`];
  if (convo.mode === 'coordinator') {
    lines.push(`Filed in this chat: ${convo.createdTicketIds.join(', ') || 'none'}. Linked in this chat: ${convo.linkedTicketIds.join(', ') || 'none'}.`);
    lines.push(`Waiting for the resident's yes/no on a duplicate: ${convo.pendingDuplicate?.ticketId ?? 'none'}.`);
  }
  lines.push(`Urgent hazard check: ${hazards.length ? hazards.join(', ') : 'none'}.`);
  return `[App context, not written by the resident]\n${lines.join('\n')}`;
}

export async function runTurn(db: DB, model: ModelClient | null, store: ConversationStore, residentId: string, input: TurnInput): Promise<TurnResult> {
  if (!getResident(db, residentId)) throw new WorkflowError('NOT_FOUND', `Resident ${residentId} not found.`);
  const mode: AssistantMode = input.mode ?? 'coordinator';
  const typed = input.text?.trim() ?? '';
  if (!typed && !input.decision) throw new AssistantError('INVALID_INPUT', 'Send a message or a decision.');
  if (typed.length > 2000) throw new AssistantError('INVALID_INPUT', 'Messages can be at most 2000 characters.');

  const convo = store.getOrCreate(residentId, input.conversationId, mode);
  if (convo.busy) throw new AssistantError('BUSY', 'The assistant is still answering your last message.');

  // Resident decisions come only from the buttons, and only for the ticket the assistant actually proposed.
  let residentText = typed;
  let reportText = typed;
  const decision = input.decision;
  if (decision) {
    if (mode !== 'coordinator') throw new AssistantError('INVALID_DECISION', 'The baseline assistant does not propose duplicates.');
    const pending = convo.pendingDuplicate;
    if (!pending || pending.ticketId !== decision.ticketId)
      throw new AssistantError('INVALID_DECISION', `There is no open duplicate question about ${decision.ticketId}.`);
    reportText = pending.reportText;
    if (decision.type === 'confirm_duplicate') {
      convo.confirmedDuplicate = pending;
      residentText = `[Resident pressed "Yes, same issue" for ${pending.ticketId}. Their report: "${pending.reportText}"]`;
    } else {
      convo.pendingDuplicate = null;
      convo.rejectedDuplicateIds.add(pending.ticketId);
      residentText = `[Resident pressed "No, different issue" for ${pending.ticketId}. Their report: "${pending.reportText}"]`;
    }
    if (typed) residentText += `\n${typed}`;
  }

  const hazards = detectHazards(`${reportText}\n${typed}`);
  const state: TurnState = {
    ctx: { db, residentId, conversation: convo },
    tools: mode === 'coordinator' ? ACTION_TOOLS : BASELINE_TOOLS,
    toolCalls: [],
    tickets: new Map(),
  };
  const urgentRouted = () =>
    state.toolCalls.some(c => c.name === TOOL_NAMES.routeToManager && c.success && (c.args as { urgent?: boolean }).urgent === true);
  const safetyNotice = () => (urgentRouted() ? URGENT_HAZARD_MESSAGE : hazards.length ? HAZARD_NOT_ROUTED_MESSAGE : null);
  const partial = () => ({
    conversationId: convo.id,
    safetyNotice: safetyNotice(),
    hazards,
    tickets: [...state.tickets.values()],
    toolCalls: state.toolCalls,
  });

  if (!model) {
    convo.confirmedDuplicate = null;
    throw new AssistantError('AI_UNAVAILABLE', UNAVAILABLE_MESSAGE, partial());
  }

  convo.busy = true;
  try {
    const system = mode === 'coordinator' ? COORDINATOR_PROMPT : BASELINE_PROMPT;
    const tools = [...state.tools.map(toToolSpec), toToolSpec({ name: REPLY_TOOL_NAME, description: REPLY_TOOL_DESCRIPTION, schema: replySchema })];
    const messages: ChatTurn[] = trimHistory([
      ...convo.history,
      { role: 'user', content: [{ type: 'text', text: `${contextNote(db, convo, hazards)}\n\n${residentText}` }] },
    ]);

    let reply: ModelReply | null = null;
    for (let call = 0; call < MAX_MODEL_CALLS && !reply; call++) {
      let content: AssistantBlock[];
      try {
        content = (await model.complete({ system, tools, messages })).content;
      } catch (err) {
        console.error('Model call failed', err);
        throw new AssistantError('AI_UNAVAILABLE', UNAVAILABLE_MESSAGE, partial());
      }
      messages.push({ role: 'assistant', content });

      const uses = content.filter((b): b is Extract<AssistantBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      if (uses.length === 0) {
        // The model answered in plain text without the reply tool. Show the text, never hidden reasoning.
        const text = content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n').trim();
        if (text) reply = { message: text.slice(0, 800), intent: 'info' };
        break;
      }

      const results: UserBlock[] = [];
      let actionFailed = false;
      for (const use of uses) {
        if (use.name === REPLY_TOOL_NAME) {
          const checked = checkReply(db, convo, use.input);
          if ('reply' in checked) {
            reply = checked.reply;
            results.push({ type: 'tool_result', tool_use_id: use.id, content: '{"ok":true}' });
          } else {
            results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify({ ok: false, error: checked.error }), is_error: true });
          }
        } else {
          const exec = runTool(state, use.name, use.input);
          if (!exec.record.success) actionFailed = true;
          results.push({ type: 'tool_result', tool_use_id: use.id, content: exec.modelContent, is_error: !exec.record.success });
        }
      }
      messages.push({ role: 'user', content: results });
      // A reply sent in the same batch as a failed call was written before the model saw the failure,
      // so it may claim success. Drop it and let the model answer again with the failure in view.
      if (reply && actionFailed) reply = null;
    }

    // Safety nets. The resident's confirmed decision and urgent hazards must not depend on the model following instructions.
    if (mode === 'coordinator' && convo.confirmedDuplicate) {
      const linked = runTool(state, TOOL_NAMES.linkConfirmedDuplicate, { ticketId: convo.confirmedDuplicate.ticketId, reportText: convo.confirmedDuplicate.reportText });
      if (linked.record.success)
        reply = { message: `Thanks. I added this to your existing request ${linked.record.ticketId} instead of opening a new one.`, intent: 'duplicate_linked' };
    }
    if (mode === 'coordinator' && hazards.length) {
      const target = [...state.tickets.values()].find(t => !isTerminal(t.status) && convo.createdTicketIds.includes(t.id));
      if (!urgentRouted() && target)
        runTool(state, TOOL_NAMES.routeToManager, { ticketId: target.id, urgent: true, reason: `Possible urgent hazard: ${hazards.join(', ')}.` });
    }

    if (!reply) throw new AssistantError('AI_INCOMPLETE', "The assistant couldn't finish that. Anything already saved stays saved. Please try again.", partial());

    if (reply.intent === 'propose_duplicate' && reply.proposedDuplicateTicketId)
      convo.pendingDuplicate = { ticketId: reply.proposedDuplicateTicketId, reportText: reportText || typed };

    const pending = convo.pendingDuplicate ? openTicket(db, residentId, convo.pendingDuplicate.ticketId) : null;
    if (convo.pendingDuplicate && !pending) convo.pendingDuplicate = null;

    // Refresh tickets so the interface gets their final saved state for this turn.
    const tickets = [...state.tickets.keys()].map(id => getResidentTicket(db, residentId, id));

    convo.history = trimHistory([
      ...convo.history,
      { role: 'user', content: [{ type: 'text', text: residentText }] },
      { role: 'assistant', content: [{ type: 'text', text: reply.message }] },
    ]);

    return {
      conversationId: convo.id,
      mode,
      model: model.name,
      reply: { message: reply.message, intent: reply.intent, missing: reply.missing ?? [] },
      proposedDuplicate: pending ? { ticketId: pending.id, title: pending.title, status: pending.status, location: pending.location } : null,
      safetyNotice: safetyNotice(),
      hazards,
      tickets,
      toolCalls: state.toolCalls,
    };
  } finally {
    convo.confirmedDuplicate = null;
    convo.busy = false;
  }
}
