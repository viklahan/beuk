import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';


/* Wave 6: the import corpus that needs no browser library (MD, TXT, RTF), shared by the vitest parity and the e2e, and
   the masking of what 1.0 itself varies between two imports of the same file. */

type Rec = Record<string, unknown>;
const BOWMARKET = path.join(import.meta.dirname, '..', '..', 'content', 'bowmarket', 'en');

export type CorpusFile = { name: string; type: string; text: string };
/** Every content/bowmarket/en/*.md, one Markdown file with YAML frontmatter, one plain .txt, and three RTF files (headings,
 *  footnotes and a table; code pages and \'hh escapes; \uN escapes, surrogate pairs and a quote style). */
export function textCorpus(): CorpusFile[] {
  const md = readdirSync(BOWMARKET).filter((f) => f.endsWith('.md')).sort().map((f) => ({ name: f, type: 'text/markdown', text: readFileSync(path.join(BOWMARKET, f), 'utf8') }));
  return [
    ...md,
    {
      name: 'frontmatter.md',
      type: 'text/markdown',
      text: '---\ntitle: "The Salt Road"\nsubtitle: A Novel\nauthor: Mira Okonjo\nlanguage: fr\n---\n\n# Chapitre un\n\n"Il pleuvait," dit-elle... Le port dormait -- ou presque.\n\n***\n\nLe matin vint.\n\n# Chapitre deux\n\nUne lettre arriva.\n',
    },
    {
      name: 'plain-manuscript.txt',
      type: 'text/plain',
      text: 'THE NIGHT FERRY\n\nby Ada Quill\n\nCopyright © 2024 Ada Quill. All rights reserved.\nISBN 978-0-306-40615-7\nPublished by Harbour Lights Press\n\nFor my mother.\n\nChapter 1\n\nThe ferry left at nine. "Late again," said the pilot -- and he laughed.\n\n* * *\n\nNobody answered...\n\nChapter 2: The Crossing\n\nThe water was black.\n\nAcknowledgements\n\nThanks to everyone.\n',
    },
    {
      name: 'headings.rtf',
      type: 'application/rtf',
      text: String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times;}}{\info{\title The Lantern Keeper}{\author R. North}}{\stylesheet{\s0 Normal;}{\s1\outlinelevel0 heading 1;}{\s2\outlinelevel1 heading 2;}}
\pard\s1 Chapter One\par\pard\s0 It was a {\i dark} and \b stormy\b0  night\emdash or so \{they\} said.{\super\chftn}{\footnote\pard{\super\chftn} A {\i wet} one.}\par
\pard\s0 Second \'93para\'94\~here.\par\pard\qc ***\par\pard\s0 After the break.\par
\pard\s1 Chapter Two\par\pard\s2 A small heading\par\pard\s0 Body text.\par\pard\intbl One\cell Two\cell\row\pard\s0 End.\par}`,
    },
    {
      name: 'codepages.rtf',
      type: 'application/rtf',
      text: String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl{\f0 Times;}{\f1\fcharset161 Times Greek;}{\f2\fcharset204 Times Cyr;}}\pard\f0 Chapter 1\par\pard caf\'e9 cr\'e8me br\'fbl\'e9e {\f1 \'e1\'e2\'e3} {\f2 \'cf\'f0\'e8\'e2\'e5\'f2}\par\pard\f0 Chapter 2\par\pard Na\'efve r\'e9sum\'e9.\par}`,
    },
    {
      name: 'unicode.rtf',
      type: 'application/rtf',
      text:
        '{\\rtf1\\ansi{\\stylesheet{\\s0 Normal;}{\\s7 Quote;}}\\pard Chapter One\\par\\pard Caf\\u233\\\'e9 \\u8212? \\uc0\\u26085\\u26412  \\uc1\\u-10179?\\u-8704? \\u8220\\emdash x\\u8221?\\par' +
        '\\pard\\s7 A quoted line.\\par\\pard Chapter Two\\par\\pard \\u1575?\\u1604?\\u1593?\\u1585?\\u1576?\\u1610?\\u1577? and \\u2361?\\u2367?\\u2344?\\u2381?\\u2342?\\u2368?.\\par}',
    },
  ];
}

const ID_KEYS = new Set(['id', 'bookId', 'snapId', 'secId', 'chapterId', 'imgId', 'activeId', 'into', 'plateId', 'backdropId']);
const TIME_KEYS = new Set(['at', 'undoneAt']);
/** What 1.0 varies between two imports of the same file, masked: every fresh id 1.0 mints (uid(): "s" + 7 base-36
 *  characters; newBookId(): "urn:uuid:…") wherever it stands — as an id-keyed value and wherever the text names it — and
 *  the snapshot's, the report's and an undo's times. Ids the book already carried are not fresh and stay as they are. */
export function maskVarying(doc: unknown): unknown {
  const fresh = new Map<string, string>();
  const walk = (v: unknown, key: string) => {
    if (typeof v === 'string') {
      if (ID_KEYS.has(key) && (/^s[0-9a-z]{7}$/.test(v) || /^urn:uuid:[0-9a-f-]{36}$/.test(v)) && !fresh.has(v)) fresh.set(v, '#id' + fresh.size);
      return;
    }
    if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Rec)) walk(x, k);
  };
  walk(doc, '');
  let text = JSON.stringify(doc);
  for (const [id, mask] of fresh) text = text.split(id).join(mask);
  const out = JSON.parse(text);
  const times = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(times);
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v as Rec)) {
        if (TIME_KEYS.has(k) && typeof x === 'string' && /^\d{4}-\d\d-\d\dT/.test(x)) (v as Rec)[k] = '#time';
        else times(x);
      }
  };
  times(out);
  return out;
}
