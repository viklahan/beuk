import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import markup from '../src/generated/export-markup.json';
import en from '../src/generated/packs/en.json';
import { EXPORT_GROUPS, FOCUSES, SCROLLS, groupExport, type ExportGroups } from '../src/export/groups';

/* The export screen's groups (src/export/groups.ts), on 1.0's own markup (src/generated/export-markup.json: #modalExport,
   verbatim). The modal's nodes are MOVED into six groups, never made again: every id is the node it was, a listener put
   on a button before the grouping still hears its click. One group is open at a time, all are closed when the screen
   opens, a group with nothing to show hides its header, and a section no group claims stays in view after the groups
   and is named (the completeness guard: a new 1.0 section fails here until it is classified). */

let groups: ExportGroups | null = null;
function place(extra = ''): HTMLElement {
  document.body.innerHTML = markup.modal;
  const back = document.getElementById('modalExport')!;
  if (extra) back.querySelector('.modal-actions')!.insertAdjacentHTML('beforebegin', extra);
  return back;
}
afterEach(() => {
  groups?.destroy();
  groups = null;
  document.body.innerHTML = '';
});
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const groupOf = (el: Element): string | null => el.closest('[data-exg]')?.getAttribute('data-exg') ?? null;
const head = (id: string) => document.querySelector<HTMLButtonElement>(`[data-exg="${id}"] .exg-head`)!;
const body = (id: string) => document.querySelector<HTMLElement>(`[data-exg="${id}"] .exg-body`)!;
const wrap = (id: string) => document.querySelector<HTMLElement>(`[data-exg="${id}"]`)!;
const openIds = () => EXPORT_GROUPS.map((g) => g.id).filter((id) => head(id).getAttribute('aria-expanded') === 'true');

/** Where every part of 1.0's export modal belongs: an element that names the part → its group (null: outside the groups). */
const HOME: [string, string | null][] = [
  ['#expH', null], ['[data-i18n="exp.sub"]', null], ['#btnStoreReady', null], ['#btnCloseExport', null],
  ['[data-i18n="exp.epubH"]', 'ebook'], ['#platformGrid', 'ebook'], ['#platformDetail', 'ebook'], ['#exportTree', 'ebook'], ['#platformCheck', 'ebook'], ['#coverCheck', 'ebook'],
  ['#btnBuildEpub', 'ebook'], ['#btnInspect', 'ebook'], ['#btnValidate', 'ebook'], ['#validateResults', 'ebook'], ['#btnA11y', 'ebook'], ['#a11yResults', 'ebook'],
  ['#btnPreflight', 'print'], ['#preflightResults', 'print'], ['#trimGrid', 'print'], ['#btnOpenPrintView', 'print'], ['#btnOpenSpreads', 'print'], ['#btnPrintReadyPdf', 'print'], ['#printReadyNote', 'print'],
  ['#btnDownloadMd', 'files'], ['#btnCopyMd', 'files'], ['#btnDownloadHtml', 'files'], ['#btnDownloadDocx', 'files'], ['#lockDocx', 'files'], ['#btnMsOpen', 'files'],
  ['#btnAcxOpen', 'audio'],
  ['#boxSetList', 'boxset'], ['#btnBoxSetAdd', 'boxset'], ['#btnBuildBoxSet', 'boxset'], ['#boxSetFileInput', 'boxset'],
  ['#archiveSec', 'archive'], ['#btnArcEpub', 'archive'], ['#archiveNote', 'archive'], ['#archiveList', 'archive'], ['#epubCheckResult', 'archive'],
];

