/* Imported FIRST by main.tsx, before anything that builds a zod schema
   (src/book/schema.ts, through readBook). zod 4 compiles fast object parsers
   with `new Function` unless told not to, and probes for it at schema
   creation: under 1.0's CSP (script-src without 'unsafe-eval') that probe
   is a securitypolicyviolation on every page load. jitless keeps zod on its
   plain (eval-free) parser; the results are the same. */
import { config } from 'zod';

config({ jitless: true });
