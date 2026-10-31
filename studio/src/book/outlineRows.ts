import * as Y from 'yjs';
import { BODY, SECTIONS } from '@book/editor/index.js';

/* The outline's rows: each section's name by 1.0's sidebar rule
   (client/index.html renderSidebar):
   - a part:        "Part N — title" (number optional), untitled → side.untitled;
   - a body section: "Ch. N — title" (number optional), untitled → side.untitled;
   - front and back matter: the title as it stands.
   Step 4 lists the sections flat, in book order (1.0's groups, word counts
   and row tools are step 5). */

export type OutlineRow = { index: number; id: string; name: string; kind: string; type: string; isPart: boolean; editable: boolean };

type T = (key: 'import.type.part' | 'side.untitled' | 'side.chapterAbbr') => string;

type SectionLike = { title?: unknown; number?: unknown; type?: unknown; kind?: unknown };

/** 1.0's sidebar name for one section. */
export function sectionName(s: SectionLike, t: T): string {
  const title = typeof s.title === 'string' ? s.title : s.title == null ? '' : String(s.title);
  const num = s.number;
  if (s.type === 'part') return (num ? t('import.type.part') + ' ' + num + ' — ' : '') + (title || t('side.untitled'));
  if (s.kind === 'body') return (num ? t('side.chapterAbbr') + ' ' + num + ' — ' : '') + (title || t('side.untitled'));
  return title;
}

/** The outline rows of a book's Y.Doc. `editable`: the section's content is text (it has a fragment). */
export function outlineRows(ydoc: Y.Doc, t: T): OutlineRow[] {
  return ydoc.getArray<unknown>(SECTIONS).toArray().map((s, index) => {
    if (!(s instanceof Y.Map)) return { index, id: String(index), name: '', kind: '', type: '', isPart: false, editable: false };
    const get = (k: string): unknown => s.get(k);
    const sec: SectionLike = { title: get('title'), number: get('number'), type: get('type'), kind: get('kind') };
    const id = typeof get('id') === 'string' ? (get('id') as string) : String(index);
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    return { index, id, name: sectionName(sec, t), kind: str(sec.kind), type: str(sec.type), isPart: sec.type === 'part', editable: get(BODY) instanceof Y.XmlFragment };
  });
}