describe('the export screen in groups', () => {
  it("every part of 1.0's modal is in exactly one place, the node it was, with its id", () => {
    const back = place();
    const box = back.querySelector<HTMLElement>('.modal')!;
    const before = Array.from(back.querySelectorAll<HTMLElement>('[id]'));
    const ids = before.map((e) => e.id);
    const parts = Array.from(box.children);
    groups = groupExport(back);
    // no part of the modal was made again or lost: the same nodes, the same ids, each once
    expect(Array.from(back.querySelectorAll<HTMLElement>('[id]')).filter((e) => !e.closest('.exg-head') && !e.classList.contains('exg-body') && !e.classList.contains('exg-head')).map((e) => e.id).sort()).toEqual([...ids].sort());
    for (const e of before) expect($(e.id), e.id).toBe(e);
    for (const p of parts) expect(back.contains(p), p.outerHTML.slice(0, 80)).toBe(true);
    // each named part is where it belongs
    for (const [sel, home] of HOME) {
      const el = back.querySelector(sel)!;
      expect(el, sel).not.toBeNull();
      expect(groupOf(el), sel).toBe(home);
    }
    // every part of the modal is outside the groups (the title, its line, Store-ready, Close) or inside exactly one
    for (const p of parts) {
      const inGroups = Array.from(back.querySelectorAll('.exg-body')).filter((b) => b.contains(p)).length;
      const fixed = p.matches('#expH, [data-i18n="exp.sub"], .st-entry, .modal-actions');
      expect(inGroups, p.outerHTML.slice(0, 80)).toBe(fixed ? 0 : 1);
      if (!fixed) expect(p.parentElement!.classList.contains('exg-body'), p.outerHTML.slice(0, 80)).toBe(true);
    }
    // the sections of a group keep 1.0's order
    expect(Array.from(body('ebook').children).map((c) => c.querySelector('[id]')?.id || c.id || c.tagName)).toEqual(['H3', 'P', 'platformGrid', 'platformDetail', 'exportTree', 'coverCheck', 'btnBuildEpub', 'btnValidate', 'btnA11y']);
    expect(Array.from(body('print').children).map((c) => c.querySelector('button')!.id)).toEqual(['btnPreflight', 'tglRecto']);
    expect(Array.from(body('files').children).map((c) => c.querySelector('button')!.id)).toEqual(['btnDownloadMd', 'btnDownloadHtml', 'btnDownloadDocx', 'btnMsOpen']);
  });

  it('six groups in order, each under a real button with its state and one line of words; Store-ready and Close stay outside', () => {
    const back = place();
    groups = groupExport(back);
    expect(EXPORT_GROUPS.map((g) => g.id)).toEqual(['ebook', 'print', 'files', 'audio', 'boxset', 'archive']);
    expect(Array.from(back.querySelectorAll('[data-exg]')).map((g) => g.getAttribute('data-exg'))).toEqual(['ebook', 'print', 'files', 'audio', 'boxset', 'archive']);
    for (const g of EXPORT_GROUPS) {
      const h = head(g.id), b = body(g.id);
      expect(h.tagName).toBe('BUTTON');
      expect(h.getAttribute('type')).toBe('button');
      expect(h.getAttribute('aria-expanded')).toBe('false');
      expect(h.getAttribute('aria-controls')).toBe(b.id);
      expect(b.id).not.toBe('');
      expect(b.hidden).toBe(true);
      expect(b.getAttribute('aria-labelledby')).toBe(h.id);
      // its name and its one line are interface strings (1.0's translator fills every data-i18n)
      const keys = Array.from(h.querySelectorAll('[data-i18n]')).map((x) => x.getAttribute('data-i18n'));
      expect(keys).toEqual([g.title, g.sub]);
      for (const k of keys) expect(typeof (en as Record<string, string>)[k!], k!).toBe('string');
    }
    // the order of the screen: the title, its line, the proof's place, Store-ready, the groups, Close
    const box = back.querySelector('.modal')!;
    expect(Array.from(box.children).map((c) => c.id || c.className || c.tagName)).toEqual(['expH', 'm-sub', 'exp-proof', 'st-entry', 'exg-list', 'modal-actions']);
    expect(groups.proofHost).toBe(box.querySelector('.exp-proof'));
    expect(groupOf($('btnStoreReady'))).toBeNull();
    expect(groupOf($('btnCloseExport'))).toBeNull();
  });

  it('one group is open at a time; its header closes it again', () => {
    const back = place();
    groups = groupExport(back);
    expect(openIds()).toEqual([]);
    head('ebook').click();
    expect(openIds()).toEqual(['ebook']);
    expect(body('ebook').hidden).toBe(false);
    expect(groups.openId()).toBe('ebook');
    head('print').click();
    expect(openIds()).toEqual(['print']);
    expect(body('ebook').hidden).toBe(true);
    expect(body('print').hidden).toBe(false);
    head('print').click();
    expect(openIds()).toEqual([]);
    expect(body('print').hidden).toBe(true);
    expect(groups.openId()).toBeNull();
  });

  it('every group is closed each time the screen opens', async () => {
    const back = place();
    groups = groupExport(back);
    back.classList.add('open');
    await tick();
    head('files').click();
    expect(openIds()).toEqual(['files']);
    back.classList.remove('open');
    await tick();
    back.classList.add('open');
    await tick();
    expect(openIds()).toEqual([]);
  });

  it("a click on 1.0's button inside a group still reaches the listener it had", () => {
    const back = place();
    const heard: string[] = [];
    for (const id of ['btnValidate', 'btnOpenSpreads', 'btnDownloadHtml', 'btnAcxOpen', 'btnBuildBoxSet', 'btnArcEpub', 'btnStoreReady', 'btnCloseExport']) $(id).addEventListener('click', () => heard.push(id));
    groups = groupExport(back);
    for (const id of ['btnValidate', 'btnOpenSpreads', 'btnDownloadHtml', 'btnAcxOpen', 'btnBuildBoxSet', 'btnArcEpub', 'btnStoreReady', 'btnCloseExport']) $(id).click();
    expect(heard).toEqual(['btnValidate', 'btnOpenSpreads', 'btnDownloadHtml', 'btnAcxOpen', 'btnBuildBoxSet', 'btnArcEpub', 'btnStoreReady', 'btnCloseExport']);
  });

  it("a group with nothing to show hides its header, and shows it when 1.0 shows the section (the archive before a shelf is linked)", async () => {
    const back = place();
    groups = groupExport(back);
    expect($('archiveSec').style.display).toBe('none');
    expect(wrap('archive').hidden).toBe(true);
    for (const id of ['ebook', 'print', 'files', 'audio', 'boxset']) expect(wrap(id).hidden, id).toBe(false);
    $('archiveSec').style.display = ''; // 1.0's renderCloudChrome, signed in
    await tick();
    expect(wrap('archive').hidden).toBe(false);
    $('archiveSec').style.display = 'none'; // signed out again
    await tick();
    expect(wrap('archive').hidden).toBe(true);
    // a hidden group is not left open behind its hidden header
    $('archiveSec').style.display = '';
    await tick();
    head('archive').click();
    expect(openIds()).toEqual(['archive']);
    $('archiveSec').style.display = 'none';
    await tick();
    expect(openIds()).toEqual([]);
  });

  it("the share section 1.0's cloud module injects after the archive lands in the archive group, before or after the grouping", async () => {
    // after the grouping: 1.0's betaInjectDom, its own lines (arc.parentNode.insertBefore(sec, arc.nextSibling))
    let back = place();
    groups = groupExport(back);
    const inject = () => {
      const arc = $('archiveSec');
      const sec = document.createElement('div');
      sec.className = 'fmt-sec';
      sec.id = 'betaSec';
      sec.innerHTML = '<h3>Share with beta readers</h3>';
      arc.parentNode!.insertBefore(sec, arc.nextSibling);
    };
    inject();
    await tick();
    expect(groupOf($('betaSec'))).toBe('archive');
    expect($('betaSec').previousElementSibling).toBe($('archiveSec'));
    // the archive itself is still hidden (signed out); the share section shows, so the group does
    expect(wrap('archive').hidden).toBe(false);
    expect(groups.unclassified()).toEqual([]);
    groups.destroy();
    // before the grouping (a module that was quicker): claimed by its id
    back = place();
    inject();
    groups = groupExport(back);
    expect(groupOf($('betaSec'))).toBe('archive');
    expect(groups.unclassified()).toEqual([]);
  });

  it("COMPLETENESS GUARD: every section of 1.0's export modal is claimed by a group (a new section must be classified in src/export/groups.ts)", () => {
    const back = place();
    groups = groupExport(back);
    // a section named here is one no group claims: it is shown ungrouped after the groups until EXPORT_GROUPS or
    // EXPORT_FIXED (src/export/groups.ts) names it. Classify it there; do not change this expectation.
    expect(groups.unclassified()).toEqual([]);
  });

  it('a section no group claims stays in view, ungrouped, after the groups, and is named', async () => {
    const back = place('<div class="fmt-sec" id="futureSec"><h3 data-i18n="exp.futureH">A Future Format</h3><button id="btnFuture" type="button">Go</button></div>');
    const heard: string[] = [];
    $('btnFuture').addEventListener('click', () => heard.push('future'));
    groups = groupExport(back);
    const fut = $('futureSec');
    expect(groups.unclassified()).toEqual(['div#futureSec.fmt-sec "A Future Format"']);
    expect(groupOf(fut)).toBeNull();
    expect(fut.hidden).toBe(false);
    expect(fut.style.display).toBe('');
    expect(fut.closest('[hidden]')).toBeNull();
    const box = back.querySelector('.modal')!;
    expect(Array.from(box.children).map((c) => c.id || c.className)).toEqual(['expH', 'm-sub', 'exp-proof', 'st-entry', 'exg-list', 'futureSec', 'modal-actions']);
    $('btnFuture').click();
    expect(heard).toEqual(['future']);
    // one that arrives later (a module's injection straight into the modal) is not hidden either, and is named
    const late = document.createElement('div');
    late.className = 'fmt-sec';
    late.id = 'lateSec';
    box.insertBefore(late, box.firstChild);
    await tick();
    expect(late.closest('[hidden]')).toBeNull();
    expect(groupOf(late)).toBeNull();
    expect(groups.unclassified()).toEqual(['div#futureSec.fmt-sec "A Future Format"', 'div#lateSec.fmt-sec']);
    expect(Array.from(box.children).map((c) => c.id || c.className)).toEqual(['expH', 'm-sub', 'exp-proof', 'st-entry', 'exg-list', 'futureSec', 'lateSec', 'modal-actions']);
  });
});

