// Follow-ups, reminders, manager escalation, and the AI tool services built on them.
// Nothing in this file can change a ticket's status, and in particular nothing here can resolve one.
import { z } from 'zod';
import { transaction, type DB } from '../db/connection.ts';
import { addHours, getNow } from '../db/clock.ts';
import { getResident } from '../db/people.ts';
import { getTicket, listAllTickets, type TicketRecord } from '../db/tickets.ts';
import { appendEvent, type ActorType } from './events.ts';
import { WorkflowError, parseInput } from './errors.ts';
import { requireOpen, requireResidentTicket } from './scope.ts';
import { isTerminal } from './status.ts';
import type { ActionType } from './transitions.ts';
import { toView, type StaffTicketView, type TicketView } from './view.ts';

// Fixed text for urgent hazards. Never replaced by model output.
export const URGENT_HAZARD_MESSAGE =
  'This may be an urgent hazard. A manager has been notified. If there is immediate danger, leave the area and call 911.';
export const MANAGER_REVIEW_MESSAGE = 'A manager has been asked to review this request.';

type RecipientType = 'resident' | 'staff' | 'manager';
type FollowUpAction = 'reminder' | 'escalate';
interface Source { type: ActorType; id: string }

// Scheduled automatically when a ticket enters a status via these actions.
export const FOLLOW_UP_RULES: Partial<Record<ActionType, readonly {
  key: string; hours: number; action: FollowUpAction; recipient: 'technician' | 'resident' | 'manager'; message: string;
}[]>> = {
  assign: [
    { key: 'assign-reminder', hours: 24, action: 'reminder', recipient: 'technician', message: 'No update logged' },
    { key: 'assign-escalate', hours: 48, action: 'escalate', recipient: 'manager', message: 'No update logged within 48 hours of assignment' },
  ],
  request_confirmation: [
    { key: 'confirm-reminder', hours: 24, action: 'reminder', recipient: 'resident', message: 'Please confirm whether the repair worked' },
    { key: 'confirm-escalate', hours: 72, action: 'escalate', recipient: 'manager', message: 'Resident has not confirmed the repair within 72 hours' },
  ],
};

const SCHEDULER: Source = { type: 'system', id: 'follow-up-scheduler' };
const PROCESSOR: Source = { type: 'system', id: 'follow-up-processor' };

const sentence = (s: string) => /[.!?]$/.test(s) ? s : `${s}.`;

interface FollowUpRow {
  id: number; ticket_id: string; due_key: string; due_at: string; action: FollowUpAction;
  recipient_type: RecipientType | null; recipient_id: string | null; message: string | null;
}

function insertFollowUp(db: DB, f: {
  ticketId: string; dueKey: string; dueAt: string; action: FollowUpAction; recipientType: RecipientType;
  recipientId: string | null; message: string; sourceEventId: number; createdBy: Source; createdAt: string;
}): void {
  // UNIQUE (ticket_id, due_key): the same cycle can never be scheduled twice.
  db.prepare(
    `INSERT INTO follow_ups (ticket_id, due_key, due_at, action, recipient_type, recipient_id, message, source_event_id, created_by_type, created_by_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (ticket_id, due_key) DO NOTHING`,
  ).run(f.ticketId, f.dueKey, f.dueAt, f.action, f.recipientType, f.recipientId, f.message, f.sourceEventId, f.createdBy.type, f.createdBy.id, f.createdAt);
}

