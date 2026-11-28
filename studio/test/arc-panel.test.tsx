import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import en from '../src/generated/packs/en.json';
import meta from '../src/generated/strings-meta.json';
import { ArcDialog, ArcSection, endOfLocalDay } from '../src/arc/ArcPanel';
import { setArcFetch } from '../src/arc/net';
import { cloudFacts, resetCloudFacts } from '../src/closure/index';
import { LocaleProvider } from '../src/i18n/LocaleProvider';
import { DialogStackProvider } from '../src/shell/Dialog';

/* ARC slice 1, Task 8: the author's ARC panel (studio/src/arc/ArcPanel.tsx) on a recording fake of the owner API
   (src/routes/arc.ts: GET/POST /api/arc, readers, approve/decline/revoke, close, signup-link, delete). The first seven
   tests are the plan's (Task 8 Step 2), with its exact values; the rest are added by this task for the controller's
   rulings (F10 ended campaign, I5 suppressed approve, an unsent mail, a refused start) and the section's visibility.
   English strings asserted here are the plan's (arcp.stamp, arcp.noReview) or read from the English pack. */

vi.mock('../src/book/BookProvider', () => ({ useBook: () => ({ title: 'The Salt Road' }) }));

const E = en as Record<string, string>;
type Call = { method: string; path: string; body: Record<string, unknown> | null };
type Reply = { status: number; body?: unknown };
let calls: Call[];
let routes: Record<string, Reply | ((c: Call) => Reply)>;

