import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBook } from '../book/BookProvider';
import { useMeta } from '../book/hooks';
import { loadClosure, type Closure, type Note, type ResearchFile } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import { Dialog } from '../shell/Dialog';
import { Icon, type IconName } from '../shell/Icon';
import { useToast } from '../shell/Toasts';
import { addRead, bytesOf, fmtDateIntl, namesIn, nbState, nowIso, readOne, readResearch, textOf, writeNotebook, writeNotes, type FileItem, type NbState } from './notebook';

/* 1.0's Notebook (client/index.html #modalNotebook, BEUK:notebook and
   BEUK:research: nbRenderList, nbRenderDetail, rsFilesHtml, rsViewHtml and
   initNotebook's handlers), inventory C7, with 1.0's ids, classes, keys and
   behaviour:

   - the list: the notes pinned to the section on the desk first ("Pinned
     here"), then by folder (no folder last); search over title, text,
     folder, link and file names;
   - the detail: title, folder (with the book's folders offered), text, the
     source link (http/https only, 1.0's rsUrl; anything else refused with
     1.0's toast and aria-invalid), the files, the Covenant names found in
     the note, the pins, "Edited …", Delete with Undo;
   - research files: Add files (1.0's accept list) or a drop on the open
     Notebook; each file opens inside the Notebook — a picture as <img> from
     a data: URL (an SVG never as a document), text as text, a PDF in a
     frame, a recording or a clip in a player, from ONE object URL at a time
     that is revoked when the file closes, another opens or the Notebook
     closes (players paused and emptied first, as 1.0's rsReleaseView); a new
     tab only for a PDF or a raster picture (1.0's rsTabOk); download;
     remove with Undo.
   Every name, type and text from the book is rendered as React text or an
   attribute (escaped); the only URLs are 1.0's rsUrl output (http/https),
   data: of a kept picture type, and the studio's own blob: URLs.

   The Covenant names (1.0's nbNames, the Covenant's own matcher) are found
   and shown; opening the Covenant from a chip is wave 3, so the chips are
   there but do nothing yet (aria-disabled). */

type Props = { open: boolean; onClose: () => void };

export function NotebookDialog({ open, onClose }: Props) {
  const { t } = useLocale();
  return (
    <Dialog open={open} onClose={onClose} id="modalNotebook" z={69} labelledBy="nbH" className="wide nb-modal">
      <h2 id="nbH">
        <Icon name="NotebookPen" />
        <span>{t('nb.title')}</span>
      </h2>
      <p className="m-sub">{t('nb.sub')}</p>
      <NotebookBody onClose={onClose} />
    </Dialog>
  );
}

const RS_ICONS: Record<string, IconName> = { 'file-image': 'FileImage', 'file-text': 'FileText', 'file-audio': 'FileAudio', 'file-video': 'FileVideo', 'file-type': 'FileType', file: 'File' };

