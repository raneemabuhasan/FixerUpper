# Resolve API contract

Base URL: `http://127.0.0.1:3001/api`. In dev, Vite proxies `/api`, so the frontend can call `fetch('/api/...')` with no CORS setup. Start both with `npm run dev:all`.

All samples below were captured from a running server right after `POST /api/demo/reset`. Long responses are trimmed, and each trim is marked.

## Conventions

**JSON in, JSON out.** Request bodies are validated with Zod. Unknown extra fields are ignored.

**Errors** always look like this:

```json
{ "error": { "code": "INVALID_INPUT", "message": "Invalid body: resolved: expected boolean, received string" } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_INPUT` | 400 | Bad body, bad path param, or malformed JSON |
| `FORBIDDEN` | 403 | `staffId` isn't a real staff member, or the actor isn't allowed to take the action |
| `NOT_FOUND` | 404 | Unknown resident, unknown route, or a ticket that doesn't exist **or belongs to another resident** (IDs never leak) |
| `INVALID_TRANSITION` | 409 | The ticket's status doesn't allow the action, e.g. confirming a ticket that isn't awaiting confirmation |
| `INTERNAL` | 500 | Unexpected server error. The message is generic and never includes a stack trace. |

**Ticket**: a superset of `Ticket` in `shared/types.ts`. Every shared field is present with the same name and type, and the extras are additive.

| Field | Type | Notes |
|---|---|---|
| `id`, `residentId`, `title`, `category`, `location`, `description`, `updatedAt`, `nextAction` | string | Same as shared |
| `status` | string | `submitted`, `assigned`, `awaiting update`, `awaiting resident confirmation`, `resolved`, `cancelled` |
| `events` | array | Oldest first. Each event has `{ at, text, kind }` as in shared, plus `id`, `type`, `actorType`, `actorId` |
| `createdAt` | string | extra |
| `assigneeId` | string \| null | extra |
| `escalated` | boolean | extra; escalation is a flag, not a status |
| `nextFollowUpAt` | string \| null | extra: earliest pending follow-up, or null |

Event `type` is one of `created`, `assigned`, `inspected`, `repair_attempted`, `confirmation_requested`, `resident_confirmed`, `resident_rejected`, `reopened`, `cancelled`, `duplicate_linked`, `follow_up_scheduled`, `follow_up_sent`, `escalated`, `escalation_reviewed`.

All timestamps come from the **simulated demo clock** (`GET /api/clock`), not wall time.

### Ticket lifecycle

```
submitted --assign--> assigned --inspect/repair--> awaiting update --request-confirmation--> awaiting resident confirmation
                                                       ^                                       |            |
                                                       +------- resident confirms "no" --------+   resident confirms "yes"
                                                                (same ID, history kept)                     v
                                                                                                        resolved
any open status --resident cancels--> cancelled          (nothing leaves resolved or cancelled)
```

- `request-confirmation` requires a `repair` logged since the ticket was last reopened.
- **Only the ticket's own resident can resolve it.** No staff route can resolve a ticket, and none will be added.

### Follow-ups and escalation

Follow-ups are scheduled on the simulated clock and fire when `POST /api/clock/advance` runs, or on the server's 30-second timer.

A follow-up cycle starts whenever a ticket **enters** one of these statuses:

| Status entered | Entered via | +24h | Escalation |
|---|---|---|---|
| `assigned` | `assign` | Technician reminder: "No update logged" | +48h: "No update logged within 48 hours of assignment" |
| `awaiting update` | `inspect`, a first `repair` from `assigned`, or a resident rejection | Technician reminder: "Reopened/inspected with no new repair logged" | +48h: "No new repair logged within 48 hours" |
| `awaiting resident confirmation` | `request-confirmation` | Resident reminder: "Please confirm whether the repair worked" | +72h: "Resident has not confirmed the repair within 72 hours" |

- **Any status change** (including resolve, cancel and reopen) supersedes the ticket's pending follow-ups before the new cycle is scheduled, so cycles never stack. For example, the first inspection ends the `assign` cycle.
- **Updates that keep the status the same don't touch follow-ups.** Logging another `repair` while already `awaiting update` leaves the stalled cycle as it is, with nothing superseded and nothing duplicated.
- A rejection starts a stalled cycle. The next `request-confirmation` replaces it with a new confirmation cycle.

