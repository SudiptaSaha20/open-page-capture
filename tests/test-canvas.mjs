// readPixels must never call getImageData on a canvas that was not created with willReadFrequently.
const created = [];
globalThis.document = { createElement: () => {
  const rec = { width: 0, height: 0, flag: null, reads: 0, copies: 0 };
  rec.getContext = (type, opts) => {
    if (rec.flag === null) rec.flag = !!(opts && opts.willReadFrequently);
    return {
      drawImage: () => { rec.copies++; },
      getImageData: (x, y, w, h) => { rec.reads++; if (!rec.flag) throw new Error('unflagged readback'); return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
    };
  };
  created.push(rec); return rec;
} };
const { createReadableCanvas, readPixels } = await import('../lib/canvas.js');
let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };

const { c: good } = createReadableCanvas(10, 10);
const before = created.length;
readPixels(good, 0, 0, 4, 4);
ok(created.length === before && good.reads === 1, 'a canvas made by createReadableCanvas is read directly');

// a plain canvas, as the browser would hand us (context created without the flag)
const plain = document.createElement('canvas'); plain.getContext('2d');
const n = created.length;
for (let i = 0; i < 5; i++) readPixels(plain, 0, 0, 3, 3);
ok(plain.reads === 0, 'a plain canvas is never read with getImageData');
ok(created.length === n + 5 && created.slice(n).every((r) => r.flag === true && r.reads === 1), 'each read goes through a fresh willReadFrequently copy');
console.log(fails ? fails + ' FAILED' : 'canvas readback checks passed');
process.exit(fails ? 1 : 0);
