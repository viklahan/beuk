import * as Y from 'yjs';
import { BODY, sectionList } from '@book/editor/index.js';

/* The outline's rows: each section's name by 1.0's sidebar rule
   (client/index.html renderSidebar):
   - a part:        "Part N — title" (number optional), untitled → side.untitled;
   - a body section: "Ch. N — title" (number optional), untitled → side.untitled;
   - front and back matter: the title as it stands.
   Step 4 lists the sections flat, in book order (1.0's groups, word counts
   and row tools are step 5). */

/** `chopName`: 1.0's chopName (the title, else the type's label, else side.untitled); `isSection`: an object entry. */
export type OutlineRow = { index: number; id: string; name: string; chopName: string; kind: string; type: string; isPart: boolean; editable: boolean; isSection: boolean };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type T = (key: any) => string;

type SectionLike = { title?: unknown; number?: unknown; type?: unknown; kind?: unknown };

/** 1.0's sidebar name for one section. */
export function sectionName(s: SectionLike, t: T): string {
  const title = typeof s.title === 'string' ? s.title : s.title == null ? '' : String(s.title);
  const num = s.number;
  if (s.type === 'part') return (num ? t('import.type.part') + ' ' + num + ' — ' : '') + (title || t('side.untitled'));
  if (s.kind === 'body') return (num ? t('side.chapterAbbr') + ' ' + num + ' — ' : '') + (title || t('side.untitled'));
  return title;
}

/** 1.0's chopName (BEUK:chapterops): the trimmed title, else the type's import label, else side.untitled. */
export function chopName(s: SectionLike, t: T): string {
  const title = String((s && s.title) || '').trim();
  if (title) return title;
  const k = 'import.type.' + String(s && s.type);
  const lbl = t(k);
  return lbl !== k ? lbl : t('side.untitled');
}

/** The outline rows of a book's Y.Doc. `editable`: the section's content is text (it has a fragment). */
export function outlineRows(ydoc: Y.Doc, t: T): OutlineRow[] {
  return sectionList(ydoc).map((s, index) => {
    if (!(s instanceof Y.Map)) return { index, id: String(index), name: '', chopName: '', kind: '', type: '', isPart: false, editable: false, isSection: false };
    const get = (k: string): unknown => s.get(k);
    const sec: SectionLike = { title: get('title'), number: get('number'), type: get('type'), kind: get('kind') };
    const id = typeof get('id') === 'string' ? (get('id') as string) : String(index);
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    return { index, id, name: sectionName(sec, t), chopName: chopName(sec, t), kind: str(sec.kind), type: str(sec.type), isPart: sec.type === 'part', editable: get(BODY) instanceof Y.XmlFragment, isSection: true };
  });
}
