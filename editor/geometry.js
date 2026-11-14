// Pure geometry helpers for the editor (no DOM), kept separate so they can be unit tested.

export const normBox = (x1, y1, x2, y2) => ({
  x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1)
});

export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Bounding box of an annotation. `measure(o)` supplies {w,h} for text objects.
export function bboxOf(o, measure) {
  switch (o.type) {
    case 'pen': case 'hl': {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const [x, y] of o.pts) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
      const r = o.w / 2;
      return { x: x1 - r, y: y1 - r, w: x2 - x1 + o.w, h: y2 - y1 + o.w };
    }
    case 'line': case 'arrow': {
      const b = normBox(o.x1, o.y1, o.x2, o.y2);
      const r = Math.max(o.w, o.type === 'arrow' ? o.w * 3 : 0);
      return { x: b.x - r / 2, y: b.y - r / 2, w: b.w + r, h: b.h + r };
    }
    case 'text': {
      const m = measure(o);
      return { x: o.x, y: o.y, w: m.w, h: m.h };
    }
    default:
      return { x: o.x, y: o.y, w: o.w, h: o.h };
  }
}

export function hitTest(o, px, py, tol, measure) {
  switch (o.type) {
    case 'pen': case 'hl': {
      const r = o.w / 2 + tol;
      if (o.pts.length === 1) return Math.hypot(px - o.pts[0][0], py - o.pts[0][1]) <= r;
      for (let i = 1; i < o.pts.length; i++) {
        if (distToSegment(px, py, o.pts[i - 1][0], o.pts[i - 1][1], o.pts[i][0], o.pts[i][1]) <= r) return true;
      }
      return false;
    }
    case 'line': case 'arrow':
      return distToSegment(px, py, o.x1, o.y1, o.x2, o.y2) <= o.w / 2 + tol + (o.type === 'arrow' ? 2 : 0);
    case 'rect': {
      const inside = px >= o.x - tol && px <= o.x + o.w + tol && py >= o.y - tol && py <= o.y + o.h + tol;
      if (!inside) return false;
      if (o.fill) return true;
      const t = o.w / 2 + 0; // stroke half-width is stored in o.sw
      const sw = (o.sw || 2) / 2 + tol;
      const nearX = Math.min(Math.abs(px - o.x), Math.abs(px - (o.x + o.w))) <= sw;
      const nearY = Math.min(Math.abs(py - o.y), Math.abs(py - (o.y + o.h))) <= sw;
      return nearX || nearY || t < 0;
    }
    case 'ellipse': {
      const rx = o.w / 2, ry = o.h / 2;
      if (rx < 1 || ry < 1) return false;
      const d = Math.hypot((px - (o.x + rx)) / rx, (py - (o.y + ry)) / ry);
      if (o.fill) return d <= 1 + tol / Math.min(rx, ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= (o.sw || 2) / 2 + tol;
    }
    default: {
      const b = bboxOf(o, measure);
      return px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol;
    }
  }
}

export function handlesOf(o) {
  if (o.type === 'line' || o.type === 'arrow') return [{ k: 'p1', x: o.x1, y: o.y1 }, { k: 'p2', x: o.x2, y: o.y2 }];
  if (o.type === 'rect' || o.type === 'ellipse' || o.type === 'pix') {
    return [
      { k: 'nw', x: o.x, y: o.y }, { k: 'ne', x: o.x + o.w, y: o.y },
      { k: 'sw', x: o.x, y: o.y + o.h }, { k: 'se', x: o.x + o.w, y: o.y + o.h }
    ];
  }
  return [];
}

export function applyHandle(o, orig, k, px, py) {
  if (k === 'p1') { o.x1 = px; o.y1 = py; return; }
  if (k === 'p2') { o.x2 = px; o.y2 = py; return; }
  const fx = k.includes('w') ? orig.x + orig.w : orig.x;
  const fy = k.includes('n') ? orig.y + orig.h : orig.y;
  const b = normBox(fx, fy, px, py);
  o.x = b.x; o.y = b.y; o.w = b.w; o.h = b.h;
}

export function translate(o, dx, dy) {
  if (o.pts) o.pts = o.pts.map(([x, y]) => [x + dx, y + dy]);
  else if ('x1' in o) { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
  else { o.x += dx; o.y += dy; }
}

// ---------- crop frame (photo-editor style: drag the edges/corners inwards, or move the frame) ----------

// Which part of the crop frame is under (px,py)? Returns 'nw','n','ne','e','se','s','sw','w','move' or null.
export function cropHit(r, px, py, tol) {
  const nearL = Math.abs(px - r.x) <= tol, nearR = Math.abs(px - (r.x + r.w)) <= tol;
  const nearT = Math.abs(py - r.y) <= tol, nearB = Math.abs(py - (r.y + r.h)) <= tol;
  const inX = px >= r.x - tol && px <= r.x + r.w + tol;
  const inY = py >= r.y - tol && py <= r.y + r.h + tol;
  if (nearL && nearT) return 'nw';
  if (nearR && nearT) return 'ne';
  if (nearL && nearB) return 'sw';
  if (nearR && nearB) return 'se';
  if (nearT && inX) return 'n';
  if (nearB && inX) return 's';
  if (nearL && inY) return 'w';
  if (nearR && inY) return 'e';
  if (px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h) return 'move';
  return null;
}

export function cropCursor(h) {
  return { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', move: 'move' }[h] || '';
}

// New crop frame while dragging handle `h`. `orig` is the frame when the drag began, `start` the pointer then.
export function cropDrag(h, orig, start, px, py, W, H, min = 8) {
  const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let x1 = orig.x, y1 = orig.y, x2 = orig.x + orig.w, y2 = orig.y + orig.h;
  if (h === 'move') {
    const dx = cl(px - start.x, -orig.x, W - x2);
    const dy = cl(py - start.y, -orig.y, H - y2);
    x1 += dx; x2 += dx; y1 += dy; y2 += dy;
  } else {
    if (h.includes('w')) x1 = cl(px, 0, x2 - min);
    if (h.includes('e')) x2 = cl(px, x1 + min, W);
    if (h.includes('n')) y1 = cl(py, 0, y2 - min);
    if (h.includes('s')) y2 = cl(py, y1 + min, H);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
