import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { renderMailGonePage, launchDateText } from '../src/arc/pages.js';
import { stampEpub } from '../src/arc/stamp.js';
import { ARC_EN, ARC_LANGS, ARC_STRINGS, arcDir, arcLang, arcT, type ArcKey, type ArcLang } from '../src/arc/strings.js';
import type { Db } from '../src/db.js';
import { createZip, readZip } from '../src/housekeeping/packages.js';
import type { MailMessage, Mailer, MailerStatus, MailResult } from '../src/mailer.js';
import { escapeHtml } from '../src/email/layout.js';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';

/*
 * ARC slice 1, Task 9: the reader-facing strings in every interface
 * language. The 14 tables beside English are UNSIGNED drafts
 * (docs/strings-pending-signoff.md §9); these tests guard their shape and
 * the rules every draft must keep, not their wording.
 *
 * Superseded from the plan's Task 9 test list (controller rulings, said
 * here so nobody restores them by mistake):
 *   - F17 + M8: the branch carries main's 15 interface languages, so
 *     arcLang('hi') is 'hi' (the plan said 'en') and arcLang('mr') is 'mr'.
 *   - F16: the stamp line and the added page's title stay English in every
 *     language, so "a Spanish reader's stamp is in Spanish" became "… is in
 *     English", and no draft carries those two keys.
 *   - The used-mail-link page (arc.mail.goneTitle, arc.mail.gone) knows no
 *     reader language (src/arc/pages.ts renderMailGonePage), so it stays
 *     English and no draft carries it either.
 */

/** The keys no draft carries (see above). */
const ENGLISH_ONLY: readonly ArcKey[] = ['arc.stamp', 'arc.stampPage.title', 'arc.mail.goneTitle', 'arc.mail.gone'];
const DRAFT_LANGS = ARC_LANGS.filter((l) => l !== 'en');
const DRAFT_KEYS = (Object.keys(ARC_EN) as ArcKey[]).filter((k) => !ENGLISH_ONLY.includes(k));
const table = (lang: ArcLang) => ARC_STRINGS[lang] as Record<string, string | undefined>;
const placeholderList = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

