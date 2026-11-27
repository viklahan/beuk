import type { UiKey } from '../i18n/strings';
import { lettersLost } from './rescueCore';
import type { RescueReport } from './rescueEditor';

/* What the studio tells the writer after one keystroke-rescue report (V's ruling: letters they typed that could
   not be put back are told once, quietly, with the exact count). Nothing lost: nothing said (null). Otherwise
   `rescue.lost` with {n}, the `Plural` twin for n ≠ 1 (translate.ts). Letters with no exact count (`uncounted`)
   are not told: a count that is not exact is not said. */
export function rescueNotice(r: RescueReport, t: (k: UiKey, p?: Record<string, unknown>) => string): string | null {
  const n = lettersLost(r);
  return n > 0 ? t('rescue.lost', { n }) : null;
}
