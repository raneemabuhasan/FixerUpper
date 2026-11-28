# Resolve API

Base URL `http://127.0.0.1:3001/api`. `npm run dev:all` starts the API and Vite, and Vite proxies `/api`, so the frontend can call `fetch('/api/...')`. Bodies are JSON validated with Zod, and unknown fields are ignored. All timestamps come from the simulated clock. Samples are from a live run after `POST /api/demo/reset`.

## Errors

Every error has the form `{ "error": { "code": "...", "message": "..." } }`.

| Code | HTTP | When |
|---|---|---|
| `INVALID_INPUT` | 400 | Bad body or path param, malformed JSON |
| `FORBIDDEN` | 403 | Unknown `staffId`, or the actor's role can't do this |
| `NOT_FOUND` | 404 | Unknown resident, route or ticket, including another resident's ticket |
| `INVALID_TRANSITION` | 409 | The ticket's status doesn't allow the action |
| `INTERNAL` | 500 | Anything unexpected. No stack trace is returned. |

## Ticket

A superset of `Ticket` in `shared/types.ts`. Every route below that "returns the ticket" returns this shape.

```json
{
  "id": "RES-101", "residentId": "mina", "title": "Kitchen faucet dripping", "category": "Plumbing",
  "location": "Kitchen sink", "description": "Kitchen faucet dripping",
  "status": "awaiting resident confirmation", "updatedAt": "2026-01-12T09:00:00.000Z",
  "nextAction": "Please check the repair and confirm",
  "events": [
    { "at": "2026-01-12T09:00:00.000Z", "text": "Maintenance request submitted.", "kind": "resident",
      "id": 1, "type": "created", "actorType": "resident", "actorId": "mina" },
    { "at": "2026-01-12T09:00:00.000Z", "text": "Replaced faucet washer. Repair appears complete; awaiting resident confirmation.",
      "kind": "worker", "id": 2, "type": "repair_attempted", "actorType": "staff", "actorId": "tech-sam" }
  ],
  "createdAt": "2026-01-12T09:00:00.000Z", "assigneeId": "tech-sam", "escalated": false, "nextFollowUpAt": null
}
```

- `status` is one of `submitted`, `assigned`, `awaiting update`, `awaiting resident confirmation`, `resolved`, `cancelled`.
- Fields beyond the shared type: `createdAt`, `assigneeId`, `escalated`, `nextFollowUpAt`, and per event `id`, `type`, `actorType`, `actorId`.
- Event types: `created`, `assigned`, `inspected`, `repair_attempted`, `confirmation_requested`, `resident_confirmed`, `resident_rejected`, `reopened`, `cancelled`, `duplicate_linked`, `follow_up_scheduled`, `follow_up_sent`, `escalated`, `escalation_reviewed`.

## Workflow

```
submitted -assign-> assigned -inspect/repair-> awaiting update -request-confirmation-> awaiting resident confirmation
                                                   ^-------------- resident says no ---------------|
                                                                   resident says yes --> resolved
any open status -resident cancels-> cancelled
```

- Only the ticket's own resident can resolve it. There is no staff or AI route for resolving.
- `request-confirmation` needs a repair logged since the last reopen.
- Nothing leaves `resolved` or `cancelled`.

## Follow-ups

A follow-up cycle starts when a ticket enters one of these statuses:

| Status entered | Delay | Recipient | Action and text |
|---|---|---|---|
| `assigned` | +24h | technician | reminder: "No update logged" |
| `assigned` | +48h | manager | escalate: "No update logged within 48 hours of assignment" |
| `awaiting update` | +24h | technician | reminder: "Reopened/inspected with no new repair logged" |
| `awaiting update` | +48h | manager | escalate: "No new repair logged within 48 hours" |
| `awaiting resident confirmation` | +24h | resident | reminder: "Please confirm whether the repair worked" |
| `awaiting resident confirmation` | +72h | manager | escalate: "Resident has not confirmed the repair within 72 hours" |

