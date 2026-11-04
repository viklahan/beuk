/* Wave 6: the import corpus that needs building (constraint 77) — minimal WordprocessingML .docx files made here with
   1.0's vendored JSZip (no binary is committed: this file is the generator), a DOCX that is broken, zips (one manuscript,
   two, a zip bomb by declared size), an EPUB with no epub:type, and a DRM'd EPUB. Used by the e2e (studio/e2e/book.mjs
   wave6Checks) and the vitest (studio/test/import-volume.test.ts). `JSZip` is passed in (the page's or Node's copy). */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
/** A 1×1 red PNG. */
export const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

const run = (text, o = {}) => `<w:r>${o.i || o.b || o.lang ? `<w:rPr>${o.b ? '<w:b/>' : ''}${o.i ? '<w:i/>' : ''}${o.lang ? `<w:lang w:val="${o.lang}"/>` : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const p = (content, style, extra = '') => `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}${content}</w:p>`;
const para = (text, o) => p(run(text, o));
const h1 = (text) => p(run(text), 'Heading1');
const h2 = (text) => p(run(text), 'Heading2');

function styles() {
  const st = (id, name, outline) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${outline === undefined ? '' : `<w:pPr><w:outlineLvl w:val="${outline}"/></w:pPr>`}</w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>${st('Normal', 'Normal')}${st('Heading1', 'heading 1', 0)}${st('Heading2', 'heading 2', 1)}${st('Title', 'Title')}${st('Quote', 'Quote')}</w:styles>`;
}

/** One .docx: `body` is the w:body's paragraphs; `parts` adds footnotes, comments, a picture. */
export async function makeDocx(JSZip, { body, title = '', creator = '', lang = '', footnotes = null, comments = null, image = false }) {
  const z = new JSZip();
  const ct = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>', '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'];
  const rels = ['<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'];
  if (footnotes) {
    ct.push('<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>');
    rels.push('<Relationship Id="rIdFn" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>');
    z.file('word/footnotes.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${footnotes.map((f, i) => `<w:footnote w:id="${i + 1}"><w:p><w:r><w:footnoteRef/></w:r>${run(' ' + f)}</w:p></w:footnote>`).join('')}</w:footnotes>`);
  }
  if (comments) {
    ct.push('<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>');
    rels.push('<Relationship Id="rIdCm" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>');
    z.file('word/comments.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${W}>${comments.map((c, i) => `<w:comment w:id="${i}" w:author="Ed"><w:p>${run(c)}</w:p></w:comment>`).join('')}</w:comments>`);
  }
  if (image) {
    rels.push('<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>');
    z.file('word/media/image1.png', PNG_1X1, { base64: true });
  }
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${ct.join('')}</Types>`);
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
  z.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
  z.file('word/styles.xml', styles());
  z.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(creator)}</dc:creator>${lang ? `<dc:language>${lang}</dc:language>` : ''}</cp:coreProperties>`);
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return z.generateAsync({ type: 'uint8array' });
}

