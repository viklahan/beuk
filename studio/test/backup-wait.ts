import { waitFor } from '@testing-library/react';

/* Locked backups and the authorship record (task 3): "Export a backup" downloads once its fingerprint (WebCrypto's
   async SHA-256) and, signed in, its stamp are done, so the file is no longer there the moment the button is clicked.
   `click` presses the button; this resolves once the download has started — the next call of the link's click, which
   every caller has mocked (HTMLAnchorElement.prototype.click) to catch the file. Only when the test reads changes. */
export async function backupClicked(click: () => unknown): Promise<void> {
  const spy = HTMLAnchorElement.prototype.click as unknown as { mock?: { calls: unknown[] } };
  const before = spy.mock ? spy.mock.calls.length : 0;
  await click();
  await waitFor(
    () => {
      if (!spy.mock || spy.mock.calls.length <= before) throw new Error('the backup has not downloaded yet');
    },
    { timeout: 30_000 },
  );
}
