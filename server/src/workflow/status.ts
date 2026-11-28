// Single source of truth for ticket statuses. Strings match shared/types.ts exactly.
// The tickets.status CHECK constraint is generated from this list (see db/migrate.ts),
// so adding a status is one line here followed by `npm run db:reset`.
export const STATUSES = [
  'submitted',
  'assigned',
  // 'in progress', // pending team decision
  'awaiting update',
  'awaiting resident confirmation',
  'resolved',
  'cancelled',
] as const;

export type Status = (typeof STATUSES)[number];

export const TERMINAL_STATUSES = ['resolved', 'cancelled'] as const satisfies readonly Status[];

export function isTerminal(status: Status): boolean {
  return (TERMINAL_STATUSES as readonly Status[]).includes(status);
}

export const OPEN_STATUSES: readonly Status[] = STATUSES.filter(s => !isTerminal(s));
