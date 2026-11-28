import { useCallback, useEffect, useRef, useState } from 'react';
import { useBook } from '../book/BookProvider';
import { cloudFacts } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import type { UiKey } from '../i18n/strings';
import { Dialog, useConfirm } from '../shell/Dialog';
import { Icon } from '../shell/Icon';
import { arcFetch } from './net';

/* ARC slice 1, Task 8: the author's ARC panel. A section in the export screen's archive group (#arcSec, which
   src/export/ExportModal.tsx appends to the modal; src/export/groups.ts claims it) with one button, and the dialog that
   starts one campaign for the desk book and runs it, on the owner API (src/routes/arc.ts):

   - on open, GET /api/arc?manuscriptId= → { mail, campaigns, signupUrl }; each campaign's readers from
     GET /api/arc/:id/readers;
   - ARC mail not configured → why (which setting is missing, in the panel's words), and no form;
   - a running campaign (state 'open') → the signup link with Copy (the server derives it again on every read, so it is
     shown at all times; final fix wave), the counts, the reader list and its actions, Close sign-ups, Delete this ARC;
   - every other campaign of the book (ended, or past its close: ruling F10) is listed under "Earlier ARCs" with its
     readers (ruling P8): waiting ones can only be declined, a copy can still be closed, and the campaign deleted, so the
     author can always remove readers' data;
   - no running campaign → the start form.

   Never pretended: a refusal shows the server's words beside the button that was pressed (the panel never hides); an
   approval refused because the reader pressed Stop / Not me is told by its code (409 reader-suppressed, ruling I5) in
   the panel's own words; an email that did not go says why. A profile link is text: never a link, never fetched.
   Decline, Close this copy, Close sign-ups, Delete and a new signup link each ask first (default No). Buttons stay
   disabled until the panel has read the campaign again after an action (ruling C8). */

type Mail = { configured: boolean; reason: string | null };
type Campaign = {
  id: string;
  title: string;
  launchDate: string;
  closesAt: string;
  maxClaims: number;
  approvalMode: 'instant' | 'approval';
  state: 'open' | 'closed' | 'ended';
  endedAt: string | null;
  counts: { claimed: number; pending: number; declined: number; revoked: number };
  build: { label: string; bytes: number; holders: number };
};
type Reader = {
  id: string;
  name: string;
  email: string;
  status: 'pending' | 'claimed' | 'declined';
  publicId?: string | null;
  profileLink: string | null;
  revokedAt: string | null;
  mailStopped: boolean;
};
type Res = Record<string, unknown> | null;

const COPIES_MAX = 50; // "cap 50" (plan Global Constraints; src/arc/campaigns.ts ARC_MAX_CLAIMS)
/** The last day sign-ups may close on: the server takes a close at most 400 days from now (ARC_MAX_CLOSE_DAYS), and
 *  the form sends the END of the chosen local day, so the last safe day is today + 399. */
const CLOSE_DAYS_MAX = 399;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The server's four reasons ARC mail is off (src/arc/mail.ts arcMailStatus), in the panel's words. */
const MAIL_WHY: Record<string, UiKey> = {
  'ARC_MAIL_FROM is not set': 'arcp.mailWhy.from',
  'ARC_SMTP_URL is not set': 'arcp.mailWhy.smtp',
  'ARC_SUPPRESSION_SALT is not set': 'arcp.mailWhy.salt',
  'ARC_SUPPRESSION_SALT is shorter than 32 characters': 'arcp.mailWhy.saltShort',
};
/** The four reasons a reader email did not go (src/arc/mail.ts ArcSendOutcome), in the panel's words. */
const SEND_WHY: Record<string, UiKey> = {
  'not-configured': 'arcp.sendWhy.off',
  suppressed: 'arcp.sendWhy.optedOut',
  'rate-limited': 'arcp.sendWhy.limit',
  refused: 'arcp.sendWhy.refused',
};

/** 'YYYY-MM-DD' as a local calendar day, or null when it is not a real date. */
function localDay(date: string): Date | null {
  const m = YMD.exec(date);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const day = new Date(y, mo, d);
  return day.getFullYear() === y && day.getMonth() === mo && day.getDate() === d ? day : null;
}