describe('what shows, moves to or focuses a part of the screen opens its group', () => {
  it('reveal() opens the group that holds an element; an element outside the groups opens none', () => {
    const back = place();
    groups = groupExport(back);
    expect(groups.reveal($('selFolio'))).toBe(true);
    expect(openIds()).toEqual(['print']);
    expect(groups.reveal($('btnStoreReady'))).toBe(false);
    expect(openIds()).toEqual(['print']);
    expect(groups.reveal($('lockDocxPw'))).toBe(true);
    expect(openIds()).toEqual(['files']);
  });

  it("1.0's scroll to the trim sizes (preflightJumpTo: the store check's and the preflight's \"fix\" links) opens Print first", () => {
    const back = place();
    const scrolled: unknown[] = [];
    // jsdom has no scrollIntoView; a browser's is called after the group is open
    (Element.prototype as unknown as { scrollIntoView: (o?: unknown) => void }).scrollIntoView = function (this: Element, o?: unknown) {
      scrolled.push([this.id, this.closest('[hidden]') === null, o]);
    };
    try {
      groups = groupExport(back);
      head('ebook').click();
      $('trimGrid').scrollIntoView({ behavior: 'smooth', block: 'center' });
      expect(openIds()).toEqual(['print']);
      // (the first: a header pressed keeps itself in view; the second: 1.0's scroll, made once Print is open)
      expect(scrolled).toEqual([['exgHead-ebook', true, { block: 'nearest' }], ['trimGrid', true, { behavior: 'smooth', block: 'center' }]]);
    } finally {
      delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('a result written into a closed group opens it: the validator, the audit, the preflight, the print-ready note, the archive note, EPUBCheck', async () => {
    const back = place();
    groups = groupExport(back);
    back.classList.add('open');
    await tick();
    $('archiveSec').style.display = '';
    await tick();
    const shows: [string, string, (el: HTMLElement) => void][] = [
      ['validateResults', 'ebook', (el) => { el.innerHTML = '<div class="val-summary">2 errors</div>'; el.style.display = ''; }],
      ['preflightResults', 'print', (el) => { el.innerHTML = '<div class="a11y-clean">Clean</div>'; el.style.display = ''; }],
      ['a11yResults', 'ebook', (el) => { el.innerHTML = '<div class="a11y-clean">Clean</div>'; el.style.display = ''; }],
      ['printReadyNote', 'print', (el) => { el.textContent = 'Your print-ready PDF is being made.'; el.hidden = false; }],
      ['archiveNote', 'archive', (el) => { el.style.display = ''; el.textContent = 'Saving to your archive…'; }],
      ['epubCheckResult', 'archive', (el) => { el.style.display = ''; el.innerHTML = '<p class="cr-wait">EPUBCheck is reading your book</p>'; }],
    ];
    let last = '';
    for (const [id, group, write] of shows) {
      // another group is open (or none): the result's own group takes its place
      if (last === group) head(group).click();
      write($(id));
      await tick();
      expect(openIds(), id).toEqual([group]);
      last = group;
    }
    // the same words written again (a list drawn again, a poll with nothing new) do not take the screen back
    head('files').click();
    $('archiveNote').textContent = 'Saving to your archive…';
    $('printReadyNote').textContent = 'Your print-ready PDF is being made.';
    await tick();
    expect(openIds()).toEqual(['files']);
    // new words do
    $('printReadyNote').textContent = 'Your print-ready PDF is ready.';
    await tick();
    expect(openIds()).toEqual(['print']);
    // an answer the writer asked for again opens its group with the same words too (the store check's "Validate",
    // pressed with another group open: 1.0's runValidation writes the same summary)
    $('validateResults').innerHTML = '<div class="val-summary">2 errors</div>';
    $('validateResults').style.display = '';
    await tick();
    expect(openIds()).toEqual(['ebook']);
    // a result cleared or hidden opens nothing (1.0's renderPlatformPresets empties the validator's and the audit's)
    head('files').click();
    $('validateResults').style.display = 'none';
    $('validateResults').innerHTML = '';
    await tick();
    expect(openIds()).toEqual(['files']);
  });

  it('what 1.0 draws as the screen opens does not open a group: all are closed on opening', async () => {
    const back = place();
    groups = groupExport(back);
    // 1.0's #btnExport listener: renderArchiveList shows the "not on your shelf" note, then the modal opens
    $('archiveSec').style.display = '';
    $('archiveNote').style.display = '';
    $('archiveNote').textContent = 'This book isn’t on your shelf yet';
    back.classList.add('open');
    await tick();
    expect(openIds()).toEqual([]);
    // and the list drawn again a moment later (cloudLoadArchive's answer), with the same words
    $('archiveNote').style.display = '';
    $('archiveNote').textContent = 'This book isn’t on your shelf yet';
    await tick();
    expect(openIds()).toEqual([]);
  });

  it("the share link's field, focused by 1.0 when the clipboard refuses (betaCopy), opens the archive group", async () => {
    const back = place();
    groups = groupExport(back);
    const arc = $('archiveSec');
    const sec = document.createElement('div');
    sec.className = 'fmt-sec';
    sec.id = 'betaSec';
    arc.parentNode!.insertBefore(sec, arc.nextSibling);
    sec.innerHTML = '<input class="txt-input" readonly id="betaNewUrl" value="https://beuk.example/s/abc">';
    await tick();
    head('ebook').click();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    $('betaNewUrl').focus();
    expect(openIds()).toEqual(['archive']);
    expect(focus).toHaveBeenCalledTimes(1);
    // 1.0 draws the section again (a new field): the new one opens the group too
    sec.innerHTML = '<input class="txt-input" readonly id="betaNewUrl" value="https://beuk.example/s/def">';
    await tick();
    head('ebook').click();
    $('betaNewUrl').focus();
    expect(openIds()).toEqual(['archive']);
    focus.mockRestore();
  });

  it('destroy() stops watching', async () => {
    const back = place();
    groups = groupExport(back);
    groups.destroy();
    $('validateResults').innerHTML = 'x';
    $('validateResults').style.display = '';
    await tick();
    expect(openIds()).toEqual([]);
    groups = null;
  });
});

/* COMPLETENESS GUARD for the paths above. 1.0's code reaches into the export modal from outside a click on the element
   itself in two ways the groups must hear of: it scrolls to an element (scrollIntoView) and it focuses one (.focus()).
   Every such call in 1.0's lifted code (the closures the studio ships) is listed here by the top-level declaration it
   stands in, with what it reaches. A call this list does not have fails the test. When that happens: read the call. If
   it scrolls to or focuses an element INSIDE #modalExport, name the element in SCROLLS or FOCUSES (src/export/groups.ts)
   so its group opens first, and add a test above; then add the declaration here. Do not just add the name. */
describe("COMPLETENESS GUARD: 1.0's scrolls and focuses are all known", () => {
  const GEN = path.join(import.meta.dirname, '..', 'src', 'generated');
  const FILES = ['closure.js', 'closure-print.js', 'closure-cloud.js', 'closure-preview.js', 'closure-sample.js', 'closure-serialize.js'];
  /** Each place `what` is written in 1.0's lifted code, as "<file>: <the top-level declaration it stands in>" (once each). */
  function sites(what: string): string[] {
    const out = new Set<string>();
    for (const f of FILES) {
      const src = readFileSync(path.join(GEN, f), 'utf8');
      const tops = [...src.matchAll(/^(?:async function|function|const|let|var|class) ([A-Za-z_$][\w$]*)/gm)].map((m) => ({ at: m.index!, name: m[1]! }));
      let i = -1;
      while ((i = src.indexOf(what, i + 1)) !== -1) {
        let name = '?';
        for (const t of tops) {
          if (t.at <= i) name = t.name;
          else break;
        }
        out.add(f + ': ' + name);
      }
    }
    return [...out];
  }

  it('scrollIntoView: the import card (not the export modal), and the trim sizes (SCROLLS)', () => {
    expect(sites('scrollIntoView')).toEqual([
      'closure.js: irGoTo', // the import card's own rows (#irBody): not in the export modal
      'closure.js: preflightJumpTo', // #trimGrid, from the store check's print link: SCROLLS
      'closure-print.js: preflightJumpTo', // #trimGrid, from the preflight's "fix" link: SCROLLS
    ]);
    expect(SCROLLS).toEqual(['trimGrid']);
  });

  it('.focus(): one reaches into the export modal, the new share link (FOCUSES); every other is another dialog, the editor, or a frame', () => {
    expect(sites('.focus(').sort()).toEqual([
      // the story bible's card, menu and fields; the editor's text area (#editorArea) after a toolbar action
      'closure.js: bibleCardEl', 'closure.js: bibleRefreshMore', 'closure.js: bibleMarkMenuEl', 'closure.js: bibleMarkPopEl', 'closure.js: bibleMarkClose', 'closure.js: bibleMarkOpen',
      'closure.js: bibleMarkSave', 'closure.js: bibleNewEntry', 'closure.js: bibleOnField',
      'closure.js: insertAtCursor', 'closure.js: wrapSelection', 'closure.js: redactSelection', 'closure.js: applyList', 'closure.js: applyContainer', 'closure.js: applyBlockquote', 'closure.js: applyAttribution',
      'closure.js: initImportReport', // the import card's own button
      'closure.js: initCoverMaker', // the cover maker's stage
      'closure.js: a11yJumpTo', // #editorArea, after it CLOSES the export modal
      'closure.js: lockPdfOpen', 'closure-print.js: lockPdfOpen', // #lockPdfPw, in its own dialog (#modalLockPdf)
      'closure.js: passwordAsk', // the password dialog's own field
      'closure.js: zenGoTo', 'closure.js: setZenMode', 'closure.js: dictBegin', // the editor
      'closure-print.js: initPrint', // the print frame's own window, before it prints
      'closure-cloud.js: openAuth', 'closure-cloud.js: twoStepFocus', 'closure-cloud.js: authorshipRecordOpen', // the sign-in and authorship dialogs
      'closure-cloud.js: betaCopy', // #betaNewUrl, inside the share section in the archive group: FOCUSES
    ].sort());
    expect(FOCUSES).toEqual(['betaNewUrl']);
  });
});
