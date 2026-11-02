import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { sectionAt } from '@book/editor/index.js';
import { useBook } from '../book/BookProvider';
import type { OutlineRow } from '../book/outlineRows';
import { closureIfLoaded, loadClosure, type Closure } from '../closure/index';
import { settleActiveEditor } from '../editor/active';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import {
  addChapter, addPart, iconOf, idAt, indexOfId, insertMatter, moveStep, moveTo, retype, toggleIncluded,
  type RunResult, type StructToast,
} from './structure';

/* BEUK:structure — the sidebar's structure controls (inventory B3), with
   1.0's markup, classes and keys (client/index.html renderSidebar,
   renderMatterLib, renderSecTypeControl):
   - each row's tools: .mini[data-act=up|down] (side.moveUp / side.moveDown)
     and .mini[data-act=eye] (side.includeInExport, eye / eye-off), before
     the chapter-operations button;
   - under the body: .og-extra with #btnAddChapter (side.addChapter) and
     #btnAddPart (side.addPart);
   - drag to reorder: rows draggable; a drop across tiers is refused with
     toast.moveTier and nothing moves (1.0's moveSectionTo);
   - the matter library (#matterLib .matter-lib): #btnMatterLib toggles the
     panel (aria-expanded; open per page, as 1.0's matterLibOpen), its
     groups Front / Back, a button per type (data-matter), a singleton that
     stands already marked .exists;
   - the section type (#secSettings .switch-row, #secTypeSel): 1.0's
     RETYPE_GROUPS as optgroups, the section's own kind:type added when the
     list lacks it.
   Every action reads the book at the click (structure.ts runOnBook) and
   writes one Y transaction; the section 1.0 selects is selected after. */

function useClosureReady(): Closure | null {
  const bk = useBook();
  const [c, setC] = useState<Closure | null>(() => closureIfLoaded());
  useEffect(() => {
    if (!c && bk.phase === 'open') void loadClosure().then(setC).catch(() => undefined);
  }, [c, bk.phase]);
  return c;
}

/** 1.0's toast as the studio's (1.0's kebab-case icon names mapped). */
function useStructToast(): StructToast {
  const toast = useToast();
  return (msg, icon, action) => toast(msg, iconOf(icon), action ? { label: action.label, ms: action.ms, onClick: action.onClick } : undefined);
}

const kindOf = (r: OutlineRow): string => r.kind || 'body'; // 1.0's normalizeSection: a section without a kind is body

export type StructureUi = {
  rowTools: (row: OutlineRow) => ReactNode;
  extra: ReactNode;
  rowProps: (row: OutlineRow) => { draggable: boolean; className: string; onDragStart: (e: DragEvent) => void; onDragEnd: () => void; onDragOver: (e: DragEvent) => void; onDrop: (e: DragEvent) => void };
  matterLib: ReactNode;
};

