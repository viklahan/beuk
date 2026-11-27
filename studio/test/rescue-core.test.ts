// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyRemoteUpdate, incomingUpdate } from '../src/editor/rescueCore';

const SRC = path.join(__dirname, '..', 'src');

describe('the rescue core (pure modules and the one apply function)', () => {
  it('the core is pure: rescueCore.ts imports only yjs and ./textMatch; textMatch.ts imports nothing', () => {
    const imports = (f: string) => [...readFileSync(path.join(SRC, 'editor', f), 'utf8').matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports('rescueCore.ts').sort()).toEqual(['./textMatch', 'yjs']);
    expect(imports('textMatch.ts')).toEqual([]);
  });

  it('applyRemoteUpdate: the bytes are known for exactly that apply, and gone after', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    let u: Uint8Array | null = null;
    a.on('update', (x: Uint8Array) => { u = x; });
    a.getText('t').insert(0, 'hello');
    const seen: (Uint8Array | null)[] = [];
    b.on('afterTransaction', () => void seen.push(incomingUpdate(b)));
    applyRemoteUpdate(b, u!, 'test');
    expect(seen).toEqual([u]);
    expect(incomingUpdate(b)).toBeNull();
    expect(b.getText('t').toString()).toBe('hello');
  });

  it('applyRemoteUpdate: a nested apply restores the outer bytes; a throwing apply leaves none behind', () => {
    const mk = (text: string) => {
      const d = new Y.Doc();
      let u: Uint8Array | null = null;
      d.on('update', (x: Uint8Array) => { u = x; });
      d.getText('t').insert(0, text);
      return u!;
    };
    const outer = mk('outer');
    const other = mk('other');
    const b = new Y.Doc();
    const afterNested: (Uint8Array | null)[] = [];
    let nested = false;
    b.on('afterTransaction', () => {
      if (nested) return;
      nested = true;
      applyRemoteUpdate(b, other, 'nested');
      afterNested.push(incomingUpdate(b));
    });
    applyRemoteUpdate(b, outer, 'outer');
    expect(afterNested).toEqual([outer]);
    expect(incomingUpdate(b)).toBeNull();

    const c = new Y.Doc();
    expect(() => applyRemoteUpdate(c, new Uint8Array([255]), 'bad')).toThrow();
    expect(incomingUpdate(c)).toBeNull();
  });

  it("store.ts applies a tab's update through applyRemoteUpdate only", () => {
    const src = readFileSync(path.join(SRC, 'book', 'store.ts'), 'utf8');
    expect(src).not.toMatch(/Y\.applyUpdate\(/);
    expect(src.match(/applyRemoteUpdate\(/g)).toHaveLength(1);
  });
});
