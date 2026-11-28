// Deterministic urgent-hazard check. It runs before and independently of the model,
// so the fixed safety message still appears if the model misses a hazard or is down.
const HAZARD_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'gas smell', pattern: /\b(gas (smell|leak)|smell(s|ing)? (of )?gas|rotten egg)/i },
  { label: 'carbon monoxide', pattern: /\b(carbon monoxide|co (alarm|detector))\b/i },
  { label: 'fire or smoke', pattern: /\b(fire|flames?|smoke|smoking outlet|burning smell)\b/i },
  { label: 'electrical hazard', pattern: /\b(sparks?|sparking|exposed wires?|electrical shock|shocked me|outlet (is )?(hot|melting))\b/i },
  { label: 'flooding', pattern: /\b(flood(ing|ed)?|water (is )?(pouring|gushing|everywhere)|burst pipe|pipe burst)\b/i },
  { label: 'ceiling collapse', pattern: /\b(ceiling (is )?(collaps|falling|caving))/i },
];

// Shown when a hazard was detected but no urgent escalation succeeded, so the resident is never told
// a manager was notified when one wasn't. When escalation succeeds, Dev 2's URGENT_HAZARD_MESSAGE is used.
export const HAZARD_NOT_ROUTED_MESSAGE =
  'This may be an urgent hazard. A manager has not been notified yet. If there is immediate danger, leave the area and call 911, then contact your maintenance office directly.';

export function detectHazards(text: string): string[] {
  return HAZARD_PATTERNS.filter(h => h.pattern.test(text)).map(h => h.label);
}
