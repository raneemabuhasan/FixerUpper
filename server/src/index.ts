import { createApp } from './app.ts';
import { DEFAULT_DB_PATH } from './db/connection.ts';
import { initDatabase } from './db/init.ts';
import { processDueFollowUps } from './workflow/followups.service.ts';

const PORT = Number(process.env.PORT ?? 3001);
const FOLLOW_UP_INTERVAL_MS = 30_000;

// First run on a fresh database seeds it, so the demo works without a manual db:reset.
const db = initDatabase();

// Lives here, not in createApp, so tests stay deterministic. Safe alongside clock advances:
// processDueFollowUps claims each follow-up before firing it.
setInterval(() => {
  try {
    const processed = processDueFollowUps(db);
    if (processed.length) console.log(`Follow-ups fired: ${processed.map(p => p.dueKey).join(', ')}`);
  } catch (err) {
    console.error('Follow-up processing failed', err);
  }
}, FOLLOW_UP_INTERVAL_MS).unref();

createApp(db).listen(PORT, '127.0.0.1', () => {
  console.log(`Resolve API on http://127.0.0.1:${PORT} (db: ${DEFAULT_DB_PATH})`);
});