function fakeFetch(): typeof fetch {
  return (async (p: string, init?: RequestInit) => {
    const method = (init?.method || 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const c = { method, path: p, body };
    calls.push(c);
    const r = routes[method + ' ' + p];
    const reply = typeof r === 'function' ? r(c) : r;
    if (!reply) return new Response(JSON.stringify({ error: 'no route in the fake: ' + method + ' ' + p }), { status: 404 });
    if (reply.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  }) as unknown as typeof fetch;
}

const MAIL_ON = { configured: true, reason: null };
const campaign = (over: Record<string, unknown> = {}) => ({
  id: 'c1', shareId: 's1', manuscriptId: 'm1', title: 'The Salt Road', launchDate: '2027-02-14', closesAt: endOfLocalDay('2027-02-14'),
  tz: 'Europe/London', maxClaims: 50, approvalMode: 'instant', state: 'open', createdAt: '2026-11-27T10:00:00.000Z', endedAt: null,
  counts: { claimed: 1, pending: 1, declined: 0, revoked: 0 }, build: { label: 'v1.0', bytes: 12345, holders: 1 }, ...over,
});
const reader = (over: Record<string, unknown> = {}) => ({
  id: 'r1', name: 'Sarah Reed', email: 'sarah@example.com', status: 'pending', profileLink: null, claimedAt: null, revokedAt: null,
  firstOpenedAt: null, lastOpenedAt: null, mailStopped: false, ...over,
});
const GET = 'GET /api/arc?manuscriptId=m1';
/** A local calendar day `n` days from today, as the date inputs take it (the form refuses days before today, C8). */
const inDays = (n: number) => {
  const d = new Date();
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const LAUNCH = inDays(79);

beforeEach(() => {
  calls = [];
  routes = {};
  resetCloudFacts();
  setArcFetch(fakeFetch());
});
afterEach(() => {
  cleanup();
  setArcFetch(null);
  document.body.innerHTML = '';
});

function panel(open = true) {
  const ui = (o: boolean) => (
    <LocaleProvider initial="en">
      <DialogStackProvider>
        <ArcDialog open={o} onClose={() => undefined} manuscriptId="m1" title="The Salt Road" />
      </DialogStackProvider>
    </LocaleProvider>
  );
  const r = render(ui(open));
  return { ...r, reopen: async () => { r.rerender(ui(false)); r.rerender(ui(true)); await settle(); } };
}
const settle = async (n = 8) => {
  for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const text = () => document.body.textContent || '';
const button = (name: string) => Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === name) ?? null;
const row = (id: string) => document.querySelector<HTMLElement>(`[data-reader="${id}"]`)!;
const rowButton = (id: string, name: string) => Array.from(row(id).querySelectorAll('button')).find((b) => (b.textContent || '').trim() === name) ?? null;
const input = (label: string) => {
  const lab = Array.from(document.querySelectorAll('label')).find((l) => (l.textContent || '').trim().startsWith(label));
  return document.getElementById(lab!.htmlFor) as HTMLInputElement;
};

describe("the author's ARC panel (the plan's tests)", () => {
  it('says plainly when ARC mail is not set up, and offers no form', async () => {
    routes[GET] = { status: 200, body: { mail: { configured: false, reason: 'ARC_MAIL_FROM is not set' }, campaign: null } };
    panel();
    await settle();
    // the server's reason, in the panel's words (final fix wave, C8)
    expect(text()).toContain(E['arcp.mailOff']!.replace('{reason}', E['arcp.mailWhy.from']!));
    expect(button('Start the ARC')).toBeNull();
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it('starts a campaign with exactly the chosen settings', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: null } };
    routes['POST /api/arc'] = { status: 201, body: { campaign: campaign({ counts: { claimed: 0, pending: 0, declined: 0, revoked: 0 } }), signupToken: 'tok', signupUrl: 'https://beuk.example/arc/tok' } };
    panel();
    await settle();
    fireEvent.change(input(E['arcp.launch']!), { target: { value: LAUNCH } });
    fireEvent.click(button('Start the ARC')!);
    await settle();
    const post = calls.filter((c) => c.method === 'POST' && c.path === '/api/arc');
    expect(post.length).toBe(1);
    expect(post[0]!.body).toEqual({
      manuscriptId: 'm1', launchDate: LAUNCH, closesAt: endOfLocalDay(LAUNCH), tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      maxClaims: 50, approvalMode: 'instant', lang: 'en',
    });
  });

  // Superseded by the final fix wave (final review Important 3): the server derives the link again on every read, so
  // the panel shows it, with Copy, after a reload too (the plan's "shown once" is gone).
  it('shows the signup link with Copy, and again after a reload', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: null } };
    routes['POST /api/arc'] = { status: 201, body: { campaign: campaign({ counts: { claimed: 0, pending: 0, declined: 0, revoked: 0 } }), signupToken: 'tok', signupUrl: 'https://beuk.example/arc/tok' } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [] } };
    const p = panel();
    await settle();
    fireEvent.change(input(E['arcp.launch']!), { target: { value: LAUNCH } });
    fireEvent.click(button('Start the ARC')!);
    await settle();
    const url = document.querySelector<HTMLInputElement>('input[readonly]');
    expect(url?.value).toBe('https://beuk.example/arc/tok');
    expect(button(E['arcp.copy']!)).not.toBeNull();
    expect(text()).not.toContain(E['arcp.linkNone']);
    // reopening: the campaign and its link are read back from the server
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign(), campaigns: [campaign()], signupUrl: 'https://beuk.example/arc/tok' } };
    await p.reopen();
    expect(document.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe('https://beuk.example/arc/tok');
    expect(button(E['arcp.copy']!)).not.toBeNull();
    // a server that cannot show it (its salt changed) says so, and offers a new link
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign(), campaigns: [campaign()], signupUrl: null } };
    await p.reopen();
    expect(text()).toContain(E['arcp.linkNone']);
    expect(document.body.innerHTML).not.toContain('beuk.example/arc/tok');
    expect(button(E['arcp.copy']!)).toBeNull();
    expect(button(E['arcp.newLink']!)).not.toBeNull();
  });

  it('lists readers with the right actions', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign({ approvalMode: 'approval' }) } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [reader(), reader({ id: 'r2', name: 'Tom Hale', email: 'tom@example.com', status: 'claimed', claimedAt: '2026-11-27T11:00:00.000Z' })] } };
    routes['POST /api/arc/c1/readers/r1/approve'] = { status: 200, body: { reader: reader({ status: 'claimed' }), mail: { sent: true } } };
    panel();
    await settle();
    expect(rowButton('r1', E['arcp.approve']!)).not.toBeNull();
    expect(rowButton('r1', E['arcp.decline']!)).not.toBeNull();
    expect(rowButton('r1', E['arcp.revoke']!)).toBeNull();
    expect(rowButton('r2', E['arcp.revoke']!)).not.toBeNull();
    expect(rowButton('r2', E['arcp.approve']!)).toBeNull();
    expect(rowButton('r2', E['arcp.decline']!)).toBeNull();
    expect(within(row('r1')).getByText('sarah@example.com')).toBeTruthy();
    expect(within(row('r1')).getByText(E['arcp.stPending']!)).toBeTruthy();
    expect(within(row('r2')).getByText(E['arcp.stClaimed']!)).toBeTruthy();
    fireEvent.click(rowButton('r1', E['arcp.approve']!)!);
    await settle();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/arc/c1/readers/r1/approve']);
  });

  it('shows the profile link as text, never as a link', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign({ approvalMode: 'approval' }) } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [reader({ profileLink: 'https://www.goodreads.com/user/show/1-sarah' })] } };
    const { container } = panel();
    await settle();
    expect(text()).toContain('https://www.goodreads.com/user/show/1-sarah');
    expect(container.querySelector('a[href*="goodreads"]')).toBeNull();
    expect(document.querySelector('a[href*="goodreads"]')).toBeNull();
    expect(document.querySelector('a, img, iframe, link')).toBeNull();
    // and Beuk never fetches it
    expect(calls.some((c) => c.path.includes('goodreads'))).toBe(false);
  });

  it('says the stamp deters but cannot stop piracy, and never asks for a review', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: null } };
    panel();
    await settle();
    // the plan's verbatim lines (Global Constraints; Task 8 brief)
    expect(text()).toContain('Each copy names its reader. That deters sharing; it cannot stop a determined pirate.');
    expect(text()).toContain("Copies are free. Readers are never asked for a review; if they'd like to review it, that's their choice.");
    expect(text()).not.toMatch(/exchange/i);
    // and the running campaign says the stamp line too
    cleanup();
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign() } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [] } };
    panel();
    await settle();
    expect(text()).toContain('it cannot stop a determined pirate');
    expect(text()).not.toMatch(/exchange/i);
  });

  it('caps copies at 50', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: null } };
    panel();
    await settle();
    const copies = document.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(copies.getAttribute('max')).toBe('50');
    expect(copies.getAttribute('min')).toBe('1');
    expect(copies.value).toBe('50');
    fireEvent.change(input(E['arcp.launch']!), { target: { value: LAUNCH } });
    expect(button('Start the ARC')!.disabled).toBe(false);
    fireEvent.change(copies, { target: { value: '51' } });
    expect(button('Start the ARC')!.disabled).toBe(true);
    expect(text()).toContain(E['arcp.copiesBad']);
    fireEvent.change(copies, { target: { value: '0' } });
    expect(button('Start the ARC')!.disabled).toBe(true);
    fireEvent.change(copies, { target: { value: '12' } });
    expect(button('Start the ARC')!.disabled).toBe(false);
  });
});