const IMG = `<w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="Picture 1" descr="A red dot"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image1.png" descr="A red dot"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
const TABLE = `<w:tbl><w:tr><w:tc><w:p>${run('Tide')}</w:p></w:tc><w:tc><w:p>${run('Hour')}</w:p></w:tc></w:tr><w:tr><w:tc><w:p>${run('High')}</w:p></w:tc><w:tc><w:p>${run('06:12')}</w:p></w:tc></w:tr></w:tbl>`;

/** The six (and more) DOCX of constraint 77: headings, Part/Chapter, front/back matter, footnotes, a picture, a table, a
 *  tracked change, a comment, a w:lang. */
export async function docxCorpus(JSZip) {
  const out = [];
  const add = async (name, o) => out.push({ name, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: await makeDocx(JSZip, o) });
  await add('headings.docx', { title: 'The Ferry Crossing', creator: 'Ada Quill', body: h1('Chapter One') + para('The ferry left at nine. "Late again," said the pilot.') + h2('At the rail') + para('Spray.') + h1('Chapter Two') + para('The water was black...') });
  await add('parts.docx', { title: 'Two Shores', creator: 'R. North', body: h1('Part One: The Coast') + h1('Chapter 1') + para('North.') + h1('Chapter 2') + para('South.') + h1('Part Two: The Sea') + h1('Chapter 3') + para('East.') });
  await add('matter.docx', { title: 'Harbour Lights', creator: 'Mira Okonjo', body: para('Copyright © 2024 Mira Okonjo. All rights reserved.') + para('ISBN 978-0-306-40615-7') + para('Published by Tidewater Press') + h1('Dedication') + para('For my mother.') + h1('Chapter One') + para('Lights.') + h1('Acknowledgements') + para('Thanks.') + h1('About the Author') + para('Mira lives by the sea.') });
  await add('footnotes.docx', { title: 'Notes', creator: 'Ada Quill', footnotes: ['A wet one.', 'A second note.'], body: h1('Chapter One') + p(run('Storm.') + '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>' + run(' And rain.') + '<w:r><w:footnoteReference w:id="2"/></w:r>') });
  await add('picture-table.docx', { title: 'Tide Tables', creator: 'R. North', image: true, body: h1('Chapter One') + para('Before the picture.') + p(IMG) + para('After the picture.') + TABLE + para('After the table.') });
  await add('tracked-comment-lang.docx', { title: 'Le Port', creator: 'Mira Okonjo', comments: ['Check this.'], body: h1('Chapitre un', { lang: 'fr-FR' }) + p(run('Il pleuvait sur le port, ', { lang: 'fr-FR' }) + '<w:commentRangeStart w:id="0"/>' + run('et la mer était grise', { lang: 'fr-FR' }) + '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>' + '<w:ins w:id="5" w:author="Ed"><w:r><w:rPr><w:lang w:val="fr-FR"/></w:rPr><w:t xml:space="preserve"> ce matin-là</w:t></w:r></w:ins><w:del w:id="6" w:author="Ed"><w:r><w:delText>supprimé</w:delText></w:r></w:del>' + run('. Les bateaux dormaient le long du quai, les filets séchaient au soleil pâle, et personne ne parlait.', { lang: 'fr-FR' })) + h1('Chapitre deux', { lang: 'fr-FR' }) + para('Une lettre arriva dans la matinée, portée par un garçon qui ne disait rien.', { lang: 'fr-FR' }) });
  return out;
}

/** A zip of the given files ({ name, bytes|text }). */
export async function makeZip(JSZip, files) {
  const z = new JSZip();
  for (const f of files) z.file(f.name, f.bytes ?? f.text);
  return z.generateAsync({ type: 'uint8array' });
}
/** A zip whose one member DECLARES a size past 1.0's ZIP_MAX_BYTES (400 MB) in its central directory: 1.0 refuses it
 *  by the declared size before opening it (importExpandZips). The member itself is small. */
export async function zipBomb(JSZip) {
  const bytes = await makeZip(JSZip, [{ name: 'book.md', text: '# One\n\nText.\n' }]);
  const u = new Uint8Array(bytes);
  // patch the uncompressed size in the local header (offset 22) and in the central directory entry (offset 24 from its
  // signature 0x02014b50) to 0xFFFFFFF0 (~4 GB)
  const dv = new DataView(u.buffer);
  dv.setUint32(22, 0xfffffff0, true);
  for (let i = u.length - 22; i >= 0; i--)
    if (dv.getUint32(i, true) === 0x02014b50) {
      dv.setUint32(i + 24, 0xfffffff0, true);
      break;
    }
  return u;
}

/** An EPUB 3 with no epub:type anywhere (a page that says nothing is read by its headings). */
export async function plainEpub(JSZip) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:00000000-0000-4000-8000-000000000001</dc:identifier><dc:title>Plain Pages</dc:title><dc:creator>Ada Quill</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>');
  const page = (h, t) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${h}</title></head><body><h1>${h}</h1><p>${t}</p></body></html>`;
  z.file('OEBPS/c1.xhtml', page('Chapter One', 'The first page.'));
  z.file('OEBPS/c2.xhtml', page('Chapter Two', 'The second page.'));
  return z.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' });
}
/** A DRM'd EPUB (META-INF/encryption.xml naming its pages, as Adobe's scheme does). */
export async function drmEpub(JSZip) {
  const z = await JSZip.loadAsync(await plainEpub(JSZip));
  z.file('META-INF/encryption.xml', '<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/c1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>');
  return z.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' });
}
