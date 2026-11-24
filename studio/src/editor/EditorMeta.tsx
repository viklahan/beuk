import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { escKey } from '@book/editor/index.js';
import { EveryChapter } from '../chapters/EveryChapter';
import { useLocale } from '../i18n/LocaleProvider';
import { ArtRows } from '../pictures/ArtRows';
import { sectionKey } from '../pictures/pictures';
import { previewIfLoaded } from '../preview/preview';

/* 1.0's chapter heading block, #editorMeta (client/index.html, the markup above #insertToolbar): the chapter number,
   title, subtitle and short running head (.meta-grid), then #bodyArtRows: the drop cap and small-caps lead-in
   switches, then the chapter-art rows (src/pictures/ArtRows.tsx).

   Which section shows what is 1.0's syncEditor: #editorMeta only for a body section (it stays in the page, hidden,
   for any other: the Zen fold's aria-controls names it); #bodyArtRows not for a Part (a Part edits its number, title
   and subtitle like any body piece, but carries no art rows). The kind and type are read as 1.0's normalizeSection
   holds them (no kind is "body", no type is "chapter"), and so are the values the fields show (`s.title || ""`;
   the switches pressed unless the section says false: `dropCap: s.dropCap !== false`).

   1.0's handlers are inline listeners in initEditor (nothing to lift); each write below mirrors one, and is a new
   value set on the section's Y map in one transaction, never a value mutated in place:
   - chNumber / chTitle / chSubtitle "input": number / title / subtitle as typed, then pvShowTitle() (lifted: the
     preview module's own) so the redraw turns to the chapter's title page; the sidebar, contents, preview and print
     heads all read the section, so they follow it (1.0's renderSidebar / renderPreview are React's re-render here);
   - chRunHead "input" (BEUK:headfit): runHead as typed when it has a letter, else the key is removed; the field's
     placeholder is the title (the head falls back to it);
   - tglDropCap / tglSmallCaps (bindSwitch): the opposite of what the switch shows.

   Not 1.0's (2026-11-24): after the art rows, "Use on every chapter…" (src/chapters/EveryChapter.tsx) copies this
   chapter's backdrop, drop cap, lead-in or plate fit to every other chapter. It stands inside #bodyArtRows, so it
   shows for exactly the sections those rows show for. */

type Rec = Record<string, unknown>;

/** 1.0's `s.x || ""`, as an input shows it. */
const str = (v: unknown): string => (v ? String(v) : '');

export function EditorMeta({ ydoc, section }: { ydoc: Y.Doc; section: Y.Map<unknown> }) {
  const { t } = useLocale();
  const [, bump] = useState(0);
  /* 1.0's running-head field keeps what was typed even when the section drops the key (a blank head is no head):
     the blank text stands in the field until the section has a head again. */
  const [rhBlank, setRhBlank] = useState<string | null>(null);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    section.observe(on);
    return () => section.unobserve(on);
  }, [section]);

  const get = (k: string) => sectionKey(section, k);
  const write = (patch: Rec) => {
    ydoc.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) section.delete(escKey(k));
        else section.set(escKey(k), v);
      }
    });
  };
  // 1.0's pvShowTitle: the next preview draw turns to the open chapter's title page
  const showTitle = () => {
    const pv = previewIfLoaded();
    if (pv && typeof pv.api.pvShowTitle === 'function') pv.api.pvShowTitle();
  };

  const kind = get('kind') || 'body';
  const type = get('type') || 'chapter';
  if (kind !== 'body') return <div id="editorMeta" style={{ display: 'none' }} />;

  const title = str(get('title'));
  const rhStored = get('runHead');
  const runHead = typeof rhStored === 'string' ? rhStored : rhBlank ?? '';
  const dropCap = get('dropCap') !== false;
  const smallCaps = get('smallCaps') !== false;

  return (
    <div id="editorMeta">
      <div className="meta-grid">
        <div>
          <label className="field-lab" htmlFor="chNumber">
            {t('editor.chapterNumber')}
          </label>
          <input
            className="txt-input"
            id="chNumber"
            type="text"
            placeholder={t('editor.chNumberPh')}
            value={str(get('number'))}
            onChange={(e) => {
              write({ number: e.target.value });
              showTitle();
            }}
          />
        </div>
        <div>
          <label className="field-lab" htmlFor="chTitle">
            {t('editor.chapterTitle')}
          </label>
          <input
            className="txt-input"
            id="chTitle"
            type="text"
            placeholder={t('editor.chTitlePh')}
            value={title}
            onChange={(e) => {
              write({ title: e.target.value });
              showTitle();
            }}
          />
        </div>
        <div className="wide">
          <label className="field-lab" htmlFor="chSubtitle">
            {t('editor.chapterSubtitle')}
          </label>
          <input
            className="txt-input"
            id="chSubtitle"
            type="text"
            placeholder={t('editor.chSubtitlePh')}
            value={str(get('subtitle'))}
            onChange={(e) => {
              write({ subtitle: e.target.value });
              showTitle();
            }}
          />
        </div>
        <div className="wide">
          <label className="field-lab" htmlFor="chRunHead">
            {t('editor.runHead')}
          </label>
          <input
            className="txt-input"
            id="chRunHead"
            type="text"
            maxLength={120}
            placeholder={title}
            value={runHead}
            onChange={(e) => {
              const v = e.target.value;
              setRhBlank(v.trim() ? null : v);
              write({ runHead: v.trim() ? v : undefined });
            }}
          />
        </div>
      </div>
      {type !== 'part' && (
        <div id="bodyArtRows" style={{ marginTop: 6 }}>
          <div className="switch-row">
            <div className="sw-txt">
              <b>{t('editor.dropCap')}</b>
              <span>{t('editor.dropCapDesc')}</span>
            </div>
            <button className="switch" id="tglDropCap" aria-pressed={dropCap ? 'true' : 'false'} aria-label={t('editor.dropCapAria')} onClick={() => write({ dropCap: !dropCap })} />
          </div>
          <div className="switch-row">
            <div className="sw-txt">
              <b>{t('editor.smallCaps')}</b>
              <span>{t('editor.smallCapsDesc')}</span>
            </div>
            <button className="switch" id="tglSmallCaps" aria-pressed={smallCaps ? 'true' : 'false'} aria-label={t('editor.smallCapsAria')} onClick={() => write({ smallCaps: !smallCaps })} />
          </div>
          <ArtRows ydoc={ydoc} section={section} />
          <EveryChapter ydoc={ydoc} section={section} />
        </div>
      )}
    </div>
  );
}
