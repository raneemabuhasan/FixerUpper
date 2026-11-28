-- Initial schema. /*TICKET_STATUSES*/ is replaced with the quoted list from
-- server/src/workflow/status.ts when this migration runs.

CREATE TABLE residents (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL
);

CREATE TABLE staff (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('technician', 'manager'))
);

CREATE TABLE tickets (
  id                TEXT PRIMARY KEY,
  resident_id       TEXT NOT NULL REFERENCES residents(id),
  title             TEXT NOT NULL,
  category          TEXT NOT NULL,
  location          TEXT NOT NULL,
  description       TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN (/*TICKET_STATUSES*/)),
  assignee_id       TEXT REFERENCES staff(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  next_action       TEXT NOT NULL,
  next_follow_up_at TEXT,
  -- Escalation is a flag for the manager queue, not a status.
  escalated_at      TEXT
);
CREATE INDEX tickets_resident_idx ON tickets(resident_id);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES tickets(id),
  at         TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('resident', 'worker', 'system')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('resident', 'staff', 'ai', 'system')),
  actor_id   TEXT,
  -- Allowed values live in server/src/workflow/events.ts (EVENT_TYPES).
  type       TEXT NOT NULL,
  text       TEXT NOT NULL,
  data       TEXT CHECK (data IS NULL OR json_valid(data))
);
CREATE INDEX events_ticket_idx ON events(ticket_id, id);

CREATE TABLE messages (
  id          INTEGER PRIMARY KEY,
  ticket_id   TEXT REFERENCES tickets(id),
  resident_id TEXT NOT NULL REFERENCES residents(id),
  role        TEXT NOT NULL CHECK (role IN ('resident', 'assistant')),
  text        TEXT NOT NULL,
  at          TEXT NOT NULL
);

CREATE TABLE tool_outcomes (
  id          INTEGER PRIMARY KEY,
  ticket_id   TEXT REFERENCES tickets(id),
  name        TEXT NOT NULL,
  args        TEXT CHECK (args IS NULL OR json_valid(args)),
  success     INTEGER NOT NULL CHECK (success IN (0, 1)),
  explanation TEXT NOT NULL,
  at          TEXT NOT NULL
);

CREATE TABLE duplicate_links (
  id                       INTEGER PRIMARY KEY,
  ticket_id                TEXT NOT NULL REFERENCES tickets(id),
  linked_report_text       TEXT NOT NULL,
  confirmed_by_resident_id TEXT NOT NULL REFERENCES residents(id),
  at                       TEXT NOT NULL
);

CREATE TABLE follow_ups (
  id           INTEGER PRIMARY KEY,
  ticket_id    TEXT NOT NULL REFERENCES tickets(id),
  due_key      TEXT NOT NULL,
  due_at       TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('reminder', 'escalate')),
  processed_at TEXT,
  UNIQUE (ticket_id, due_key)
);

CREATE TABLE clock (
  id  INTEGER PRIMARY KEY CHECK (id = 1),
  now TEXT NOT NULL
);