- A status change supersedes the ticket's pending follow-ups. An update that keeps the status, like a second repair, doesn't.
- Each follow-up fires once. Its key includes the ID of the event that scheduled it.
- Escalating sets `escalated: true`. It doesn't change the status, and silence never resolves a ticket.
- Follow-ups fire on `POST /clock/advance` and on a 30s timer in the server.

## Residents

Scoped by `:residentId`. Another resident's ticket returns 404.

**`GET /residents`**
```json
[{ "id": "alex", "name": "Alex", "unit": "108" }, { "id": "mina", "name": "Mina", "unit": "204" }]
```

**`GET /residents/:residentId/tickets`**: the resident's tickets, newest `updatedAt` first. Ties go to the newest created, so a fresh seed lists RES-103, 102, 101.

**`GET /residents/:residentId/tickets/:id`**: returns the ticket.

**`POST /residents/:residentId/tickets`**: `{ description, location, title?, category? }`. Returns 201 and the ticket. IDs continue from RES-104. `title` defaults to the description and `category` to `"Maintenance"`.
```json
{ "id": "RES-104", "status": "submitted", "title": "Bathroom sink drains slowly", "category": "Maintenance", "nextAction": "Maintenance will review your request" }
```

**`POST /residents/:residentId/tickets/:id/confirm`**: `{ resolved: boolean }`. `true` resolves the ticket. `false` reopens it as `awaiting update` with the same ID and history.
```json
{ "id": "RES-101", "status": "awaiting update", "nextAction": "Maintenance will review your feedback",
  "events": ["…", { "type": "resident_rejected", "text": "Resident reports the issue persists." }, { "type": "reopened", "text": "Case reopened." }] }
```

**`POST /residents/:residentId/tickets/:id/link`**: `{ reportText }`. Records a repeat report on an open ticket without creating a new one. Adds a `duplicate_linked` event.

**`POST /residents/:residentId/tickets/:id/cancel`**: optional `{ reason }`. Works from any open status.

**`GET /residents/:residentId/tickets/:id/tool-outcomes`**: what the AI tools did on this ticket.
```json
[{ "id": 1, "ticketId": "RES-104", "name": "find_duplicates", "args": { "query": "bathroom sink drain" },
   "success": true, "explanation": "One open ticket matched: RES-104.", "at": "2026-01-14T10:00:00.000Z" }]
```

## Staff

Every POST body needs a real `staffId`. An unknown one returns 403.

**`GET /staff`**
```json
[{ "id": "mgr-jordan", "name": "Jordan Lee", "role": "manager" }, { "id": "tech-sam", "name": "Sam Rivera", "role": "technician" }]
```

**`GET /staff/tickets`**: all tickets, newest first, each with `residentName` and `residentUnit` added.

**`GET /staff/queues`**: lists of tickets.
- `open`: not resolved or cancelled
- `awaitingConfirmation`
- `overdue`: has a fired reminder with no status change since, or a follow-up past due
- `managerQueue`: escalated and not yet reviewed

Sample, as ticket IDs:
```json
{ "open": ["RES-104", "RES-103", "RES-102", "RES-101"], "awaitingConfirmation": ["RES-101"], "overdue": ["RES-104"], "managerQueue": ["RES-104"] }
```

**`GET /staff/:staffId/queue`**: a technician's open assigned tickets, plus reminders they haven't acted on. A reminder clears when the ticket's status changes.
```json
{ "staff": { "id": "tech-sam", "name": "Sam Rivera", "role": "technician" },
  "tickets": ["…"],
  "reminders": [{ "messageId": 1, "followUpId": 1, "ticketId": "RES-104",
                  "text": "RES-104 \"Bathroom sink drains slowly\": No update logged.", "at": "2026-01-13T09:00:00.000Z" }] }
```

Each of the following returns the ticket:

