# Resolve AI coordinator (Developer 3)

Owner: Oluwaseyi Omisore. Code: `server/src/ai/` and `server/src/routes/assistant.ts`. Tests: `server/test/ai.test.ts`.

The model reads the resident's message, asks for missing details, checks for duplicates, and calls tools. Every tool validates its arguments with Zod, then calls Dev 2's workflow services, which validate again and enforce resident scope and status rules. The model never resolves a ticket: there is no tool for it, and Dev 2's services reject any `ai` actor that tries.

## Setup

1. Create a `.env` file in the repo root (it is gitignored, so the key never gets committed):
   ```
   ANTHROPIC_API_KEY=your-key-here
   # Optional. Default: claude-sonnet-5-5
   RESOLVE_AI_MODEL=claude-sonnet-5-5
   ```
2. `npm run dev:all`, then check `GET /api/assistant/status` returns `{ "available": true }`.

Without a key the server still runs. The assistant returns `AI_UNAVAILABLE` and the rest of the app works.

`npm run test:server` runs the checks with a scripted model, so tests need no key and give the same result every time.

## Endpoint (for Dev 1)

**`GET /api/assistant/status`**: `{ "available": boolean, "model": string | null }`. Use it to show or hide the chat.

**`POST /api/residents/:residentId/assistant/messages`**

```json
{ "conversationId": "optional, from the last response", "text": "The kitchen faucet is dripping again." }
```

To answer a duplicate question, send the resident's button press instead of text:

```json
{ "conversationId": "…", "decision": { "type": "confirm_duplicate", "ticketId": "RES-101" } }
{ "conversationId": "…", "decision": { "type": "reject_duplicate", "ticketId": "RES-101" } }
```

Optional `"mode": "baseline"` uses the intake-only baseline (see Dev 4 below).

**Response (200)**

```json
{
  "conversationId": "52fdcd30-…",
  "mode": "coordinator",
  "model": "claude-sonnet-5-5",
  "reply": { "message": "Is this the same as your faucet request RES-101?", "intent": "propose_duplicate", "missing": [] },
  "proposedDuplicate": { "ticketId": "RES-101", "title": "Kitchen faucet dripping", "status": "awaiting resident confirmation", "location": "Kitchen sink" },
  "safetyNotice": null,
  "hazards": [],
  "tickets": [],
  "toolCalls": [
    { "name": "get_resident_tickets", "args": { "query": "kitchen faucet dripping" }, "success": true,
      "explanation": "Found 3 request(s). Closest match: RES-101 (Kitchen faucet dripping).", "ticketId": null }
  ]
}
```

- `reply.intent` is one of `clarify`, `propose_duplicate`, `ticket_created`, `duplicate_linked`, `escalated`, `info`, `out_of_scope`. `missing` lists `what` and/or `where` when the assistant is asking for them.
- `proposedDuplicate` is set while a yes/no is waiting. Show "Yes, same issue" and "No, different issue" buttons and send the `decision`. Typed text doesn't answer it.
- `tickets` holds the tickets created, linked or escalated in this turn, in their saved state. Refresh your list from them.
- `toolCalls` is what the AI actually did, with plain-language explanations. Failed calls have `success: false`. The same records are on `GET /residents/:residentId/tickets/:id/tool-outcomes`.
- `safetyNotice`: show it prominently whenever it's not null. The text is fixed, not written by the model:
  - after a successful urgent escalation: Dev 2's "This may be an urgent hazard. A manager has been notified. …"
  - if a hazard was detected but nothing was escalated yet (for example, during an outage): "This may be an urgent hazard. A manager has not been notified yet. …"

**Errors** use Dev 2's shape, `{ "error": { "code", "message" } }`, plus `conversationId`, `safetyNotice`, `hazards`, `tickets` and `toolCalls` so you can show anything that was saved before the failure.

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_INPUT` | 400 | No text and no decision, or text over 2000 characters |
| `NOT_FOUND` | 404 | Unknown resident |
| `BUSY` | 409 | The last message for this chat is still being answered |
| `INVALID_DECISION` | 409 | A decision about a ticket that wasn't proposed |
| `AI_UNAVAILABLE` | 503 | No key, network error or provider error. Saved data is unchanged; retry with the same `conversationId`. |
| `AI_INCOMPLETE` | 503 | The model didn't finish within 8 calls. Anything already saved stays saved. |

Chats are kept in server memory and cleared by `POST /api/demo/reset`. A restart or an unknown `conversationId` starts a new chat; tickets and history are in SQLite and are not affected.

## Tools

| Tool | Calls (Dev 2) | Extra guard |
|---|---|---|
| `get_resident_tickets` | `listTicketsForResidentView` | Ranks open tickets by word overlap with `query` |
| `create_ticket` | `createTicket` with actor `ai` | Blocked while a duplicate question is open; blocks the same issue twice in one chat |
| `link_confirmed_duplicate` | `linkDuplicate` | Only works for the ticket the resident just pressed "Yes" on; stores the resident's own words |
| `schedule_follow_up` | `scheduleFollowUp` | |
| `send_simulated_follow_up` | `sendSimulatedFollowUp` | |
| `route_to_manager` | `routeToManager` | |

The model ends each turn by calling `reply_to_resident`, a structured reply checked with Zod. It isn't a workflow action. A proposed duplicate must be one of the resident's own open tickets and not one they already said no to.

Every action call is logged with `recordToolOutcome`: tool name, arguments, success, and explanation. A call about another resident's ticket fails as not found, and its log entry isn't attached to that ticket.

## Safety nets

These run in code, so they work even when the model doesn't follow instructions:

- **Failures stay failures.** A reply sent in the same batch as a failed tool call is thrown away, and the model answers again with the failure in view.
- **Resident's "Yes" is honored.** If the resident confirms a duplicate and the model doesn't link it, the coordinator links it.
- **Hazards always escalate.** A keyword check (gas, carbon monoxide, fire or smoke, sparks or exposed wires, flooding, ceiling collapse) runs before the model. If a hazard ticket is filed but not escalated as urgent, the coordinator escalates it.
- **No hidden reasoning.** Only the `reply_to_resident` message (or plain text, if the model skips that tool) is shown. Hidden reasoning is never sent.

## For Dev 4: baseline and evaluation

- **Baseline**: send `"mode": "baseline"`. The model gets only `create_ticket` and files a ticket from every maintenance message. It doesn't ask questions, check for duplicates or escalate. Use it for the baseline comparison across the 12 scenarios.
- **Scenario coverage**: `server/test/ai.test.ts` has a scripted version of each AI behavior: intake, clarification, duplicate proposal, yes and no decisions, the model linking on its own guess, tool failures, unknown tools such as a resolve attempt, another resident's ticket, outages before and after a save, hazards, baseline, and reset. The scripted outputs there show the exact shapes the real model produces.
- **Count for the results sheet**:
  - false resolutions (target 0)
  - duplicate tickets created
  - missed clarifications
  - wrong duplicate proposals
  - failed tool calls shown as success (target 0)
