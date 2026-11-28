import express from 'express';
import type { DB } from './db/connection.ts';
import { getNow } from './db/clock.ts';
import { errorHandler, notFound } from './http.ts';
import { createModelFromEnv, type ModelClient } from './ai/model.ts';
import { assistantRoutes } from './routes/assistant.ts';
import { demoRoutes } from './routes/demo.ts';
import { residentRoutes } from './routes/residents.ts';
import { staffRoutes } from './routes/staff.ts';

// `model` is the AI assistant's model. Left out, it comes from ANTHROPIC_API_KEY; null turns the assistant off.
export function createApp(db: DB, opts: { model?: ModelClient | null } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, clock: getNow(db) });
  });
  const model = opts.model === undefined ? createModelFromEnv() : opts.model;
  app.use('/api', assistantRoutes(db, model), residentRoutes(db), staffRoutes(db), demoRoutes(db));

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