Sample: resident rejects RES-101, then `POST /api/clock/advance {"hours":25}`:
```json
{
  "clock": "2026-01-13T10:00:00.000Z",
  "processed": [
    {
      "followUpId": 1,
      "ticketId": "RES-101",
      "dueKey": "stalled-reminder:6",
      "dueAt": "2026-01-13T09:00:00.000Z",
      "action": "reminder",
      "recipientType": "staff",
      "recipientId": "tech-sam",
      "recipientName": "Sam Rivera",
      "text": "Reminder sent to Sam Rivera (technician): Reopened/inspected with no new repair logged."
    }
  ]
}
```
A further 24h fires `stalled-escalate:6` (`"Escalated to a manager: No new repair logged within 48 hours."`). The status stays `awaiting update`.
- Each follow-up has a `due_key` like `confirm-reminder:<eventId>`, where `<eventId>` is the event that scheduled it. Each follow-up fires at most once, no matter how often processing runs.
- **Silence never resolves a ticket.** After a week with no answer, a ticket is still `awaiting resident confirmation`, with one reminder and one escalation sent.
- **Escalation is a flag, not a status.** It sets `escalated: true` and puts the ticket in the manager queue until a manager reviews it.
- A reminder event's `at` is the time it was due, so the timeline reads naturally even after a big clock jump.

---

## Resident routes

Every route is scoped by `:residentId`. A ticket belonging to another resident returns **404**.

### `GET /api/residents`
Errors: none.
```json
[
  { "id": "alex", "name": "Alex", "unit": "108" },
  { "id": "mina", "name": "Mina", "unit": "204" }
]
```

### `GET /api/residents/:residentId/tickets`
Returns the resident's tickets, most recently updated first (ties go to the newest created). Errors: `400`, `404` (unknown resident).
```jsonc
[
  {
    "id": "RES-103",
    "residentId": "mina",
    "title": "Sticking cabinet door",
    "category": "Carpentry",
    "location": "Hallway",
    "description": "Sticking cabinet door",
    "status": "submitted",
    "updatedAt": "2026-01-12T09:00:00.000Z",
    "nextAction": "Your maintenance team will provide an update",
    "events": [
      { "at": "2026-01-12T09:00:00.000Z", "text": "Maintenance request submitted.", "kind": "resident",
        "id": 4, "type": "created", "actorType": "resident", "actorId": "mina" }
    ],
    "createdAt": "2026-01-12T09:00:00.000Z",
    "assigneeId": null,
    "escalated": false,
    "nextFollowUpAt": null
  }
  // trimmed: RES-102 (assigned) and RES-101 (awaiting resident confirmation) follow
]
```
`GET /api/residents/alex/tickets` returns `[]`.

### `GET /api/residents/:residentId/tickets/:id`
Errors: `400`, `404`.
```json
{
  "id": "RES-101",
  "residentId": "mina",
  "title": "Kitchen faucet dripping",
  "category": "Plumbing",
  "location": "Kitchen sink",
  "description": "Kitchen faucet dripping",
  "status": "awaiting resident confirmation",
  "updatedAt": "2026-01-12T09:00:00.000Z",
  "nextAction": "Please check the repair and confirm",
  "events": [
    { "at": "2026-01-12T09:00:00.000Z", "text": "Maintenance request submitted.", "kind": "resident",
      "id": 1, "type": "created", "actorType": "resident", "actorId": "mina" },
    { "at": "2026-01-12T09:00:00.000Z", "text": "Replaced faucet washer. Repair appears complete; awaiting resident confirmation.", "kind": "worker",
      "id": 2, "type": "repair_attempted", "actorType": "staff", "actorId": "tech-sam" }
  ],
  "createdAt": "2026-01-12T09:00:00.000Z",
  "assigneeId": "tech-sam",
  "escalated": false,
  "nextFollowUpAt": null
}
```
`GET /api/residents/alex/tickets/RES-101` returns **404**:
```json
{ "error": { "code": "NOT_FOUND", "message": "Ticket RES-101 not found." } }
```

