import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBook } from '../book/BookProvider';
import { closureIfLoaded, cloudFacts, pageToast } from '../closure/index';
import { translateCover } from '../cover/CoverMaker';
import markup from '../generated/cloud-markup.json';
import '../generated/cloud.css';
import { useLocale } from '../i18n/LocaleProvider';
import { drawIcons } from '../insights/insights';
import { StackEntry, useConfirm } from '../shell/Dialog';
import { useToast } from '../shell/Toasts';
import { guardRoots } from '../style/session';
import { toastIcon } from '../style/StyleTab';
import { authAnnounce, bootCloud, cloudLang, cloudUi, deskChanged, loadCloud, type CloudClosure } from './cloud';
import { importWire } from '../import/import';
import { platformInit } from './platform';
import { swRegistration } from '../sw-register';

/* Step 5 wave 7a (H1-H4): 1.0's shelf in the studio — its markup, verbatim (client/index.html #modalAuth, #modalShelf,
   #btnAccount, #netPill, #syncRow; extracted at build time into src/generated/cloud-markup.json), wired as 1.0's
   initCloud, acctInit, portalInit, billingInit and initPlatform wire it (the listeners below, each one 1.0's line), and
   run by 1.0's own code (src/cloud/cloud.ts). React puts the markup in place once, gives it its words (1.0's data-i18n),
   and puts an open dialog on the dialog stack. Every HTML string 1.0 writes into the two dialogs goes through the Style
   session's cleaner (guardRoots). The calm confirm and the conflict notice are 2.0's already (Dialog.tsx useConfirm,
   CovenantDialog.tsx SeriesConflict, whose three buttons are 1.0's resolveConflict now). */

/** The three slots Shell puts in 1.0's places: the account button (top bar), the offline pill, the shelf line. */
export const CLOUD_SLOTS = {
  account: 'cloudAccountSlot',
  net: 'cloudNetSlot',
  sync: 'cloudSyncSlot',
  // wave 7b: bulk import's hint under the Import button (G3), the update bar under the header (H5)
  bulkHint: 'cloudBulkHintSlot',
  update: 'cloudUpdateSlot',
  // wave 7b: the sidebar's reader Comments button, after History (H7)
  beta: 'cloudBetaSlot',
} as const;
export function CloudSlot({ id }: { id: string }) {
  // React never renders children here: 1.0's code owns what is inside
  return <span id={id} style={{ display: 'contents' }} />;
}

const $ = (id: string) => document.getElementById(id);
function on(id: string, type: string, fn: (e: Event) => void, off: (() => void)[]): void {
  const el = $(id);
  if (!el) return;
  el.addEventListener(type, fn);
  off.push(() => el.removeEventListener(type, fn));
}

