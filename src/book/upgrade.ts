import type { Preserved, Warning } from './read.js';

/* BEUK:book-upgrade — the named steps that lift a legacy book shape to v1.
   One step per implicit 1.0 version (design doc, "Legacy upgrade steps"),
   each citing the 1.0 code it mirrors. readBook runs them in order, on its
   own deep copy of the book, before it fills defaults and checks limits.
   Empty here: the steps land in the next task. */

/** What a step may report besides changing the book. */
export type StepCtx = {
  warn(w: Warning): void;
  preserve(p: Preserved): void;
};

export type UpgradeStep = {
  name: string;
  /** The 1.0 code this step mirrors, e.g. "client/index.html CI:50594". */
  cite: string;
  /** Mutates `book` (readBook's own copy). Returns true when it fired. */
  apply(book: Record<string, unknown>, ctx: StepCtx): boolean;
};

export const STEPS: UpgradeStep[] = [];
