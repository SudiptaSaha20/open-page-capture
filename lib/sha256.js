// Streaming SHA-256 (so very large pixel buffers can be hashed in chunks).

import { readPixels } from './canvas.js';

const PRIMES = [];
for (let n = 2; PRIMES.length < 64; n++) {
  let ok = true;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) { ok = false; break; }
  if (ok) PRIMES.push(n);
}
const frac32 = (x) => Math.floor((x - Math.floor(x)) * 4294967296) >>> 0;
const K = new Uint32Array(PRIMES.map((p) => frac32(Math.cbrt(p))));
const H0 = new Uint32Array(PRIMES.slice(0, 8).map((p) => frac32(Math.sqrt(p))));

export class Sha256 {
  constructor() {
    this.h = new Uint32Array(H0);
    this.buf = new Uint8Array(64);
    this.bufLen = 0;
    this.total = 0;
    this.w = new Uint32Array(64);
  }

  _block(b, o) {
    const w = this.w;
    for (let i = 0; i < 16; i++, o += 4) {
      w[i] = (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], c = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((c >>> 17) | (c << 15)) ^ ((c >>> 19) | (c << 13)) ^ (c >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    const h = this.h;
    let a = h[0], b2 = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b2) ^ (a & c) ^ (b2 & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b2; b2 = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b2) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }

  update(data) {
    let i = 0;
    const n = data.length;
    this.total += n;
    if (this.bufLen) {
      while (i < n && this.bufLen < 64) this.buf[this.bufLen++] = data[i++];
      if (this.bufLen === 64) { this._block(this.buf, 0); this.bufLen = 0; }
    }
    for (; i + 64 <= n; i += 64) this._block(data, i);
    while (i < n) this.buf[this.bufLen++] = data[i++];
    return this;
  }

  digestHex() {
    const bits = this.total * 8;
    const pad = new Uint8Array(((this.bufLen < 56 ? 56 : 120) - this.bufLen) + 8);
    pad[0] = 0x80;
    const hi = Math.floor(bits / 4294967296), lo = bits >>> 0;
    const L = pad.length;
    pad[L - 8] = hi >>> 24; pad[L - 7] = hi >>> 16; pad[L - 6] = hi >>> 8; pad[L - 5] = hi;
    pad[L - 4] = lo >>> 24; pad[L - 3] = lo >>> 16; pad[L - 2] = lo >>> 8; pad[L - 1] = lo;
    const total = this.total;
    this.update(pad);
    this.total = total;
    return Array.from(this.h, (x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
}

// Hash the RGBA pixels of a canvas region row by row (rows are chunked to bound memory).
export function hashCanvas(canvas, y0 = 0, y1 = canvas.height) {
  const w = canvas.width;
  const rowsPerChunk = Math.max(1, Math.floor(4_000_000 / Math.max(1, w)));
  const sha = new Sha256();
  for (let y = y0; y < y1; y += rowsPerChunk) {
    const h = Math.min(rowsPerChunk, y1 - y);
    const data = readPixels(canvas, 0, y, w, h).data;
    sha.update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  return sha.digestHex();
}
