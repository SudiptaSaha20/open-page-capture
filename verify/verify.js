import '../lib/theme.js';
import { $, el } from '../lib/util.js';
import { hydrateIcons, brandMark, icon } from '../lib/icons.js';
import { readPngText } from '../lib/png-meta.js';
import { hashCanvas } from '../lib/sha256.js';
import { createReadableCanvas } from '../lib/canvas.js';
import { EVIDENCE_KEY } from '../lib/exporter.js';

$('#brand').innerHTML = brandMark(22) + '<span>Open Page Capture</span>';
hydrateIcons();

const out = $('#result');
const drop = $('#drop');
const input = $('#file');

function verdict(kind, text) {
  const ic = kind === 'ok' ? 'check' : kind === 'bad' ? 'alert' : 'shield';
  return el('div', { class: 'verdict ' + kind, html: icon(ic, 22) + '' }, el('span', {}, text));
}

function details(rows) {
  const dl = el('dl');
  for (const [k, v, mono] of rows) {
    dl.append(el('dt', {}, k), el('dd', { class: mono ? 'mono' : '' }, v));
  }
  return dl;
}

async function verify(file) {
  out.classList.remove('hidden');
  out.replaceChildren(verdict('neutral', 'Checking…'));
  try {
    if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
      out.replaceChildren(verdict('neutral', 'PDFs carry the same facts on page 1 and in the document properties. To verify the pixels, export a PNG.'));
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const txt = readPngText(bytes, EVIDENCE_KEY);
    if (!txt) {
      out.replaceChildren(verdict('bad', 'No evidence data found in this file.'),
        details([['What this means', 'The file is not a PNG exported with Evidence mode, or the metadata was stripped.']]));
      return;
    }
    const ev = JSON.parse(txt);
    const bmp = await createImageBitmap(file);
    const { c, x } = createReadableCanvas(bmp.width, bmp.height);
    x.drawImage(bmp, 0, 0);
    bmp.close();

    const band = ev.bandHeight || 0;
    const sizeOk = c.width === ev.width && c.height - band === ev.height;
    const computed = sizeOk ? hashCanvas(c, band, c.height) : '(size differs from the original)';
    const match = sizeOk && computed === ev.sha256;

    out.replaceChildren(
      verdict(match ? 'ok' : 'bad', match ? 'Pixels match. This image is unchanged since it was saved.' : 'Pixels do not match. This image was changed after it was saved.'),
      details([
        ['Address', ev.url],
        ['Captured', `${ev.captured}${ev.timezone ? ' (' + ev.timezone + ')' : ''}`],
        ['Size', `${ev.width} × ${ev.height} px`],
        ['Edited', ev.edited ? 'Yes, edited in the editor before export' : 'No'],
        ['Recorded SHA-256', ev.sha256, true],
        ['Computed SHA-256', computed, true]
      ]));
  } catch (err) {
    out.replaceChildren(verdict('bad', 'Could not read this file.'), details([['Details', err && err.message ? err.message : String(err)]]));
  }
}

input.addEventListener('change', () => { if (input.files[0]) verify(input.files[0]); });
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) verify(f); });
