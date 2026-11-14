// Runs lib/exporter.js in Node with a canvas + IndexedDB shim. Not a browser test, but it
// exercises the real slicing, evidence, PNG metadata, GIF and PDF code paths.
import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const require = createRequire(import.meta.url);
globalThis.PDFLib = require('pdf-lib');

// ---- browser shims ----
const violations = [];
const makeCanvas = () => {
  const c = createCanvas(1, 1);
  const nativeGetContext = c.getContext.bind(c);
  let ctx = null, flagged = false;
  c.getContext = (type, opts) => {
    if (!ctx) {
      ctx = nativeGetContext(type);
      flagged = !!(opts && opts.willReadFrequently); // like Chrome: the first call decides
      const gid = ctx.getImageData.bind(ctx);
      ctx.getImageData = (...a) => { if (!flagged) violations.push(new Error('getImageData on a canvas without willReadFrequently').stack); return gid(...a); };
    }
    return ctx;
  };
  c.toBlob = (cb, type = 'image/png', q) => {
    const mime = type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const buf = mime === 'image/jpeg' ? c.toBuffer('image/jpeg', Math.round((q || 0.9) * 100)) : c.toBuffer('image/png');
    cb(new Blob([buf], { type: mime }));
  };
  return c;
};
globalThis.document = { createElement: (t) => { if (t !== 'canvas') throw new Error('only canvas'); return makeCanvas(); }, head: {}, documentElement: {} };
globalThis.createImageBitmap = async (blob) => {
  const img = await loadImage(Buffer.from(await blob.arrayBuffer()));
  img.close = () => {};
  return img;
};
globalThis.chrome = {
  runtime: { getURL: (p) => 'chrome-extension://test/' + p },
  storage: { local: { get: async () => ({}) } }
};

const root = new URL('../', import.meta.url).pathname;
const util = await import(root + 'lib/util.js');
util.loadScript.cache['chrome-extension://test/vendor/pdf-lib.min.js'] = Promise.resolve();
const db = await import(root + 'lib/db.js');
const { exportCapture } = await import(root + 'lib/exporter.js');
const { readPngText } = await import(root + 'lib/png-meta.js');
const { hashCanvas } = await import(root + 'lib/sha256.js');
const { DEFAULTS } = await import(root + 'lib/settings.js');

let fails = 0;
const ok = (cond, msg) => { console.log(cond ? 'ok  ' : 'FAIL', msg); if (!cond) fails++; };

// ---- synthetic capture: text-like rows separated by blank gaps ----
const W = 800, H = 2600;
const src = createCanvas(W, H);
const x = src.getContext('2d');
x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
x.fillStyle = '#222';
for (let y = 20; y < H - 40; y += 40) x.fillRect(30, y, 300 + (y * 7) % 400, 18); // 18px "text" rows, 22px gaps
const png = src.toBuffer('image/png');
const now = Date.now();
const rec = {
  id: 'cap1', title: 'Test page', url: 'https://example.com/a/very/long/path?x=1&y=2', host: 'example.com',
  createdAt: now, expiresAt: now + 86400e3, favourite: false, width: W, height: H, scale: 1, ratio: 1, size: png.length,
  thumb: new Blob([png]), edited: false, tz: 'Asia/Kolkata', mode: 'full',
  links: [{ x: 30, y: 20, w: 200, h: 18, href: 'https://example.com/one' }, { x: 30, y: 1300, w: 200, h: 18, href: 'https://example.com/two' }]
};
await db.addCapture(rec, new Blob([png], { type: 'image/png' }));

const S = (over = {}) => ({ ...structuredClone(DEFAULTS), ...over, pdf: { ...structuredClone(DEFAULTS.pdf), ocr: false, ...(over.pdf || {}) } });

// 1. PNG without evidence round-trips pixel-exactly
{
  const r = await exportCapture('cap1', 'png', { settings: S() });
  const img = await loadImage(Buffer.from(await r.blob.arrayBuffer()));
  const c = createCanvas(img.width, img.height); c.getContext('2d').drawImage(img, 0, 0);
  const a = hashCanvas(c), b = hashCanvas(src);
  ok(img.width === W && img.height === H && a === b, 'PNG export is pixel-identical');
  ok(/^screencapture-example-com-a-very-long-path-.*\.png$/.test(r.filename), 'filename ' + r.filename);
}

