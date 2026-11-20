import type { ProposeAction } from './propose';

/* The summon menu: a beat (with its instruction) and three one-press actions. Plain DOM, built inside the summon
   widget: a React root inside a ProseMirror widget would have to render synchronously while the view updates, and
   the view updates from inside React's own effects (the chapter editor's mount). */

export type MenuChoice = { action: ProposeAction; instruction?: string };

const ITEMS: [ProposeAction, string][] = [
  ['continue', 'continue the story'],
  ['fill', 'fill this gap'],
  ['summarize', 'summarize section'],
];

function item(label: string, act: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.setAttribute('role', 'menuitem');
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    act();
  });
  return b;
}

/** Put the keyboard on the menu's first item. */
export const focusMenu = (menu: Element | null): void => menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();

/** The menu's element. `choose` runs with the writer's choice; `dismiss` when Escape is pressed inside it. */
export function renderMenu(choose: (c: MenuChoice) => void, dismiss: () => void): HTMLElement {
  const el = document.createElement('span');
  el.setAttribute('data-aris', 'menu');
  el.setAttribute('role', 'menu');
  el.className = 'aris-menu';
  el.contentEditable = 'false';
  const beatRow = document.createElement('span');
  beatRow.className = 'aris-menu__beat';
  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('aria-label', 'what happens in this beat');
  input.placeholder = 'what happens next';
  const beat = () => choose({ action: 'beat', instruction: input.value });
  beatRow.appendChild(item('beat', beat));
  beatRow.appendChild(input);
  el.appendChild(beatRow);
  for (const [action, label] of ITEMS) el.appendChild(item(label, () => choose({ action })));
  // the keyboard: ArrowDown / ArrowUp move through the items (the beat's input among them, wrapping), Enter runs the
  // focused one (in the input: the beat), Escape dismisses. The editor never sees these keys (the widget stops them).
  el.addEventListener('keydown', (e) => {
    const stops = [...el.querySelectorAll<HTMLElement>('button, input')];
    const i = stops.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = stops.length;
      stops[i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n].focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.target === input) beat();
      else if (e.target instanceof HTMLButtonElement) e.target.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  });
  return el;
}
