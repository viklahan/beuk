/* The book-format contract (src/book, step 1) reached through the
   @book alias: one source, not a copy. Part A only proves the alias
   resolves and type-checks; part C opens books with it. */
import { readBook } from '@book/read.js';

export { readBook };
