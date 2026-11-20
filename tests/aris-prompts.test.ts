import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPersona } from '../src/aris/persona.js';
import { buildDraftPrompt, DRAFT_WINDOW_CHARS } from '../src/aris/prompts.js';
import type { ArisMessage } from '../src/aris/providers.js';

const userText = (msgs: ArisMessage[]) =>
  msgs
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('');
const allText = (msgs: ArisMessage[]) => msgs.map((m) => m.content).join('\n');

const base = { bookTitle: 'The Frost Line', covenants: [] as { kind: string; name: string; note: string }[] };

test('persona carries the Editorial lens', () => {
  const p = loadPersona();
  assert.match(p.editorial, /no finding without|cannot quote does not exist/i);
  assert.match(p.editorial, /first-meeting/i);
});

test('persona file parses into its four sections', () => {
  const p = loadPersona();
  for (const k of ['page', 'core', 'laconic', 'homeric'] as const) {
    assert.equal(typeof p[k], 'string', k);
    assert.ok(p[k].trim().length > 0, `${k} is empty`);
    assert.doesNotMatch(p[k], /^## /m, `${k} swallowed another section`);
  }
  assert.match(p.page, /opt-in|turn Aris on/i, 'Page explains the opt-in');
  assert.match(p.page, /\bkey\b/i, 'Page explains the key');
  assert.match(p.page, /ἄριστος/, 'Page carries the name');
  assert.match(p.core, /propose/i, 'Core states propose-only');
  assert.match(p.core, /never/i);
  assert.notEqual(p.laconic.trim(), p.homeric.trim());
});

test('loadPersona caches the file read', () => {
  assert.equal(loadPersona(), loadPersona());
});

test('draft prompts window a giant section to 24k chars around the cursor', () => {
  assert.equal(DRAFT_WINDOW_CHARS, 24_000);
  const marker = 'THE-CURSOR-SITS-HERE';
  const head = 'a'.repeat(150_000);
  const tail = 'b'.repeat(150_000 - marker.length);
  const sectionText = head + marker + tail;
  assert.equal(sectionText.length, 300_000);
  const msgs = buildDraftPrompt({ ...base, action: 'continue', sectionText, cursorOffset: head.length + marker.length });
  const u = userText(msgs);
  assert.ok(u.length <= 24_000, `user content is ${u.length} chars`);
  assert.ok(u.includes(marker), 'text at the cursor survives the window');
  assert.ok(u.length > 20_000, 'the window is spent on the section, not wasted');
  assert.doesNotMatch(u, /truncat|omitted|excerpt|trimmed|\bcut\b|shortened|\.\.\.|…/i, 'the cut is never mentioned');
});

test('window math at the boundaries: cursor at either end, small sections untouched', () => {
  const big = 'x'.repeat(100_000);
  const atStart = userText(buildDraftPrompt({ ...base, action: 'continue', sectionText: 'START' + big, cursorOffset: 0 }));
  assert.ok(atStart.length <= 24_000 && atStart.includes('START'), 'cursor at 0 keeps the head');
  const atEnd = userText(buildDraftPrompt({ ...base, action: 'continue', sectionText: big + 'END' }));
  assert.ok(atEnd.length <= 24_000 && atEnd.includes('END'), 'default cursor is the end of the section');
  assert.ok(atEnd.length > 20_000, 'a one-sided cursor gives the whole budget to the side that has text');
  const small = 'She closed the door. The frost had reached the hinges.';
  const s = userText(buildDraftPrompt({ ...base, action: 'continue', sectionText: small, cursorOffset: 20 }));
  assert.ok(s.includes('She closed the door.') && s.includes(' The frost had reached the hinges.'));
  assert.throws(() => buildDraftPrompt({ ...base, action: 'continue', sectionText: small, cursorOffset: 999 }), /cursorOffset/);
});

test('selection actions carry the selection and covenants', () => {
  const sel = 'He ran, he ran fast, faster than he had ever run.';
  const sectionText = 'Before. ' + 'y'.repeat(80_000) + sel + 'z'.repeat(80_000) + ' After.';
  const covenants = [
    { kind: 'character', name: 'Mara Voss', note: 'Left-handed.\n  Never  swears.' },
    { kind: 'place', name: 'Kell Ridge', note: 'Snow from October.' },
  ];
  for (const action of ['rewrite', 'expand', 'condense'] as const) {
    const msgs = buildDraftPrompt({ ...base, covenants, action, sectionText, selection: { text: sel } });
    const u = userText(msgs);
    assert.ok(u.includes(sel), `${action} carries the selection`);
    assert.ok(u.length <= 24_000, `${action}: ${u.length}`);
    assert.ok(u.includes('Mara Voss') && u.includes('Left-handed. Never swears.'), 'covenant note serialized, whitespace collapsed');
    assert.ok(u.includes('Kell Ridge'));
    assert.ok(u.includes('The Frost Line'), 'book title travels');
    assert.ok(u.split(sel).length === 2, 'the selection appears once, not duplicated by the window');
  }
  assert.throws(() => buildDraftPrompt({ ...base, action: 'rewrite', sectionText }), /selection/);
});

test('beat carries the instruction and refuses without one', () => {
  const u = userText(
    buildDraftPrompt({ ...base, action: 'beat', instruction: 'Mara finds the second key under the ice.', sectionText: 'The lake was quiet.' }),
  );
  assert.ok(u.includes('Mara finds the second key under the ice.'));
  assert.throws(() => buildDraftPrompt({ ...base, action: 'beat', sectionText: 'x' }), /instruction/);
});

test('drafting prompts never include voice modifiers', () => {
  const p = loadPersona();
  const actions = ['beat', 'continue', 'fill', 'summarize', 'rewrite', 'expand', 'condense'] as const;
  for (const action of actions) {
    const msgs = buildDraftPrompt({
      ...base,
      action,
      instruction: 'the storm breaks',
      sectionText: 'One. Two. Three.',
      cursorOffset: 5,
      selection: { text: 'Two.' },
    });
    const sys = msgs.filter((m) => m.role === 'system');
    assert.equal(sys.length, 1, `${action}: one system message`);
    assert.ok(sys[0].content.startsWith(p.core.trim()), `${action}: system is the Core`);
    const all = allText(msgs);
    assert.ok(!all.includes(p.homeric.trim()), `${action}: Homeric absent`);
    assert.ok(!all.includes(p.laconic.trim()), `${action}: Laconic absent`);
    assert.ok(!all.includes(p.page.trim().slice(0, 200)), `${action}: the public page is not prompt material`);
  }
});

test('persona parser refuses a missing, unknown, duplicate or empty section', async () => {
  const { parsePersona } = await import('../src/aris/persona.js');
  const ok = '## Page\np\n## Core\nc\n## Laconic\nl\n## Homeric\nh\n## Editorial\ne\n';
  assert.deepEqual(parsePersona('# Aris\npreamble\n' + ok), { page: 'p', core: 'c', laconic: 'l', homeric: 'h', editorial: 'e' });
  assert.throws(() => parsePersona(ok.replace('## Homeric\nh\n', '')), /missing section "## Homeric"/);
  assert.throws(() => parsePersona(ok + '## Extra\nx\n'), /unknown section/);
  assert.throws(() => parsePersona(ok + '## Core\nagain\n'), /duplicate section/);
  assert.throws(() => parsePersona(ok.replace('## Core\nc\n', '## Core\n\n')), /empty/);
  assert.equal(parsePersona(ok.replace('## Page\np', '## Page\np\n### sub\nmore')).page, 'p\n### sub\nmore', '### stays inside');
});

test('window boundaries: an exact fit is whole, one char over loses one char, oversize selections refuse', () => {
  const frame = userText(buildDraftPrompt({ ...base, action: 'continue', sectionText: '' })).length;
  const fit = 'q'.repeat(24_000 - frame);
  const whole = userText(buildDraftPrompt({ ...base, action: 'continue', sectionText: fit }));
  assert.equal(whole.length, 24_000);
  assert.ok(whole.includes(fit));
  const over = userText(buildDraftPrompt({ ...base, action: 'continue', sectionText: 'Z' + fit }));
  assert.equal(over.length, 24_000);
  assert.ok(!over.includes('Z'), 'the char farthest from the cursor goes');
  const huge = 'w'.repeat(30_000);
  assert.throws(
    () => buildDraftPrompt({ ...base, action: 'condense', sectionText: huge, selection: { text: huge } }),
    RangeError,
  );
});

test('covenant entries stay whole and stop at the covenant budget', () => {
  const covenants = Array.from({ length: 200 }, (_, i) => ({ kind: 'character', name: `Name${i}`, note: 'n'.repeat(80) }));
  const u = userText(buildDraftPrompt({ ...base, covenants, action: 'continue', sectionText: 'x' }));
  const block = /<covenant>\n([\s\S]*?)\n<\/covenant>/.exec(u)![1];
  assert.ok(block.length <= 6_000);
  assert.ok(block.split('\n').every((l) => /^- character · Name\d+: n{80}$/.test(l)), 'no entry is split');
  assert.ok(block.includes('Name0') && !u.includes('Name199'), 'kept in the order given');
});

test('a cursor inside a surrogate pair snaps back so the pair never splits', () => {
  const text = 'Snow 🌲 fell.';
  const inside = text.indexOf('🌲') + 1; // between the high and low surrogate
  const u = userText(buildDraftPrompt({ ...base, action: 'continue', sectionText: text, cursorOffset: inside }));
  const before = /<text_before>\n([\s\S]*?)\n<\/text_before>/.exec(u)![1];
  const after = /<text_after>\n([\s\S]*?)\n<\/text_after>/.exec(u)![1];
  assert.equal(before, 'Snow ');
  assert.equal(after, '🌲 fell.');
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(u), 'no lone surrogate anywhere');
});

test('the page states what is not here yet, the BYOK walkthrough and the upper bound of what travels', () => {
  const { page, core } = loadPersona();
  assert.doesNotMatch(page, /has read every page/i);
  assert.match(page, /reads what you show it/);
  assert.match(page, /coming soon/i);
  assert.match(page, /selected text and surrounding context/i);
  assert.match(page, /openrouter\.ai\/keys/);
  assert.match(page, /platform\.claude\.com/);
  assert.match(page, /revoke it at your provider/i);
  assert.match(page, /spending cap/i);
  assert.match(page, /never backed up/i);
  assert.match(page, /provider.s privacy terms/i);
  assert.doesNotMatch(core, /—/, 'core stays dash-free');
  assert.match(core, /In what you add, never contradict a covenant entry/);
  assert.doesNotMatch(core, /follow the covenant/);
});

test('selection actions are told to keep the stated facts of the selection', () => {
  for (const action of ['rewrite', 'expand', 'condense'] as const) {
    const u = userText(buildDraftPrompt({ ...base, action, sectionText: 'A b c.', selection: { text: 'b' } }));
    assert.match(u, /Keep every fact it states/, action);
  }
});
