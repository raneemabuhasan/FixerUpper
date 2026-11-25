# Resolve
Resident-facing maintenance demo. React + TypeScript + Vite.

## Start
Run `npm install`, then `npm run dev`. Open the printed local URL.
`npm run build` checks TypeScript and builds to dist. `npm test` checks confirmation rules.

## Demo
Landing → Sign in → Mina, Unit 204 → Review repair. Rejecting keeps the original request open; confirming resolves it. Report a faucet issue to explore scripted clarification and duplicate confirmation. Alex starts with an empty workspace.

This is a browser-local mock: no real authentication, model, messages, server or database. Tickets persist in localStorage; resident selection and intro state use sessionStorage. Clear browser storage to reset. Invalid stored JSON displays a recoverable load error; clearing local storage restores seeds.

## Handoff
`web/src/api.ts` is the asynchronous adapter boundary. Replace its implementation with Dev 2's agreed endpoints. `shared` holds initial types and confirmation logic. Dev 3 replaces scripted intake. The server must enforce resident scope and confirmation rules independently; browser checks are not security. Follow-up deadlines, demo clock, staff screens and real AI tools are subsequent team work.

Visual references: Hirael opening typography and the supplied Ballmac workspace layout; custom resident interface, no template code copied. Document and reference image stay local and ignored. No hosting configured.
