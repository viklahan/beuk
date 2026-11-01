import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useBook } from '../book/BookProvider';
import { loadClosure, setClosureT, type Closure, type DiffPart, type DiffRow, type HistoryEntry } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import { Dialog, useConfirm } from '../shell/Dialog';
import { Icon } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import { deleteSnapshot, live, liveDoc, restoreDoc, restoreSection, saveNamed, type Live } from './history';

/* The History room (1.0 #modalHistory: renderHistory, histDiffHtml,
   histCmpHtml, initHistory), with 1.0's markup, classes, data- attributes
   and keys. Browsing is read-only by construction: the room reads the
   book (live(): exportBook + 1.0's state) and never writes it; only Save,
   Delete and the two Restores write, each through history.ts. */

type T = ReturnType<typeof useLocale>['t'];

/** 1.0's fmtNum: Intl in the interface language, whole numbers. */
export function fmtNum(n: unknown, lang: string): string {
  const v = Math.round(Number(n) || 0);
  try {
    return new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(v);
  } catch {
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
}
/** 1.0's fmtDateIntl. */
function fmtDate(d: Date, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}
/** 1.0's snapshotWhen. */
export function snapshotWhen(s: HistoryEntry, lang: string): string {
  const d = new Date(s.at);
  if (isNaN(d.getTime())) return '';
  let time = '';
  try {
    time = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(d);
  } catch {
    /* an engine without this locale */
  }
  return time ? fmtDate(d, lang) + ' · ' + time : fmtDate(d, lang);
}
/** 1.0's snapshotLabel. */
export function snapshotLabel(s: HistoryEntry, t: T): string {
  const tt = t as (k: string, p?: Record<string, unknown>) => string;
  if (s.name) return s.name;
  if (s.auto === 'chapterop' && s.chop && s.chop.op)
    return tt('history.auto.chop' + s.chop.op.charAt(0).toUpperCase() + s.chop.op.slice(1), { name: s.chop.a, a: s.chop.a, b: s.chop.b });
  if (s.auto) return tt('history.auto.' + s.auto);
  return t('history.unnamed');
}
/** 1.0's histWordCount (the count is formatted before t(), so the form is chosen here). */
export function histWordCount(n: number, t: T, lang: string): string {
  return t(n === 1 ? 'history.words' : 'history.wordsPlural', { n: fmtNum(n, lang) });
}
type Keys = { up: string; down: string; same: string };
/** 1.0's histDeltaText. */
export function histDeltaText(snapWords: number, nowWords: number, t: T, lang: string, keys?: Keys): string {
  const tt = t as (k: string, p?: Record<string, unknown>) => string;
  const d = Math.round(nowWords) - Math.round(snapWords);
  const k = keys || { up: 'history.deltaUp', down: 'history.deltaDown', same: 'history.deltaSame' };
  if (d > 0) return tt(k.up, { n: fmtNum(d, lang), count: d });
  if (d < 0) return tt(k.down, { n: fmtNum(-d, lang), count: -d });
  return tt(k.same);
}

/** 1.0's histPeekHtml, as React (text only). */
function Peek({ content, t }: { content: unknown; t: T }) {
  const paras = String(content || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return <p className="ins-none">{t('history.peekEmpty')}</p>;
  return (
    <>
      {paras.map((p, i) =>
        p === '***' || p === '* * *' ? (
          <p className="hist-orn" key={i}>
            ❦
          </p>
        ) : (
          <p key={i}>{p.replace(/\s*\n\s*/g, ' ')}</p>
        ),
      )}
    </>
  );
}

/** 1.0's histCmpPartHtml. */
function Part({ p, t }: { p: DiffPart; t: T }) {
  if (p.t === '-')
    return (
      <del>
        <span className="sr-only">{t('history.cmpDelSr')} </span>
        {p.s}
      </del>
    );
  if (p.t === '+')
    return (
      <ins>
        <span className="sr-only">{t('history.cmpInsSr')} </span>
        {p.s}
      </ins>
    );
  return <>{p.s}</>;
}

export function HistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useLocale();
  const bk = useBook();
  const confirm = useConfirm();
  const toast = useToast();
  const [c, setC] = useState<Closure | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [cmpId, setCmpId] = useState<string | null>(null);
  const [cmpAll, setCmpAll] = useState(false);
  const [name, setName] = useState('');
  const [tick, setTick] = useState(0);
  const ydoc = bk.book?.ydoc ?? null;

  useEffect(() => {
    if (!open) return;
    // 1.0 openHistory: the list, nothing open
    setViewId(null);
    setPeekId(null);
    setCmpId(null);
    let gone = false;
    void loadClosure().then((x) => {
      if (!gone) setC(x);
    });
    return () => {
      gone = true;
    };
  }, [open]);

  setClosureT(t as (k: string, p?: Record<string, unknown>) => string);
  // re-read when the book's meta or sections change (bk.rows is rebuilt then) or after an action here
  const L: Live | null = useMemo(() => (open && c && ydoc ? live(c, ydoc) : null), [open, c, ydoc, bk.rows, tick, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const snaps = L?.state.history ?? [];
  const snap = viewId ? snaps.find((s) => s.id === viewId) ?? null : null;
  useEffect(() => {
    if (viewId && L && !snap) {
      setViewId(null);
      setPeekId(null);
    }
  }, [viewId, L, snap]);
  const nowWords = L && c ? (c.setState(L.state), c.api.bookWordTotal()) : 0;

  /** The snapshot (or the book) is gone: say so, and show the list as it now stands. */
  const gone = () => {
    setViewId(null);
    setPeekId(null);
    setTick((n) => n + 1);
    toast(t('next.snapshotGone'), 'Info');
  };
  const doSave = () => {
    if (!c || !ydoc || !bk.isLive(ydoc)) return;
    saveNamed(c, ydoc, name);
    setName('');
    setViewId(null);
    setPeekId(null);
    setTick((n) => n + 1);
    toast(t('history.savedToast'), 'History');
  };
  const askDelete = async (id: string) => {
    if (!c || !ydoc) return;
    const s = snaps.find((x) => x.id === id);
    const ok = await confirm({ title: t('history.delTitle'), body: t('history.delBody', { name: s ? snapshotLabel(s, t) : '' }), yes: t('history.delete'), no: t('confirm.keep') });
    if (ok !== true) return;
    // the book this room read must still be the live one (another tab may have replaced it while the confirm waited)
    if (!bk.isLive(ydoc) || !deleteSnapshot(c, ydoc, id)) return gone();
    if (viewId === id) {
      setViewId(null);
      setPeekId(null);
    }
    setTick((n) => n + 1);
  };
  const askRestore = async (id: string) => {
    if (!c || !ydoc) return;
    const s = snaps.find((x) => x.id === id);
    live(c, ydoc); // 1.0's state for the open book, for deskTrulyEmpty
    const empty = c.api.deskTrulyEmpty();
    const ok = await confirm({
      title: t('history.restoreTitle'),
      body: t(empty ? 'history.restoreBodyEmpty' : 'history.restoreBody', { name: s ? snapshotLabel(s, t) : '' }), // BEUK:bugs — says only what restore will do
      yes: t('history.restoreAll'),
      no: t('confirm.keep'),
    });
    if (ok !== true) return;
    /* `ydoc` is the book this room read when Restore was clicked. While the confirm waited another tab may have opened
       a backup: this tab then moved to the newer generation and destroyed that Y.Doc. Restoring from it would replace the
       newer book with a stale one (and delete the newer generation), so ask the provider, live, first. */
    if (!bk.isLive(ydoc)) return gone();
    const doc = restoreDoc(c, ydoc, id);
    if (!doc) return gone();
    const done = await bk.replaceBook(doc, ydoc);
    if (!done) {
      if (!bk.isLive(ydoc)) gone(); // replaced meanwhile: nothing written; a storage failure has had its own toast
      return;
    }
    setViewId(null);
    setPeekId(null);
    onClose();
    toast(t('history.restoredToast'), 'History');
  };
  const doRestoreSection = (secId: string) => {
    if (!c || !ydoc || !viewId) return;
    if (!bk.isLive(ydoc)) return gone();
    const at = restoreSection(c, ydoc, viewId, secId);
    if (at === null) return gone();
    bk.select(at); // 1.0: state.activeId = restored.id (the desk shows it); 2.0 never writes activeId on a selection
    setTick((n) => n + 1);
    toast(t('history.sectionRestoredToast'), 'History');
  };

  let body: ReactNode = null;
  if (L && c) {
    if (!snap) {
      body = (
        <div id="historyList">
          {snaps.length ? (
            snaps.map((s) => (
              <div className="hist-row" key={s.id}>
                <button
                  type="button"
                  className="hist-main"
                  data-hopen={s.id}
                  onClick={() => {
                    setViewId(s.id);
                    setPeekId(null);
                    setCmpId(null);
                  }}
                >
                  <span className="hist-name">
                    {snapshotLabel(s, t)}
                    {s.auto ? (
                      <>
                        {' '}
                        <span className="hist-auto">{t('history.autoTag')}</span>
                      </>
                    ) : null}
                  </span>
                  <span className="hist-meta">
                    {snapshotWhen(s, lang)} · {histWordCount(s.words, t, lang)}
                    <span className="hist-delta" data-hdelta={s.id} title={t('history.deltaTitle')}>
                      {histDeltaText(s.words, nowWords, t, lang)}
                    </span>
                  </span>
                </button>
                <button type="button" className="tb-btn hist-del" data-hdel={s.id} onClick={() => void askDelete(s.id)}>
                  {t('history.delete')}
                </button>
              </div>
            ))
          ) : (
            <p className="ins-none">{t('history.empty')}</p>
          )}
        </div>
      );
    } else {
      body = (
        <div id="historyDetail">
          <button
            type="button"
            className="linkish hist-back"
            data-hback="1"
            onClick={() => {
              setViewId(null);
              setPeekId(null);
              setCmpId(null);
            }}
          >
            ← {t('history.back')}
          </button>
          <div className="hist-detail-h">{snapshotLabel(snap, t)}</div>
          <p className="ins-caption">
            {snapshotWhen(snap, lang)} · {histWordCount(snap.words, t, lang)} · {t('history.sections', { n: snap.doc.sections.length })}
          </p>
          <div className="hist-restore-row">
            <button type="button" className="tb-btn" data-hrestore={snap.id} onClick={() => void askRestore(snap.id)}>
              {t('history.restoreAll')}
            </button>
            <button type="button" className="linkish" data-hdel={snap.id} onClick={() => void askDelete(snap.id)}>
              {t('history.delete')}
            </button>
          </div>
          <Diff c={c} L={L} snap={snap} t={t} lang={lang} cmpId={cmpId} setCmpId={setCmpId} cmpAll={cmpAll} setCmpAll={setCmpAll} />
          {snap.doc.sections.map((s, i) => {
            const id = String(s.id);
            return (
              <Fragment key={id + ':' + i}>
                <div className="hist-sec-row">
                  <span className="hist-sec-main">
                    <span className="hist-sec-name">{c.api.snapshotSectionName(s)}</span>
                    <span className="hist-sec-meta">{histWordCount(c.api.snapshotSectionWords(snap.doc, s), t, lang)}</span>
                  </span>
                  <span className="hist-sec-btns">
                    <button type="button" className="tb-btn" data-hpeek={id} onClick={() => setPeekId(peekId === id ? null : id)}>
                      {peekId === id ? t('history.hide') : t('history.read')}
                    </button>
                    <button type="button" className="tb-btn" data-hrsec={id} onClick={() => doRestoreSection(id)}>
                      {t('history.restoreSection')}
                    </button>
                  </span>
                </div>
                {peekId === id && (
                  <div className="hist-peek">
                    <Peek content={s.content} t={t} />
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      );
    }
  }

  return (
    <Dialog open={open} onClose={onClose} id="modalHistory" z={70} labelledBy="histH" className="wide ins-modal">
      <h2 id="histH">
        <Icon name="History" />
        {t('history.title')}
      </h2>
      <p className="m-sub">{t('history.sub')}</p>
      <div className="hist-save-row">
        <input
          className="txt-input hist-name-input"
          id="histNameInput"
          type="text"
          placeholder={t('history.namePh')}
          aria-label={t('history.namePh')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              doSave();
            }
          }}
        />
        <button type="button" className="tb-btn" id="btnHistSave" onClick={doSave} disabled={!c || !ydoc}>
          {t('history.saveBtn')}
        </button>
      </div>
      {body}
      <p className="hist-note">{t('history.storage')}</p>
      <p className="hist-note">{t('history.storageChop')}</p>
      <div className="modal-actions">
        <button type="button" className="tb-btn" id="btnCloseHistory" onClick={onClose}>
          {t('history.close')}
        </button>
      </div>
    </Dialog>
  );
}

const DIFF_KINDS: [keyof ReturnType<Closure['api']['histSectionDiff']>, string][] = [
  ['added', 'history.diffAdded'],
  ['removed', 'history.diffRemoved'],
  ['leftout', 'history.diffLeftOut'],
  ['broughtin', 'history.diffBroughtIn'],
  ['changed', 'history.diffChanged'],
];

/** 1.0's histDiffHtml (with BEUK:compare's word-by-word block under a changed row). */
function Diff(props: { c: Closure; L: Live; snap: HistoryEntry; t: T; lang: string; cmpId: string | null; setCmpId: (v: string | null) => void; cmpAll: boolean; setCmpAll: (v: boolean) => void }) {
  const { c, L, snap, t, lang, cmpId, setCmpId } = props;
  c.setState(L.state);
  const diff = c.api.histSectionDiff(snap.doc, liveDoc(L));
  const all = diff.added.concat(diff.removed, diff.leftout, diff.broughtin, diff.changed);
  const tt = t as (k: string, p?: Record<string, unknown>) => string;
  if (!all.length)
    return (
      <div className="hist-diff" id="histDiff">
        <h3 className="hist-diff-h">{t('history.diffH')}</h3>
        <p className="hist-diff-sub">{t('history.diffSub')}</p>
        <p className="hist-diff-none">{t('history.diffNone')}</p>
      </div>
    );
  const maxAbs = Math.max(1, Math.max(...all.map((r) => Math.abs(r.delta))));
  const row = (r: DiffRow, kind: string) => {
    const n =
      r.note === 'out'
        ? t('history.diffNotCounted')
        : r.delta !== 0
          ? histDeltaText(0, r.delta, t, lang, { up: 'history.dUp', down: 'history.dDown', same: 'history.diffReworded' })
          : kind === 'changed'
            ? t('history.diffReworded')
            : histWordCount(0, t, lang);
    const pct = ((Math.abs(r.delta) / maxAbs) * 100).toFixed(1) + '%';
    const title = kind === 'changed' && r.delta !== 0 ? fmtNum(r.before, lang) + ' → ' + fmtNum(r.after, lang) : undefined;
    const isOpen = kind === 'changed' && cmpId === r.id;
    return (
      <Fragment key={kind + ':' + r.id}>
        <div className="hist-diff-row" data-hdiff={kind} data-hdiff-id={r.id}>
          <span className="hist-diff-name" dir="auto">
            {r.name}
          </span>
          <span className="hist-diff-n" title={title}>
            {n}
          </span>
          <span className="hist-diff-bar" aria-hidden="true">
            <span>{r.delta < 0 ? <i className="down" style={{ width: pct }} /> : null}</span>
            <span>{r.delta > 0 ? <i className="up" style={{ width: pct }} /> : null}</span>
          </span>
          {kind === 'changed' ? (
            <button type="button" className="tb-btn hist-cmp-btn" data-hcmp={r.id} aria-expanded={isOpen} onClick={() => setCmpId(cmpId === r.id ? null : r.id)}>
              {tt(isOpen ? 'history.cmpHide' : 'history.cmp')}
            </button>
          ) : null}
        </div>
        {isOpen ? <Compare {...props} secId={r.id} /> : null}
      </Fragment>
    );
  };
  return (
    <div className="hist-diff" id="histDiff">
      <h3 className="hist-diff-h">{t('history.diffH')}</h3>
      <p className="hist-diff-sub">{t('history.diffSub')}</p>
      {DIFF_KINDS.map(([kind, key]) =>
        diff[kind].length ? (
          <Fragment key={kind}>
            <div className="hist-diff-lab">{tt(key)}</div>
            {diff[kind].map((r) => row(r, kind))}
          </Fragment>
        ) : null,
      )}
    </div>
  );
}

/** 1.0's histCmpHtml (BEUK:compare). */
function Compare({ c, L, snap, t, lang, cmpAll, setCmpAll, secId }: Parameters<typeof Diff>[0] & { secId: string }) {
  const was = snap.doc.sections.find((s) => s.id === secId), now = L.state.sections.find((s) => s.id === secId);
  if (!was || !now) return null;
  const d = c.api.histTextDiff(was.content, now.content);
  const head = (x: Record<string, unknown>) => [x.title, x.subtitle].map((v) => String(v || '').trim()).filter(Boolean).join(' — ');
  const out: ReactNode[] = [];
  let quiet = 0;
  const flushQuiet = () => {
    if (quiet)
      out.push(
        <p className="hist-cmp-gap" key={'gap' + out.length}>
          {t('history.cmpSame', { n: fmtNum(quiet, lang) })}
        </p>,
      );
    quiet = 0;
  };
  d.rows.forEach((r, i) => {
    if (r.kind === 'same' && !cmpAll) {
      quiet++;
      return;
    }
    flushQuiet();
    const orn = r.parts.length === 1 && /^\*\s*\*\s*\*$/.test(r.parts[0]!.s.trim());
    out.push(
      orn ? (
        <p className={'hist-orn hist-cmp-' + r.kind} key={i}>
          ❦
        </p>
      ) : (
        <p className={'hist-cmp-' + r.kind} dir="auto" key={i}>
          {r.parts.map((p, j) => (
            <Part p={p} t={t} key={j} />
          ))}
        </p>
      ),
    );
  });
  flushQuiet();
  return (
    <div className="hist-cmp" id="histCmp" data-hcmp-for={secId}>
      <div className="hist-cmp-top">
        <span className="hist-cmp-sum">{t('history.cmpSum', { a: fmtNum(d.added, lang), r: fmtNum(d.removed, lang) })}</span>
        <span className="seg hist-cmp-seg" role="group" aria-label={t('history.cmpView')}>
          <button type="button" data-hcmpall="0" className={cmpAll ? '' : 'active'} aria-pressed={!cmpAll} onClick={() => setCmpAll(false)}>
            {t('history.cmpOnly')}
          </button>
          <button type="button" data-hcmpall="1" className={cmpAll ? 'active' : ''} aria-pressed={cmpAll} onClick={() => setCmpAll(true)}>
            {t('history.cmpAll')}
          </button>
        </span>
      </div>
      <p className="hist-cmp-legend">{t('history.cmpLegend')}</p>
      {head(was) !== head(now) ? (
        <p className="hist-cmp-title">
          <b>{t('history.cmpTitle')}</b>{' '}
          {c.api.histWordDiff(head(was), head(now)).map((p, j) => (
            <Part p={p} t={t} key={j} />
          ))}
        </p>
      ) : null}
      {out}
    </div>
  );
}
