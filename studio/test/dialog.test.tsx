import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { loadPack } from '../src/i18n/strings';
import { Dialog, DialogStackProvider, useConfirm, type ConfirmResult, type ConfirmSpec } from '../src/shell/Dialog';

/* Task 1: the dialog stack (1.0's .modal-back + Escape + cloudConfirm),
   review focus #4, and 1.0's self-check confirm.alt.hidden-when-unused. */

afterEach(() => {
  cleanup();
  document.documentElement.setAttribute('dir', 'ltr');
  document.documentElement.setAttribute('lang', 'en');
});

const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

function Two() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  return (
    <>
      <button id="openA" onClick={() => setA(true)}>open A</button>
      <Dialog open={a} onClose={() => setA(false)} id="modalA" labelledBy="hA">
        <h2 id="hA">A</h2>
        <button id="openB" onClick={() => setB(true)}>open B</button>
        <button id="lastA">last</button>
      </Dialog>
      <Dialog open={b} onClose={() => setB(false)} id="modalB" z={70} labelledBy="hB">
        <h2 id="hB">B</h2>
        <button id="inB">in B</button>
      </Dialog>
    </>
  );
}

const mount = (ui: React.ReactNode, lang = 'en') =>
  render(
    <LocaleProvider initial={lang}>
      <DialogStackProvider>{ui}</DialogStackProvider>
    </LocaleProvider>,
  );

describe('the dialog stack (review focus #4)', () => {
  it("draws 1.0's markup: .modal-back.open around .modal[role=dialog][aria-modal], with the z-index", () => {
    mount(<Two />);
    fireEvent.click(document.getElementById('openA')!);
    const back = document.getElementById('modalA')!;
    expect(back.classList.contains('modal-back')).toBe(true);
    expect(back.classList.contains('open')).toBe(true);
    const box = back.querySelector('.modal')!;
    expect(box.getAttribute('role')).toBe('dialog');
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(box.getAttribute('aria-labelledby')).toBe('hA');
    fireEvent.click(document.getElementById('openB')!);
    expect((document.getElementById('modalB') as HTMLElement).style.zIndex).toBe('70');
  });

  it('Escape closes only the top dialog, then the next; focus returns to each opener', () => {
    mount(<Two />);
    const openA = document.getElementById('openA')!;
    openA.focus();
    fireEvent.click(openA);
    expect(document.activeElement?.id).toBe('openB'); // focus moved into A
    const openB = document.getElementById('openB')!;
    fireEvent.click(openB);
    expect(document.activeElement?.id).toBe('inB');
    esc();
    expect(document.getElementById('modalB')).toBeNull();
    expect(document.getElementById('modalA')).not.toBeNull();
    expect(document.activeElement).toBe(openB);
    esc();
    expect(document.getElementById('modalA')).toBeNull();
    expect(document.activeElement).toBe(openA);
    esc(); // nothing open: nothing happens
    expect(document.activeElement).toBe(openA);
  });

  it('Tab stays inside the top dialog', () => {
    mount(<Two />);
    fireEvent.click(document.getElementById('openA')!);
    const last = document.getElementById('lastA')!;
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement?.id).toBe('openB');
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement?.id).toBe('lastA');
  });

  it('a click on the backdrop closes; a click inside does not', () => {
    mount(<Two />);
    fireEvent.click(document.getElementById('openA')!);
    fireEvent.click(document.querySelector('#modalA .modal')!);
    expect(document.getElementById('modalA')).not.toBeNull();
    fireEvent.click(document.getElementById('modalA')!);
    expect(document.getElementById('modalA')).toBeNull();
  });

  it('works the same in Arabic chrome: the dialog sits under <html dir="rtl">, Escape and focus return as before', async () => {
    await loadPack('ar');
    mount(<Two />, 'ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    const openA = document.getElementById('openA')!;
    openA.focus();
    fireEvent.click(openA);
    fireEvent.click(document.getElementById('openB')!);
    expect(document.getElementById('modalB')!.closest('[dir]')).toBe(document.documentElement);
    esc();
    esc();
    expect(document.querySelectorAll('.modal-back.open').length).toBe(0);
    expect(document.activeElement).toBe(openA);
  });
});

let ask: (s: ConfirmSpec) => Promise<ConfirmResult> = () => Promise.reject(new Error('not mounted'));
function Asker() {
  ask = useConfirm();
  return <button id="opener">opener</button>;
}

const flush = () => act(async () => {
  await Promise.resolve();
});

