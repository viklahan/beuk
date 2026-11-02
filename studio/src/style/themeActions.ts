import { getMetaValue, shaOfData } from '@book/editor/index.js';
import type { CustomTheme } from '../closure/index';
import { desk } from '../environment/page';
import { B64, styleEnter, styleRun, styleState, themeSafe } from './session';
import { MINE_KEY, MINE_NAME_MAX, mineBytes, mineGet, mineList, mineSave, type Bytes, type MineAsset, type MineDoc } from './mine';

/* Step 5 wave 4a (D2): the entry points to the writer's own themes for anything outside 1.0's own buttons (the
   tests, the e2e seam, a later per-user store's UI). Each runs 1.0's own handler in a Style session; where the list is
   read and written is themes.ts (constraint 33). They need the tab's DOM, as 1.0's handlers do. */

/** The open book's themes, in its order. */
export function listThemes(): CustomTheme[] {
  if (!styleEnter()) return [];
  const st = styleState() as { customThemes?: CustomTheme[] } | null;
  return st && Array.isArray(st.customThemes) ? st.customThemes.map((ct) => JSON.parse(JSON.stringify(ct)) as CustomTheme) : [];
}

/** 1.0's applyCustomTheme: the book wears that theme (activePreset "custom:<id>"). */
export function applyTheme(id: string): boolean {
  return styleRun((c) => {
    const had = (c.getState() as { activePreset?: unknown }).activePreset;
    c.api.applyCustomTheme(id);
    return (c.getState() as { activePreset?: unknown }).activePreset === 'custom:' + id || had === 'custom:' + id;
  }) ?? false;
}

/** 1.0's duplicateCustomTheme: a copy right after it, named with 1.0's suffix. The new theme's id, or null. */
export function duplicateTheme(id: string): string | null {
  return styleRun((c) => {
    const before = new Set(((c.getState() as { customThemes?: CustomTheme[] }).customThemes ?? []).map((x) => x.id));
    c.api.duplicateCustomTheme(id);
    const made = ((c.getState() as { customThemes?: CustomTheme[] }).customThemes ?? []).find((x) => !before.has(x.id));
    return made ? made.id : null;
  }) ?? null;
}

/** 1.0's deleteCustomTheme: the saved theme goes; the book keeps the styling it wears. */
export function deleteTheme(id: string): boolean {
  return styleRun((c) => {
    const n = ((c.getState() as { customThemes?: CustomTheme[] }).customThemes ?? []).length;
    c.api.deleteCustomTheme(id);
    return ((c.getState() as { customThemes?: CustomTheme[] }).customThemes ?? []).length < n;
  }) ?? false;
}

/** 1.0's creator: open it on a saved theme (or, with null, on the theme the book wears now). */
export function openCreator(id: string | null): void {
  styleRun((c) => c.api.openThemeCreator(id));
}

/** 1.0's saveThemeCreator: the creator's draft saved (a new theme, or the one it was opened on) and worn. The saved
 *  theme's id, or null when no creator is open. */
export function saveTheme(): string | null {
  return styleRun((c) => {
    if (!c.vars.tcDraft) return null;
    c.api.saveThemeCreator();
    return c.vars.tcDraft ? c.vars.tcDraft.id : null;
  }) ?? null;
}

/* ---- per-user themes (My themes, plan 2026-11-02): between a book and the store (mine.ts) ----
   Saving takes one of the book's themes and what it wears; applying puts a My theme into the open book exactly as 1.0
   would hold it had the theme been made there (the theme into customThemes, its fonts into `fonts`, its flourishes
   into the image library — 1.0's shapes; the session writes them and 2.0's packing stores the bytes once), then 1.0's
   own applyCustomTheme wears it. A My theme is untrusted (constraint 48): its doc passed mine.ts's checks, its bytes
   are checked as 1.0's uploads check them, and its theme passes the session's themeSafe before 1.0's code sees it. */

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const FONT_EXT_MEDIA: Record<string, string> = { ttf: 'font/ttf', otf: 'font/otf' };

/** The book's theme `id` as a My theme: its doc (the theme, and the uploaded fonts and flourishes it wears — resolved
 *  as 1.0's usedUploadedFonts and themeFlourishImages resolve the book's own) and those assets' bytes. Writes nothing. */
