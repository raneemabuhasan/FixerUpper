// Ticket services shared by the HTTP routes and Dev 3's AI tools.
// Everything resident-facing is scoped by residentId; another resident's ticket is NOT_FOUND.
import { z } from 'zod';
import { transaction, type DB } from '../db/connection.ts';
import { getNow } from '../db/clock.ts';
import { getTicket, insertTicket, listAllTickets, listTicketsForResident, nextTicketId, touchTicket } from '../db/tickets.ts';
import { appendEvent } from './events.ts';
import { parseInput } from './errors.ts';
import { requireOpen, requireResident, requireResidentTicket } from './scope.ts';
import { applyAction, type Action } from './transitions.ts';
import { toView, type StaffTicketView, type TicketView } from './view.ts';

export type { TicketEventView, TicketView, StaffTicketView } from './view.ts';

// ---- Resident reads ----

export function listTicketsForResidentView(db: DB, residentId: string): TicketView[] {
  requireResident(db, residentId);
  return listTicketsForResident(db, residentId).map(t => toView(db, t));
}

export function getResidentTicket(db: DB, residentId: string, ticketId: string): TicketView {
  return toView(db, requireResidentTicket(db, ticketId, residentId));
}

// ---- Resident writes ----

export const createTicketInput = z.object({
  description: z.string().trim().min(1).max(2000),
  location: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(60).optional(),
});
export type CreateTicketInput = z.input<typeof createTicketInput>;

// `source` records who filed it in the event log: the resident directly, or an AI tool acting for them.
export function createTicket(
  db: DB, residentId: string, input: CreateTicketInput, source: { type: 'resident' | 'ai'; id: string } = { type: 'resident', id: residentId },
): TicketView {
  const data = parseInput(createTicketInput, input, 'ticket');
  return transaction(db, () => {
    requireResident(db, residentId);
    const at = getNow(db);
    const id = nextTicketId(db);
    insertTicket(db, {
      id, residentId, createdAt: at, status: 'submitted', nextAction: 'Maintenance will review your request',
      title: data.title ?? data.description.split('\n')[0].slice(0, 120),
      category: data.category ?? 'Maintenance', location: data.location, description: data.description,
    });
    appendEvent(db, {
      ticketId: id, at, kind: source.type === 'resident' ? 'resident' : 'system', actorType: source.type, actorId: source.id,
      type: 'created', text: 'Maintenance request submitted.',
    });
    return toView(db, getTicket(db, id)!);
  });
}

export const reportTextSchema = z.string().trim().min(1).max(2000);

// Attaches a repeated report to an existing open ticket instead of creating a new one.
export function linkDuplicate(db: DB, ticketId: string, residentId: string, reportText: string): TicketView {
  const text = parseInput(reportTextSchema, reportText, 'reportText');
  return transaction(db, () => {
    const ticket = requireResidentTicket(db, ticketId, residentId);
    requireOpen(ticket, 'a new report cannot be linked to it');
    const at = getNow(db);
    const link = db.prepare(
      'INSERT INTO duplicate_links (ticket_id, linked_report_text, confirmed_by_resident_id, at) VALUES (?, ?, ?, ?)',
    ).run(ticketId, text, residentId, at);
    appendEvent(db, {
      ticketId, at, kind: 'resident', actorType: 'resident', actorId: residentId, type: 'duplicate_linked',
      text: 'Resident confirmed a repeated report belongs to this request.',
      data: { duplicateLinkId: Number(link.lastInsertRowid), reportText: text },
    });
    touchTicket(db, ticketId, at);
    return toView(db, getTicket(db, ticketId)!);
  });
}

export function residentAction(db: DB, residentId: string, ticketId: string, action: Extract<Action, { type: 'resident_confirm' | 'cancel' }>): TicketView {
  return transaction(db, () => {
    requireResidentTicket(db, ticketId, residentId);
    return toView(db, applyAction(db, ticketId, action, { type: 'resident', id: residentId }));
  });
}

// ---- Staff ----

export type StaffAction = Extract<Action, { type: 'assign' | 'inspected_only' | 'repair_attempted' | 'request_confirmation' }>;

export function staffAction(db: DB, staffId: string, ticketId: string, action: StaffAction): TicketView {
  return toView(db, applyAction(db, ticketId, action, { type: 'staff', id: staffId }));
}

export function listStaffTickets(db: DB): StaffTicketView[] {
  return listAllTickets(db).map(t => ({ ...toView(db, t), residentName: t.residentName, residentUnit: t.residentUnit }));
}
