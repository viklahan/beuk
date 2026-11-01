/* BEUK:webword — Word documents and saved web pages, read off the page's
   main thread. Both arrive as base64 (the form the book keeps them in) and
   are untrusted: a renamed file, a damaged zip, a zip bomb, a page in any
   character set. Everything heavy happens here, where the studio can stop
   it (it terminates this worker after its time limit) without the tab
   freezing. The page sanitises what comes back before showing any of it:
   nothing from here is ever inserted as it is.

   Jobs ({ id, op, data }):
     check-word  -> { ok, reason?, title? }   a real .docx: a zip holding word/document.xml
     view-word   -> { ok, html, messages }    mammoth's HTML (unsanitised)
     check-web   -> { ok, reason?, kind }     an HTML page or an MHTML archive with an HTML part
     view-web    -> { ok, html, images, url } the page's HTML, its saved pictures as data: URLs by
                                              Content-Location and cid:, and the address it came from */
"use strict";
const LIM = {
  unzipped: 200 * 1024 * 1024, /* what a .docx may say it unpacks to */
  ratio: 200,                  /* unpacked against packed, for any one part over 1 MB */
  html: 8 * 1024 * 1024,       /* characters of HTML handed back */
  images: 20 * 1024 * 1024     /* bytes of saved pictures handed back with a page */
};
let libs = false;
function loadLibs() {
  if (libs) return;
  importScripts("vendor/jszip.min.js", "vendor/mammoth.browser.min.js");
  libs = true;
}
function bytesOf(b64) {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function decode(bytes, label) {
  try { return new TextDecoder(label || "utf-8").decode(bytes); }
  catch (e) { return new TextDecoder("utf-8").decode(bytes); }
}

/* ---- Word ---- */
async function openDocx(u, limUnzipped) {
  if (u.length < 4 || u[0] !== 0x50 || u[1] !== 0x4b || u[2] !== 0x03 || u[3] !== 0x04) {
    if (u.length >= 8 && u[0] === 0xd0 && u[1] === 0xcf && u[2] === 0x11 && u[3] === 0xe0) throw new Error("old-doc");
    throw new Error("not-zip");
  }
  loadLibs();
  let zip;
  try { zip = await JSZip.loadAsync(u, { checkCRC32: false }); } catch (e) { throw new Error("not-zip"); }
  if (!zip.file("word/document.xml")) throw new Error("no-document");
  let total = 0;
  zip.forEach((path, f) => {
    const d = f._data || {};
    const un = Number(d.uncompressedSize) || 0, packed = Number(d.compressedSize) || 0;
    total += un;
    if (un > 1024 * 1024 && packed > 0 && un / packed > LIM.ratio) throw new Error("bomb");
  });
  if (total > Math.min(LIM.unzipped, limUnzipped || Infinity)) throw new Error("bomb"); /* a job may tighten the limit (the self-check does), never loosen it */
  return zip;
}
async function docxTitle(zip) {
  const core = zip.file("docProps/core.xml");
  if (!core) return "";
  const xml = await core.async("string");
  const m = /<dc:title>([\s\S]{0,400}?)<\/dc:title>/.exec(xml);
  return m ? m[1].replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim() : "";
}

/* ---- what a Word file holds, counted, so the studio can say what its view leaves out ----
   Words are counted the same way on both sides (WORD_RE, also in the studio's rsWords).
   A paragraph's runs are joined (Word splits words across runs); a text box's own paragraphs
   are counted as theirs, never glued to the paragraph that holds the box; the VML copy of a
   text box (mc:Fallback) is skipped so it is not counted twice; field codes (w:instrText) are
   not words on the page. Deleted text (tracked changes) is counted apart. */
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;
const CHAR_RE = /[\p{L}\p{N}]/gu; /* letters and numbers: what a view may not add or lose (spacing may change, these may not) */
function wordsIn(s) { return (String(s).normalize("NFC").match(WORD_RE) || []).length; }
function charsIn(s) { return (String(s).normalize("NFC").match(CHAR_RE) || []).length; }
function xmlText(s) { return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&"); }
function wordStats(xml) {
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:delText(?:\s[^>]*)?>([^<]*)<\/w:delText>|<(\/?)w:p(?=[\s>/])[^>]*?(\/?)>|<(\/?)mc:Fallback(?=[\s>/])[^>]*?(\/?)>|<\/mc:AlternateContent\s*>()|<w:(footnoteReference|endnoteReference)(?=[\s/>])/g;
  const stack = [];
  let words = 0, chars = 0, deleted = 0, refs = 0, fallback = 0, del = "", m;
  const flush = (s) => { words += wordsIn(s); chars += charsIn(s); };
  while ((m = re.exec(xml))) {
    if (m[5] !== undefined) { if (!m[6]) fallback = Math.max(0, fallback + (m[5] ? -1 : 1)); continue; } /* <mc:Fallback/> (Word writes it so) holds nothing */
    if (m[7] !== undefined) { fallback = 0; continue; } /* the end of the alternatives: a fallback left open can never hide the rest of the document */
    if (fallback > 0) continue;
    if (m[1] !== undefined) { if (stack.length) stack[stack.length - 1] += xmlText(m[1]); else flush(xmlText(m[1])); }
    else if (m[2] !== undefined) del += xmlText(m[2]);
    else if (m[8]) refs++;
    else if (m[3] !== undefined) {
      if (m[4]) continue; /* <w:p/> */
      if (m[3]) { flush(stack.pop() || ""); del += " "; } else stack.push("");
    }
  }
  while (stack.length) flush(stack.pop());
  deleted = wordsIn(del);
  return { words: words, chars: chars, deleted: deleted, refs: refs };
}
/* Text boxes Word writes as DrawingML (mc:Choice holding w:txbxContent) with an empty mc:Fallback:
   mammoth reads only the fallback, so their words would vanish (Steady Ground: the "urselves" of a
   drop-capped "Ourselves", 14 letters, seen by the letter count). Their words are written in where
   the box sits, as plain text, in the copy handed to mammoth; the file itself is never changed. */
function inlineTextBoxes(xml) {
  let changed = false;
  const out = xml.replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent\s*>/g, (block, at) => {
    const fb = /<mc:Fallback\b[\s\S]*?(?:\/>|<\/mc:Fallback\s*>)/.exec(block);
    if (fb && /<w:t[\s>]/.test(fb[0])) return block; /* mammoth reads the fallback, which holds the words */
    const boxes = block.match(/<w:txbxContent\b[\s\S]*?<\/w:txbxContent\s*>/g);
    if (!boxes) return block;
    const text = boxes.map((b) => (b.match(/<w:p\b[\s\S]*?<\/w:p\s*>/g) || []).map((p) => (p.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("")).join(" ")).join(" ").trim();
    if (!text) return block;
    changed = true;
    const inRun = xml.lastIndexOf("<w:r>", at) > xml.lastIndexOf("</w:r>", at) || xml.lastIndexOf("<w:r ", at) > xml.lastIndexOf("</w:r>", at);
    const t = '<w:t xml:space="preserve">' + text + "</w:t>"; /* still XML-escaped as Word wrote it */
    return inRun ? t : "<w:r>" + t + "</w:r>";
  });
  return changed ? out : null;
}
async function docxStats(zip) {
  const read = async (path) => { const f = zip.file(path); return f ? await f.async("string") : ""; };
  const body = wordStats(await read("word/document.xml"));
  const fn = wordStats(await read("word/footnotes.xml")), en = wordStats(await read("word/endnotes.xml"));
  let headers = 0;
  for (const path of Object.keys(zip.files)) if (/^word\/(header|footer)\d*\.xml$/.test(path)) headers += wordStats(await read(path)).words;
  const comments = wordStats(await read("word/comments.xml")).words;
  /* footnotes.xml carries Word's separator notes (no words); a reference number shown in the text and in the list is Word's own */
  return { chars: body.chars + fn.chars + en.chars, words: body.words + fn.words + en.words, refs: body.refs + fn.refs + en.refs, headers: headers, comments: comments, deleted: body.deleted };
}

/* ---- web pages ---- */
function sniffCharset(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const m = /<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9._:-]{1,40})/i.exec(head);
  return m ? m[1].toLowerCase() : "utf-8";
}
function looksBinary(text) {
  const n = Math.min(text.length, 65536);
  let bad = 0;
  for (let i = 0; i < n; i++) { const c = text.charCodeAt(i); if (c === 0 || (c < 9) || c === 0xfffd) bad++; }
  return n > 0 && bad / n > 0.02;
}
function savedFrom(html) {
  const m = /<!--\s*saved from url=\(\d+\)\s*(\S+?)\s*-->/i.exec(html.slice(0, 4096));
  if (m) return m[1];
  const c = /<link[^>]+rel=["']?canonical["']?[^>]*href=["']([^"']{1,2000})["']/i.exec(html) || /<link[^>]+href=["']([^"']{1,2000})["'][^>]*rel=["']?canonical/i.exec(html);
  if (c) return c[1];
  const o = /<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']{1,2000})["']/i.exec(html);
  return o ? o[1] : "";
}
/* MIME headers of one part: lower-cased names, folded lines joined */
function headers(text) {
  const out = {};
  text.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).forEach((line) => {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  });
  return out;
}
function param(value, name) {
  const m = new RegExp(";\\s*" + name + "\\s*=\\s*(\"([^\"]*)\"|[^;\\s]+)", "i").exec(value || "");
  return m ? (m[2] !== undefined ? m[2] : m[1]) : "";
}
function qpBytes(s) {
  const t = s.replace(/=\r?\n/g, ""), out = new Uint8Array(t.length);
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 61 && /^[0-9A-Fa-f]{2}$/.test(t.substr(i + 1, 2))) { out[n++] = parseInt(t.substr(i + 1, 2), 16); i += 2; }
    else out[n++] = c & 255;
  }
  return out.subarray(0, n);
}
function partBytes(body, enc) {
  enc = (enc || "").toLowerCase();
  if (enc === "base64") {
    const clean = body.replace(/[^A-Za-z0-9+/=]/g, "");
    try { return bytesOf(clean.slice(0, clean.length - clean.length % 4)); } catch (e) { return null; }
  }
  if (enc === "quoted-printable") return qpBytes(body);
  const u = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) u[i] = body.charCodeAt(i) & 255;
  return u;
}
function b64(u) {
  let s = "";
  for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
  return btoa(s);
}
const PIC = /^image\/(png|jpeg|gif|webp)$/;
/* an MHTML archive (Chrome and Edge: "Webpage, Single File"), or null when the bytes are not one */
function readMhtml(raw) {
  const split = raw.search(/\r?\n\r?\n/);
  if (split < 0) return null;
  const top = headers(raw.slice(0, split));
  if (!/^multipart\/related/i.test(top["content-type"] || "")) return null;
  const boundary = param(top["content-type"], "boundary");
  if (!boundary) return { error: "no-boundary" };
  const pieces = raw.slice(split).split("--" + boundary);
  let html = null, used = 0;
  const images = {};
  for (const piece of pieces.slice(1)) {
    if (/^--/.test(piece)) break;
    const p = piece.replace(/^\r?\n/, "");
    const cut = p.search(/\r?\n\r?\n/);
    if (cut < 0) continue;
    const h = headers(p.slice(0, cut));
    const body = p.slice(cut).replace(/^\r?\n\r?\n/, "").replace(/\r?\n$/, "");
    const type = (h["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (type === "text/html" && html === null) {
      const u = partBytes(body, h["content-transfer-encoding"]);
      if (u) html = decode(u, param(h["content-type"], "charset") || sniffCharset(u));
    } else if (PIC.test(type) && used < LIM.images) {
      const u = partBytes(body, h["content-transfer-encoding"]);
      if (!u || !u.length || used + u.length > LIM.images) continue;
      used += u.length;
      const url = "data:" + type + ";base64," + b64(u);
      if (h["content-location"]) images[h["content-location"]] = url;
      if (h["content-id"]) images["cid:" + h["content-id"].replace(/^<|>$/g, "")] = url;
    }
  }
  if (html === null) return { error: "no-html" };
  return { html: html, images: images, url: top["snapshot-content-location"] || "" };
}
function readWeb(b64data) {
  const u = bytesOf(b64data);
  const latin = new TextDecoder("latin1").decode(u.subarray(0, Math.min(u.length, 64 * 1024 * 1024)));
  const m = readMhtml(latin);
  if (m && m.error) throw new Error(m.error);
  if (m) return Object.assign({ kind: "mhtml" }, m);
  if (/^\s*bplist00/.test(latin.slice(0, 16))) throw new Error("webarchive");
  const html = decode(u, sniffCharset(u));
  if (looksBinary(html)) throw new Error("binary");
  if (!/<(html|body|head|p|div|h[1-6]|title|article|span|a|br|table|ul|ol)[\s>/]/i.test(html.slice(0, 200000))) throw new Error("not-html");
  return { kind: "html", html: html, images: {}, url: savedFrom(html) };
}

self.onmessage = async (ev) => {
  const job = ev.data || {};
  const reply = (o) => self.postMessage(Object.assign({ id: job.id }, o));
  try {
    if (typeof job.data !== "string" || !job.data) throw new Error("empty");
    if (job.op === "check-word") {
      const zip = await openDocx(bytesOf(job.data), Number(job.limUnzipped) || 0);
      reply({ ok: true, title: await docxTitle(zip) });
    } else if (job.op === "view-word") {
      const u = bytesOf(job.data);
      const zip = await openDocx(u);
      const stats = await docxStats(zip);
      let buf = u.buffer;
      const inlined = inlineTextBoxes(await zip.file("word/document.xml").async("string"));
      if (inlined) { zip.file("word/document.xml", inlined); buf = await zip.generateAsync({ type: "arraybuffer" }); }
      const r = await mammoth.convertToHtml({ arrayBuffer: buf });
      const html = String(r.value || "");
      reply({ ok: true, html: html.slice(0, LIM.html), cut: html.length > LIM.html, messages: (r.messages || []).length, stats: stats });
    } else if (job.op === "check-web") {
      const w = readWeb(job.data);
      reply({ ok: true, kind: w.kind, url: w.url, title: (/<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(w.html) || [])[1] || "" });
    } else if (job.op === "view-web") {
      const w = readWeb(job.data);
      reply({ ok: true, kind: w.kind, html: w.html.slice(0, LIM.html), cut: w.html.length > LIM.html, images: w.images, url: w.url });
    } else throw new Error("unknown-op");
  } catch (e) {
    reply({ ok: false, reason: String((e && e.message) || e).slice(0, 80) });
  }
};
