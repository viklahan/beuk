import { useSyncExternalStore } from 'react';
import { cloudFacts } from '../closure/index';

/* Who gets the page-by-page views of the whole book in Export (V, 2026-11-24; the table he approved):

     billing off, signed in        the page-by-page views
     in the trial                  the page-by-page views
     subscribed, or payment grace  the page-by-page views
     trial ended, not paying       the views as they were
     signed out                    the views as they were

   The server is the judge (src/access.ts): while an account is paused, GET /api/auth/me lists every pausable feature
   in `access.locked`, and 'proof.pages' is one of them. The studio only mirrors that answer. 1.0's lockAccessNote
   (client/index.html), the one place every /api/auth/me answer the studio takes passes through (the shelf's boot, a
   sign-in in this tab, an account change heard from another tab, a sign-out), writes the list beside the state it
   already kept on <html>: data-plan-locked holds the keys, space-separated; it is empty while nothing is locked and
   absent while no answer for a signed-in account is held. No second request is made for this.

   The rule: signed in, AND an answer is held, AND it does not list 'proof.pages'. Signed out, no answer yet, an answer
   without the list: the views as they were. Nothing is said about plans near the buttons either way:
   an account that does not have the page-by-page views simply gets the others. (V asked, 2026-11-24, "do we have to
   say it comes with a paid plan?"; the building session answered no and left it out. Not a ruling of his; his to
   overturn.)

   A soft lock, said plainly: both views are drawn in this browser from the book already on the desk, so there is
   nothing for the server to refuse. This decides what the studio offers; it is not a control someone determined
   could not get around. */

/** The server's key (src/access.ts PAUSABLE_FEATURES). */
export const PROOF_PAGES = 'proof.pages';
/** Where 1.0's lockAccessNote keeps the server's `locked` list. */
export const LOCKED_ATTR = 'data-plan-locked';

/** The rule, as data in and a yes or no out. `locked` is null while no answer is held. */
export function entitled(feature: string, signedIn: boolean, locked: readonly string[] | null): boolean {
  return signedIn && locked !== null && !locked.includes(feature);
}

/** The `locked` list the studio holds now; null while it holds no answer. */
export function lockedHeld(): string[] | null {
  if (typeof document === 'undefined') return null;
  const v = document.documentElement.getAttribute(LOCKED_ATTR);
  return v === null ? null : v.split(/\s+/).filter(Boolean);
}

/** Whether this account gets the page-by-page views, as things stand now. */
export function proofPagesNow(): boolean {
  return entitled(PROOF_PAGES, !!cloudFacts.user, lockedHeld());
}

function subscribe(changed: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => undefined;
  const mo = new MutationObserver(changed);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: [LOCKED_ATTR] });
  return () => mo.disconnect();
}

/** proofPagesNow, followed: a sign-in, a sign-out or another account's answer changes it without a reload. (The
 *  attribute is written after the account is set and taken away as it is cleared, so following it follows both.) */
export function useProofPages(): boolean {
  return useSyncExternalStore(subscribe, proofPagesNow, () => false);
}
