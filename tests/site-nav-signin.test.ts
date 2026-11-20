import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteNavHtml } from '../src/warmth/pages.js';

test('signed out, the nav offers Sign in and no account link', () => {
  const html = siteNavHtml();
  assert.match(html, /<a href="\/studio\?signin">Sign in<\/a>/);
  assert.doesNotMatch(html, /Your account/);
});

test('signed in, Sign in becomes Your account in the same place, once', () => {
  const html = siteNavHtml({ signedIn: true, current: '/account' });
  assert.doesNotMatch(html, /Sign in/);
  assert.equal(html.match(/Your account/g)?.length, 1);
  assert.match(html, /<a href="\/help">Help<\/a>\s*<a href="\/account" aria-current="page">Your account<\/a>\s*<a href="\/studio">Start writing<\/a>/);
});
