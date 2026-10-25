import type { Server } from 'node:http';

/**
 * Graceful shutdown for SIGTERM (docker compose stop / deploy) and
 * SIGINT (Ctrl-C):
 *   1. stop accepting connections — server.close() refuses new ones,
 *      drops idle keep-alives and waits for in-flight requests
 *      (https://nodejs.org/api/http.html#serverclosecallback);
 *   2. let the running job finish within the grace period, or mark it
 *      failed honestly (JobRunner.shutdown);
 *   3. stop periodic timers, close the Postgres pool, exit 0.
 * In-flight requests still open when the grace period ends are cut
 * (closeAllConnections) and the process exits 1, so the orchestrator
 * sees an unclean stop rather than a silent hang.
 */
export interface ShutdownDeps {
  server: Server;
  graceMs: number;
  runner?: { shutdown: (graceMs: number) => Promise<{ finished: boolean; failedJobId: string | null }> };
  closeDb: () => Promise<void>;
  timers?: NodeJS.Timeout[];
  log?: (msg: string) => void;
  exit?: (code: number) => void;
}

export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<number> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  let started: Promise<number> | null = null;

  return (signal: string) => {
    if (started) return started; // a second signal never restarts the sequence
    started = (async () => {
      const deadline = Date.now() + deps.graceMs;
      log(`${signal}: shutting down — no new connections; finishing in-flight work (grace ${deps.graceMs} ms)`);
      for (const t of deps.timers ?? []) clearInterval(t);

      let timer: NodeJS.Timeout | undefined;
      const serverClosed = new Promise<boolean>((resolve) => deps.server.close(() => resolve(true)));
      const jobs = deps.runner
        ? deps.runner.shutdown(deps.graceMs)
        : Promise.resolve({ finished: true, failedJobId: null });

      const requestsDone = await Promise.race([
        serverClosed,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
        }),
      ]);
      clearTimeout(timer);
      if (!requestsDone) {
        log('grace period over: closing connections that are still open');
        deps.server.closeAllConnections();
      }
      const jobOutcome = await jobs;
      if (jobOutcome.failedJobId) {
        log(`job ${jobOutcome.failedJobId} did not finish in time and was marked failed`);
      }
      try {
        await deps.closeDb();
      } catch (err) {
        log(`closing the database pool failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      const code = requestsDone ? 0 : 1;
      log(`shutdown complete (exit ${code})`);
      exit(code);
      return code;
    })();
    return started;
  };
}
