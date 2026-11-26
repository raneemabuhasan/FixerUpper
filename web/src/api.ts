import type { Ticket } from '../../shared/types';
import { cancelRequest, confirmRepair } from '../../shared/workflow';

export const residents = [{ id: 'mina', name: 'Mina', unit: '204' }, { id: 'alex', name: 'Alex', unit: '108' }];
const now = new Date().toISOString();
const seed: Ticket[] = ['Kitchen faucet dripping', 'Dishwasher not draining', 'Sticking cabinet door'].map((title, i) => ({ id: `RES-10${i + 1}`, residentId: 'mina', title, category: ['Plumbing', 'Appliance', 'Carpentry'][i], location: ['Kitchen sink', 'Kitchen', 'Hallway'][i], description: title, status: i === 0 ? 'awaiting resident confirmation' : i === 1 ? 'assigned' : 'submitted', updatedAt: now, nextAction: i === 0 ? 'Please check the repair and confirm' : 'Your maintenance team will provide an update', events: [{ at: now, kind: 'resident', text: 'Maintenance request submitted.' }, ...(i === 0 ? [{ at: now, kind: 'worker' as const, text: 'Replaced faucet washer. Repair appears complete; awaiting resident confirmation.' }] : [])] }));

function read(): Ticket[] {
  const raw = localStorage.getItem('resolve-tickets');
  return (raw ? JSON.parse(raw) : seed);
}

function save(t: Ticket[]) {
  localStorage.setItem('resolve-tickets', JSON.stringify(t));
}

export const api = {
  async list(residentId: string) {
    return read().filter(t => t.residentId === residentId);
  }, async confirm(id: string, residentId: string, yes: boolean) {
    save(read().map(t => t.id === id && t.residentId === residentId ? confirmRepair(t, yes) : t));
  }, async cancel(id: string, residentId: string) {
    const tickets = read();
    const ticket = tickets.find(t => t.id === id && t.residentId === residentId);
    if (!ticket) throw new Error('Request not found.');
    const cancelled = cancelRequest(ticket);
    save(tickets.map(t => t.id === id && t.residentId === residentId ? cancelled : t));
  }, async create(residentId: string, description: string, location: string) {
    const at = new Date().toISOString();
    const t: Ticket = { id: `RES-${Date.now()}`, residentId, title: description, description, location, category: 'Maintenance', status: 'submitted', updatedAt: at, nextAction: 'Maintenance will review your request', events: [{ at, kind: 'resident', text: 'Request submitted through demo intake.' }] };
    save([...read(), t]);
    return t;
  }, async link(id: string, residentId: string) {
    save(read().map(t => t.id === id && t.residentId === residentId ? { ...t, events: [...t.events, { at: new Date().toISOString(), kind: 'resident' as const, text: 'Resident confirmed a repeated report belongs to this request.' }] } : t));
  }
};
