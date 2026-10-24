import { createZip, type ZipEntry } from './packages.js';

/**
 * Canonical fixture packages for the package-level Self-checks. They
 * mirror the shapes the Beuk client generates (same file layout and
 * semantics, verified in the client passes), small enough to build in
 * memory: a full-featured Draft2Digital-style book with a PNG cover, a
 * KDP-style book with a JPEG cover, a no-cover baseline book, a two-
 * volume box set, and a minimal DOCX. Tests build the same fixtures
 * and mutate them to prove the validator catches damage.
 */

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const XML_HEAD =
  '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en"><head><title>t</title></head>';

function containerXml(opfPath = 'OEBPS/package.opf'): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles></container>`;
}

function navXhtml(coverHref: string | null, chapters: [string, string][]): string {
  const tocItems = chapters.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('');
  const coverLandmark = coverHref
    ? `<li><a epub:type="cover" href="${coverHref}">Cover</a></li>`
    : '';
  return `${XML_HEAD}<body><nav epub:type="toc"><ol>${tocItems}</ol></nav><nav epub:type="landmarks"><ol>${coverLandmark}<li><a epub:type="toc" href="nav.xhtml">Contents</a></li><li><a epub:type="bodymatter" href="${chapters[0][0]}">Start</a></li></ol></nav></body></html>`;
}

function ncx(targets: string[]): string {
  const navPoints = targets
    .map(
      (src, i) =>
        `<navPoint id="np${i}" playOrder="${i + 1}"><navLabel><text>Section ${i + 1}</text></navLabel><content src="${src}"/></navPoint>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head></head><docTitle><text>The Fixture Book</text></docTitle><navMap>${navPoints}</navMap></ncx>`;
}

function chapterWithNotes(imageRef: string | null): string {
  const img = imageRef
    ? `<figure><img src="${imageRef}" alt="A fixture plate illustration" class="full-bleed"/></figure>`
    : '';
  return `${XML_HEAD}<body><h1>Chapter One</h1><p id="fnref1">A sentence with a note.<a epub:type="noteref" href="#fn1"><sup>1</sup></a></p>${img}<aside epub:type="endnote" id="fn1"><p>The fixture note. <a href="#fnref1">back</a></p></aside></body></html>`;
}

function plainChapter(title: string): string {
  return `${XML_HEAD}<body><h1>${title}</h1><p>Plain fixture text.</p></body></html>`;
}

function opf(opts: {
  coverId?: string;
  coverHref?: string;
  coverMedia?: string;
  guide: boolean;
  a11y: boolean;
  items: [string, string, string, string?][];
  spine: string[];
}): string {
  const items = opts.items
    .map(
      ([id, href, media, props]) =>
        `<item id="${id}" href="${href}" media-type="${media}"${props ? ` properties="${props}"` : ''}/>`,
    )
    .join('');
  const spine = opts.spine.map((id) => `<itemref idref="${id}"/>`).join('');
  const coverMeta = opts.coverId ? `<meta name="cover" content="${opts.coverId}"/>` : '';
  const a11y = opts.a11y
    ? '<meta property="schema:accessMode">textual</meta><meta property="schema:accessibilityFeature">alternativeText</meta>'
    : '';
  const guide = opts.guide
    ? '<guide><reference type="cover" href="Text/cover.xhtml"/><reference type="toc" href="nav.xhtml"/><reference type="text" href="Text/ch1.xhtml"/></guide>'
    : '';
  return `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:11111111-2222-3333-4444-555555555555</dc:identifier><dc:title>The Fixture Book</dc:title><dc:creator>Fixture Author</dc:creator><dc:language>en</dc:language>${coverMeta}${a11y}</metadata><manifest>${items}</manifest><spine toc="ncx">${spine}</spine>${guide}</package>`;
}

export interface FixtureSet {
  /** Draft2Digital-style: PNG cover, guide, ibooks file, a11y metadata,
   *  footnote + full-bleed image in chapter one. */
  bookPng: Buffer;
  /** KDP-style: JPEG cover, guide, no ibooks display-options file. */
  bookJpeg: Buffer;
  /** The pre-feature baseline: no cover anywhere. */
  bookNoCover: Buffer;
  /** Two-volume box set (vol01/vol02 prefixed parts). */
  boxSet: Buffer;
  /** Minimal DOCX with Title/Heading styles, a scene break, Endnotes. */
  docx: Buffer;
}

function bookPngEntries(): ZipEntry[] {
  const entries: { name: string; data: Buffer }[] = [
    { name: 'mimetype', data: Buffer.from('application/epub+zip') },
    { name: 'META-INF/container.xml', data: Buffer.from(containerXml()) },
    {
      name: 'META-INF/com.apple.ibooks.display-options.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="utf-8"?>\n<display_options><platform name="*"><option name="specified-fonts">true</option></platform></display_options>',
      ),
    },
    {
      name: 'OEBPS/package.opf',
      data: Buffer.from(
        opf({
          coverId: 'cover-img',
          guide: true,
          a11y: true,
          items: [
            ['cover-img', 'Images/cover.png', 'image/png', 'cover-image'],
            ['cover', 'Text/cover.xhtml', 'application/xhtml+xml'],
            ['title', 'Text/title.xhtml', 'application/xhtml+xml'],
            ['ch1', 'Text/ch1.xhtml', 'application/xhtml+xml'],
            ['plate', 'Images/plate.png', 'image/png'],
            ['nav', 'nav.xhtml', 'application/xhtml+xml', 'nav'],
            ['ncx', 'toc.ncx', 'application/x-dtbncx+xml'],
            ['css', 'Styles/blitz.css', 'text/css'],
          ],
          spine: ['cover', 'title', 'ch1'],
        }),
      ),
    },
    {
      name: 'OEBPS/nav.xhtml',
      data: Buffer.from(
        navXhtml('Text/cover.xhtml', [
          ['Text/title.xhtml', 'Title Page'],
          ['Text/ch1.xhtml', 'Chapter One'],
        ]),
      ),
    },
    { name: 'OEBPS/toc.ncx', data: Buffer.from(ncx(['Text/title.xhtml', 'Text/ch1.xhtml'])) },
    {
      name: 'OEBPS/Text/cover.xhtml',
      data: Buffer.from(
        `${XML_HEAD}<body><section epub:type="cover"><img src="../Images/cover.png" alt="Cover of The Fixture Book"/></section></body></html>`,
      ),
    },
    { name: 'OEBPS/Text/title.xhtml', data: Buffer.from(plainChapter('The Fixture Book')) },
    { name: 'OEBPS/Text/ch1.xhtml', data: Buffer.from(chapterWithNotes('../Images/plate.png')) },
    { name: 'OEBPS/Images/cover.png', data: PNG_BYTES },
    { name: 'OEBPS/Images/plate.png', data: PNG_BYTES },
    { name: 'OEBPS/Styles/blitz.css', data: Buffer.from('body { font-family: serif; }') },
  ];
  return entries.map((e) => ({ ...e, method: 0 }));
}

function bookJpegEntries(): ZipEntry[] {
  const entries: { name: string; data: Buffer }[] = [
    { name: 'mimetype', data: Buffer.from('application/epub+zip') },
    { name: 'META-INF/container.xml', data: Buffer.from(containerXml()) },
    {
      name: 'OEBPS/package.opf',
      data: Buffer.from(
        opf({
          coverId: 'cover-img',
          guide: true,
          a11y: true,
          items: [
            ['cover-img', 'Images/cover.jpg', 'image/jpeg', 'cover-image'],
            ['cover', 'Text/cover.xhtml', 'application/xhtml+xml'],
            ['title', 'Text/title.xhtml', 'application/xhtml+xml'],
            ['ch1', 'Text/ch1.xhtml', 'application/xhtml+xml'],
            ['nav', 'nav.xhtml', 'application/xhtml+xml', 'nav'],
            ['ncx', 'toc.ncx', 'application/x-dtbncx+xml'],
            ['css', 'Styles/blitz.css', 'text/css'],
          ],
          spine: ['cover', 'title', 'ch1'],
        }),
      ),
    },
    {
      name: 'OEBPS/nav.xhtml',
      data: Buffer.from(
        navXhtml('Text/cover.xhtml', [
          ['Text/title.xhtml', 'Title Page'],
          ['Text/ch1.xhtml', 'Chapter One'],
        ]),
      ),
    },
    { name: 'OEBPS/toc.ncx', data: Buffer.from(ncx(['Text/title.xhtml', 'Text/ch1.xhtml'])) },
    {
      name: 'OEBPS/Text/cover.xhtml',
      data: Buffer.from(
        `${XML_HEAD}<body><section epub:type="cover"><img src="../Images/cover.jpg" alt="Cover of The Fixture Book"/></section></body></html>`,
      ),
    },
    { name: 'OEBPS/Text/title.xhtml', data: Buffer.from(plainChapter('The Fixture Book')) },
    { name: 'OEBPS/Text/ch1.xhtml', data: Buffer.from(chapterWithNotes(null)) },
    { name: 'OEBPS/Images/cover.jpg', data: JPEG_BYTES },
    { name: 'OEBPS/Styles/blitz.css', data: Buffer.from('body { font-family: serif; }') },
  ];
  return entries.map((e) => ({ ...e, method: 0 }));
}

function bookNoCoverEntries(): ZipEntry[] {
  const entries: { name: string; data: Buffer }[] = [
    { name: 'mimetype', data: Buffer.from('application/epub+zip') },
    { name: 'META-INF/container.xml', data: Buffer.from(containerXml()) },
    {
      name: 'OEBPS/package.opf',
      data: Buffer.from(
        opf({
          guide: false,
          a11y: false,
          items: [
            ['title', 'Text/title.xhtml', 'application/xhtml+xml'],
            ['ch1', 'Text/ch1.xhtml', 'application/xhtml+xml'],
            ['nav', 'nav.xhtml', 'application/xhtml+xml', 'nav'],
            ['ncx', 'toc.ncx', 'application/x-dtbncx+xml'],
            ['css', 'Styles/blitz.css', 'text/css'],
          ],
          spine: ['title', 'ch1'],
        }),
      ),
    },
    {
      name: 'OEBPS/nav.xhtml',
      data: Buffer.from(
        navXhtml(null, [
          ['Text/title.xhtml', 'Title Page'],
          ['Text/ch1.xhtml', 'Chapter One'],
        ]),
      ),
    },
    { name: 'OEBPS/toc.ncx', data: Buffer.from(ncx(['Text/title.xhtml', 'Text/ch1.xhtml'])) },
    { name: 'OEBPS/Text/title.xhtml', data: Buffer.from(plainChapter('The Fixture Book')) },
    { name: 'OEBPS/Text/ch1.xhtml', data: Buffer.from(plainChapter('Chapter One')) },
    { name: 'OEBPS/Styles/blitz.css', data: Buffer.from('body { font-family: serif; }') },
  ];
  return entries.map((e) => ({ ...e, method: 0 }));
}

function boxSetEntries(): ZipEntry[] {
  const volItems: [string, string, string, string?][] = [
    ['vol01-cover-img', 'Images/vol01-cover.png', 'image/png', 'cover-image'],
    ['vol01-divider', 'Text/vol01-divider.xhtml', 'application/xhtml+xml'],
    ['vol01-title', 'Text/vol01-title.xhtml', 'application/xhtml+xml'],
    ['vol01-ch1', 'Text/vol01-ch1.xhtml', 'application/xhtml+xml'],
    ['vol02-divider', 'Text/vol02-divider.xhtml', 'application/xhtml+xml'],
    ['vol02-title', 'Text/vol02-title.xhtml', 'application/xhtml+xml'],
    ['vol02-ch1', 'Text/vol02-ch1.xhtml', 'application/xhtml+xml'],
    ['vol02-plate', 'Images/vol02-plate.png', 'image/png'],
    ['nav', 'nav.xhtml', 'application/xhtml+xml', 'nav'],
    ['ncx', 'toc.ncx', 'application/x-dtbncx+xml'],
    ['css', 'Styles/blitz.css', 'text/css'],
  ];
  const boxNav = `${XML_HEAD}<body><nav epub:type="toc"><ol><li><a href="Text/vol01-divider.xhtml">Book One</a><ol><li><a href="Text/vol01-ch1.xhtml">Chapter One</a></li></ol></li><li><a href="Text/vol02-divider.xhtml">Book Two</a><ol><li><a href="Text/vol02-ch1.xhtml">Chapter One</a></li></ol></li></ol></nav><nav epub:type="landmarks"><ol><li><a epub:type="cover" href="Text/vol01-divider.xhtml">Cover</a></li><li><a epub:type="toc" href="nav.xhtml">Contents</a></li><li><a epub:type="bodymatter" href="Text/vol01-ch1.xhtml">Start</a></li></ol></nav></body></html>`;
  const entries: { name: string; data: Buffer }[] = [
    { name: 'mimetype', data: Buffer.from('application/epub+zip') },
    { name: 'META-INF/container.xml', data: Buffer.from(containerXml()) },
    {
      name: 'OEBPS/package.opf',
      data: Buffer.from(
        opf({
          coverId: 'vol01-cover-img',
          guide: false,
          a11y: false,
          items: volItems,
          spine: ['vol01-divider', 'vol01-title', 'vol01-ch1', 'vol02-divider', 'vol02-title', 'vol02-ch1'],
        }),
      ),
    },
    { name: 'OEBPS/nav.xhtml', data: Buffer.from(boxNav) },
    {
      name: 'OEBPS/toc.ncx',
      data: Buffer.from(ncx(['Text/vol01-ch1.xhtml', 'Text/vol02-ch1.xhtml'])),
    },
    { name: 'OEBPS/Text/vol01-divider.xhtml', data: Buffer.from(plainChapter('Book One')) },
    { name: 'OEBPS/Text/vol01-title.xhtml', data: Buffer.from(plainChapter('Book One — Title')) },
    { name: 'OEBPS/Text/vol01-ch1.xhtml', data: Buffer.from(plainChapter('Chapter One')) },
    { name: 'OEBPS/Text/vol02-divider.xhtml', data: Buffer.from(plainChapter('Book Two')) },
    { name: 'OEBPS/Text/vol02-title.xhtml', data: Buffer.from(plainChapter('Book Two — Title')) },
    { name: 'OEBPS/Text/vol02-ch1.xhtml', data: Buffer.from(chapterWithNotes('../Images/vol02-plate.png')) },
    { name: 'OEBPS/Images/vol01-cover.png', data: PNG_BYTES },
    { name: 'OEBPS/Images/vol02-plate.png', data: PNG_BYTES },
    { name: 'OEBPS/Styles/blitz.css', data: Buffer.from('body { font-family: serif; }') },
  ];
  return entries.map((e) => ({ ...e, method: 0 }));
}

function docxEntries(): ZipEntry[] {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>The Fixture Book</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter One</w:t></w:r></w:p><w:p><w:r><w:t>Body text with a note.</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>1</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>* * *</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Endnotes</w:t></w:r></w:p><w:p><w:r><w:t>1. The fixture note.</w:t></w:r></w:p></w:body></w:document>`;
  const entries: { name: string; data: Buffer }[] = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    },
    { name: 'word/document.xml', data: Buffer.from(document) },
    {
      name: 'word/styles.xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>',
      ),
    },
  ];
  return entries.map((e) => ({ ...e, method: 0 }));
}

let cached: FixtureSet | null = null;

export function loadFixtures(): FixtureSet {
  if (cached) return cached;
  cached = {
    bookPng: createZip(bookPngEntries()),
    bookJpeg: createZip(bookJpegEntries()),
    bookNoCover: createZip(bookNoCoverEntries()),
    boxSet: createZip(boxSetEntries()),
    docx: createZip(docxEntries()),
  };
  return cached;
}

/** Entry-level fixture access for cases that assert on parts (and for
 *  tests that mutate a package to prove the validator catches it). */
export function fixtureEntries(): {
  bookPng: ZipEntry[];
  bookJpeg: ZipEntry[];
  bookNoCover: ZipEntry[];
  boxSet: ZipEntry[];
  docx: ZipEntry[];
} {
  return {
    bookPng: bookPngEntries(),
    bookJpeg: bookJpegEntries(),
    bookNoCover: bookNoCoverEntries(),
    boxSet: boxSetEntries(),
    docx: docxEntries(),
  };
}
