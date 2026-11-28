// The AI's tools. Each one validates its arguments with Zod, then calls Dev 2's workflow services,
// which validate again and enforce resident scope and status transitions. No tool can resolve a ticket.
import { z } from 'zod';
import type { DB } from '../db/connection.ts';
import { WorkflowError } from '../workflow/errors.ts';
import { isTerminal } from '../workflow/status.ts';
import { createTicket, getResidentTicket, linkDuplicate, listTicketsForResidentView, type TicketView } from '../workflow/tickets.service.ts';
import { recordToolOutcome, routeToManager, scheduleFollowUp, sendSimulatedFollowUp } from '../workflow/followups.service.ts';
import type { Conversation } from './conversations.ts';
import type { ToolSpec } from './model.ts';
import { similarity, tokens } from './similarity.ts';

export const AI_ACTOR = { type: 'ai', id: 'resolve-assistant' } as const;

export const CATEGORIES = ['Plumbing', 'Appliance', 'Carpentry', 'Maintenance'] as const;

export interface ToolContext {
  db: DB;
  residentId: string;
  conversation: Conversation;
}

export interface ToolSuccess {
  result: unknown;
  explanation: string;
  ticket?: TicketView;
}

export interface AiTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run(ctx: ToolContext, args: z.infer<S>): ToolSuccess;
}

// What the resident and the staff log see for each call.
export interface ToolCallRecord {
  name: string;
  args: unknown;
  success: boolean;
  explanation: string;
  ticketId: string | null;
}

// Returned to the model as the tool_result.
export interface ToolExecution {
  record: ToolCallRecord;
  modelContent: string;
  ticket?: TicketView;
}

const ticketId = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be a ticket ID like RES-101');

function summary(t: TicketView) {
  return { id: t.id, title: t.title, category: t.category, location: t.location, description: t.description, status: t.status, updatedAt: t.updatedAt };
}

function defineTool<S extends z.ZodType>(tool: AiTool<S>): AiTool<S> {
  return tool;
}

const getResidentTickets = defineTool({
  name: 'get_resident_tickets',
  description:
    "List the current resident's maintenance requests. Pass `query` with the new issue's words to rank open requests by similarity, "
    + 'so you can check for a likely duplicate before creating a ticket. Only this resident\'s requests are returned.',
  schema: z.object({
    query: z.string().trim().max(500).optional().describe('Words describing the new issue, used to rank similar open requests'),
    includeClosed: z.boolean().optional().describe('Also return resolved and cancelled requests. Default false.'),
  }),
  run(ctx, args) {
    const all = listTicketsForResidentView(ctx.db, ctx.residentId);
    const visible = args.includeClosed ? all : all.filter(t => !isTerminal(t.status));
    const ranked = visible
      .map(t => ({ ...summary(t), similarity: args.query ? similarity(args.query, `${t.title} ${t.description} ${t.location} ${t.category}`) : undefined }))
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
    const top = ranked[0];
    const explanation = ranked.length === 0
      ? 'No open requests found for this resident.'
      : args.query && top?.similarity
        ? `Found ${ranked.length} request(s). Closest match: ${top.id} (${top.title}).`
        : `Found ${ranked.length} request(s).`;
    return { result: { tickets: ranked, alreadyRejectedAsDuplicate: [...ctx.conversation.rejectedDuplicateIds] }, explanation };
  },
});

const normalized = (s: string) => [...tokens(s)].sort().join(' ');

