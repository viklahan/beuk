import { useLayoutEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { useBook } from '../book/BookProvider';
import { loadClosure } from '../closure/index';
import markup from '../generated/cover-markup.json';
import { useLocale } from '../i18n/LocaleProvider';
import { drawIcons } from '../insights/insights';
import { useToast } from '../shell/Toasts';
import { guardRoots, styleRun } from '../style/session';
import { toastIcon } from '../style/StyleTab';
import { coverClear, coverReady, coverUpload } from './cover';
import { coverOpen, translateCover } from './CoverMaker';

/* Wave 4c: Project Settings' cover row (1.0 #modalSettings "Cover Image · JPG or PNG"), its markup verbatim
   (src/generated/cover-markup.json), drawn by 1.0's own renderCoverSettings (through the session's cleaner: its
   thumbnail is the book's cover); Upload Cover, Make a Cover and Remove are 1.0's handlers (initSettings: the upload
   and Remove lines are src/cover/cover.ts coverUpload / coverClear; Make a Cover is openCoverMaker). The row follows
   the book's cover when it changes (the maker's "Use as My Cover" with Settings open beneath it). */
export function CoverRow() {
  const { lang } = useLocale();
  const toast = useToast();
  const bk = useBook();
  const ydoc = bk.book?.ydoc ?? null;
  const ref = useRef<HTMLDivElement>(null);
  const say = (msg: string, icon?: string) => toast(msg, toastIcon(icon));

  useLayoutEffect(() => {
    const host = ref.current;
    if (!host || !ydoc) return;
    let alive = true;
    let row: HTMLElement | null = null;
    let unobserve: (() => void) | null = null;
    void loadClosure().then((c) => {
      if (!alive) return;
      coverReady(c);
      host.innerHTML = markup.row; // 1.0's own static markup
      drawIcons(host);
      row = host.firstElementChild as HTMLElement;
      translateCover(c, row);
      guardRoots.add(row);
      const draw = () => styleRun((cc) => cc.api.renderCoverSettings());
      draw();
      const input = row.querySelector<HTMLInputElement>('#coverInput')!;
      row.querySelector('#btnCoverUpload')!.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        input.value = '';
        if (file) void coverUpload(file, say).then(draw);
      });
      row.querySelector('#btnCoverMake')!.addEventListener('click', () => coverOpen());
      row.querySelector('#btnCoverRemove')!.addEventListener('click', () => {
        coverClear(say);
        draw();
      });
      const m = ydoc.getMap('meta');
      const on = (e: Y.YMapEvent<unknown>) => {
        if (e.keysChanged.has('cover')) setTimeout(draw, 0);
      };
      m.observe(on);
      unobserve = () => m.unobserve(on);
    });
    return () => {
      alive = false;
      unobserve?.();
      if (row) guardRoots.delete(row);
      host.innerHTML = '';
    };
  }, [ydoc, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={ref} style={{ display: 'contents' }} />;
}
