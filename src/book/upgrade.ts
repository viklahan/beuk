import { createHash, randomUUID } from 'node:crypto';
import {
  PRINT_BLEED_DEFAULT, PRINT_DEFAULTS, PRINT_MARGINS_DEFAULT, PRINT_NOTES_DEFAULT, PRINT_PICTURE_BOOK_DEFAULT,
  THEME_DEFAULT, ACTIVE_PRESET_DEFAULT, scaffoldSections,
} from './defaults.js';
import type { Preserved, Warning } from './read.js';

/* BEUK:book-upgrade — the named steps that lift a legacy book shape to v1.
   One step per implicit 1.0 version (design doc, "Legacy upgrade steps"),
   each citing the 1.0 code it mirrors. readBook runs them in order, on its
   own deep copy of the book, before it fills defaults and checks limits.

   A step fires (returns true) when it changed the book or, for the three
   that only record (recordOnly: rights-mode, history-doc, optional-empties),
   when the book has the legacy shape. A step touches only what its 1.0 line touches, and
   anything it replaces goes to ctx.preserve. Writes are own-property (setOwn)
   so a key named "__proto__" stays data. "CI:n" is a line of
   client/index.html. */

/** What a step may report besides changing the book. */
export type StepCtx = {
  warn(w: Warning): void;
  preserve(p: Preserved): void;
};

