/* Task 2 of the studio-2 cutover: the entry doors ?signin, ?signup and ?book=<uuid>.
   Mirrors 1.0's studioDoorFromUrl (client/index.html, "The landing page's doors") and its portalDoorBook. Rewritten, not
   lifted: 1.0's function reads the main script's own `cloud`, `portalDoorBook` and `portalSignInWork` lets, which have no
   lifted counterpart; it does only URL work and three calls into the shelf (openAuth, setAuthMode, cloudOpenBook, all
   lifted), so it is written here against those. The address is rewritten from location.pathname, so the doors work under
   any base path (/studio/ since the cutover; /next/ before it) with nothing hard-coded. */

type Fn = (...a: unknown[]) => unknown;
export type DoorApi = { openAuth: Fn; setAuthMode: Fn; cloudOpenBook: (id: string) => unknown };
export type DoorFacts = { available: boolean; user: unknown };

/** 1.0's test for a book id in ?book= (BEUK:portal). */
export const DOOR_BOOK = /^[0-9a-f-]{36}$/i;

/** 1.0's studioDoorFromUrl. `settled` is 1.0's portalSignInWork (the sign-in work at boot, so the book opens after the
 *  reconcile and the bring offer settle); `clickAccount` is 1.0's $("btnAccount").click(). */
export function studioDoor(api: DoorApi, facts: DoorFacts, settled: Promise<unknown> | null, clickAccount: () => void): void {
  let door: 'register' | 'login' | 'book' | null = null;
  let bookId: string | null = null;
  try {
    const q = new URLSearchParams(location.search);
    door = q.has('signup') ? 'register' : q.has('signin') ? 'login' : null;
    // BEUK:portal: the account page's "Open in the studio"
    const book = q.get('book');
    if (book !== null) {
      bookId = DOOR_BOOK.test(book) ? book : null;
      if (!door) door = 'book';
    }
    if (door) {
      q.delete('signup');
      q.delete('signin');
      q.delete('book');
      const rest = q.toString();
      history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    }
  } catch {
    door = null;
  }
  if (!door || !facts.available) return;
  if (door === 'book') {
    if (facts.user) {
      const id = bookId;
      if (id)
        Promise.resolve(settled)
          .catch(() => undefined)
          .then(() => api.cloudOpenBook(id));
    } else api.openAuth();
    return;
  }
  if (facts.user) {
    clickAccount();
    return;
  }
  api.openAuth();
  if (door === 'register') api.setAuthMode('register');
}
