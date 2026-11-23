/* BEUK:notelabels — the server's copy of the studio's note numbering (client/index.html: noteMarkRe, NOTE_DEF_RE,
   noteMarksIn, noteBookShown). A note is stored under the label the writer typed ("[^salt]", "[^salt]: …"; the bare
   "[12]" is digits only), and the number a reader sees is worked out when the book is shown:
     - a label that is itself a number shows that number, as typed;
     - any other label takes, in the order the notes are first marked through the book, the next number that no
       numeric label in the book uses;
     - a label defined more than once is as many notes: a mark means the next definition of its label at or after
       it in its own section, else the last one before it there; in a section that never defines the label, the
       next definition on through the book, else the last one before;
     - a mark under a label that is no number and that no definition anywhere in the book answers is no note (the
       owner, 2026-11-22: Beuk does not invent a number for something that is not a note): it takes no number and
       is set exactly as typed. A NUMBER with no note is raised as it always was ("[n]", linked to nothing).
   BEUK:notemarks — a label with no letter and no digit in it ("*", "†", "‡") is a MARK of the writer's: it is shown
   as typed and takes no number. Two notes of one mark in a section are told apart in order (the studio's rule:
   the definitions that stand together answer the marks waiting before them, the first definition the first mark;
   marks left over mean the last of them; a mark with none after it means the last before). Each such note is
   handed on as "[^" + mark + NOTE_KEY + k + "]" (k: its place among the section's notes of that mark), so a
   surface pairs it as it pairs a number; noteMarkShown is what a reader sees and noteIdOf the id it makes.
   The beta-reader reading copy (src/shares/render.ts) is the one server surface that sets a note's number itself;
   every other one runs the studio's own code. The two copies are held to one table of cases,
   tests/fixtures/note-labels.json (tests/note-labels.test.ts here, studio/test/note-labels-as-typed.test.ts there). */

/** A mark, anywhere: $1 is "^label", or the bare number. */
export const noteMarkRe = (): RegExp => /\[(\^[^\]\s]+|\d{1,3})\]/g;
/** A mark as a surface sets one, once the text has come through notesAsShown: under a number ("[^12]", or the bare
 *  "[12]"); $1 as noteMarkRe's. A mark still under a name there is one no note answers: the writer's text. */
export const noteNumberRe = (): RegExp => /\[(\^\d+|\^[^\]\s]+\uE080\d+|\d{1,3})\]/g;
/** BEUK:notemarks — parts a mark of the writer's from the count that tells two notes of one mark apart in a section: never stored, never shown. */
export const NOTE_KEY = '\uE080';
/** A label that is a mark: no letter and no digit in it. */
export const noteIsMark = (label: string): boolean => /^[^\p{L}\p{N}\s\]\uE080]+$/u.test(label);
/** What a reader sees for a label a surface was handed: the number, or the writer's mark. */
export const noteMarkShown = (label: string): string => { const at = label.indexOf(NOTE_KEY); return at < 0 ? label : label.slice(0, at); };
/** The part of an id a label makes: a number as it is; a mark by its characters' code points ("m2a-1" for the first "*"). */
export const noteIdOf = (label: string): string => {
  const at = label.indexOf(NOTE_KEY);
  return at < 0 ? label : 'm' + Array.from(label.slice(0, at)).map((ch) => ch.codePointAt(0)!.toString(16)).join('-') + '-' + label.slice(at + 1);
};
/** A definition opens the block: "[^label]:" (or "[12]:"). */
export const NOTE_DEF_RE = /^\[(\^[^\]\s]+|\d{1,3})\]:/;
/** A definition block whole: $1 "^label" or the bare number, $2 its text. */
export const NOTE_DEF_BLOCK_RE = /^\[(\^[^\]\s]+|\d{1,3})\]:\s*([\s\S]+)$/;
/** A label that is not a number. */
export const NOTE_NAMED_RE = /\[\^(?!\d+\])[^\]\s]+\]/;
export const noteLabelOf = (cap: string): string => (cap.startsWith('^') ? cap.slice(1) : cap);

const CONTAINER_OPEN_RE = /^[ \t]*:::[ \t]+([A-Za-z][A-Za-z0-9-]*)(?:[ \t]+(.*?))?[ \t]*$/;
const CONTAINER_CLOSE_RE = /^[ \t]*:::[ \t]*$/;
/** The studio's raw container kinds (CONTAINER_KINDS entries with raw: true): the writer's to the character, no mark is read inside one. */
const RAW_KINDS = new Set(['log']);

type Mark = { at: number; label: string; def: boolean; mi?: number; note?: Note; marked?: boolean; shown?: string };
type Note = { shown?: string; marked?: boolean };

