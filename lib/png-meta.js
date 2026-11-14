// Read/write PNG tEXt chunks (used to embed Evidence mode facts in exported PNGs).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const isPng = (b) => b.length > 33 && SIG.every((v, i) => b[i] === v);
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

// tEXt is Latin-1 only, so any non-ASCII character is written as a \uXXXX escape.
export function asciiJson(obj) {
  return JSON.stringify(obj).replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

export function addPngText(png, key, text) {
  if (!isPng(png)) throw new Error('Not a PNG');
  const k = new TextEncoder().encode(key);
  const t = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) t[i] = text.charCodeAt(i) & 0xff;
  const body = new Uint8Array(4 + k.length + 1 + t.length);
  body.set([0x74, 0x45, 0x58, 0x74], 0); // "tEXt"
  body.set(k, 4);
  body[4 + k.length] = 0;
  body.set(t, 5 + k.length);
  const chunk = new Uint8Array(12 + body.length - 4);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, body.length - 4);
  chunk.set(body, 4);
  dv.setUint32(chunk.length - 4, crc32(body));
  const ihdrEnd = 8 + 12 + u32(png, 8); // signature + IHDR chunk
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

export function readPngText(png, key) {
  if (!isPng(png)) return null;
  let o = 8;
  while (o + 12 <= png.length) {
    const len = u32(png, o);
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    if (type === 'tEXt') {
      const data = png.subarray(o + 8, o + 8 + len);
      const z = data.indexOf(0);
      if (z > 0 && new TextDecoder().decode(data.subarray(0, z)) === key) {
        let s = '';
        for (let i = z + 1; i < data.length; i++) s += String.fromCharCode(data[i]);
        return s;
      }
    }
    if (type === 'IEND') break;
    o += 12 + len;
  }
  return null;
}