export function mineDocFromBook(id: string): { doc: MineDoc; bytes: Map<string, Bytes> } | null {
  const c = styleEnter();
  if (!c) return null;
  const st = c.getState() as unknown as Rec & { customThemes?: CustomTheme[] };
  const ct = (st.customThemes ?? []).find((x) => x && x.id === id);
  if (!ct) return null;
  const th = JSON.parse(JSON.stringify(ct.theme)) as Rec;
  const assets: MineAsset[] = [];
  const bytes = new Map<string, Bytes>();
  const add = (a: MineAsset, data: string) => {
    if (!a.sha256 || assets.some((x) => x.kind === a.kind && x.sha256 === a.sha256 && x.id === a.id)) return;
    assets.push(a);
    bytes.set(a.sha256, { mediaType: a.mediaType, data });
  };
  const header = isRec(th.header) ? th.header : null;
  const fams = [th.bodyFont, th.headFont, ...(header ? c.api.HD_KEYS.map((k) => (isRec(header[k]) ? (header[k] as Rec).font : null)) : [])];
  for (const fam of fams) {
    const f = c.api.uploadedFontByFamily(fam);
    if (!f || typeof f.data !== 'string') continue;
    const mediaType = FONT_EXT_MEDIA[f.ext];
    if (!mediaType) continue;
    add({ kind: 'font', sha256: shaOfData(f.data), mediaType, id: f.id, name: f.name, family: f.family, ext: f.ext }, f.data);
  }
  const flourishes = [c.api.flourishOf(th.ornament), typeof th.headingFlourish === 'string' && th.headingFlourish ? c.api.imageById(th.headingFlourish) : null];
  for (const im of flourishes) {
    if (!im || !c.api.isFlourishImage(im) || typeof im.data !== 'string') continue;
    if (im.mediaType !== 'image/svg+xml' && im.mediaType !== 'image/png') continue;
    add({ kind: 'flourish', sha256: shaOfData(im.data), mediaType: im.mediaType, id: im.id, name: im.name, ext: im.ext ?? (im.mediaType === 'image/png' ? 'png' : 'svg'), flourish: true }, im.data);
  }
  const key = MINE_KEY.test(ct.id) ? ct.id : c.api.uid();
  return { doc: { id: key, name: (ct.name || '').slice(0, MINE_NAME_MAX), theme: th, assets }, bytes };
}

/** Keep the book's theme `id` in My themes (with what it wears). */
export async function saveToMine(id: string): Promise<boolean> {
  const made = mineDocFromBook(id);
  return made ? mineSave(made.doc, made.bytes) : false;
}

/** The theme creator's "Keep for every book": 1.0's Save (the theme saved into the book and worn), then kept. */
export async function saveCreatorToMine(): Promise<boolean> {
  const id = saveTheme();
  return id ? saveToMine(id) : false;
}

/** The book's themes My themes does not hold (by key): the one-time offer's list. */
export function bookThemesNotInMine(): CustomTheme[] {
  const mine = new Set(mineList().map((r) => r.key));
  return listThemes().filter((ct) => !mine.has(ct.id));
}

/** The bytes as 1.0's uploads accept them (handleFontFile's and handleFlourishFile's checks): a TrueType or OpenType
 *  font's magic, an SVG with an <svg> and no <script>, a PNG's signature. */
function bytesAccepted(a: MineAsset, data: string): boolean {
  if (!B64.test(data)) return false;
  let head = '';
  try {
    head = atob(data.slice(0, 12).replace(/\s/g, ''));
  } catch {
    return false;
  }
  if (a.kind === 'font') {
    if (a.ext === 'otf') return head.indexOf('OTTO') === 0;
    return head.length >= 4 && ((head.charCodeAt(0) === 0 && head.charCodeAt(1) === 1 && head.charCodeAt(2) === 0 && head.charCodeAt(3) === 0) || head.indexOf('true') === 0);
  }
  if (a.mediaType === 'image/png') return data.indexOf('iVBORw0KGgo') === 0;
  let text = '';
  try {
    text = atob(data.replace(/\s/g, ''));
  } catch {
    return false;
  }
  return /<svg[\s>]/.test(text) && !/<script/i.test(text);
}

/** Apply the My theme `key` to the open book: copied in (an asset the book already holds — same bytes — reused, not
 *  duplicated), then worn through 1.0's applyCustomTheme. False when there is no such theme or no book. An asset whose
 *  bytes are missing everywhere, or are not what 1.0's upload would accept, is left out (the theme falls back as 1.0's
 *  does when a face or a flourish leaves the book). */
