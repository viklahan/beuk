import { createElement } from 'react';
import icons from '../generated/icons.json';

/* A Lucide icon, drawn from 1.0's own vendored lucide.min.js (extracted at
   build time, src/generated/icons.json) with the attributes lucide's
   createIcons gives 1.0's <i data-lucide> placeholders. */
export type IconName = keyof typeof icons;
type Node = [string, Record<string, string>];

const kebab = (n: string) => n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const nodes = icons[name] as unknown as Node[];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-${kebab(name)}${className ? ' ' + className : ''}`}
      aria-hidden="true"
      focusable="false"
    >
      {nodes.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