describe('the confirm (1.0 cloudConfirm)', () => {
  it("1.0's markup and keys: #modalConfirm (z 78), #confirmTitle, #confirmBody, No / Alt / Yes; Yes resolves true", async () => {
    mount(<Asker />);
    let p!: Promise<ConfirmResult>;
    act(() => {
      p = ask({ title: 'T', body: 'B', yes: 'Do it', no: 'Keep' });
    });
    const back = document.getElementById('modalConfirm')!;
    expect(back.style.zIndex).toBe('78');
    expect(document.getElementById('confirmTitle')!.textContent).toBe('T');
    expect(document.getElementById('confirmBody')!.textContent).toBe('B');
    expect(document.querySelector('#modalConfirm .modal')!.getAttribute('aria-labelledby')).toBe('confirmTitle');
    fireEvent.click(document.getElementById('btnConfirmYes')!);
    await expect(p).resolves.toBe(true);
    expect(document.getElementById('modalConfirm')).toBeNull();
  });

  it('Escape answers no, and focus goes back to the opener', async () => {
    mount(<Asker />);
    const opener = document.getElementById('opener')!;
    opener.focus();
    let p!: Promise<ConfirmResult>;
    act(() => {
      p = ask({ title: 'T', yes: 'Y', no: 'N' });
    });
    expect(document.getElementById('modalConfirm')!.contains(document.activeElement)).toBe(true);
    esc();
    await expect(p).resolves.toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('confirm.alt.hidden-when-unused: two choices draw two; a stray "alt" resolves false; three choices stack safe-first and "alt" resolves "alt"', async () => {
    mount(<Asker />);
    const alt = () => document.getElementById('btnConfirmAlt')!;
    const row = () => alt().parentElement!;
    let p!: Promise<ConfirmResult>;
    act(() => {
      p = ask({ title: 'Check plain', body: 'Check plain confirm', yes: 'Do it', no: 'Keep' });
    });
    expect(alt().hidden).toBe(true); // display:none by #btnConfirmAlt[hidden] (dialogs.css)
    expect(row().classList.contains('three')).toBe(false);
    expect(document.getElementById('btnConfirmYes')!.classList.contains('primary')).toBe(true);
    expect(document.getElementById('btnConfirmNo')!.classList.contains('primary')).toBe(false);
    // not focusable: Tab from Keep goes straight to Yes
    document.getElementById('btnConfirmNo')!.focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement?.id).toBe('btnConfirmYes');
    // a stray "alt" (clicking the hidden button programmatically) resolves false
    fireEvent.click(alt());
    await expect(p).resolves.toBe(false);

    act(() => {
      p = ask({ title: 'Check three', body: 'Check three choices', yes: 'Replace', alt: 'Save first', no: 'Keep', defaultNo: true });
    });
    expect(alt().hidden).toBe(false);
    expect(alt().textContent).toBe('Save first');
    expect(row().classList.contains('three')).toBe(true);
    const order = Array.from(row().querySelectorAll<HTMLButtonElement>('.tb-btn')).filter((b) => !b.hidden).map((b) => b.id).join(',');
    expect(order).toBe('btnConfirmNo,btnConfirmAlt,btnConfirmYes');
    expect(document.activeElement?.id).toBe('btnConfirmNo'); // defaultNo: the safe choice holds the focus
    expect(document.getElementById('btnConfirmNo')!.classList.contains('primary')).toBe(true);
    expect(document.getElementById('btnConfirmYes')!.classList.contains('primary')).toBe(false);
    fireEvent.click(alt());
    await expect(p).resolves.toBe('alt');

    act(() => {
      p = ask({ title: 'Check plain again', body: 'x', yes: 'Do it', no: 'Keep' });
    });
    expect(alt().hidden).toBe(true);
    expect(row().classList.contains('three')).toBe(false);
    fireEvent.click(document.getElementById('btnConfirmNo')!);
    await expect(p).resolves.toBe(false);
  });

  it('a second confirm while one is open: the first answers no (1.0 left it unsettled), the second shows', async () => {
    mount(<Asker />);
    let p1!: Promise<ConfirmResult>, p2!: Promise<ConfirmResult>;
    act(() => {
      p1 = ask({ title: 'one', yes: 'Y' });
    });
    act(() => {
      p2 = ask({ title: 'two', yes: 'Y' });
    });
    await expect(p1).resolves.toBe(false);
    expect(document.getElementById('confirmTitle')!.textContent).toBe('two');
    fireEvent.click(document.getElementById('btnConfirmYes')!);
    await expect(p2).resolves.toBe(true);
    await flush();
  });

  it('a confirm over a dialog: Escape closes the confirm only', async () => {
    function Over() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Dialog open={open} onClose={() => setOpen(false)} id="modalHistory" z={70} labelledBy="h">
            <h2 id="h">H</h2>
            <Asker />
          </Dialog>
        </>
      );
    }
    mount(<Over />);
    let p!: Promise<ConfirmResult>;
    act(() => {
      p = ask({ title: 'sure?', yes: 'Y' });
    });
    esc();
    await expect(p).resolves.toBe(false);
    expect(document.getElementById('modalHistory')).not.toBeNull();
    expect(document.getElementById('modalConfirm')).toBeNull();
  });
});
