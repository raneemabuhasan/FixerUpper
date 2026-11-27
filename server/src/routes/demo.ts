import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/connection.ts';
import { advanceClock, getNow } from '../db/clock.ts';
import { resetDatabase } from '../db/reset.ts';
import { body } from '../http.ts';

const advanceBody = z.object({ hours: z.number().positive().max(24 * 365) });

export function demoRoutes(db: DB) {
  const r = Router();

  r.get('/clock', (_req, res) => {
    res.json({ clock: getNow(db) });
  });

  r.post('/clock/advance', (req, res) => {
    const { hours } = body(req, advanceBody);
    const clock = advanceClock(db, hours);
    // Phase 3: process follow-ups that became due here.
    res.json({ clock });
  });

  r.post('/demo/reset', (_req, res) => {
    resetDatabase(db);
    res.json({ ok: true, clock: getNow(db) });
  });

  return r;
}
