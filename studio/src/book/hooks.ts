import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { insertSectionsAt, moveSection, observeSections, removeSection, sectionAt, sectionKeys, sectionList, sectionPlain, sectionsCount, setMetaValue, META } from '@book/editor/index.js';
import type { BookV1 } from '@book/schema.js';
import { useBook } from './BookProvider';

/* Typed book hooks (step 5 wave 1a, task 2). Every write goes through Yjs:
   - a book setting is a top-level key of the book, held in the Y `meta` map
     as a JSON value. setMeta always stores a NEW value (a structured
     clone), never the object a reader was handed, and never mutates in
     place (step 4: "ported features must set new JSON values");
   - sections change only through structural operations through the
     sections door (src/book/editor/sections.ts: a move is one position
     write, the section itself stays), each one Y transaction (one undo
     step, one update).
   Keys and value types come from the book format (src/book/schema.ts). */

export type MetaKey = Exclude<keyof BookV1, 'sections'>;
export type MetaValue<K extends MetaKey> = BookV1[K];
/** One section as the book format writes it. */
export type BookSection = BookV1['sections'][number];

type Rec = Record<string, unknown>;

/** A top-level book value as stored (undefined when the book has no such key). Treat it as read-only. A picture's data
 *  in it may be its name in the book's picture store ("beuk-pic:<sha256>", model.ts BLOBS): read bytes with
 *  getMetaValue (src/book/editor) or exportBook. */
export function getMeta<K extends MetaKey>(ydoc: Y.Doc, key: K): MetaValue<K> | undefined {
  return ydoc.getMap<unknown>(META).get(key) as MetaValue<K> | undefined;
}

/** Store a top-level book value: always a fresh copy, in one transaction. undefined removes the key. */
export function setMeta<K extends MetaKey>(ydoc: Y.Doc, key: K, value: MetaValue<K> | undefined): void {
  // pictures, fonts, the cover and research files are stored once in the picture store and named (model.ts BLOBS)
  setMetaValue(ydoc, key, value);
}

/** Several top-level values in ONE transaction (e.g. history and historyPool together). */
export function setMetaMany(ydoc: Y.Doc, values: Partial<{ [K in MetaKey]: MetaValue<K> | undefined }>): void {
  ydoc.transact(() => {
    for (const [k, v] of Object.entries(values)) setMetaValue(ydoc, k, v);
  });
}

/** The open book's value for `key`, re-read when that key changes. */
export function useMeta<K extends MetaKey>(key: K): MetaValue<K> | undefined {
  const { book } = useBook();
  const ydoc = book?.ydoc ?? null;
  const [, bump] = useState(0);
  useEffect(() => {
    if (!ydoc) return;
    const m = ydoc.getMap<unknown>(META);
    const on = (e: Y.YMapEvent<unknown>) => {
      if (e.keysChanged.has(key)) bump((n) => n + 1);
    };
    m.observe(on);
    return () => m.unobserve(on);
  }, [ydoc, key]);
  return ydoc ? getMeta(ydoc, key) : undefined;
}

/* ---- sections ---- */

/** The sections as book format (content as text), for reading. */
export function sectionsPlain(ydoc: Y.Doc): unknown[] {
  return sectionList(ydoc).map((s, i) => sectionPlain(s, `sections[${i}]`));
}

export type SectionOps = {
  length: number;
  /** Insert book-format sections at `index` (one transaction). */
  insert: (index: number, list: readonly BookSection[] | readonly unknown[]) => void;
  /** Remove `count` sections from `index` (one transaction). */
  remove: (index: number, count?: number) => void;
  /** Move the section at `from` so it stands at `to` (indices before the move; one transaction). */
  move: (from: number, to: number) => void;
  /** Insert a copy of the section at `index` right after it, with `patch` laid over it (a new id, at least). One transaction. */
  duplicate: (index: number, patch: Partial<BookSection> & { id: string }) => void;
};

/** The structural operations on a book's sections, each one Y transaction. */
export function sectionOps(ydoc: Y.Doc): SectionOps {
  return {
    get length() {
      return sectionsCount(ydoc);
    },
    insert: (index, list) => void insertSectionsAt(ydoc, index, list),
    remove: (index, count = 1) => {
      const gone = sectionKeys(ydoc).slice(Math.max(0, index), Math.max(0, index) + count);
      ydoc.transact(() => gone.forEach((k) => removeSection(ydoc, k)));
    },
    move: (from, to) => {
      const keys = sectionKeys(ydoc);
      if (from === to || from < 0 || from >= keys.length) return;
      // the section's position only: its Y.Map, its text and an editor bound to it stay (spec 2026-11-01)
      moveSection(ydoc, keys[from]!, to);
    },
    duplicate: (index, patch) => {
      const s = sectionPlain(sectionAt(ydoc, index), `sections[${index}]`);
      const copy = s && typeof s === 'object' && !Array.isArray(s) ? { ...(s as Rec), ...patch } : s;
      insertSectionsAt(ydoc, index + 1, [copy]);
    },
  };
}

/** The open book's structural section operations, and its section count (re-read when the list changes). */
export function useSections(): SectionOps | null {
  const { book } = useBook();
  const ydoc = book?.ydoc ?? null;
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!ydoc) return;
    const on = () => setN(sectionsCount(ydoc));
    on();
    return observeSections(ydoc, on);
  }, [ydoc]);
  const ops = useMemo(() => (ydoc ? sectionOps(ydoc) : null), [ydoc]);
  void n;
  return ops;
}

/** A stable callback that writes one meta key of the open book (no-op with no book). */
export function useSetMeta<K extends MetaKey>(key: K): (value: MetaValue<K> | undefined) => void {
  const { book } = useBook();
  const ydoc = book?.ydoc ?? null;
  return useCallback((value) => {
    if (ydoc) setMeta(ydoc, key, value);
  }, [ydoc, key]);
}
