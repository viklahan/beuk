import type { Server } from 'node:http';

/**
 * Keep-alive timing for the one hop in front of the app (Caddy).
 *
 * Caddy's reverse_proxy keeps idle connections to the app open for 2
 * minutes (its HTTP transport's `keepalive` default) and reuses them.
 * Node closes an idle keep-alive socket after only 5 seconds
 * (server.keepAliveTimeout default). So a request that Caddy writes onto
 * a pooled connection at the moment Node closes it is lost: Caddy logs
 * "read: connection reset by peer" and answers 502, and a POST is not
 * retried. Seen as a sign-in with the right password refused on a second
 * device a few seconds after the first one signed in (simulation run 1),
 * and reproduced on demand with parallel sign-ins after a ~5 s idle.
 *
 * The rule (as for any proxy pool): the upstream must keep idle
 * connections open LONGER than the proxy does, so the proxy is always
 * the side that closes. headersTimeout stays above keepAliveTimeout so a
 * slow request head on a reused socket is never cut by the wrong timer.
 */
export const PROXY_IDLE_MS = 120_000;
export const APP_KEEP_ALIVE_MS = PROXY_IDLE_MS + 5_000;
export const APP_HEADERS_TIMEOUT_MS = APP_KEEP_ALIVE_MS + 1_000;

export function applyUpstreamKeepAlive(server: Server): Server {
  server.keepAliveTimeout = APP_KEEP_ALIVE_MS;
  server.headersTimeout = APP_HEADERS_TIMEOUT_MS;
  return server;
}
