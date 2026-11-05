import type { CloudClosure } from './cloud';

/* Step 5 wave 7b (inventory H5): the platform — 1.0's initPlatform's listener lines, one for one, around 1.0's own
   code in the shelf's module (pwa, renderInstallArea, showUpdateBar, wireUpdateFlow; the connectivity funnel is 7a's,
   in CloudHost.wire). initPlatform itself is not lifted (its markup is React's and 1.0's worker is not 2.0's):

   - Install: the browser's prompt is kept (beforeinstallprompt, never a banner) for 1.0's quiet Install button in
     Project Settings' About area; appinstalled and an accepted prompt say "installed" there.
   - The worker is 2.0's own (public/sw.js, scope /next/, registered by src/sw-register.ts; it never caches /api/ and never
     touches 1.0's scope). 1.0's wireUpdateFlow shows 1.0's bar ("A new Beuk is ready" · Reload · Later) when a new
     worker waits; Reload asks it to take over (SKIP_WAITING) and the page reloads once it has; Later hides the bar.
   - 2.0 never reloads a page by itself (decision 4): 1.0 reloads every tab when the controller changes (after landing
     its device save); 2.0 reloads only the tab whose Reload was pressed. Another tab's update leaves this one as it is
     (its bar stays up if it was shown).
   - 1.0's BEUK:errors build stamp: the worker's BEUK_SHELL_READY names its cache, read by the error report (I9). */

type Rec = Record<string, unknown>;
type SwLike = Pick<ServiceWorkerContainer, 'addEventListener' | 'removeEventListener'> & { controller: unknown };
export type PlatformOpts = {
  /** The page's service worker container (null: none — 1.0's pwa.swState "unsupported"). */
  sw: SwLike | null;
  /** The /next/ worker's registration (src/sw-register.ts), or null when there is none. */
  registration: Promise<ServiceWorkerRegistration | null>;
  reload: () => void;
};


export function platformInit(cm: CloudClosure, o: PlatformOpts): () => void {
  const a = cm.api;
  const pwa = a.pwa as Rec & { installPrompt: { prompt: () => Promise<unknown>; userChoice: Promise<{ outcome?: string }> } | null };
  const off: (() => void)[] = [];
  const listen = (t: EventTarget, type: string, fn: (e: Event) => void) => {
    t.addEventListener(type, fn);
    off.push(() => t.removeEventListener(type, fn));
  };
  let asked = false;
  let alive = true;

  /* The service worker: mind the update (1.0's initPlatform; the registration is 2.0's own) */
  if (o.sw) {
    const sw = o.sw;
    listen(sw as unknown as EventTarget, 'message', (e) => {
      const d = (e as MessageEvent).data as Rec | null;
      if (d && d.type === 'BEUK_SHELL_READY' && typeof d.cache === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(d.cache)) cm.vars.beukErrBuild = d.cache;
    });
    listen(sw as unknown as EventTarget, 'controllerchange', () => {
      // 2.0: only the tab that asked for the update reloads (1.0 reloads every tab, after its device save)
      if (!asked || pwa.reloading) return;
      pwa.reloading = true;
      o.reload();
    });
    void o.registration.then((reg) => {
      if (!alive) return;
      if (!reg) {
        pwa.swState = 'unavailable';
        return;
      }
      pwa.swState = 'registered';
      a.wireUpdateFlow(reg);
      const ctl = sw.controller as { postMessage?: (m: unknown) => void } | null;
      if (ctl && typeof ctl.postMessage === 'function') {
        try {
          ctl.postMessage({ type: 'BEUK_PING' });
        } catch {
          /* 1.0: nothing to learn */
        }
      }
    });
  } else pwa.swState = 'unsupported';

  /* Install: the browser's prompt, when it offers one, kept for the quiet button — never a banner, never a nag */
  listen(window, 'beforeinstallprompt', (e) => {
    e.preventDefault();
    pwa.installPrompt = e as never;
    a.renderInstallArea();
  });
  listen(window, 'appinstalled', () => {
    pwa.installed = true;
    pwa.installPrompt = null;
    a.renderInstallArea();
  });
  // (#btnInstall lives in Project Settings, which React mounts when it opens: the click is taken where it lands)
  listen(document, 'click', (e) => {
    const t = e.target as Element | null;
    const id = t && t.closest ? t.closest('#btnInstall, #btnUpdateReload, #btnUpdateLater')?.id : null;
    if (id === 'btnInstall') void install();
    else if (id === 'btnUpdateReload') {
      const w = pwa.updateWaiting as { postMessage: (m: unknown) => void } | null;
      asked = true;
      if (w) {
        try {
          w.postMessage({ type: 'SKIP_WAITING' });
        } catch {
          o.reload();
        }
      } else o.reload();
    } else if (id === 'btnUpdateLater') {
      pwa.updateDismissed = true;
      const bar = document.getElementById('updateBar');
      if (bar) bar.hidden = true;
    }
  });
  async function install(): Promise<void> {
    if (!pwa.installPrompt) return;
    const promptEvent = pwa.installPrompt;
    pwa.installPrompt = null;
    a.renderInstallArea();
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice && choice.outcome === 'accepted') {
        pwa.installed = true;
        a.renderInstallArea();
      }
    } catch {
      /* 1.0: the prompt went away */
    }
  }
  /* BEUK:errors — 1.0's two window listeners: an error the page raises, and a promise nobody caught; 1.0's own
     beukReportError decides (opt-in, scrubbed, once each, at most five) */
  listen(window, 'error', (ev) => {
    const e = ev as ErrorEvent;
    // a picture or script that failed to load (1.0: a target that is not the window; here: an element — the same
    // events in a browser, and jsdom's window is not the global's)
    if (!e || (typeof Element !== 'undefined' && e.target instanceof Element)) return;

    const err = e.error as { message?: string; stack?: string } | null;
    a.beukReportError('error', (err && err.message) || e.message, (err && err.stack) || (e.filename || '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0));
  });
  listen(window, 'unhandledrejection', (ev) => {
    const r = (ev as PromiseRejectionEvent).reason as { message?: string; stack?: string } | string | null;
    a.beukReportError('rejection', (r && typeof r === 'object' && r.message) || (typeof r === 'string' ? r : 'unhandled rejection'), (r && typeof r === 'object' && r.stack) || '');
  });
  a.renderInstallArea();
  return () => {
    alive = false;
    off.forEach((f) => f());
  };
}
