/* The reading desk under the reader folds away (V, 2026-11-27). 1.0's own code (client/index.html BEUK:deskfold:
   deskOpenWanted, setDeskOpen) keeps it; this is only the first paint, so the pane never draws the desk open on a phone
   and then folds it. studio/test/preview-desk-fold.test.tsx holds the two to each other. */
export const DESK_FOLD_KEY = 'beuk.previewDesk.v1';
/** 1.0's phone layout breakpoint (#mobileTabs; tour.ts PHONE is the same number). */
const PHONE = 1023;

/** Open when remembered open; folded when remembered folded; else open on a wide window and folded on the phone layout. */
export function deskOpenFirst(): boolean {
  try {
    const v = localStorage.getItem(DESK_FOLD_KEY);
    if (v === 'open') return true;
    if (v === 'closed') return false;
  } catch {
    /* no storage */
  }
  return window.innerWidth > PHONE;
}
