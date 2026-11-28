import { z } from 'zod';
import { transaction, type DB } from '../db/connection.ts';
import { getNow } from '../db/clock.ts';
import { getTicket, type TicketRecord } from '../db/tickets.ts';
import { appendEvent, type EventKind, type EventType } from './events.ts';
import { WorkflowError, parseInput } from './errors.ts';
import { onStatusChange } from './followups.service.ts';
import { OPEN_STATUSES, isTerminal, type Status } from './status.ts';

export const actorSchema = z.object({
  type: z.enum(['resident', 'staff', 'ai', 'system']),
  id: z.string().min(1),
});
export type Actor = z.infer<typeof actorSchema>;

export const noteSchema = z.string().trim().min(1).max(2000);
const note = noteSchema.optional();

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('assign'), assigneeId: z.string().min(1) }),
  z.object({ type: z.literal('inspected_only'), note }),
  z.object({ type: z.literal('repair_attempted'), note }),
  z.object({ type: z.literal('request_confirmation'), note }),
  z.object({ type: z.literal('resident_confirm'), resolved: z.boolean() }),
  z.object({ type: z.literal('cancel'), reason: note }),
]);
export type Action = z.infer<typeof actionSchema>;
export type ActionType = Action['type'];

// Who may perform each action, and from which statuses.
export const RULES: { [K in ActionType]: { actor: 'resident' | 'staff'; from: readonly Status[] } } = {
  assign: { actor: 'staff', from: ['submitted'] },
  inspected_only: { actor: 'staff', from: ['assigned', 'awaiting update'] },
  repair_attempted: { actor: 'staff', from: ['assigned', 'awaiting update'] },
  request_confirmation: { actor: 'staff', from: ['awaiting update'] },
  resident_confirm: { actor: 'resident', from: ['awaiting resident confirmation'] },
  cancel: { actor: 'resident', from: OPEN_STATUSES },
};

const KIND: Record<Actor['type'], EventKind> = { resident: 'resident', staff: 'worker', ai: 'system', system: 'system' };

function authorize(db: DB, ticket: TicketRecord, actor: Actor, required: 'resident' | 'staff') {
  if (required === 'resident') {
    if (actor.type !== 'resident' || actor.id !== ticket.residentId)
      throw new WorkflowError('FORBIDDEN', 'Only the resident who reported this request can do that.');
    return;
  }
  if (actor.type !== 'staff' || !db.prepare('SELECT 1 FROM staff WHERE id = ?').get(actor.id))
    throw new WorkflowError('FORBIDDEN', 'Only maintenance staff can do that.');
}

function hasRepairAttemptSinceReopen(db: DB, ticketId: string): boolean {
  return !!db.prepare(
    `SELECT 1 FROM events
     WHERE ticket_id = ? AND type = 'repair_attempted'
       AND id > COALESCE((SELECT MAX(id) FROM events WHERE ticket_id = ? AND type = 'reopened'), 0)
     LIMIT 1`,
  ).get(ticketId, ticketId);
}

// Validates the action, updates the ticket and appends its event(s) atomically.
// Throws WorkflowError: NOT_FOUND, FORBIDDEN, INVALID_TRANSITION or INVALID_INPUT.
export function applyAction(db: DB, ticketId: string, rawAction: unknown, rawActor: unknown): TicketRecord {
  const action = parseInput(actionSchema, rawAction, 'action');
  const actor = parseInput(actorSchema, rawActor, 'actor');

  return transaction(db, () => {
    const ticket = getTicket(db, ticketId);
    if (!ticket) throw new WorkflowError('NOT_FOUND', `Ticket ${ticketId} not found.`);

    const rule = RULES[action.type];
    authorize(db, ticket, actor, rule.actor);
    if (isTerminal(ticket.status))
      throw new WorkflowError('INVALID_TRANSITION', `Ticket ${ticketId} is ${ticket.status} and cannot change.`);
    if (!rule.from.includes(ticket.status))
      throw new WorkflowError('INVALID_TRANSITION', `Cannot ${action.type} a ticket that is ${ticket.status}.`);

    const at = getNow(db);
    let eventId = 0;
    const event = (type: EventType, text: string, data?: unknown, kind = KIND[actor.type]) =>
      (eventId = appendEvent(db, { ticketId, at, kind, actorType: actor.type, actorId: actor.id, type, text, data }));

    let status: Status;
    let nextAction: string;
    let assigneeId = ticket.assigneeId;

    switch (action.type) {
      case 'assign': {
        const assignee = db.prepare('SELECT name FROM staff WHERE id = ?').get(action.assigneeId) as { name: string } | undefined;
        if (!assignee) throw new WorkflowError('INVALID_INPUT', `Staff member ${action.assigneeId} not found.`);
        assigneeId = action.assigneeId;
        status = 'assigned';
        nextAction = 'Your maintenance team will provide an update';
        event('assigned', `Assigned to ${assignee.name}.`, { assigneeId });
        break;
      }
      case 'inspected_only':
        status = 'awaiting update';
        nextAction = 'Maintenance will follow up with next steps';
        event('inspected', action.note ?? 'Technician inspected the issue.');
        break;
      case 'repair_attempted':
        status = 'awaiting update';
        nextAction = 'Maintenance will let you know when the repair is ready for review';
        event('repair_attempted', action.note ?? 'Technician attempted a repair.');
        break;
      case 'request_confirmation':
        if (!hasRepairAttemptSinceReopen(db, ticketId))
          throw new WorkflowError('INVALID_TRANSITION', 'Record a repair attempt before requesting resident confirmation.');
        status = 'awaiting resident confirmation';
        nextAction = 'Please check the repair and confirm';
        event('confirmation_requested', action.note ?? 'Repair is ready for review; awaiting resident confirmation.');
        break;
      case 'resident_confirm':
        // Invariant: only the ticket's own resident can ever resolve it. Checked again here on purpose.
        if (actor.type !== 'resident' || actor.id !== ticket.residentId)
          throw new WorkflowError('FORBIDDEN', 'Only the resident who reported this request can confirm it.');
        if (action.resolved) {
          status = 'resolved';
          nextAction = 'No action needed';
          event('resident_confirmed', 'Resident confirmed the repair.');
        } else {
          status = 'awaiting update';
          nextAction = 'Maintenance will review your feedback';
          event('resident_rejected', 'Resident reports the issue persists.');
          event('reopened', 'Case reopened.', undefined, 'system');
        }
        break;
      case 'cancel':
        status = 'cancelled';
        nextAction = 'Request cancelled. No further action is scheduled.';
        event('cancelled', 'Resident cancelled the maintenance request.', action.reason ? { reason: action.reason } : undefined);
        break;
    }

    db.prepare('UPDATE tickets SET status = ?, next_action = ?, assignee_id = ?, updated_at = ? WHERE id = ?')
      .run(status, nextAction, assigneeId, at, ticketId);

    const updated = getTicket(db, ticketId)!;
    // Supersede the old follow-up cycle and schedule the new one (keys include eventId).
    if (status !== ticket.status) onStatusChange(db, updated, at, { action: action.type, eventId });
    return getTicket(db, ticketId)!;
  });
}
