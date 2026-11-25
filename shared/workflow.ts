import type { Ticket } from './types.ts';

export function confirmRepair(ticket: Ticket, resolved: boolean): Ticket {
  if(ticket.status !== 'awaiting resident confirmation')
    throw new Error('This request is not awaiting confirmation.');
  const at = new Date().toISOString();
  return { ...ticket, status: resolved ? 'resolved' : 'awaiting update', updatedAt: at, nextAction: resolved ? 'No action needed' : 'Staff will review your feedback', events: [...ticket.events, { at, kind: 'resident', text: resolved ? 'Resident confirmed the repair.' : 'Resident reports the issue persists. Case reopened.' }] };
}
