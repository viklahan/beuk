/* BEUK:epub-server — server EPUB builds take turns. The queue itself is
   the generic BuildQueue (src/book/studio/queue.ts), shared with the
   cover wrap; these are its part 3 names, kept so EPUB code and tests
   read as they did. The EPUB instance: EPUB_MAX_CONCURRENT (default 1),
   EPUB_MAX_QUEUED (default 4). */

export { BuildBusyError as EpubBusyError, BuildQueue as EpubQueue } from '../studio/queue.js';
