import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/connection.ts';
import { listStaff } from '../db/people.ts';
import { body, params } from '../http.ts';
import { getQueues, listStaffTickets, staffAction } from '../workflow/tickets.service.ts';
import { noteSchema } from '../workflow/transitions.ts';

// staffId is checked against the staff table by the state machine (unknown id -> 403).
// There is deliberately no resolve route: only the resident can resolve a ticket.
const staffId = z.string().min(1).max(64);
const assignBody = z.object({ staffId, assigneeId: z.string().min(1).max(64) });
const noteBody = z.object({ staffId, note: noteSchema });
const requestConfirmationBody = z.object({ staffId, note: noteSchema.optional() });

export function staffRoutes(db: DB) {
  const r = Router();

  r.get('/staff', (_req, res) => {
    res.json(listStaff(db));
  });

  r.get('/staff/tickets', (_req, res) => {
    res.json(listStaffTickets(db));
  });

  r.get('/staff/queues', (_req, res) => {
    res.json(getQueues(db));
  });

  r.post('/staff/tickets/:id/assign', (req, res) => {
    const { id } = params(req, 'id');
    const b = body(req, assignBody);
    res.json(staffAction(db, b.staffId, id, { type: 'assign', assigneeId: b.assigneeId }));
  });

  r.post('/staff/tickets/:id/inspect', (req, res) => {
    const { id } = params(req, 'id');
    const b = body(req, noteBody);
    res.json(staffAction(db, b.staffId, id, { type: 'inspected_only', note: b.note }));
  });

  r.post('/staff/tickets/:id/repair', (req, res) => {
    const { id } = params(req, 'id');
    const b = body(req, noteBody);
    res.json(staffAction(db, b.staffId, id, { type: 'repair_attempted', note: b.note }));
  });

  r.post('/staff/tickets/:id/request-confirmation', (req, res) => {
    const { id } = params(req, 'id');
    const b = body(req, requestConfirmationBody);
    res.json(staffAction(db, b.staffId, id, { type: 'request_confirmation', note: b.note }));
  });

  return r;
}
