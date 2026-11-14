import { createCanvas } from '@napi-rs/canvas';

const root = new URL('../', import.meta.url).pathname;
const { runStitch, planCanvas, LIMITS } = await import(root + 'lib/stitch.js');
const { hashCanvas } = await import(root + 'lib/sha256.js');

let fails = 0;
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };

// A fake "page": every device pixel has a value derived from its own coordinates, so any
// misplacement, overlap or seam shows up as a hash mismatch.
function makePage(cssW, cssH, dpr) {
  const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
  const c = createCanvas(W, H);
  const x = c.getContext('2d');
  const img = x.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let xx = 0; xx < W; xx++) {
      const p = (y * W + xx) * 4;
      img.data[p] = (xx * 7 + y * 13) & 255;
      img.data[p + 1] = ((xx * 3) ^ (y * 5)) & 255;
      img.data[p + 2] = ((xx + y) * 11) & 255;
      img.data[p + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

function fakeBrowser({ cssW, cssH, dpr, vw = 1000, vh = 700, grow = null }) {
  const page = makePage(cssW, grow ? grow.to : cssH, dpr);
  let contentH = cssH;
  let sx = 0, sy = 0, calls = 0;
  const rect = { left: 0, top: 0, width: vw, height: vh };
  return {
    page, rect, vw, vh,
    scrollTo: async (x, y) => {
      calls++;
      if (grow && calls >= grow.afterCalls) contentH = grow.to;
      sx = Math.max(0, Math.min(Math.round(x), cssW - vw));
      sy = Math.max(0, Math.min(Math.round(y), contentH - vh));
      return { scroll: { x: sx, y: sy }, contentH };
    },
    shoot: async () => {
      const c = createCanvas(Math.round(vw * dpr), Math.round(vh * dpr));
      c.getContext('2d').drawImage(page, Math.round(sx * dpr), Math.round(sy * dpr), c.width, c.height, 0, 0, c.width, c.height);
      c.close = () => {};
      return c;
    },
    scrollNow: () => ({ x: sx, y: sy })
  };
}

const newCanvas = (w, h) => {
  const c = createCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  return { c, x };
};

function reference(page, dpr, region) {
  const w = Math.round(region.w * dpr), h = Math.round(region.h * dpr);
  const c = createCanvas(w, h);
  c.getContext('2d').drawImage(page, Math.round(region.x * dpr), Math.round(region.y * dpr), w, h, 0, 0, w, h);
  return c;
}

async function run(name, opts, mode, region, check) {
  const b = fakeBrowser(opts);
  const reg = { ...region };
  const res = await runStitch({
    mode, rect: b.rect, region: reg, scroll: b.scrollNow(), innerW: b.vw,
    scrollTo: b.scrollTo, shoot: b.shoot, newCanvas
  });
  await check(res, b, reg, name);
}

// 1. full page, DPR 2 and 1, last tile is clamped (2350 is not a multiple of 700)
for (const dpr of [2, 1, 1.5]) {
  await run(`full page dpr ${dpr}`, { cssW: 1000, cssH: 2350, dpr }, 'full', { x: 0, y: 0, w: 1000, h: 2350 }, async (res, b, reg, name) => {
    const ref = reference(b.page, dpr, { x: 0, y: 0, w: 1000, h: 2350 });
    ok(res.canvas.width === ref.width && res.canvas.height === ref.height, `${name}: size ${res.canvas.width}x${res.canvas.height}`);
    ok(hashCanvas(res.canvas) === hashCanvas(ref), `${name}: pixel-exact`);
  });
}

// 2. selection with odd offsets, vertical only
await run('selection 123,517 640x1333', { cssW: 1000, cssH: 3000, dpr: 2 }, 'select', { x: 123, y: 517, w: 640, h: 1333 }, async (res, b, reg, name) => {
  const ref = reference(b.page, 2, { x: 123, y: 517, w: 640, h: 1333 });
  ok(hashCanvas(res.canvas) === hashCanvas(ref), `${name}: pixel-exact`);
});

// 3. selection spanning several horizontal tiles (page wider than the viewport)
await run('selection across columns', { cssW: 2600, cssH: 2000, dpr: 2 }, 'select', { x: 300, y: 450, w: 2200, h: 1400 }, async (res, b, reg, name) => {
  const ref = reference(b.page, 2, { x: 300, y: 450, w: 2200, h: 1400 });
  ok(hashCanvas(res.canvas) === hashCanvas(ref), `${name}: pixel-exact`);
});

// 4. visible area
await run('visible', { cssW: 1000, cssH: 2000, dpr: 2 }, 'visible', { x: 0, y: 0, w: 1000, h: 700 }, async (res, b, reg, name) => {
  const ref = reference(b.page, 2, { x: 0, y: 0, w: 1000, h: 700 });
  ok(hashCanvas(res.canvas) === hashCanvas(ref), `${name}: pixel-exact`);
});

// 5. page grows while scrolling (infinite scroll): canvas is reallocated and earlier tiles kept
await run('page grows 1500 -> 2600', { cssW: 1000, cssH: 1500, dpr: 2, grow: { afterCalls: 2, to: 2600 } }, 'full', { x: 0, y: 0, w: 1000, h: 1500 }, async (res, b, reg, name) => {
  ok(reg.h === 2600, `${name}: region grew to ${reg.h}`);
  const ref = reference(b.page, 2, { x: 0, y: 0, w: 1000, h: 2600 });
  ok(res.canvas.height === ref.height && hashCanvas(res.canvas) === hashCanvas(ref), `${name}: pixel-exact`);
});

// 6. canvas limits: scaled down, still correct size and no exceptions
{
  const b = fakeBrowser({ cssW: 1000, cssH: 3000, dpr: 2 });
  const reg = { x: 0, y: 0, w: 1000, h: 3000 };
  const limits = { maxDim: 32000, maxArea: 4_000_000, maxCssH: 60000 };
  const res = await runStitch({ mode: 'full', rect: b.rect, region: reg, scroll: { x: 0, y: 0 }, innerW: b.vw, scrollTo: b.scrollTo, shoot: b.shoot, newCanvas, limits });
  const p = planCanvas(1000, 3000, 2, limits);
  ok(res.s < 1 && res.canvas.width === p.w && res.canvas.height === p.h, `scaled to ${Math.round(res.s * 100)}% (${res.canvas.width}x${res.canvas.height})`);
  // not blank: compare mean brightness of a middle row with the page's
  const px = res.canvas.getContext('2d').getImageData(10, Math.round(res.canvas.height / 2), 1, 1).data;
  ok(!(px[0] === 255 && px[1] === 255 && px[2] === 255), 'scaled capture has content in the middle (no gap)');
}

// 7. a page that cannot scroll further than its first screen terminates
{
  const b = fakeBrowser({ cssW: 1000, cssH: 700, dpr: 1 });
  const reg = { x: 0, y: 0, w: 1000, h: 2000 };
  const res = await runStitch({ mode: 'full', rect: b.rect, region: reg, scroll: { x: 0, y: 0 }, innerW: b.vw, scrollTo: b.scrollTo, shoot: b.shoot, newCanvas });
  ok(!!res.canvas, 'non-scrollable page terminates without looping forever');
}

console.log(fails ? `\n${fails} FAILED` : '\nall stitching checks passed');
process.exit(fails ? 1 : 0);
