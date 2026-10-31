/* BEUK:epub-server BEUK:wrap-server — server builds take turns. One
   BuildQueue per kind of build, each with its own limits: at most
   `maxConcurrent` run, at most `maxQueued` wait (more is "busy, try
   again"), and one writer has at most one build of that kind running or
   waiting. A waiter whose request went away is taken out of the line.
   - EPUB: EPUB_MAX_CONCURRENT (default 1), EPUB_MAX_QUEUED (default 4).
   - Cover wrap: WRAP_MAX_CONCURRENT (default 1), WRAP_MAX_QUEUED
     (default 4). A 300-DPI jacket is about 80 MB of pixels, so one at a time.
   The words for writers live in each route; these messages are for logs. */

export class BuildBusyError extends Error {
  constructor(readonly reason: 'queue-full' | 'user-busy' | 'aborted') {
    super(reason === 'queue-full' ? 'the server is busy with other builds'
      : reason === 'user-busy' ? 'a build of yours is already running or waiting'
      : 'the request went away while it waited');
  }
}

type Waiter = { start: () => void; fail: (e: Error) => void };

export class BuildQueue {
  private running = 0;
  private readonly waiting: Waiter[] = [];
  private readonly users = new Set<string>();

  constructor(readonly maxConcurrent: number, readonly maxQueued: number) {}

  stats(): { running: number; waiting: number } {
    return { running: this.running, waiting: this.waiting.length };
  }

  async run<T>(userId: string, signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
    if (this.users.has(userId)) throw new BuildBusyError('user-busy');
    if (signal?.aborted) throw new BuildBusyError('aborted');
    if (this.running >= this.maxConcurrent && this.waiting.length >= this.maxQueued) throw new BuildBusyError('queue-full');
    this.users.add(userId);
    try {
      if (this.running < this.maxConcurrent) this.running++;
      else {
        /* next() hands its slot over (running stays counted), so nobody can slip in between */
        await new Promise<void>((resolve, reject) => {
          const w: Waiter = { start: resolve, fail: reject };
          this.waiting.push(w);
          signal?.addEventListener('abort', () => {
            const i = this.waiting.indexOf(w);
            if (i >= 0) {
              this.waiting.splice(i, 1);
              reject(new BuildBusyError('aborted'));
            }
          }, { once: true });
        });
      }
      try {
        return await fn();
      } finally {
        const next = this.waiting.shift();
        if (next) next.start();
        else this.running--;
      }
    } finally {
      this.users.delete(userId);
    }
  }
}
