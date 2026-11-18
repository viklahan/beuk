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
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      beat();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  });
  beatRow.appendChild(item('beat', beat));
  beatRow.appendChild(input);
  el.appendChild(beatRow);
  for (const [action, label] of ITEMS) el.appendChild(item(label, () => choose({ action })));
  return el;
}
