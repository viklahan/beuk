/* BEUK:editor — the framework-free book core of Beuk 2.0's studio: the
   ProseMirror schema, the lossless text <-> document converter, and the
   Y.Doc book model with import and export. The React app imports it through
   its `@book` alias. */
export { bookSchema, DELIMITED_MARKS } from './schema.js';
export { toDoc, toText, blockText, blocksText, inlineText, blockCoverage, normalizeBlock, normalizeDoc, canApplyMark, canSetLink } from './convert.js';
export type { ConvertStats, BlockFix } from './convert.js';
export { importBook, exportBook, fragmentText, insertSections, sectionPlain, escKey, unwrapBackup, BookImportError, BookExportError, META, SECTIONS, LAYOUT, BODY } from './model.js';
export { BLOBS, BLOB_ORIGIN, PIC_REF, PIC_MIN, isPicRef, picSwapValue, shaOfData, packValue, unpackValue, setMetaValue, getMetaValue, picRefsInMeta, collectBlobs, packBlobs } from './model.js';
export { sha256Hex } from './sha256.js';
export type { ImportResult, TextWarning } from './model.js';
export { posToTextOffset, textOffsetToPos } from './positions.js';
