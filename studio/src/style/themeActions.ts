import type { CustomTheme } from '../closure/index';
import { styleEnter, styleRun, styleState } from './session';

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
