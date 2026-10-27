# PDF.js 6.4.299 (vendored for PDF import)

Mozilla's PDF.js, the **legacy** build (polyfilled for older browsers) of
`pdfjs-dist@6.4.299` (published 2026-10-03), Apache License 2.0 — the full
licence text is `LICENSE` beside this file.

| File | From the package | sha256 (base64) |
|---|---|---|
| `pdf.min.mjs` | `legacy/build/pdf.min.mjs` | `vMwk6nEduORFA2KVGZBKUpLXO52qohS7583MKCsPQlk=` |
| `pdf.worker.min.mjs` | `legacy/build/pdf.worker.min.mjs` | `FF0t06sMhhUQEdupWs+i1TNuKszVk4jqQ9vuDv3arsY=` |

Byte-identical to the release: the tarball matched the npm registry's
`dist.integrity` (`sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==`),
and both files match jsDelivr's file hashes
(https://data.jsdelivr.com/v1/packages/npm/pdfjs-dist@6.4.299?structure=flat).

How the studio loads them (BEUK:pdfimport in `index.html`):

- Only when a writer chooses a `.pdf` to import — never on page load.
- As two `<script type="module">` elements carrying Subresource Integrity
  (`sha384-…`, pinned in `index.html`), the worker first. Each build sets a
  global on load (`globalThis.pdfjsWorker`, `globalThis.pdfjsLib`).
- With `globalThis.pdfjsWorker` present PDF.js runs its parser on the main
  thread ("fake worker") instead of spawning `new Worker(url)`: no worker
  script is fetched outside SRI, and the CSP needs nothing beyond
  `script-src 'self'`. PDF.js 6 no longer probes `eval`/`new Function`.
- The folder name carries the version, so the service worker's cache-first
  rule can never serve an older copy after an upgrade.

Not vendored (not needed to read text): `cmaps/`, `standard_fonts/`,
`wasm/` (JPEG 2000 / JBIG2 decoders), `iccs/`, the viewer. A picture in a
format that needs one of those decoders is reported as left out.