const createTicketTool = defineTool({
  name: 'create_ticket',
  description:
    'Create a new maintenance request for the current resident. Call only when you know what is wrong and where, '
    + 'and only after checking get_resident_tickets for a likely duplicate. Create one ticket per separate issue.',
  schema: z.object({
    title: z.string().trim().min(3).max(120).describe('Short summary, e.g. "Kitchen faucet dripping"'),
    category: z.enum(CATEGORIES).describe('Plumbing, Appliance, Carpentry, or Maintenance for anything else'),
    location: z.string().trim().min(2).max(200).describe('Where in the unit, e.g. "Kitchen sink"'),
    description: z.string().trim().min(3).max(2000).describe("The problem in the resident's words, with the details they gave"),
  }),
  run(ctx, args) {
    const convo = ctx.conversation;
    if (convo.pendingDuplicate)
      throw new WorkflowError('INVALID_TRANSITION',
        `Waiting for the resident to say whether this is the same issue as ${convo.pendingDuplicate.ticketId}. Do not create a ticket yet.`);
    const key = normalized(`${args.title} ${args.description}`);
    for (const id of convo.createdTicketIds) {
      const prior = getResidentTicket(ctx.db, ctx.residentId, id);
      if (normalized(`${prior.title} ${prior.description}`) === key)
        throw new WorkflowError('INVALID_TRANSITION', `This issue was already filed in this chat as ${id}.`);
    }
    const ticket = createTicket(ctx.db, ctx.residentId, args, AI_ACTOR);
    convo.createdTicketIds.push(ticket.id);
    return { result: summary(ticket), explanation: `Created ${ticket.id}: ${ticket.title} (${ticket.location}).`, ticket };
  },
});

const linkConfirmedDuplicate = defineTool({
  name: 'link_confirmed_duplicate',
  description:
    'Attach the resident\'s repeated report to an existing open request instead of creating a new one. '
    + 'Works ONLY after the resident has pressed "Yes, same issue" for that exact ticket. Never call it on your own guess.',
  schema: z.object({
    ticketId: ticketId.describe('The existing request the resident confirmed'),
    reportText: z.string().trim().min(1).max(2000).describe("The resident's repeated report, in their words"),
  }),
  run(ctx, args) {
    const confirmed = ctx.conversation.confirmedDuplicate;
    if (!confirmed || confirmed.ticketId !== args.ticketId)
      throw new WorkflowError('FORBIDDEN', `The resident has not confirmed that this report belongs to ${args.ticketId}.`);
    const ticket = linkDuplicate(ctx.db, args.ticketId, ctx.residentId, confirmed.reportText || args.reportText);
    ctx.conversation.confirmedDuplicate = null;
    ctx.conversation.pendingDuplicate = null;
    ctx.conversation.linkedTicketIds.push(ticket.id);
    return { result: summary(ticket), explanation: `Linked the repeated report to ${ticket.id} after resident confirmation.`, ticket };
  },
});

const scheduleFollowUpTool = defineTool({
  name: 'schedule_follow_up',
  description:
    'Schedule a follow-up on the shared demo clock. `reminder` messages the resident when due; `escalate` puts the ticket in the manager queue when due. '
    + 'Standard follow-ups are already scheduled automatically by status, so use this only for something extra the resident asked for.',
  schema: z.object({
    ticketId,
    hoursFromNow: z.number().positive().max(720),
    action: z.enum(['reminder', 'escalate']),
    reason: z.string().trim().min(1).max(500),
  }),
  run(ctx, { ticketId: id, ...input }) {
    const ticket = scheduleFollowUp(ctx.db, id, ctx.residentId, input, AI_ACTOR);
    return { result: { id: ticket.id, nextFollowUpAt: ticket.nextFollowUpAt }, explanation: `Scheduled a ${input.action} on ${id} in ${input.hoursFromNow}h.`, ticket };
  },
});

const sendFollowUpTool = defineTool({
  name: 'send_simulated_follow_up',
  description: 'Send the resident a simulated follow-up message about one of their open requests. Nothing real is sent.',
  schema: z.object({ ticketId, text: z.string().trim().min(1).max(1000) }),
  run(ctx, { ticketId: id, text }) {
    const ticket = sendSimulatedFollowUp(ctx.db, id, ctx.residentId, { text }, AI_ACTOR);
    return { result: { id: ticket.id }, explanation: `Sent a simulated follow-up on ${id}.`, ticket };
  },
});

