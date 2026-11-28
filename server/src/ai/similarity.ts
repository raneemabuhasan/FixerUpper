// Cheap word-overlap score used to rank a resident's open tickets as duplicate candidates.
// It only orders the list the model sees. The model proposes a match and the resident decides.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'my', 'our', 'is', 'are', 'was', 'it', 'its', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'still', 'again', 'not', 'this', 'that', 'i', 'me', 'we', 'has', 'have', 'been', 'be', 'there', 'very',
]);

const SYNONYMS: Record<string, string> = {
  tap: 'faucet', leak: 'drip', leaking: 'drip', leaky: 'drip', dripping: 'drip', drips: 'drip',
  drain: 'drain', draining: 'drain', drains: 'drain', clogged: 'drain',
  cupboard: 'cabinet', cabinets: 'cabinet', sticking: 'stick', sticks: 'stick', stuck: 'stick', jammed: 'stick',
};

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    const word = SYNONYMS[raw] ?? raw.replace(/(ing|es|s)$/, '');
    if (word.length >= 2) out.add(word);
  }
  return out;
}

// Share of the query's words that appear in the candidate, 0 to 1.
export function similarity(query: string, candidate: string): number {
  const q = tokens(query);
  if (q.size === 0) return 0;
  const c = tokens(candidate);
  let hits = 0;
  for (const w of q) if (c.has(w)) hits++;
  return Math.round((hits / q.size) * 100) / 100;
}
