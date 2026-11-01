import { useEffect } from 'react';
import { useLocale } from '../i18n/LocaleProvider';
import { NEXT_STRINGS } from '../i18n/next-strings';
import { EN } from '../i18n/strings';
import { installTips } from './tooltip';

/* Installs 1.0's one tooltip (tooltip.ts) for the studio's lifetime, with the
   studio's t(). 1.0's tipKeyOk asks UI_STRINGS.en; here the English pack
   plus the 2.0 overlay's English. A language switch re-reads the open tip
   (1.0 re-renders the chrome; its tip reads t() each time it renders). */
const hasKey = (k: string): boolean => Object.hasOwn(EN, k) || Object.hasOwn(NEXT_STRINGS.en!, k);

export function TipsHost() {
  const { t } = useLocale();
  useEffect(() => {
    installTips({ t: t as (k: string, p?: Record<string, unknown>) => string, hasKey }).refresh();
  }, [t]);
  useEffect(() => () => window.beukTips?.uninstall(), []);
  return null;
}
