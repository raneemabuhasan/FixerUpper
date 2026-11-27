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
| `nextFollowUpAt` | string \| null | extra (Phase 3) |

Event `type` is one of `created`, `assigned`, `inspected`, `repair_attempted`, `confirmation_requested`, `resident_confirmed`, `resident_rejected`, `reopened`, `cancelled`, `duplicate_linked`, `follow_up_sent`, `escalated`.

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
- `overdue`: `nextFollowUpAt` is earlier than the clock
- `managerQueue`: `escalated` tickets

`overdue` and `managerQueue` stay empty until Phase 3. Excerpt, IDs only:
```json
{ "open": ["RES-102", "RES-101"], "awaitingConfirmation": [], "overdue": [], "managerQueue": [] }
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
Body: `{ hours: number }`, which must be positive and at most 8760. In Phase 3 this will also process follow-ups that come due. Errors: `400`.

Request: `{"hours":48}`
```json
{ "clock": "2026-01-14T09:00:00.000Z" }
```

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

To log what a tool did, write rows to the `messages` and `tool_outcomes` tables (the schema is already there).

**Resident confirmation is intentionally NOT available as a tool.** Resolving a ticket requires the resident to explicitly click confirm (`POST .../confirm`). The state machine rejects resolution by any `ai`, `staff` or `system` actor with `FORBIDDEN`, so an AI tool can't close a ticket even by mistake. Don't wrap `residentAction` or `applyAction` in a tool.
