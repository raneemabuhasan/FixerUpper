import express from 'express';
import type { DB } from './db/connection.ts';
import { getNow } from './db/clock.ts';
import { errorHandler, notFound } from './http.ts';
import { demoRoutes } from './routes/demo.ts';
import { residentRoutes } from './routes/residents.ts';
import { staffRoutes } from './routes/staff.ts';

export function createApp(db: DB) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, clock: getNow(db) });
  });
  app.use('/api', residentRoutes(db), staffRoutes(db), demoRoutes(db));

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
