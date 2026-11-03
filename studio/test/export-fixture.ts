import { fixtures } from './fixtures';
import { PNG_1PX, ttfData } from './style-fixture';

/* Wave 5a (constraint 53): a book made to attack the export — every book value 1.0's EPUB, Markdown and HTML builders
   write: the meta, the sections' words, types and kinds, the pictures (data, media type, id, extension, plate), the
   cover (data, media type, extension), the uploaded fonts (family, id, data), the theme (fonts, indent, header style,
   numbers, the header design's fonts), the book colour, a custom theme and the cover recipe. */
type Rec = Record<string, unknown>;
const tag = (n: number) => `<img src="https://evil.example/${n}.png" onerror="window.__pw=${n}">"'</style><script>window.__pw=${n}</script>`;
const evil = "EB Garamond'; } body { display: none } #topbar { background: url(https://evil.example/t.png) } .x { font-family: '";

export function hostileExportBook(): Rec {
  const b = structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec & { meta: Rec; sections: Rec[]; theme: Rec };
  b.meta.title = 'Hostile ' + tag(1);
  b.meta.author = 'Writer ' + tag(2);
  b.meta.description = 'About ' + tag(13);
  b.meta.a11ySummary = 'Summary ' + tag(14);
  b.meta.isbn = '978' + tag(15);
  b.meta.publisher = 'Pub ' + tag(16);
  const s = b.sections.find((x) => x.kind === 'body' && x.type === 'chapter')!;
  s.title = 'Chapter ' + tag(3);
  s.subtitle = 'Sub ' + tag(4);
  s.number = '1' + tag(5);
  s.content = [
    'A paragraph <script>window.__pw=6</script> and <iframe src="https://evil.example/f"></iframe> and <img src=https://evil.example/i.png onerror=window.__pw=7>.',
    '[click](javascript:window.__pw=8) and [away](https://evil.example/a) and <a href="javascript:window.__pw=9">raw</a>.',
    '<style>#topbar{display:none}</style><link rel="stylesheet" href="https://evil.example/s.css">',
    '![a picture](img:hostext)',
    '![another](img:hostmedia)',
    String(s.content || ''),
  ].join('\n\n');
  s.plateId = 'hostdata';
  // a section whose type and kind break out of the file names 1.0 writes into the manifest, spine, nav and NCX
  b.sections.push({ ...structuredClone(s), id: 'hostsec', type: 'chapter" onclick="window.__pw=17', kind: 'body"><script>window.__pw=18</script>', content: 'A hostile type.', plateId: null, title: 'Typed' });
  b.images = [
    ...((b.images as Rec[]) || []),
    { id: 'hostext', name: 'ext', mediaType: 'image/png', ext: 'png" onerror="window.__pw=19', data: PNG_1PX },
    { id: 'hostmedia', name: 'media', mediaType: 'image/png" onerror="window.__pw=10', ext: 'png', data: PNG_1PX },
    { id: 'hostdata', name: 'data', mediaType: 'image/png', ext: 'png', data: 'iVBORw0KGgo=" onerror="window.__pw=11' },
    { id: 'host" onload="window.__pw=20', name: 'id', mediaType: 'image/png', ext: 'png', data: PNG_1PX },
  ];
  b.cover = { data: PNG_1PX, mediaType: 'image/png', ext: 'png"/><item id="x" href="https://evil.example/c.xhtml" media-type="application/xhtml+xml', name: 'cover.png' };
  b.fonts = [
    { id: 'f1" onload="window.__pw=21', name: 'Hand.ttf', family: 'Hand', ext: 'ttf', mediaType: 'font/ttf', data: ttfData(1600, 3) },
    { id: 'f2', name: 'Bad.ttf', family: 'Bad"); src: url(https://evil.example/f.ttf', ext: 'ttf', mediaType: 'font/ttf', data: ttfData(1600, 5) },
    { id: 'f3', name: 'Data.ttf', family: 'DataFace', ext: 'ttf', mediaType: 'font/ttf', data: 'AAEAAA") format("truetype"); } @import url(https://evil.example/i.css); x {' },
  ];
  b.theme = {
    ...b.theme, bodyFont: 'Hand', headFont: evil, indentDepth: '1em; } #topbar { background: red } .fc-page p {', headerStyle: 'classic_centered" onmouseover="window.__pw=12',
    fontSize: '1px; position: fixed; inset: 0; z-index: 99999; background: url(https://evil.example/z.png)', lineHeight: '1.5; position: fixed; inset: 0', dropDepth: '3; } #topbar { display: none } .x { x: 1',
  };
  b.colour = { accent: 'red; } #topbar { background: url(https://evil.example/a.png) } x {', tint: 'url(https://evil.example/c.png)' };
  b.customThemes = [{ id: 'ctx', name: 'Mine ' + tag(22), theme: { ...b.theme, bodyFont: evil } }];
  return b;
}

