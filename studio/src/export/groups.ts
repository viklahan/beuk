import type { UiKey } from '../i18n/strings';

/* The export screen, short (V, 2026-11-23: "the export screen is getting longer and longer"): 1.0's export modal is one
   long column of every format. Here its parts are MOVED — the very nodes, never made again, so every id, every listener
   1.0's initExport put on them and every later write by 1.0's code still lands — into six groups, each under a header
   that is a real button. All are closed when the screen opens and one is open at a time. Store-ready and Close stay
   outside, always in view, and so does the proof's place (src/export/Proof.tsx) under the title.

   Nothing of 1.0's is changed: client/index.html's markup and its handlers are as they were; this is the 2.0 layer's
   arrangement of them.

   - A group none of whose parts shows (the archive before a shelf is linked: 1.0's renderCloudChrome sets #archiveSec's
     display) hides its header too, and shows it again when 1.0 shows the part.
   - COMPLETENESS GUARD: a part of the modal no group claims (a section 1.0 gains later) is never hidden: it stays in
     view, ungrouped, after the groups, and unclassified() names it (test/export-groups.test.ts fails on it).
   - What shows, scrolls to or focuses a part of the modal opens that part's group: 1.0's result panels when a result is
     written into them (ANSWERS: each time; NOTES: when the words are new), 1.0's scroll to the trim sizes (SCROLLS:
     preflightJumpTo), 1.0's focus of the new share link's field (FOCUSES: betaCopy). What 1.0 draws as the screen
     opens opens nothing. */

export type GroupId = 'ebook' | 'print' | 'files' | 'audio' | 'boxset' | 'archive';
type GroupDef = { id: GroupId; title: UiKey; sub: UiKey; icon: string; claims: readonly string[] };

/** The groups, in the screen's order. A part of the modal (a child of its .modal) belongs to the first group one of
 *  whose `claims` it is or holds. */
export const EXPORT_GROUPS: readonly GroupDef[] = [
  // the EPUB block is loose siblings in 1.0, not a .fmt-sec: its heading, the line under it (EPUB_LEAD), the presets,
  // their detail, the package tree, the check list, Build and Inspect; then the validator and the accessibility audit
  { id: 'ebook', title: 'expg.ebook', sub: 'expg.ebookSub', icon: 'book-down',
    claims: ['[data-i18n="exp.epubH"]', '#platformGrid', '#platformDetail', '#exportTree', '#platformCheck', '#btnBuildEpub', '#btnValidate', '#btnA11y'] },
  { id: 'print', title: 'expg.print', sub: 'expg.printSub', icon: 'printer', claims: ['#btnPreflight', '#btnOpenPrintView'] },
  { id: 'files', title: 'expg.files', sub: 'expg.filesSub', icon: 'file-text', claims: ['#btnDownloadMd', '#btnDownloadHtml', '#btnDownloadDocx', '#btnMsOpen'] },
  { id: 'audio', title: 'expg.audio', sub: 'expg.audioSub', icon: 'headphones', claims: ['#btnAcxOpen'] },
  { id: 'boxset', title: 'expg.boxset', sub: 'expg.boxsetSub', icon: 'library-big', claims: ['#btnBuildBoxSet'] },
  // #betaSec: the share section 1.0's cloud module injects after the archive (betaInjectDom)
  { id: 'archive', title: 'expg.archive', sub: 'expg.archiveSub', icon: 'archive', claims: ['#archiveSec', '#betaSec'] },
];
/** The parts that stay outside the groups, always in view: the title, its line, Store-ready, Close. */
export const EXPORT_FIXED: readonly string[] = ['#expH', '[data-i18n="exp.sub"]', '#btnStoreReady', '#btnCloseExport'];
/** 1.0's EPUB block has one part with no name of its own: the paragraph straight after its heading. */
const EPUB_HEAD = '[data-i18n="exp.epubH"]';

/** 1.0's result panels that are written only when the writer asks (runValidation, runA11yCheck, runPrintPreflight: a
 *  button in the group, or the store check's "Validate" from outside it): every answer written opens the group, the
 *  same words as last time too (the writer asked again). 1.0's renderPlatformPresets empties two of them: an emptied
 *  panel opens nothing. */
export const ANSWERS: readonly string[] = ['validateResults', 'a11yResults', 'preflightResults'];
/** 1.0's panels that are also drawn again unasked (the archive's list re-read, the print-ready PDF's poll, EPUBCheck's
 *  poll): one opens its group when it is shown with NEW words; the same words drawn again leave the screen as it is. */
export const NOTES: readonly string[] = ['printReadyNote', 'archiveNote', 'epubCheckResult'];
/** Elements 1.0 scrolls to (scrollIntoView) inside the modal: preflightJumpTo's #trimGrid, in both closures. */
export const SCROLLS: readonly string[] = ['trimGrid'];
/** Elements 1.0 focuses inside the modal from outside a click on them: betaCopy's #betaNewUrl (drawn anew each time). */
export const FOCUSES: readonly string[] = ['betaNewUrl'];

