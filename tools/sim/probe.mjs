// Dev probe: import one prepared volume through single-file Import and show what the studio made of it.
import { launch, device, studio, log } from './driver.mjs';
import { readFileSync } from 'node:fs';
const ebook = process.env.SIM_PROBE || '1257';
const browser = await launch();
const ctx = await device(browser, 'probe');
const page = await studio(ctx, []);
const r = await page.evaluate(([p, n]) => __sim.importSingle(p, n), [`/sagas/_prepared/pg${ebook}.md`, `probe-${ebook}.md`]);
log('import ms', Math.round(r.ms), JSON.stringify(r.found), JSON.stringify(r.metaAfterImport));
const info = await page.evaluate(() => {
  const secs = state.sections.map((s) => ({ k: s.kind, t: s.type, title: s.title, n: s.number, len: (s.content || '').length, head: (s.content || '').slice(0, 160) }));
  const doc = serializeBook();
  const sizes = {}; for (const k of Object.keys(doc)) { try { sizes[k] = JSON.stringify(doc[k]).length; } catch (e) { sizes[k] = 'ERR ' + e.message; } }
  return { n: secs.length, first: secs.slice(0, 6), last: secs.slice(-3), sizes, hist: (state.history || []).length };
});
console.log(JSON.stringify(info, null, 1));
const imgs = JSON.parse(readFileSync(`/sagas/_prepared/pg${ebook}.images.json`, 'utf8'));
if (imgs.length) {
  const a = await page.evaluate((list) => __sim.addImages(list), imgs.map((im) => ({ ...im, path: `/sagas/_sources/pg${ebook}/${im.src}` })));
  log('images', JSON.stringify(a));
  const s2 = await page.evaluate(() => { const doc = serializeBook(); const sizes = {}; for (const k of Object.keys(doc)) { try { sizes[k] = JSON.stringify(doc[k]).length; } catch (e) { sizes[k] = 'ERR ' + e.message; } } return { sizes, hist: (state.history || []).length, histSizes: (state.history || []).map((h) => { try { return JSON.stringify(h).length; } catch (e) { return 'ERR'; } }) }; });
  console.log(JSON.stringify(s2));
}
await browser.close();
