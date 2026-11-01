import { Fragment, useEffect, useReducer, useRef, type ReactNode } from 'react';
import { fmtNum } from '../history/HistoryDialog';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon, type IconName } from '../shell/Icon';
import { useBook } from './BookProvider';
import type { OutlineRow } from './outlineRows';
import { groupOf, setGroupCollapsed, sidePrefs, type GroupKey } from './sidePrefs';
import { useStats } from './stats';

/* The outline (inventory B1): 1.0's renderSidebar (client/index.html,
   BEUK:sidebar), with its markup and classes:
   - three groups, Front Matter / Body / Back Matter, each heading a toggle
     (.group-label.group-toggle[data-og], aria-expanded, aria-controls
     og-<group>, aria-label "<name> — <n> sections", .og-count); a group
     with no sections is left out, except Body;
   - a folded group (.outline-group.og-collapsed) still shows its active
     row; arriving at a section opens its group (1.0's ogLastActive rule);
     the folds are saved in beuk.sidebar.v1 (sidePrefs.ts);
   - in the body, the chapters after a Part sit under it (.in-part);
   - each row: .sec-item[data-sec] role=button, its icon, its name by
     1.0's rule (outlineRows.ts), its word count (.sec-wc#wc-<id>: "Empty"
     for a page left out of the book, else "<n> w"), .excluded when the
     section is not in the book (1.0's inBook), and .sec-tools.
   Left out, each with its wave: the row's move up / move down and the
   include-in-export eye, Add Chapter / Add Part (.og-extra) and drag to
   reorder — wave 2 (B3, section types, matter and move); the matter
   library (#matterLib) — wave 2 (B3). The counts come from the closure
   (stats.tsx); until the first count a row shows none. */

const GROUPS: GroupKey[] = ['front', 'body', 'back'];
const GROUP_KEY = { front: 'side.groupFront', body: 'side.groupBody', back: 'side.groupBack' } as const;

export type RowTools = (row: OutlineRow) => ReactNode;

export function Outline({ tools }: { tools?: RowTools }) {
  const { t, lang } = useLocale();
  const bk = useBook();
  const stats = useStats();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const list = useRef<HTMLDivElement>(null);

  // 1.0: arriving at a section opens its group (saved), so the section being edited is never hidden
  const lastActive = useRef<string | null>(null);
  const activeRow = bk.rows.find((r) => r.index === bk.active);
  const activeKey = activeRow ? activeRow.id + ':' + activeRow.index : null;
  useEffect(() => {
    if (activeKey === lastActive.current) return;
    lastActive.current = activeKey;
    if (activeRow && setGroupCollapsed(groupOf(activeRow.kind), false)) rerender();
  }, [activeKey, activeRow]);

  if (bk.phase !== 'open') return <div id="structureList" aria-label={t('tabs.structure')} ref={list} />;

  const prefs = sidePrefs();
  const toggle = (gk: GroupKey) => {
    setGroupCollapsed(gk, !sidePrefs().groups[gk]);
    rerender();
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`.group-toggle[data-og="${gk}"]`)?.focus());
  };

  return (
    <div id="structureList" aria-label={t('tabs.structure')} ref={list}>
      {GROUPS.map((gk) => {
        const items = bk.rows.filter((r) => groupOf(r.kind) === gk);
        if (!items.length && gk !== 'body') return null;
        const collapsed = prefs.groups[gk];
        const gName = t(GROUP_KEY[gk]);
        let inPart = false;
        return (
          <Fragment key={gk}>
            <button
              type="button"
              className="group-label group-toggle"
              data-og={gk}
              aria-expanded={collapsed ? 'false' : 'true'}
              aria-controls={'og-' + gk}
              aria-label={gName + ' — ' + t('side.groupCount', { n: items.length })}
              onClick={() => toggle(gk)}
            >
              <Icon name="ChevronDown" className="og-chev" />
              <span className="og-name">{gName}</span>
              <span className="og-count" aria-hidden="true">
                {fmtNum(items.length, lang)}
              </span>
            </button>
            <div className={'outline-group' + (collapsed ? ' og-collapsed' : '')} id={'og-' + gk} data-og-group={gk}>
              {items.map((r) => {
                if (gk === 'body' && r.isPart) inPart = true;
                const isActive = bk.active === r.index;
                const count = stats?.sections.get(r.id) ?? stats?.sections.get(String(r.index));
                const icon: IconName = r.isPart ? 'Bookmark' : r.kind === 'body' ? 'GripVertical' : r.type === 'toc' ? 'ListOrdered' : r.type === 'cover' ? 'Image' : 'FileText';
                const open = () => r.editable && bk.select(r.index);
                const cls =
                  'sec-item' +
                  (isActive ? ' active' : '') +
                  (collapsed && !isActive ? ' og-hidden' : '') +
                  (count && !count.inBook ? ' excluded' : '') +
                  (r.isPart ? ' part-item' : '') +
                  (gk === 'body' && inPart && !r.isPart ? ' in-part' : '');
                return (
                  <div
                    key={r.index + ':' + r.id}
                    className={cls}
                    data-sec={r.id}
                    data-index={r.index}
                    role="button"
                    tabIndex={0}
                    aria-current={isActive ? 'true' : undefined}
                    aria-disabled={r.editable ? undefined : 'true'}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('[data-act]')) return; // a row tool acts on its own
                      open();
                    }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        open();
                      }
                    }}
                  >
                    <span className="drag">
                      <Icon name={icon} />
                    </span>
                    <span className="sec-name">{r.name}</span>
                    {count && (
                      <span className="sec-wc" id={'wc-' + r.id} title={count.emptyOut ? t('side.emptyOut') : undefined}>
                        {count.emptyOut ? t('side.emptyOutShort') : fmtNum(count.words, lang) + ' ' + t('side.wordUnit', { count: count.words })}
                      </span>
                    )}
                    {/* move up / down and the include eye: wave 2 (B3); the action menu: chapter operations (B2) */}
                    <span className="sec-tools">{tools?.(r)}</span>
                  </div>
                );
              })}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
