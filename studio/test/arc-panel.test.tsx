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
    expect(text()).toContain('ARC_MAIL_FROM is not set');
    expect(text()).toContain(E['arcp.mailOff']!.split(' ({reason})')[0]);
    expect(button('Start the ARC')).toBeNull();
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it('starts a campaign with exactly the chosen settings', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: null } };
    routes['POST /api/arc'] = { status: 201, body: { campaign: campaign({ counts: { claimed: 0, pending: 0, declined: 0, revoked: 0 } }), signupToken: 'tok', signupUrl: 'https://beuk.example/arc/tok' } };
    panel();
    await settle();
    fireEvent.change(input(E['arcp.launch']!), { target: { value: '2027-02-14' } });
    fireEvent.click(button('Start the ARC')!);
    await settle();
    const post = calls.filter((c) => c.method === 'POST' && c.path === '/api/arc');
    expect(post.length).toBe(1);
    expect(post[0]!.body).toEqual({
      manuscriptId: 'm1', launchDate: '2027-02-14', closesAt: endOfLocalDay('2027-02-14'), tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      maxClaims: 50, approvalMode: 'instant', lang: 'en',
    });
  });

  it('shows the signup link once, with Copy', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: null } };
    routes['POST /api/arc'] = { status: 201, body: { campaign: campaign({ counts: { claimed: 0, pending: 0, declined: 0, revoked: 0 } }), signupToken: 'tok', signupUrl: 'https://beuk.example/arc/tok' } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [] } };
    const p = panel();
    await settle();
    fireEvent.change(input(E['arcp.launch']!), { target: { value: '2027-02-14' } });
    fireEvent.click(button('Start the ARC')!);
    await settle();
    const url = document.querySelector<HTMLInputElement>('input[readonly]');
    expect(url?.value).toBe('https://beuk.example/arc/tok');
    expect(button(E['arcp.copy']!)).not.toBeNull();
    expect(text()).not.toContain(E['arcp.linkHidden']);
    // reopening: the campaign is read back from the server, which never returns the link again
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign() } };
    await p.reopen();
    expect(text()).toContain(E['arcp.linkHidden']);
    expect(document.body.innerHTML).not.toContain('beuk.example/arc/tok');
    expect(button(E['arcp.copy']!)).toBeNull();
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
    fireEvent.change(input(E['arcp.launch']!), { target: { value: '2027-02-14' } });
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
    fireEvent.change(input(E['arcp.launch']!), { target: { value: '2027-02-14' } });
    expect(input(E['arcp.closes']!).value).toBe('2027-02-14');
    fireEvent.change(input(E['arcp.closes']!), { target: { value: '2027-02-01' } });
    fireEvent.change(input(E['arcp.launch']!), { target: { value: '2027-03-01' } });
    expect(input(E['arcp.closes']!).value).toBe('2027-02-01');
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="number"]')!, { target: { value: '12' } });
    fireEvent.click(input(E['arcp.approval']!));
    expect(text()).toContain(E['arcp.approvalHint']);
    fireEvent.click(button('Start the ARC')!);
    await settle();
    const body = calls.find((c) => c.method === 'POST')!.body!;
    expect(body).toMatchObject({ launchDate: '2027-03-01', closesAt: endOfLocalDay('2027-02-01'), maxClaims: 12, approvalMode: 'approval' });
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
    fireEvent.change(input(E['arcp.launch']!), { target: { value: '2027-02-14' } });
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
    fireEvent.change(input(E['arcp.launch']!), { target: { value: '2027-02-14' } });
    fireEvent.click(button('Start the ARC')!);
    await settle();
    expect(text()).toContain('ARC_SMTP_URL is not set');
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
    expect(row('r1').textContent).toContain(E['arcp.notSent']!.replace('{detail}', 'over the hourly limit'));
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
    expect(confirmBody()).toBe(E['arcp.revokeConfirm']);
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

  it('a new signup link is shown once it is made', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign() } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [] } };
    routes['POST /api/arc/c1/signup-link'] = { status: 200, body: { signupToken: 'new', signupUrl: 'https://beuk.example/arc/new' } };
    panel();
    await settle();
    expect(text()).toContain(E['arcp.linkHidden']);
    fireEvent.click(button(E['arcp.newLink']!)!);
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

  it('an ended campaign (F10): summarised, its waiting readers can be declined, and the start form is offered', async () => {
    routes[GET] = { status: 200, body: { mail: MAIL_ON, campaign: campaign({ state: 'ended', endedAt: '2027-02-10T09:00:00.000Z', approvalMode: 'approval', counts: { claimed: 7, pending: 1, declined: 0, revoked: 0 } }) } };
    routes['GET /api/arc/c1/readers'] = { status: 200, body: { readers: [reader(), reader({ id: 'r2', status: 'claimed' })] } };
    routes['POST /api/arc/c1/readers/r1/decline'] = { status: 200, body: { reader: reader({ status: 'declined' }), mail: { sent: true } } };
    panel();
    await settle();
    const day = new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(new Date('2027-02-10T09:00:00.000Z'));
    expect(text()).toContain(E['arcp.endedSum']!.replace('{date}', day).replace('{n}', '7').replace('{max}', '50'));
    expect(text()).toContain(E['arcp.endedWaiting']);
    // only the waiting reader, with Decline and no Approve
    expect(document.querySelector('[data-reader="r2"]')).toBeNull();
    expect(rowButton('r1', E['arcp.approve']!)).toBeNull();
    expect(button(E['arcp.closeSignups']!)).toBeNull();
    expect(button('Start the ARC')).not.toBeNull();
    fireEvent.click(rowButton('r1', E['arcp.decline']!)!);
    await settle();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/api/arc/c1/readers/r1/decline']);
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

  it('59 arcp.* keys in each of the 15 packs, with English\'s placeholders, none empty, none still English, none says "exchange"', () => {
    expect(KEYS.length).toBe(59);
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
    for (const k of KEYS) expect(pack('mr')[k], k).not.toContain('़');
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
