# AI coordinator (Developer 3)

Owner: Oluwaseyi Omisore

Integrates one tool-capable model with structured outputs and server-side tools. The model interprets resident messages; the backend (Dev 2) validates and executes every action.

## Responsibilities
- Extract issue type, location, and description from resident messages.
- Ask targeted clarifications when details are missing.
- Retrieve possible duplicate cases and propose linking. Linking happens only after the resident confirms.
- Log each tool call: name, validated arguments, result, and a short user-facing explanation. Hidden model reasoning is never exposed.

## Tools (validated with Zod before execution)
| Tool | Purpose |
| --- | --- |
| `create_ticket` | Create a ticket from structured intake |
| `get_resident_tickets` | Retrieve the current resident's tickets for duplicate checks |
| `link_confirmed_duplicate` | Link a repeated report after resident confirmation |
| `schedule_follow_up` | Set a follow-up deadline on the shared demo clock |
| `send_simulated_follow_up` | Send a simulated reminder |
| `route_to_manager` | Escalate to the simulated manager queue |

Resident confirmation of a repair is never an AI tool. Only the resident interface can resolve a ticket.

## Rules
- Tool failures are reported as failures, never as successes.
- Unrelated issues stay as separate tickets.
- Human decisions override model suggestions.
- An AI outage shows a recoverable error without losing saved data.
- Supported issues: dripping faucet, dishwasher not draining, sticking cabinet door. Urgent hazards get fixed escalation messaging.

## Checks
Focused tests for structured intake, clarification, duplicate suggestions, and tool failures. An intake-only chatbot baseline and example model outputs go to Dev 4 for evaluation.
