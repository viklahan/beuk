import { useState } from 'react';
import { useLocale } from '../i18n/LocaleProvider';
import { applyTheme, getTheme, type Theme } from '../theme/theme';
import { Icon } from './Icon';
import { useToast } from './Toasts';

/* 1.0's #btnTheme (syncThemeButton + its click handler): in Paper it
   offers Candlelight (flame), in Candlelight it offers Paper (sun); a
   switch is saved under beuk.theme.v1 and announced with 1.0's toast. */
export function ThemeButton() {
  const { t } = useLocale();
  const toast = useToast();
  const [theme, setTheme] = useState<Theme>(() => getTheme());
  const candle = theme === 'candlelight';
  return (
    <button
      type="button"
      className="tb-btn"
      id="btnTheme"
      aria-label={t('top.themeAria')}
      onClick={() => {
        const next = applyTheme(candle ? 'paper' : 'candlelight');
        setTheme(next);
        toast(next === 'candlelight' ? t('toast.themeCandle') : t('toast.themePaper'), next === 'candlelight' ? 'Flame' : 'Sun');
      }}
    >
      <span id="themeIcon" style={{ display: 'inline-flex' }}>
        <Icon name={candle ? 'Sun' : 'Flame'} />
      </span>
      <span className="tb-label" id="themeLabel">
        {candle ? t('top.themeToPaper') : t('top.themeToCandle')}
      </span>
    </button>
  );
}
