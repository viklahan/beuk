import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../i18n/LocaleProvider';
import { Icon } from './Icon';
import { useToast } from './Toasts';

/* 1.0's header language dropdown (buildUiLangMenu / syncUiLangMenu /
   toggleUiLangMenu): a pill with the current language's own name, opening
   the thirteen-language list; the choice is the interface's only, never
   the book's. Closes on a choice, Escape or a click outside. */
export function LangMenu() {
  const { lang, setLang, order, names, t } = useLocale();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="lang-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="tb-btn"
        id="btnUiLang"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="uiLangMenu"
        aria-label={t('set.uiLanguage')}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="Globe" className="lang-globe" />
        <span className="lang-name" id="uiLangName">
          {names[lang] || lang}
        </span>
        <Icon name="ChevronDown" className="lang-chev" />
      </button>
      <div className="lang-menu" id="uiLangMenu" role="listbox" aria-label={t('set.uiLanguage')} hidden={!open}>
        {order.map((code) => (
          <button
            key={code}
            type="button"
            className={code === lang ? 'lang-opt active' : 'lang-opt'}
            role="option"
            data-lang={code}
            aria-selected={code === lang}
            lang={code}
            onClick={() => {
              setOpen(false);
              setLang(code).catch(() => {
                /* The pack's chunk would not load. Almost always a newer
                   build replaced this one (the worker took over and its
                   old chunks are gone), else offline before it was ever
                   cached. The language stays; 1.0's update notice and
                   Reload button offer the fix. */
                toast(t('pwa.updateReady'), 'Download', { label: t('pwa.reload'), onClick: () => window.location.reload() });
              });
            }}
          >
            <span>{names[code]}</span>
            <span className="lang-check" aria-hidden="true">
              ✓
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
