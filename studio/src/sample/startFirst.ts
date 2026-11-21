import { useBook } from '../book/BookProvider';
import { closureIfLoaded, loadClosure } from '../closure/index';
import { useLocale } from '../i18n/LocaleProvider';
import { useToast } from '../shell/Toasts';
import { firstBookArrival } from './sample';

/** A desk with no book on this device (a first visit: BookProvider's phase "empty") showed "Start writing…" over a
    page nobody could type on, and offered only Import, the sample and Open a backup. This opens the first book: 1.0's
    empty book, exactly what Start a new book leaves behind, with no History. It answers true once the book is open.
    Used by the page itself (Desk), by Start a new book (SampleBar) and by the name in the top bar (BookTitle), so the
    three can never disagree about what a first book is. Does nothing while a book is open or the device is still
    being read. */
export function useStartFirstBook(): () => Promise<boolean> {
  const bk = useBook();
  const toast = useToast();
  const { t } = useLocale();
  return async () => {
    if (bk.phase !== 'empty' || bk.book) return false;
    let c = closureIfLoaded();
    if (!c) {
      try {
        c = await loadClosure();
      } catch {
        toast(t('local.blocked'), 'HardDrive');
        return false;
      }
    }
    return (await bk.replaceWith(firstBookArrival(c), null)) !== null;
  };
}
