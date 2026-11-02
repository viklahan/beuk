import { useEffect, useReducer, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react';
import { bookIdOf } from '../book/store';
import { closureIfLoaded, cloudFacts } from '../closure/index';
import { desk } from '../environment/page';
import type { useLocale } from '../i18n/LocaleProvider';
import { Icon } from '../shell/Icon';
import icons from '../generated/icons.json';
import { mineDelete, mineDeviceThemes, mineList, mineLoad, mineLoaded, mineMoveToAccount, mineOwner, ownerNow, mineSaid, mineSubscribe, mineUi, mineVersion, DEVICE, type MineRec } from './mine';
import { styleState, styleUi, themeSafe } from './session';
import { applyMine, bookThemesNotInMine, listThemes, saveTheme, saveToMine } from './themeActions';

/* Per-user themes ("My themes", plan 2026-11-02, task 3): the Style tab's "Themes for every book" — the writer's own
   list (mine.ts), its cards drawn as 1.0 draws a book theme's (renderMyThemes' classes and words), the one-time offer
   to keep a book's own themes, the one-time offer to move device-only themes to the account on signing in, and a
   "Keep for every book" on each of the book's own themes (an icon button added to 1.0's card, so 1.0's gallery reads
   as it does) and in the Theme Creator. React draws all of it: no HTML string, so a theme's name or fonts are text and
   style values only, after the session's safe path (themeSafe).

   The book's own list keeps 1.0's name "My Themes" (themes.mineH); this one is "Themes for every book" (ruling). */

type T = ReturnType<typeof useLocale>['t'];
type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);

/* ---- the answers to the one-time offers, per device (beuk.* keys; never in the book) ---- */
export const offerKey = (bookId: string) => 'beuk.themes.offer.' + bookId;
export const moveKey = (owner: string) => 'beuk.themes.move.' + owner;
const readKey = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeKey = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* no storage: asked again next time */
  }
};

const toast = (msg: string, icon = 'library-big') => styleUi.toast(msg, icon);

/** The theme as it may be drawn: 1.0's normalizeCustomTheme, then the session's safe path, its fonts allowed to be the
 *  library's and the theme's own uploaded families. Null without the closure. */
function shownTheme(r: MineRec): { th: Rec; hd: Rec; stack: (f: unknown) => string } | null {
  const c = closureIfLoaded();
  if (!c) return null;
  const ct = c.api.normalizeCustomTheme({ id: r.doc.id, name: r.doc.name, theme: JSON.parse(JSON.stringify(r.doc.theme)) });
  if (!ct) return null;
  const fams = new Set(r.doc.assets.filter((a) => a.kind === 'font' && a.family).map((a) => a.family!));
  themeSafe(c, ct.theme, fams);
  const th = ct.theme as Rec;
  const hd = (isRec(th.header) ? th.header : c.api.defaultHeaderDesign(th)) as Rec;
  return { th, hd, stack: (f) => c.api.fontStack(f) };
}
const fontOf = (hd: Rec, k: string) => (isRec(hd[k]) ? String((hd[k] as Rec).font ?? '') : '');

/** "Keep for every book" on each of 1.0's book-theme cards: an icon button (its words in aria-label and title), so the
 *  gallery's text is 1.0's. Returns the uninstaller. */
function decorate(grid: HTMLElement, t: T): () => void {
  const label = t('next.themes.keep');
  const svgOf = () => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    for (const [k, v] of Object.entries({ xmlns: ns, width: '24', height: '24', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'lucide lucide-bookmark-plus', 'aria-hidden': 'true', focusable: 'false' }))
      svg.setAttribute(k, v);
    for (const [tag, attrs] of icons.BookmarkPlus as unknown as [string, Record<string, string>][]) {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      svg.append(el);
    }
    return svg;
  };
  const add = () => {
    for (const card of Array.from(grid.querySelectorAll<HTMLElement>('.preset-card.mine[data-mine]'))) {
      const actions = card.querySelector('.mine-actions');
      if (!actions || actions.querySelector('[data-mine-keep]')) continue;
      const id = card.getAttribute('data-mine') ?? '';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tb-btn';
      b.setAttribute('data-mine-keep', id);
      b.setAttribute('aria-label', label);
      b.title = label;
      b.append(svgOf());
      // 1.0's card applies the theme on a click or Enter anywhere in it: this button's own events stop here
      b.addEventListener('keydown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = listThemes().find((x) => x.id === id)?.name ?? '';
        void saveToMine(id).then((ok) => keptOrNot(t, ok, name));
      });
      actions.append(b);
    }
  };
  add();
  const mo = new MutationObserver(add);
  mo.observe(grid, { childList: true });
  return () => mo.disconnect();
}

