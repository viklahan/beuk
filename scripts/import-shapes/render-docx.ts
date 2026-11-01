/* A shape as a Word document: the minimal package Word and Beuk's reader
   both open (as src/housekeeping/fixtures.ts builds its fixture docx),
   stored entries with zeroed times via createZip, so the bytes never
   change. Headings carry the Word styles a writer's file would. */
import { createZip } from '../../src/housekeeping/packages.js';
import { expandBlocks, spacedCaps } from './render-text.js';
import type { Block, Shape } from './shape.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = (texts: string[], rPr = '') =>
  '<w:r>' + (rPr ? '<w:rPr>' + rPr + '</w:rPr>' : '') + texts.map((t) => '<w:t xml:space="preserve">' + esc(t) + '</w:t>').join('<w:br/>') + '</w:r>';
const para = (pPr: string, runs: string) => '<w:p>' + (pPr ? '<w:pPr>' + pPr + '</w:pPr>' : '') + runs + '</w:p>';
const CENTER = '<w:jc w:val="center"/>';

function blockXml(b: Exclude<Block, { t: 'filler' }>): string {
  switch (b.t) {
    case 'title': return para('<w:pStyle w:val="Title"/>' + CENTER, run([b.spaced ? spacedCaps(b.text) : b.text]));
    case 'byline': return para(CENTER, run([b.spaced ? spacedCaps(b.text) : b.text]));
    case 'series': return para(CENTER, run([b.text], '<w:i/>'));
    case 'para':
      if (!b.dropcap) return para('', run([b.text]));
      return para('<w:framePr w:dropCap="drop" w:lines="3" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/>', run([b.text.slice(0, 1)], '<w:sz w:val="96"/>'))
        + para('', run([b.text.slice(1)]));
    case 'break': return b.marker === 'space' ? '<w:p/>' : para(CENTER, run([b.marker]));
    case 'contents':
      return para('<w:pStyle w:val="TOCHeading"/>', run(['Contents'])) + b.entries.map((e) => para('<w:pStyle w:val="TOC1"/>', run([e]))).join('');
    case 'heading': {
      const lines = (b.lines ?? [b.text]).map((l) => (b.caps ? l.toUpperCase() : l));
      const kicker = b.kicker ? para(CENTER, run([b.kicker], '<w:caps/>')) : '';
      const style = b.style ?? (b.level === 1 ? 'Heading1' : 'Heading2');
      return kicker + (style === 'BoldNormal' ? para('', run(lines, '<w:b/>')) : para('<w:pStyle w:val="' + style + '"/>', run(lines)));
    }
  }
}

const style = (id: string, name: string) => '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + name + '"/></w:style>';

export function renderDocx(s: Shape): Buffer {
  const title = s.blocks.find((b) => b.t === 'title');
  const byline = s.blocks.find((b) => b.t === 'byline');
  const document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="' + W + '"><w:body>'
    + expandBlocks(s.blocks).map(blockXml).join('') + '</w:body></w:document>';
  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
    + (title ? '<dc:title>' + esc(title.text) + '</dc:title>' : '')
    + (byline ? '<dc:creator>' + esc(byline.text.replace(/^by\s+/i, '')) + '</dc:creator>' : '')
    + '</cp:coreProperties>';
  const entries = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<w:styles xmlns:w="' + W + '">' + style('Title', 'Title') + style('Heading1', 'heading 1') + style('Heading2', 'heading 2') + style('TOCHeading', 'TOC Heading') + style('TOC1', 'toc 1') + '</w:styles>' },
    { name: 'docProps/core.xml', data: core },
  ];
  return createZip(entries.map((e) => ({ name: e.name, data: Buffer.from(e.data, 'utf8') })));
}
