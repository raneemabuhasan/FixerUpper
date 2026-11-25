export type Status = 'submitted' | 'assigned' | 'awaiting update' | 'awaiting resident confirmation' | 'resolved';

export interface Resident {
  id: string;
  name: string;
  unit: string;
}

export interface ActivityEvent {
  at: string;
  text: string;
  kind: 'resident' | 'worker' | 'system';
}

export interface Ticket {
  id: string;
  residentId: string;
  title: string;
  category: string;
  location: string;
  description: string;
  status: Status;
  updatedAt: string;
  nextAction: string;
  events: ActivityEvent[];
}

export interface Message {
  role: 'resident' | 'assistant';
  text: string;
}

export interface ToolOutcome {
  name: string;
  success: boolean;
  explanation: string;
}
