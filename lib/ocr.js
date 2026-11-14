// On-device OCR using the bundled Tesseract.js (WASM). Nothing is downloaded or uploaded:
// the worker, core and English model all ship inside the extension (vendor/tesseract/).
// Extra languages: drop "<lang>.traineddata.gz" into vendor/tesseract/tessdata/ and use the
// language code (e.g. "eng+deu") in Settings > PDF.

import { loadScript } from './util.js';

export async function createOcr(lang = 'eng') {
  await loadScript('vendor/tesseract/tesseract.min.js');
  const base = chrome.runtime.getURL('vendor/tesseract/');
  let onProgress = null;

  const worker = await globalThis.Tesseract.createWorker(lang, 1, {
    workerPath: base + 'worker.min.js',
    corePath: base,
    langPath: base + 'tessdata',
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'none',
    logger: (m) => {
      if (m && m.status === 'recognizing text' && onProgress) onProgress(m.progress || 0);
    }
  });

  // Text at screen resolution is small for the OCR model, so narrow images are upscaled first.
  function prepare(canvas) {
    const k = canvas.width < 1400 ? 2 : canvas.width < 2200 ? 1.5 : 1;
    if (k === 1) return { src: canvas, k };
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * k);
    c.height = Math.round(canvas.height * k);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(canvas, 0, 0, c.width, c.height);
    return { src: c, k };
  }

  return {
    // Returns lines: [{ text, x0, y0, x1, y1 }] in the coordinates of the canvas that was passed in.
    async recognize(canvas, cb) {
      onProgress = cb || null;
      const { src, k } = prepare(canvas);
      const { data } = await worker.recognize(src, {}, { text: true, blocks: true });
      const out = [];
      for (const block of data.blocks || []) {
        for (const para of block.paragraphs || []) {
          for (const line of para.lines || []) {
            const text = (line.text || '').replace(/\s+/g, ' ').trim();
            if (!text || !line.bbox) continue;
            out.push({
              text,
              x0: line.bbox.x0 / k, y0: line.bbox.y0 / k,
              x1: line.bbox.x1 / k, y1: line.bbox.y1 / k
            });
          }
        }
      }
      onProgress = null;
      return out;
    },
    async terminate() {
      try { await worker.terminate(); } catch (e) { /* already gone */ }
    }
  };
}
