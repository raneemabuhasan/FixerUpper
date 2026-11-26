# Agent guide

## Setup and checks
- Run commands from the repository root. Use Node 24 (verified with 24.13.0 and npm 11.6.2).
- Install locked dependencies with `npm ci`; verified here using `npm ci --offline` with cached packages. Prefer the lockfile: package.json dependency ranges are `latest`.
- `npm run dev` starts Vite on 127.0.0.1; use the URL printed in the terminal.
- `npm test` runs Node workflow tests in `shared/workflow.test.ts`, using native TypeScript stripping.
- `npm run build` runs strict TypeScript checking and a production Vite build into `dist/`. It passes with React Router `use client` bundling warnings.
- There is no lint script or automated browser test suite. The TypeScript build excludes the test file; run both tests and build for logic changes.

## Structure and conventions
- This is **Resolve**, a React + TypeScript resident maintenance demo. `server/` is a handoff README only; there is no backend, database, real authentication, or model integration.
- `web/src/main.tsx` contains components and React Router routes; `web/src/style.css` holds global styles. Follow existing functional components, hooks, single quotes, and semicolons; avoid unrelated reformatting.
- `web/src/api.ts` is the asynchronous mock adapter boundary. Keep persistence and future endpoint integration there rather than adding storage calls to UI components.
- `shared/types.ts` defines ticket contracts and exact status strings. `shared/workflow.ts` owns confirmation transitions; its `.ts` import extension supports direct Node test execution. Use type-only imports for types.
- Only a ticket in `awaiting resident confirmation` can be confirmed. Approval resolves it; rejection changes it to `awaiting update`, preserving ticket identity and event history. A worker completion report alone must not resolve a ticket.
- Preserve resident scoping in list and mutation operations. Browser checks are demo behavior; a future backend must independently enforce scope and workflow rules.
- Cancellation closes an open request while preserving its record and activity history. Exclude cancelled requests from open counts and duplicate matching; resolved and cancelled requests cannot be cancelled again.

## Demo checks and pitfalls
- Tickets persist under localStorage key `resolve-tickets`; sessionStorage key `resident` controls resident selection. Sign-out does not clear tickets. Remove these keys to reset the demo; malformed ticket JSON triggers the recoverable load error.
- With fresh storage, Mina (Unit 204) has three tickets, including a faucet awaiting confirmation; Alex (Unit 108) has none. Manually check approval/rejection, resident switching, and reporting a faucet/drip issue with explicit duplicate-link confirmation after relevant UI changes. Reset tickets between approval and rejection checks.
- Intake and duplicate detection are scripted, not AI. Keep their demo labeling accurate.
- Do not edit or commit generated `dist/`, `node_modules/`, `.env*`, or ignored local reference files (`FixerUpperPlan.docx`, `resident-reference.*`). No hosting is configured.