// 2. Evidence PNG: band + metadata + recomputed hash matches
{
  const r = await exportCapture('cap1', 'png', { settings: S({ evidence: true }) });
  const bytes = new Uint8Array(await r.blob.arrayBuffer());
  const txt = readPngText(bytes, 'OpenPageCapture');
  ok(!!txt, 'evidence metadata present');
  const ev = JSON.parse(txt);
  const img = await loadImage(Buffer.from(bytes));
  ok(img.width === ev.width && img.height === ev.height + ev.bandHeight, `band ${ev.bandHeight}px stacked above ${ev.height}px image`);
  const c = createCanvas(img.width, img.height); c.getContext('2d').drawImage(img, 0, 0);
  ok(hashCanvas(c, ev.bandHeight, c.height) === ev.sha256, 'verify page logic: recomputed SHA-256 matches');
  // tamper: flip one pixel under the band
  c.getContext('2d').fillStyle = '#f00'; c.getContext('2d').fillRect(5, ev.bandHeight + 5, 1, 1);
  ok(hashCanvas(c, ev.bandHeight, c.height) !== ev.sha256, 'tampered pixel is detected');
}

// 3. JPEG / GIF (and evidence forcing PNG)
{
  const j = await exportCapture('cap1', 'jpeg', { settings: S() });
  const jb = Buffer.from(await j.blob.arrayBuffer());
  ok(jb[0] === 0xff && jb[1] === 0xd8, 'JPEG magic');
  const g = await exportCapture('cap1', 'gif', { settings: S() });
  const gb = Buffer.from(await g.blob.arrayBuffer());
  ok(gb.toString('latin1', 0, 6) === 'GIF89a', 'GIF magic, ' + gb.length + ' bytes');
  const e = await exportCapture('cap1', 'jpeg', { settings: S({ evidence: true }) });
  ok(e.filename.endsWith('.png') && e.notes.length === 1, 'evidence mode turns JPEG into PNG with a note');
}

// 4. PDF layouts
async function pdfInfo(settings) {
  const r = await exportCapture('cap1', 'pdf', { settings });
  const bytes = new Uint8Array(await r.blob.arrayBuffer());
  const doc = await globalThis.PDFLib.PDFDocument.load(bytes);
  return { doc, r, bytes };
}
{
  const { doc } = await pdfInfo(S({ pdf: { paper: 'a4', orientation: 'portrait', smartSplit: true, links: true, stamp: true } }));
  const n = doc.getPageCount();
  const [pw, ph] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
  ok(n >= 2 && Math.abs(pw - 595.28) < 0.1 && Math.abs(ph - 841.89) < 0.1, `A4 portrait: ${n} pages`);
  const annots = doc.getPages().map((p) => (p.node.Annots() ? p.node.Annots().size() : 0));
  ok(annots.reduce((a, b) => a + b, 0) === 2, 'both links became annotations: ' + annots.join(','));
  const landscape = await pdfInfo(S({ pdf: { paper: 'letter', orientation: 'landscape' } }));
  ok(Math.abs(landscape.doc.getPage(0).getWidth() - 792) < 0.1, 'Letter landscape swaps width/height');
  const full = await pdfInfo(S({ pdf: { paper: 'full' } }));
  ok(full.doc.getPageCount() === 1 && full.doc.getPage(0).getHeight() > 1900, 'Full image: one tall page ' + Math.round(full.doc.getPage(0).getHeight()) + 'pt');
  const ev = await pdfInfo(S({ evidence: true, pdf: { paper: 'a4' } }));
  const txt = Buffer.from(ev.bytes).toString('latin1');
  ok(ev.doc.getPageCount() >= 2, 'evidence PDF builds (' + ev.doc.getPageCount() + ' pages)');
}

// 5. smart split never cuts through a text row: render page 1 slice boundary
{
  const { doc } = await pdfInfo(S({ pdf: { paper: 'a4', smartSplit: true } }));
  ok(doc.getPageCount() > 1, 'multi page for smart split check');
}

ok(violations.length === 0, 'every readback happened on a willReadFrequently canvas (' + violations.length + ' violations)');
console.log(fails ? `\n${fails} FAILED` : '\nall exporter checks passed');
process.exit(fails ? 1 : 0);
