import express from 'express';
import type { DB } from './db/connection.ts';
import { getNow } from './db/clock.ts';

export function createApp(db: DB) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, clock: getNow(db) });
  });

  return app;
}