describe('the panel, beyond the plan (controller rulings)', () => {
  it('endOfLocalDay is 23:59:59 local time that day, as an ISO instant; a non-date is empty', () => {
    expect(endOfLocalDay('2027-02-14')).toBe(new Date(2027, 1, 14, 23, 59, 59, 0).toISOString());
    expect(endOfLocalDay('2027-02-30')).toBe('');
    expect(endOfLocalDay('')).toBe('');
  });

  it('the sign-ups close date follows the launch date until the author changes it, and the approval mode is sent', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: null } };
    routes['POST /api/arc'] = { status: 201, body: { campaign: campaign(), signupToken: 't', signupUrl: 'https://beuk.example/arc/t' } };
    panel();
    await settle();
    fireEvent.change(input(E['arcp.launch']!), { target: { value: LAUNCH } });
    expect(input(E['arcp.closes']!).value).toBe(LAUNCH);
    fireEvent.change(input(E['arcp.closes']!), { target: { value: inDays(66) } });
    fireEvent.change(input(E['arcp.launch']!), { target: { value: inDays(94) } });
    expect(input(E['arcp.closes']!).value).toBe(inDays(66));
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="number"]')!, { target: { value: '12' } });
    fireEvent.click(input(E['arcp.approval']!));
    expect(text()).toContain(E['arcp.approvalHint']);
    fireEvent.click(button('Start the ARC')!);
    await settle();
    const body = calls.find((c) => c.method === 'POST')!.body!;
    expect(body).toMatchObject({ launchDate: inDays(94), closesAt: endOfLocalDay(inDays(66)), maxClaims: 12, approvalMode: 'approval' });
  });

  it('while the EPUB builds it says so; a refused start shows the server\'s words and keeps the form', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: null } };
    let release: (r: Reply) => void = () => undefined;
    setArcFetch((async (p: string, init?: RequestInit) => {
      if ((init?.method || 'GET') === 'POST') {
        const r = await new Promise<Reply>((res) => (release = res));
        return new Response(JSON.stringify(r.body), { status: r.status });
      }
      return fakeFetch()(p, init);
    }) as unknown as typeof fetch);
    panel();
    await settle();
    fireEvent.change(input(E['arcp.launch']!), { target: { value: LAUNCH } });
    fireEvent.click(button('Start the ARC')!);
    await settle();
    expect(text()).toContain(E['arcp.building']);
    expect(button('Start the ARC')!.disabled).toBe(true);
    release({ status: 400, body: { error: 'closesAt must be in the future: sign-ups cannot close before they open' } });
    await settle();
    expect(text()).toContain('closesAt must be in the future: sign-ups cannot close before they open');
    expect(text()).not.toContain(E['arcp.building']);
    expect(button('Start the ARC')!.disabled).toBe(false);
  });

  it('a start refused because ARC mail is off says which setting is missing, and the form goes', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: null } };
    routes['POST /api/arc'] = { status: 409, body: { error: 'ARC email is not set up on this server (ARC_SMTP_URL is not set), so a campaign cannot start yet.', mail: { configured: false, reason: 'ARC_SMTP_URL is not set' } } };
    panel();
    await settle();
    fireEvent.change(input(E['arcp.launch']!), { target: { value: LAUNCH } });
    fireEvent.click(button('Start the ARC')!);
    await settle();
    // the server's reason in the panel's words (C8: the four reasons are mapped)
    expect(text()).toContain(E['arcp.mailWhy.smtp']);
    expect(button('Start the ARC')).toBeNull();
  });

  it('a reader who pressed Stop: the refusal is told in the panel\'s own words (by its code), and Decline stays', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign({ approvalMode: 'approval' }) } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [reader({ mailStopped: true })] } };
    routes['POST /api/arc/c1/readers/r1/approve'] = { status: 409, body: { error: 'reader-suppressed', message: 'SERVER ENGLISH', scope: 'owner' } };
    panel();
    await settle();
    expect(within(row('r1')).getByText(E['arcp.mailStopped']!)).toBeTruthy();
    fireEvent.click(rowButton('r1', E['arcp.approve']!)!);
    await settle();
    expect(row('r1').textContent).toContain(E['arcp.suppressedOwner']);
    expect(text()).not.toContain('SERVER ENGLISH');
    expect(text()).not.toContain('reader-suppressed');
    expect(rowButton('r1', E['arcp.decline']!)).not.toBeNull();
    // "Not me" (scope all) has its own words
    routes['POST /api/arc/c1/readers/r1/approve'] = { status: 409, body: { error: 'reader-suppressed', message: 'SERVER ENGLISH', scope: 'all' } };
    fireEvent.click(rowButton('r1', E['arcp.approve']!)!);
    await settle();
    expect(row('r1').textContent).toContain(E['arcp.suppressedAll']);
  });

  it('a decline whose email did not go says so (mail.sent false), with the reason', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign({ approvalMode: 'approval' }) } };
    let declined = false;
    routes['GET /api/arc/c1/readers'] = () => ({ status: 200, body: { readers: [reader({ status: declined ? 'declined' : 'pending' })] } });
    routes['POST /api/arc/c1/readers/r1/decline'] = () => {
      declined = true;
      return { status: 200, body: { reader: reader({ status: 'declined' }), mail: { sent: false, reason: 'rate-limited', detail: 'over the hourly limit' } } };
    };
    panel();
    await settle();
    fireEvent.click(rowButton('r1', E['arcp.decline']!)!);
    await settle();
    fireEvent.click(document.getElementById('btnConfirmYes')!);
    await settle();
    // the reason in the panel's words (C8: mail.reason mapped), not the server's English detail
    expect(row('r1').textContent).toContain(E['arcp.notSent']!.replace('{detail}', E['arcp.sendWhy.limit']!));
    expect(row('r1').textContent).not.toContain('over the hourly limit');
    expect(within(row('r1')).getByText(E['arcp.stDeclined']!)).toBeTruthy();
    expect(rowButton('r1', E['arcp.decline']!)).toBeNull();
  });

  it('Close this copy, Close sign-ups and Delete each ask first, and do nothing on Cancel', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign() } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [reader({ status: 'claimed' })] } };
    routes['POST /api/arc/c1/readers/r1/revoke'] = { status: 200, body: { reader: reader({ status: 'claimed', revokedAt: '2026-11-27T12:00:00.000Z' }) } };
    routes['DELETE /api/arc/c1'] = { status: 204 };
    panel();
    await settle();
    const confirmBody = () => document.getElementById('confirmBody')?.textContent || '';
    fireEvent.click(rowButton('r1', E['arcp.revoke']!)!);
    await settle();
    // C8: the confirm names the reader
    expect(confirmBody()).toBe(E['arcp.revokeConfirm']!.replace('{name}', 'Sarah Reed').replace('{email}', 'sarah@example.com'));
    expect(E['arcp.revokeConfirm']).toMatch(/\{name\}.*\{email\}/);
    fireEvent.click(document.getElementById('btnConfirmNo')!);
    await settle();
    fireEvent.click(button(E['arcp.closeSignups']!)!);
    await settle();
    expect(confirmBody()).toBe(E['arcp.closeConfirm']);
    fireEvent.click(document.getElementById('btnConfirmNo')!);
    await settle();
    fireEvent.click(button(E['arcp.delete']!)!);
    await settle();
    // the plan's words (Task 8 brief, ruling F15)
    expect(confirmBody()).toBe("Delete this ARC? Its readers' links stop working, and their names and email addresses are removed from Beuk. Copies already inside backups stay until those backups are deleted.");
    fireEvent.click(document.getElementById('btnConfirmNo')!);
    await settle();
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
    // yes, this time
    fireEvent.click(rowButton('r1', E['arcp.revoke']!)!);
    await settle();
    fireEvent.click(document.getElementById('btnConfirmYes')!);
    await settle();
    fireEvent.click(button(E['arcp.delete']!)!);
    await settle();
    fireEvent.click(document.getElementById('btnConfirmYes')!);
    await settle();
    expect(calls.filter((c) => c.method !== 'GET').map((c) => c.method + ' ' + c.path)).toEqual(['POST /api/arc/c1/readers/r1/revoke', 'DELETE /api/arc/c1']);
  });

  it('a new signup link asks first (default No), then shows the new link', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign(), signupUrl: 'https://beuk.example/arc/old' } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [] } };
    routes['POST /api/arc/c1/signup-link'] = { status: 200, body: { signupToken: 'new', signupUrl: 'https://beuk.example/arc/new' } };
    panel();
    await settle();
    expect(document.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe('https://beuk.example/arc/old');
    fireEvent.click(button(E['arcp.newLink']!)!);
    await settle();
    expect(document.getElementById('confirmBody')?.textContent).toBe(E['arcp.newLinkConfirm']);
    expect(document.activeElement?.id).toBe('btnConfirmNo');
    fireEvent.click(document.getElementById('btnConfirmNo')!);
    await settle();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(document.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe('https://beuk.example/arc/old');
    fireEvent.click(button(E['arcp.newLink']!)!);
    await settle();
    fireEvent.click(document.getElementById('btnConfirmYes')!);
    await settle();
    expect(document.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe('https://beuk.example/arc/new');
  });

  it('the counts, the close date and "Readers hold v1.0 (n)"', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign({ counts: { claimed: 12, pending: 3, declined: 1, revoked: 0 }, build: { label: 'v1.0', bytes: 1, holders: 12 } }) } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [] } };
    panel();
    await settle();
    expect(text()).toContain('Claimed: 12 of 50');
    expect(text()).toContain('Waiting for you: 3');
    expect(text()).toContain('Readers hold v1.0 (12)');
    const day = new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(new Date(2027, 1, 14));
    expect(text()).toContain('Sign-ups close: ' + day);
  });

  it('never shows an invented "v1.0": with no label from the server, the line names none (C8)', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign({ build: { label: '', bytes: 1, holders: 4 } }) } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [] } };
    panel();
    await settle();
    expect(text()).toContain(E['arcp.holdersN']!.replace('{n}', '4'));
    expect(text()).not.toContain('v1.0');
  });

  it('an ended campaign (F10, P8): summarised with its readers — waiting ones only declined, copies closed — and the start form is offered', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign({ state: 'ended', endedAt: '2027-02-10T09:00:00.000Z', approvalMode: 'approval', counts: { claimed: 7, pending: 1, declined: 0, revoked: 0 } }) } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [reader(), reader({ id: 'r2', status: 'claimed', publicId: 'pubAAAA1111bbbb' })] } };
    routes['POST /api/arc/c1/readers/r1/decline'] = { status: 200, body: { reader: reader({ status: 'declined' }), mail: { sent: true } } };
    routes['POST /api/arc/c1/readers/r2/revoke'] = { status: 200, body: { reader: reader({ id: 'r2', status: 'claimed', revokedAt: '2027-02-11T09:00:00.000Z' }) } };
    panel();
    await settle();
    const day = new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(new Date('2027-02-10T09:00:00.000Z'));
    expect(text()).toContain(E['arcp.pastH']);
    expect(text()).toContain(E['arcp.endedSum']!.replace('{date}', day).replace('{n}', '7').replace('{max}', '50'));
    // minor 6: it says the waiting readers can only be declined
    expect(text()).toContain(E['arcp.endedWaiting']);
    expect(E['arcp.endedWaiting']).toMatch(/only be declined/);
    // the waiting reader: Decline, no Approve; the claimed one: Close this copy (P8)
    expect(rowButton('r1', E['arcp.approve']!)).toBeNull();
    expect(rowButton('r1', E['arcp.decline']!)).not.toBeNull();
    expect(rowButton('r2', E['arcp.revoke']!)).not.toBeNull();
    expect(row('r2').textContent).toContain(E['arcp.copyNo']!.replace('{id}', 'pubAAAA1111bbbb'));
    expect(button(E['arcp.closeSignups']!)).toBeNull();
    expect(button(E['arcp.delete']!)).not.toBeNull();
    expect(button('Start the ARC')).not.toBeNull();
    fireEvent.click(rowButton('r1', E['arcp.decline']!)!);
    await settle();
    expect(document.getElementById('confirmBody')?.textContent).toBe(E['arcp.declineConfirm']!.replace('{name}', 'Sarah Reed').replace('{email}', 'sarah@example.com'));
    fireEvent.click(document.getElementById('btnConfirmYes')!);
    await settle();
    fireEvent.click(rowButton('r2', E['arcp.revoke']!)!);
    await settle();
    fireEvent.click(document.getElementById('btnConfirmYes')!);
    await settle();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/arc/c1/readers/r1/decline', '/api/arc/c1/readers/r2/revoke']);
  });

  it('every campaign of the book (P8): the running one first, earlier ones below with their readers and Delete', async () => {
    const old = campaign({ id: 'c0', state: 'ended', endedAt: '2026-10-01T09:00:00.000Z', counts: { claimed: 3, pending: 0, declined: 0, revoked: 0 } });
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign(), campaigns: [campaign(), old], signupUrl: 'https://beuk.example/arc/live' } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [reader({ id: 'r1', status: 'claimed' })] } };
    routes['GET /api/arc/c0/readers'] = { status: 200, body: { readers: [reader({ id: 'r9', name: 'Old Reader', email: 'old@example.com', status: 'claimed' })] } };
    routes['DELETE /api/arc/c0'] = { status: 204 };
    panel();
    await settle();
    const running = document.querySelector('[data-arcp="running"]')!;
    const past = document.querySelector('[data-arcp="past"][data-campaign="c0"]')!;
    expect(running.compareDocumentPosition(past) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(past as HTMLElement).getByText('old@example.com')).toBeTruthy();
    expect(rowButton('r9', E['arcp.revoke']!)).not.toBeNull();
    expect(button('Start the ARC')).toBeNull();
    fireEvent.click(past.querySelector<HTMLButtonElement>('[data-arcp="delete-past"]')!);
    await settle();
    fireEvent.click(document.getElementById('btnConfirmYes')!);
    await settle();
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/api/arc/c0']);
  });

  it("a reader's name and email are isolated (<bdi>), and the copy number is shown", async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign() } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [reader({ name: 'سارة', status: 'claimed', publicId: 'Zx9_0123456789ab' })] } };
    panel();
    await settle();
    const bdis = Array.from(row('r1').querySelectorAll('bdi')).map((b) => b.textContent);
    expect(bdis).toEqual(['سارة', 'sarah@example.com']);
    expect(row('r1').textContent).toContain(E['arcp.copyNo']!.replace('{id}', 'Zx9_0123456789ab'));
  });

  it('a refusal is said beside its button and the panel stays (C8)', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign() } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [reader({ status: 'claimed' })] } };
    routes['POST /api/arc/c1/close'] = { status: 409, body: { error: 'SERVER: cannot close now' } };
    routes['POST /api/arc/c1/signup-link'] = { status: 409, body: { error: 'SERVER: no new link' } };
    panel();
    await settle();
    fireEvent.click(button(E['arcp.closeSignups']!)!);
    await settle();
    fireEvent.click(document.getElementById('btnConfirmYes')!);
    await settle();
    const closeNote = document.querySelector('[data-arcp-note="close:c1"]');
    expect(closeNote?.textContent).toBe('SERVER: cannot close now');
    // beside its button: right after the row of campaign buttons
    expect(closeNote!.previousElementSibling?.querySelector('#btnArcpCloseSignups')).not.toBeNull();
    expect(document.querySelector('[data-arcp="running"]')).not.toBeNull();
    expect(row('r1')).not.toBeNull();
    fireEvent.click(button(E['arcp.newLink']!)!);
    await settle();
    fireEvent.click(document.getElementById('btnConfirmYes')!);
    await settle();
    expect(document.querySelector('[data-arcp-note="link"]')?.textContent).toBe('SERVER: no new link');
    expect(document.querySelector('[data-arcp="running"]')).not.toBeNull();
    // a read that fails once things are shown: said on top, and what was shown stays
    routes[GET] = { status: 500, body: { error: 'SERVER: down for a moment' } };
    fireEvent.click(button(E['arcp.closeSignups']!)!);
    await settle();
    fireEvent.click(document.getElementById('btnConfirmYes')!);
    await settle();
    expect(document.querySelector('[data-arcp="load-note"]')?.textContent).toBe('SERVER: down for a moment');
    expect(document.querySelector('[data-arcp="running"]')).not.toBeNull();
  });

  it('buttons stay disabled until the panel has read everything again after an action (C8 busy window)', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign({ approvalMode: 'approval' }) } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [reader(), reader({ id: 'r2', name: 'Tom', email: 'tom@example.com' })] } };
    routes['POST /api/arc/c1/readers/r1/approve'] = { status: 200, body: { reader: reader({ status: 'claimed' }), mail: { sent: true } } };
    let open: () => void = () => undefined;
    let hold = false;
    setArcFetch((async (p: string, init?: RequestInit) => {
      if (hold && p === '/api/arc?manuscriptId=m1') await new Promise<void>((res) => (open = res));
      return fakeFetch()(p, init);
    }) as unknown as typeof fetch);
    panel();
    await settle();
    hold = true;
    fireEvent.click(rowButton('r1', E['arcp.approve']!)!);
    await settle();
    // the approve has answered; the read-back is still out
    expect(calls.some((c) => c.method === 'POST')).toBe(true);
    expect(rowButton('r2', E['arcp.approve']!)!.disabled).toBe(true);
    expect(button(E['arcp.closeSignups']!)!.disabled).toBe(true);
    hold = false;
    open();
    await settle();
    expect(rowButton('r2', E['arcp.approve']!)!.disabled).toBe(false);
    expect(button(E['arcp.closeSignups']!)!.disabled).toBe(false);
  });

  it('the dates: from today, sign-ups closing within 400 days (C8)', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: null } };
    panel();
    await settle();
    const launch = input(E['arcp.launch']!);
    const closes = input(E['arcp.closes']!);
    expect(launch.getAttribute('min')).toBe(inDays(0));
    expect(closes.getAttribute('min')).toBe(inDays(0));
    // the end of the chosen day must be within the server's 400 days, so the last day is today + 399
    expect(closes.getAttribute('max')).toBe(inDays(399));
    fireEvent.change(launch, { target: { value: inDays(-1) } });
    expect(button('Start the ARC')!.disabled).toBe(true);
    expect(text()).toContain(E['arcp.datesBad']);
    fireEvent.change(launch, { target: { value: inDays(10) } });
    fireEvent.change(closes, { target: { value: inDays(400) } });
    expect(button('Start the ARC')!.disabled).toBe(true);
    fireEvent.change(closes, { target: { value: inDays(399) } });
    expect(button('Start the ARC')!.disabled).toBe(false);
    expect(text()).not.toContain(E['arcp.datesBad']);
  });

  it('a mail reason the panel does not know is shown as the server sent it', async () => {
    routes[GET] = { status: 200, body: { mail: { configured: false, reason: 'SOMETHING_NEW is odd' }, campaign: null } };
    panel();
    await settle();
    expect(text()).toContain(E['arcp.mailOff']!.replace('{reason}', 'SOMETHING_NEW is odd'));
  });

  it('the network gone: said plainly, nothing pretended', async () => {
    setArcFetch((async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    panel();
    await settle();
    expect(text()).toContain(E['arcp.offline']);
    expect(button('Start the ARC')).toBeNull();
  });
});

