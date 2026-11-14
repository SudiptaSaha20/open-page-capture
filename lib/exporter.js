// Turns a stored capture into a downloadable file. Runs in extension pages and in the
// offscreen document (never in the service worker: needs DOM canvas, workers and WASM).

import { getCapture, getImage } from './db.js';
import { getSettings } from './settings.js';
import { hashCanvas } from './sha256.js';
import { addPngText, asciiJson } from './png-meta.js';
import { loadScript, fileStamp, slugifyUrl, isoWithOffset, fmtDate, clamp } from './util.js';
import { createOcr } from './ocr.js';
import { createReadableCanvas, readPixels } from './canvas.js';

export const FORMATS = {
  png: { ext: 'png', mime: 'image/png', label: 'PNG' },
  jpeg: { ext: 'jpg', mime: 'image/jpeg', label: 'JPEG' },
  gif: { ext: 'gif', mime: 'image/gif', label: 'GIF' },
  pdf: { ext: 'pdf', mime: 'application/pdf', label: 'PDF' }
};

export const EVIDENCE_KEY = 'OpenPageCapture';

export function buildFilename(rec, ext) {
  return `screencapture-${slugifyUrl(rec.url)}-${fileStamp(rec.createdAt)}.${ext}`;
}

export async function loadCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const { c, x } = createReadableCanvas(bmp.width, bmp.height);
  x.drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

export const canvasToBlob = (canvas, type = 'image/png', quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image (it may be too large).'))), type, quality);
  });

// ---------- Evidence mode ----------
export function buildEvidence(rec, canvas) {
  return {
    v: 1,
    tool: 'Open Page Capture 1.0',
    url: rec.url,
    title: rec.title,
    captured: isoWithOffset(rec.createdAt),
    timezone: rec.tz || '',
    sha256: hashCanvas(canvas),
    width: canvas.width,
    height: canvas.height,
    edited: !!rec.edited
  };
}

function wrapChars(ctx, text, maxW) {
  const lines = [];
  let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function renderBand(width, ev) {
  const fs = clamp(Math.round(width / 85), 12, 26);
  const pad = Math.round(fs * 0.9);
  const lh = Math.round(fs * 1.5);
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `${fs}px monospace`;
  const rows = [
    ['URL', ev.url],
    ['Captured', `${ev.captured}${ev.timezone ? ' (' + ev.timezone + ')' : ''}`],
    ['SHA-256', ev.sha256]
  ];
  if (ev.edited) rows.push(['Note', 'Edited after capture']);
  const labelW = Math.ceil(probe.measureText('Captured  ').width);
  const textW = Math.max(60, width - pad * 2 - labelW);
  const wrapped = rows.map(([l, t]) => [l, wrapChars(probe, t, textW)]);
  const count = wrapped.reduce((n, [, ls]) => n + ls.length, 0);
  const height = pad * 2 + lh * count;

  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const x = c.getContext('2d');
  x.fillStyle = '#f3f4f6';
  x.fillRect(0, 0, width, height);
  x.fillStyle = '#c9ced8';
  x.fillRect(0, height - 2, width, 2);
  x.font = probe.font;
  x.textBaseline = 'middle';
  let y = pad + lh / 2;
  for (const [label, ls] of wrapped) {
    ls.forEach((line, i) => {
      if (i === 0) { x.fillStyle = '#5b6270'; x.fillText(label, pad, y); }
      x.fillStyle = '#15181e';
      x.fillText(line, pad + labelW, y);
      y += lh;
    });
  }
  return c;
}

// ---------- images ----------
async function makePng(rec, canvas, settings) {
  let source = canvas;
  let ev = null;
  if (settings.evidence) {
    ev = buildEvidence(rec, canvas);
    const band = renderBand(canvas.width, ev);
    ev.bandHeight = band.height;
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = band.height + canvas.height;
    const x = out.getContext('2d');
    x.drawImage(band, 0, 0);
    x.drawImage(canvas, 0, band.height);
    source = out;
  }
  const blob = await canvasToBlob(source, 'image/png');
  if (!ev) return blob;
  const bytes = addPngText(new Uint8Array(await blob.arrayBuffer()), EVIDENCE_KEY, asciiJson(ev));
  return new Blob([bytes], { type: 'image/png' });
}

async function makeJpeg(canvas, settings) {
  return canvasToBlob(canvas, 'image/jpeg', clamp(settings.jpegQuality || 0.92, 0.3, 1));
}

async function makeGif(canvas, notes) {
  const { GIFEncoder, quantize, applyPalette } = await import('../vendor/gifenc.esm.js');
  let src = canvas;
  const CAP = 20_000_000;
  if (canvas.width * canvas.height > CAP) {
    const k = Math.sqrt(CAP / (canvas.width * canvas.height));
    src = document.createElement('canvas');
    src.width = Math.max(1, Math.round(canvas.width * k));
    src.height = Math.max(1, Math.round(canvas.height * k));
    const x = src.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(canvas, 0, 0, src.width, src.height);
    notes.push(`GIF was scaled to ${Math.round(k * 100)}% (20 megapixel limit).`);
  }
  const w = src.width, h = src.height;
  const rgba = readPixels(src, 0, 0, w, h).data;
  const n = w * h;
  const step = Math.max(1, Math.floor(n / 500000));
  const sample = new Uint8ClampedArray(Math.ceil(n / step) * 4);
  for (let i = 0, j = 0; i < n; i += step, j += 4) {
    sample[j] = rgba[i * 4]; sample[j + 1] = rgba[i * 4 + 1]; sample[j + 2] = rgba[i * 4 + 2]; sample[j + 3] = 255;
  }
  const palette = quantize(sample, 256, { format: 'rgb565' });
  const index = applyPalette(rgba, palette, 'rgb565');
  const gif = GIFEncoder();
  gif.writeFrame(index, w, h, { palette });
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

// ---------- PDF ----------
const PAPER = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] };
const PDF_MAX = 14400; // PDF page size limit in points

