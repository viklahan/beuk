import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { posToTextOffset } from '@book/editor/index.js';
import { toBook } from '../editor/bridge';
import type { ClosureApi, SceneEntry, StockPhoto } from '../closure/index';
import { textArea, type TextEdit } from '../editor/insert';

/* BEUK:sceneimages — scene breaks and their pictures (inventory A6), and the
   section card's marker edits (A7). 1.0's lines, ported where 1.0 writes
   them inline around its DOM (sceneBreakAtCursor, confirmSceneImage,
   detachSceneImage / removeSceneAtCursor, rewriteImageToken,
   updateImageToken, removeImageToken, the Insert Image button, selectLibImage
   and sceneSelectImage's alt offers, sceneRenderSuggestResults' verdicts,
   scenePickStock's order, sceneStockLanded's picture), each compared with
   1.0's own function in test/pictures.test.ts through the test-only oracle
   module. The rules they use (editorBlocks, SCENE_BREAK_BLOCK_RE,
   parseImageLine, imageTokenText, cleanAlt, cleanCaption, insertAtCursor,
   cmMapDirectResults) are 1.0's own from the closure. */

type Rec = Record<string, unknown>;

/* ---- the break the cursor stands on (1.0's sceneBreakAtCursor) ---- */

export type SceneAt = { at: number; total: number };

/** 1.0's sceneBreakAtCursor on a text and its caret (the textarea's selectionStart), less its DOM: the break whose
 *  block holds the caret, counted in the editor's own raw forms, of all the section's breaks. */
export function sceneBreakAt(c: ClosureApi, text: string, pos: number): SceneAt | null {
  const ta = textArea(text, pos, pos); // 1.0's textarea holds no "\r"
  const val = ta.value || '';
  const p = ta.selectionStart || 0;
  let total = 0;
  let found = -1;
  c.editorBlocks(val).forEach((b) => {
    if (c.SCENE_BREAK_BLOCK_RE.test(b.text.trim())) {
      if (p >= b.start && p <= b.end) found = total;
      total++;
    }
  });
  return found < 0 ? null : { at: found, total };
}

/** Could the editor's caret stand on a scene break? A cheap test on the top-level blocks around it, so the whole text
 *  is read (sceneBreakAt) only when it might: a scene break node, a block whose text could be one of 1.0's raw break
 *  forms, or a block holding a line break (1.0 cuts blocks at blank lines only). Typing in a paragraph reads nothing. */
export function maybeOnBreak(editor: Editor, re: RegExp): boolean {
  const { doc, selection } = editor.state;
  const $p = selection.$from;
  const idx = $p.index(0);
  const near = [idx - 1, idx, idx + 1].filter((i) => i >= 0 && i < doc.childCount).map((i) => doc.child(i));
  return near.some((n) => n.type.name === 'sceneBreak' || n.type.name === 'rawBlock' || re.test(n.textContent.trim()) || n.textContent.includes('\n'));
}

/** The caret 1.0's textarea would have for the editor's selection, for the scene bar: the editor's own (editorText),
 *  except on a selected scene break. A break is an atom: no text cursor stands inside "***" (positions.ts maps the
 *  places around it to the ends of the blocks beside it), so the writer stands on one by selecting it (a click, or
 *  the arrow keys onto it) — that is read as the caret at the break's end, inside its block as 1.0 counts it. */
export function sceneCaret(editor: Editor, cur: TextEdit): number {
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === 'sceneBreak') return posToTextOffset(toBook(editor.state.doc), sel.to);
  return cur.start;
}

/* ---- the scene picker's handlers (1.0's confirmSceneImage, detachSceneImage, removeSceneAtCursor) ---- */

/** 1.0's confirmSceneImage, after its checks: the break's entry replaced, the list in break order. */
export function scenesWith(scenes: unknown, entry: SceneEntry): SceneEntry[] {
  const list = (Array.isArray(scenes) ? (scenes as SceneEntry[]) : []).filter((e) => e.at !== entry.at);
  list.push(entry);
  list.sort((a, b) => a.at - b.at);
  return list;
}
/** 1.0's detachSceneImage / removeSceneAtCursor: the break's entry taken out (null: there was none, nothing to write). */
export function scenesWithout(c: ClosureApi, section: Rec, at: number): SceneEntry[] | null {
  if (!Array.isArray(section.scenes) || !c.sceneEntryAt(section, at)) return null;
  return (section.scenes as SceneEntry[]).filter((e) => e.at !== at);
}
/** 1.0's confirmSceneImage's entry from the picker's fields (null alt: refused, 1.0's scene.altNeeded). */
export function sceneEntry(c: ClosureApi, at: number, imageId: string, f: { name: string; alt: string; caption: string }): SceneEntry | null {
  const alt = c.cleanAlt(f.alt);
  if (!alt) return null;
  return { at, imageId, name: f.name.trim(), caption: f.caption.trim(), alt };
}
/** The alt text 1.0 offers when a picture is chosen and the alt field is empty: Insert Image's placeholder
 *  (selectLibImage: "-" and "_"), the scene picker's value (sceneSelectImage: also "—", and the stock photo's own
 *  description first). */
