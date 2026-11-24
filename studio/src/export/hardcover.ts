import { previewEnv } from '../closure/index';
import { previewStarted, pvRun } from '../preview/preview';

/* The printed book as an open hardcover, full screen (V, 2026-11-24): the proof's second button, for an account that
   has the page-by-page views (src/export/entitled.ts). Nothing of the hardcover is made here. It is 1.0's own Hardcover
   view in the preview pane (BEUK:hcpreview, lifted whole: src/preview/preview.ts), driven by its own controls:

   - #hcFull, 1.0's full-screen button (fsToggle on #previewStage): pressed first, inside the writer's own click, because
     a browser grants full screen only to a fresh press. Where the browser has no element full screen, or refuses,
     1.0 fills the window instead (.fs-immersive) and its button says so.
   - the device bar's "Hardcover" button (1.0's setDevice), unless the preview is on it already;
   - 1.0's hcSetOpen(true, instant) and hcTurn back to the first spread, so the book is open at its start whatever
     chapter is on the desk (1.0 opens it at the chapter being edited; here the writer came to see the whole book).

   When the reader leaves full screen (Escape, F, 1.0's button), the preview gets back the device it had and the export
   screen is opened again with focus on the button (onBack: ExportModal's backFromPrint, as for the Print Interior View).

   The view needs the preview pane on screen. The shell always mounts the pane, but it is not shown while the right
   column is folded away, on a narrow screen while another tab is up, or in Zen; and 1.0's preview code may not have
   started yet. hardcoverUsable() says which; where it says no, the button keeps its old words and opens the Print
   Interior View, as before. */

/** What this file asks of the page, as a seam (jsdom lays nothing out, so a test says what is shown). */
export const hardcoverEnv = {
  /** Whether `el` is on screen: 1.0's own test for the preview stage (fsKeyTarget). */
  shown: (el: HTMLElement): boolean => el.getClientRects().length > 0 && el.offsetWidth > 0,
};

const stage = (): HTMLElement | null => document.getElementById('previewStage');
const deviceButton = (device: string): HTMLElement | null =>
  Array.from(document.querySelectorAll<HTMLElement>('#deviceBar [data-device]')).find((b) => b.getAttribute('data-device') === device) ?? null;

/** Whether 1.0's Hardcover view can be opened full screen from here, now. */
export function hardcoverUsable(): boolean {
  if (typeof document === 'undefined' || !previewStarted()) return false;
  const s = stage();
  return !!s && !!deviceButton('hardcover') && !!document.getElementById('hcFull') && hardcoverEnv.shown(s);
}

/** Whether the preview stage is full screen, or fills the window in its place (1.0's two ways). */
function fullNow(s: HTMLElement): boolean {
  const d = document as Document & { webkitFullscreenElement?: Element | null };
  return (d.fullscreenElement ?? d.webkitFullscreenElement ?? null) === s || s.classList.contains('fs-immersive');
}

/** Open 1.0's Hardcover view full screen, the book open at its first spread; `closeExport` closes the export screen
 *  first, `onBack` runs once the reader has left full screen. Returns what ends the watch, or null when the view cannot
 *  be used (nothing was touched: the caller opens the Print Interior View instead). Everything up to the full-screen
 *  request runs inside the caller's click. */
export function openHardcover(closeExport: () => void, onBack: () => void): (() => void) | null {
  if (!hardcoverUsable()) return null;
  const s = stage()!;
  const was = previewEnv.device();
  closeExport();
  if (!fullNow(s)) document.getElementById('hcFull')!.click();
  if (was !== 'hardcover') deviceButton('hardcover')!.click();
  pvRun((pc) => {
    pc.api.hcSetOpen!(true, true);
    pc.api.hcTurn!(-1e9, true);
  });

  let seen = fullNow(s);
  const off: (() => void)[] = [];
  const stop = () => off.splice(0).forEach((f) => f());
  const check = () => {
    if (fullNow(s)) {
      seen = true;
      return;
    }
    if (!seen) return; // the browser has not answered the request yet
    stop();
    // the device the preview had, by 1.0's own device bar (the writer may have changed it meanwhile: then it stays)
    if (was !== 'hardcover' && previewEnv.device() === 'hardcover') deviceButton(was)?.click();
    onBack();
  };
  for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
    document.addEventListener(type, check);
    off.push(() => document.removeEventListener(type, check));
  }
  if (typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(check);
    mo.observe(s, { attributes: true, attributeFilter: ['class'] });
    off.push(() => mo.disconnect());
    // the export screen opened again some other way before full screen was ever seen: the writer went on
    const screen = document.getElementById('modalExport');
    if (screen) {
      const so = new MutationObserver(() => {
        if (!seen && screen.classList.contains('open')) stop();
      });
      so.observe(screen, { attributes: true, attributeFilter: ['class'] });
      off.push(() => so.disconnect());
    }
  }
  return stop;
}
