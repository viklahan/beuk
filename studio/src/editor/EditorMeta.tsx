import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { BODY, escKey } from '@book/editor/index.js';
import { useLocale } from '../i18n/LocaleProvider';
import { ArtRows } from '../pictures/ArtRows';
import { sectionKey } from '../pictures/pictures';
import { previewIfLoaded } from '../preview/preview';
import { usePoem } from './PoemMode';

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

   BEUK:poemmode — while the chapter is a poem (PoemMode.tsx) the drop cap and the small-caps lead-in are not set (a
   poem opens on its first line as it is), so their two switches are not shown; what they store is left as it is,
   and they are back, as they were, when Poem Mode is switched off. While a poem has no text yet its title field
   asks for the poem's name ("Name your poem": a placeholder, never a value). */

/** Whether the section's text is empty: no characters at all (one empty paragraph, or nothing). Read from the
 *  section's own fragment; re-read as it changes while `watch` is on. */
function useNoText(section: Y.Map<unknown>, watch: boolean): boolean {
  const read = (): boolean => {
    const body = section.get(BODY);
    if (!(body instanceof Y.XmlFragment)) return String(section.get('content') ?? '') === '';
    if (body.length === 0) return true;
    if (body.length > 1) return false;
    const first = body.get(0);
    return first instanceof Y.XmlElement && first.nodeName === 'paragraph' && first.toArray().every((c) => c instanceof Y.XmlText && c.length === 0);
  };
  const [empty, setEmpty] = useState(read);
  useEffect(() => {
    if (!watch) return;
    const on = () => setEmpty(read());
    on();
    section.observeDeep(on);
    return () => section.unobserveDeep(on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, watch]);
  return empty;
}

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
  const poem = usePoem(section);
  const noText = useNoText(section, poem.on);
  if (kind !== 'body') return <div id="editorMeta" style={{ display: 'none' }} />;

  const title = str(get('title'));
  const rhStored = get('runHead');
  const runHead = typeof rhStored === 'string' ? rhStored : rhBlank ?? '';
  const dropCap = get('dropCap') !== false;
  const smallCaps = get('smallCaps') !== false;
  const titlePh = poem.on && noText ? t('poem.titlePh') : t('editor.chTitlePh');

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
            placeholder={titlePh}
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
          {!poem.on && (
            <>
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
            </>
          )}
          <ArtRows ydoc={ydoc} section={section} />
        </div>
      )}
    </div>
  );
}
