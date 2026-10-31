/* BEUK:epub-server — server EPUB builds take turns. At most
   `maxConcurrent` run (EPUB_MAX_CONCURRENT, default 1), at most
   `maxQueued` wait (EPUB_MAX_QUEUED, default 4; more is "busy, try again"),
   and one writer has at most one build running or waiting. A waiter whose
   request went away is taken out of the line. */

export class EpubBusyError extends Error {
  constructor(readonly reason: 'queue-full' | 'user-busy' | 'aborted') {
    super(reason === 'queue-full' ? 'the server is busy building other EPUBs'
      : reason === 'user-busy' ? 'an EPUB of yours is already being built'
      : 'the request went away while it waited');
  }
}

type Waiter = { start: () => void; fail: (e: Error) => void };

export class EpubQueue {
  private running = 0;
  private readonly waiting: Waiter[] = [];
  private readonly users = new Set<string>();

  constructor(readonly maxConcurrent: number, readonly maxQueued: number) {}

  stats(): { running: number; waiting: number } {
    return { running: this.running, waiting: this.waiting.length };
  }

  async run<T>(userId: string, signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
    if (this.users.has(userId)) throw new EpubBusyError('user-busy');
    if (signal?.aborted) throw new EpubBusyError('aborted');
    if (this.running >= this.maxConcurrent && this.waiting.length >= this.maxQueued) throw new EpubBusyError('queue-full');
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
              reject(new EpubBusyError('aborted'));
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
