# Resolve backend

Express + TypeScript API on Node's built-in `node:sqlite`. It holds the ticket workflow, follow-ups and escalation. The endpoint contract is in [docs/API.md](../docs/API.md).

## Commands (run from the repo root)

- `npm run dev:all`: API on :3001 plus Vite, which proxies `/api`
- `npm run dev:server`: API only. A new database is seeded on first start.
- `npm run db:reset`: drop, migrate and seed `server/data/resolve.db`. Set `RESOLVE_DB_PATH` to use a different file.
- `npm run test:server`: Vitest and Supertest
- `npm run typecheck:server`: type check only. `npm run build` also runs it.

## Layout

- `src/index.ts`: starts the server and the 30s follow-up timer
- `src/app.ts`, `src/http.ts`, `src/routes/`: Express app, error handling, thin route handlers
- `src/workflow/status.ts`: the only list of statuses. The DB CHECK constraint is generated from it.
- `src/workflow/transitions.ts`: `applyAction`, the only code that changes a ticket's status
- `src/workflow/tickets.service.ts`, `src/workflow/followups.service.ts`: services shared by the routes and the AI tools
- `src/db/`: connection, migrations, seed, reset, queries
- `test/`: in-memory and temp-file DB tests