### `POST /api/residents/:residentId/tickets`
Body: `{ description: string, location: string, title?: string, category?: string }`. `title` defaults to the first line of `description` (up to 120 chars), and `category` defaults to `"Maintenance"`. IDs continue the `RES-###` sequence. Returns **201**. Errors: `400`, `404` (unknown resident).

Request: `{"description":"Bathroom sink drains slowly","location":"Bathroom"}`
```json
{
  "id": "RES-104",
  "residentId": "mina",
  "title": "Bathroom sink drains slowly",
  "category": "Maintenance",
  "location": "Bathroom",
  "description": "Bathroom sink drains slowly",
  "status": "submitted",
  "updatedAt": "2026-01-12T09:00:00.000Z",
  "nextAction": "Maintenance will review your request",
  "events": [
    { "at": "2026-01-12T09:00:00.000Z", "text": "Maintenance request submitted.", "kind": "resident",
      "id": 5, "type": "created", "actorType": "resident", "actorId": "mina" }
  ],
  "createdAt": "2026-01-12T09:00:00.000Z",
  "assigneeId": null,
  "escalated": false,
  "nextFollowUpAt": null
}
```
A bad body (`{"location":""}`) returns **400**:
```json
{ "error": { "code": "INVALID_INPUT", "message": "Invalid body: description: expected string, received undefined; location: Too small: expected string to have >=1 characters" } }
```

### `POST /api/residents/:residentId/tickets/:id/confirm`
Body: `{ resolved: boolean }`. Only works while the ticket is `awaiting resident confirmation`.
- `true` sets the status to `resolved`.
- `false` sets the status to `awaiting update`. The ticket keeps its ID and full history, and gains `resident_rejected` and `reopened` events.

Errors: `400`, `404`, `409`.

Request: `{"resolved":false}` on RES-101
```json
{
  "id": "RES-101",
  "residentId": "mina",
  "title": "Kitchen faucet dripping",
  "category": "Plumbing",
  "location": "Kitchen sink",
  "description": "Kitchen faucet dripping",
  "status": "awaiting update",
  "updatedAt": "2026-01-12T09:00:00.000Z",
  "nextAction": "Maintenance will review your feedback",
  "events": [
    { "at": "2026-01-12T09:00:00.000Z", "text": "Maintenance request submitted.", "kind": "resident",
      "id": 1, "type": "created", "actorType": "resident", "actorId": "mina" },
    { "at": "2026-01-12T09:00:00.000Z", "text": "Replaced faucet washer. Repair appears complete; awaiting resident confirmation.", "kind": "worker",
      "id": 2, "type": "repair_attempted", "actorType": "staff", "actorId": "tech-sam" },
    { "at": "2026-01-12T09:00:00.000Z", "text": "Resident reports the issue persists.", "kind": "resident",
      "id": 7, "type": "resident_rejected", "actorType": "resident", "actorId": "mina" },
    { "at": "2026-01-12T09:00:00.000Z", "text": "Case reopened.", "kind": "system",
      "id": 8, "type": "reopened", "actorType": "resident", "actorId": "mina" }
  ],
  "createdAt": "2026-01-12T09:00:00.000Z",
  "assigneeId": "tech-sam",
  "escalated": false,
  "nextFollowUpAt": null
}
```
Request: `{"resolved":true}` (on RES-104 after a repair and a confirmation request). Excerpt:
```json
{ "id": "RES-104", "status": "resolved", "nextAction": "No action needed",
  "lastEvent": { "at": "2026-01-12T09:00:00.000Z", "text": "Resident confirmed the repair.", "kind": "resident",
                 "id": 14, "type": "resident_confirmed", "actorType": "resident", "actorId": "mina" } }
```
A bad body (`{"resolved":"yes"}`) returns **400**:
```json
{ "error": { "code": "INVALID_INPUT", "message": "Invalid body: resolved: expected boolean, received string" } }
```

