# Resolve backend
Express + TypeScript on Node's built-in `node:sqlite`. Phase 1: schema, seed and the ticket state machine; only `GET /api/health` is exposed so far.

## Commands (from repo root)
- `npm run dev:server`: API on http://127.0.0.1:3001 (migrates, and seeds a fresh DB).
- `npm run dev:all`: Vite and API together; Vite proxies `/api` to the API.
- `npm run db:reset`: drop all tables, migrate, seed. DB lives at `server/data/resolve.db` (gitignored; override with `RESOLVE_DB_PATH`).
- `npm run test:server`: Vitest, in-memory databases.
- `npm run typecheck:server`: strict type check using `server/tsconfig.json`.

## Layout
- `src/workflow/status.ts`: the only list of ticket statuses. The `tickets.status` CHECK constraint is generated from it, so adding a status is one line there, then `npm run db:reset`.
- `src/workflow/transitions.ts`: `applyAction(db, ticketId, action, actor)`, the only code that changes ticket status. Throws `WorkflowError` with `INVALID_TRANSITION`, `NOT_FOUND`, `FORBIDDEN` or `INVALID_INPUT`.
- `src/db/migrations/*.sql`: applied in filename order and tracked in the `migrations` table.
- `src/db/seed.ts`: deterministic seed mirroring `web/src/api.ts`; the simulated clock starts at `2026-01-12T09:00:00.000Z`.

Only the ticket's own resident can resolve it. Staff, AI and system actors get `FORBIDDEN`.