/** A word, with Unicode-aware edges (JS \b only knows ASCII letters). */
const word = (alternatives: string) =>
  new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{M}\\p{N}])`, 'iu');

/*
 * Amazon's rule (plan Global Constraints): no line says "in exchange for a
 * review" or treats one as owed. One pattern per language, with word edges
 * where the script has words: the language's "in exchange / in return",
 * "owe" and "must / have to". Japanese, Chinese and Arabic (whose clitics
 * join words) are matched as substrings. Claude's patterns, not a
 * translator's: V signs the drafts, not these lists.
 */
const PRESSURE: Record<ArcLang, RegExp> = {
  en: /\b(exchange|in return|owed?|must review|required to review)\b/i,
  es: word('a cambio|en contrapartida|en compensación|deb\\p{L}*|tienes que|obligad[oa]s?'),
  fr: word('en échange|en contrepartie|en retour|dev(?:ez|rez|ra|oir)|obligée?s?|redevable'),
  de: word('im Austausch|als Gegenleistung|im Gegenzug|schulde\\p{L}*|schuldig|verpflichtet|müssen|muss'),
  it: word('in cambio|in scambio|contropartita|devi|dovrai|deve|in debito|tenut[oa] a'),
  pt: word('em troca|em contrapartida|em retorno|dev(?:e|es|em|erá)|tem de|tem que|obrigad[oa] a'),
  nl: word('in ruil|tegenprestatie|verschuldigd|moet(?:en)?|verplicht om'),
  pl: word('w zamian|w ramach rewanżu|musi\\p{L}*|należy\\p{L}* się|zobowiązan\\p{L}*|winien|winna'),
  ru: word('в обмен|взамен|в благодарность|должн\\p{L}*|обязан\\p{L}*'),
  tr: word('karşılığında|karşılık olarak|borç\\p{L}*|zorunda\\p{L}*|mecbur\\p{L}*'),
  ar: /مقابل|عوض|يجب|عليك أن|ملزم|مدين/u,
  hi: word('बदले|एवज़|बाध्य|चाहिए|करना होगा|ही होगा'),
  mr: word('बदल्यात|मोबदल्यात|लागेल|पाहिजे|बंधनकारक|करावेच'),
  ja: /引き換え|引換|見返り|交換|義務|お礼として|しなければ|必ず/u,
  'zh-Hans': /交换|换取|回报|必须|应当|义务|欠/u,
};

/** The spec's "if you'd like to review it": the review line is a choice
 *  in every language (the conditional each draft uses). */
const IF_YOU_LIKE: Record<ArcLang, string> = {
  en: "If you'd like",
  es: 'Si quieres',
  fr: 'Si vous souhaitez',
  de: 'Wenn Sie',
  it: 'Se dopo averlo letto vuoi',
  pt: 'Se quiser',
  nl: 'Als u',
  pl: 'Jeśli',
  ru: 'Если',
  tr: 'isterseniz',
  ar: 'إن رغبت',
  hi: 'अगर आप',
  mr: 'असेल, तर',
  ja: '思ったら',
  'zh-Hans': '如果你',
};

/** Drafts that are the English on purpose: the studio's own word
 *  (client/index.html legal.privacy is "Privacy" in it and nl). */
const SAME_AS_ENGLISH: Partial<Record<ArcLang, ArcKey[]>> = { it: ['arc.foot.privacy'], nl: ['arc.foot.privacy'] };

test('the reader languages are exactly the studio interface languages (F17)', () => {
  const src = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
  const m = /const UI_LANG_ORDER = (\[[^\]]*\]);/.exec(src);
  assert.ok(m, 'client/index.html declares UI_LANG_ORDER');
  assert.deepEqual([...ARC_LANGS], JSON.parse(m[1]!));
});

test('every language has exactly the English keys, less the English-only ones', () => {
  const want = [...DRAFT_KEYS].sort();
  for (const lang of DRAFT_LANGS) {
    assert.deepEqual(Object.keys(table(lang)).sort(), want, `${lang}: keys`);
  }
  for (const k of ENGLISH_ONLY) assert.ok(k in ARC_EN, `${k} is an English key`);
});

test('no draft is empty, or still the English unless said so', () => {
  for (const lang of DRAFT_LANGS) {
    for (const k of DRAFT_KEYS) {
      const v = table(lang)[k];
      assert.ok(typeof v === 'string' && v.trim() !== '', `${lang} ${k}: a draft`);
      if (!(SAME_AS_ENGLISH[lang] ?? []).includes(k)) assert.notEqual(v, ARC_EN[k], `${lang} ${k}: translated`);
    }
  }
});

test('docs/strings-pending-signoff.md lists every draft key, unsigned, with every draft as written', () => {
  const doc = readFileSync(new URL('../docs/strings-pending-signoff.md', import.meta.url), 'utf8');
  const at = doc.indexOf('## 9. ARC reader pages and reader emails');
  assert.ok(at >= 0, 'section 9 is there');
  const s9 = doc.slice(at);
  assert.ok(s9.toLowerCase().includes('not approved'));
  assert.doesNotMatch(doc.toLowerCase(), /\bapproved by\b|\bsigned off by v\b/);
  for (const k of DRAFT_KEYS) {
    assert.ok(s9.includes('### `' + k + '`'), `${k} is listed`);
    for (const lang of DRAFT_LANGS) assert.ok(s9.includes('`' + table(lang)[k] + '`'), `${lang} ${k}: the doc shows the draft as the code has it`);
  }
  for (const k of ENGLISH_ONLY) assert.ok(!s9.includes('### `' + k + '`'), `${k} is English-only, not a draft`);
});

test('no translation adds or drops a placeholder', () => {
  for (const lang of DRAFT_LANGS) {
    for (const k of DRAFT_KEYS) {
      assert.deepEqual(placeholderList(table(lang)[k] ?? ''), placeholderList(ARC_EN[k]), `${lang} ${k}`);
    }
  }
});

test('English has no plural keys, so no draft needs a plural twin', () => {
  // localization.test.ts's convention: a `…Plural` key is the n≠1 twin.
  assert.deepEqual(Object.keys(ARC_EN).filter((k) => /plural/i.test(k)), []);
});

test('the stamp line names the reader and the email, in English, in every language (F16)', () => {
  const vars = { name: 'Sarah', email: 'sarah@example.com' };
  for (const lang of ARC_LANGS) {
    assert.equal(arcT(lang)('arc.stamp', vars), 'Advance Review Copy prepared for Sarah (sarah@example.com)', lang);
    assert.equal(arcT(lang)('arc.stampPage.title'), 'Advance Review Copy', lang);
  }
});

test('book languages map to interface languages', () => {
  assert.equal(arcLang('es-MX'), 'es');
  assert.equal(arcLang('zh-Hant'), 'zh-Hans');
  assert.equal(arcLang('en-GB'), 'en');
  // F17 + M8: Hindi and Marathi are interface languages now (the plan's 'en' is superseded).
  assert.equal(arcLang('hi'), 'hi');
  assert.equal(arcLang('mr'), 'mr');
  assert.equal(arcLang('mr-IN'), 'mr');
  assert.equal(arcLang('sw'), 'en', 'a book language with no interface pack reads in English');
  assert.equal(arcLang(''), 'en');
  assert.equal(arcDir('ar'), 'rtl');
  for (const lang of ARC_LANGS) if (lang !== 'ar') assert.equal(arcDir(lang), 'ltr', lang);
});

test('English never trades a copy for a review', () => {
  for (const [k, v] of Object.entries(ARC_EN)) assert.doesNotMatch(v, PRESSURE.en, k);
});

test('no draft trades a copy for a review; the review line is a choice in every language', () => {
  for (const lang of ARC_LANGS) {
    for (const [k, v] of Object.entries(table(lang))) assert.doesNotMatch(v ?? '', PRESSURE[lang], `${lang} ${k}`);
    const t = arcT(lang);
    assert.ok(t('arc.mail.review').includes(IF_YOU_LIKE[lang]), `${lang}: arc.mail.review is conditional`);
    // As in English, the email and the page say the same review line.
    assert.equal(t('arc.claim.review'), t('arc.mail.review'), `${lang}: one review line`);
  }
});

test('each draft keeps its pack\'s form of address', () => {
  const all = (lang: ArcLang) => Object.values(table(lang)).join('\n');
  // Hindi: आप, never तुम/तू (docs/ui-hi-mr-glossary.md).
  assert.doesNotMatch(all('hi'), word('तुम|तू|तेरा|तुम्हारा|तुम्हें'));
  assert.match(all('hi'), word('आप|आपका|आपकी|आपको|आपने|आपके'));
  // Marathi: तुम्ही, no nukta, never आपण.
  assert.doesNotMatch(all('mr'), /़/u, 'no nukta in Marathi');
  assert.doesNotMatch(all('mr'), word('आपण|आपल्या|आपली|आपला'));
  assert.match(all('mr'), word('तुम्ही|तुम्हाला|तुमची|तुमचा|तुमचे|तुमच्या'));
  // The European packs' address (as their studio strings): de Sie, fr vous, nl u, ru вы, es tú.
  assert.doesNotMatch(all('de'), word('du|dich|dir|dein\\p{L}*'));
  assert.doesNotMatch(all('fr'), word('tu|toi|ton|tes'));
  assert.doesNotMatch(all('nl'), word('je|jij|jouw'));
  assert.doesNotMatch(all('ru'), word('ты|тебя|тебе|твой|твоя|твоё'));
  assert.doesNotMatch(all('es'), word('usted|ustedes'));
});

test('the author fallback reads in every sentence it fills', () => {
  // German: {author} always stands in the dative (after von/bei), so the
  // fallback "dem Autor" is grammatical wherever it lands.
  assert.equal(table('de')['arc.theAuthor'], 'dem Autor');
  for (const [k, v] of Object.entries(table('de'))) {
    const all = (v ?? '').split('{author}').length - 1;
    const dative = (v ?? '').match(/\b(?:von|bei|Von|Bei) \{author\}/g)?.length ?? 0;
    assert.equal(dative, all, `de ${k}: every {author} after von/bei`);
  }
  // Turkish: no placeholder takes a suffix (vowel harmony cannot be known).
  for (const [k, v] of Object.entries(table('tr'))) assert.doesNotMatch(v ?? '', /\{\w+\}['’\p{L}]/u, `tr ${k}`);
});

test('a used mail link\'s page stays English (it knows no reader language)', () => {
  const page = renderMailGonePage({ nonce: 'n' });
  assert.match(page, /<html lang="en" dir="ltr">/);
  assert.ok(page.includes(escapeHtml(ARC_EN['arc.mail.goneTitle'])));
});

test('the launch date is written in the reader\'s language, in Western digits for Marathi', () => {
  assert.equal(launchDateText('es', '2027-02-14'), '14 de febrero de 2027');
  assert.equal(launchDateText('mr', '2027-02-14'), '14 फेब्रुवारी, 2027');
  assert.equal(launchDateText('hi', '2027-02-14'), '14 फ़रवरी 2027');
});

/* ---------------- end to end: a book's language reaches its readers ---------------- */

const SALT = 'salt-9-0123456789abcdef-0123456x'; // 32 characters (ARC_SALT_MIN_LENGTH)
const ARC = { mailFrom: 'Beuk readers <readers@beuk.studio>', smtpUrl: 'smtp://u:p@127.0.0.1:9', suppressionSalt: SALT };
const HOUR = 3_600_000;
const LOOSE = {
  claimPerIp: { max: 100_000, windowMs: HOUR },
  checkPerIp: { max: 100_000, windowMs: HOUR },
  codesPerAddress: { max: 100_000, windowMs: HOUR },
  downloadsPerReader: { max: 100_000, windowMs: HOUR },
};

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  status(): MailerStatus {
    return { configured: true, transport: 'smtp', from: 'fake', detail: 'fake mailer (test)' };
  }
  async send(message: MailMessage): Promise<MailResult> {
    this.sent.push(message);
    return { delivered: true, messageId: '<arc-strings@example.com>' };
  }
  async verify() {
    return { ok: true, detail: 'fake mailer (test)' };
  }
}

let db: Db;
let server: TestServer;
const arcMail = new FakeMailer();
let seq = 0;

before(async () => {
  db = await createTestDb();
  server = await startTestServer(db, undefined, { arc: ARC }, undefined, { arcMailer: arcMail, mailer: new FakeMailer(), arcLimits: LOOSE });
});

after(async () => {
  await server.close();
});

/** A writer, a book in `language` and a running campaign; the signup token. */
async function signupFor(language: string, author = 'Ada Moss'): Promise<string> {
  const c = new Client(server.base);
  assert.equal((await registerUser(c, `arc-strings-${++seq}@example.com`)).status, 201);
  const doc = {
    meta: { title: 'The Salt Road', author, language, description: 'A tide story.' },
    sections: [
      { id: 'sec-copy', kind: 'front', type: 'copyright', title: 'Copyright', content: 'Copyright © Ada Moss.' },
      { id: 'sec-one', kind: 'body', type: 'chapter', number: 'One', title: 'First Light', content: 'It began with the tide.' },
    ],
  };
  const m = await c.post('/api/manuscripts', { doc });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  const r = await c.post('/api/arc', {
    manuscriptId: (m.body.manuscript as { id: string }).id,
    launchDate: '2027-02-14',
    closesAt: new Date(Date.now() + 30 * 24 * HOUR).toISOString(),
    tz: 'Europe/London',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.signupToken as string;
}

async function page(signup: string): Promise<string> {
  const r = await fetch(`${server.base}/arc/${signup}`);
  assert.equal(r.status, 200);
  return r.text();
}

test('a Spanish book gets a Spanish claim page; an Arabic one reads right to left', async () => {
  const es = await page(await signupFor('es'));
  assert.match(es, /<html lang="es" dir="ltr">/);
  assert.ok(es.includes(escapeHtml(ARC_STRINGS.es['arc.claim.submit']!)), 'the Spanish button');
  assert.ok(es.includes('14 de febrero de 2027'), 'the date in Spanish');
  assert.ok(!es.includes(ARC_EN['arc.claim.submit']), 'no English button');
  const ar = await page(await signupFor('ar'));
  assert.match(ar, /<html lang="ar" dir="rtl">/);
  assert.ok(ar.includes(escapeHtml(ARC_STRINGS.ar['arc.claim.submit']!)), 'the Arabic button');
});

test('Hindi and Marathi books get their own claim pages', async () => {
  for (const lang of ['hi', 'mr'] as const) {
    const html = await page(await signupFor(lang));
    assert.match(html, new RegExp(`<html lang="${lang}" dir="ltr">`));
    assert.ok(html.includes(escapeHtml(ARC_STRINGS[lang]['arc.claim.submit']!)), `${lang} button`);
  }
});

test('a book with no author: the fallback is the reader language\'s own words', async () => {
  const de = await page(await signupFor('de', ''));
  assert.ok(de.includes(escapeHtml(arcT('de')('arc.claim.title', { title: 'The Salt Road', author: 'dem Autor' }))), 'de heading');
});

test('a Spanish reader\'s code email is in Spanish, its footer too', async () => {
  const signup = await signupFor('es');
  const r = await fetch(`${server.base}/arc/${signup}`, {
    method: 'POST',
    body: new URLSearchParams({ name: 'Lucía', email: 'lucia@example.com' }),
    headers: { 'x-forwarded-for': '10.9.0.1' },
    redirect: 'manual',
  });
  assert.equal(r.status, 303, await r.text());
  const mail = arcMail.sent.filter((m) => m.to === 'lucia@example.com').at(-1);
  assert.ok(mail, 'a code email went');
  const es = arcT('es');
  assert.equal(mail.subject, es('arc.mail.code.subject', { title: 'The Salt Road' }));
  assert.notEqual(mail.subject, arcT('en')('arc.mail.code.subject', { title: 'The Salt Road' }), 'not the English fallback');
  assert.match(mail.text, new RegExp(es('arc.mail.code.lead', { code: '\\d{6}' }).replace(/\./g, '\\.')));
  assert.ok(mail.text.includes(es('arc.mail.who', { author: 'Ada Moss' })), 'the footer in Spanish');
  assert.match(mail.html ?? '', /<html lang="es" dir="ltr">/);
});

/* F16: the stamp is English whatever the reader's language. */
test('a Spanish reader\'s stamp is in English, filled with the reader', async () => {
  const b = (s: string) => Buffer.from(s, 'utf8');
  const epub = createZip([
    { name: 'mimetype', data: b('application/epub+zip') },
    { name: 'META-INF/container.xml', data: b('<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>') },
    { name: 'OEBPS/package.opf', data: b('<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:identifier id="pub-id">urn:uuid:00000000-0000-4000-8000-000000000909</dc:identifier>\n    <dc:title>El camino de sal</dc:title>\n    <dc:language>es</dc:language>\n  </metadata>\n  <manifest>\n    <item id="c" href="Text/copyright.xhtml" media-type="application/xhtml+xml"/>\n  </manifest>\n  <spine>\n    <itemref idref="c"/>\n  </spine>\n</package>') },
    { name: 'OEBPS/Text/copyright.xhtml', data: b('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="es" xml:lang="es">\n<head><title>Derechos</title></head>\n<body epub:type="copyright-page">\n<p>© T</p>\n</body>\n</html>') },
  ]);
  const out = readZip(await stampEpub(epub, { name: 'Lucía Pérez', email: 'lucia@example.com', publicId: 'pub_ABCDEFGH12', lang: 'es' }));
  const doc = out.find((e) => e.name === 'OEBPS/Text/copyright.xhtml')!.data.toString('utf8');
  // The stamp isolates the name and the email in <bdi> (Task 3); the words are English.
  assert.ok(doc.replace(/<\/?bdi>/g, '').includes('Advance Review Copy prepared for Lucía Pérez (lucia@example.com)'), doc);
  assert.match(doc, /<p [^>]*lang="en" xml:lang="en" dir="ltr"/);
});