/** 1.0's listeners on its shelf markup (initCloud, acctInit, portalInit, billingInit; initPlatform's online / offline). */
function wire(cm: CloudClosure, off: (() => void)[]): void {
  const a = cm.api;
  // initCloud: the account button opens the shelf (signed in) or the sign-in dialog
  on('btnAccount', 'click', () => {
    if (cloudFacts.user) {
      a.renderShelfList();
      $('modalShelf')!.classList.add('open');
      drawIcons(document);
      void a.cloudLoadShelf();
    } else a.openAuth();
  }, off);
  on('btnCloseAuth', 'click', () => a.closeAuth(), off);
  on('modalAuth', 'click', (e) => {
    if (e.target === $('modalAuth')) a.closeAuth();
  }, off);
  on('authToggle', 'click', () => a.setAuthMode(cm.vars.authMode === 'login' ? 'register' : 'login'), off);
  // acctInit
  on('authForgot', 'click', () => {
    a.setAuthMode('forgot');
    setTimeout(() => $('authEmail')?.focus(), 30);
  }, off);
  on('btnAcctChange', 'click', () => void a.acctChangePassword(), off);
  on('btnAcctEverywhere', 'click', () => void Promise.resolve(a.acctSignOutEverywhere()).finally(authAnnounce), off);
  on('acctNew', 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void a.acctChangePassword();
  }, off);
  on('btnAccount', 'click', () => {
    a.acctSay('', false);
    const c = $('acctCurrent') as HTMLInputElement | null, n = $('acctNew') as HTMLInputElement | null;
    if (c) c.value = '';
    if (n) n.value = '';
    const box = $('acctBox') as HTMLDetailsElement | null;
    if (box) box.open = false;
  }, off);
  // portalInit
  on('btnPortalResend', 'click', () => void a.portalResend(), off);
  on('btnAccount', 'click', () => {
    if (cloudFacts.user) void a.portalRefresh();
  }, off);
  // initCloud, again
  // review I5: the other tabs hear of a sign-in or sign-out made here
  on('btnAuthSubmit', 'click', () => void Promise.resolve(a.cloudAuthSubmit()).finally(authAnnounce), off);
  for (const id of ['authEmail', 'authPassword'])
    on(id, 'keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void Promise.resolve(a.cloudAuthSubmit()).finally(authAnnounce);
    }, off);
  on('btnCloseShelf', 'click', () => {
    $('modalShelf')!.classList.remove('open');
    cloudUi.focusEditor();
  }, off);
  on('modalShelf', 'click', (e) => {
    if (e.target === $('modalShelf')) {
      $('modalShelf')!.classList.remove('open');
      cloudUi.focusEditor();
    }
  }, off);
  on('btnSignOut', 'click', () => void Promise.resolve(a.cloudSignOut()).finally(authAnnounce), off);
  on('btnBringBook', 'click', () => void a.cloudBringBook(), off);
  // billingInit
  on('btnPlanUpgrade', 'click', () => void a.billingGo('/api/billing/checkout', $('btnPlanUpgrade')), off);
  on('btnPlanManage', 'click', () => void a.billingGo('/api/billing/portal', $('btnPlanManage')), off);
  // betaInjectDom's line for the Comments button (wave 7b, H7): it opens 1.0's reader comments
  on('btnBetaComments', 'click', () => a.betaOpenComments(), off);

  // initBulk (wave 7b, G3): 1.0's three doors — the file picker, the folder picker, a drop on the shelf panel — feed 1.0's
  // startBulkImport (the main closure's, on the import wiring: each file made a book on a desk of its own)
  const bulk = (entries: unknown[]) => void importWire().then((c) => c.api.startBulkImport(entries)).catch(() => undefined);
  const toEntries = (files: FileList | null) => Array.prototype.slice.call(files || []).map((f: File) => ({ file: f, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name }));
  const fileInput = $('bulkFileInput') as HTMLInputElement | null, folderInput = $('bulkFolderInput') as HTMLInputElement | null;
  on('btnBulkFiles', 'click', () => fileInput?.click(), off);
  on('btnBulkFolder', 'click', () => folderInput?.click(), off);
  on('bulkFileInput', 'change', () => {
    bulk(toEntries(fileInput!.files));
    fileInput!.value = '';
  }, off);
  on('bulkFolderInput', 'change', () => {
    bulk(toEntries(folderInput!.files));
    folderInput!.value = '';
  }, off);
  const zone = () => $('bulkDropHint');
  for (const ev of ['dragenter', 'dragover'])
    on('modalShelf', ev, (e) => {
      e.preventDefault();
      if (zone() && cloudFacts.user) zone()!.classList.add('over');
    }, off);
  for (const ev of ['dragleave', 'drop'])
    on('modalShelf', ev, (e) => {
      e.preventDefault();
      zone()?.classList.remove('over');
    }, off);
  on('modalShelf', 'drop', (e) => {
    if (!cloudFacts.user || !cloudFacts.available) return;
    const dt = (e as DragEvent).dataTransfer;
    void importWire().then((c) => c.api.bulkCollectDrop(dt, (entries: unknown[]) => c.api.startBulkImport(entries))).catch(() => undefined);
  }, off);
  // initPlatform: the browser's word on the connection
  a.net.online = navigator.onLine !== false;
  const up = () => a.setConnectivity(true), down = () => a.setConnectivity(false);
  window.addEventListener('online', up);
  window.addEventListener('offline', down);
  off.push(() => {
    window.removeEventListener('online', up);
    window.removeEventListener('offline', down);
  });
  a.renderNetPill();
}

