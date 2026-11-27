import { createApp } from './app.ts';
import { DEFAULT_DB_PATH, openDatabase } from './db/connection.ts';
import { migrate } from './db/migrate.ts';
import { seed } from './db/seed.ts';

const PORT = Number(process.env.PORT ?? 3001);

const db = openDatabase();
migrate(db);
// First run on a fresh database: seed so the demo works without a manual db:reset.
if (!db.prepare('SELECT 1 FROM clock').get()) seed(db);

createApp(db).listen(PORT, '127.0.0.1', () => {
  console.log(`Resolve API on http://127.0.0.1:${PORT} (db: ${DEFAULT_DB_PATH})`);
});