/** After a keep: "kept", or — when the store could not keep it and has not said why — 1.0's "Not saved" (review round
 *  2, Minor a: a keep never fails silently). */
function keptOrNot(t: T, ok: boolean, name: string): void {
  if (ok) toast(t('next.themes.kept', { name }));
  else if (!mineSaid) toast(t('local.notSavedShort'), 'alert-triangle');
}

/** The theme creator's "Keep for every book": 1.0's Save (into the book, worn), then kept for every book. */
export function keepFromCreator(t: T): void {
  const id = saveTheme();
  if (!id) return;
  const name = listThemes().find((x) => x.id === id)?.name ?? '';
  void saveToMine(id).then((ok) => keptOrNot(t, ok, name));
}

export function MyThemes({ t }: { t: T }) {
  useSyncExternalStore(mineSubscribe, mineVersion);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [deviceCount, setDeviceCount] = useState(0);
  const list = mineList();
  const owner = mineOwner();
  const signedIn = owner !== DEVICE && !!cloudFacts.user;

  // review (Important 1): 1.0 signs in and out inside the page — the list drawn is always the signed-in account's
  useEffect(() => {
    if (ownerNow() !== mineOwner()) void mineLoad();
  });

  // what the store says, in the interface language
  useEffect(() => {
    mineUi.deviceSuffix = () => t('next.themes.deviceSuffix');
    mineUi.conflict = (name) => toast(t('next.themes.conflict', { name }), 'copy');
    mineUi.refused = (name, why) => toast(t(why === 'full' ? 'next.themes.full' : 'next.themes.refused', { name }), 'alert-triangle');
  }, [t]);

  // 1.0's book-theme cards gain "Keep for every book"; a change of the book's own list draws the offer again
  useEffect(() => {
    const grid = document.getElementById('myThemeGrid');
    if (!grid) return;
    const off = decorate(grid, t);
    const mo = new MutationObserver(() => bump());
    mo.observe(grid, { childList: true });
    return () => {
      off();
      mo.disconnect();
    };
  }, [t]);

  // signing in with device-only themes: how many there are (for the one-time move offer)
  useEffect(() => {
    let alive = true;
    if (!signedIn || readKey(moveKey(owner))) {
      setDeviceCount(0);
      return;
    }
    void mineDeviceThemes().then((d) => alive && setDeviceCount(d.length));
    return () => {
      alive = false;
    };
  }, [signedIn, owner, list.length]);

  const ydoc = desk.ydoc;
  const bookId = ydoc ? bookIdOf(ydoc) : null;
  const offerOpen = mineLoaded() && !!bookId && !readKey(offerKey(bookId)) && bookThemesNotInMine().length > 0;
  const active = (styleState() as { activePreset?: unknown } | null)?.activePreset;

  const answerOffer = async (yes: boolean) => {
    if (!bookId) return;
    if (!yes) writeKey(offerKey(bookId), 'declined');
    else {
      // review round 2 (Minor b): answered only once every keep succeeded; otherwise the offer stands, and it is said
      let all = true;
      for (const ct of bookThemesNotInMine()) if (!(await saveToMine(ct.id))) all = false;
      if (all) writeKey(offerKey(bookId), 'kept');
      else if (!mineSaid) toast(t('local.notSavedShort'), 'alert-triangle');
    }
    bump();
  };
  const answerMove = async (yes: boolean) => {
    writeKey(moveKey(owner), yes ? 'moved' : 'declined');
    if (yes) await mineMoveToAccount();
    setDeviceCount(0);
  };
  const apply = (key: string) => void applyMine(key);
  const onKey = (e: KeyboardEvent, key: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      apply(key);
    }
  };
  const remove = (e: MouseEvent, r: MineRec) => {
    e.stopPropagation();
    void mineDelete(r.key).then((ok) => ok && toast(t('next.themes.removed', { name: r.name }), 'trash-2'));
  };

  return (
    <>
      <h3 className="studio-h">
        <Icon name="LibraryBig" />
        {t('next.themes.everyH')}
      </h3>
      <p className="studio-sub">{t('next.themes.everySub')}</p>
      <p className="studio-sub" id="mineThemesWhere">
        {t(signedIn ? 'next.themes.account' : 'next.themes.deviceOnly')}
      </p>
      {offerOpen && (
        <div className="studio-sub" id="mineThemesOffer" role="group">
          <span>{t('next.themes.offer')}</span>{' '}
          <button type="button" className="tb-btn" id="btnMineOfferYes" onClick={() => void answerOffer(true)}>
            {t('next.themes.offerYes')}
          </button>{' '}
          <button type="button" className="tb-btn" id="btnMineOfferNo" onClick={() => void answerOffer(false)}>
            {t('next.themes.offerNo')}
          </button>
        </div>
      )}
      {signedIn && deviceCount > 0 && (
        <div className="studio-sub" id="mineThemesMove" role="group">
          <span>{t('next.themes.moveOffer')}</span>{' '}
          <button type="button" className="tb-btn" id="btnMineMoveYes" onClick={() => void answerMove(true)}>
            {t('next.themes.moveYes')}
          </button>{' '}
          <button type="button" className="tb-btn" id="btnMineMoveNo" onClick={() => void answerMove(false)}>
            {t('next.themes.offerNo')}
          </button>
        </div>
      )}
      {/* data-ready: the store has read this owner's list (the e2e waits for it, not only for the element) */}
      <div className="preset-grid" id="mineThemeGrid" data-ready={mineLoaded() ? '1' : '0'} data-owner={signedIn ? 'account' : 'device'}>
        {list.length === 0 ? (
          <p className="flourish-empty" style={{ gridColumn: '1 / -1' }}>
            {t('next.themes.empty')}
          </p>
        ) : (
          list.map((r) => {
            const s = shownTheme(r);
            return (
              <div
                key={r.key}
                className={'preset-card mine' + (active === 'custom:' + r.key ? ' active' : '')}
                data-mine-key={r.key}
                role="button"
                tabIndex={0}
                onClick={() => apply(r.key)}
                onKeyDown={(e) => onKey(e, r.key)}
              >
                <span className="p-name" style={s ? { fontFamily: s.stack(fontOf(s.hd, 'title')) } : undefined}>
                  {r.name}
                </span>
                {s && (
                  <>
                    <span className="p-desc" style={{ display: 'block' }}>
                      {t('themes.fontsLine', { num: fontOf(s.hd, 'number'), title: fontOf(s.hd, 'title'), sub: fontOf(s.hd, 'subtitle') })}
                    </span>
                    <span className="p-sample" style={{ display: 'block' }}>
                      <span style={{ fontFamily: s.stack(fontOf(s.hd, 'title')), fontSize: 16 }}>The Quick Brown Fox</span>
                      <br />
                      <span style={{ fontFamily: s.stack(s.th.bodyFont), fontSize: 13.5 }}>Jumps over the lazy dog, down by the harbour wall.</span>
                    </span>
                  </>
                )}
                <span className="mine-actions">
                  <button type="button" className="tb-btn" data-mine-remove={r.key} onClick={(e) => remove(e, r)} onKeyDown={(e) => e.stopPropagation()}>
                    {t('set.remove')}
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
