import type * as Y from 'yjs';
import type { Closure, CustomTheme } from '../closure/index';
import { setMeta } from '../book/hooks';
import { placeKey } from '../notebook/notebook';

/* Step 5 wave 4a (D2): the writer's own themes — where they are read, normalised and written (constraint 33). It sits
   BELOW the Style session (session.ts calls it; it knows nothing of the session), so a later per-user store (V's
   queued feature) can stand behind these three functions without touching the session or the UI.

   Today the themes live where 1.0 keeps them: per book, in `customThemes` (1.0's state.customThemes), read with 1.0's
   own normalizeCustomTheme as applyBookDoc reads them, and written as serializeBook writes them. 1.0's own buttons
   (the creator's Save, My themes' Duplicate and Delete) edit the list in the session's state; the session writes it
   back through writeThemes. The entry points for anything outside 1.0's own buttons are in themeActions.ts. Nothing
   per-user exists in 4a. */

/** The book's themes as applyBookDoc holds them (1.0's normalizeCustomTheme, the invalid ones left out). */
export function readThemes(c: Closure, stored: unknown): CustomTheme[] {
  return Array.isArray(stored) ? (stored.map((ct) => c.api.normalizeCustomTheme(ct)).filter(Boolean) as CustomTheme[]) : [];
}

/** The themes as serializeBook writes them (normalised again, a deep copy). */
export function serializeThemes(c: Closure, list: unknown): CustomTheme[] {
  return JSON.parse(JSON.stringify(readThemes(c, list))) as CustomTheme[];
}

/** Write the book's themes (serializeThemes' form), in the caller's transaction, where serializeBook puts the key. */
export function writeThemes(ydoc: Y.Doc, value: unknown): void {
  placeKey(ydoc, 'customThemes');
  setMeta(ydoc, 'customThemes', value as never);
}