describe('the section in the export screen', () => {
  const section = () =>
    render(
      <LocaleProvider initial="en">
        <DialogStackProvider>
          <div id="arcSec">
            <ArcSection />
          </div>
        </DialogStackProvider>
      </LocaleProvider>,
    );

  it('shows nothing unless signed in and the book is on the shelf', async () => {
    section();
    await settle();
    expect(document.getElementById('arcSec')!.textContent).toBe('');
    cleanup();
    cloudFacts.available = true;
    cloudFacts.user = { id: 'u1' };
    section();
    await settle();
    expect(document.getElementById('arcSec')!.textContent).toBe('');
    expect(calls).toEqual([]);
  });

  it('signed in, on the shelf: the heading, its line and "Run an ARC"; "Open your ARC" while one runs; the button opens the panel', async () => {
    cloudFacts.available = true;
    cloudFacts.user = { id: 'u1' };
    cloudFacts.linkedId = 'm1';
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: null } };
    section();
    await settle();
    const sec = document.getElementById('arcSec')!;
    expect(sec.querySelector('h3')!.textContent).toBe(E['arcp.secH']);
    expect(sec.textContent).toContain(E['arcp.secSub']);
    expect(within(sec).getByRole('button').textContent).toBe(E['arcp.run']);
    cleanup();
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign() } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [] } };
    section();
    await settle();
    const b = within(document.getElementById('arcSec')!).getByRole('button');
    expect(b.textContent).toBe(E['arcp.open']);
    fireEvent.click(b);
    await settle();
    expect(document.getElementById('arcpTitle')!.textContent).toBe(E['arcp.title']!.replace('{title}', 'The Salt Road'));
  });
});

