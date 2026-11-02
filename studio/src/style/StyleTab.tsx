import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type * as Y from 'yjs';
import { useBook } from '../book/BookProvider';
import { closureIfLoaded, loadClosure, type Closure } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon, type IconName } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import icons from '../generated/icons.json';
import { STYLE_KEYS, styleBegin, styleRelease, styleRoot, styleRun, styleSettle, styleUi, styleWriting } from './session';

/* Step 5 wave 4a (inventory D1, D2): 1.0's Typography Studio — the centre pane's "Typography Studio" tab (#panelType,
   the mobile Style tab): its markup, ids, classes and keys (client/index.html "Tab: typography"), drawn by 1.0's own
   renderers and wired by 1.0's own initStudio (lifted): the preset grid, My themes and the theme creator, the font
   pairing, sizes and header style, the book colour, paragraph rhythm, drop caps, justify and hyphenation, the
   ornaments, the flourish and font uploads. Nothing here is controlled by React: React draws the static frame once
   (and its words again on a language change); 1.0's code fills and wires the rest.

   1.0's listeners run inside the tab's session (src/style/session.ts): a capture listener on the tab opens it
   before 1.0's listener runs, and the event's arrival back at the window closes it (a timer closes it too, should a
   listener stop the event) — so every handler runs on 1.0's state of the open book and writes back only what it
   changed. A range or a typed name (an `input` event) is written after a pause. */

type Props = { shown: boolean };

const ICON_NAMES = new Set(Object.keys(icons));
const pascal = (name: string) => name.replace(/(^|-)([a-z0-9])/g, (_m, _a, ch: string) => ch.toUpperCase());
/** 1.0's toast icon name (lucide's kebab name) as one the studio draws (alert-triangle is lucide's TriangleAlert now). */
export function toastIcon(name?: string): IconName | undefined {
  if (!name) return undefined;
  const p = name === 'alert-triangle' ? 'TriangleAlert' : pascal(name);
  return (ICON_NAMES.has(p) ? p : 'Check') as IconName;
}

const EVENTS = ['click', 'change', 'input', 'keydown'] as const;
/** 1.0's own listeners on the tab run inside the session. Returns the uninstaller. */
function guard(root: HTMLElement): () => void {
  const off: (() => void)[] = [];
  for (const type of EVENTS) {
    let end: (() => void) | null = null;
    const open = () => {
      end?.();
      end = styleBegin(type === 'input');
      const mine = end;
      setTimeout(() => {
        if (end === mine) {
          end = null;
          mine?.();
        }
      }, 0);
    };
    const close = () => {
      const e2 = end;
      end = null;
      e2?.();
    };
    root.addEventListener(type, open, true);
    window.addEventListener(type, close);
    off.push(() => {
      root.removeEventListener(type, open, true);
      window.removeEventListener(type, close);
      close();
    });
  }
  return () => off.forEach((f) => f());
}

