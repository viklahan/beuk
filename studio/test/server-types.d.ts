/* test/closure.test.ts imports the server's EPUB closure lists (src/book/epub/closure.ts). That file's type-only import
   of the worker pulls src/book/epub/sandbox.ts into `tsc`, and sandbox.ts imports @xmldom/xmldom, which only the server
   installs. Nothing in the studio runs it: a bare declaration lets the type check through. */
declare module '@xmldom/xmldom';
