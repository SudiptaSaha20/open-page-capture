// Offscreen document: renders exports (PNG/JPEG/GIF/PDF+OCR) for the service worker, which
// cannot use DOM canvas, workers or WASM itself. Used by batch capture and auto-download.
import { exportCapture } from '../lib/exporter.js';

const urls = new Set();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return;
  if (msg.type === 'export') {
    exportCapture(msg.id, msg.format, { settings: msg.settings })
      .then(({ blob, filename }) => {
        const url = URL.createObjectURL(blob);
        urls.add(url);
        sendResponse({ ok: true, url, filename });
      })
      .catch((err) => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));
    return true;
  }
  if (msg.type === 'revoke') {
    URL.revokeObjectURL(msg.url);
    urls.delete(msg.url);
  }
});