/** Review (Important 1): the same attacks as non-string values — 1.0 concatenates them into markup and CSS as their
 *  joined text (an array), so a type check that lets a non-string pass is no check. */
export function hostileNonStringBook(): Rec {
  const b = structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec & { sections: Rec[]; theme: Rec };
  const s = b.sections.find((x) => x.kind === 'body' && x.type === 'chapter')!;
  s.content = ['![arr](img:arrmedia)', '![arr2](img:arrdata)', ''].join('\n\n') +String(s.content || '');
  b.images = [
    ...((b.images as Rec[]) || []),
    { id: 'arrmedia', name: 'm', mediaType: ['image/png" onerror="window.__pw=31'], ext: 'png', data: PNG_1PX },
    { id: 'arrdata', name: 'd', mediaType: 'image/png', ext: 'png', data: [PNG_1PX + '" onerror="window.__pw=32'] },
  ];
  b.cover = { data: PNG_1PX, mediaType: ['image/png"/><item id="y" href="https://evil.example/d.xhtml" media-type="application/xhtml+xml'], ext: 'png', name: 'c.png' };
  b.theme = { ...b.theme, headerStyle: ['x" onmouseover="window.__pw=33'], indentDepth: ['1em; background: url(https://evil.example/n.png)'] };
  return b;
}


/** Review of 5c (Important 1): code points XML 1.0 does not allow — C0 controls but tab, newline and carriage return,
 *  U+FFFE / U+FFFF, and lone surrogates — in the meta, a section's title and words, a picture's alt, the manuscript block
 *  and the audio plan. 1.0's esc() passes them through; a backup's JSON.parse keeps them. */
export const XML_BAD = '\u0000\u0001\u0008\u000b\u000c\u000e\u001f\ufffe\uffffa\ud800b\udc00c';
export function controlCharBook(): Rec {
  const b = structuredClone(fixtures('real').find((f) => f.name === 'real/lantern-coast-book-one')!.book) as Rec & { meta: Rec; sections: Rec[] };
  b.meta.title = 'Ctl' + XML_BAD + ' Title';
  b.meta.author = 'Au' + XML_BAD;
  b.meta.subtitle = 'Sub' + XML_BAD;
  const s = b.sections.find((x) => x.kind === 'body' && x.type === 'chapter')!;
  s.title = 'Chapter' + XML_BAD;
  s.content = 'A line' + XML_BAD + ' with *it' + XML_BAD + '*.[^1]\n\n[link' + XML_BAD + '](https://example.org/a)\n\n[^1]: A note' + XML_BAD + '\n\n' + String(s.content || '');
  b.manuscript = { legalName: 'Ada' + XML_BAD, address: '1 Row' + XML_BAD, byline: 'By' + XML_BAD, surname: 'Sur' + XML_BAD };
  b.audio = { narrator: 'Nar' + XML_BAD, pron: [{ word: 'Wo' + XML_BAD + 'rd', soundsLike: 'so' + XML_BAD }] };
  return b;
}
