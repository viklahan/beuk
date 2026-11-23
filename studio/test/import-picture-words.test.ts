// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { CLEAR, docx, figures, importFile, odt, oh, op, rtfDoc, rtfH, rtfP, rw, setupImport, written, wp, type Got } from './import-given';

/* The owner's rule (2026-11-22): "KEEP WHAT THE WRITER GIVES US." A picture's title and its description are both the
   writer's words. The book keeps one description for a picture, so where a file has both they were joined
   "title — description": an em dash the writer never wrote. And the tally could not see it, because the file's side
   was counted through the same joining rule (both sides held the dash). The first sweep's rule for joins
   (BEUK:joinsgiven, 712b496): two things of the file are put together with a space and no character of Beuk's.

   Held here, for Word (wp:docPr title and descr), OpenDocument (svg:title and svg:desc) and RTF (the picture's
   wzTitle and wzDescription):
   - both are kept, the title first, one space between them; nothing is added;
   - both are kept where the description begins with the title's words (the title was left out there);
   - where the two are the same text they are the one description they are;
   - the report says how many pictures had both;
   - the tally's two rows count, on the file's side, the title and the description as the file has them, and on the
     book's side the description the book holds: the same number, and a character put between them would show. */

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/* [title, description, what the book holds] */
const PICS: [string, string, string][] = [
  ['Plate I', 'A map of the salt road.', 'Plate I A map of the salt road.'],
  ['Plate II', 'Plate II, the quay at dusk.', 'Plate II Plate II, the quay at dusk.'],
  ['The same words', 'The same words', 'The same words'],
  ['', 'Only a description.', 'Only a description.'],
];
const n = (s: string) => Array.from(s.replace(/\s+/g, '')).length;
/* the characters of the pictures' words: in the file each title and each description as it stands (the same text given as both, once); in the book each description held */
const IN_FILE = PICS.reduce((a, [t, d]) => a + (t && d && t !== d ? n(t) + n(d) : n(d || t)), 0);
const IN_BOOK = PICS.reduce((a, p) => a + n(p[2]), 0);
const BODY = 'The pans lay white under the low sun and nobody on the quay spoke of the ledger that year.';
const LAST = 'The second chapter stands here so that the book has two.';

const alts = (g: Got) => written(g).map((s) => s.content).join('\n').match(/!\[[^\]]*\]\(img:/g)?.map((m) => m.slice(2, -6)) || [];
const row = (g: Got, key: string) => { const r = g.tally.rows.find((x) => x.key === key); return r ? { file: r.file, book: r.book } : null; };
const joined = (g: Got) => g.rep.items.filter((i) => i.kind === 'picAltJoined').map((i) => i.data);

const draw = (id: number, title: string, descr: string) => '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><wp:docPr id="' + id + '" name="Picture ' + id + '"' + (title ? ' title="' + title + '"' : '') + (descr ? ' descr="' + descr + '"' : '')
  + '/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="p"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdP1"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
const frame = (k: number, title: string, desc: string) => '<text:p><draw:frame><draw:image xlink:href="Pictures/p' + k + '.png"/>' + (title ? '<svg:title>' + title + '</svg:title>' : '') + (desc ? '<svg:desc>' + desc + '</svg:desc>' : '') + '</draw:frame></text:p>';
const HEX = Array.from(Buffer.from(PNG, 'base64'), (c) => c.toString(16).padStart(2, '0')).join('');
const pict = (title: string, desc: string) => rw('pard') + ' {' + rw('*') + rw('shppict') + '{' + rw('pict') + '{' + rw('*') + rw('picprop') + (title ? '{' + rw('sp') + '{' + rw('sn') + ' wzTitle}{' + rw('sv') + ' ' + title + '}}' : '')
  + (desc ? '{' + rw('sp') + '{' + rw('sn') + ' wzDescription}{' + rw('sv') + ' ' + desc + '}}' : '') + '}' + rw('pngblip') + ' ' + HEX + '}}' + rw('par') + '\n';

const FILES: [string, () => Promise<{ bytes: Uint8Array | null; text: string }>][] = [
  ['pictures.docx', async () => ({ bytes: await docx(wp('Chapter 1', true) + wp(BODY) + PICS.map(([t, d], k) => draw(k + 1, t, d) + wp('After plate ' + (k + 1) + ' the page goes on.')).join('') + wp('Chapter 2', true) + wp(LAST), { 'word/media/p1.png': PNG }), text: '' })],
  ['pictures.odt', async () => ({ bytes: await odt(oh('Chapter 1') + op(BODY) + PICS.map(([t, d], k) => frame(k, t, d) + op('After plate ' + (k + 1) + ' the page goes on.')).join('') + oh('Chapter 2') + op(LAST), '', Object.fromEntries(PICS.map((p, k) => ['Pictures/p' + k + '.png', PNG]))), text: '' })],
  ['pictures.rtf', async () => ({ bytes: null, text: rtfDoc(rtfH('Chapter 1') + rtfP(BODY) + PICS.map(([t, d], k) => pict(t, d) + rtfP('After plate ' + (k + 1) + ' the page goes on.')).join('') + rtfH('Chapter 2') + rtfP(LAST)) })],
];

beforeAll(async () => { await setupImport('import-picture-words'); }, 180_000);

describe('a picture\'s title and description are both kept as the file gave them, with no character of Beuk\'s between them', () => {
  it.each(FILES)('%s: the title first, a space, the description; both kept where the description begins with the title; the same text once; and the tally counts them as the file has them', async (name, build) => {
    const f = await build();
    const g = await importFile(name, f.bytes, f.text);
    expect(alts(g), name + ': each picture\'s description in the book').toEqual(PICS.map((p) => p[2]));
    expect(alts(g).join(' '), name + ': no dash of the import\'s').not.toContain('—');
    expect(joined(g), name + ': the report says how many pictures had both').toEqual([{ n: 2 }]);
    expect(row(g, 'picDescWords'), name + ': the characters of the pictures\' words, in the file and in the book').toEqual({ file: IN_FILE, book: IN_BOOK });
    expect(g.tally.rows.filter((r) => /^picDesc/.test(r.key)).map((r) => [r.key, r.file, r.book]), name + ': the pictures\' rows').toEqual([['picDescs', 4, 4], ['picDescWords', IN_FILE, IN_BOOK]]);
    expect(IN_FILE, 'the made-up pictures: as many characters in the file as in the book').toBe(IN_BOOK);
    expect(figures(g), name + ': the tally').toEqual(CLEAR);
  }, 120_000);
});
