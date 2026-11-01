import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELF_CHECK_CASES } from '../src/housekeeping/registry.js';

/* BEUK:remnants — when the writer does not want the sample, nothing of it
   stays: Remove leaves no title, name, id or picture in the book, the
   device save (current or last-good copy) or the writing log, and an
   empty desk reports no pages or progress. The behaviour runs in the
   studio (two self-checks); server side: their Housekeeping
   registration and static guards over client/index.html. */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientHtml = () => readFile(path.join(here, '..', 'client', 'index.html'), 'utf8');
const IDS = ['sample.empty-desk.no-figures', 'sample.remove.leaves-nothing'];

test('remnants: both self-checks exist in the client and are registered client-only with a reason', async () => {
  const html = await clientHtml();
  for (const id of IDS) {
    assert.ok(html.includes(`{ id: "${id}"`), `${id} present in the client self-checks`);
    const c = SELF_CHECK_CASES.find((x) => x.id === id);
    assert.ok(c, `${id} registered`);
    assert.equal(c!.kind, 'client-only', id);
    assert.ok(c!.reason && c!.reason.length > 10, `${id} has a reason`);
  }
});

test('remnants: the sample-edited comparison leaves History out, and a stored fingerprint is normalised on restore', async () => {
  const html = await clientHtml();
  const cmp = html.slice(html.indexOf('const sampleComparableJson = () =>'), html.indexOf('function sampleLoadedJsonNormal('));
  assert.match(cmp, /delete d\.history; delete d\.historyPool;/);
  const restore = html.slice(html.indexOf('async function localRestore() {'), html.indexOf('/* ---- signed in: reconcile'));
  assert.match(restore, /sampleLoadedJsonNormal\(found\.sample\.loadedJson\)/);
});

test('remnants: after Remove the next device save writes the empty desk over the last-good copy', async () => {
  const html = await clientHtml();
  const clear = html.slice(html.indexOf('function clearDeskToEmpty() {'), html.indexOf('function removeSampleStory() {'));
  assert.match(clear, /local\.dropPrev = true/);
  const write = html.slice(html.indexOf('function localWrite(json, link, pics) {'), html.indexOf('function localWriteLinkOnly() {'));
  assert.ok(write.length > 0, 'localWrite found');
  assert.match(write, /if \(dropPrev\) store\.put\(rec, "book-prev"\);/);
  assert.match(write, /if \(dropPrev\) local\.dropPrev = false;/);
  // BEUK:localpics — pictures stored beside the record follow the same rule: after Remove only the new record's are kept
  assert.match(write, /const prevRec = dropPrev \? rec :/);
});
