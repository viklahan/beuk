import { describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { previewSafety, previewStarted } from '../src/preview/preview';

/* Review round 2, Minor 6: the preview starts again on a remounted pane (the Shell or the pane drawn anew), with
   1.0's page-wide listeners of the first start taken away (none doubled: one arrow press turns one page), and holds
   no book's Y.Doc after it goes. */
const mount = () =>
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );

describe('the preview pane, remounted', () => {
  it('starts again on the new markup, its page-wide listeners not doubled', async () => {
    mount();
    await waitFor(() => expect(previewStarted()).toBe(true), { timeout: 20_000 });
    const first = previewSafety.listeners;
    expect(first).toBeGreaterThan(0);
    cleanup();
    expect(previewStarted()).toBe(false);
    expect(previewSafety.listeners).toBe(0);
    mount();
    await waitFor(() => expect(previewStarted()).toBe(true), { timeout: 20_000 });
    expect(previewSafety.listeners).toBe(first);
    // 1.0's own device bar listener is on the NEW bar
    document.querySelector<HTMLButtonElement>('#deviceBar [data-device="ipad"]')!.click();
    expect(document.getElementById('deviceFrame')!.className).toBe('frame-ipad');
    document.querySelector<HTMLButtonElement>('#deviceBar [data-device="kindle"]')!.click();
    cleanup();
  }, 60_000);
});