| Route | Body | Allowed from |
|---|---|---|
| `POST /staff/tickets/:id/assign` | `{ staffId, assigneeId }` | `submitted` |
| `POST /staff/tickets/:id/inspect` | `{ staffId, note }` | `assigned`, `awaiting update` |
| `POST /staff/tickets/:id/repair` | `{ staffId, note }` | `assigned`, `awaiting update` |
| `POST /staff/tickets/:id/request-confirmation` | `{ staffId, note? }` | `awaiting update`, after a repair |
| `POST /staff/tickets/:id/escalation/review` | `{ staffId, note }` | any escalated ticket. Managers only; technicians get 403. Clears `escalated` and leaves the status alone. |

## Demo

**`GET /health`**: returns `{ "ok": true, "clock": "2026-01-12T09:00:00.000Z" }`.

**`GET /clock`**: returns `{ "clock": "2026-01-12T09:00:00.000Z" }`.

**`POST /clock/advance`**: `{ hours }`, which must be positive and at most 8760. Moves the clock forward, then returns what fired.
```json
{ "clock": "2026-01-13T10:00:00.000Z",
  "processed": [{ "followUpId": 1, "ticketId": "RES-104", "dueKey": "assign-reminder:6", "dueAt": "2026-01-13T09:00:00.000Z",
                  "action": "reminder", "recipientType": "staff", "recipientId": "tech-sam", "recipientName": "Sam Rivera",
                  "text": "Reminder sent to Sam Rivera (technician): No update logged." }] }
```

**`POST /demo/reset`**: drops all data and re-seeds. Returns `{ "ok": true, "clock": "2026-01-12T09:00:00.000Z" }`.

## For Dev 1

- Map `web/src/api.ts` as follows. Each POST returns the updated ticket.
  - `list` → `GET /residents/:id/tickets`
  - `create` → `POST /residents/:id/tickets`
  - `confirm` → `POST .../confirm { resolved }`
  - `link` → `POST .../link`
  - `cancel` → `POST .../cancel`
- `link` needs `{ reportText }`, the text the resident just typed.
- `status` can be `'cancelled'`, which isn't in `shared/types.ts` on `main` until Raneem's branch merges.

## For Dev 3

The plan's six AI tools map to these service functions. They have the same validation and resident scoping as the routes, and throw `WorkflowError` with the codes above.

| Tool | Function |
|---|---|
| create ticket | `createTicket(db, residentId, { description, location, title?, category? }, { type: 'ai', id })` in `tickets.service.ts` |
| retrieve resident tickets | `listTicketsForResidentView(db, residentId)`, or `getResidentTicket(db, residentId, ticketId)` for one ticket, in `tickets.service.ts` |
| link confirmed duplicate | `linkDuplicate(db, ticketId, residentId, reportText)` in `tickets.service.ts` |
| schedule follow-up | `scheduleFollowUp(db, ticketId, residentId, { hoursFromNow, action: 'reminder' \| 'escalate', reason })` in `followups.service.ts` |
| send simulated follow-up | `sendSimulatedFollowUp(db, ticketId, residentId, { text })` in `followups.service.ts` |
| route to manager | `routeToManager(db, ticketId, residentId, { reason, urgent? })` in `followups.service.ts` |

- Log every tool call with `recordToolOutcome(db, { ticketId?, name, args, success, explanation })`. The UI reads these from the tool-outcomes route.
- Resident confirmation is intentionally not a tool. Any `ai` actor that tries to resolve a ticket gets FORBIDDEN.
- With `urgent: true`, `routeToManager` always shows the resident exactly: "This may be an urgent hazard. A manager has been notified. If there is immediate danger, leave the area and call 911." The model's `reason` is only stored for staff.

## For Dev 4

- Use `GET /staff/queues` for the dashboard and `GET /staff/:staffId/queue` for a technician's view.
- `POST /clock/advance` returns `processed`. Show it so the demo audience can see reminders and escalations fire.
- `POST /demo/reset` restores the seed between runs. There is no resolve route on the staff side.
