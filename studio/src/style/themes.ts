import type { Closure, CustomTheme } from '../closure/index';
import { styleEnter, styleRun, styleState } from './session';

/* Step 5 wave 4a (D2): the writer's own themes — the ONE module every read and write of them goes through
   (constraint 33), so a later per-user store (V's queued feature) can stand behind it without touching the UI.

   Today they live where 1.0 keeps them: per book, in `customThemes` (1.0's state.customThemes, normalised by its own
   normalizeCustomTheme on arrival and on save). The Style tab's session (session.ts) reads them through readThemes
   when it builds 1.0's state of the book, and 1.0's own code edits that list (its creator's Save, My themes'
   Duplicate and Delete); the session writes the list back as serializeBook writes it. The functions below are the
   entry points for anything outside 1.0's own buttons (the tests, the e2e seam, a later per-user store), and each runs
   1.0's own handler in a session. Nothing per-user exists in 4a. */

/** The book's themes as applyBookDoc holds them (1.0's normalizeCustomTheme, the invalid ones left out). */
export function readThemes(c: Closure, stored: unknown): CustomTheme[] {
  return Array.isArray(stored) ? (stored.map((ct) => c.api.normalizeCustomTheme(ct)).filter(Boolean) as CustomTheme[]) : [];
}

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