export function CloudHost() {
  const { lang } = useLocale();
  const bk = useBook();
  const confirm = useConfirm();
  const toast = useToast();
  pageToast.fn = (msg, icon) => toast(msg, toastIcon(icon));
  const live = useRef(bk);
  live.current = bk;
  const host = useRef<HTMLDivElement | null>(null);
  if (!host.current && typeof document !== 'undefined') {
    host.current = document.createElement('div');
    host.current.className = 'cloud-host';
  }
  cloudUi.ydoc = () => {
    const b = live.current.book;
    return b && live.current.isLive(b.ydoc) ? b.ydoc : null;
  };
  cloudUi.replace = async (doc, from) => {
    const b = await live.current.replaceWith(doc, from);
    return b ? b.ydoc : null;
  };
  cloudUi.confirm = (o) => confirm(o as never);
  // (wave 7b: and the parts 1.0's shelf code draws in the export modal and on <body>: the archive, the share section, the
  // EPUBCheck answer, the reader comments)
  cloudUi.iconRoots = () =>
    [host.current, ...[...Object.values(CLOUD_SLOTS), 'archiveSec', 'betaSec', 'modalBetaComments'].map((id) => document.getElementById(id))].filter((x): x is HTMLElement => !!x);

  cloudUi.localFailed = () => ['blocked', 'quota', 'error'].includes(live.current.local.status);
  cloudUi.focusEditor = () => {
    const h = document.getElementById('manuscript') as (HTMLElement & { beukEditor?: { commands: { focus: () => unknown } } }) | null;
    try {
      h?.beukEditor?.commands.focus();
    } catch {
      /* no editor */
    }
  };

  const started = bk.phase !== 'starting';
  const [open, setOpen] = useState<'auth' | 'shelf' | 'beta' | null>(null);
  const cm = useRef<CloudClosure | null>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el || !started) return;
    document.body.appendChild(el);
    let alive = true;
    const off: (() => void)[] = [];
    void loadCloud().then((c) => {
      if (!alive) return;
      cm.current = c;
      el.innerHTML = markup.auth + markup.shelf + markup.bulkInputs;
      const slot = (id: string, html: string) => {
        const s = document.getElementById(id);
        if (s) s.innerHTML = html;
        return s;
      };
      const slots = [slot(CLOUD_SLOTS.account, markup.account), slot(CLOUD_SLOTS.net, markup.netPill), slot(CLOUD_SLOTS.sync, markup.syncRow),
        slot(CLOUD_SLOTS.bulkHint, markup.bulkHint), slot(CLOUD_SLOTS.update, markup.updateBar),
        // wave 7b (H7): the sidebar's Comments button, the element 1.0's betaInjectDom makes after History (put in place
        // here, so React's tools row is never written into by 1.0's code; its listener is 1.0's line, in wire)
        slot(CLOUD_SLOTS.beta, '<button class="side-tool" id="btnBetaComments" type="button"></button>')];
      // 1.0's betaInjectDom: its styles, the reader comments dialog (on <body>), and the share section after the archive
      // when the export modal is in place (ExportModal calls it again whenever it builds the modal)
      c.api.betaInjectDom();
      const mc = closureIfLoaded();
      for (const r of [el, ...slots]) {
        if (!r) continue;
        drawIcons(r);
        if (mc) translateCover(mc, r);
      }
      for (const id of ['modalAuth', 'modalShelf', 'modalBetaComments']) {
        const m = document.getElementById(id)!;
        guardRoots.add(m);
        off.push(() => guardRoots.delete(m));
      }
      const auth = document.getElementById('modalAuth')!, shelf = document.getElementById('modalShelf')!, beta = document.getElementById('modalBetaComments')!;
      const mo = new MutationObserver(() =>
        setOpen(beta.classList.contains('open') ? 'beta' : auth.classList.contains('open') ? 'auth' : shelf.classList.contains('open') ? 'shelf' : null),
      );
      mo.observe(auth, { attributes: true, attributeFilter: ['class'] });
      mo.observe(shelf, { attributes: true, attributeFilter: ['class'] });
      mo.observe(beta, { attributes: true, attributeFilter: ['class'] });
      off.push(() => mo.disconnect());
      off.push(() => beta.remove());
      wire(c, off);
      // wave 7b (H5): 1.0's initPlatform lines — the install area and the update bar (src/cloud/platform.ts)
      off.push(platformInit(c, { sw: typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null, registration: swRegistration(), reload: () => window.location.reload() }));

      deskChanged(cloudUi.ydoc());
      void bootCloud();
    });
    return () => {
      alive = false;
      off.forEach((f) => f());
      el.innerHTML = '';
      el.remove();
      setOpen(null);
    };
  }, [started]); // eslint-disable-line react-hooks/exhaustive-deps

  // the book on the desk changed (another book, or a new generation of this one)
  const ydoc = bk.book?.ydoc ?? null;
  useEffect(() => {
    if (cm.current) deskChanged(ydoc);
  }, [ydoc]);

  // a language change: 1.0's words again (its data-i18n, the dialog's mode, the account button, the shelf line)
  const first = useRef(lang);
  useEffect(() => {
    cloudLang(lang);
    if (first.current === lang) return;
    first.current = lang;
    const c = cm.current, mc = closureIfLoaded();
    if (!c || !mc || !host.current) return;
    for (const id of Object.values(CLOUD_SLOTS)) {
      const s = document.getElementById(id);
      if (s) translateCover(mc, s);
    }
    translateCover(mc, host.current);
    c.api.setAuthMode(c.vars.authMode);
    c.api.renderCloudChrome();
    c.api.renderSyncLine();
    if (document.getElementById('modalShelf')?.classList.contains('open')) c.api.renderShelfList();
    // wave 7b: 1.0's betaOnLangChange (the Comments button, the share section, the comments dialog if open)
    c.api.betaOnLangChange();
  }, [lang]);

  const target = open ? document.getElementById(open === 'auth' ? 'modalAuth' : open === 'beta' ? 'modalBetaComments' : 'modalShelf') : null;
  const box = { get current() { return target?.querySelector<HTMLElement>('.modal') ?? null; } };
  return open && target
    ? createPortal(
        <StackEntry
          box={box}
          onClose={() => {
            const c = cm.current;
            if (!c) return;
            if (open === 'auth') c.api.closeAuth();
            else if (open === 'beta') c.api.betaCloseComments();
            else {
              target.classList.remove('open');
              cloudUi.focusEditor();
            }
          }}
        />,
        target,
      )
    : null;
}
