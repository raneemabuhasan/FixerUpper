import type { DB } from './connection.ts';
import type { Status } from '../workflow/status.ts';

export interface TicketRecord {
  id: string;
  residentId: string;
  title: string;
  category: string;
  location: string;
  description: string;
  status: Status;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
  nextAction: string;
  nextFollowUpAt: string | null;
  escalatedAt: string | null;
}

interface TicketRow {
  id: string; resident_id: string; title: string; category: string; location: string;
  description: string; status: Status; assignee_id: string | null; created_at: string;
  updated_at: string; next_action: string; next_follow_up_at: string | null; escalated_at: string | null;
}

function toRecord(r: TicketRow): TicketRecord {
  return {
    id: r.id, residentId: r.resident_id, title: r.title, category: r.category, location: r.location,
    description: r.description, status: r.status, assigneeId: r.assignee_id, createdAt: r.created_at,
    updatedAt: r.updated_at, nextAction: r.next_action, nextFollowUpAt: r.next_follow_up_at,
    escalatedAt: r.escalated_at,
  };
}

// Unscoped lookup: for staff/internal use only. Resident-facing code must use the scoped functions.
export function getTicket(db: DB, id: string): TicketRecord | null {
  const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined;
  return row ? toRecord(row) : null;
}

export function getTicketForResident(db: DB, id: string, residentId: string): TicketRecord | null {
  const row = db.prepare('SELECT * FROM tickets WHERE id = ? AND resident_id = ?').get(id, residentId) as TicketRow | undefined;
  return row ? toRecord(row) : null;
}

export function listTicketsForResident(db: DB, residentId: string): TicketRecord[] {
  const rows = db.prepare('SELECT * FROM tickets WHERE resident_id = ? ORDER BY id').all(residentId) as unknown as TicketRow[];
  return rows.map(toRecord);
}