describe('its words in every language', () => {
  const dir = path.resolve(__dirname, '../src/generated/packs');
  const pack = (c: string) => JSON.parse(readFileSync(path.join(dir, c + '.json'), 'utf8')) as Record<string, string>;
  const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).slice().sort().join(' ');
  const KEYS = Object.keys(E).filter((k) => k.startsWith('arcp.'));

  it('73 arcp.* keys in each of the 15 packs, with English\'s placeholders, none empty, none still English, none says "exchange"', () => {
    // 59 (Task 8) + 15 new − arcp.linkHidden (final fix wave)
    expect(KEYS.length).toBe(73);
    expect(KEYS).not.toContain('arcp.linkHidden');
    expect(meta.order.length).toBe(15);
    for (const code of meta.order) {
      const p = pack(code);
      for (const k of KEYS) {
        expect(typeof p[k] === 'string' && p[k]!.trim() !== '', `${code} ${k}`).toBe(true);
        expect(holes(p[k]!), `${code} ${k}`).toBe(holes(E[k]!));
        expect(p[k], `${code} ${k}`).not.toMatch(/exchange/i);
        if (code !== 'en') expect(p[k], `${code} ${k} is still English`).not.toBe(E[k]);
      }
    }
    // Marathi without nukta (the packs' rule)
    for (const k of KEYS) expect(pack('mr')[k], k).not.toMatch(/[\u093c\u0958-\u095f]/);
  });

  it('the English the plan fixes, word for word', () => {
    expect(E['arcp.stamp']).toBe('Each copy names its reader. That deters sharing; it cannot stop a determined pirate.');
    expect(E['arcp.noReview']).toBe("Copies are free. Readers are never asked for a review; if they'd like to review it, that's their choice.");
    expect(E['arcp.deleteConfirm']).toBe("Delete this ARC? Its readers' links stop working, and their names and email addresses are removed from Beuk. Copies already inside backups stay until those backups are deleted.");
  });

  it('docs/strings-pending-signoff.md lists every arcp.* key as a draft', () => {
    const doc = readFileSync(path.resolve(__dirname, '../../docs/strings-pending-signoff.md'), 'utf8');
    for (const k of KEYS) expect(doc, k).toContain('### `' + k + '`');
    expect(doc).toMatch(/## 8\. The ARC panel/);
  });
});