### `POST /api/residents/:residentId/tickets/:id/link`
Body: `{ reportText: string }`. This records that a new report from the resident is a repeat of this ticket. It writes a `duplicate_links` row and a `duplicate_linked` event, and **does not create a ticket**. It only works on the resident's own open ticket. Errors: `400`, `404`, `409` (ticket is resolved or cancelled).

Request: `{"reportText":"The bathroom sink is still backing up"}`
```json
{
  "id": "RES-104",
  "residentId": "mina",
  "title": "Bathroom sink drains slowly",
  "category": "Maintenance",
  "location": "Bathroom",
  "description": "Bathroom sink drains slowly",
  "status": "submitted",
  "updatedAt": "2026-01-12T09:00:00.000Z",
  "nextAction": "Maintenance will review your request",
  "events": [
    { "at": "2026-01-12T09:00:00.000Z", "text": "Maintenance request submitted.", "kind": "resident",
      "id": 5, "type": "created", "actorType": "resident", "actorId": "mina" },
    { "at": "2026-01-12T09:00:00.000Z", "text": "Resident confirmed a repeated report belongs to this request.", "kind": "resident",
      "id": 6, "type": "duplicate_linked", "actorType": "resident", "actorId": "mina" }
  ],
  "createdAt": "2026-01-12T09:00:00.000Z",
  "assigneeId": null,
  "escalated": false,
  "nextFollowUpAt": null
}
```

### `POST /api/residents/:residentId/tickets/:id/cancel`
Body: optional `{ reason?: string }`. You can send no body at all. Works from any open status. Errors: `400`, `404`, `409` (already resolved or cancelled).

Request: `{"reason":"Fixed it myself"}` on RES-103. Excerpt:
```json
{ "id": "RES-103", "status": "cancelled", "nextAction": "Request cancelled. No further action is scheduled.",
  "lastEvent": { "at": "2026-01-12T09:00:00.000Z", "text": "Resident cancelled the maintenance request.", "kind": "resident",
                 "id": 9, "type": "cancelled", "actorType": "resident", "actorId": "mina" } }
```