export type UpgradeStep = {
  name: string;
  /** The 1.0 code this step mirrors, e.g. "client/index.html CI:50594". */
  cite: string;
  /** The step describes the shape and changes nothing, so it fires again on a book it already read. readBook's idempotence check ignores these. */
  recordOnly?: true;
  /** Mutates `book` (readBook's own copy). Returns true when it fired. */
  apply(book: Record<string, unknown>, ctx: StepCtx): boolean;
};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: Rec, k: string): boolean => Object.hasOwn(o, k);
const get = (o: Rec, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
const clone = <T>(v: T): T => structuredClone(v);
const setOwn = (o: Rec, k: string, v: unknown): void => {
  Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
};
const metaOf = (b: Rec): Rec | null => { const m = get(b, 'meta'); return isRec(m) ? m : null; };

/* ---- book ids (CI:4356-4482) ---- */

/** BOOKID_NAMESPACE, CI:4376. Generated once for Beuk; changing it would split every migrated book. */
export const BOOKID_NAMESPACE = '8bf1c6b6-5f75-4773-a701-cdd420357f52';
/** SAMPLE_BOOK_ID, CI:4356. */
export const SAMPLE_BOOK_ID = 'urn:uuid:fb544908-ebbc-4bb6-87cc-445335432f3e';
/** LEGACY_SAMPLE_BOOK_ID, CI:4377: the only id bookIdMigrated maps to the sample (CI:4430-4433). The pre-rename salt-meridian id is recognised as the sample by the UI only (isSampleBookId, CI:4357); it migrates like any legacy id (bookid-legacy). */
const LEGACY_SAMPLE_BOOK_ID = 'urn:uuid:beuk-sample-lantern-coast';
/** BOOKID_UUID_RE, CI:4379: a well-formed RFC 9562 UUID (versions 1-8, variant 10xx) behind urn:uuid:. */
const BOOKID_UUID_RE = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** RFC 9562 section 5.5 UUIDv5 of `name` under namespace `ns` (canonical hex, no urn prefix): uuidV5, CI:4418-4427. 1.0 writes its own SHA-1; this uses node's, which is the same function. The name is UTF-8, as 1.0's TextEncoder. */
export function uuidV5(ns: string, name: string): string {
  const h = createHash('sha1').update(Buffer.from(ns.replace(/-/g, ''), 'hex')).update(Buffer.from(String(name), 'utf8')).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** bookIdIsLegacy, CI:4428: a non-empty id that is not a UUID. */
const bookIdIsLegacy = (id: unknown): id is string => typeof id === 'string' && id !== '' && !BOOKID_UUID_RE.test(id);

/** bookIdMigrateMeta's list, CI:4435-4440, :4457-4463: the old id first, then what was there. 1.0 also drops entries over 300 characters or past 16; the reader is lossless, so it keeps them (checkLimits warns). */
function legacyList(meta: Rec, from: string, ctx: StepCtx): string[] {
  const out = [from];
  const cur = get(meta, 'legacyBookIds');
  if (cur !== undefined && !Array.isArray(cur)) ctx.preserve({ path: 'meta.legacyBookIds', raw: cur, used: undefined });
  if (Array.isArray(cur)) for (const x of cur) if (typeof x === 'string' && x && !out.includes(x)) out.push(x);
  return out;
}

/* ---- the list of languages (LANG_PACKS keys, CI:28198) ---- */

export const LANG_CODES: readonly string[] = [
  'en', 'en-GB', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'sv', 'nb', 'da', 'fi', 'cs', 'ro', 'hu', 'el', 'ru', 'uk', 'bg', 'sr', 'tr',
  'ar', 'fa', 'he', 'ur', 'hi', 'bn', 'ta', 'id', 'vi', 'th', 'ja', 'zh-Hans', 'zh-Hant', 'ko',
];

/** DISPLAY_FAMILIES, CI:19274-19279. */
export const DISPLAY_FAMILIES: readonly string[] = ['Pinyon Script', 'Patrick Hand', 'Abril Fatface'];

/** The print keys applyBookDoc defaults (CI:50269-50295), with 1.0's value. */
const PRINT_FILL: [string, unknown][] = [
  ...Object.entries(PRINT_DEFAULTS), ['printCustomMargins', PRINT_MARGINS_DEFAULT],
  ['printPictureBook', PRINT_PICTURE_BOOK_DEFAULT], ['printBleed', PRINT_BLEED_DEFAULT],
];

/** Keys 1.0 leaves absent when a book has none (CI:50180-50182, CI:50246-50261: bookColourNormalize, olNormalize, bibleNormalize, nbNormalize, rsNormalize). */
const OPTIONAL_KEYS = ['colour', 'outline', 'bible', 'notebook', 'research'] as const;

export const STEPS: UpgradeStep[] = [
  {
    name: 'sections-split',
    cite: 'src/account/data.ts:262-286',
    apply(b, ctx) {
      const s = get(b, 'sections');
      if (!isRec(s)) return false;
      const tiers: [string, string][] = [['frontMatter', 'front'], ['body', 'body'], ['backMatter', 'back']];
      if (!tiers.some(([k]) => Array.isArray(get(s, k)))) return false;
      const flat: Rec[] = [];
      for (const [k, kind] of tiers) {
        const arr = get(s, k);
        if (!Array.isArray(arr)) continue;
        arr.forEach((x, i) => {
          // asStudioBackupBook: keep records only, kind from the entry or else from its tier
          if (!isRec(x)) { ctx.preserve({ path: `sections.${k}[${i}]`, raw: x, used: undefined }); return; }
          const kd = get(x, 'kind');
          flat.push({ ...x, kind: typeof kd === 'string' && kd ? kd : kind });
        });
      }
      for (const k of Object.keys(s)) if (!tiers.some(([t]) => t === k)) ctx.preserve({ path: `sections.${k}`, raw: s[k], used: undefined });
      setOwn(b, 'sections', flat);
      return true;
    },
  },
  {
    name: 'sections-missing',
    cite: 'client/index.html:50253-50256',
    apply(b, ctx) {
      const s = get(b, 'sections');
      if (Array.isArray(s) && s.length) return false;
      if (s !== undefined && s !== null && !(Array.isArray(s) && s.length === 0)) ctx.preserve({ path: 'sections', raw: s, used: undefined });
      const secs = scaffoldSections();
      setOwn(b, 'sections', secs);
      // buildEmptyBook: activeId is its chapter
      const chapter = secs.find((x) => x.type === 'chapter');
      const active = (chapter ?? secs[0]!).id;
      const old = get(b, 'activeId');
      if (old !== undefined && old !== active) ctx.preserve({ path: 'activeId', raw: old, used: active });
      setOwn(b, 'activeId', active);
      return true;
    },
  },
  {
    name: 'bookid-missing',
    cite: 'client/index.html:50215',
    apply(b) {
      if (!has(b, 'meta')) setOwn(b, 'meta', {});
      const m = metaOf(b);
      if (!m || get(m, 'bookId')) return false;
      // newBookId(), CI:4345: urn:uuid: and a random v4. The one place the reader is not pure.
      setOwn(m, 'bookId', `urn:uuid:${randomUUID()}`);
      return true;
    },
  },
  {
    name: 'bookid-legacy',
    cite: 'client/index.html:4428-4482, :50328',
    apply(b, ctx) {
      const m = metaOf(b);
      const id = m && get(m, 'bookId');
      if (!m || !bookIdIsLegacy(id) || id === LEGACY_SAMPLE_BOOK_ID) return false;
      setOwn(m, 'legacyBookIds', legacyList(m, id, ctx));
      setOwn(m, 'bookId', `urn:uuid:${uuidV5(BOOKID_NAMESPACE, id)}`);
      return true;
    },
  },
  {
    name: 'bookid-sample',
    cite: 'client/index.html:4356-4377, :4430-4433',
    apply(b, ctx) {
      const m = metaOf(b);
      const id = m && get(m, 'bookId');
      if (!m || id !== LEGACY_SAMPLE_BOOK_ID) return false;
      setOwn(m, 'legacyBookIds', legacyList(m, id, ctx));
      setOwn(m, 'bookId', SAMPLE_BOOK_ID);
      return true;
    },
  },
  {
    name: 'lang-unknown',
    cite: 'client/index.html:50230',
    apply(b, ctx) {
      const m = metaOf(b);
      if (!m || !has(m, 'language')) return false;
      const raw = m.language;
      // Deliberately differs from 1.0 (!LANG_PACKS[x], which keeps an inherited key such as "constructor"): only a real pack code is kept, and the raw value is preserved.
      if (typeof raw === 'string' && LANG_CODES.includes(raw)) return false;
      setOwn(m, 'language', 'en');
      ctx.preserve({ path: 'meta.language', raw, used: 'en' });
      ctx.warn({ code: 'unknown-language', path: 'meta.language', detail: `${JSON.stringify(raw)} is not a language Beuk has a pack for; read as "en"` });
      return true;
    },
  },
  {
    name: 'lang-source',
    cite: 'client/index.html:50231-50233',
    apply(b, ctx) {
      const m = metaOf(b);
      if (!m) return false;
      let fired = false;
      const ls = get(m, 'langSource');
      if (ls !== 'manual' && ls !== 'auto') {
        const lang = get(m, 'language');
        // a non-English language in a book saved before detection was picked by hand
        const used = (typeof lang === 'string' ? lang : 'en') !== 'en' ? 'manual' : 'auto';
        if (ls !== undefined) ctx.preserve({ path: 'meta.langSource', raw: ls, used });
        setOwn(m, 'langSource', used);
        fired = true;
      }
      if (typeof get(m, 'langGuess') !== 'string') {
        const lg = get(m, 'langGuess');
        if (lg !== undefined) ctx.preserve({ path: 'meta.langGuess', raw: lg, used: '' });
        setOwn(m, 'langGuess', '');
        fired = true;
      }
      return fired;
    },
  },
  {
    name: 'theme-missing',
    cite: 'client/index.html:50234, :50244',
    apply(b) {
      if (get(b, 'theme')) return false;
      setOwn(b, 'theme', clone(THEME_DEFAULT));
      if (!get(b, 'activePreset')) setOwn(b, 'activePreset', ACTIVE_PRESET_DEFAULT);
      return true;
    },
  },
  {
    name: 'theme-display-body',
    cite: 'client/index.html:50242, :19288',
    apply(b, ctx) {
      const t = get(b, 'theme');
      if (!isRec(t)) return false;
      const face = get(t, 'bodyFont');
      if (typeof face !== 'string' || !DISPLAY_FAMILIES.includes(face)) return false;
      setOwn(t, 'bodyFont', THEME_DEFAULT.bodyFont);
      ctx.preserve({ path: 'theme.bodyFont', raw: face, used: THEME_DEFAULT.bodyFont });
      ctx.warn({ code: 'display-body-font', path: 'theme.bodyFont', detail: `${JSON.stringify(face)} is a display face and never sets running text; read as ${JSON.stringify(THEME_DEFAULT.bodyFont)}` });
      return true;
    },
  },
  {
    name: 'print-defaults',
    cite: 'client/index.html:50269-50295',
    apply(b) {
      let fired = false;
      for (const [k, v] of PRINT_FILL) if (!has(b, k)) { setOwn(b, k, clone(v)); fired = true; }
      return fired;
    },
  },
  {
    name: 'notes-end',
    cite: 'client/index.html:50300, :20561',
    apply(b) {
      if (has(b, 'printNotes')) return false;
      setOwn(b, 'printNotes', PRINT_NOTES_DEFAULT);
      return true;
    },
  },
  {
    name: 'rights-mode',
    recordOnly: true,
    cite: 'client/index.html:20985-21000',
    /* Records only. A book without rightsMode keeps none; 1.0 reads its rights line at display (rightsModeOf). */
    apply(b) {
      const m = metaOf(b);
      return !!m && !has(m, 'rightsMode');
    },
  },
  {
    name: 'history-doc',
    recordOnly: true,
    cite: 'client/index.html:32187-32188',
    /* Records only. A history entry with a full `doc` is valid beside `chopDoc`; nothing is rewritten. */
    apply(b) {
      const h = get(b, 'history');
      return Array.isArray(h) && h.some((e) => isRec(e) && isRec(get(e, 'doc')));
    },
  },
  {
    name: 'optional-empties',
    recordOnly: true,
    cite: 'client/index.html:50180-50182, :50246-50261',
    /* Records only. A book without colour/outline/bible/notebook/research keeps none (canonical). */
    apply(b) {
      return OPTIONAL_KEYS.some((k) => !has(b, k));
    },
  },
  {
    name: 'activeid-fallback',
    cite: 'client/index.html:50250-50252',
    apply(b, ctx) {
      const s = get(b, 'sections');
      if (!Array.isArray(s)) return false;
      // duplicate ids: warned, both kept (1.0 keeps both and uses the first on lookup)
      const seen = new Set<string>();
      s.forEach((x, i) => {
        const id = isRec(x) ? get(x, 'id') : undefined;
        if (typeof id !== 'string') return;
        if (seen.has(id)) ctx.warn({ code: 'duplicate-id', path: `sections[${i}].id`, detail: `section id ${JSON.stringify(id)} is used by an earlier section too; both are kept` });
        seen.add(id);
      });
      const secs = s.filter(isRec);
      if (!secs.length) return false;
      const cur = get(b, 'activeId');
      if (typeof cur === 'string' && seen.has(cur)) return false;
      // the first chapter, else the first section
      const pick = secs.find((x) => get(x, 'type') === 'chapter') ?? secs[0]!;
      const id = get(pick, 'id');
      if (typeof id !== 'string') return false;
      if (cur !== undefined) ctx.preserve({ path: 'activeId', raw: cur, used: id });
      setOwn(b, 'activeId', id);
      return true;
    },
  },
];
