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

   - on open, GET /api/arc?manuscriptId= → { mail, campaign }; a campaign's readers from GET /api/arc/:id/readers;
   - ARC mail not configured → the server's reason (which setting is missing), and no form;
   - no running campaign (none, or the last one ended / past its close: ruling F10) → the start form; an earlier one is
     summarised above it, with its still-waiting readers, so the author can decline them;
   - a running one → the signup link (only right after Start or "Make a new signup link": the server returns the token
     once and keeps only its hash), the counts, the reader list and its actions, Close sign-ups, Delete this ARC.

   Never pretended: a refusal shows the server's words, an approval refused because the reader pressed Stop / Not me is
   told by its code (409 reader-suppressed, ruling I5) in the panel's own words, an email that did not go says so. A
   profile link is text: never a link, never fetched. Irreversible actions ask first. */

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
  profileLink: string | null;
  revokedAt: string | null;
  mailStopped: boolean;
};
type Res = Record<string, unknown> | null;

const COPIES_MAX = 50; // "cap 50" (plan Global Constraints; src/arc/campaigns.ts ARC_MAX_CLAIMS)
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' as a local calendar day, or null when it is not a real date. */
function localDay(date: string): Date | null {
  const m = YMD.exec(date);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const day = new Date(y, mo, d);
  return day.getFullYear() === y && day.getMonth() === mo && day.getDate() === d ? day : null;
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
      if (alive) setRunning(campaignOf(r)?.state === 'open');
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

/** The panel. Its state lives in the body, so closing it forgets the signup link (the server never returns it again). */
export function ArcDialog(props: { open: boolean; onClose: () => void; manuscriptId: string; title: string }) {
  if (!props.open) return null;
  return (
    <Dialog open onClose={props.onClose} id="modalArc" z={70} labelledBy="arcpTitle" className="wide">
      <ArcBody {...props} />
    </Dialog>
  );
}

function ArcBody({ onClose, manuscriptId, title }: { onClose: () => void; manuscriptId: string; title: string }) {
  const { t, lang } = useLocale();
  const confirm = useConfirm();
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [mail, setMail] = useState<Mail>({ configured: true, reason: null });
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [readers, setReaders] = useState<Reader[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  /** The server's words for a refusal; the panel's own when the network failed. */
  const words = (r: Res): string => (r === null ? t('arcp.offline') : String(r.__error ?? ''));

  const loadReaders = useCallback(async (c: Campaign | null) => {
    if (!c) {
      setReaders([]);
      return;
    }
    const r = await arcFetch('/api/arc/' + encodeURIComponent(c.id) + '/readers');
    if (!alive.current) return;
    if (!r || r.__error) {
      setError(r === null ? t('arcp.offline') : String(r.__error));
      return;
    }
    setReaders(Array.isArray(r.readers) ? (r.readers as Reader[]) : []);
  }, [t]);

  const load = useCallback(async () => {
    const r = await arcFetch('/api/arc?manuscriptId=' + encodeURIComponent(manuscriptId));
    if (!alive.current) return;
    if (!r || r.__error) {
      setError(r === null ? t('arcp.offline') : String(r.__error));
      setPhase('ready');
      return;
    }
    setError(null);
    const m = r.mail as Mail | undefined;
    setMail({ configured: !!m?.configured, reason: m?.reason ?? null });
    const c = campaignOf(r);
    setCampaign(c);
    await loadReaders(c);
    if (alive.current) setPhase('ready');
  }, [manuscriptId, loadReaders, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const note = (id: string, s: string | null) =>
    setNotes((n) => {
      const next = { ...n };
      if (s) next[id] = s;
      else delete next[id];
      return next;
    });

  /** A reader action: the answer's words on that reader's row, then the campaign and its readers read again. */
  const act = async (r: Reader, what: 'approve' | 'decline' | 'revoke') => {
    if (!campaign) return;
    if (what === 'revoke') {
      const ok = await confirm({ title: t('arcp.revoke'), body: t('arcp.revokeConfirm'), yes: t('arcp.revoke'), no: t('arcp.cancel'), defaultNo: true });
      if (ok !== true) return;
    }
    setBusy(r.id);
    note(r.id, null);
    const res = await arcFetch('/api/arc/' + encodeURIComponent(campaign.id) + '/readers/' + encodeURIComponent(r.id) + '/' + what, { method: 'POST' });
    if (!alive.current) return;
    if (!res || res.__error) {
      const b = (res?.__body ?? null) as Record<string, unknown> | null;
      // ruling I5: told by its code, in the panel's words, never the server's English
      if (res && b && b.error === 'reader-suppressed') note(r.id, t(b.scope === 'all' ? 'arcp.suppressedAll' : 'arcp.suppressedOwner'));
      else note(r.id, words(res));
    } else {
      const m = res.mail as { sent?: boolean; detail?: string } | undefined;
      if (m && m.sent === false) note(r.id, t('arcp.notSent', { detail: String(m.detail ?? '') }));
    }
    setBusy(null);
    await load();
  };

  const closeSignups = async () => {
    if (!campaign) return;
    const ok = await confirm({ title: t('arcp.closeSignups'), body: t('arcp.closeConfirm'), yes: t('arcp.closeSignups'), no: t('arcp.cancel'), defaultNo: true });
    if (ok !== true) return;
    setBusy('close');
    const res = await arcFetch('/api/arc/' + encodeURIComponent(campaign.id) + '/close', { method: 'POST' });
    if (!alive.current) return;
    setBusy(null);
    if (!res || res.__error) return setError(words(res));
    setLink(null);
    await load();
  };

  const remove = async () => {
    if (!campaign) return;
    const ok = await confirm({ title: t('arcp.delete'), body: t('arcp.deleteConfirm'), yes: t('arcp.deleteYes'), no: t('arcp.cancel'), defaultNo: true });
    if (ok !== true) return;
    setBusy('delete');
    const res = await arcFetch('/api/arc/' + encodeURIComponent(campaign.id), { method: 'DELETE' });
    if (!alive.current) return;
    setBusy(null);
    if (!res || res.__error) return setError(words(res));
    setLink(null);
    setNotes({});
    await load();
  };

  const newLink = async () => {
    if (!campaign) return;
    setBusy('link');
    const res = await arcFetch('/api/arc/' + encodeURIComponent(campaign.id) + '/signup-link', { method: 'POST' });
    if (!alive.current) return;
    setBusy(null);
    if (!res || res.__error) return setError(words(res));
    setCopied(false);
    setLink(typeof res.signupUrl === 'string' ? res.signupUrl : null);
  };

  const started = (c: Campaign, url: string | null) => {
    setCampaign(c);
    setReaders([]);
    setNotes({});
    setCopied(false);
    setLink(url);
  };

  const live = campaign && campaign.state === 'open' ? campaign : null;
  const past = campaign && campaign.state !== 'open' ? campaign : null;
  const shownTitle = campaign?.title || title;

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
      {phase === 'ready' && !error && !mail.configured ? (
        <p className="cr-wait" role="status" data-arcp="mail-off">
          {t('arcp.mailOff', { reason: mail.reason ?? '' })}
        </p>
      ) : null}
      {phase === 'ready' && !error && live ? (
        <Running
          c={live}
          readers={readers}
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
      {phase === 'ready' && !error && !live ? (
        <>
          {past ? <Past c={past} readers={readers} busy={busy} notes={notes} act={act} remove={remove} /> : null}
          {mail.configured ? <StartForm hasPast={!!past} manuscriptId={manuscriptId} lang={lang} onStarted={started} onMailOff={setMail} /> : null}
        </>
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

type ActFn = (r: Reader, what: 'approve' | 'decline' | 'revoke') => Promise<void>;

function Running(p: {
  c: Campaign;
  readers: Reader[];
  link: string | null;
  copied: boolean;
  setCopied: (v: boolean) => void;
  busy: string | null;
  notes: Record<string, string>;
  act: ActFn;
  newLink: () => Promise<void>;
  closeSignups: () => Promise<void>;
  remove: () => Promise<void>;
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
        <p className="m-sub">{t('arcp.linkHidden')}</p>
      )}
      <p className="m-sub">{t('arcp.unlisted')}</p>
      <div className="fmt-actions">
        <button className="tb-btn" type="button" id="btnArcpNewLink" disabled={p.busy !== null} onClick={() => void p.newLink()}>
          <Icon name="Link" />
          {t('arcp.newLink')}
        </button>
      </div>
      <ul className="m-sub" data-arcp="facts" style={{ listStyle: 'none', padding: 0 }}>
        <li>{t('arcp.launchOn', { date: date(c.launchDate) })}</li>
        <li>{t('arcp.closesOn', { date: date(c.closesAt) })}</li>
        <li>{t('arcp.claimedN', { n: c.counts.claimed, max: c.maxClaims })}</li>
        {c.approvalMode === 'approval' || c.counts.pending > 0 ? <li>{t('arcp.pendingN', { n: c.counts.pending })}</li> : null}
        <li>{t(c.approvalMode === 'approval' ? 'arcp.modeApproval' : 'arcp.modeInstant')}</li>
        <li>{t('arcp.holders', { label: c.build.label || 'v1.0', n: c.build.holders })}</li>
      </ul>
      <p className="m-sub">{t('arcp.stamp')}</p>
      <div className="field-lab">{t('arcp.readersH')}</div>
      <ReaderList readers={p.readers} live busy={p.busy} notes={p.notes} act={p.act} />
      <div className="fmt-actions">
        <button className="tb-btn" type="button" id="btnArcpCloseSignups" disabled={p.busy !== null} onClick={() => void p.closeSignups()}>
          {t('arcp.closeSignups')}
        </button>
        <button className="tb-btn" type="button" id="btnArcpDelete" disabled={p.busy !== null} onClick={() => void p.remove()}>
          <Icon name="Trash2" />
          {t('arcp.delete')}
        </button>
      </div>
    </div>
  );
}

/** An ended campaign (or one past its close date), summarised; its still-waiting readers can be declined (F10). */
function Past(p: { c: Campaign; readers: Reader[]; busy: string | null; notes: Record<string, string>; act: ActFn; remove: () => Promise<void> }) {
  const { t } = useLocale();
  const date = useDate();
  const { c } = p;
  const waiting = p.readers.filter((r) => r.status === 'pending' || p.notes[r.id]);
  return (
    <div data-arcp="past">
      <p className="m-sub">{t('arcp.endedSum', { date: date(c.endedAt ?? c.closesAt), n: c.counts.claimed, max: c.maxClaims })}</p>
      {waiting.length ? (
        <>
          <p className="m-sub">{t('arcp.endedWaiting')}</p>
          <ReaderList readers={waiting} live={false} busy={p.busy} notes={p.notes} act={p.act} />
        </>
      ) : null}
      <div className="fmt-actions">
        <button className="tb-btn" type="button" id="btnArcpDelete" disabled={p.busy !== null} onClick={() => void p.remove()}>
          <Icon name="Trash2" />
          {t('arcp.delete')}
        </button>
      </div>
    </div>
  );
}

function ReaderList(p: { readers: Reader[]; live: boolean; busy: string | null; notes: Record<string, string>; act: ActFn }) {
  const { t } = useLocale();
  if (!p.readers.length) return <p className="shelf-empty">{t('arcp.noReaders')}</p>;
  const status = (r: Reader): UiKey =>
    r.status === 'claimed' ? (r.revokedAt ? 'arcp.stClosed' : 'arcp.stClaimed') : r.status === 'declined' ? 'arcp.stDeclined' : 'arcp.stPending';
  return (
    <ul data-arcp="readers" style={{ listStyle: 'none', padding: 0 }}>
      {p.readers.map((r) => (
        <li key={r.id} data-reader={r.id} style={{ paddingBlock: 6 }}>
          <div>
            <strong>{r.name}</strong> <span>{r.email}</span> · <span data-arcp="status">{t(status(r))}</span>
          </div>
          {r.profileLink ? <div className="m-sub">{t('arcp.profile', { link: r.profileLink })}</div> : null}
          {r.mailStopped ? <div className="m-sub">{t('arcp.mailStopped')}</div> : null}
          <div className="fmt-actions">
            {r.status === 'pending' && p.live ? (
              <button className="tb-btn primary" type="button" disabled={p.busy !== null} onClick={() => void p.act(r, 'approve')}>
                {t('arcp.approve')}
              </button>
            ) : null}
            {r.status === 'pending' ? (
              <button className="tb-btn" type="button" disabled={p.busy !== null} onClick={() => void p.act(r, 'decline')}>
                {t('arcp.decline')}
              </button>
            ) : null}
            {r.status === 'claimed' && !r.revokedAt ? (
              <button className="tb-btn" type="button" disabled={p.busy !== null} onClick={() => void p.act(r, 'revoke')}>
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
  const closeDay = closesTouched ? closes : launch;
  const n = /^\d+$/.test(copies.trim()) ? Number(copies.trim()) : NaN;
  const copiesOk = Number.isInteger(n) && n >= 1 && n <= COPIES_MAX;
  const can = !!localDay(launch) && !!localDay(closeDay) && copiesOk && !building;

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
          <input className="txt-input" type="date" id="arcpLaunch" required value={launch} onChange={(e) => setLaunch(e.target.value)} />
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