export function useStructure(): StructureUi {
  const { t } = useLocale();
  const bk = useBook();
  const toast = useToast();
  const structToast = useStructToast();
  const c = useClosureReady();
  const ydoc = bk.book?.ydoc ?? null;
  const [libOpen, setLibOpen] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const bkRef = useRef(bk);
  bkRef.current = bk;

  /** Run one action on the book at the click; select the section 1.0 chose (or keep the open one where it now stands). */
  const act = <R,>(fn: (c: Closure, y: Y.Doc) => RunResult<R>): RunResult<R> | null => {
    const b = bkRef.current;
    if (!c || !b.book) return null;
    settleActiveEditor(); // the open chapter's pending text first
    const y = b.book.ydoc;
    const openId = idAt(y, b.active);
    const r = fn(c, y);
    const pick = r.selected ?? openId;
    const at = indexOfId(y, pick);
    if (r.wrote || r.selected) b.select(at);
    return r;
  };

  const rowTools = (row: OutlineRow): ReactNode => {
    if (!row.isSection || !c || !ydoc) return null;
    const included = (() => {
      const m = sectionAt(ydoc, row.index) as Y.Map<unknown> | undefined;
      return m && typeof m.get === 'function' ? m.get('included') !== false : true;
    })();
    return (
      <>
        <button type="button" className="mini" data-act="up" title={t('side.moveUp')} aria-label={t('side.moveUp')} onClick={(e) => { e.stopPropagation(); act((cl, y) => moveStep(cl, y, row.id, 'up')); }}>
          <Icon name="ChevronUp" />
        </button>
        <button type="button" className="mini" data-act="down" title={t('side.moveDown')} aria-label={t('side.moveDown')} onClick={(e) => { e.stopPropagation(); act((cl, y) => moveStep(cl, y, row.id, 'down')); }}>
          <Icon name="ChevronDown" />
        </button>
        <button type="button" className="mini" data-act="eye" title={t('side.includeInExport')} aria-label={t('side.includeInExport')} onClick={(e) => { e.stopPropagation(); act((cl, y) => toggleIncluded(cl, y, row.id)); }}>
          <Icon name={included ? 'Eye' : 'EyeOff'} />
        </button>
      </>
    );
  };

  const extra = (
    <div className="og-extra">
      <button type="button" id="btnAddChapter" onClick={() => act((cl, y) => addChapter(cl, y, structToast))} disabled={!c}>
        <Icon name="Plus" />
        {t('side.addChapter')}
      </button>
      <button type="button" id="btnAddPart" onClick={() => act((cl, y) => addPart(cl, y, structToast))} disabled={!c}>
        <Icon name="BookmarkPlus" />
        {t('side.addPart')}
      </button>
    </div>
  );

  const rowProps = (row: OutlineRow) => {
    const after = (e: DragEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      return e.clientY - r.top >= r.height / 2;
    };
    const cls = (drag === row.id ? ' dragging' : '') + (drop?.id === row.id ? (drop.after ? ' drop-after' : ' drop-before') : '');
    return {
      draggable: row.isSection,
      className: cls,
      onDragStart: (e: DragEvent) => {
        setDrag(row.id);
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', row.id);
        } catch {
          /* a browser without a data transfer: the drag still runs */
        }
      },
      onDragEnd: () => {
        setDrag(null);
        setDrop(null);
      },
      onDragOver: (e: DragEvent) => {
        if (!drag || drag === row.id) return;
        const from = bkRef.current.rows.find((r) => r.id === drag);
        setDrop(null);
        if (!from || kindOf(from) !== kindOf(row)) return;
        e.preventDefault();
        setDrop({ id: row.id, after: after(e) });
      },
      onDrop: (e: DragEvent) => {
        if (!drag) return;
        e.preventDefault();
        const id = drag;
        setDrag(null);
        setDrop(null);
        const r = act((cl, y) => moveTo(cl, y, id, row.id, after(e)));
        // 1.0's drop handler: `if (!moveSectionTo(...)) toast(toast.moveTier)` — its every false (across tiers, and a
        // section 1.0 no longer finds) says moveTier; 2.0's own refusal (sections without unique ids) says nothing
        if (r && !r.refused && r.value === false) toast(t('toast.moveTier'), 'TriangleAlert');
      },
    };
  };

  // 1.0's renderMatterLib: what stands in the book decides which singleton is marked
  const has = (type: string, kind: string) => bk.rows.some((r) => r.type === type && kindOf(r) === kind);
  const matterLib = (
    <div id="matterLib">
      {bk.phase === 'open' && c && (
        <div className="matter-lib">
          <button type="button" className="matter-lib-toggle" id="btnMatterLib" aria-expanded={libOpen} onClick={() => setLibOpen((o) => !o)}>
            <Icon name="Library" />
            {t('side.addPage')}
            <Icon name={libOpen ? 'ChevronUp' : 'ChevronDown'} className="ml-chev" />
          </button>
          {libOpen && (
            <div className="matter-lib-panel">
              {c.api.MATTER_LIBRARY.map((g) => (
                <div key={g.kind}>
                  <div className="group-label">
                    <span>{g.kind === 'front' ? t('side.groupFront') : t('side.groupBack')}</span>
                  </div>
                  <div className="matter-lib-grid">
                    {g.types.map((ty) => (
                      <button
                        type="button"
                        key={ty}
                        className={'matter-lib-btn' + (c.api.SINGLETON_TYPES.includes(ty) && has(ty, g.kind) ? ' exists' : '')}
                        data-matter={ty}
                        onClick={() => act((cl, y) => insertMatter(cl, y, ty, structToast))}
                      >
                        {t(('import.type.' + ty) as never)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return { rowTools, extra, rowProps, matterLib };
}

/** 1.0's #secSettings: the open section's type (renderSecTypeControl; the change runs retypeSection). */
export function SecTypeControl({ section }: { section: Y.Map<unknown> }) {
  const { t } = useLocale();
  const bk = useBook();
  const c = useClosureReady();
  const [, bump] = useState(0);
  // the select shows the section's type as it stands (a remote retype re-draws it)
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    section.observe(on);
    return () => section.unobserve(on);
  }, [section]);
  if (!c) return null;
  const kind = String(section.get('kind') || 'body'), type = String(section.get('type') || 'chapter'); // 1.0's normalizeSection defaults
  const want = kind + ':' + type;
  const groups = c.api.RETYPE_GROUPS;
  const listed = groups.some((g) => g.kind === kind && g.types.includes(type));
  const groupKey = (k: string) => (k === 'front' ? 'side.groupFront' : k === 'body' ? 'side.groupBody' : 'side.groupBack');
  return (
    <div id="secSettings">
      <div className="switch-row">
        <div className="sw-txt">
          <b>{t('editor.sectionType')}</b>
          <span>{t('editor.sectionTypeDesc')}</span>
        </div>
        <select
          className="txt-input"
          id="secTypeSel"
          aria-label={t('editor.sectionType')}
          value={want}
          onChange={(e) => {
            const value = e.target.value;
            const ydoc = bk.book?.ydoc;
            const id = section.get('id');
            if (!ydoc || typeof id !== 'string') return;
            settleActiveEditor();
            const r = retype(c, ydoc, id, value); // the section's id read now: wherever it stands at the change
            if (r.wrote) bk.select(indexOfId(ydoc, id));
          }}
        >
          {groups.map((g) => (
            <optgroup key={g.kind} label={t(groupKey(g.kind))}>
              {g.types.map((ty) => (
                <option key={ty} value={g.kind + ':' + ty}>
                  {t(('import.type.' + ty) as never)}
                </option>
              ))}
            </optgroup>
          ))}
          {!listed && <option value={want}>{t(('import.type.' + type) as never)}</option>}
        </select>
      </div>
    </div>
  );
}
