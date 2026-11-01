/* BEUK:localpics — the SHA-256 of a picture's bytes, worked out off the
   page's main thread. A picture arrives as base64 (the form the book
   holds it in); the answer is its hash, or "" when the base64 is not
   canonical (it would not read back identical, so the studio keeps it
   inline). With no crypto.subtle here (a studio opened over plain http
   on a LAN address has none) the answer is null and the page hashes it
   itself, as it always did. Measured: 25 MB of research files cost the
   page 863 ms of digest and 343 ms of decoding at 4x CPU slowdown when
   done on the main thread (beuk-spikes/research-cap/prof.mjs). */
self.onmessage = async (ev) => {
  const job = ev.data || {};
  let sha = null;
  try {
    if (self.crypto && crypto.subtle && typeof crypto.subtle.digest === "function" && typeof job.data === "string") {
      const bin = atob(job.data);
      if (btoa(bin) !== job.data) sha = "";
      else {
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((x) => x.toString(16).padStart(2, "0")).join("");
      }
    }
  } catch (e) { sha = typeof job.data === "string" ? "" : null; } /* atob refused it: not base64, so not canonical */
  self.postMessage({ id: job.id, sha: sha });
};
