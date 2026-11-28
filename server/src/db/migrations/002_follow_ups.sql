-- Follow-up lifecycle: pending -> processed (fired) or superseded (ticket changed first).
-- answered_at marks a fired reminder as acted on (the ticket's status changed afterwards).
ALTER TABLE follow_ups ADD COLUMN superseded_at TEXT;
ALTER TABLE follow_ups ADD COLUMN answered_at TEXT;
ALTER TABLE follow_ups ADD COLUMN recipient_type TEXT CHECK (recipient_type IN ('resident', 'staff', 'manager'));
ALTER TABLE follow_ups ADD COLUMN recipient_id TEXT;
-- Reminder text, or the escalation reason.
ALTER TABLE follow_ups ADD COLUMN message TEXT;
ALTER TABLE follow_ups ADD COLUMN source_event_id INTEGER REFERENCES events(id);
ALTER TABLE follow_ups ADD COLUMN created_by_type TEXT CHECK (created_by_type IN ('resident', 'staff', 'ai', 'system'));
ALTER TABLE follow_ups ADD COLUMN created_by_id TEXT;
ALTER TABLE follow_ups ADD COLUMN created_at TEXT;
CREATE INDEX follow_ups_due_idx ON follow_ups(due_at) WHERE processed_at IS NULL AND superseded_at IS NULL;

-- messages: allow system-sent reminders addressed to a resident or a staff member.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt.
CREATE TABLE messages_new (
  id             INTEGER PRIMARY KEY,
  ticket_id      TEXT REFERENCES tickets(id),
  -- The resident whose conversation/ticket this belongs to.
  resident_id    TEXT NOT NULL REFERENCES residents(id),
  role           TEXT NOT NULL CHECK (role IN ('resident', 'assistant', 'system')),
  text           TEXT NOT NULL,
  at             TEXT NOT NULL,
  recipient_type TEXT CHECK (recipient_type IN ('resident', 'staff')),
  recipient_id   TEXT,
  follow_up_id   INTEGER REFERENCES follow_ups(id)
);
INSERT INTO messages_new (id, ticket_id, resident_id, role, text, at)
  SELECT id, ticket_id, resident_id, role, text, at FROM messages;
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX messages_recipient_idx ON messages(recipient_type, recipient_id);
