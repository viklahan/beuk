import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:importcard — the import report opens on a card that answers the
   writer's first question, "is my whole book here?": the verdict panel
   (the file's characters = the book's + what was set aside, each row
   named), then the book Beuk found, then the looks a Beuk book does not
   carry. "The full account" is a step behind it. Both are drawn in the
   studio from the book on the desk (studio/test/import-card-redesign.test.ts
   runs them on real imports; one studio self-check runs them in the page);
   server side: the registration and static guards over client/index.html. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const ID = 'import.card.opens-on-the-book';

/* the keys of the card and the account (IRC_STRINGS), and the placeholders each must keep in every language */
const HOLDS: Record<string, string[]> = {
  'ir.card.titleChars': ['{n}'], 'ir.card.titleCharsPlural': ['{n}'], 'ir.card.titleCounts': ['{n}'], 'ir.card.titleCountsPlural': ['{n}'], 'ir.card.titlePics': ['{n}'], 'ir.card.titlePicsPlural': ['{n}'],
  'ir.card.titleNotes': ['{n}'], 'ir.card.titleNotesPlural': ['{n}'], 'ir.card.titleThings': ['{n}'], 'ir.card.noTally': [], 'ir.card.figFile': [], 'ir.card.figBook': [], 'ir.card.figAside': [], 'ir.card.joined': [],
  'ir.card.more': ['{n}'], 'ir.card.morePlural': ['{n}'], 'ir.card.seeThem': [], 'ir.card.countDiffers': ['{what}', '{file}', '{book}', '{why}'], 'ir.card.pics': ['{n}'], 'ir.card.picsPlural': ['{n}'],
  'ir.card.notes': ['{n}'], 'ir.card.notesPlural': ['{n}'], 'ir.card.onlyFile': [], 'ir.card.onlyBook': [], 'ir.card.times': [], 'ir.card.foundHead': ['{list}'], 'ir.card.nChapters': ['{n}'], 'ir.card.nChaptersPlural': ['{n}'],
  'ir.card.nSections': ['{n}'], 'ir.card.nSectionsPlural': ['{n}'], 'ir.card.nPages': ['{n}'], 'ir.card.nPagesPlural': ['{n}'], 'ir.card.pressHint': [], 'ir.card.pageAs': ['{type}'], 'ir.card.showAllChapters': ['{n}'],
  'ir.card.looksHead': ['{n}'], 'ir.card.looksHeadPlural': ['{n}'], 'ir.card.looksLede': ['{list}'], 'ir.card.seeEach': [], 'ir.card.openAsIs': [],
  'ir.acc.title': [], 'ir.acc.see': [], 'ir.acc.undo': [], 'ir.acc.file': ['{file}', '{when}'], 'ir.acc.intro': [], 'ir.acc.asGiven': ['{button}'], 'ir.acc.introParts': [],
  'ir.acc.h.count': [], 'ir.acc.h.look': [], 'ir.acc.h.aside': [], 'ir.acc.h.looks': [], 'ir.acc.h.filed': [], 'ir.acc.h.notes': [], 'ir.acc.h.book': [], 'ir.acc.c.looks': [], 'ir.acc.c.filed': [], 'ir.acc.c.book': [],
  'ir.acc.differ': [], 'ir.acc.why': [], 'ir.acc.asideN': ['{n}'], 'ir.acc.asideNPlural': ['{n}'], 'ir.acc.noneUn': [], 'ir.acc.same': ['{n}'], 'ir.acc.samePlural': ['{n}'], 'ir.acc.words': ['{n}'], 'ir.acc.wordsPlural': ['{n}'],
  'ir.acc.nChars': ['{n}'], 'ir.acc.nCharsPlural': ['{n}'], 'ir.acc.picsWhy': [], 'ir.acc.notesWhy': [], 'ir.acc.showLines': [], 'ir.acc.hideLines': [], 'ir.acc.looksLede': [],
  'ir.acc.filedChapters': ['{n}'], 'ir.acc.filedChaptersPlural': ['{n}'], 'ir.acc.filedPages': ['{n}'], 'ir.acc.filedPagesPlural': ['{n}'], 'ir.acc.filedAs': ['{type}', '{zone}'],
  'ir.acc.zone.front': [], 'ir.acc.zone.body': [], 'ir.acc.zone.back': [], 'ir.acc.via.heading': [], 'ir.acc.via.chapterHead': ['{chapter}'], 'ir.acc.via.shape': [], 'ir.acc.change': [],
};
const LOOKS = ['mono', 'smallcaps', 'strike', 'underline', 'subsup', 'headers', 'fmtHeading', 'textbox', 'lists', 'nestedList'];
for (const k of LOOKS) { HOLDS['ir.look.' + k] = []; HOLDS['ir.look.' + k + '.is'] = []; }
/* the old card's own words, still used by the new screens */
const KEPT = ['ir.card.title', 'ir.card.zoneFront', 'ir.card.zoneBody', 'ir.card.zoneBack', 'ir.card.sectionsIn', 'ir.card.sectionsInPlural', 'ir.card.showAll', 'ir.card.showFewer', 'ir.card.didSubs', 'ir.card.didSubsPlural',
  'ir.card.didHyphens', 'ir.card.didHyphensPlural', 'ir.card.seeWords', 'ir.card.open', 'ir.card.back', 'ir.card.ledeEmpty', 'ir.card.ledeEmptyPlural'];

