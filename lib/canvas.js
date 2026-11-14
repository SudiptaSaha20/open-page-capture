// The ONLY place pixels are read back from a canvas.
//
// Chrome warns ("Canvas2D: Multiple readback operations using getImageData are faster with the
// willReadFrequently attribute set to true") when getImageData is used repeatedly on a canvas whose
// context was not created with that attribute. The attribute can only be chosen when the context
// is first created, so every canvas we read from is created here with it, and anything else is
// copied into such a canvas before reading. scripts/check.mjs fails if getImageData appears
// anywhere else in the extension.

const readable = new WeakSet();

// A new canvas + 2D context that is safe to read back from.
export function createReadableCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const x = c.getContext('2d', { willReadFrequently: true });
  readable.add(c);
  return { c, x };
}

// RGBA pixels of a region of any canvas.
export function readPixels(canvas, sx, sy, sw, sh) {
  if (readable.has(canvas) || typeof document === 'undefined') {
    return canvas.getContext('2d').getImageData(sx, sy, sw, sh);
  }
  const t = createReadableCanvas(sw, sh);
  t.x.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return t.x.getImageData(0, 0, sw, sh);
}