export async function applyMine(key: string): Promise<boolean> {
  const r = mineGet(key);
  if (!r) return false;
  const got = new Map<string, Bytes>();
  for (const a of r.doc.assets) {
    const b = await mineBytes(a.sha256);
    if (b && b.mediaType === a.mediaType && bytesAccepted(a, b.data)) got.set(a.sha256, b);
  }
  const ydoc = desk.ydoc;
  // the book's own image ids (a picture the session hides from 1.0's code keeps its stored id there)
  const stored = ydoc ? getMetaValue(ydoc, 'images') : undefined;
  const bookIds = new Set(Array.isArray(stored) ? stored.filter(isRec).map((im) => String(im.id)) : []);
  return (
    styleRun((c) => {
      const st = c.getState() as unknown as Rec & { fonts: Rec[]; images: Rec[]; customThemes: CustomTheme[] };
      if (!Array.isArray(st.fonts)) st.fonts = [];
      if (!Array.isArray(st.images)) st.images = [];
      if (!Array.isArray(st.customThemes)) st.customThemes = [];
      const fam = new Map<string, string>();
      const fontIds = new Set(st.fonts.filter(isRec).map((f) => String(f.id)));
      for (const a of r.doc.assets) {
        if (a.kind !== 'font' || !a.family || !a.ext) continue;
        const b = got.get(a.sha256);
        if (!b) continue;
        const same = st.fonts.find((f) => isRec(f) && typeof f.family === 'string' && f.family && typeof f.data === 'string' && shaOfData(f.data) === a.sha256);
        if (same) {
          fam.set(a.family, String(same.family));
          continue;
        }
        const mediaType = FONT_EXT_MEDIA[a.ext]!;
        const byFam = c.api.uploadedFontByFamily(a.family) as unknown as Rec | null;
        if (byFam) {
          // 1.0's handleFontFile: a face of the same family takes the new bytes
          byFam.data = b.data;
          byFam.ext = a.ext;
          byFam.mediaType = mediaType;
          if (a.name) byFam.name = a.name;
          delete c.api.registeredFontIds[String(byFam.id)];
        } else {
          let id = a.id && !fontIds.has(a.id) ? a.id : c.api.uid();
          while (fontIds.has(id)) id = c.api.uid();
          fontIds.add(id);
          st.fonts.push({ id, name: a.name || a.family + '.' + a.ext, family: a.family, ext: a.ext, mediaType, data: b.data });
        }
        fam.set(a.family, a.family);
      }
      const ids = new Map<string, string>();
      const imageIds = new Set([...bookIds, ...st.images.filter(isRec).map((im) => String(im.id))]);
      for (const a of r.doc.assets) {
        if (a.kind !== 'flourish' || !a.id || !a.ext) continue;
        const b = got.get(a.sha256);
        if (!b) continue;
        const same = st.images.find((im) => isRec(im) && c.api.isFlourishImage(im) && typeof im.data === 'string' && shaOfData(im.data) === a.sha256);
        if (same) {
          ids.set(a.id, String(same.id));
          continue;
        }
        let id = !imageIds.has(a.id) ? a.id : c.api.uid();
        while (imageIds.has(id)) id = c.api.uid();
        imageIds.add(id);
        // 1.0's handleFlourishFile shape
        st.images.push({ id, name: a.name || 'flourish.' + a.ext, mediaType: a.mediaType, ext: a.ext, data: b.data, flourish: true });
        ids.set(a.id, id);
      }
      const th = JSON.parse(JSON.stringify(r.doc.theme)) as Rec;
      for (const k of ['bodyFont', 'headFont']) if (typeof th[k] === 'string' && fam.has(th[k] as string)) th[k] = fam.get(th[k] as string);
      if (isRec(th.header))
        for (const k of c.api.HD_KEYS) {
          const e = (th.header as Rec)[k];
          if (isRec(e) && typeof e.font === 'string' && fam.has(e.font)) e.font = fam.get(e.font);
        }
      const P = c.api.FLOURISH_PREFIX;
      // a flourish the theme names but did not bring (refused or missing bytes) never points at another picture of the
      // book's that happens to share its id: 1.0's fallbacks when a flourish leaves (the fleuron, no heading flourish)
      if (typeof th.ornament === 'string' && th.ornament.indexOf(P) === 0) {
        const to = ids.get(th.ornament.slice(P.length));
        th.ornament = to ? P + to : 'fleuron';
      }
      if (typeof th.headingFlourish === 'string' && th.headingFlourish) th.headingFlourish = ids.get(th.headingFlourish) ?? '';
      const ct = c.api.normalizeCustomTheme({ id: r.doc.id, name: r.doc.name, theme: th });
      if (!ct) return false;
      const shown = new Set(st.fonts.filter((f) => isRec(f) && typeof f.family === 'string' && f.family).map((f) => String(f.family).trim()));
      themeSafe(c, ct.theme, shown);
      // review (Important 4): the book's own copy of that theme, edited since, is never overwritten — the kept theme
      // joins under a new id (or the book's identical copy is the one worn)
      const same = (x: CustomTheme) => x.name === ct.name && JSON.stringify(x.theme) === JSON.stringify(ct.theme);
      const at = st.customThemes.findIndex((x) => x && x.id === ct.id);
      if (at >= 0 && !same(st.customThemes[at]!)) {
        const twin = st.customThemes.find((x) => x && same(x));
        if (twin) ct.id = twin.id;
        else {
          const taken = new Set(st.customThemes.map((x) => x && x.id));
          let id = c.api.uid();
          while (taken.has(id)) id = c.api.uid();
          ct.id = id;
        }
      }
      const at2 = st.customThemes.findIndex((x) => x && x.id === ct.id);
      if (at2 >= 0) st.customThemes[at2] = ct;
      else st.customThemes.push(ct);
      c.vars.fontPickerSig = null;
      c.api.registerAllFonts();
      c.api.applyCustomTheme(ct.id);
      return (c.getState() as unknown as { activePreset?: unknown }).activePreset === 'custom:' + ct.id;
    }) ?? false
  );
}