/** the report's stylesheet: from its opening rule to the end of its block */
const cssOf = (html: string) => html.slice(html.indexOf('.ir-modal.modal.wide { max-width: 944px;'), html.indexOf('/* ==== /BEUK:importreport ==== */'));

test('import card: the self-check exists in the client and is registered client-only with a reason', async () => {
  const html = await clientHtml();
  assert.ok(html.includes(`{ id: "${ID}"`), 'present in the client self-checks');
  const c = SELF_CHECK_CASES.find((x) => x.id === ID);
  assert.ok(c, 'registered');
  assert.equal(c!.kind, 'client-only');
  assert.ok(c!.reason && c!.reason.length > 10);
});

test('import card: the report opens on the card, the verdict first, and the full account stays whole behind it', async () => {
  const html = await clientHtml();
  const open = html.slice(html.indexOf('function irOpenReport('), html.indexOf('function irCloseReport('));
  assert.match(open, /irView = "card"; irCardAll = false;/, 'every opening starts on the card');
  const render = html.slice(html.indexOf('function irRenderReport('), html.indexOf('function irGoTo('));
  /* both are drawn each time: the account is never thrown away, only stepped behind the card */
  assert.ok(render.includes(`body.innerHTML = '<div class="ir-card">' + irCardHtml(rep, v) + '</div><div class="ir-list">' + irAccountHtml(rep, v, openNow) + "</div>";`), 'the card and the account, each time');
  assert.match(html, /\.ir-card-view \.ir-list, \.ir-modal:not\(\.ir-card-view\) \.ir-card \{ display: none; \}/);
  const card = /\/\* ==== BEUK:importcard ==== \*\/([\s\S]*?)\/\* ==== \/BEUK:importcard ==== \*\//.exec(html);
  assert.ok(card, 'the BEUK:importcard block is in the studio');
  /* read from the book as it stands; the verdict panel is the first thing the card draws */
  assert.match(card[1], /state\.sections\.filter\(/);
  assert.ok(card[1].includes('let html = irVerdictHtml(rep, v);'), 'the verdict panel leads the card');
  /* what differs: characters (the old chain, one of the three), a count no reason names, pictures the file does not hold, notes nothing marks */
  assert.ok(card[1].includes('const rows = ((ty && ty.rows) || []).filter((r) => irRowUnexplained(r) > 0);'), 'a count that differs with no named reason');
  assert.ok(card[1].includes('const pics = items.filter((it) => it.kind === "mdImage")'), 'pictures the file names and does not hold');
  assert.ok(card[1].includes('const notes = items.filter((it) => it.kind === "noteOrphan").length;'), 'notes nothing marks');
  /* BEUK:hyphensgiven — the words a PDF leaves for the writer are a calm line, never a difference; a hyphen the writer joined is taken off the book's figure and named */
  assert.ok(card[1].includes('const hyLeft = items.filter((it) => it.kind === "pdfHyphenAsk" && it.state === "applied").length;'), 'the card counts the words left for the writer');
  assert.ok(card[1].includes('if (v.hyLeft) h += calm(t("ir.card.didHyphens", { n: v.hyLeft }),'), 'and says so only when there are some');
  assert.ok(!/diffs\.push\(\{ what: "hyph/.test(card[1]), 'they are not a difference');
  assert.ok(card[1].includes('fig("book", ty.book - v.joined, "ir.card.figBook", "=") + fig("aside", v.aside + v.joined, "ir.card.figAside", "+")'), 'a joined hyphen: one less in the book, one more named aside');
  /* an item of a kind or a group the account does not know is still given a part */
  assert.match(card[1], /default: return "aside";/);
  /* every value drawn into the card is escaped */
  assert.doesNotMatch(card[1].replace(/esc\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g, ''), /\+ (?:s\.title|rep\.file|pageName\(s\)|name) \+/);
  /* the old checklist is gone */
  for (const gone of ['ir.card.did"', 'ir.card.didNone', 'ir.card.didLost', 'ir.card.kicker', 'ir-didline', 'ir-stat']) assert.ok(!card[1].includes(gone), gone + ' is no longer drawn');
});

test('import card: the old controls are folded into the new ones, and 2.0 lifts the styles with the report\'s own', async () => {
  const html = await clientHtml();
  const at = html.indexOf('<div class="modal-back" id="modalImportReport"');
  const modal = html.slice(at, html.indexOf('<!-- ==== /BEUK:importreport ==== -->', at));
  for (const id of ['irH', 'irFile', 'irSub', 'irBody', 'btnIrEvery', 'btnIrBack', 'btnIrKeep', 'btnIrUndoAll', 'btnIrDismiss', 'btnIrClose']) assert.ok(modal.includes(`id="${id}"`), id);
  assert.ok(!modal.includes('btnIrOpenBook'), '"Open my book" is the old Close on the card and the old Keep all on the account');
  /* the order on the page: Undo this import at the start, then the quiet Dismiss, then the full account or the way back, then Open my book */
  const order = ['btnIrUndoAll', 'btnIrDismiss', 'btnIrEvery', 'btnIrBackFoot', 'btnIrClose', 'btnIrKeep'].map((id) => modal.indexOf(`id="${id}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'the actions in their order');
  const init = html.slice(html.indexOf('function initImportReport('), html.indexOf('window.beukImportReport = {'));
  assert.ok(init.includes('$("btnIrClose").addEventListener("click", irCloseReport);'), 'Close still closes');
  assert.ok(init.includes('if (state.importReport) { state.importReport.kept = true; noteBookEdited(); }'), 'Keep all still records that the report was kept');
  assert.ok(init.includes('.then((ok) => { if (ok) irDismiss(); });'), 'Dismiss still asks, then dismisses');
  assert.ok(init.includes('.then((ok) => { if (ok) irUndoAll(); });'), 'Undo still asks, then undoes the whole import');
  /* which control each screen shows */
  assert.ok(html.includes('.ir-card-view #btnIrDismiss, .ir-card-view #btnIrKeep, .ir-card-view .ir-back, .ir-card-view .ir-intro, .ir-modal:not(.ir-card-view) #btnIrClose, .ir-modal:not(.ir-card-view) #btnIrEvery { display: none; }'));
  /* the studio's extract takes rules whose selector holds .ir- (studio/scripts/extract-studio.mjs IMPORT_SELECTOR) */
  const css = cssOf(html);
  const selectors = [...css.matchAll(/^\s{6,8}([^{}\n/@]+)\{/gm)].map((m) => m[1].trim());
  assert.ok(selectors.length >= 150, `the report's rules found: ${selectors.length}`);
  /* one rule is the backdrop's, on a phone, where the report fills the screen: it names the report's own box */
  for (const sel of selectors) assert.match(sel, /^\.ir-|^\.modal-back:has\(> \.ir-modal\)$/, sel);
});

test('import card: the look — the studio\'s own variables, logical properties, gold and never red for a difference, no capitals', async () => {
  const css = cssOf(await clientHtml());
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b(?![^{]*\{)/, 'no colour of its own: the studio\'s variables only, so both themes hold');
  assert.doesNotMatch(css, /\b(?:margin|padding|border)-(?:left|right)\b|text-align: (?:left|right)|\b(?:left|right): /, 'logical properties throughout (the interface has a right-to-left language)');
  /* red is left for a failed undo and a scan that could not be made: never for a difference, a look or a set-aside */
  const red = [...css.matchAll(/^\s*([^{}\n]+)\{[^}]*var\(--bad\)[^}]*\}/gm)].map((m) => m[1].trim());
  assert.deepEqual(red, ['.ir-warn-line', '.ir-fail']);
  assert.match(css, /\.ir-verdict\.differs, \.ir-verdict\.unknown \{ border: 2px solid var\(--gold\);/, 'the differs panel is gold');
  assert.match(css, /\.ir-mark\.info \{ color: var\(--gold-ink\); \}/);
  const upper = [...css.matchAll(/^\s*([^{}\n]+)\{[^}]*text-transform: uppercase[^}]*\}/gm)].map((m) => m[1].trim());
  for (const sel of upper) assert.match(sel, /::first-letter$/, 'no all-capitals label: ' + sel);
  assert.match(css, /\.ir-modal button:focus-visible, \.ir-modal a:focus-visible, \.ir-modal summary:focus-visible \{ outline: 2px solid var\(--focus\);/, 'visible focus');
  assert.match(css, /\.ir-page \{[^}]*border-radius: 8px;/, 'pages are not pill chips');
});

test('import card: at 560px and under the arithmetic stacks, chapter rows drop the section count, the actions stack with the primary first, and controls are 44px tall', async () => {
  const css = cssOf(await clientHtml());
  const at = css.indexOf('@media (max-width: 560px) {');
  assert.ok(at > 0, 'the phone rules are in the report\'s stylesheet');
  const phone = css.slice(at);
  for (const rule of [
    '.ir-figs { grid-template-columns: minmax(0, 1fr);', '.ir-figrow { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto;', '.ir-fig { display: contents; }', '.ir-sign.none { display: block; }',
    '.ir-rs { display: none; }', '.ir-row { grid-template-columns: 26px minmax(0, 1fr) auto;',
    '.ir-modal .ir-actions { flex-direction: column-reverse; align-items: stretch;',
    '.ir-btn { min-height: 44px; }', '.ir-page { min-height: 44px; }', '.ir-more { min-height: 44px;', '.ir-chip { min-height: 44px; }', '.ir-actions .ir-btn { min-height: 48px;',
  ]) assert.ok(phone.includes(rule), rule);
  assert.match(phone, /\.ir-row \{[^}]*min-height: 44px;/);
  /* the primary action is last in the markup, so a reversed column puts it first */
  const html = await clientHtml();
  const modal = html.slice(html.indexOf('<div class="modal-actions ir-actions">'), html.indexOf('<!-- ==== /BEUK:importreport ==== -->'));
  assert.ok(modal.lastIndexOf('class="ir-btn primary"') > modal.lastIndexOf('id="btnIrEvery"'));
});

test('import card: the "Imported" toast is not raised over the open card', async () => {
  const html = await clientHtml();
  assert.ok(html.includes('if (IR_REC) IR_REC.imported = imported; else toast(imported, "file-check-2");'), 'an import that is writing a report holds the words');
  assert.ok(html.includes('if (ir.imported) { const card = $("modalImportReport"); if (!card || !card.classList.contains("open")) toast(ir.imported, "file-check-2"); }'), 'and says them only where no card opened');
  assert.ok(html.includes('function irAbort() { const held = IR_REC && IR_REC.imported; IR_REC = null; if (held) toast(held, "file-check-2");'), 'an import given up says them too');
});

test('import card: its words are in all 13 language packs, placeholders kept, and the new English uses no dash as punctuation', async () => {
  const html = await clientHtml();
  const valuesOf = (k: string) => [...html.matchAll(new RegExp(`"${k.replace(/\./g, '\\.')}": "((?:[^"\\\\]|\\\\.)*)"`, 'g'))].map((m) => m[1]);
  for (const k of [...Object.keys(HOLDS), ...KEPT]) {
    const vals = valuesOf(k);
    assert.equal(vals.length, 13, `${k} in 13 locales`);
    for (const v of vals) {
      assert.ok(v.trim().length > 0, `${k} is not empty`);
      for (const hold of HOLDS[k] || []) assert.ok(v.includes(hold), `${k} keeps ${hold}: ${v}`);
    }
    if (HOLDS[k]) {
      assert.doesNotMatch(vals[0], /[—–]| - /, `${k}: no dash used as punctuation in a new string: ${vals[0]}`);
      if (vals[0].includes('Beuk')) for (const v of vals) assert.ok(v.includes('Beuk'), `the product's name is never translated (${k}): ${v}`);
    }
  }
  /* every key of the new table is one this test knows: a key added there is added here, with its placeholders */
  const table = /const IRC_STRINGS = \{\n\s*"en": (\{.*\}),\n/.exec(html);
  assert.ok(table, 'the IRC_STRINGS table is in the studio');
  assert.deepEqual(Object.keys(JSON.parse(table[1]) as Record<string, string>).sort(), Object.keys(HOLDS).sort());
});
