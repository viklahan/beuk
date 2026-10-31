import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { App } from '../src/App';
import { LocaleProvider } from '../src/i18n/LocaleProvider';

afterEach(cleanup);

describe('the app', () => {
  it('renders its root element and the shell regions', () => {
    const { container } = render(
      <LocaleProvider initial="en">
        <App />
      </LocaleProvider>,
    );
    expect(container.querySelector('#app')).not.toBeNull();
    for (const id of ['topbar', 'mobileTabs', 'panes', 'pane-structure', 'pane-center', 'pane-preview', 'structureList', 'manuscript']) {
      expect(container.querySelector('#' + id), id).not.toBeNull();
    }
    expect(document.getElementById('toasts')).not.toBeNull();
    // No book on this device (no IndexedDB in this test): the outline is empty, the desk offers a backup.
    expect(container.querySelector('#structureList')!.children.length).toBe(0);
  });
});
