/* The import-shapes grid: one JSON source per manuscript shape — the
   blocks of the book in order, the formats the shape makes sense in, and
   the structure a writer would call a correct import (written before any
   run, never copied from what the importer produced). */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GRID = path.join(REPO, 'tests', 'fixtures', 'manuscripts');
export const SHAPES_DIR = path.join(GRID, 'shapes');
export const OUT_DIR = path.join(GRID, 'files');
export const MANIFEST = path.join(GRID, 'manifest.json');

export const FORMATS = ['docx', 'pdf', 'rtf', 'txt', 'md'] as const;
export type Format = (typeof FORMATS)[number];

const text = z.string();
const BlockSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('title'), text, spaced: z.boolean().optional() }).strict(),
  z.object({ t: z.literal('byline'), text, spaced: z.boolean().optional() }).strict(),
  z.object({ t: z.literal('series'), text }).strict(),
  z.object({
    t: z.literal('heading'), text, level: z.union([z.literal(1), z.literal(2)]),
    lines: z.array(z.string()).optional(), kicker: z.string().optional(), caps: z.boolean().optional(),
    style: z.enum(['Heading1', 'Heading2', 'BoldNormal']).optional(), setext: z.boolean().optional(),
  }).strict(),
  z.object({ t: z.literal('para'), text, dropcap: z.boolean().optional() }).strict(),
  z.object({ t: z.literal('break'), marker: z.enum(['***', '*   *   *', '§', '— — —', '•', 'space']) }).strict(),
  z.object({ t: z.literal('filler'), seed: z.number().int(), words: z.number().int().positive() }).strict(),
  z.object({ t: z.literal('contents'), entries: z.array(z.string()) }).strict(),
]);

const ExpectedSectionSchema = z.object({
  kind: z.enum(['front', 'body', 'back']),
  type: z.string().optional(),
  number: z.number().int().nullable().optional(),
  title: z.string().optional(),
  breaks: z.number().int().nonnegative().optional(),
}).strict();

const ExpectedSchema = z.object({
  meta: z.object({ title: z.string().optional(), author: z.string().optional(), seriesLine: z.string().optional() }).strict().optional(),
  sections: z.array(ExpectedSectionSchema),
  mustNotAppear: z.array(z.string()).optional(),
}).strict();

const ShapeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  from: z.enum(['marketbooks', 'scratch']),
  formats: z.array(z.enum(FORMATS)).min(1),
  blocks: z.array(BlockSchema),
  expected: ExpectedSchema,
}).strict();

export type Block = z.infer<typeof BlockSchema>;
export type ExpectedSection = z.infer<typeof ExpectedSectionSchema>;
export type Expected = z.infer<typeof ExpectedSchema>;
export type Shape = z.infer<typeof ShapeSchema>;

/** Every source in `dir`, parsed and sorted by id; a bad one throws naming its file. */
export function loadShapes(dir: string = SHAPES_DIR): Shape[] {
  let files: string[];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  return files.map((f) => {
    try { return ShapeSchema.parse(JSON.parse(readFileSync(path.join(dir, f), 'utf8'))); }
    catch (e) { throw new Error(`${f}: ${e instanceof Error ? e.message : String(e)}`); }
  }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