/** A local calendar day as 'YYYY-MM-DD'. */
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Today, and `days` from today, as local 'YYYY-MM-DD'. */
function dayFromToday(days: number): string {
  const now = new Date();
  return ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

/** 'YYYY-MM-DD' → the ISO instant of 23:59:59 local time that day ('' when it is not a real date). */
export function endOfLocalDay(date: string): string {
  const day = localDay(date);
  if (!day) return '';
  day.setHours(23, 59, 59, 0);
  return day.toISOString();
}

/** Signed in, and the desk book is on the shelf (its shelf id is what the API takes). Decided by this task: ExportModal
 *  reads it to keep #arcSec hidden otherwise, so the archive group does not show for a section with nothing in it. */
export function arcShown(): boolean {
  return !!cloudFacts.available && !!cloudFacts.user && !!cloudFacts.linkedId;
}

const campaignOf = (r: Res): Campaign | null => (r && r.campaign && typeof r.campaign === 'object' ? (r.campaign as Campaign) : null);
/** Every campaign the answer carries (P8), or the one `campaign` of an older answer. */
const campaignsOf = (r: Res): Campaign[] => {
  if (r && Array.isArray(r.campaigns)) return r.campaigns as Campaign[];
  const one = campaignOf(r);
  return one ? [one] : [];
};

/** The section in the export screen: heading, one line, one button. Hidden unless signed in and on the shelf. */
export function ArcSection() {
  const { t } = useLocale();
  const bk = useBook();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const shown = arcShown();
  const id = cloudFacts.linkedId;
  useEffect(() => {
    if (!shown || !id || open) return;
    let alive = true;
    void arcFetch('/api/arc?manuscriptId=' + encodeURIComponent(id)).then((r) => {
      if (alive) setRunning(campaignsOf(r).some((c) => c.state === 'open'));
    });
    return () => {
      alive = false;
    };
  }, [shown, id, open]);
  if (!shown || !id) return null;
  return (
    <>
      <h3>
        <Icon name="BookCopy" />
        {t('arcp.secH')}
      </h3>
      <p>{t('arcp.secSub')}</p>
      <div className="fmt-actions">
        <button className="tb-btn" type="button" id="btnArcpOpen" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {t(running ? 'arcp.open' : 'arcp.run')}
        </button>
      </div>
      <ArcDialog open={open} onClose={() => setOpen(false)} manuscriptId={id} title={bk.title} />
    </>
  );
}

/** The panel. Its state lives in the body and is read again from the server each time it opens. */
export function ArcDialog(props: { open: boolean; onClose: () => void; manuscriptId: string; title: string }) {
  if (!props.open) return null;
  return (
    <Dialog open onClose={props.onClose} id="modalArc" z={70} labelledBy="arcpTitle" className="wide">
      <ArcBody {...props} />
    </Dialog>
  );
}

type ActFn = (c: Campaign, r: Reader, what: 'approve' | 'decline' | 'revoke') => Promise<void>;
type CampaignFn = (c: Campaign) => Promise<void>;

function ArcBody({ onClose, manuscriptId, title }: { onClose: () => void; manuscriptId: string; title: string }) {
  const { t, lang } = useLocale();
  const confirm = useConfirm();
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [mail, setMail] = useState<Mail>({ configured: true, reason: null });
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [readers, setReaders] = useState<Record<string, Reader[]>>({});
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const alive = useRef(true);
  const loaded = useRef(false);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  /** The server's words for a refusal; the panel's own when the network failed. */
  const words = useCallback((r: Res): string => (r === null ? t('arcp.offline') : String(r.__error ?? '')), [t]);

  const note = useCallback(
    (id: string, s: string | null) =>
      setNotes((n) => {
        const next = { ...n };
        if (s) next[id] = s;
        else delete next[id];
        return next;
      }),
    [],
  );

  /** Read the book's campaigns and each one's readers. Once something is shown, a failed read is said on top and what
   *  was shown stays (ruling C8: the panel never hides). */
  const load = useCallback(async () => {
    const r = await arcFetch('/api/arc?manuscriptId=' + encodeURIComponent(manuscriptId));
    if (!alive.current) return;
    if (!r || r.__error) {
      if (loaded.current) note('load', words(r));
      else setError(words(r));
      setPhase('ready');
      return;
    }
    setError(null);
    note('load', null);
    const m = r.mail as Mail | undefined;
    setMail({ configured: !!m?.configured, reason: m?.reason ?? null });
    const list = campaignsOf(r);
    setCampaigns(list);
    setLink(typeof r.signupUrl === 'string' ? r.signupUrl : null);
    const got: Record<string, Reader[]> = {};
    for (const c of list) {
      const rr = await arcFetch('/api/arc/' + encodeURIComponent(c.id) + '/readers');
      if (!alive.current) return;
      if (!rr || rr.__error) note('readers:' + c.id, words(rr));
      else {
        note('readers:' + c.id, null);
        got[c.id] = Array.isArray(rr.readers) ? (rr.readers as Reader[]) : [];
      }
    }
    setReaders((prev) => {
      const next: Record<string, Reader[]> = {};
      for (const c of list) next[c.id] = got[c.id] ?? prev[c.id] ?? [];
      return next;
    });
    loaded.current = true;
    setPhase('ready');
  }, [manuscriptId, note, words]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Run one action: busy from the start until the panel has read everything again (C8). */
  const run = async (key: string, body: () => Promise<boolean>) => {
    setBusy(key);
    const reload = await body();
    if (!alive.current) return;
    if (reload) await load();
    if (alive.current) setBusy(null);
  };

  /** A reader action: the answer's words on that reader's row, then everything read again. */
  const act: ActFn = async (c, r, what) => {
    if (what !== 'approve') {
      const key = what === 'revoke' ? 'arcp.revokeConfirm' : 'arcp.declineConfirm';
      const yes = what === 'revoke' ? t('arcp.revoke') : t('arcp.decline');
      const ok = await confirm({ title: yes, body: t(key, { name: r.name, email: r.email }), yes, no: t('arcp.cancel'), defaultNo: true });
      if (ok !== true) return;
    }
    await run(r.id, async () => {
      note(r.id, null);
      const res = await arcFetch('/api/arc/' + encodeURIComponent(c.id) + '/readers/' + encodeURIComponent(r.id) + '/' + what, { method: 'POST' });
      if (!alive.current) return false;
      if (!res || res.__error) {
        const b = (res?.__body ?? null) as Record<string, unknown> | null;
        // ruling I5: told by its code, in the panel's words, never the server's English
        if (res && b && b.error === 'reader-suppressed') note(r.id, t(b.scope === 'all' ? 'arcp.suppressedAll' : 'arcp.suppressedOwner'));
        else note(r.id, words(res));
      } else {
        const m = res.mail as { sent?: boolean; reason?: string; detail?: string } | undefined;
        if (m && m.sent === false) {
          const why = SEND_WHY[String(m.reason ?? '')];
          note(r.id, t('arcp.notSent', { detail: why ? t(why) : String(m.detail ?? '') }));
        }
      }
      return true;
    });
  };

  const closeSignups: CampaignFn = async (c) => {
    const ok = await confirm({ title: t('arcp.closeSignups'), body: t('arcp.closeConfirm'), yes: t('arcp.closeSignups'), no: t('arcp.cancel'), defaultNo: true });
    if (ok !== true) return;
    await run('close', async () => {
      note('close:' + c.id, null);
      const res = await arcFetch('/api/arc/' + encodeURIComponent(c.id) + '/close', { method: 'POST' });
      if (!alive.current) return false;
      if (!res || res.__error) note('close:' + c.id, words(res));
      return true;
    });
  };

  const remove: CampaignFn = async (c) => {
    const ok = await confirm({ title: t('arcp.delete'), body: t('arcp.deleteConfirm'), yes: t('arcp.deleteYes'), no: t('arcp.cancel'), defaultNo: true });
    if (ok !== true) return;
    await run('delete', async () => {
      note('delete:' + c.id, null);
      const res = await arcFetch('/api/arc/' + encodeURIComponent(c.id), { method: 'DELETE' });
      if (!alive.current) return false;
      if (!res || res.__error) note('delete:' + c.id, words(res));
      return true;
    });
  };

  const newLink: CampaignFn = async (c) => {
    const ok = await confirm({ title: t('arcp.newLink'), body: t('arcp.newLinkConfirm'), yes: t('arcp.newLink'), no: t('arcp.cancel'), defaultNo: true });
    if (ok !== true) return;
    await run('link', async () => {
      note('link', null);
      const res = await arcFetch('/api/arc/' + encodeURIComponent(c.id) + '/signup-link', { method: 'POST' });
      if (!alive.current) return false;
      if (!res || res.__error) {
        note('link', words(res));
        return true;
      }
      setCopied(false);
      setLink(typeof res.signupUrl === 'string' ? res.signupUrl : null);
      return false; // the answer carries the new link; nothing else changed
    });
  };

  const started = (c: Campaign, url: string | null) => {
    setCampaigns((list) => [c, ...list.filter((x) => x.id !== c.id)]);
    setReaders((prev) => ({ ...prev, [c.id]: [] }));
    setCopied(false);
    setLink(url);
  };

  const ready = phase === 'ready' && !error;
  const live = campaigns.find((c) => c.state === 'open') ?? null;
  const past = campaigns.filter((c) => c !== live);
  const shownTitle = (live ?? campaigns[0])?.title || title;
  const mailWhy = mail.reason ? (MAIL_WHY[mail.reason] ? t(MAIL_WHY[mail.reason]!) : mail.reason) : '';

  return (
    <>
      <h2>
        <Icon name="BookCopy" />
        <span id="arcpTitle">{t('arcp.title', { title: shownTitle })}</span>
      </h2>
      {phase === 'loading' ? <p className="shelf-empty">{t('arcp.loading')}</p> : null}
      {error ? (
        <p className="cr-wait" role="alert">
          {error}
        </p>
      ) : null}
      {ready && notes.load ? (
        <p className="cr-wait" role="alert" data-arcp="load-note">
          {notes.load}
        </p>
      ) : null}
      {ready && !mail.configured ? (
        <p className="cr-wait" role="status" data-arcp="mail-off">
          {t('arcp.mailOff', { reason: mailWhy })}
        </p>
      ) : null}
      {ready && live ? (
        <Running
          c={live}
          readers={readers[live.id] ?? []}
          link={link}
          copied={copied}
          setCopied={setCopied}
          busy={busy}
          notes={notes}
          act={act}
          newLink={newLink}
          closeSignups={closeSignups}
          remove={remove}
        />
      ) : null}
      {ready && past.length ? (
        <div data-arcp="pasts">
          <div className="field-lab">{t('arcp.pastH')}</div>
          {past.map((c) => (
            <Past key={c.id} c={c} readers={readers[c.id] ?? []} busy={busy} notes={notes} act={act} remove={remove} />
          ))}
        </div>
      ) : null}
      {ready && !live && mail.configured ? (
        <StartForm hasPast={past.length > 0} manuscriptId={manuscriptId} lang={lang} onStarted={started} onMailOff={setMail} />
      ) : null}
      <div className="modal-actions">
        <button className="tb-btn" type="button" id="btnArcpClose" onClick={onClose}>
          {t('arcp.close')}
        </button>
      </div>
    </>
  );
}

/** A date for the author: a 'YYYY-MM-DD' as that calendar day, an instant in the browser's zone. */
function useDate(): (v: string | null | undefined) => string {
  const { lang } = useLocale();
  return (v) => {
    if (!v) return '';
    const d = localDay(v) ?? new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    try {
      return new Intl.DateTimeFormat(lang, { dateStyle: 'long' }).format(d);
    } catch {
      return v.slice(0, 10);
    }
  };
}

/** A refusal said beside the button it answers (C8). */
function Note({ text, id }: { text: string | undefined; id: string }) {
  if (!text) return null;
  return (
    <p className="cr-wait" role="alert" data-arcp-note={id}>
      {text}
    </p>
  );
}

function Running(p: {
  c: Campaign;
  readers: Reader[];
  link: string | null;
  copied: boolean;
  setCopied: (v: boolean) => void;
  busy: string | null;
  notes: Record<string, string>;
  act: ActFn;
  newLink: CampaignFn;
  closeSignups: CampaignFn;
  remove: CampaignFn;
}) {
  const { t } = useLocale();
  const date = useDate();
  const field = useRef<HTMLInputElement>(null);
  const { c } = p;
  const copy = () => {
    const url = p.link;
    if (!url) return;
    const fallback = () => {
      field.current?.focus();
      field.current?.select();
    };
    try {
      const w = navigator.clipboard?.writeText(url);
      if (!w) return fallback();
      void w.then(() => p.setCopied(true), fallback);
    } catch {
      fallback();
    }
  };
  return (
    <div data-arcp="running">
      <div className="field-lab">{t('arcp.link')}</div>
      {p.link ? (
        <div className="beta-linkrow" style={{ display: 'flex', gap: 8 }}>
          <input className="txt-input" readOnly ref={field} id="arcpLinkUrl" value={p.link} aria-label={t('arcp.link')} style={{ flex: 1 }} />
          <button className="tb-btn" type="button" id="btnArcpCopy" onClick={copy}>
            <Icon name="Copy" />
            {t(p.copied ? 'arcp.copied' : 'arcp.copy')}
          </button>
        </div>
      ) : (
        <p className="m-sub">{t('arcp.linkNone')}</p>
      )}
      <p className="m-sub">{t('arcp.unlisted')}</p>
      <div className="fmt-actions">
        <button className="tb-btn" type="button" id="btnArcpNewLink" disabled={p.busy !== null} onClick={() => void p.newLink(c)}>
          <Icon name="Link" />
          {t('arcp.newLink')}
        </button>
      </div>
      <Note text={p.notes.link} id="link" />
      <ul className="m-sub" data-arcp="facts" style={{ listStyle: 'none', padding: 0 }}>
        <li>{t('arcp.launchOn', { date: date(c.launchDate) })}</li>
        <li>{t('arcp.closesOn', { date: date(c.closesAt) })}</li>
        <li>{t('arcp.claimedN', { n: c.counts.claimed, max: c.maxClaims })}</li>
        {c.approvalMode === 'approval' || c.counts.pending > 0 ? <li>{t('arcp.pendingN', { n: c.counts.pending })}</li> : null}
        <li>{t(c.approvalMode === 'approval' ? 'arcp.modeApproval' : 'arcp.modeInstant')}</li>
        {/* never an invented label: without one from the server, the line names none (C8) */}
        <li>{c.build.label ? t('arcp.holders', { label: c.build.label, n: c.build.holders }) : t('arcp.holdersN', { n: c.build.holders })}</li>
      </ul>
      <p className="m-sub">{t('arcp.stamp')}</p>
      <div className="field-lab">{t('arcp.readersH')}</div>
      <Note text={p.notes['readers:' + c.id]} id={'readers:' + c.id} />
      <ReaderList c={c} readers={p.readers} live busy={p.busy} notes={p.notes} act={p.act} />
      <div className="fmt-actions">
        <button className="tb-btn" type="button" id="btnArcpCloseSignups" disabled={p.busy !== null} onClick={() => void p.closeSignups(c)}>
          {t('arcp.closeSignups')}
        </button>
        <button className="tb-btn" type="button" id="btnArcpDelete" disabled={p.busy !== null} onClick={() => void p.remove(c)}>
          <Icon name="Trash2" />
          {t('arcp.delete')}
        </button>
      </div>
      <Note text={p.notes['close:' + c.id]} id={'close:' + c.id} />
      <Note text={p.notes['delete:' + c.id]} id={'delete:' + c.id} />
    </div>
  );
}

/** An ended campaign (or one past its close date), summarised, with its readers (F10, P8): a waiting reader can only be
 *  declined, a copy can still be closed, and the campaign deleted with all its readers. */
function Past(p: { c: Campaign; readers: Reader[]; busy: string | null; notes: Record<string, string>; act: ActFn; remove: CampaignFn }) {
  const { t } = useLocale();
  const date = useDate();
  const { c } = p;
  return (
    <div data-arcp="past" data-campaign={c.id}>
      <p className="m-sub">{t('arcp.endedSum', { date: date(c.endedAt ?? c.closesAt), n: c.counts.claimed, max: c.maxClaims })}</p>
      {p.readers.some((r) => r.status === 'pending') ? <p className="m-sub">{t('arcp.endedWaiting')}</p> : null}
      <Note text={p.notes['readers:' + c.id]} id={'readers:' + c.id} />
      {p.readers.length ? <ReaderList c={c} readers={p.readers} live={false} busy={p.busy} notes={p.notes} act={p.act} /> : null}
      <div className="fmt-actions">
        <button className="tb-btn" type="button" data-arcp="delete-past" disabled={p.busy !== null} onClick={() => void p.remove(c)}>
          <Icon name="Trash2" />
          {t('arcp.delete')}
        </button>
      </div>
      <Note text={p.notes['delete:' + c.id]} id={'delete:' + c.id} />
    </div>
  );
}

function ReaderList(p: { c: Campaign; readers: Reader[]; live: boolean; busy: string | null; notes: Record<string, string>; act: ActFn }) {
  const { t } = useLocale();
  if (!p.readers.length) return <p className="shelf-empty">{t('arcp.noReaders')}</p>;
  const status = (r: Reader): UiKey =>
    r.status === 'claimed' ? (r.revokedAt ? 'arcp.stClosed' : 'arcp.stClaimed') : r.status === 'declined' ? 'arcp.stDeclined' : 'arcp.stPending';
  return (
    <ul data-arcp="readers" style={{ listStyle: 'none', padding: 0 }}>
      {p.readers.map((r) => (
        <li key={r.id} data-reader={r.id} style={{ paddingBlock: 6 }}>
          <div>
            {/* a reader's own name and address, isolated so neither can reorder the line around it (C8) */}
            <strong>
              <bdi>{r.name}</bdi>
            </strong>{' '}
            <span>
              <bdi>{r.email}</bdi>
            </span>{' '}
            · <span data-arcp="status">{t(status(r))}</span>
          </div>
          {r.publicId ? (
            <div className="m-sub" data-arcp="copy-no">
              {t('arcp.copyNo', { id: r.publicId })}
            </div>
          ) : null}
          {r.profileLink ? <div className="m-sub">{t('arcp.profile', { link: r.profileLink })}</div> : null}
          {r.mailStopped ? <div className="m-sub">{t('arcp.mailStopped')}</div> : null}
          <div className="fmt-actions">
            {r.status === 'pending' && p.live ? (
              <button className="tb-btn primary" type="button" disabled={p.busy !== null} onClick={() => void p.act(p.c, r, 'approve')}>
                {t('arcp.approve')}
              </button>
            ) : null}
            {r.status === 'pending' ? (
              <button className="tb-btn" type="button" disabled={p.busy !== null} onClick={() => void p.act(p.c, r, 'decline')}>
                {t('arcp.decline')}
              </button>
            ) : null}
            {r.status === 'claimed' && !r.revokedAt ? (
              <button className="tb-btn" type="button" disabled={p.busy !== null} onClick={() => void p.act(p.c, r, 'revoke')}>
                {t('arcp.revoke')}
              </button>
            ) : null}
          </div>
          {p.notes[r.id] ? (
            <p className="cr-wait" role="status">
              {p.notes[r.id]}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function StartForm(p: { hasPast: boolean; manuscriptId: string; lang: string; onStarted: (c: Campaign, url: string | null) => void; onMailOff: (m: Mail) => void }) {
  const { t } = useLocale();
  const [launch, setLaunch] = useState('');
  const [closes, setCloses] = useState('');
  const [closesTouched, setClosesTouched] = useState(false);
  const [copies, setCopies] = useState(String(COPIES_MAX));
  const [mode, setMode] = useState<'instant' | 'approval'>('instant');
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const today = dayFromToday(0);
  const lastClose = dayFromToday(CLOSE_DAYS_MAX);
  const closeDay = closesTouched ? closes : launch;
  const n = /^\d+$/.test(copies.trim()) ? Number(copies.trim()) : NaN;
  const copiesOk = Number.isInteger(n) && n >= 1 && n <= COPIES_MAX;
  const datesReal = !!localDay(launch) && !!localDay(closeDay);
  // 'YYYY-MM-DD' compares as text in calendar order.
  const datesOk = datesReal && launch >= today && closeDay >= today && closeDay <= lastClose;
  const can = datesOk && copiesOk && !building;

  const start = async () => {
    if (!can) return;
    setBuilding(true);
    setError(null);
    const body = {
      manuscriptId: p.manuscriptId,
      launchDate: launch,
      closesAt: endOfLocalDay(closeDay),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      maxClaims: n,
      approvalMode: mode,
      lang: p.lang,
    };
    const res = await arcFetch('/api/arc', { method: 'POST', body: JSON.stringify(body) });
    if (!alive.current) return;
    setBuilding(false);
    if (!res || res.__error) {
      const m = ((res?.__body ?? null) as Record<string, unknown> | null)?.mail as Mail | undefined;
      // ARC mail switched off since the panel opened: say which setting, and the form goes (never pretended)
      if (m && m.configured === false) return p.onMailOff({ configured: false, reason: m.reason ?? null });
      setError(res === null ? t('arcp.offline') : String(res.__error));
      return;
    }
    const c = campaignOf(res);
    if (c) p.onStarted(c, typeof res.signupUrl === 'string' ? res.signupUrl : null);
  };

  return (
    <div data-arcp="form">
      {p.hasPast ? <div className="field-lab">{t('arcp.newH')}</div> : null}
      <div style={{ display: 'grid', gap: 10 }}>
        <div>
          <label className="field-lab" htmlFor="arcpLaunch">
            {t('arcp.launch')}
          </label>
          <input className="txt-input" type="date" id="arcpLaunch" required min={today} value={launch} onChange={(e) => setLaunch(e.target.value)} />
        </div>
        <div>
          <label className="field-lab" htmlFor="arcpCloses">
            {t('arcp.closes')}
          </label>
          <input
            className="txt-input"
            type="date"
            id="arcpCloses"
            required
            min={today}
            max={lastClose}
            value={closeDay}
            aria-describedby="arcpClosesHint"
            onChange={(e) => {
              setClosesTouched(true);
              setCloses(e.target.value);
            }}
          />
          <div className="m-sub" id="arcpClosesHint">
            {t('arcp.closesHint')}
          </div>
          {datesReal && !datesOk ? (
            <div className="cr-wait" role="alert">
              {t('arcp.datesBad')}
            </div>
          ) : null}
        </div>
        <div>
          <label className="field-lab" htmlFor="arcpCopies">
            {t('arcp.copies')}
          </label>
          <input
            className="txt-input"
            type="number"
            id="arcpCopies"
            min={1}
            max={COPIES_MAX}
            step={1}
            inputMode="numeric"
            value={copies}
            aria-invalid={!copiesOk}
            onChange={(e) => setCopies(e.target.value)}
          />
          {!copiesOk ? (
            <div className="cr-wait" role="alert">
              {t('arcp.copiesBad')}
            </div>
          ) : null}
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-lab">{t('arcp.joining')}</legend>
          <div>
            <input type="radio" name="arcpJoin" id="arcpJoinInstant" checked={mode === 'instant'} onChange={() => setMode('instant')} />{' '}
            <label htmlFor="arcpJoinInstant">{t('arcp.instant')}</label>
          </div>
          <div>
            <input type="radio" name="arcpJoin" id="arcpJoinApproval" checked={mode === 'approval'} onChange={() => setMode('approval')} />{' '}
            <label htmlFor="arcpJoinApproval">{t('arcp.approval')}</label>
          </div>
          {mode === 'approval' ? <div className="m-sub">{t('arcp.approvalHint')}</div> : null}
        </fieldset>
      </div>
      <p className="m-sub">{t('arcp.stamp')}</p>
      <p className="m-sub">{t('arcp.noReview')}</p>
      <div className="fmt-actions">
        <button className="tb-btn primary" type="button" id="btnArcpStart" disabled={!can} onClick={() => void start()}>
          {t('arcp.start')}
        </button>
      </div>
      {building ? (
        <p className="cr-wait" role="status">
          {t('arcp.building')}
        </p>
      ) : null}
      {error ? (
        <p className="cr-wait" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
