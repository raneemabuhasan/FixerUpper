// Chat state lives in memory. Tickets, events and tool outcomes are in SQLite, so a server restart
// only loses the unfinished chat draft, never a saved request. An unknown conversation ID starts a new chat.
import { randomUUID } from 'node:crypto';
import type { ChatTurn } from './model.ts';

export type AssistantMode = 'coordinator' | 'baseline';

export interface PendingDuplicate {
  ticketId: string;
  // What the resident said that looks like a repeat, kept so a confirmed link records their own words.
  reportText: string;
}

export interface Conversation {
  id: string;
  residentId: string;
  mode: AssistantMode;
  // Only resident text and the assistant's resident-facing replies. Tool traffic is not replayed.
  history: ChatTurn[];
  pendingDuplicate: PendingDuplicate | null;
  // Set only by the resident pressing "Yes, same issue" for this turn. The link tool requires it.
  confirmedDuplicate: PendingDuplicate | null;
  rejectedDuplicateIds: Set<string>;
  createdTicketIds: string[];
  linkedTicketIds: string[];
  busy: boolean;
}

const MAX_HISTORY_TURNS = 20;

export class ConversationStore {
  private readonly items = new Map<string, Conversation>();

  // Returns the conversation for this resident, or a fresh one if the ID is unknown or belongs to someone else.
  getOrCreate(residentId: string, id: string | undefined, mode: AssistantMode): Conversation {
    const existing = id ? this.items.get(id) : undefined;
    if (existing && existing.residentId === residentId && existing.mode === mode) return existing;
    const created: Conversation = {
      id: randomUUID(), residentId, mode, history: [], pendingDuplicate: null, confirmedDuplicate: null,
      rejectedDuplicateIds: new Set(), createdTicketIds: [], linkedTicketIds: [], busy: false,
    };
    this.items.set(created.id, created);
    return created;
  }

  clear(): void {
    this.items.clear();
  }
}

export function trimHistory(history: ChatTurn[]): ChatTurn[] {
  const trimmed = history.slice(-MAX_HISTORY_TURNS);
  // The model API requires the first turn to be the user's.
  while (trimmed.length && trimmed[0].role !== 'user') trimmed.shift();
  return trimmed;
}
