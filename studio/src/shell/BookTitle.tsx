import { useEffect, useRef, useState } from 'react';
import { realTitle, useBook } from '../book/BookProvider';
import { getMeta, setMeta } from '../book/hooks';
import { useLocale } from '../i18n/LocaleProvider';
import { useStartFirstBook } from '../sample/startFirst';
import { Icon } from './Icon';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The book's name in the top bar, and the place to change it (V, 2026-11-21: "Can we have an edit there?").
    Press the name and it becomes a field: Enter or leaving the field keeps what was typed, Escape leaves the name as
    it was. It writes the very value Project Settings and the Title Page edit (the book's meta.title), with the same
    bookkeeping as GenEditor's bindMeta: a real title is the writer's own (titleSource "writer"), a blank or
    placeholder one is nobody's. No new wording: the label is Project Settings' own "Book title". */
export function BookTitle() {
  const bk = useBook();
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement | null>(null);
  const cancelled = useRef(false);
  const startFirst = useStartFirstBook();
  const naming = useRef(false); // a first visit pressed the name: the first book is opening, and is to be named
  const ydoc = bk.phase === 'open' ? (bk.book?.ydoc ?? null) : null;
  const shown = bk.title || t('misc.untitledBook');

  useEffect(() => {
    if (editing && input.current) {
      input.current.focus();
      input.current.select();
    }
  }, [editing]);
  // the book under the bar changed (another book opened, the desk cleared): an edit of the old name ends unsaved.
  // The one exception is the first book this very press asked for: its name is what the writer came to type.
  useEffect(() => {
    if (naming.current && ydoc) {
      naming.current = false;
      cancelled.current = false;
      setValue('');
      setEditing(true);
    } else setEditing(false);
  }, [ydoc]);

  const begin = () => {
    if (!ydoc) {
      // no book on this device yet: naming it starts it
      if (bk.phase !== 'empty') return;
      naming.current = true;
      void startFirst().then((ok) => {
        if (!ok) naming.current = false;
      });
      return;
    }
    cancelled.current = false;
    setValue(bk.title || '');
    setEditing(true);
  };
  const keep = () => {
    setEditing(false);
    if (cancelled.current || !ydoc || !bk.isLive(ydoc)) return;
    const next = value.trim();
    if (next === (bk.title || '')) return;
    const m = getMeta(ydoc, 'meta');
    const meta: Rec = { ...(isRec(m) ? m : {}), title: next };
    if (realTitle(next) !== '') meta.titleSource = 'writer';
    else delete meta.titleSource;
    setMeta(ydoc, 'meta', meta as never);
  };

  if (editing) {
    return (
      <input
        ref={input}
        className="book-title book-title-input"
        id="projectTitleInput"
        type="text"
        aria-label={t('set.bookTitle')}
        placeholder={t('misc.untitledBook')}
        value={value}
        maxLength={300}
        onChange={(e) => setValue(e.target.value)}
        onBlur={keep}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    );
  }
  if (!ydoc && bk.phase !== 'empty') {
    return (
      <div className="book-title" id="projectTitleDisplay">
        {shown}
      </div>
    );
  }
  return (
    <button type="button" className="book-title book-title-btn" id="projectTitleDisplay" title={t('set.bookTitle')} aria-label={t('set.bookTitle') + ': ' + shown} onClick={begin}>
      <span className="book-title-text">{shown}</span>
      <Icon name="PencilLine" />
    </button>
  );
}
