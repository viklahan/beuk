// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { extractStudioSource } from '../../src/book/studio/closure';
import { CLOSURE_NAMES, CLOSURE_ROOTS, CLOSURE_SUPPLIED } from '../src/generated/closure.js';
import { studioHtml } from './one-source';

/* Wave 5c, task 1 — constraint 64 (review focus #1): THE BUILDERS ARE 1.0's. The Word export (docxRun … buildDocxFiles,
   downloadDocx), the box set (boxSetPlan, boxSetFiles, buildBoxSetEpub, renderBoxSetList, bookDocToVolume), the
   submission manuscript (msPlan, msFiles, msBlob, msDownload, its dialog: msRender, msInit) and the ACX audio script
   (acxBuildPlan, acxZipEntries, acxBuildZipBlob, acxDownload, its dialog: acxRender, acxInit) are 1.0's own declarations,
   lifted into the main closure: each one's text there equals 1.0's source, character for character. Nothing of them is
   in React. Only the two parts of Add a Book that need 1.0's import (wave 6) stay supplied: boxSetExpandPick and
   manuscriptFileToVolume (2.0's stand-ins read a Beuk backup with 1.0's own localParseBackup and bookDocToVolume). */

const CLOSURE_JS = fileURLToPath(new URL('../src/generated/closure.js', import.meta.url));
const declNames = (st: ts.Statement): string[] => {
  if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) return [st.name.text];
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  return [];
};
function byName(statements: readonly ts.Statement[], sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const st of statements) for (const n of declNames(st)) out.set(n, st.getText(sf));
  return out;
}

export const WAVE5C = {
  docx: ['docxRun', 'docxInlineRuns', 'docxPara', 'docxContentParas', 'buildDocxDocumentXml', 'buildDocxStylesXml', 'buildDocxNumberingXml', 'docxDocumentRelsXml',
    'buildDocxFiles', 'buildDocxBlob', 'downloadDocx'],
  boxset: ['bookWord', 'boxSetVolumesAll', 'boxSetPlan', 'renderBoxSetEntry', 'boxSetTitle', 'boxSetFilename', 'boxSetFiles', 'buildBoxSetEpub', 'renderBoxSetList',
    'bookDocToVolume', 'boxSetVolumeMeta', 'boxSetNameTitle', 'localParseBackup'],
  ms: ['msNormalize', 'msPlan', 'msRoundWords', 'msDocumentXml', 'msHeaderXml', 'msStylesXml', 'msFiles', 'msBlob', 'msFilename', 'msDownload', 'msSummaryHtml', 'msRender',
    'msOpen', 'msInit'],
  acx: ['acxNormalize', 'acxBuildPlan', 'acxDetectCandidates', 'acxGuideRows', 'acxSetPron', 'acxZipEntries', 'acxBuildZipBlob', 'acxDownload', 'acxSummaryTxt',
    'acxFileTxt', 'acxDocxFiles', 'acxRender', 'acxOpen', 'acxInit', 'acxListen'],
};

describe("wave 5c: Word, the box set, the manuscript and the ACX script are 1.0's code (constraint 64)", () => {
  it('the four builders and their dialogs are lifted, never supplied; only the import half of Add a Book is supplied', () => {
    for (const [what, names] of Object.entries(WAVE5C))
      for (const n of names) {
        expect(CLOSURE_NAMES, what + ' ' + n).toContain(n);
        expect(CLOSURE_SUPPLIED, what + ' ' + n).not.toContain(n);
      }
    for (const n of ['downloadDocx', 'buildBoxSetEpub', 'renderBoxSetList', 'buildDocxFiles', 'boxSetFiles', 'bookDocToVolume', 'localParseBackup', 'msInit', 'msFiles', 'msPlan',
      'acxInit', 'acxBuildPlan', 'acxZipEntries']) expect(CLOSURE_ROOTS, n).toContain(n);
    for (const n of ['boxSetExpandPick', 'manuscriptFileToVolume']) {
      expect(CLOSURE_SUPPLIED, n).toContain(n);
      expect(CLOSURE_NAMES, n).not.toContain(n);
    }
  });

  it("each of their declarations' text in the closure equals 1.0's source, character for character", () => {
    const names = Object.values(WAVE5C).flat();
    const one = extractStudioSource(studioHtml(), names, { listRef: 'studio/test/docx-closure.test.ts', api: '', stringTables: false });
    const sfO = ts.createSourceFile('one.js', one.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const o = byName(sfO.statements, sfO);
    const gen = readFileSync(CLOSURE_JS, 'utf8');
    const sfB = ts.createSourceFile('closure.js', gen, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const create = sfB.statements.find((st): st is ts.FunctionDeclaration => ts.isFunctionDeclaration(st) && st.name?.text === 'createClosure');
    const b = byName(create!.body!.statements, sfB);
    const unequal: string[] = [];
    for (const n of names) {
      expect(o.has(n), `1.0 declares ${n}`).toBe(true);
      expect(b.has(n), `the closure lifts ${n}`).toBe(true);
      if (o.get(n) !== b.get(n)) unequal.push(n);
    }
    expect(unequal).toEqual([]);
    expect(b.get('buildDocxFiles')).toMatch(/docxNums = \[\], docxLinks = \[\], buildDocxDocumentXml\(\)/);
  });
});
