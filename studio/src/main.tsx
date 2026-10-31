import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LocaleProvider } from './i18n/LocaleProvider';
import { initialUiLang, loadPack } from './i18n/strings';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root');

/* Load the opening language's pack before the first render, so the chrome
   never paints in English and then changes. A pack that fails to load
   (offline before it was ever cached) opens in English. */
const lang = initialUiLang();
loadPack(lang)
  .catch(() => undefined)
  .then(() => {
    createRoot(root).render(
      <StrictMode>
        <LocaleProvider initial={lang}>
          <App />
        </LocaleProvider>
      </StrictMode>,
    );
  });