const routeToManagerTool = defineTool({
  name: 'route_to_manager',
  description:
    'Escalate an open request to the simulated manager queue. Set `urgent: true` for possible hazards (gas, fire, smoke, sparks, flooding). '
    + 'Urgent escalations show the resident a fixed safety message; your `reason` is only seen by staff.',
  schema: z.object({
    ticketId,
    reason: z.string().trim().min(1).max(500),
    urgent: z.boolean().optional(),
  }),
  run(ctx, { ticketId: id, ...input }) {
    const ticket = routeToManager(ctx.db, id, ctx.residentId, input, AI_ACTOR);
    return { result: { id: ticket.id, escalated: ticket.escalated, urgent: !!input.urgent }, explanation: `Routed ${id} to the manager${input.urgent ? ' as urgent' : ''}.`, ticket };
  },
});

export const ACTION_TOOLS: AiTool[] = [
  getResidentTickets, createTicketTool, linkConfirmedDuplicate, scheduleFollowUpTool, sendFollowUpTool, routeToManagerTool,
] as AiTool[];

export const BASELINE_TOOLS: AiTool[] = [createTicketTool] as AiTool[];

export const TOOL_NAMES = {
  getResidentTickets: getResidentTickets.name,
  createTicket: createTicketTool.name,
  linkConfirmedDuplicate: linkConfirmedDuplicate.name,
  scheduleFollowUp: scheduleFollowUpTool.name,
  sendFollowUp: sendFollowUpTool.name,
  routeToManager: routeToManagerTool.name,
} as const;

export function toToolSpec(tool: { name: string; description: string; schema: z.ZodType }): ToolSpec {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.schema) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, input_schema: { ...schema, type: 'object' } };
}

function issuesText(error: z.ZodError): string {
  return error.issues.map(i => (i.path.length ? `${i.path.join('.')}: ` : '') + i.message).join('; ');
}

// The ticket a call is about, if it belongs to this resident. Used to attach the outcome to the ticket's log
// without ever attaching it to another resident's ticket.
function ownTicketId(ctx: ToolContext, args: unknown, success?: ToolSuccess): string | null {
  if (success?.ticket) return success.ticket.id;
  const id = (args as { ticketId?: unknown } | null)?.ticketId;
  if (typeof id !== 'string') return null;
  try {
    return getResidentTicket(ctx.db, ctx.residentId, id).id;
  } catch {
    return null;
  }
}

// Runs one tool call. Never throws: every failure comes back as success=false, so a failure can't look like a success.
export function executeTool(ctx: ToolContext, tools: AiTool[], name: string, rawArgs: unknown): ToolExecution {
  const tool = tools.find(t => t.name === name);
  let record: ToolCallRecord;
  let success: ToolSuccess | undefined;
  let failure: { code: string; message: string } | undefined;

  if (!tool) {
    failure = { code: 'UNKNOWN_TOOL', message: `There is no tool named ${name}.` };
  } else {
    const parsed = tool.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      failure = { code: 'INVALID_INPUT', message: `Invalid arguments: ${issuesText(parsed.error)}` };
    } else {
      try {
        success = tool.run(ctx, parsed.data);
      } catch (err) {
        if (err instanceof WorkflowError) failure = { code: err.code, message: err.message };
        else {
          console.error(`AI tool ${name} failed`, err);
          failure = { code: 'INTERNAL', message: 'The tool failed unexpectedly. Nothing was changed by this call.' };
        }
      }
    }
  }

  const parsedArgs = rawArgs ?? {};
  record = {
    name,
    args: parsedArgs,
    success: !!success,
    explanation: success ? success.explanation : `Failed: ${failure!.message}`,
    ticketId: ownTicketId(ctx, parsedArgs, success),
  };

  try {
    recordToolOutcome(ctx.db, { ticketId: record.ticketId ?? undefined, name, args: parsedArgs, success: record.success, explanation: record.explanation });
  } catch (err) {
    console.error('Could not record tool outcome', err);
  }

  const modelContent = JSON.stringify(success ? { ok: true, result: success.result } : { ok: false, error: failure });
  return { record, modelContent, ticket: success?.ticket };
}
