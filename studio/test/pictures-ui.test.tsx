import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { textOffsetToPos } from '../../src/book/editor/index';
import en from '../src/generated/packs/en.json';
import { App } from '../src/App';
import { resetSidePrefsCache } from '../src/book/sidePrefs';
import { toBook } from '../src/editor/bridge';
import { editorText } from '../src/editor/insert';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { IMG_AUTO_REFUSED, IMG_PLACED, IMG_PLACED_FULL, TOKEN_REMOVED } from '../src/pictures/scene';
import { PICTURE_ADDED, PICTURE_TYPE_REFUSED, bytesToBase64 } from '../src/pictures/pictures';
import { resetCloudProbe } from '../src/pictures/stock';

/* Wave 2b in the studio, through the whole app: Insert Image (1.0's
   editor.toolbar.image-line), the section card, the chapter-art rows, the
   scene bar and picker (1.0's scene.images.place: bar, library attach,
   upload attach, each break its own picture, replace, remove, the text
   never changes), Suggest by name (scene.images.suggest: the prefill, the
   gate without a request, Openverse results, nothing placed until Attach),
   the image library's delete / confirm / cleanup / Undo, the no-edit gate
   (review focus #3) and a hostile book (review focus #4). */

type Rec = Record<string, unknown>;
const E = en as Record<string, string>;
const FAKE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pngBytes = () => Uint8Array.from(atob(FAKE_PNG), (ch) => ch.charCodeAt(0));

beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Element.prototype.scrollIntoView = () => undefined;
  document.elementFromPoint = () => null;
});
beforeEach(() => {
  localStorage.clear();
  resetSidePrefsCache();
  resetCloudProbe();
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  for (const d of await indexedDB.databases()) {
    if (!d.name) continue;
    await new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(d.name!);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }
});

const im = (id: string, name: string, data = FAKE_PNG, extra: Rec = {}) => ({ id, name, mediaType: 'image/png', ext: 'png', data, ...extra });
const BOOK = (patch: (b: Rec & { sections: Rec[]; images: Rec[] }) => void = () => undefined): Rec => {
  const b = {
    meta: { title: 'Picture Book', author: 'A. Writer', language: 'en' },
    images: [im('scimg1', 'First Bay.png'), im('scimg2', 'Second Bay.png'), im('scimg3', 'Third Bay.png')],
    sections: [
      { id: 's1', kind: 'body', type: 'chapter', number: '1', title: 'The Ferry Crossing', content: 'Opening words stand here.\n\n***\n\nMiddle words follow the first break.\n\n***\n\nClosing words end the chapter.\n\n***\n\nA last paragraph rests.' },
      { id: 's2', kind: 'body', type: 'chapter', number: '2', title: 'Two', content: 'The harbour woke.\n\n![The ferry](img:scimg1)\n\nGulls rose.' },
      { id: 's3', kind: 'front', type: 'toc', title: 'Contents', content: '' },
    ],
  };
  patch(b);
  return b;
};
const backupFile = (book: unknown) => new File([JSON.stringify({ format: 'beuk-backup', version: 1, exportedAt: '2026-11-01T00:00:00.000Z', book })], 'a.beuk-backup.json', { type: 'application/json' });
async function openStudio(book: Rec) {
  render(
    <LocaleProvider initial="en">
      <App />
    </LocaleProvider>,
  );
  await waitFor(() => expect(document.getElementById('btnOpenBackup')).not.toBeNull(), { timeout: 10_000 });
  await act(async () => {
    fireEvent.change(document.querySelector('#btnOpenBackup + input')!, { target: { files: [backupFile(book)] } });
  });
  await waitFor(() => expect(document.querySelector('#manuscript .ms-editor')).not.toBeNull(), { timeout: 20_000 });
}
const editor = () => (document.getElementById('manuscript') as HTMLElement & { beukEditor?: Editor }).beukEditor!;
const text = () => editorText(editor()).text;
function select(s: number, e = s) {
  const ed = editor();
  const d = toBook(ed.state.doc);
  act(() => {
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, textOffsetToPos(d, s), textOffsetToPos(d, e))));
  });
}
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el!);
  });
};
const toasts = () => [...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent || '');
async function exported(): Promise<Rec> {
  let blob: Blob | null = null;
  const sp = [
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((blob = b as Blob), 'blob:x')),
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined),
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined),
  ];
  fireEvent.click(document.getElementById('btnExport')!);
  sp.forEach((s) => s.mockRestore());
  return (JSON.parse(await (blob as unknown as Blob).text()) as { book: Rec }).book;
}
const noHist = (b: Rec) => {
  const o = { ...b };
  delete o.history;
  delete o.historyPool;
  return o;
};
/** Choose the section at book index `i` in the outline. */
async function chooseSection(i: number) {
  await click(document.querySelector(`#structureList .sec-item[data-index="${i}"]`));
  await waitFor(() => expect(document.querySelector(`#manuscript[data-section="${i}"] .ms-editor`)).not.toBeNull());
}
/** Stand on the nth scene break node of the open chapter (a click on the atom selects it). */
function standOnBreak(nth: number) {
  const ed = editor();
  let seen = -1, at = -1;
  ed.state.doc.forEach((n, off) => {
    if (n.type.name === 'sceneBreak' && ++seen === nth && at < 0) at = off;
  });
  expect(at).toBeGreaterThanOrEqual(0);
  act(() => {
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, at)));
  });
}
async function openImageDialog() {
  await click($('btnInsertImage'));
  await waitFor(() => expect(document.querySelector('#imgLib .img-cell')).not.toBeNull(), { timeout: 10_000 });
}
const putFile = async (input: HTMLInputElement, f: File) => {
  await act(async () => {
    fireEvent.change(input, { target: { files: [f] } });
  });
};

