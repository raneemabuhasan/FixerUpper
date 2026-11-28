import type { DB } from '../db/connection.ts';

export const EVENT_TYPES = [
  'created',
  'assigned',
  'inspected',
  'repair_attempted',
  'confirmation_requested',
  'resident_confirmed',
  'resident_rejected',
  'reopened',
  'cancelled',
  'duplicate_linked',
  'follow_up_scheduled',
  'follow_up_sent',
  'escalated',
  'escalation_reviewed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type EventKind = 'resident' | 'worker' | 'system';
export type ActorType = 'resident' | 'staff' | 'ai' | 'system';

export interface NewEvent {
  ticketId: string;
  at: string;
  kind: EventKind;
  actorType: ActorType;
  actorId: string | null;
  type: EventType;
  text: string;
  data?: unknown;
}

export interface TicketEvent extends Omit<NewEvent, 'data'> {
  id: number;
  data: unknown;
}

export function appendEvent(db: DB, e: NewEvent): number {
  const result = db.prepare(
    `INSERT INTO events (ticket_id, at, kind, actor_type, actor_id, type, text, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(e.ticketId, e.at, e.kind, e.actorType, e.actorId, e.type, e.text, e.data === undefined ? null : JSON.stringify(e.data));
  return Number(result.lastInsertRowid);
}

interface EventRow {
  id: number; ticket_id: string; at: string; kind: EventKind; actor_type: ActorType;
  actor_id: string | null; type: EventType; text: string; data: string | null;
}

export function listEvents(db: DB, ticketId: string): TicketEvent[] {
  const rows = db.prepare('SELECT * FROM events WHERE ticket_id = ? ORDER BY id').all(ticketId) as unknown as EventRow[];
  return rows.map(r => ({
    id: r.id, ticketId: r.ticket_id, at: r.at, kind: r.kind, actorType: r.actor_type,
    actorId: r.actor_id, type: r.type, text: r.text, data: r.data === null ? null : JSON.parse(r.data),
  }));
}