function NotebookBody({ onClose }: { onClose: () => void }) {
  const { t, lang } = useLocale();
  const tt = t as (k: string, p?: Record<string, unknown>) => string;
  const bk = useBook();
  const toast = useToast();
  const ydoc = bk.book?.ydoc ?? null;
  const [c, setC] = useState<Closure | null>(null);
  const nbVal = useMeta('notebook');
  const rsVal = useMeta('research');
  const bibleVal = useMeta('bible');
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [rsOpen, setRsOpen] = useState<string | null>(null);
  const [urlBad, setUrlBad] = useState(false);
  const [namesText, setNamesText] = useState<string | null>(null);
  const picked = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pinSel = useRef<HTMLSelectElement>(null);
  const focusAfter = useRef<{ note: string; sel: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void loadClosure().then((cl) => alive && setC(cl)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const activeId = bk.active === null ? null : bk.rows.find((r) => r.index === bk.active)?.id ?? null;
  // 1.0's state, re-read whenever the notebook, the files, the Covenant or the sections change
  // the research files (up to 25 MB) are read again only when they change, not at every keystroke in a note
  const research = useMemo(
    () => (c && ydoc ? readResearch(c, ydoc) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, ydoc, rsVal],
  );
  const state: NbState | null = useMemo(
    () => (c && ydoc && research ? nbState(c, ydoc, research) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, ydoc, research, nbVal, bibleVal, bk.rows],
  );
  const notes = state?.notebook.notes ?? [];
  const files = state?.research.files ?? [];
  const note = notes.find((n) => n.id === sel) ?? null;

  // 1.0's openNotebook: the note pinned to the section on the desk, else the first; the search emptied (a layout effect: in place before the first click can land)
  useLayoutEffect(() => {
    if (!state || picked.current) return;
    picked.current = true;
    const here = state.notebook.notes.find((n) => (n.secs || []).includes(activeId ?? ''));
    setSel((cur) => cur ?? (here ? here.id : state.notebook.notes[0]?.id ?? null));
  }, [state, activeId]);

  // a field focused after a re-render (1.0 focuses the title of a new note, the button of a note chosen)
  useEffect(() => {
    const f = focusAfter.current;
    // only once the new note's own detail is drawn (its fields are keyed by the note)
    if (!f || document.getElementById('nbDetail')?.querySelector('[data-note]')?.getAttribute('data-note') !== f.note) return;
    focusAfter.current = null;
    document.querySelector<HTMLElement>(f.sel)?.focus();
  });

  // the Covenant's names, 250 ms after the writer stops typing (1.0's namesTimer)
  useEffect(() => {
    setNamesText(note ? note.title + '\n' + note.body : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);
  useEffect(() => {
    if (!note) return;
    const h = setTimeout(() => setNamesText(note.title + '\n' + note.body), 250);
    return () => clearTimeout(h);
  }, [note]);

  const rsFile = useCallback((id: string) => files.find((f) => f.id === id) ?? null, [files]);
  const secName = useCallback(
    (id: string | null) => {
      if (!c || !state || !id) return null;
      const s = state.sections.find((x) => x.id === id);
      return s ? c.api.snapshotSectionName(s) : null;
    },
    [c, state],
  );

  if (!c || !state || !ydoc) return <ModalFoot t={tt} onClose={onClose} />;
  const a = c.api;

  /* ---- writes (1.0's nbTouch → noteBookEdited, here the book through Yjs) ---- */
  const write = (ns: Note[], fs: ResearchFile[] = files) => writeNotebook(c, ydoc, ns, fs);
  /** A note's own fields (never the files it names): the notebook alone is written. */
  const change = (id: string, fn: (n: Note) => void) => {
    const ns = notes.map((n) => {
      if (n.id !== id) return n;
      const m = { ...n };
      fn(m);
      m.at = nowIso();
      return m;
    });
    writeNotes(c, ydoc, state, ns);
  };

  const nbNew = (): Note => {
    const n: Note = { id: a.uid(), title: '', body: '', at: nowIso() };
    writeNotes(c, ydoc, state, [n, ...notes]);
    setSel(n.id);
    setQ('');
    setRsOpen(null);
    focusAfter.current = { note: n.id, sel: '#nbTitle' };
    return n;
  };
  const nbDelete = (id: string) => {
    const i = notes.findIndex((n) => n.id === id);
    if (i < 0) return;
    const gone = notes[i]!;
    const goneFiles = (gone.files || []).map(rsFile).filter((f): f is ResearchFile => !!f);
    const rest = notes.filter((n) => n.id !== id);
    if (sel === id) setSel(rest.length ? rest[Math.min(i, rest.length - 1)]!.id : null);
    write(rest);
    const name = gone.title || tt('nb.untitled');
    toast(tt('nb.deleted', { name }), 'Trash2', {
      label: tt('chop.undo'),
      ms: a.CHOP_TOAST_MS,
      onClick: () => {
        if (!bk.isLive(ydoc)) return;
        const now = nbState(c, ydoc);
        if (now.notebook.notes.some((n) => n.id === gone.id)) return;
        const list = now.notebook.notes.slice();
        list.splice(Math.min(i, list.length), 0, gone);
        // the files only this note named come back with it (1.0 keeps them on the desk while the toast is up)
        const have = new Set(now.research.files.map((f) => f.id));
        writeNotebook(c, ydoc, list, now.research.files.concat(goneFiles.filter((f) => !have.has(f.id))));
        setSel(gone.id);
      },
    });
  };
  const addFiles = async (list: File[]) => {
    const items: FileItem[] = [];
    for (const f of list) items.push({ name: f.name, type: f.type, size: f.size, data: await readOne(c, f) });
    if (!bk.isLive(ydoc)) return;
    const now = nbState(c, ydoc);
    const r = addRead(c, now, sel, items, tt);
    if (r.added.length && r.note) {
      writeNotebook(c, ydoc, r.notes, r.files);
      setRsOpen(r.added[r.added.length - 1]!.id);
      setSel(r.note.id);
      toast(r.added.length === 1 ? tt('rs.added1', { name: r.added[0]!.name }) : tt('rs.added', { n: a.fmtNum(r.added.length) }), 'Paperclip');
    }
    if (r.refused.length) toast(r.refused.join(' '), 'TriangleAlert');
  };
  const rsRemove = (noteId: string, fileId: string) => {
    const n = notes.find((x) => x.id === noteId);
    if (!n || !n.files) return;
    const i = n.files.indexOf(fileId);
    if (i < 0) return;
    const f = rsFile(fileId);
    if (rsOpen === fileId) setRsOpen(null);
    write(
      notes.map((x) => {
        if (x.id !== noteId) return x;
        const m: Note = { ...x, files: (x.files || []).filter((y) => y !== fileId), at: nowIso() };
        if (!m.files!.length) delete m.files;
        return m;
      }),
    );
    // the file stays with the toast: Undo names it again
    toast(tt('rs.removed', { name: f ? f.name : '' }), 'Trash2', {
      label: tt('chop.undo'),
      ms: a.CHOP_TOAST_MS,
      onClick: () => {
        if (!bk.isLive(ydoc) || !f) return;
        const now = nbState(c, ydoc);
        const m = now.notebook.notes.find((x) => x.id === noteId);
        if (!m || (m.files || []).includes(fileId)) return;
        const fl = (m.files || []).slice();
        fl.splice(Math.min(i, fl.length), 0, fileId);
        const ns = now.notebook.notes.map((x) => (x.id === noteId ? { ...x, files: fl } : x));
        const fs = now.research.files.some((x) => x.id === fileId) ? now.research.files : now.research.files.concat([f]);
        writeNotebook(c, ydoc, ns, fs);
      },
    });
  };
  const rsDownload = (f: ResearchFile | null) => {
    if (!f || a.rsIsRef(f.data)) return;
    const url = URL.createObjectURL(new Blob([bytesOf(f)], { type: f.mediaType }));
    const el = document.createElement('a');
    el.href = url;
    el.download = f.name;
    document.body.appendChild(el);
    el.click();
    el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  const go = (id: string) => {
    const row = bk.rows.find((r) => r.id === id);
    onClose();
    if (row) bk.select(row.index);
  };

  /* ---- the list (1.0's nbRenderList) ---- */
  const item = (n: Note) => {
    const meta = [n.folder || '', n.secs && n.secs.length ? tt('nb.pins', { n: a.fmtNum(n.secs.length) }) : '', n.files && n.files.length ? tt('rs.count', { n: a.fmtNum(n.files.length) }) : ''].filter(Boolean).join(' · ');
    return (
      <button
        type="button"
        key={n.id}
        className={'bib-item nb-item' + (n.id === sel ? ' is-sel' : '')}
        data-nb={n.id}
        aria-pressed={n.id === sel}
        onClick={() => {
          setSel(n.id);
          setRsOpen(null);
          setUrlBad(false);
        }}
      >
        <Icon name="StickyNote" />
        <span className="nb-item-txt">
          <span className={'bib-item-name' + (n.title ? '' : ' is-blank')} dir="auto">
            {n.title || tt('nb.untitled')}
          </span>
          {meta && (
            <span className="nb-item-meta" dir="auto">
              {meta}
            </span>
          )}
        </span>
      </button>
    );
  };
  let list: ReactNode;
  const qq = q.trim().toLowerCase();
  if (!notes.length) list = <p className="nb-quiet">{tt('nb.empty')}</p>;
  else {
    const shown = notes.filter((n) => !qq || (n.title + '\n' + n.body + '\n' + (n.folder || '') + '\n' + (n.url || '') + '\n' + (n.files || []).map((id) => (rsFile(id) || { name: '' }).name || '').join('\n')).toLowerCase().includes(qq));
    if (!shown.length) list = <p className="nb-quiet">{tt('nb.noMatch', { q: q.trim() })}</p>;
    else {
      const hereName = secName(activeId);
      const pinned = hereName ? shown.filter((n) => (n.secs || []).includes(activeId!)) : [];
      const rest = shown.filter((n) => !pinned.includes(n));
      const folders = Array.from(new Set(rest.map((n) => n.folder || ''))).sort((x, y) => Number(x === '') - Number(y === '') || x.localeCompare(y));
      list = (
        <>
          {pinned.length > 0 && (
            <div className="nb-group" data-nbgroup="here">
              <div className="nb-group-h">
                <Icon name="Pin" />
                {tt('nb.pinnedHere', { sec: hereName })}
              </div>
              {pinned.map(item)}
            </div>
          )}
          {folders.map((f) => (
            <div className="nb-group" data-nbgroup={f} key={'g:' + f}>
              <div className="nb-group-h">
                <Icon name={f ? 'Folder' : 'File'} />
                <span dir="auto">{f || tt('nb.noFolder')}</span>
              </div>
              {rest.filter((n) => (n.folder || '') === f).map(item)}
            </div>
          ))}
        </>
      );
    }
  }

  /* ---- the detail (1.0's nbRenderDetail and rsFilesHtml) ---- */
  let detail: ReactNode;
  if (!note) detail = <p className="nb-quiet nb-pick">{tt(notes.length ? 'nb.pick' : 'nb.pickFirst')}</p>;
  else {
    const folders = Array.from(new Set(notes.map((x) => x.folder).filter((x): x is string => !!x))).sort();
    const pins = (note.secs || []).filter((id) => secName(id));
    const opts = state.sections.filter((s) => !pins.includes(String(s.id)) && s.type !== 'cover');
    const nfiles = (note.files || []).map(rsFile).filter((f): f is ResearchFile => !!f);
    const openFile = nfiles.find((f) => f.id === rsOpen) ?? null;
    const L = a.rsLimits();
    const names = namesText === null ? [] : namesIn(c, state, namesText);
    const hasCov = (() => {
      c.setState(state);
      return a.bibleAllEntries().length > 0;
    })();
    detail = (
      <div key={note.id} data-note={note.id}>
        <div className="nb-row">
          <label className="field-lab" htmlFor="nbTitle">
            {tt('nb.titleLab')}
          </label>
          <input
            className="txt-input"
            id="nbTitle"
            dir="auto"
            maxLength={120}
            defaultValue={note.title}
            placeholder={tt('nb.untitled')}
            onInput={(e) => {
              const v = a.nbLine((e.target as HTMLInputElement).value, 120);
              change(note.id, (m) => (m.title = v));
            }}
          />
        </div>
        <div className="nb-row">
          <label className="field-lab" htmlFor="nbFolder">
            {tt('nb.folderLab')}
          </label>
          <input
            className="txt-input"
            id="nbFolder"
            dir="auto"
            maxLength={60}
            list="nbFolders"
            defaultValue={note.folder || ''}
            placeholder={tt('nb.folderPh')}
            ref={(el) => {
              // 1.0 keeps the folder on the input's native change (Enter, leaving the field, a pick from the list)
              if (el)
                el.onchange = () => {
                  const f = a.nbLine(el.value, 60);
                  change(note.id, (m) => {
                    if (f) m.folder = f;
                    else delete m.folder;
                  });
                };
            }}
          />
          <datalist id="nbFolders">
            {folders.map((f) => (
              <option value={f} key={f} />
            ))}
          </datalist>
        </div>
        <div className="nb-row">
          <label className="field-lab" htmlFor="nbBody">
            {tt('nb.bodyLab')}
          </label>
          <textarea
            className="txt-input nb-body"
            id="nbBody"
            dir="auto"
            rows={12}
            maxLength={50000}
            defaultValue={note.body}
            onInput={(e) => {
              const v = (e.target as HTMLTextAreaElement).value.slice(0, 50000);
              change(note.id, (m) => (m.body = v));
            }}
          />
        </div>
        <div className="nb-row">
          <label className="field-lab" htmlFor="nbUrl">
            {tt('rs.urlLab')}
          </label>
          <div className="rs-url">
            <input
              className="txt-input"
              id="nbUrl"
              type="url"
              dir="ltr"
              maxLength={2000}
              defaultValue={note.url || ''}
              key={'url:' + (note.url || '')}
              placeholder="https://"
              aria-invalid={urlBad ? 'true' : undefined}
              onInput={() => setUrlBad(false)}
              ref={(el) => {
                // 1.0: kept on the native change; http(s) only (rsUrl), anything else refused and not kept
                if (el)
                  el.onchange = () => {
                    const raw = el.value.trim(), u = a.rsUrl(raw);
                    if (raw && !u) {
                      setUrlBad(true);
                      toast(tt('rs.urlBad'), 'TriangleAlert');
                      return;
                    }
                    setUrlBad(false);
                    if ((note.url || '') === u) return;
                    change(note.id, (m) => {
                      if (u) m.url = u;
                      else delete m.url;
                    });
                  };
              }}
            />
            {note.url && a.rsUrl(note.url) === note.url && (
              <a className="tb-btn" id="nbUrlGo" href={note.url} target="_blank" rel="noopener noreferrer">
                <Icon name="ExternalLink" />
                {tt('rs.urlOpen')}
              </a>
            )}
          </div>
        </div>
        <div className="nb-row" id="rsRow">
          <div className="field-lab">{tt('rs.filesLab')}</div>
          {nfiles.length ? (
            <ul className="rs-files">
              {nfiles.map((f) => {
                const on = rsOpen === f.id;
                return (
                  <li className={'rs-file' + (on ? ' is-open' : '')} data-rsfile={f.id} key={f.id}>
                    <button type="button" className="rs-name" data-rsview={f.id} aria-expanded={on} title={tt(on ? 'rs.hide' : 'rs.view', { name: f.name })} onClick={() => setRsOpen(on ? null : f.id)}>
                      <Icon name={RS_ICONS[a.rsIcon(f)] ?? 'File'} />
                      <span dir="auto">{f.name}</span>
                    </button>
                    <span className="rs-meta">{tt('rs.kind.' + a.rsKind(f)) + ' · ' + a.rsSize(f.bytes)}</span>
                    <button type="button" className="ol-mini" data-rsdl={f.id} aria-label={tt('rs.download', { name: f.name })} title={tt('rs.download', { name: f.name })} onClick={() => rsDownload(f)}>
                      <Icon name="Download" />
                    </button>
                    <button type="button" className="ol-mini" data-rsdel={f.id} aria-label={tt('rs.remove', { name: f.name })} title={tt('rs.remove', { name: f.name })} onClick={() => rsRemove(note.id, f.id)}>
                      <Icon name="X" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="nb-quiet">{tt('rs.none')}</p>
          )}
          <div className="rs-add">
            <button type="button" className="tb-btn" id="rsAdd" onClick={() => fileInput.current?.click()}>
              <Icon name="Paperclip" />
              {tt('rs.add')}
            </button>
            <span className="nb-quiet">{tt('rs.hint', { mb: a.fmtNum(L.file / 1024 / 1024), used: (c.setState(state), a.rsSize(a.rsTotal())), total: a.fmtNum(L.total / 1024 / 1024) })}</span>
          </div>
          {openFile && <RsView c={c} f={openFile} t={tt} key={openFile.id + ':' + openFile.data.length} />}
        </div>
        <div className="nb-row">
          <div className="field-lab">{tt('nb.namesLab')}</div>
          <div id="nbNames">
            {!hasCov ? (
              <p className="nb-quiet">{tt('nb.namesNoCov')}</p>
            ) : !names.length ? (
              <p className="nb-quiet">{tt('nb.namesNone')}</p>
            ) : (
              <div className="nb-chips">
                {names.map((x) => (
                  // opening the Covenant from here is wave 3 (the Covenant room)
                  <button type="button" className="ol-chip" data-nbcov={x.id} key={x.id} aria-disabled="true">
                    <Icon name="BookMarked" />
                    {tt('nb.nameN', { name: x.name, n: a.fmtNum(x.n) })}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="nb-row">
          <div className="field-lab">{tt('nb.pinsLab')}</div>
          {pins.length ? (
            <div className="nb-chips">
              {pins.map((id) => (
                <span className="nb-pin" key={id}>
                  <button type="button" className="ol-link" data-nbgo={id} title={tt('nb.go', { sec: secName(id) })} onClick={() => go(id)}>
                    {secName(id)}
                  </button>
                  <button
                    type="button"
                    className="ol-mini"
                    data-nbunpin={id}
                    aria-label={tt('nb.unpin', { sec: secName(id) })}
                    onClick={() =>
                      change(note.id, (m) => {
                        m.secs = (m.secs || []).filter((x) => x !== id);
                        if (!m.secs.length) delete m.secs;
                      })
                    }
                  >
                    <Icon name="X" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="nb-quiet">{tt('nb.pinNone')}</p>
          )}
          <select className="txt-input nb-pinsel" id="nbPin" aria-label={tt('nb.pinAdd')} ref={pinSel} defaultValue={opts.some((s) => s.id === activeId) ? activeId! : ''} key={'pin:' + pins.join(',') + ':' + activeId}>
            <option value="">{tt('nb.pinAdd')}</option>
            {opts.map((s) => (
              <option value={String(s.id)} key={String(s.id)}>
                {a.snapshotSectionName(s)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="tb-btn"
            id="nbPinDo"
            onClick={() => {
              const id = pinSel.current?.value;
              if (!id || !state.sections.some((s) => s.id === id) || (note.secs || []).includes(id)) return;
              change(note.id, (m) => (m.secs = (m.secs || []).concat([id])));
            }}
          >
            <Icon name="Pin" />
            {tt('nb.pinDo')}
          </button>
        </div>
        <div className="nb-foot">
          <span className="nb-quiet">{note.at ? tt('nb.edited', { when: fmtDateIntl(new Date(note.at), lang) }) : ''}</span>
          <button type="button" className="tb-btn" id="nbDelete" onClick={() => nbDelete(note.id)}>
            <Icon name="Trash2" />
            {tt('nb.delete')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <DropZone onFiles={(l) => void addFiles(l)} />
      <div className="bib-main nb-main">
        <div className="bib-side">
          <div className="nb-side-bar">
            <input className="txt-input bib-search" id="nbSearch" type="search" placeholder={tt('nb.search')} aria-label={tt('nb.search')} value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="tb-btn" id="btnNbNew" type="button" onClick={nbNew}>
              <Icon name="Plus" />
              <span>{tt('nb.new')}</span>
            </button>
          </div>
          <div id="nbList">{list}</div>
        </div>
        <div className="bib-detail" id="nbDetail">
          {detail}
        </div>
      </div>
      <input
        type="file"
        id="rsFileInput"
        multiple
        hidden
        accept={a.rsAccept()}
        ref={fileInput}
        onChange={(e) => {
          const l = Array.from(e.target.files || []);
          e.target.value = '';
          if (l.length) void addFiles(l);
        }}
      />
      <ModalFoot t={tt} onClose={onClose} />
    </>
  );
}

function ModalFoot({ t, onClose }: { t: (k: string) => string; onClose: () => void }) {
  return (
    <div className="modal-actions">
      <button className="tb-btn" id="btnCloseNotebook" type="button" onClick={onClose}>
        {t('nb.close')}
      </button>
    </div>
  );
}

/** Files dropped on the open Notebook land on the note in hand (a new note when none is): 1.0's handlers on the back. */
function DropZone({ onFiles }: { onFiles: (l: File[]) => void }) {
  const cb = useRef(onFiles);
  cb.current = onFiles;
  useEffect(() => {
    const m = document.getElementById('modalNotebook');
    if (!m) return;
    const has = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const over = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      m.classList.add('rs-drop');
    };
    const leave = (e: DragEvent) => {
      if (e.target === m || !m.contains(e.relatedTarget as Node | null)) m.classList.remove('rs-drop');
    };
    const drop = (e: DragEvent) => {
      m.classList.remove('rs-drop');
      if (!has(e)) return;
      e.preventDefault();
      const l = Array.from(e.dataTransfer!.files || []);
      if (l.length) cb.current(l);
    };
    m.addEventListener('dragenter', over);
    m.addEventListener('dragover', over);
    m.addEventListener('dragleave', leave);
    m.addEventListener('drop', drop);
    return () => {
      m.removeEventListener('dragenter', over);
      m.removeEventListener('dragover', over);
      m.removeEventListener('dragleave', leave);
      m.removeEventListener('drop', drop);
    };
  }, []);
  return null;
}

/** 1.0's rsViewHtml in #rsView: the file open in the Notebook. One object URL, made for this file and revoked when it
 *  closes (players paused and let go first: no detached load keeps reaching for it). */
function RsView({ c, f, t }: { c: Closure; f: ResearchFile; t: (k: string, p?: Record<string, unknown>) => string }) {
  const a = c.api;
  const k = a.rsKind(f);
  const ref = !!a.rsIsRef(f.data);
  const needsUrl = !ref && (k === 'pdf' || k === 'audio' || k === 'video' || a.rsTabOk(f));
  const [url] = useState(() => (needsUrl ? URL.createObjectURL(new Blob([bytesOf(f)], { type: f.mediaType })) : null));
  const box = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      const v = box.current;
      v?.querySelectorAll('audio,video').forEach((m) => {
        try {
          (m as HTMLMediaElement).pause();
          m.removeAttribute('src');
          (m as HTMLMediaElement).load();
        } catch {
          /* already gone */
        }
      });
      v?.querySelectorAll('iframe').forEach((fr) => {
        try {
          fr.src = 'about:blank';
        } catch {
          /* already gone */
        }
      });
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  let inner: ReactNode = null;
  if (ref) inner = <p className="nb-quiet">{t('rs.notHere')}</p>;
  else if (k === 'image') inner = <img className="rs-img" alt={f.name} src={'data:' + f.mediaType + ';base64,' + f.data} />;
  else if (k === 'text') {
    const all = textOf(f), cap = a.rsLimits().textShown;
    inner = (
      <>
        <pre className="rs-text" dir="auto">
          {all.slice(0, cap)}
        </pre>
        {all.length > cap && <p className="nb-quiet">{t('rs.textCut', { n: a.fmtNum(cap) })}</p>}
      </>
    );
  } else if (k === 'pdf' && url) inner = <iframe className="rs-pdf" title={f.name} src={url} />;
  else if (k === 'audio' && url) inner = <audio className="rs-audio" controls preload="metadata" src={url} />;
  else if (k === 'video' && url) inner = <video className="rs-video" controls preload="metadata" src={url} />;
  return (
    <div className="rs-view" id="rsView" data-rsopen={f.id} ref={box}>
      {inner}
      {a.rsTabOk(f) && url && (
        <button
          type="button"
          className="tb-btn rs-tab"
          data-rstab={f.id}
          onClick={() => {
            if (a.rsTabOk(f)) window.open(url, '_blank', 'noopener');
          }}
        >
          <Icon name="ExternalLink" />
          {t('rs.newTab')}
        </button>
      )}
    </div>
  );
}