function insertMessage(db: DB, m: {
  ticket: TicketRecord; role: 'assistant' | 'system'; text: string; at: string;
  recipientType: 'resident' | 'staff'; recipientId: string; followUpId?: number;
}): void {
  db.prepare(
    `INSERT INTO messages (ticket_id, resident_id, role, text, at, recipient_type, recipient_id, follow_up_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(m.ticket.id, m.ticket.residentId, m.role, m.text, m.at, m.recipientType, m.recipientId, m.followUpId ?? null);
}

// tickets.next_follow_up_at = earliest pending due_at, or null.
export function syncNextFollowUp(db: DB, ticketId: string): void {
  db.prepare(
    `UPDATE tickets SET next_follow_up_at = (
       SELECT MIN(due_at) FROM follow_ups WHERE ticket_id = ? AND processed_at IS NULL AND superseded_at IS NULL
     ) WHERE id = ?`,
  ).run(ticketId, ticketId);
}

// Called by applyAction, inside its transaction, whenever a ticket's status changes.
// Supersedes the old cycle, marks fired reminders as answered, and schedules the new cycle.
export function onStatusChange(db: DB, ticket: TicketRecord, at: string, trigger: { action: ActionType; eventId: number }): void {
  db.prepare('UPDATE follow_ups SET superseded_at = ? WHERE ticket_id = ? AND processed_at IS NULL AND superseded_at IS NULL')
    .run(at, ticket.id);
  db.prepare("UPDATE follow_ups SET answered_at = ? WHERE ticket_id = ? AND action = 'reminder' AND processed_at IS NOT NULL AND answered_at IS NULL")
    .run(at, ticket.id);
  if (!isTerminal(ticket.status)) {
    for (const r of FOLLOW_UP_RULES[trigger.action] ?? []) {
      insertFollowUp(db, {
        ticketId: ticket.id, dueKey: `${r.key}:${trigger.eventId}`, dueAt: addHours(at, r.hours), action: r.action,
        recipientType: r.recipient === 'technician' ? 'staff' : r.recipient,
        recipientId: r.recipient === 'technician' ? ticket.assigneeId : r.recipient === 'resident' ? ticket.residentId : null,
        message: r.message, sourceEventId: trigger.eventId, createdBy: SCHEDULER, createdAt: at,
      });
    }
  }
  syncNextFollowUp(db, ticket.id);
}

// ---- Processor ----

export interface ProcessedFollowUp {
  followUpId: number;
  ticketId: string;
  dueKey: string;
  dueAt: string;
  action: FollowUpAction;
  recipientType: RecipientType | null;
  recipientId: string | null;
  recipientName: string | null;
  text: string;
}

function recipientName(db: DB, type: RecipientType | null, id: string | null): string | null {
  if (type === 'manager') return 'Manager queue';
  if (!id) return null;
  if (type === 'resident') return getResident(db, id)?.name ?? id;
  return (db.prepare('SELECT name FROM staff WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? id;
}

function fire(db: DB, ticket: TicketRecord, f: FollowUpRow): ProcessedFollowUp {
  const name = recipientName(db, f.recipient_type, f.recipient_id);
  const message = sentence(f.message ?? 'Follow-up due');
  const base = { ticketId: ticket.id, at: f.due_at, kind: 'system' as const, actorType: PROCESSOR.type, actorId: PROCESSOR.id };
  let text: string;
  if (f.action === 'reminder') {
    const who = f.recipient_type === 'staff' ? `${name} (technician)` : name;
    text = `Reminder sent to ${who}: ${message}`;
    appendEvent(db, { ...base, type: 'follow_up_sent', text, data: { followUpId: f.id, dueKey: f.due_key } });
    if (f.recipient_id && (f.recipient_type === 'resident' || f.recipient_type === 'staff'))
      insertMessage(db, {
        ticket, role: 'system', at: f.due_at, recipientType: f.recipient_type, recipientId: f.recipient_id, followUpId: f.id,
        text: f.recipient_type === 'staff' ? `${ticket.id} "${ticket.title}": ${message}` : message,
      });
  } else {
    text = `Escalated to a manager: ${message}`;
    db.prepare('UPDATE tickets SET escalated_at = COALESCE(escalated_at, ?) WHERE id = ?').run(f.due_at, ticket.id);
    appendEvent(db, { ...base, type: 'escalated', text, data: { followUpId: f.id, dueKey: f.due_key } });
  }
  return {
    followUpId: f.id, ticketId: ticket.id, dueKey: f.due_key, dueAt: f.due_at, action: f.action,
    recipientType: f.recipient_type, recipientId: f.recipient_id, recipientName: name, text,
  };
}

// Fires every follow-up that is due on the simulated clock. Safe to call any number of times:
// each row is claimed with a guarded UPDATE (processed_at set FIRST) before its effect runs,
// so a second run, timer tick or connection finds nothing left to claim.
export function processDueFollowUps(db: DB): ProcessedFollowUp[] {
  return transaction(db, () => {
    const now = getNow(db);
    const due = db.prepare(
      'SELECT * FROM follow_ups WHERE due_at <= ? AND processed_at IS NULL AND superseded_at IS NULL ORDER BY due_at, id',
    ).all(now) as unknown as FollowUpRow[];
    const claim = db.prepare('UPDATE follow_ups SET processed_at = ? WHERE id = ? AND processed_at IS NULL AND superseded_at IS NULL');
    const processed: ProcessedFollowUp[] = [];
    const touched = new Set<string>();
    for (const f of due) {
      touched.add(f.ticket_id);
      const ticket = getTicket(db, f.ticket_id)!;
      // Defensive: closed tickets never get follow-ups, even if one slipped through.
      if (isTerminal(ticket.status)) {
        db.prepare('UPDATE follow_ups SET superseded_at = ? WHERE id = ? AND processed_at IS NULL').run(now, f.id);
        continue;
      }
      if (claim.run(now, f.id).changes !== 1) continue;
      processed.push(fire(db, ticket, f));
    }
    for (const id of touched) syncNextFollowUp(db, id);
    return processed;
  });
}

// ---- Services for Dev 3's AI tools (same validation and scoping as HTTP) ----

const sourceSchema = z.object({ type: z.enum(['ai', 'system']), id: z.string().trim().min(1).max(64) });
export type ToolSource = z.infer<typeof sourceSchema>;
const DEFAULT_SOURCE: ToolSource = { type: 'ai', id: 'assistant' };

export const scheduleFollowUpInput = z.object({
  hoursFromNow: z.number().positive().max(24 * 30),
  action: z.enum(['reminder', 'escalate']),
  reason: z.string().trim().min(1).max(500),
});

// Reminders go to the resident; escalations go to the manager queue when due.
export function scheduleFollowUp(
  db: DB, ticketId: string, residentId: string, input: z.input<typeof scheduleFollowUpInput>, source: ToolSource = DEFAULT_SOURCE,
): TicketView {
  const data = parseInput(scheduleFollowUpInput, input, 'follow-up');
  const src = parseInput(sourceSchema, source, 'source');
  return transaction(db, () => {
    const ticket = requireResidentTicket(db, ticketId, residentId);
    requireOpen(ticket, 'follow-ups cannot be scheduled');
    const at = getNow(db);
    const dueAt = addHours(at, data.hoursFromNow);
    const eventId = appendEvent(db, {
      ticketId, at, kind: 'system', actorType: src.type, actorId: src.id, type: 'follow_up_scheduled',
      text: data.action === 'reminder' ? `Follow-up reminder scheduled for ${dueAt}.` : `Manager review scheduled for ${dueAt}.`,
      data: { action: data.action, dueAt, reason: data.reason },
    });
    insertFollowUp(db, {
      ticketId, dueKey: `${src.type}-${data.action}:${eventId}`, dueAt, action: data.action,
      recipientType: data.action === 'reminder' ? 'resident' : 'manager', recipientId: data.action === 'reminder' ? residentId : null,
      message: data.reason, sourceEventId: eventId, createdBy: src, createdAt: at,
    });
    syncNextFollowUp(db, ticketId);
    return toView(db, getTicket(db, ticketId)!);
  });
}

export const simulatedFollowUpInput = z.object({ text: z.string().trim().min(1).max(1000) });

export function sendSimulatedFollowUp(
  db: DB, ticketId: string, residentId: string, input: z.input<typeof simulatedFollowUpInput>, source: ToolSource = DEFAULT_SOURCE,
): TicketView {
  const { text } = parseInput(simulatedFollowUpInput, input, 'follow-up');
  const src = parseInput(sourceSchema, source, 'source');
  return transaction(db, () => {
    const ticket = requireResidentTicket(db, ticketId, residentId);
    requireOpen(ticket, 'follow-ups cannot be sent');
    const at = getNow(db);
    insertMessage(db, { ticket, role: src.type === 'ai' ? 'assistant' : 'system', text, at, recipientType: 'resident', recipientId: residentId });
    appendEvent(db, {
      ticketId, at, kind: 'system', actorType: src.type, actorId: src.id, type: 'follow_up_sent',
      text: `Follow-up sent to ${getResident(db, residentId)!.name}: "${text}"`,
    });
    return toView(db, getTicket(db, ticketId)!);
  });
}

export const routeToManagerInput = z.object({
  reason: z.string().trim().min(1).max(500),
  urgent: z.boolean().optional(),
});

// The reason is staff-facing (event data). Resident-facing text is always fixed.
export function routeToManager(
  db: DB, ticketId: string, residentId: string, input: z.input<typeof routeToManagerInput>, source: ToolSource = DEFAULT_SOURCE,
): TicketView {
  const { reason, urgent = false } = parseInput(routeToManagerInput, input, 'escalation');
  const src = parseInput(sourceSchema, source, 'source');
  return transaction(db, () => {
    const ticket = requireResidentTicket(db, ticketId, residentId);
    requireOpen(ticket, 'it cannot be routed to a manager');
    const at = getNow(db);
    const text = urgent ? URGENT_HAZARD_MESSAGE : MANAGER_REVIEW_MESSAGE;
    db.prepare('UPDATE tickets SET escalated_at = COALESCE(escalated_at, ?) WHERE id = ?').run(at, ticketId);
    appendEvent(db, { ticketId, at, kind: 'system', actorType: src.type, actorId: src.id, type: 'escalated', text, data: { reason, urgent } });
    insertMessage(db, { ticket, role: src.type === 'ai' ? 'assistant' : 'system', text, at, recipientType: 'resident', recipientId: residentId });
    return toView(db, getTicket(db, ticketId)!);
  });
}

export const toolOutcomeInput = z.object({
  ticketId: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(100),
  args: z.unknown().optional(),
  success: z.boolean(),
  explanation: z.string().trim().min(1).max(2000),
});

export interface ToolOutcomeRecord {
  id: number; ticketId: string | null; name: string; args: unknown; success: boolean; explanation: string; at: string;
}

interface ToolOutcomeRow { id: number; ticket_id: string | null; name: string; args: string | null; success: number; explanation: string; at: string }

const toOutcome = (r: ToolOutcomeRow): ToolOutcomeRecord => ({
  id: r.id, ticketId: r.ticket_id, name: r.name, args: r.args === null ? null : JSON.parse(r.args),
  success: r.success === 1, explanation: r.explanation, at: r.at,
});

export function recordToolOutcome(db: DB, input: z.input<typeof toolOutcomeInput>): ToolOutcomeRecord {
  const data = parseInput(toolOutcomeInput, input, 'tool outcome');
  if (data.ticketId && !getTicket(db, data.ticketId)) throw new WorkflowError('NOT_FOUND', `Ticket ${data.ticketId} not found.`);
  const args = data.args === undefined ? null : JSON.stringify(data.args);
  const result = db.prepare('INSERT INTO tool_outcomes (ticket_id, name, args, success, explanation, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(data.ticketId ?? null, data.name, args, data.success ? 1 : 0, data.explanation, getNow(db));
  return toOutcome(db.prepare('SELECT * FROM tool_outcomes WHERE id = ?').get(result.lastInsertRowid) as unknown as ToolOutcomeRow);
}

export function getToolOutcomes(db: DB, ticketId: string): ToolOutcomeRecord[] {
  return (db.prepare('SELECT * FROM tool_outcomes WHERE ticket_id = ? ORDER BY id').all(ticketId) as unknown as ToolOutcomeRow[]).map(toOutcome);
}

export function getResidentToolOutcomes(db: DB, residentId: string, ticketId: string): ToolOutcomeRecord[] {
  requireResidentTicket(db, ticketId, residentId);
  return getToolOutcomes(db, ticketId);
}

// ---- Manager review ----

export function reviewEscalation(db: DB, staffId: string, ticketId: string, note: string): TicketView {
  return transaction(db, () => {
    const ticket = getTicket(db, ticketId);
    if (!ticket) throw new WorkflowError('NOT_FOUND', `Ticket ${ticketId} not found.`);
    const staff = db.prepare('SELECT name, role FROM staff WHERE id = ?').get(staffId) as { name: string; role: string } | undefined;
    if (!staff) throw new WorkflowError('FORBIDDEN', 'Only maintenance staff can do that.');
    if (staff.role !== 'manager') throw new WorkflowError('FORBIDDEN', 'Only a manager can review an escalation.');
    if (!ticket.escalatedAt) throw new WorkflowError('INVALID_TRANSITION', `Ticket ${ticketId} is not escalated.`);
    const at = getNow(db);
    appendEvent(db, {
      ticketId, at, kind: 'worker', actorType: 'staff', actorId: staffId, type: 'escalation_reviewed',
      text: `Escalation reviewed by ${staff.name}: ${sentence(note)}`, data: { escalatedAt: ticket.escalatedAt },
    });
    db.prepare('UPDATE tickets SET escalated_at = NULL WHERE id = ?').run(ticketId);
    return toView(db, getTicket(db, ticketId)!);
  });
}

// ---- Queues ----

function staffViews(db: DB): StaffTicketView[] {
  return listAllTickets(db).map(t => ({ ...toView(db, t), residentName: t.residentName, residentUnit: t.residentUnit }));
}

export function getQueues(db: DB) {
  const now = getNow(db);
  const all = staffViews(db);
  const unanswered = new Set((db.prepare(
    "SELECT DISTINCT ticket_id FROM follow_ups WHERE action = 'reminder' AND processed_at IS NOT NULL AND answered_at IS NULL",
  ).all() as { ticket_id: string }[]).map(r => r.ticket_id));
  const open = all.filter(t => !isTerminal(t.status));
  return {
    open,
    awaitingConfirmation: open.filter(t => t.status === 'awaiting resident confirmation'),
    overdue: open.filter(t => unanswered.has(t.id) || (t.nextFollowUpAt !== null && t.nextFollowUpAt < now)),
    managerQueue: all.filter(t => t.escalated),
  };
}

export interface StaffReminder { messageId: number; followUpId: number; ticketId: string; text: string; at: string }

// A technician's open assignments, plus reminders they haven't acted on yet.
// A reminder counts as read once the ticket's status changes (e.g. the technician logs an inspection).
export function getTechnicianQueue(db: DB, staffId: string) {
  const staff = db.prepare('SELECT id, name, role FROM staff WHERE id = ?').get(staffId) as { id: string; name: string; role: string } | undefined;
  if (!staff) throw new WorkflowError('NOT_FOUND', `Staff member ${staffId} not found.`);
  const tickets = staffViews(db).filter(t => t.assigneeId === staffId && !isTerminal(t.status));
  const openIds = new Set(tickets.map(t => t.id));
  const reminders = (db.prepare(
    `SELECT m.id AS messageId, m.follow_up_id AS followUpId, m.ticket_id AS ticketId, m.text, m.at
     FROM messages m JOIN follow_ups f ON f.id = m.follow_up_id
     WHERE m.recipient_type = 'staff' AND m.recipient_id = ? AND f.answered_at IS NULL
     ORDER BY m.id`,
  ).all(staffId) as unknown as StaffReminder[]).filter(r => openIds.has(r.ticketId));
  return { staff, tickets, reminders };
}