function winAnsi(font, text) {
  let out = '';
  for (const ch of text) {
    try { font.encodeText(ch); out += ch; } catch (e) { out += ch === '\n' ? ' ' : '?'; }
  }
  return out;
}

function wrapPdf(font, size, text, maxW) {
  const lines = [];
  let cur = '';
  for (const ch of text) {
    if (font.widthOfTextAtSize(cur + ch, size) > maxW && cur) { lines.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// Looks for a blank row band just above `target` so a page break never cuts through text.
function smartBreak(canvas, W, y0, target, windowRows) {
  const lo = Math.max(y0 + 40, target - windowRows);
  const rows = target - lo;
  if (rows < 4) return target;
  const data = readPixels(canvas, 0, lo, W, rows).data;
  for (let r = rows - 1; r >= 0; r--) {
    const o = r * W * 4;
    const r0 = data[o], g0 = data[o + 1], b0 = data[o + 2];
    let uniform = true;
    for (let x = 0; x < W; x += 3) {
      const p = o + x * 4;
      if (Math.abs(data[p] - r0) > 6 || Math.abs(data[p + 1] - g0) > 6 || Math.abs(data[p + 2] - b0) > 6) { uniform = false; break; }
    }
    if (uniform) return lo + r + 1;
  }
  return target;
}

async function makePdf(rec, canvas, settings, notes, progress) {
  await loadScript('vendor/pdf-lib.min.js');
  const { PDFDocument, StandardFonts, PDFName, PDFString, rgb } = globalThis.PDFLib;
  const cfg = settings.pdf;
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const W = canvas.width, H = canvas.height;

  pdf.setTitle(winAnsi(helv, rec.title || 'Screenshot'));
  pdf.setSubject(winAnsi(helv, rec.url || ''));
  pdf.setCreator('Open Page Capture');
  pdf.setProducer('Open Page Capture');
  pdf.setCreationDate(new Date(rec.createdAt));

  // Geometry
  const full = cfg.paper === 'full';
  let pageW, pageH, margin, k;
  if (full) {
    margin = 0;
    k = 0.75;
  } else {
    let [pw, ph] = PAPER[cfg.paper] || PAPER.a4;
    if (cfg.orientation === 'landscape') [pw, ph] = [ph, pw];
    pageW = pw; pageH = ph; margin = 28;
    k = (pw - margin * 2) / W;
  }

  // Header (URL + date stamp, or the evidence block)
  let ev = null;
  if (settings.evidence) {
    progress('Computing checksum…');
    ev = buildEvidence(rec, canvas);
    pdf.getInfoDict().set(PDFName.of('OPCEvidence'), PDFString.of(asciiJson(ev)));
  }
  const headerWidthPt = full ? Math.max(W * k, 300) : pageW - margin * 2;
  const header = [];
  const HS = 8, HL = 11;
  if (ev) {
    const rows = [
      ['URL', ev.url, helv],
      ['Captured', `${ev.captured}${ev.timezone ? ' (' + ev.timezone + ')' : ''}`, helv],
      ['SHA-256', ev.sha256, mono]
    ];
    if (ev.edited) rows.push(['Note', 'Edited after capture', helv]);
    for (const [label, text, font] of rows) {
      const labelW = helv.widthOfTextAtSize('Captured  ', HS);
      const ls = wrapPdf(font, HS, winAnsi(font, text), headerWidthPt - labelW - 4);
      ls.forEach((l, i) => header.push({ label: i === 0 ? label : '', text: l, font, labelW }));
    }
  } else if (cfg.stamp) {
    const line = winAnsi(helv, rec.url || '');
    const fitted = wrapPdf(helv, HS, line, headerWidthPt - 4)[0];
    header.push({ label: '', text: fitted + (fitted.length < line.length ? '…' : ''), font: helv, labelW: 0 });
    const d = fmtDate(rec.createdAt, cfg.dateFormat);
    if (d) header.push({ label: '', text: winAnsi(helv, d), font: helv, labelW: 0 });
  }
  const headerH = header.length ? header.length * HL + 10 : 0;

  if (full) {
    if (W * k > PDF_MAX) k = PDF_MAX / W;
    if (H * k + headerH > PDF_MAX) k = (PDF_MAX - headerH) / H;
    pageW = Math.max(W * k, 300);
    pageH = H * k + headerH;
  }

  // Slices (one per page; for the single "full image" page they only bound the OCR work)
  const slices = [];
  if (full) {
    const chunk = 2800;
    let y = 0;
    while (y < H) {
      let end = Math.min(H, y + chunk);
      if (end < H) end = smartBreak(canvas, W, y, end, 500);
      slices.push([y, end]);
      y = end;
    }
  } else {
    let y = 0, i = 0;
    while (y < H) {
      const avail = pageH - margin * 2 - (i === 0 ? headerH : 0);
      const rows = Math.max(60, Math.floor(avail / k));
      let end = Math.min(H, y + rows);
      if (end < H && cfg.smartSplit) end = smartBreak(canvas, W, y, end, Math.floor(rows * 0.2));
      if (end <= y) end = Math.min(H, y + rows);
      slices.push([y, end]);
      y = end; i++;
    }
  }

  // OCR engine
  let ocr = null;
  if (cfg.ocr) {
    progress('Loading OCR engine…');
    try { ocr = await createOcr(cfg.ocrLang || 'eng'); }
    catch (err) { notes.push('OCR could not start, so the PDF has no text layer: ' + (err && err.message ? err.message : err)); }
  }

  const pages = [];
  const annots = [];
  let page = full ? pdf.addPage([pageW, pageH]) : null;
  if (full) { pages.push(page); annots.push([]); }

  try {
    for (let i = 0; i < slices.length; i++) {
      const [y0, y1] = slices[i];
      const h = y1 - y0;
      progress(`Building PDF page ${i + 1} of ${slices.length}…`);
      const c = document.createElement('canvas');
      c.width = W; c.height = h;
      c.getContext('2d').drawImage(canvas, 0, y0, W, h, 0, 0, W, h);
      const png = new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer());
      const img = await pdf.embedPng(png);

      let pageIdx = 0;
      if (!full) { page = pdf.addPage([pageW, pageH]); pages.push(page); annots.push([]); pageIdx = pages.length - 1; }
      const yTop = full ? pageH - headerH - y0 * k : pageH - margin - (i === 0 ? headerH : 0);
      page.drawImage(img, { x: margin, y: yTop - h * k, width: W * k, height: h * k });

      if (ocr) {
        try {
          const lines = await ocr.recognize(c, (p) => progress(`OCR page ${i + 1} of ${slices.length} (${Math.round(p * 100)}%)`));
          for (const ln of lines) {
            const text = winAnsi(helv, ln.text);
            if (!text.replace(/[?\s]/g, '')) continue;
            const bw = (ln.x1 - ln.x0) * k, bh = (ln.y1 - ln.y0) * k;
            let size = clamp(bh * 0.85, 2, 72);
            const tw = helv.widthOfTextAtSize(text, size);
            if (tw > bw && tw > 0) size = clamp(size * (bw / tw), 1.5, 72);
            page.drawText(text, {
              x: margin + ln.x0 * k,
              y: yTop - (ln.y1 - y0) * k + bh * 0.22,
              size, font: helv, opacity: 0
            });
          }
        } catch (err) {
          notes.push(`OCR failed on page ${i + 1}: ${err && err.message ? err.message : err}`);
        }
      }

      if (cfg.links && rec.links && rec.links.length) {
        const pi = full ? 0 : pageIdx;
        for (const l of rec.links) {
          if (l.y + l.h <= y0 || l.y >= y1) continue;
          const ly0 = Math.max(l.y, y0), ly1 = Math.min(l.y + l.h, y1);
          const rect = [margin + l.x * k, yTop - (ly1 - y0) * k, margin + (l.x + l.w) * k, yTop - (ly0 - y0) * k];
          const annot = pdf.context.obj({
            Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0],
            A: { Type: 'Action', S: 'URI', URI: PDFString.of(l.href) }
          });
          annots[pi].push(pdf.context.register(annot));
        }
      }
    }
  } finally {
    if (ocr) await ocr.terminate();
  }

  annots.forEach((refs, i) => { if (refs.length) pages[i].node.set(PDFName.of('Annots'), pdf.context.obj(refs)); });

  // Header drawn last so it sits on the first page's top margin.
  if (header.length) {
    const p0 = pages[0];
    let ty = pageH - (full ? 0 : margin) - HL;
    for (const row of header) {
      if (row.label) p0.drawText(row.label, { x: margin, y: ty, size: HS, font: helv, color: rgb(0.36, 0.38, 0.44) });
      p0.drawText(row.text, { x: margin + row.labelW, y: ty, size: HS, font: row.font, color: rgb(0.08, 0.09, 0.12) });
      ty -= HL;
    }
  }

  progress('Saving PDF…');
  const bytes = await pdf.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

// ---------- public entry point ----------
// Returns { blob, filename, mime, notes[] }.
export async function exportCapture(id, format, opts = {}) {
  const settings = opts.settings || (await getSettings());
  const progress = opts.onProgress || (() => {});
  const rec = await getCapture(id);
  if (!rec) throw new Error('This capture no longer exists.');
  const imgBlob = await getImage(id);
  if (!imgBlob) throw new Error('The image data for this capture is missing.');
  progress('Preparing…');
  const canvas = await loadCanvas(imgBlob);
  const notes = [];

  let fmt = FORMATS[format] ? format : 'png';
  if (settings.evidence && (fmt === 'jpeg' || fmt === 'gif')) {
    fmt = 'png';
    notes.push('Evidence mode keeps images lossless, so this was saved as PNG.');
  }

  let blob;
  if (fmt === 'png') { progress('Encoding PNG…'); blob = await makePng(rec, canvas, settings); }
  else if (fmt === 'jpeg') { progress('Encoding JPEG…'); blob = await makeJpeg(canvas, settings); }
  else if (fmt === 'gif') { progress('Encoding GIF…'); blob = await makeGif(canvas, notes); }
  else blob = await makePdf(rec, canvas, settings, notes, progress);

  return { blob, filename: buildFilename(rec, FORMATS[fmt].ext), mime: FORMATS[fmt].mime, notes };
}
