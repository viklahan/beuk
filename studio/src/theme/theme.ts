/* Paper / Candlelight, with 1.0's exact rules (client/index.html,
   THEME_KEY … initTheme): Paper unless the saved choice says
   candlelight; data-theme="candlelight" on <html>, removed for Paper.
   The key itself is extracted from 1.0 (one source). index.html's
   inline script applies it before any CSS paints. */
import meta from '../generated/strings-meta.json';

export type Theme = 'paper' | 'candlelight';
export const THEME_KEY: string = meta.themeKey;

export function resolveStoredTheme(): Theme | null {
  try {
    const v = window.localStorage && localStorage.getItem(THEME_KEY);
    return v === 'candlelight' || v === 'paper' ? v : null;
  } catch {
    return null;
  }
}

export const resolveTheme = (): Theme => resolveStoredTheme() || 'paper';

export function getTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'candlelight' ? 'candlelight' : 'paper';
}

export function applyTheme(name: string, opts?: { persist?: boolean }): Theme {
  const theme: Theme = name === 'candlelight' ? 'candlelight' : 'paper';
  if (theme === 'candlelight') document.documentElement.setAttribute('data-theme', 'candlelight');
  else document.documentElement.removeAttribute('data-theme');
  if (opts?.persist !== false) {
    try {
      if (window.localStorage) localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode */
    }
  }
  return theme;
}