/** The tab: drawn on its first showing, kept (hidden) after, as 1.0 keeps its panel. */
export function StyleTab({ shown }: Props) {
  const { t, lang } = useLocale();
  const bk = useBook();
  const toast = useToast();
  const ydoc = bk.book?.ydoc ?? null;
  const root = useRef<HTMLDivElement>(null);
  styleUi.toast = (msg, icon) => toast(msg, toastIcon(icon));
  const seen = useRef(false);
  if (shown) seen.current = true;

  // 1.0's initStudio and syncStudioControls on the tab just drawn (a new book draws it afresh: key on the Shell)
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !ydoc || !seen.current) return;
    let alive = true;
    let unguard: (() => void) | null = null;
    const wire = (c: Closure) => {
      if (!alive) return;
      styleRoot.el = el;
      unguard = guard(el);
      styleRun((cc) => {
        cc.vars.fontPickerSig = null;
        cc.api.initStudio();
        cc.api.syncStudioControls();
      });
      void c;
    };
    const now = closureIfLoaded();
    if (now) wire(now);
    else void loadClosure().then(wire).catch(() => undefined);
    return () => {
      alive = false;
      unguard?.();
      styleSettle();
      if (styleRoot.el === el) styleRoot.el = null;
    };
  }, [ydoc, seen.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // 1.0's applyBookDoc: the book's own faces register on arrival (registerAllFonts), so the studio sets type in them
  // from the first render — whether or not the tab is shown
  useEffect(() => {
    if (!ydoc) return;
    let alive = true;
    void loadClosure()
      .then(() => {
        if (alive)
          styleRun((c) => {
            c.vars.fontPickerSig = null;
            c.api.registerAllFonts();
          });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      // the book goes: its held edit written, its faces out of the page, the session let go
      styleRelease();
    };
  }, [ydoc]);

  // the book's style changed elsewhere (another tab, an undo, History): the controls follow
  useEffect(() => {
    if (!ydoc || !seen.current) return;
    const m = ydoc.getMap('meta');
    let queued = false;
    const onMeta = (e: Y.YMapEvent<unknown>) => {
      if (styleWriting() || queued) return;
      if (!STYLE_KEYS.some((k) => e.keysChanged.has(k))) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        if (root.current && styleRoot.el === root.current) styleRun((c) => c.api.syncStudioControls());
      }, 0);
    };
    m.observe(onMeta);
    return () => m.unobserve(onMeta);
  }, [ydoc, seen.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // a language change: 1.0's renderers draw their words again (the frame's words are React's)
  const first = useRef(lang);
  useEffect(() => {
    if (first.current === lang) return;
    first.current = lang;
    if (root.current && styleRoot.el === root.current) styleRun((c) => c.api.syncStudioControls());
  }, [lang]);

  if (!seen.current) return <div id="panelType" className="center-inner" style={{ display: 'none' }} />;
  return (
    <div id="panelType" className="center-inner" ref={root} style={shown ? undefined : { display: 'none' }}>
      <StyleFrame t={t} />
    </div>
  );
}

const H = ({ icon, children }: { icon: IconName; children: ReactNode }) => (
  <h3 className="studio-h">
    <Icon name={icon} />
    {children}
  </h3>
);

/** 1.0's "Tab: typography" markup (client/index.html), its keys through t(); the texts 1.0 leaves without a key stay
 *  as 1.0 writes them. */
export function StyleFrame({ t }: { t: ReturnType<typeof useLocale>['t'] }) {
  return (
    <>
      <H icon="SwatchBook">{t('type.presetsH')}</H>
      <p className="studio-sub">{t('type.presetsSub')}</p>
      <div className="preset-grid" id="presetGrid" />

      <H icon="LibraryBig">{t('themes.mineH')}</H>
      <p className="studio-sub">{t('themes.mineSub')}</p>
      <div className="preset-grid" id="myThemeGrid" />
      <div style={{ marginTop: 10 }}>
        <button className="tb-btn" id="btnNewTheme" type="button">
          <Icon name="PenTool" />
          <span>{t('themes.designNew')}</span>
        </button>
      </div>

      <div className="tc-panel" id="themeCreator" style={{ display: 'none' }}>
        <H icon="PenTool">{t('creator.h')}</H>
        <p className="studio-sub">{t('creator.sub')}</p>
        <div className="ctl-grid">
          <div>
            <label className="field-lab" htmlFor="tcName">
              {t('creator.nameLabel')}
            </label>
            <input className="txt-input" id="tcName" type="text" placeholder={t('creator.namePh')} />
          </div>
          <div>
            <label className="field-lab" htmlFor="tcBase">
              {t('creator.baseLabel')}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="txt-input" id="tcBase" style={{ flex: '1 1 auto', minWidth: 0 }} />
              <button className="tb-btn" id="btnTcBase" type="button" style={{ flex: '0 0 auto' }}>
                {t('creator.baseUse')}
              </button>
            </div>
          </div>
        </div>
        <div className="tc-preview" id="tcPreview" aria-hidden="true" />
        <div id="tcElements" />
        <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          <button className="tb-btn accent" id="btnTcSave" type="button">
            <Icon name="Check" />
            <span>{t('creator.save')}</span>
          </button>
          <button className="tb-btn" id="btnTcClose" type="button">
            {t('creator.close')}
          </button>
        </div>
      </div>

      <H icon="Type">{t('type.fontPairingH')}</H>
      <div className="ctl-grid">
        <div>
          <label className="field-lab" htmlFor="selBodyFont">
            {t('type.bodyFont')}
          </label>
          <select className="txt-input" id="selBodyFont" />
        </div>
        <div>
          <label className="field-lab" htmlFor="selHeadFont">
            {t('type.headFont')}
          </label>
          <select className="txt-input" id="selHeadFont" />
        </div>
        <div>
          <label className="field-lab" htmlFor="rngSize">
            {t('type.fontSize') + ' · '}
            <span className="range-val" id="valSize" />
          </label>
          <input type="range" id="rngSize" min="14" max="26" step="0.5" />
        </div>
        <div>
          <label className="field-lab" htmlFor="rngLeading">
            {t('type.lineHeight') + ' · '}
            <span className="range-val" id="valLeading" />
          </label>
          <input type="range" id="rngLeading" min="1.3" max="2.2" step="0.05" />
        </div>
        <div className="full">
          <label className="field-lab" htmlFor="selHeaderStyle">
            {t('type.headerStyle')}
          </label>
          <select className="txt-input" id="selHeaderStyle">
            <option value="classic_centered">Classic Centered — number, title and ornament, centred</option>
            <option value="modern_stacked">Modern Stacked — left-aligned stack with a hairline rule</option>
            <option value="editorial_left">Editorial Left — margin-set number, title flush left</option>
            <option value="ornate_framed">Ornate Framed — title set inside a double-rule frame</option>
          </select>
        </div>
      </div>

      {/* BEUK:bookcolour */}
      <H icon="Palette">{t('colour.h')}</H>
      <p className="studio-sub">{t('colour.sub')}</p>
      <div className="ctl-grid">
        <div className="full">
          <span className="field-lab" id="colourAccentLab">
            {t('colour.accent')}
          </span>
          <div className="colour-row" id="colourAccentRow" role="group" aria-labelledby="colourAccentLab" />
          <div className="colour-custom">
            <input type="color" id="colourAccentCustom" defaultValue="#7a1f2b" />
            <label className="field-lab" htmlFor="colourAccentCustom">
              {t('colour.custom')}
            </label>
          </div>
        </div>
        <div className="full">
          <span className="field-lab" id="colourTintLab">
            {t('colour.tint')}
          </span>
          <div className="colour-row" id="colourTintRow" role="group" aria-labelledby="colourTintLab" />
          <div className="colour-custom">
            <input type="color" id="colourTintCustom" defaultValue="#fbf5e6" />
            <label className="field-lab" htmlFor="colourTintCustom">
              {t('colour.customTint')}
            </label>
          </div>
        </div>
      </div>
      <p className="colour-msg" id="colourMsg" role="status" aria-live="polite" />
      <p className="studio-sub">{t('colour.tintNote')}</p>
      <p className="studio-sub">{t('colour.printNote')}</p>
      <div className="colour-custom">
        <input type="checkbox" id="colourPrintBlack" />{' '}
        <label className="field-lab" htmlFor="colourPrintBlack">
          {t('colour.printBlack')}
        </label>
      </div>
      <p className="studio-sub">{t('colour.printBlackHint')}</p>
      <p className="studio-sub">{t('colour.darkNote')}</p>
      {/* /BEUK:bookcolour */}

      <H icon="AlignStartVertical">{t('type.rhythmH')}</H>
      <div className="ctl-grid">
        <div className="full">
          <label className="field-lab">{t('type.paraMode')}</label>
          <div className="seg" id="segParaMode">
            <button data-mode="indent" className="active" type="button">
              {t('type.paraIndent')}
            </button>
            <button data-mode="block" type="button">
              {t('type.paraBlock')}
            </button>
          </div>
        </div>
        <div id="indentDepthCtl">
          <label className="field-lab" htmlFor="selIndentDepth">
            {t('type.indentDepth')}
          </label>
          <select className="txt-input" id="selIndentDepth">
            <option value="1em">1 em — subtle</option>
            <option value="1.5em">1.5 em — classic</option>
            <option value="2em">2 em — deep literary</option>
            <option value="2.5em">2.5 em — dramatic</option>
          </select>
        </div>
        <div>
          <label className="field-lab" htmlFor="selDropDepth">
            {t('type.dropDepth')}
          </label>
          <select className="txt-input" id="selDropDepth">
            {[2, 3, 4].map((n) => (
              <option value={String(n)} key={n}>
                {t('type.dropLines', { n })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-lab" htmlFor="rngSmallCaps">
            {t('type.smallCapsLead') + ' · '}
            <span className="range-val" id="valSmallCaps" />
          </label>
          <input type="range" id="rngSmallCaps" min="2" max="5" step="1" />
        </div>
        <div>
          <div className="switch-row" style={{ border: 'none', padding: '4px 0' }}>
            <div className="sw-txt">
              <b>{t('type.justified')}</b>
              <span>text-align: justify</span>
            </div>
            <button className="switch" id="tglJustify" type="button" aria-pressed="true" aria-label="Toggle justification" />
          </div>
        </div>
        <div>
          <div className="switch-row" style={{ border: 'none', padding: '4px 0' }}>
            <div className="sw-txt">
              <b>{t('type.hyphenation')}</b>
              <span>hyphens: auto</span>
            </div>
            <button className="switch" id="tglHyph" type="button" aria-pressed="true" aria-label="Toggle hyphenation" />
          </div>
        </div>
      </div>

      <H icon="SeparatorHorizontal">{t('type.ornamentH')}</H>
      <p className="studio-sub">
        Ornaments are resolution-independent SVG glyphs sized in <span style={{ fontFamily: 'var(--mono-font)' }}>em</span> units, so they stay crisp from a phone
        to a 300 dpi Paperwhite.
      </p>
      <div className="orn-grid" id="ornamentGrid" />

      <H icon="Sparkles">{t('flourish.h')}</H>
      <p className="studio-sub">{t('flourish.sub')}</p>
      <div className="flourish-list" id="flourishList" />
      <div className="ctl-grid">
        <div>
          <label className="field-lab" htmlFor="flourishName">
            {t('flourish.nameLabel')}
          </label>
          <input className="txt-input" id="flourishName" type="text" placeholder={t('flourish.namePh')} />
        </div>
        <div>
          <label className="field-lab" aria-hidden="true">
            {' '}
          </label>
          <button className="tb-btn" id="btnFlourishUpload" type="button">
            <Icon name="Upload" />
            {t('flourish.upload')}
          </button>
        </div>
        <div className="full">
          <label className="field-lab" htmlFor="selHeadingFlourish">
            {t('flourish.headingLabel')}
          </label>
          <select className="txt-input" id="selHeadingFlourish" />
        </div>
        <div className="full">
          <label className="field-lab">{t('flourish.posLabel')}</label>
          <div className="seg" id="segFlourishPos">
            <button type="button" data-fpos="above" className="active">
              {t('flourish.posAbove')}
            </button>
            <button type="button" data-fpos="below">
              {t('flourish.posBelow')}
            </button>
          </div>
        </div>
      </div>
      <p className="studio-sub" style={{ marginTop: 10 }}>
        <span>{t('flourish.fileNote')}</span> <span>{t('flourish.choicesNote')}</span>
      </p>

      <H icon="CaseSensitive">{t('fonts.h')}</H>
      <p className="studio-sub">{t('fonts.sub')}</p>
      <div className="flourish-list" id="fontList" />
      <div>
        <button className="tb-btn" id="btnFontUpload" type="button">
          <Icon name="Upload" />
          <span>{t('fonts.upload')}</span>
        </button>
      </div>
      <p className="studio-sub" style={{ marginTop: 10 }}>
        <span>{t('fonts.rights')}</span> <span>{t('fonts.embedNote')}</span>
      </p>
      {/* 1.0's two hidden file inputs (they stand at the end of its <body>; here inside the tab, so the tab's session
          wraps their change events) */}
      <input type="file" id="flourishFileInput" accept="image/svg+xml,image/png,.svg,.png" style={{ display: 'none' }} />
      <input type="file" id="fontFileInput" accept=".ttf,.otf,font/ttf,font/otf,application/x-font-ttf,application/x-font-otf" style={{ display: 'none' }} />
    </>
  );
}
