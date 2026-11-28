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

// Newest activity first; ties (e.g. seed data) fall back to newest created first.
const NEWEST_FIRST = 'ORDER BY tickets.updated_at DESC, tickets.rowid DESC';

export function listTicketsForResident(db: DB, residentId: string): TicketRecord[] {
  const rows = db.prepare(`SELECT * FROM tickets WHERE resident_id = ? ${NEWEST_FIRST}`).all(residentId) as unknown as TicketRow[];
  return rows.map(toRecord);
}

export interface TicketWithResident extends TicketRecord {
  residentName: string;
  residentUnit: string;
}

// Unscoped: staff views only.
export function listAllTickets(db: DB): TicketWithResident[] {
  const rows = db.prepare(
    `SELECT tickets.*, residents.name AS resident_name, residents.unit AS resident_unit
     FROM tickets JOIN residents ON residents.id = tickets.resident_id ${NEWEST_FIRST}`,
  ).all() as unknown as (TicketRow & { resident_name: string; resident_unit: string })[];
  return rows.map(r => ({ ...toRecord(r), residentName: r.resident_name, residentUnit: r.resident_unit }));
}

// Continues the RES-### sequence (RES-104 after the seed's RES-103).
export function nextTicketId(db: DB): string {
  const row = db.prepare("SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS n FROM tickets WHERE id GLOB 'RES-[0-9]*'").get() as { n: number | null };
  return `RES-${String((row.n ?? 100) + 1).padStart(3, '0')}`;
}

export type NewTicket = Pick<TicketRecord, 'id' | 'residentId' | 'title' | 'category' | 'location' | 'description' | 'status' | 'nextAction' | 'createdAt'>;

export function insertTicket(db: DB, t: NewTicket): void {
  db.prepare(
    `INSERT INTO tickets (id, resident_id, title, category, location, description, status, created_at, updated_at, next_action)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(t.id, t.residentId, t.title, t.category, t.location, t.description, t.status, t.createdAt, t.createdAt, t.nextAction);
}

export function touchTicket(db: DB, id: string, at: string): void {
  db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(at, id);
}
