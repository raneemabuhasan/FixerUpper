import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/connection.ts';
import { listResidents } from '../db/people.ts';
import { body, params } from '../http.ts';
import {
  createTicket, createTicketInput, getResidentTicket, linkDuplicate, listTicketsForResidentView, reportTextSchema, residentAction,
} from '../workflow/tickets.service.ts';
import { noteSchema } from '../workflow/transitions.ts';

const confirmBody = z.object({ resolved: z.boolean() });
const linkBody = z.object({ reportText: reportTextSchema });
const cancelBody = z.object({ reason: noteSchema.optional() });

export function residentRoutes(db: DB) {
  const r = Router();

  r.get('/residents', (_req, res) => {
    res.json(listResidents(db));
  });

  r.get('/residents/:residentId/tickets', (req, res) => {
    const { residentId } = params(req, 'residentId');
    res.json(listTicketsForResidentView(db, residentId));
  });

  r.get('/residents/:residentId/tickets/:id', (req, res) => {
    const { residentId, id } = params(req, 'residentId', 'id');
    res.json(getResidentTicket(db, residentId, id));
  });

  r.post('/residents/:residentId/tickets', (req, res) => {
    const { residentId } = params(req, 'residentId');
    res.status(201).json(createTicket(db, residentId, body(req, createTicketInput)));
  });

  r.post('/residents/:residentId/tickets/:id/confirm', (req, res) => {
    const { residentId, id } = params(req, 'residentId', 'id');
    const { resolved } = body(req, confirmBody);
    res.json(residentAction(db, residentId, id, { type: 'resident_confirm', resolved }));
  });

  r.post('/residents/:residentId/tickets/:id/link', (req, res) => {
    const { residentId, id } = params(req, 'residentId', 'id');
    const { reportText } = body(req, linkBody);
    res.json(linkDuplicate(db, id, residentId, reportText));
  });

  r.post('/residents/:residentId/tickets/:id/cancel', (req, res) => {
    const { residentId, id } = params(req, 'residentId', 'id');
    const { reason } = body(req, cancelBody);
    res.json(residentAction(db, residentId, id, { type: 'cancel', reason }));
  });

  return r;
}
