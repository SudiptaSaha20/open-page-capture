// Stitching engine: walks a region of the page tile by tile and draws each screenshot into
// one canvas. Free of chrome.* and DOM APIs so it can run in the service worker and in tests.

export const LIMITS = { maxDim: 32000, maxArea: 100_000_000, maxCssH: 60000 };

export class CancelError extends Error {}

export function planCanvas(cssW, cssH, ratio, limits = LIMITS) {
  const devW = cssW * ratio, devH = cssH * ratio;
  const s = Math.min(1, limits.maxDim / devW, limits.maxDim / devH, Math.sqrt(limits.maxArea / (devW * devH)));
  return { s, w: Math.max(1, Math.round(devW * s)), h: Math.max(1, Math.round(devH * s)) };
}

// Source and destination rectangles for one screenshot. All edges are rounded (not sizes),
// so neighbouring tiles share exact pixel boundaries and no seams appear.
export function planTile({ rect, region, ratio, s, ax, ay }) {
  const ix0 = Math.max(ax, region.x), ix1 = Math.min(ax + rect.width, region.x + region.w);
  const iy0 = Math.max(ay, region.y), iy1 = Math.min(ay + rect.height, region.y + region.h);
  if (ix1 <= ix0 || iy1 <= iy0) return null;
  const sx = Math.round((rect.left + ix0 - ax) * ratio), sx1 = Math.round((rect.left + ix1 - ax) * ratio);
  const sy = Math.round((rect.top + iy0 - ay) * ratio), sy1 = Math.round((rect.top + iy1 - ay) * ratio);
  const dx0 = Math.round((ix0 - region.x) * ratio * s), dx1 = Math.round((ix1 - region.x) * ratio * s);
  const dy0 = Math.round((iy0 - region.y) * ratio * s), dy1 = Math.round((iy1 - region.y) * ratio * s);
  return { sx, sy, sw: sx1 - sx, sh: sy1 - sy, dx: dx0, dy: dy0, dw: dx1 - dx0, dh: dy1 - dy0 };
}

/**
 * @param {object} o
 * @param {'visible'|'full'|'select'} o.mode
 * @param {{left,top,width,height}} o.rect   visible capture rectangle, CSS px in the viewport
 * @param {{x,y,w,h}} o.region               area to capture, CSS px in content coordinates (mutated if the page grows)
 * @param {{x,y}} o.scroll                   scroll position when the capture started
 * @param {number} o.innerW                  viewport width in CSS px (to derive the device pixel ratio)
 * @param {(x,y,isFirst)=>Promise<{scroll:{x,y},contentH:number}>} o.scrollTo
 * @param {()=>Promise<{width:number,close:()=>void}>} o.shoot  returns a bitmap of the viewport
 * @param {(w,h)=>{c:any,x:any}} o.newCanvas  canvas + 2d context, pre-filled white
 * @param {()=>Promise<void>} [o.gate]       called before every tile (pause/cancel/tab checks)
 * @param {(done:number,total:number)=>void} [o.onProgress]
 * @param {()=>Promise<void>} [o.afterFirst] called after the first tile (hide fixed elements)
 */
export async function runStitch(o) {
  const { mode, rect, region, innerW } = o;
  const limits = o.limits || LIMITS;
  const gate = o.gate || (async () => {});
  const estimate = () => Math.max(1, Math.ceil(region.w / rect.width) * Math.ceil(region.h / rect.height));

  let canvas = null, ctx = null, ratio = 0, s = 1;
  let done = 0, first = true;
  let coveredY = region.y;

  const allocate = () => {
    const p = planCanvas(region.w, region.h, ratio, limits);
    if (canvas && p.w === canvas.width && p.h === canvas.height) return;
    const n = o.newCanvas(p.w, p.h);
    if (canvas) {
      const k = p.s / s;
      n.x.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, Math.round(canvas.width * k), Math.round(canvas.height * k));
    }
    canvas = n.c; ctx = n.x; s = p.s;
  };

  while (coveredY < region.y + region.h) {
    let coveredX = region.x;
    let rowTop = null;
    while (coveredX < region.x + region.w) {
      await gate();
      let ax = o.scroll.x, ay = o.scroll.y;
      if (mode !== 'visible') {
        const r = await o.scrollTo(coveredX, coveredY, first);
        if (!r) throw new Error('Lost connection to the page. Reload it and try again.');
        ax = r.scroll.x; ay = r.scroll.y;
        if (mode === 'full' && r.contentH > region.y + region.h && region.h < limits.maxCssH) {
          region.h = Math.min(r.contentH, limits.maxCssH);
          if (canvas) allocate();
        }
      }
      await gate();
      const bmp = await o.shoot();
      if (!ratio) { ratio = bmp.width / innerW; allocate(); }

      const t = planTile({ rect, region, ratio, s, ax, ay });
      if (t) ctx.drawImage(bmp, t.sx, t.sy, t.sw, t.sh, t.dx, t.dy, t.dw, t.dh);
      if (bmp.close) bmp.close();
      done++;
      if (o.onProgress) o.onProgress(done, Math.max(estimate(), done));

      if (first) { first = false; if (o.afterFirst) await o.afterFirst(); }
      rowTop = ay;
      const nx = ax + rect.width;
      if (mode === 'visible' || nx <= coveredX) coveredX = Infinity; // cannot scroll further sideways
      else coveredX = nx;
    }
    if (mode === 'visible') break;
    const ny = (rowTop == null ? coveredY : rowTop) + rect.height;
    if (ny <= coveredY) break; // cannot scroll further down
    coveredY = ny;
  }

  if (!canvas) throw new Error('Nothing was captured.');
  return { canvas, ratio, s };
}