export type ExportGroups = {
  /** Open one group (the others close), or close them all. */
  open: (id: GroupId | null) => void;
  openId: () => GroupId | null;
  /** Open the group that holds `el`. False when it is outside the groups. */
  reveal: (el: Element | null) => boolean;
  /** The parts of the modal no group claims, named (the completeness guard). */
  unclassified: () => string[];
  /** Where the proof's block goes: under the title and its line, above Store-ready. */
  proofHost: HTMLElement;
  destroy: () => void;
};

const holds = (el: Element, sel: string): boolean => el.matches(sel) || el.querySelector(sel) !== null;
/** A part's name for the guard's report: its tag, id and classes, and its heading's words when it has one. */
function nameOf(el: Element): string {
  const h = el.querySelector('h3, h2');
  const words = (h?.textContent || '').trim();
  return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + Array.from(el.classList).map((c) => '.' + c).join('') + (words ? ' "' + words + '"' : '');
}
const shown = (el: HTMLElement): boolean => !el.hidden && el.style.display !== 'none';

/** Arrange 1.0's export modal (`back`: #modalExport, its markup just placed) into the groups. */
export function groupExport(back: HTMLElement): ExportGroups {
  const box = back.querySelector<HTMLElement>('.modal') ?? back;
  const doc = back.ownerDocument;
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
    const el = doc.createElement(tag);
    el.className = cls;
    return el;
  };

  /* ---- the frame: the proof's place, and the list of groups ---- */
  const proofHost = mk('div', 'exp-proof');
  const list = mk('div', 'exg-list');
  type Group = { def: GroupDef; wrap: HTMLElement; head: HTMLButtonElement; body: HTMLElement };
  const made: Group[] = EXPORT_GROUPS.map((def) => {
    const wrap = mk('div', 'exg');
    wrap.setAttribute('data-exg', def.id);
    const h = mk('h3', 'exg-h');
    const head = mk('button', 'exg-head');
    head.type = 'button';
    head.id = 'exgHead-' + def.id;
    head.setAttribute('aria-expanded', 'false');
    head.setAttribute('aria-controls', 'exgBody-' + def.id);
    const icon = doc.createElement('i');
    icon.setAttribute('data-lucide', def.icon);
    icon.setAttribute('class', 'exg-icon');
    const txt = mk('span', 'exg-txt');
    const title = mk('span', 'exg-title');
    title.setAttribute('data-i18n', def.title);
    const sub = mk('span', 'exg-sub');
    sub.setAttribute('data-i18n', def.sub);
    txt.append(title, sub);
    const chev = doc.createElement('i');
    chev.setAttribute('data-lucide', 'chevron-down');
    chev.setAttribute('class', 'exg-chev');
    head.append(icon, txt, chev);
    h.append(head);
    const body = mk('div', 'exg-body');
    body.id = 'exgBody-' + def.id;
    body.setAttribute('role', 'region');
    body.setAttribute('aria-labelledby', head.id);
    body.hidden = true;
    wrap.append(h, body);
    list.append(wrap);
    return { def, wrap, head, body };
  });
  const ours = (el: Element): boolean => el === proofHost || el === list;

  /* ---- one open at a time ---- */
  let current: GroupId | null = null;
  const open = (id: GroupId | null): void => {
    current = id;
    for (const g of made) {
      const on = g.def.id === id;
      if (g.head.getAttribute('aria-expanded') !== String(on)) g.head.setAttribute('aria-expanded', String(on));
      if (g.body.hidden === on) g.body.hidden = !on;
      g.wrap.classList.toggle('open', on);
    }
  };
  const groupOfEl = (el: Element | null): Group | undefined => made.find((g) => !!el && g.body.contains(el));
  const reveal = (el: Element | null): boolean => {
    const g = groupOfEl(el);
    if (!g) return false;
    if (current !== g.def.id) open(g.def.id);
    return true;
  };
  const off: (() => void)[] = [];
  for (const g of made) {
    const onClick = () => {
      open(current === g.def.id ? null : g.def.id);
      // the header pressed stays in view when a long group above it closes
      if (current === g.def.id && typeof g.head.scrollIntoView === 'function') g.head.scrollIntoView({ block: 'nearest' });
    };
    g.head.addEventListener('click', onClick);
    off.push(() => g.head.removeEventListener('click', onClick));
  }

  /* ---- every part of the modal to its place (again whenever 1.0 or a module adds one) ---- */
  let loose: HTMLElement[] = [];
  const place = (): void => {
    const parts = Array.from(box.children).filter((c): c is HTMLElement => c instanceof HTMLElement && !ours(c));
    // classified first, on the order 1.0 has them in: the EPUB block's unnamed line is known by what it follows
    const homes = parts.map((p, i) => {
      if (EXPORT_FIXED.some((s) => holds(p, s))) return 'fixed' as const;
      const g = made.find((m) => m.def.claims.some((s) => holds(p, s)));
      if (g) return g;
      const prev = parts[i - 1];
      if (p.tagName === 'P' && prev && holds(prev, EPUB_HEAD)) return made[0]!;
      return null;
    });
    if (!proofHost.isConnected) {
      const line = box.querySelector(':scope > [data-i18n="exp.sub"]') ?? box.querySelector(':scope > #expH');
      if (line) line.after(proofHost);
      else box.prepend(proofHost);
    }
    if (!list.isConnected) {
      // where the first grouped part stood (after Store-ready, as 1.0 orders them); else before Close
      const first = parts.find((_, i) => homes[i] && homes[i] !== 'fixed');
      const close = parts.find((p) => holds(p, '#btnCloseExport'));
      if (first) first.before(list);
      else if (close) close.before(list);
      else box.append(list);
    }
    const unclaimed: HTMLElement[] = [];
    parts.forEach((p, i) => {
      const home = homes[i];
      if (home === 'fixed') return;
      if (home) {
        home.body.append(p);
        return;
      }
      unclaimed.push(p);
    });
    // the ones already there keep their order; one that arrives later comes after them
    loose = [...loose.filter((p) => unclaimed.includes(p)), ...unclaimed.filter((p) => !loose.includes(p))];
    // the unclaimed parts: in view, in their order, straight after the groups
    let after: Element = list;
    for (const p of loose) {
      if (after.nextElementSibling !== p) after.after(p);
      after = p;
    }
  };
  place();

  /* ---- a group with nothing to show hides its header ---- */
  const syncShown = (): void => {
    for (const g of made) {
      const none = !Array.from(g.body.children).some((c) => c instanceof HTMLElement && shown(c));
      if (g.wrap.hidden !== none) g.wrap.hidden = none;
      if (none && current === g.def.id) open(null);
    }
  };
  syncShown();

  /* ---- 1.0's scrolls and focuses into the modal open the group first ---- */
  const patched = new WeakSet<Element>();
  const patch = (): void => {
    for (const id of SCROLLS) {
      const el = box.querySelector<HTMLElement>('#' + id);
      if (!el || patched.has(el)) continue;
      patched.add(el);
      el.scrollIntoView = function (this: HTMLElement, arg?: boolean | ScrollIntoViewOptions) {
        reveal(this);
        const own = Element.prototype.scrollIntoView as ((a?: boolean | ScrollIntoViewOptions) => void) | undefined;
        if (typeof own === 'function') own.call(this, arg);
      };
    }
    for (const id of FOCUSES) {
      const el = box.querySelector<HTMLElement>('#' + id);
      if (!el || patched.has(el)) continue;
      patched.add(el);
      el.focus = function (this: HTMLElement, arg?: FocusOptions) {
        reveal(this);
        HTMLElement.prototype.focus.call(this, arg);
      };
    }
  };
  patch();

  /* ---- 1.0's result panels: a result written, shown, opens its group ---- */
  const said = new Map<string, string>();
  const wordsOf = (el: HTMLElement | null): string => (el && shown(el) ? (el.textContent || '').trim() : '');
  /** The panels as they stand after `records`; `act`: open the group of an answer just written, or of a note whose
   *  words are new. */
  const readResults = (act: boolean, records: MutationRecord[]): void => {
    for (const id of ANSWERS) {
      const el = box.querySelector<HTMLElement>('#' + id);
      if (!act || !el || !wordsOf(el)) continue;
      // written into (its children or their text), or shown (its own style or hidden attribute)
      if (records.some((r) => (r.type === 'attributes' ? r.target === el : el.contains(r.target)))) reveal(el);
    }
    for (const id of NOTES) {
      const el = box.querySelector<HTMLElement>('#' + id);
      const now = wordsOf(el);
      const was = said.get(id) ?? '';
      said.set(id, now);
      if (act && now && now !== was) reveal(el);
    }
  };
  readResults(false, []);

  let wasOpen = back.classList.contains('open');
  const watch = new MutationObserver((records) => {
    if (records.some((r) => r.type === 'childList' && r.target === box)) place();
    patch();
    syncShown();
    const isOpen = back.classList.contains('open');
    if (isOpen && !wasOpen) {
      // the screen opens: every group closed, and what 1.0 drew on the way in is not news
      open(null);
      readResults(false, records);
    } else readResults(isOpen, records);
    wasOpen = isOpen;
  });
  watch.observe(back, { attributes: true, attributeFilter: ['class', 'style', 'hidden'], childList: true, characterData: true, subtree: true });

  return {
    open,
    openId: () => current,
    reveal,
    unclassified: () => loose.filter((p) => p.isConnected).map(nameOf),
    proofHost,
    destroy: () => {
      watch.disconnect();
      off.forEach((f) => f());
    },
  };
}
