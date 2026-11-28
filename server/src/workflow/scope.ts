import type { DB } from '../db/connection.ts';
import { getResident } from '../db/people.ts';
import { getTicketForResident, type TicketRecord } from '../db/tickets.ts';
import { WorkflowError } from './errors.ts';
import { isTerminal } from './status.ts';

export function requireResident(db: DB, residentId: string) {
  const resident = getResident(db, residentId);
  if (!resident) throw new WorkflowError('NOT_FOUND', `Resident ${residentId} not found.`);
  return resident;
}

// Another resident's ticket is reported as NOT_FOUND so ticket IDs don't leak.
export function requireResidentTicket(db: DB, ticketId: string, residentId: string): TicketRecord {
  requireResident(db, residentId);
  const ticket = getTicketForResident(db, ticketId, residentId);
  if (!ticket) throw new WorkflowError('NOT_FOUND', `Ticket ${ticketId} not found.`);
  return ticket;
}

export function requireOpen(ticket: TicketRecord, doing: string): void {
  if (isTerminal(ticket.status))
    throw new WorkflowError('INVALID_TRANSITION', `Ticket ${ticket.id} is ${ticket.status}; ${doing}.`);
}