export const libAltOffer = (name: unknown): string => String(name || '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
export const sceneAltOffer = (c: ClosureApi, name: unknown, hint?: unknown): string =>
  c.cleanAlt(hint) || c.cleanAlt(String(name || '').replace(/\.[^.]+$/, '').replace(/[-_—]+/g, ' '));

/* ---- the section card (1.0's rewriteImageToken / updateImageToken / removeImageToken) ---- */

/** 1.0's rewriteImageToken on a section's text: the idx-th marker line rewritten by fn, runs of 3+ line breaks to 2. */
export function rewriteToken(c: ClosureApi, content: string, idx: number, fn: (t: ReturnType<ClosureApi['parseImageLine']> & object) => string): string {
  const lines = String(content || '').split('\n');
  let seen = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = c.parseImageLine(lines[i]);
    if (!t) continue;
    seen++;
    if (seen === idx) {
      lines[i] = fn(t);
      break;
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
/** 1.0's updateImageToken. */
export const updateToken = (c: ClosureApi, content: string, idx: number, patch: Rec): string =>
  rewriteToken(c, content, idx, (t) => c.imageTokenText(Object.assign({}, t, patch)));
/** 1.0's removeImageToken: the line out, then the text trimmed. */
export const removeToken = (c: ClosureApi, content: string, idx: number): string => rewriteToken(c, content, idx, () => '').replace(/\n{3,}/g, '\n\n').trim();
/** 1.0's section card toast after a removal (an English literal there). */
export const TOKEN_REMOVED = 'Image removed from this section — it stays in the book’s library';

/** A whole-text change from below the editor (1.0: written "through the view guard", withEditorView(…, true)): the
 *  caret keeps its offsets, clamped to the new text. */
export function keepCaret(cur: TextEdit, text: string): TextEdit {
  const clamp = (o: number) => Math.max(0, Math.min(text.length, o));
  return { text, start: clamp(cur.start), end: clamp(cur.end) };
}

/* ---- Insert Image (1.0's #btnDoInsertImage handler) ---- */

/** 1.0's text for a placed picture, written at the cursor with insertAtCursor. */
export function imageInsertText(c: ClosureApi, im: { id: string; name?: unknown }, f: { alt: string; caption: string; full: boolean }): string {
  const alt = c.cleanAlt(f.alt) || c.cleanAlt(String(im.name || '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')) || 'Image';
  const caption = c.cleanCaption(f.caption);
  return '\n\n' + c.imageTokenText({ alt, id: im.id, full: f.full, caption }) + '\n\n';
}
/** 1.0's literals around Insert Image (no keys in 1.0). */
export const IMG_AUTO_REFUSED = 'This section is generated automatically — pick a chapter or a written section to place an image';
export const IMG_PICK_FIRST = 'Pick or upload an image first';
export const IMG_PLACED = 'Image placed';
export const IMG_PLACED_FULL = 'Full-bleed image placed';

/* ---- Suggest by name (1.0's sceneRenderSuggestResults' verdicts, scenePickStock's order) ---- */

export type SuggestVerdict = { kind: 'retry' | 'not-configured' | 'empty' | 'ok'; status: string; photos: StockPhoto[] };
/** 1.0's sceneRenderSuggestResults, less its DOM: the verdict, the status line's key, the photos to show. */
export function suggestVerdict(res: unknown): { kind: SuggestVerdict['kind']; statusKey: string | null; photos: StockPhoto[] } {
  const r = res as Rec | null;
  if (!r) return { kind: 'retry', statusKey: 'covermk.photoRetry', photos: [] };
  if (r.__status === 501) return { kind: 'not-configured', statusKey: 'covermk.photoNotConfigured', photos: [] };
  if (r.__error) return { kind: 'retry', statusKey: 'covermk.photoRetry', photos: [] };
  const photos = Array.isArray(r.photos) ? (r.photos as StockPhoto[]) : [];
  if (!photos.length) return { kind: 'empty', statusKey: 'covermk.photoNone', photos: [] };
  return { kind: 'ok', statusKey: null, photos };
}
/** 1.0's scenePickStock order: full size first, then the smaller renditions, each once. */
export function stockUrls(ph: StockPhoto): string[] {
  const urls: string[] = [];
  [ph.src && ph.src.original, ph.src && ph.src.large, ph.src && ph.src.medium].forEach((u) => {
    if (u && !urls.includes(u)) urls.push(u);
  });
  return urls;
}
/** 1.0's sceneStockLanded picture (its id from the caller's uid()). */
export function stockPicture(id: string, ph: StockPhoto, blobType: string, data: string): Rec {
  const isPng = (blobType || '').indexOf('png') >= 0;
  const provider = ph.provider || 'Pexels';
  return {
    id, name: provider + ' — ' + (ph.photographer || 'photo'),
    mediaType: blobType || 'image/jpeg', ext: isPng ? 'png' : 'jpg',
    data,
    credit: { name: ph.photographer || '', url: ph.pageUrl || ph.photographerUrl || '' },
  };
}
