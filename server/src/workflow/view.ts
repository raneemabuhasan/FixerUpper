import type { DB } from '../db/connection.ts';
import type { TicketRecord } from '../db/tickets.ts';
import { listEvents, type ActorType, type EventKind, type EventType } from './events.ts';
import type { Status } from './status.ts';

// Superset of shared/types.ts Ticket: the frontend can use it without type changes.
export interface TicketEventView {
  at: string;
  text: string;
  kind: EventKind;
  id: number;
  type: EventType;
  actorType: ActorType;
  actorId: string | null;
}

export interface TicketView {
  id: string;
  residentId: string;
  title: string;
  category: string;
  location: string;
  description: string;
  status: Status;
  updatedAt: string;
  nextAction: string;
  events: TicketEventView[];
  createdAt: string;
  assigneeId: string | null;
  escalated: boolean;
  nextFollowUpAt: string | null;
}

export interface StaffTicketView extends TicketView {
  residentName: string;
  residentUnit: string;
}

export function toView(db: DB, t: TicketRecord): TicketView {
  return {
    id: t.id, residentId: t.residentId, title: t.title, category: t.category, location: t.location,
    description: t.description, status: t.status, updatedAt: t.updatedAt, nextAction: t.nextAction,
    events: listEvents(db, t.id).map(e => ({
      at: e.at, text: e.text, kind: e.kind, id: e.id, type: e.type, actorType: e.actorType, actorId: e.actorId,
    })),
    createdAt: t.createdAt, assigneeId: t.assigneeId, escalated: t.escalatedAt !== null, nextFollowUpAt: t.nextFollowUpAt,
  };
}