### `GET /api/residents/:residentId/tickets/:id/tool-outcomes`
Returns what the AI tools did on this ticket, oldest first. The list is written by `recordToolOutcome` (see the Dev 3 section). Errors: `400`, `404` (including another resident's ticket).
```json
[
  {
    "id": 1,
    "ticketId": "RES-104",
    "name": "find_duplicates",
    "args": { "query": "bathroom sink drain" },
    "success": true,
    "explanation": "One open ticket matched: RES-104.",
    "at": "2026-01-14T10:00:00.000Z"
  }
]
```
`GET /api/residents/alex/tickets/RES-104/tool-outcomes` returns **404**: `{"error":{"code":"NOT_FOUND","message":"Ticket RES-104 not found."}}`

---

## Staff routes

Every mutation takes a `staffId` in the body, and it must belong to a real staff member. An unknown ID returns **403**. Any staff member can perform any staff action. **There is no resolve route.** For example, `POST /api/staff/tickets/RES-101/resolve` returns **404** `{"error":{"code":"NOT_FOUND","message":"No route for POST /api/staff/tickets/RES-101/resolve."}}`.

### `GET /api/staff`
```json
[
  { "id": "mgr-jordan", "name": "Jordan Lee", "role": "manager" },
  { "id": "tech-sam", "name": "Sam Rivera", "role": "technician" }
]
```

### `GET /api/staff/tickets`
Returns every resident's tickets, newest updated first, with `residentName` and `residentUnit` added. Excerpt of the first element (`events` trimmed):
```json
{ "id": "RES-104", "residentId": "mina", "title": "Bathroom sink drains slowly", "category": "Maintenance",
  "location": "Bathroom", "description": "Bathroom sink drains slowly", "status": "resolved",
  "updatedAt": "2026-01-12T09:00:00.000Z", "nextAction": "No action needed", "events": "[…]",
  "createdAt": "2026-01-12T09:00:00.000Z", "assigneeId": "tech-sam", "escalated": false, "nextFollowUpAt": null,
  "residentName": "Mina", "residentUnit": "204" }
```

### `GET /api/staff/queues`
Returns `{ open, awaitingConfirmation, overdue, managerQueue }`. Each is an array of staff tickets, in the same shape as above.
- `open`: every ticket that isn't resolved or cancelled
- `overdue`: an open ticket that has a reminder that fired with no status change since, or a `nextFollowUpAt` earlier than the clock
- `managerQueue`: every `escalated` ticket, until a manager reviews it

Excerpt, IDs only, taken after RES-104 was assigned and the clock advanced 49h:
```json
{ "open": ["RES-104", "RES-103", "RES-102", "RES-101"], "awaitingConfirmation": ["RES-101"], "overdue": ["RES-104"], "managerQueue": ["RES-104"] }
```

### `GET /api/staff/:staffId/queue`
Returns a technician's open assigned tickets, plus reminders addressed to them that they haven't acted on. A reminder counts as acted on once the ticket's status changes, for example when they log an inspection. Errors: `400`, `404` (unknown staff).

Sample taken after assign and a 25h advance. Excerpt: each ticket is a full staff ticket, cut down here to `id`, `status` and `nextFollowUpAt`.
```json
{
  "staff": { "id": "tech-sam", "name": "Sam Rivera", "role": "technician" },
  "tickets": [
    { "id": "RES-104", "status": "assigned", "nextFollowUpAt": "2026-01-14T09:00:00.000Z" },
    { "id": "RES-102", "status": "assigned", "nextFollowUpAt": null },
    { "id": "RES-101", "status": "awaiting resident confirmation", "nextFollowUpAt": null }
  ],
  "reminders": [
    { "messageId": 1, "followUpId": 1, "ticketId": "RES-104",
      "text": "RES-104 \"Bathroom sink drains slowly\": No update logged.", "at": "2026-01-13T09:00:00.000Z" }
  ]
}
```

### `POST /api/staff/tickets/:id/escalation/review`
Body: `{ staffId, note }`. This is the **manager-only** human review of an escalation. It records an `escalation_reviewed` event and clears `escalated`. The status doesn't change. Errors:
- `400` bad body
- `403` technician or unknown staff (`"Only a manager can review an escalation."`)
- `404` unknown ticket
- `409` the ticket isn't escalated (`"Ticket RES-104 is not escalated."`)

Excerpt: last three events only.
```json
{
  "id": "RES-104",
  "status": "assigned",
  "escalated": false,
  "nextFollowUpAt": null,
  "events": [
    { "at": "2026-01-13T09:00:00.000Z", "text": "Reminder sent to Sam Rivera (technician): No update logged.", "kind": "system",
      "id": 7, "type": "follow_up_sent", "actorType": "system", "actorId": "follow-up-processor" },
    { "at": "2026-01-14T09:00:00.000Z", "text": "Escalated to a manager: No update logged within 48 hours of assignment.", "kind": "system",
      "id": 8, "type": "escalated", "actorType": "system", "actorId": "follow-up-processor" },
    { "at": "2026-01-14T10:00:00.000Z", "text": "Escalation reviewed by Jordan Lee: Called Sam; visit booked for today.", "kind": "worker",
      "id": 9, "type": "escalation_reviewed", "actorType": "staff", "actorId": "mgr-jordan" }
  ]
}
```

### `POST /api/staff/tickets/:id/assign`
Body: `{ staffId, assigneeId }`. Moves the ticket from `submitted` to `assigned`. Errors: `400` (including an unknown `assigneeId`), `403`, `404`, `409`.
```json
{ "id": "RES-104", "status": "assigned", "nextAction": "Your maintenance team will provide an update", "assigneeId": "tech-sam",
  "lastEvent": { "at": "2026-01-12T09:00:00.000Z", "text": "Assigned to Sam Rivera.", "kind": "worker",
                 "id": 10, "type": "assigned", "actorType": "staff", "actorId": "mgr-jordan" } }
```
Response excerpt. The real response is a full Ticket, and the same is true for every route below.

### `POST /api/staff/tickets/:id/inspect`
Body: `{ staffId, note }`. `note` is required. Moves the ticket from `assigned` or `awaiting update` to `awaiting update`. Errors: `400`, `403`, `404`, `409`.
```json
{ "id": "RES-104", "status": "awaiting update", "nextAction": "Maintenance will follow up with next steps",
  "lastEvent": { "text": "Hair clog in P-trap.", "kind": "worker", "id": 11, "type": "inspected", "actorType": "staff", "actorId": "tech-sam" } }
```

### `POST /api/staff/tickets/:id/repair`
Body: `{ staffId, note }`. `note` is required. Moves the ticket from `assigned` or `awaiting update` to `awaiting update` and records a repair attempt. Errors: `400`, `403`, `404`, `409`.
```json
{ "id": "RES-104", "status": "awaiting update", "nextAction": "Maintenance will let you know when the repair is ready for review",
  "lastEvent": { "text": "Cleared P-trap.", "kind": "worker", "id": 12, "type": "repair_attempted", "actorType": "staff", "actorId": "tech-sam" } }
```

### `POST /api/staff/tickets/:id/request-confirmation`
Body: `{ staffId, note? }`. Moves the ticket from `awaiting update` to `awaiting resident confirmation`, but only if a repair has been logged since the last reopen. Errors: `400`, `403`, `404`, `409`.
```json
{ "id": "RES-104", "status": "awaiting resident confirmation", "nextAction": "Please check the repair and confirm",
  "lastEvent": { "text": "Repair is ready for review; awaiting resident confirmation.", "kind": "worker",
                 "id": 13, "type": "confirmation_requested", "actorType": "staff", "actorId": "tech-sam" } }
```
Calling it on RES-102 while the ticket is `assigned` returns **409**:
```json
{ "error": { "code": "INVALID_TRANSITION", "message": "Cannot request_confirmation a ticket that is assigned." } }
```
Without a fresh repair, it returns **409** `"Record a repair attempt before requesting resident confirmation."`

An unknown `staffId` returns **403**:
```json
{ "error": { "code": "FORBIDDEN", "message": "Only maintenance staff can do that." } }
```

---

## Demo routes

### `GET /api/clock`
```json
{ "clock": "2026-01-12T09:00:00.000Z" }
```

### `POST /api/clock/advance`
Body: `{ hours: number }`, which must be positive and at most 8760. Moves the clock forward, then fires every follow-up that is now due. `processed` lists what fired, oldest due first, so the demo can show it. Errors: `400`.

Request: `{"hours":25}`, sent 25h after RES-104 was assigned.
```json
{
  "clock": "2026-01-13T10:00:00.000Z",
  "processed": [
    {
      "followUpId": 1,
      "ticketId": "RES-104",
      "dueKey": "assign-reminder:6",
      "dueAt": "2026-01-13T09:00:00.000Z",
      "action": "reminder",
      "recipientType": "staff",
      "recipientId": "tech-sam",
      "recipientName": "Sam Rivera",
      "text": "Reminder sent to Sam Rivera (technician): No update logged."
    }
  ]
}
```
Request: `{"hours":24}`, sent next.
```json
{
  "clock": "2026-01-14T10:00:00.000Z",
  "processed": [
    {
      "followUpId": 2,
      "ticketId": "RES-104",
      "dueKey": "assign-escalate:6",
      "dueAt": "2026-01-14T09:00:00.000Z",
      "action": "escalate",
      "recipientType": "manager",
      "recipientId": null,
      "recipientName": "Manager queue",
      "text": "Escalated to a manager: No update logged within 48 hours of assignment."
    }
  ]
}
```
If nothing is due, `processed` is `[]`.

### `POST /api/demo/reset`
Drops all data, re-runs migrations and re-seeds. No body.
```json
{ "ok": true, "clock": "2026-01-12T09:00:00.000Z" }
```

### `GET /api/health`
```json
{ "ok": true, "clock": "2026-01-12T09:00:00.000Z" }
```

---

## For Dev 1: mapping `web/src/api.ts` to endpoints

The response shapes already match `shared/types.ts`, so this should only require changes inside `api.ts`.

| `api.ts` today | Endpoint | Notes |
|---|---|---|
| `residents` (hard-coded) | `GET /api/residents` | Optional; same `{ id, name, unit }` shape |
| `list(residentId)` | `GET /api/residents/:residentId/tickets` | Returns `Ticket[]`, newest first |
| `create(residentId, description, location)` | `POST /api/residents/:residentId/tickets` `{ description, location }` | Returns the new `Ticket` (201). You can also pass `title` and `category`. |
| `confirm(id, residentId, yes)` | `POST /api/residents/:residentId/tickets/:id/confirm` `{ resolved: yes }` | Returns the updated `Ticket` |
| `link(id, residentId)` | `POST /api/residents/:residentId/tickets/:id/link` `{ reportText }` | `reportText` is **required**. Pass the description the resident just typed. |
| `cancel(id, residentId)` (Raneem's branch) | `POST /api/residents/:residentId/tickets/:id/cancel` | Body optional |

Example:
```ts
async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error.message);
  return json;
}
```

Note: `status` can be `'cancelled'`, which is in `shared/types.ts` on Raneem's branch but not yet on `main`.

## For Dev 3: service functions to call from AI tools

Import these from `server/src/workflow/tickets.service.ts`. They are the same functions the HTTP routes call. They validate their own input and throw `WorkflowError` (`err.code` is one of the codes above), and each write runs in a single transaction.

| Function | Use for |
|---|---|
| `createTicket(db, residentId, { description, location, title?, category? }, source?)` | Filing a new request. Pass `source = { type: 'ai', id: 'intake-assistant' }` so the `created` event records that the AI filed it for the resident. |
| `linkDuplicate(db, ticketId, residentId, reportText)` | After the resident confirms that a new report is the same issue. Only works on their own open ticket. |
| `listTicketsForResidentView(db, residentId)` | Finding candidate duplicates and answering status questions. Scoped to that resident only. |
| `getResidentTicket(db, residentId, ticketId)` | Reading one ticket. Throws NOT_FOUND if it belongs to someone else. |

Follow-up and escalation services are in `server/src/workflow/followups.service.ts`. Each one checks the resident's scope, rejects resolved and cancelled tickets with `INVALID_TRANSITION`, and records who called it. Pass `source` as `{ type: 'ai' | 'system', id }`; it defaults to `{ type: 'ai', id: 'assistant' }`.

| Function | Use for |
|---|---|
| `scheduleFollowUp(db, ticketId, residentId, { hoursFromNow, action: 'reminder' \| 'escalate', reason }, source?)` | "I'll check back with you tomorrow." A `reminder` goes to the resident with `reason` as its text. An `escalate` puts the ticket in the manager queue when due. Writes a `follow_up_scheduled` event. `hoursFromNow` can be up to 720. |
| `sendSimulatedFollowUp(db, ticketId, residentId, { text }, source?)` | Sends a message to the resident immediately, and writes a `follow_up_sent` event. |
| `routeToManager(db, ticketId, residentId, { reason, urgent? }, source?)` | Flags the ticket for a manager and writes an `escalated` event. `reason` is saved for staff only. **The resident-facing text is always fixed.** With `urgent: true` it is `URGENT_HAZARD_MESSAGE`: *"This may be an urgent hazard. A manager has been notified. If there is immediate danger, leave the area and call 911."* Otherwise it is *"A manager has been asked to review this request."* Model text is never shown to the resident here. |
| `recordToolOutcome(db, { ticketId?, name, args?, success, explanation })` | Log every tool call. `args` is any JSON value. Shown by `GET .../tool-outcomes`. |
| `getToolOutcomes(db, ticketId)` | Read back the outcomes for one ticket. |

None of these change a ticket's status. They can't resolve a ticket, and the tests check that.

**Resident confirmation is intentionally NOT available as a tool.** Resolving a ticket requires the resident to explicitly click confirm (`POST .../confirm`). The state machine rejects resolution by any `ai`, `staff` or `system` actor with `FORBIDDEN`, so an AI tool can't close a ticket even by mistake. Don't wrap `residentAction` or `applyAction` in a tool.
