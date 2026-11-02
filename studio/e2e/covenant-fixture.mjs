/* Wave 3b (constraint 27): a FULL Covenant on Dumas for the typing-latency check — at least 200 entries, made from the
   book's own text, deterministic (no randomness, the same book every run).

   - The book's own 15 entries stay as they are.
   - Then every capitalised word or two-word name the story uses at least 3 times INSIDE a sentence (not only after a
     full stop, so "The" and "But" stay out), most frequent first, becomes an entry: characters, then places, things,
     groups and lore in turn; every third one gets its lower-case or possessive-free alias, every fifth an exclusion
     phrase (the name + " de"), every seventh exact case.
   - So the matcher is 1.0's at its largest realistic size (hundreds of alternatives), and the page is full of marks.
   - Six changes are pinned in the longest chapter (its margin dots), each at a passage quoted from it. */

const TYPES = ['character', 'place', 'thing', 'group', 'lore'];
const STOP = new Set(['The', 'But', 'And', 'Then', 'When', 'What', 'This', 'That', 'There', 'They', 'Yes', 'No', 'Well', 'Now', 'Oh', 'Ah', 'If', 'In', 'It', 'He', 'She', 'We', 'You', 'I', 'A', 'An', 'As', 'At', 'On', 'Of', 'To', 'His', 'Her', 'My', 'Your', 'Our', 'Their', 'Who', 'Why', 'How', 'Where', 'So', 'For', 'With', 'Not', 'All', 'One', 'Chapter']);

/** The book with a Covenant of at least `min` entries (default 220). */
export function covenantDumas(book, min = 220) {
  const out = structuredClone(book);
  const own = (out.bible && Array.isArray(out.bible.entries) ? out.bible.entries : []).slice();
  const taken = new Set(own.flatMap((e) => [e.name, ...(e.aliases || [])].map((x) => String(x).toLowerCase())));
  const body = (out.sections || []).filter((s) => s.kind === 'body' && typeof s.content === 'string');
  const counts = new Map();
  const re = /(?<![.!?]\s)(?<=[a-z,;:]\s)([A-Z][a-zà-ÿ'’]{2,}(?: [A-Z][a-zà-ÿ'’]{2,})?)(?![\p{L}])/gu;
  for (const s of body) {
    for (const m of s.content.matchAll(re)) {
      const name = m[1];
      if (STOP.has(name.split(' ')[0])) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  const names = [...counts].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([n]) => n);
  const entries = own.slice();
  let k = 0;
  for (const name of names) {
    if (entries.length >= min) break;
    if (taken.has(name.toLowerCase())) continue;
    taken.add(name.toLowerCase());
    k++;
    const e = { id: 'lat' + k, type: TYPES[k % TYPES.length], name };
    if (k % 3 === 0) {
      const alias = name.includes(' ') ? name.split(' ')[1] : name.replace(/['’]s$/, '');
      if (alias !== name && !taken.has(alias.toLowerCase())) {
        e.aliases = [alias];
        taken.add(alias.toLowerCase());
      }
    }
    if (k % 5 === 0) e.exclude = [name + ' de'];
    if (k % 7 === 0) e.exactCase = true;
    entries.push(e);
  }
  // changes pinned in the longest chapter: its margin dots
  let big = null;
  for (const s of body) if (!big || s.content.length > big.content.length) big = s;
  if (big && entries.length) {
    const step = Math.floor(big.content.length / 7);
    for (let i = 1; i <= 6; i++) {
      const at = i * step;
      const quote = big.content.slice(at, at + 24);
      if (!quote.trim()) continue;
      const e = entries[i % entries.length];
      e.changes = (e.changes || []).concat([{ id: 'latc' + i, anchor: { sec: big.id, quote, at }, text: 'a change at passage ' + i }]);
    }
  }
  out.bible = { ...(out.bible || {}), entries };
  return out;
}
