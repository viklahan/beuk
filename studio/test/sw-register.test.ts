import { afterEach, describe, expect, it, vi } from 'vitest';

/* Final review C2 + I1: 2.0's worker is registered with scope /studio (the build's base minus its trailing slash),
   so it covers /studio (every 1.0 bookmark, link and installed shortcut) as well as /studio/. A scope wider than the
   script's folder needs the app's Service-Worker-Allowed: /studio header on /studio/sw.js (tests/studio.test.ts). */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('registerServiceWorker', () => {
  it('registers /studio/sw.js with scope /studio, derived from BASE_URL', async () => {
    // Vitest runs with base '/': the build's base (vite.config.ts STUDIO_BASE, pinned by tests/studio.test.ts) is stubbed
    vi.stubEnv('BASE_URL', '/studio/');
    vi.stubEnv('PROD', true);
    const register = vi.fn(() => Promise.resolve({ scope: 'http://localhost/studio' } as ServiceWorkerRegistration));
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });
    try {
      const { registerServiceWorker, swRegistration, SW_SCOPE } = await import('../src/sw-register');
      expect(SW_SCOPE).toBe('/studio');
      expect(document.readyState).toBe('complete');
      registerServiceWorker();
      expect(register).toHaveBeenCalledWith('/studio/sw.js', { scope: '/studio' });
      expect(await swRegistration()).toEqual({ scope: 'http://localhost/studio' });
    } finally {
      delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    }
  });
});