/** The marks of one section's text in the order they stand (the studio's noteMarksIn). */
function noteMarksIn(content: string): Mark[] {
  const text = String(content ?? '');
  const out: Mark[] = [];
  if (!text.includes('[')) return out;
  const boxes = text.includes(':::');
  let off = 0, raw = false, boxed = false, blank = true;
  for (const line of text.split('\n')) {
    const start = off;
    off += line.length + 1;
    const l = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (boxes && l.includes(':::')) {
      const om = CONTAINER_OPEN_RE.exec(l);
      if (om || CONTAINER_CLOSE_RE.test(l)) { raw = !!om && RAW_KINDS.has(om[1]!.toLowerCase()); boxed = !!om; blank = true; continue; }
    }
    if (!l.trim()) { blank = true; continue; }
    if (!raw && l.includes('[')) {
      const lead = l.length - l.replace(/^\s+/, '').length;
      let from = 0;
      const d = !lead || blank || boxed ? NOTE_DEF_RE.exec(l.slice(lead)) : null;
      if (d) { out.push({ at: start + lead + (d[1]!.startsWith('^') ? 2 : 1), label: noteLabelOf(d[1]!), def: true }); from = lead + d[0].length; }
      const re = noteMarkRe();
      re.lastIndex = from;
      let m: RegExpExecArray | null;
      while ((m = re.exec(l))) out.push({ at: start + m.index + (m[1]!.startsWith('^') ? 2 : 1), label: noteLabelOf(m[1]!), def: false });
    }
    blank = false;
  }
  return out;
}

/** The book's sections as a reader is shown their notes: each text with every label that is not a number written as
 *  the number it shows (the studio's noteBookShown). A text that holds no such label comes back as it is. */
export function notesAsShown(contents: readonly string[]): string[] {
  const texts = contents.map((c) => String(c ?? ''));
  if (!texts.some((c) => c.includes('[^') && NOTE_NAMED_RE.test(c))) return texts;
  const isNum = (l: string) => /^\d+$/.test(l);
  const marks = texts.map(noteMarksIn);
  const used = new Set<number>();
  let named = false;
  for (const ms of marks) for (const m of ms) { if (isNum(m.label)) used.add(Number(m.label)); else named = true; }
  if (!named) return texts;
  const defsOf = marks.map((ms) => {
    const by = new Map<string, Mark[]>();
    ms.forEach((m, mi) => {
      if (!m.def || isNum(m.label)) return;
      m.mi = mi;
      const list = by.get(m.label);
      if (list) list.push(m); else by.set(m.label, [m]);
    });
    return by;
  });
  /* the note a mark means; undefined where no definition anywhere in the book answers its label: that mark is no
     note, takes no number and is left exactly as typed */
  /* BEUK:notemarks — a mark of the writer's in a section that defines it: each mark its own note, in order */
  const own = new Map<Mark, Mark>();
  defsOf.forEach((by, si) => by.forEach((defs, label) => {
    if (!noteIsMark(label)) return;
    defs.forEach((d, k) => { d.shown = label + NOTE_KEY + (k + 1); });
    const seq = marks[si]!.filter((m) => m.label === label);
    let waiting: Mark[] = [], last: Mark | null = null, i = 0;
    while (i < seq.length) {
      if (!seq[i]!.def) { waiting.push(seq[i++]!); continue; }
      const run: Mark[] = [];
      while (i < seq.length && seq[i]!.def) run.push(seq[i++]!);
      waiting.forEach((m, k) => own.set(m, run[Math.min(k, run.length - 1)]!));
      waiting = []; last = run[run.length - 1]!;
    }
    waiting.forEach((m) => own.set(m, last!));
  }));
  const noteOf = (si: number, mi: number, label: string): Note | undefined => {
    const here = defsOf[si]!.get(label);
    if (here && own.has(marks[si]![mi]!)) return own.get(marks[si]![mi]!);
    if (here) return here.find((d) => d.mi! >= mi) ?? here[here.length - 1]!;
    for (let j = si + 1; j < defsOf.length; j++) { const d = defsOf[j]!.get(label); if (d) return d[0]!; }
    for (let j = si - 1; j >= 0; j--) { const d = defsOf[j]!.get(label); if (d) return d[d.length - 1]!; }
    return undefined;
  };
  marks.forEach((ms, si) => ms.forEach((m, mi) => {
    if (isNum(m.label)) return;
    m.note = m.def ? m : noteOf(si, mi, m.label);
    if (!m.def && m.note) m.note.marked = true;
  }));
  let next = 1;
  const take = (nt: Note) => { if (nt.shown) return; while (used.has(next)) next++; nt.shown = String(next++); };
  for (const ms of marks) for (const m of ms) { if (isNum(m.label) || !m.note) continue; if (!m.def) take(m.note); else if (!m.marked) take(m); }
  return texts.map((c, si) => {
    const ms = marks[si]!.filter((m) => !isNum(m.label) && m.note);
    if (!ms.length) return c;
    let out = '', last = 0;
    for (const m of ms) { out += c.slice(last, m.at) + m.note!.shown!; last = m.at + m.label.length; }
    return out + c.slice(last);
  });
}