describe('pictures in the studio (A6–A8)', { timeout: 60_000 }, () => {
  it('editor.toolbar.image-line: Insert Image opens the library and places the marker on its own line at the cursor; one Undo', async () => {
    await openStudio(BOOK());
    const original = text();
    select('Opening words'.length);
    await openImageDialog();
    expect($('imgH').textContent).toBe(E['img.title']);
    expect(document.querySelectorAll('#imgLib [data-libimg]').length).toBe(3);
    // the newest picture is chosen, its name and size beside Upload
    expect(document.querySelector('#imgLib .img-cell.active')!.getAttribute('data-libimg')).toBe('scimg3');
    expect($('imgLibNote').textContent).toMatch(/^Third Bay\.png · \d+ B$/);
    await click(document.querySelector('#imgLib [data-libimg="scimg2"]'));
    expect($('imgAlt').placeholder).toBe('Second Bay');
    await act(async () => {
      fireEvent.change($('imgCaption'), { target: { value: 'The second bay' } });
    });
    await click(document.querySelector('[data-imgdisp="full"]'));
    await click($('btnDoInsertImage'));
    expect(document.getElementById('modalImage')).toBeNull();
    expect(text()).toBe('Opening words\n\n![Second Bay](img:scimg2|full "The second bay")\n\n stand here.' + original.slice('Opening words stand here.'.length));
    expect(toasts().some((x) => x.includes(IMG_PLACED_FULL))).toBe(true);
    // the caption belongs to one placement; the display choice and the picture stay
    await openImageDialog();
    expect($('imgCaption').value).toBe('');
    expect(document.querySelector('#imgLib .img-cell.active')!.getAttribute('data-libimg')).toBe('scimg2');
    await click(document.querySelector('[data-imgdisp="standard"]'));
    await click($('btnCloseImage'));
    act(() => {
      editor().commands.undo();
    });
    expect(text()).toBe(original);
    void IMG_PLACED;
  });

  it("a generated section takes no picture (1.0's openImageModal toast); no scene bar, no card there", async () => {
    // (the desk opens the first body section: a body section typed as 1.0's generated "toc" stands in for one)
    await openStudio(BOOK((b) => {
      Object.assign(b.sections[0]!, { type: 'toc', title: 'Contents' });
    }));
    await click($('btnInsertImage'));
    await waitFor(() => expect(toasts().some((x) => x.includes(IMG_AUTO_REFUSED))).toBe(true));
    expect(document.getElementById('modalImage')).toBeNull();
    standOnBreak(0);
    await new Promise((r) => setTimeout(r, 50));
    expect($('sceneBar').className).toBe('');
  });

  it('upload: only JPG or PNG; the picture joins the library and is chosen; History repacked; exported once', async () => {
    await openStudio(BOOK());
    await openImageDialog();
    const input = $('imgFileInput');
    await putFile(input, new File(['GIF89a'], 'x.gif', { type: 'image/gif' }));
    await waitFor(() => expect(toasts().some((x) => x.includes(PICTURE_TYPE_REFUSED))).toBe(true));
    await putFile(input, new File([pngBytes()], 'harbour-chart.png', { type: 'image/png' }));
    await waitFor(() => expect(document.querySelectorAll('#imgLib [data-libimg]').length).toBe(4));
    expect(toasts().some((x) => x.includes(PICTURE_ADDED))).toBe(true);
    expect($('imgAlt').placeholder).toBe('harbour chart');
    const active = document.querySelector('#imgLib .img-cell.active')!;
    expect(active.textContent).toBe('harbour-chart.png');
    const book = await exported();
    const up = (book.images as Rec[])[3]!;
    expect(up).toEqual({ id: up.id, name: 'harbour-chart.png', mediaType: 'image/png', ext: 'png', data: FAKE_PNG });
  });

  it('the image library: an unused picture goes without a question (Undo puts it back); a used one asks, listing where; Cancel keeps; Remove it everywhere clears; cleanup', async () => {
    await openStudio(BOOK((b) => b.images.push(im('ilK', 'unused-K.png', btoa('imglib-unused-K')), im('ilL', 'unused-L.png', btoa('imglib-unused-L')))));
    const before = noHist(await exported());
    await openImageDialog();
    // cleanup row: 2 unused (ilK, ilL; scimg2/scimg3 are unused too)
    expect($('btnImgCleanup').textContent).toContain('Remove unused pictures (4 ·');
    // unused: no confirm, a toast with Undo
    await click(document.querySelector('#imgLib [data-imgdel="ilK"]'));
    expect(document.getElementById('modalImgRemove')).toBeNull();
    expect(document.querySelector('#imgLib [data-libimg="ilK"]')).toBeNull();
    const undo = [...document.querySelectorAll('#toasts .toast-action')].pop() as HTMLElement;
    expect(undo.textContent).toBe(E['imglib.undo']);
    await click(undo);
    await waitFor(() => expect(document.querySelector('#imgLib [data-libimg="ilK"]')).not.toBeNull());
    expect(toasts().some((x) => x.includes(E['imglib.undone']!))).toBe(true);
    // used: the confirm lists where, focus on Cancel; Cancel changes nothing
    await click(document.querySelector('#imgLib [data-imgdel="scimg1"]'));
    expect($('modalImgRemove')).not.toBeNull();
    expect($('imgRmUses').textContent).toContain('⁨Two⁩');
    expect(document.activeElement?.id).toBe('btnImgRmCancel');
    expect(document.querySelector('#modalImgRemove .modal')!.getAttribute('role')).toBe('alertdialog');
    // Escape closes the confirm only
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    });
    expect(document.getElementById('modalImgRemove')).toBeNull();
    expect(document.getElementById('modalImage')).not.toBeNull();
    expect(noHist(await exported())).toEqual(before);
    await click(document.querySelector('#imgLib [data-imgdel="scimg1"]'));
    await click($('btnImgRmCancel'));
    expect(noHist(await exported())).toEqual(before);
    await click(document.querySelector('#imgLib [data-imgdel="scimg1"]'));
    await click($('btnImgRmYes'));
    const after = await exported();
    expect((after.images as Rec[]).some((x) => x.id === 'scimg1')).toBe(false);
    expect((after.sections as Rec[])[1]!.content).toBe('The harbour woke.\n\nGulls rose.');
    expect((after.history as Rec[])[0]!.auto).toBe('imgremove');
    expect(toasts().some((x) => x.includes(E['imglib.removedEverywhere']!))).toBe(true);
    const undo2 = [...document.querySelectorAll('#toasts .toast-action')].pop() as HTMLElement;
    await click(undo2);
    expect(noHist(await exported())).toEqual(before);
    // cleanup removes exactly the unused, with an Undo
    await click($('btnImgCleanup'));
    const cleaned = await exported();
    expect((cleaned.images as Rec[]).map((x) => x.id)).toEqual(['scimg1']);
    await waitFor(() => expect($('imgCleanupNote').textContent).toBe(E['imglib.cleanupNone']));
    expect(document.getElementById('btnImgCleanup')).toBeNull();
    await click([...document.querySelectorAll('#toasts .toast-action')].pop()!);
    expect(noHist(await exported())).toEqual(before);
  });

  it('fix round 1: a use added a moment ago (inside the view's 120 ms re-read) is seen at the click: cleanup keeps it, its delete asks first', async () => {
    await openStudio(BOOK((b) => b.images.push(im('ilK', 'unused-K.png', btoa('imglib-unused-K')), im('ilL', 'unused-L.png', btoa('imglib-unused-L')))));
    await openImageDialog();
    expect($('btnImgCleanup').textContent).toContain('(4 ·'); // the drawn view: scimg2, scimg3, ilK, ilL unused
    // in one step, before the dialog's view is re-read: ilK becomes this chapter's plate, then cleanup
    await act(async () => {
      fireEvent.change($('chPlate'), { target: { value: 'ilK' } });
      fireEvent.click($('btnImgCleanup'));
    });
    let b = await exported();
    expect((b.images as Rec[]).map((x) => x.id)).toEqual(['scimg1', 'ilK']);
    expect((b.sections as Rec[])[0]!.plateId).toBe('ilK');
    await click([...document.querySelectorAll('#toasts .toast-action')].pop()!); // Undo the cleanup
    // in one step: ilL becomes the backdrop, then its delete control: the "used in" confirm, not a silent removal
    await act(async () => {
      fireEvent.change($('chBackdrop'), { target: { value: 'ilL' } });
      fireEvent.click(document.querySelector('#imgLib [data-imgdel="ilL"]')!);
    });
    expect($('modalImgRemove')).not.toBeNull();
    expect($('imgRmUses').textContent).toContain(E['imglib.role.backdrop']!);
    await click($('btnImgRmCancel'));
    b = await exported();
    expect((b.images as Rec[]).some((x) => x.id === 'ilL')).toBe(true);
  });

  it("fix round 1: deleting the chosen picture leaves no choice and Insert disabled, as 1.0's imglibRemove (imgSelId = null); Undo does not choose it again", async () => {
    await openStudio(BOOK((b) => b.images.push(im('ilK', 'unused-K.png', btoa('imglib-unused-K')))));
    await openImageDialog();
    expect(document.querySelector('#imgLib .img-cell.active')!.getAttribute('data-libimg')).toBe('ilK');
    await click(document.querySelector('#imgLib [data-imgdel="ilK"]'));
    await waitFor(() => expect(document.querySelector('#imgLib [data-libimg="ilK"]')).toBeNull());
    expect(document.querySelector('#imgLib .img-cell.active')).toBeNull();
    expect(($('btnDoInsertImage') as unknown as HTMLButtonElement).disabled).toBe(true);
    expect($('imgLibNote').textContent).toBe('Pick an image above, or upload a new one.');
    await click([...document.querySelectorAll('#toasts .toast-action')].pop()!);
    await waitFor(() => expect(document.querySelector('#imgLib [data-libimg="ilK"]')).not.toBeNull());
    expect(document.querySelector('#imgLib .img-cell.active')).toBeNull();
    // an upload is chosen however late the library's re-read lands
    await putFile($('imgFileInput'), new File([pngBytes()], 'late.png', { type: 'image/png' }));
    await waitFor(() => expect(document.querySelector('#imgLib .img-cell.active')?.textContent).toBe('late.png'));
    expect(($('btnDoInsertImage') as unknown as HTMLButtonElement).disabled).toBe(false);
  });

  it('the section card: alt and caption kept on change, Standard / Full-bleed, Remove (the picture stays in the library)', async () => {
    await openStudio(BOOK());
    await chooseSection(1);
    await waitFor(() => expect(document.querySelector('#sectionImages .sec-img-row')).not.toBeNull(), { timeout: 5000 });
    expect(document.querySelector('#sectionImages h4')!.textContent).toBe('Images in this section');
    expect(document.querySelector('#sectionImages .si-name')!.textContent).toMatch(/^First Bay\.png · \d+ B$/);
    const alt = document.querySelector<HTMLInputElement>('[data-tokalt="0"]')!;
    alt.value = 'The [new] ferry';
    await act(async () => {
      alt.dispatchEvent(new Event('change'));
    });
    expect(text()).toBe('The harbour woke.\n\n![The new ferry](img:scimg1)\n\nGulls rose.');
    const cap = document.querySelector<HTMLInputElement>('[data-tokcap="0"]')!;
    cap.value = 'At "dawn"';
    await act(async () => {
      cap.dispatchEvent(new Event('change'));
    });
    expect(text()).toBe('The harbour woke.\n\n![The new ferry](img:scimg1 "At dawn")\n\nGulls rose.');
    await click(document.querySelector('[data-tokdisp="0"]'));
    expect(text()).toBe('The harbour woke.\n\n![The new ferry](img:scimg1|full "At dawn")\n\nGulls rose.');
    await click(document.querySelector('[data-tokdel="0"]'));
    expect(text()).toBe('The harbour woke.\n\nGulls rose.');
    expect(toasts().some((x) => x.includes(TOKEN_REMOVED))).toBe(true);
    await waitFor(() => expect(document.querySelector('#sectionImages .sec-img-row')).toBeNull());
    expect(((await exported()).images as Rec[]).length).toBe(3);
  });

  it('the chapter-art rows: plate (alt offered from the name, kept per keystroke), backdrop (strength whisper), No plate', async () => {
    await openStudio(BOOK());
    const plate = $('chPlate') as unknown as HTMLSelectElement;
    expect([...plate.options].map((o) => o.value)).toEqual(['', 'scimg1', 'scimg2', 'scimg3', '__upload__']);
    expect(plate.options[0]!.textContent).toBe(E['editor.plateNone']);
    expect(plate.options[4]!.textContent).toBe(E['editor.plateUpload']);
    expect($('plateAltRow').style.display).toBe('none');
    await act(async () => {
      fireEvent.change(plate, { target: { value: 'scimg2' } });
    });
    expect($('plateAltRow').style.display).toBe('');
    expect($('chPlateAlt').value).toBe('Second Bay');
    await act(async () => {
      fireEvent.change($('chPlateAlt'), { target: { value: 'The bay at dusk' } });
    });
    await act(async () => {
      fireEvent.change($('chBackdrop'), { target: { value: 'scimg3' } });
    });
    expect(($('chBackdropStrength') as unknown as HTMLSelectElement).value).toBe('whisper');
    await act(async () => {
      fireEvent.change($('chBackdropStrength'), { target: { value: 'spread' } });
    });
    let s1 = ((await exported()).sections as Rec[])[0]!;
    expect([s1.plateId, s1.plateAlt, s1.backdropId, s1.backdropStrength]).toEqual(['scimg2', 'The bay at dusk', 'scimg3', 'spread']);
    await act(async () => {
      fireEvent.change(plate, { target: { value: '' } });
    });
    s1 = ((await exported()).sections as Rec[])[0]!;
    expect([s1.plateId, s1.plateAlt]).toEqual([null, 'The bay at dusk']);
    // upload from inside the control: joins the library and becomes the plate in one step
    await act(async () => {
      fireEvent.change(plate, { target: { value: '__upload__' } });
    });
    await putFile($('plateFileInput'), new File([pngBytes()], 'Plate-Art.png', { type: 'image/png' }));
    await waitFor(async () => expect(((await exported()).sections as Rec[])[0]!.plateId).not.toBe(null));
    const b = await exported();
    const up = (b.images as Rec[])[3]!;
    expect((b.sections as Rec[])[0]!.plateId).toBe(up.id);
  });

  it('scene.images.place: the bar names the break; library attach with name and caption; another break its own; upload attach; replace; remove; the text never changes', async () => {
    await openStudio(BOOK());
    const original = text();
    const standOn = async (nth: number) => {
      standOnBreak(nth);
      await waitFor(() => expect($('sceneBar').className).toBe('open'));
    };
    expect($('sceneBar').className).toBe('');
    await standOn(0);
    expect($('sceneBarLabel').textContent).toBe(E['scene.barLabel']!.replace('{n}', '1').replace('{total}', '3'));
    expect($('sceneAddLabel').textContent).toBe(E['scene.add']);
    await click($('btnSceneAdd'));
    expect($('modalScene')).not.toBeNull();
    await waitFor(() => expect(document.querySelector('#sceneLib [data-sceneimg="scimg1"]')).not.toBeNull());
    expect(($('btnDoScene') as unknown as HTMLButtonElement).disabled).toBe(true);
    await click(document.querySelector('#sceneLib [data-sceneimg="scimg1"]'));
    expect($('sceneAlt').value).toBe('First Bay');
    await act(async () => {
      fireEvent.change($('sceneName'), { target: { value: 'The First Bay' } });
      fireEvent.change($('sceneAlt'), { target: { value: 'The first bay at dawn' } });
      fireEvent.change($('sceneCaption'), { target: { value: 'The first bay.' } });
    });
    await click($('btnDoScene'));
    expect(document.getElementById('modalScene')).toBeNull();
    let s = ((await exported()).sections as Rec[])[0]!;
    expect(s.scenes).toEqual([{ at: 0, imageId: 'scimg1', name: 'The First Bay', caption: 'The first bay.', alt: 'The first bay at dawn' }]);
    await waitFor(() => expect($('sceneBarLabel').textContent).toContain('First Bay.png'));
    expect($('sceneAddLabel').textContent).toBe(E['scene.replace']);
    // break 1 from the library, a different picture; an empty alt is refused
    await standOn(1);
    await click($('btnSceneAdd'));
    await waitFor(() => expect(document.querySelector('#sceneLib [data-sceneimg="scimg2"]')).not.toBeNull());
    await click(document.querySelector('#sceneLib [data-sceneimg="scimg2"]'));
    await act(async () => {
      fireEvent.change($('sceneAlt'), { target: { value: '  ' } });
    });
    await click($('btnDoScene'));
    expect(toasts().some((x) => x.includes(E['scene.altNeeded']!))).toBe(true);
    await act(async () => {
      fireEvent.change($('sceneAlt'), { target: { value: 'The second bay at dusk' } });
    });
    await click($('btnDoScene'));
    // break 2 from an upload: joins the library and is chosen; Attach places it
    await standOn(2);
    await click($('btnSceneAdd'));
    await putFile($('sceneFileInput'), new File([pngBytes()], 'Uploaded Bay.png', { type: 'image/png' }));
    await waitFor(() => expect(document.querySelectorAll('#sceneLib [data-sceneimg]').length).toBe(4));
    expect($('sceneAlt').value).toBe('Uploaded Bay');
    await click($('btnDoScene'));
    let b = await exported();
    s = (b.sections as Rec[])[0]!;
    const upId = (b.images as Rec[])[3]!.id;
    expect((s.scenes as Rec[]).map((e) => [e.at, e.imageId])).toEqual([[0, 'scimg1'], [1, 'scimg2'], [2, upId]]);
    // replace break 0 (the picker shows its Remove); then remove it from the bar
    await standOn(0);
    await click($('btnSceneAdd'));
    await waitFor(() => expect(document.querySelector('#sceneLib [data-sceneimg="scimg3"]')).not.toBeNull());
    expect($('btnSceneDetach').style.display).toBe('');
    await click(document.querySelector('#sceneLib [data-sceneimg="scimg3"]'));
    await click($('btnDoScene'));
    s = ((await exported()).sections as Rec[])[0]!;
    expect((s.scenes as Rec[]).map((e) => [e.at, e.imageId])).toEqual([[0, 'scimg3'], [1, 'scimg2'], [2, upId]]);
    await standOn(0);
    await click($('btnSceneRemove'));
    b = await exported();
    s = (b.sections as Rec[])[0]!;
    expect((s.scenes as Rec[]).map((e) => [e.at, e.imageId])).toEqual([[1, 'scimg2'], [2, upId]]);
    expect(s.content).toBe(original);
    expect(text()).toBe(original);
    // off the break, the bar closes
    select(3);
    await waitFor(() => expect($('sceneBar').className).toBe(''));
    // a break planted with the toolbar raises the bar at once (1.0 leaves its caret standing on it)
    select(text().length);
    await click(document.querySelector('#insertToolbar [data-insert="scenebreak"]'));
    await waitFor(() => expect($('sceneBar').className).toBe('open'));
    expect($('sceneBarLabel').textContent).toBe(E['scene.barLabel']!.replace('{n}', '4').replace('{total}', '4'));
  });

  it('scene.images.suggest: prefilled with the chapter title and the scene name; a shelf with nobody signed in gates without a request; Openverse results; nothing placed until Attach', async () => {
    await openStudio(BOOK());
    standOnBreak(0);
    await waitFor(() => expect($('sceneBar').className).toBe('open'));
    await click($('btnSceneAdd'));
    await act(async () => {
      fireEvent.change($('sceneName'), { target: { value: 'The Crossing' } });
    });
    await click($('btnSceneSuggest'));
    expect($('sceneSuggestQuery').value).toBe('The Ferry Crossing The Crossing');
    expect($('sceneSuggestBox').style.display).toBe('');
    // a shelf, nobody signed in: gated, no search request
    const calls: string[] = [];
    const real = globalThis.fetch;
    const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = (async (u: RequestInfo | URL) => {
      const url = String(u);
      calls.push(url);
      if (url === '/api/health') return answer(200, { ok: true });
      if (url === '/api/auth/me') return answer(401, { error: 'no session' });
      return answer(500, {});
    }) as typeof fetch;
    try {
      await click($('btnSceneFind'));
      await waitFor(() => expect($('sceneSuggestStatus').textContent).toBe(E['covermk.photoNeedAccount']));
      expect(calls.some((u) => u.includes('/api/stock/search') || u.includes('openverse'))).toBe(false);
      // no shelf: Openverse directly, mapped by 1.0's cmMapDirectResults; a foreign original is never fetched
      resetCloudProbe();
      calls.length = 0;
      globalThis.fetch = (async (u: RequestInfo | URL) => {
        const url = String(u);
        calls.push(url);
        if (url === '/api/health') throw new TypeError('offline');
        if (url.startsWith('https://api.openverse.org/v1/images/?q=')) {
          return answer(200, { results: [{ title: 'Ferry at dawn', creator: 'Ann', url: 'https://elsewhere.example/full.jpg', thumbnail: 'https://api.openverse.org/v1/images/x/thumb/', foreign_landing_url: 'https://elsewhere.example/p' }] });
        }
        if (url === 'https://api.openverse.org/v1/images/x/thumb/') return new Response(pngBytes(), { status: 200, headers: { 'content-type': 'image/png' } });
        return answer(404, {});
      }) as typeof fetch;
      await click($('btnSceneFind'));
      await waitFor(() => expect(document.querySelectorAll('#sceneSuggestGrid .cm-photo-cell').length).toBe(1));
      expect(calls[calls.length - 1]).toContain('https://api.openverse.org/v1/images/?q=The%20Ferry%20Crossing%20The%20Crossing&page_size=12');
      const cell = document.querySelector('#sceneSuggestGrid .cm-photo-cell')!;
      expect(cell.getAttribute('title')).toBe(E['covermk.photoByOpenverse']!.replace('{name}', 'Ann'));
      expect(cell.querySelector('img')!.getAttribute('src')).toBe('https://api.openverse.org/v1/images/x/thumb/');
      const libBefore = ((await exported()).images as Rec[]).length;
      await click(cell);
      await waitFor(() => expect(document.querySelectorAll('#sceneLib [data-sceneimg]').length).toBe(libBefore + 1));
      expect(calls.includes('https://elsewhere.example/full.jpg')).toBe(false);
      expect($('sceneAlt').value).toBe('Ferry at dawn');
      const b = await exported();
      const pic = (b.images as Rec[])[libBefore]!;
      expect([pic.name, pic.mediaType, pic.ext, pic.credit]).toEqual(['Openverse — Ann', 'image/png', 'png', { name: 'Ann', url: 'https://elsewhere.example/p' }]);
      // nothing at the break until Attach
      expect((b.sections as Rec[])[0]!.scenes).toBeUndefined();
      await click($('btnCloseScene'));
      expect(((await exported()).sections as Rec[])[0]!.scenes).toBeUndefined();
    } finally {
      globalThis.fetch = real;
    }
  });

  it('review focus #3: opening the book, the dialogs and the library, choosing and closing without placing, leaves the export exactly equal', async () => {
    const book = BOOK((b) => {
      (b.sections[0] as Rec).scenes = [{ at: 1, imageId: 'scimg2', name: 'n', caption: '', alt: 'a' }];
      (b.sections[0] as Rec).plateId = 'scimg1';
    });
    await openStudio(book);
    const before = await exported();
    await openImageDialog();
    await click(document.querySelector('#imgLib [data-libimg="scimg1"]'));
    await click(document.querySelector('[data-imgdisp="full"]'));
    await click(document.querySelector('#imgLib [data-imgdel="scimg1"]')); // used: the confirm
    await click($('btnImgRmCancel'));
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    });
    expect(document.getElementById('modalImage')).toBeNull();
    standOnBreak(1);
    await waitFor(() => expect($('sceneBar').className).toBe('open'));
    await click($('btnSceneAdd'));
    await waitFor(() => expect(document.querySelector('#sceneLib [data-sceneimg="scimg3"]')).not.toBeNull());
    await click(document.querySelector('#sceneLib [data-sceneimg="scimg3"]'));
    await click($('btnSceneSuggest'));
    await click($('btnCloseScene'));
    await chooseSection(1);
    await waitFor(() => expect(document.querySelector('#sectionImages .sec-img-row')).not.toBeNull());
    expect(await exported()).toEqual(before);
  });

  it('review focus #4: a malformed, an oversized and a scripted SVG picture neither break the studio nor run anything', async () => {
    const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned=1"><script>window.__pwned=2</script></svg>');
    const bigBytes = new Uint8Array(4 * 1024 * 1024).map((_, i) => i & 255);
    bigBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 100, 0, 0, 0, 100]);
    const big = bytesToBase64(bigBytes);
    await openStudio(BOOK((b) => {
      b.images.push(im('bad1', 'bad.png', '%%%garbage%%%'), { id: 'svg1', name: 'evil.svg', mediaType: 'image/svg+xml', ext: 'svg', data: svg }, im('big1', 'big.png', big));
      (b.sections[1] as Rec).content = '![x](img:bad1)\n\n![y](img:svg1)\n\n![z](img:missing1)';
    }));
    const before = await exported();
    await chooseSection(1);
    await waitFor(() => expect(document.querySelectorAll('#sectionImages .sec-img-row').length).toBe(3));
    expect(document.querySelectorAll('#sectionImages .si-missing').length).toBe(2); // the malformed one and the one not in the library
    await openImageDialog();
    const cells = [...document.querySelectorAll('#imgLib [data-libimg]')];
    expect(cells.length).toBe(6);
    // the malformed picture shows no image; the SVG only ever as an <img> from a data: URL; no script, no svg markup made
    expect(document.querySelector('#imgLib [data-libimg="bad1"] img')).toBeNull();
    const sv = document.querySelector('#imgLib [data-libimg="svg1"] img')!;
    expect(sv.getAttribute('src')!.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(document.querySelectorAll('script').length).toBe(0);
    expect(document.querySelector('#imgLib svg:not(.lucide)')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    // the oversized one (no size cap in 1.0) is shown and its size stated
    expect(document.querySelector('#imgLib [data-libimg="big1"] img')!.getAttribute('src')!.startsWith('data:image/png;base64,')).toBe(true);
    await click(document.querySelector('#imgLib [data-libimg="big1"]'));
    expect($('imgLibNote').textContent).toBe('big.png · 4096.0 KB');
    await click($('btnCloseImage'));
    expect(await exported()).toEqual(before);
  });
});
