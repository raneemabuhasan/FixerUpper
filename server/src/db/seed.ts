import { transaction, type DB } from './connection.ts';
import { setNow } from './clock.ts';
import { appendEvent } from '../workflow/events.ts';

// Fixed demo start so every reset produces identical data.
export const SEED_CLOCK = '2026-01-12T09:00:00.000Z';

export const RESIDENTS = [
  { id: 'mina', name: 'Mina', unit: '204' },
  { id: 'alex', name: 'Alex', unit: '108' },
];

export const STAFF = [
  { id: 'tech-sam', name: 'Sam Rivera', role: 'technician' },
  { id: 'mgr-jordan', name: 'Jordan Lee', role: 'manager' },
];

// Mirrors the three tickets mocked in web/src/api.ts.
const TICKETS = [
  {
    id: 'RES-101', title: 'Kitchen faucet dripping', category: 'Plumbing', location: 'Kitchen sink',
    status: 'awaiting resident confirmation', assigneeId: 'tech-sam', nextAction: 'Please check the repair and confirm',
    workerNote: 'Replaced faucet washer. Repair appears complete; awaiting resident confirmation.',
  },
  {
    id: 'RES-102', title: 'Dishwasher not draining', category: 'Appliance', location: 'Kitchen',
    status: 'assigned', assigneeId: 'tech-sam', nextAction: 'Your maintenance team will provide an update',
  },
  {
    id: 'RES-103', title: 'Sticking cabinet door', category: 'Carpentry', location: 'Hallway',
    status: 'submitted', assigneeId: null, nextAction: 'Your maintenance team will provide an update',
  },
];

export function seed(db: DB): void {
  transaction(db, () => {
    const at = SEED_CLOCK;
    setNow(db, at);
    const resident = db.prepare('INSERT INTO residents (id, name, unit) VALUES (?, ?, ?)');
    for (const r of RESIDENTS) resident.run(r.id, r.name, r.unit);
    const staff = db.prepare('INSERT INTO staff (id, name, role) VALUES (?, ?, ?)');
    for (const s of STAFF) staff.run(s.id, s.name, s.role);

    const ticket = db.prepare(
      `INSERT INTO tickets (id, resident_id, title, category, location, description, status, assignee_id, created_at, updated_at, next_action)
       VALUES (?, 'mina', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const t of TICKETS) {
      ticket.run(t.id, t.title, t.category, t.location, t.title, t.status, t.assigneeId, at, at, t.nextAction);
      appendEvent(db, { ticketId: t.id, at, kind: 'resident', actorType: 'resident', actorId: 'mina', type: 'created', text: 'Maintenance request submitted.' });
      if (t.workerNote)
        appendEvent(db, { ticketId: t.id, at, kind: 'worker', actorType: 'staff', actorId: t.assigneeId, type: 'repair_attempted', text: t.workerNote });
    }
  });
}
