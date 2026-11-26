import type { Ticket } from './types.ts';

export function cancelRequest(ticket: Ticket): Ticket {
  if (ticket.status === 'resolved' || ticket.status === 'cancelled')
    throw new Error('This request is already closed.');
  const at = new Date().toISOString();
  return {
    ...ticket,
    status: 'cancelled',
    updatedAt: at,
    nextAction: 'Request cancelled. No further action is scheduled.',
    events: [...ticket.events, { at, kind: 'resident', text: 'Resident cancelled the maintenance request.' }],
  };
}

export function confirmRepair(ticket: Ticket, resolved: boolean): Ticket {
  if(ticket.status !== 'awaiting resident confirmation')
    throw new Error('This request is not awaiting confirmation.');
  const at = new Date().toISOString();
  return { ...ticket, status: resolved ? 'resolved' : 'awaiting update', updatedAt: at, nextAction: resolved ? 'No action needed' : 'Maintenance will review your feedback', events: [...ticket.events, { at, kind: 'resident', text: resolved ? 'Resident confirmed the repair.' : 'Resident reports the issue persists. Case reopened.' }] };
}
