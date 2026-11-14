import '../lib/theme.js';
import { $, $$, el, toast, clamp } from '../lib/util.js';
import { hydrateIcons } from '../lib/icons.js';
import * as db from '../lib/db.js';
import { loadKeymap } from '../lib/shortcuts.js';
import { createReadableCanvas, readPixels } from '../lib/canvas.js';
import { normBox, bboxOf, hitTest, handlesOf, applyHandle, translate, cropHit, cropCursor, cropDrag } from './geometry.js';

hydrateIcons();

const id = new URLSearchParams(location.search).get('id');
const cv = $('#cv'), ctx = cv.getContext('2d');
const stage = $('#stage'), wrap = $('#wrap'), ta = $('#textInput');
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const ACCENT = '#2f5bff';
const SWATCHES = ['#e5372c', '#f57c00', '#ffd400', '#1fa35b', '#2f5bff', '#8a4fff', '#15181e', '#ffffff'];
const NAMES = { select: 'Select', pen: 'Pen', hl: 'Highlighter', line: 'Line', arrow: 'Arrow', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text', pix: 'Blur / pixelate', crop: 'Crop' };
const HINTS = {
  select: 'Click an annotation to move it. Drag a handle to resize. Double-click text to edit. Delete removes it.',
  pen: 'Drag to draw freehand.',
  hl: 'Drag over text to highlight it.',
  line: 'Drag to draw. Hold Shift for a straight 45° angle.',
  arrow: 'Drag from the tail to the point. Hold Shift to snap the angle.',
  rect: 'Drag to draw. Hold Shift for a square.',
  ellipse: 'Drag to draw. Hold Shift for a circle.',
  text: 'Click where the text should go, type, then click away. Ctrl+Enter also finishes.',
  pix: 'Drag over what you want to hide.',
  crop: 'Drag the area to keep, then Apply (Enter).'
};

let rec = null;
let origLinks = [];
let base = null;           // current base image canvas
let objs = [];             // annotation objects, in paint order
let sel = -1;
let tool = 'select';
let zoom = 1;
let fitZoom = 1;
let draft = null;          // object being drawn
let drag = null;
let cropRect = null;
let textEdit = null;
const style = { color: '#e5372c', fill: false, mode: 'pixelate' };
const sizes = { pen: 4, hl: 5, line: 4, arrow: 4, rect: 4, ellipse: 4, text: 30, pix: 14 };

// ---------- history ----------
let hist = [];
let hi = -1;
let verCounter = 0;
let savedV = 0;   // version of the state that is stored in the library
const clone = (v) => structuredClone(v);
function snapshot() {
  hist = hist.slice(0, hi + 1);
  hist.push({ objs: clone(objs), base, v: ++verCounter });
  if (hist.length > 80) hist.shift();
  hi = hist.length - 1;
  updateUndo();
}
function restore(i) {
  commitText();
  hi = i;
  const s = hist[i];
  objs = clone(s.objs);
  if (s.base !== base) setBase(s.base);
  sel = -1;
  resetCrop();
  syncPanel(); render(); updateUndo();
}
function updateUndo() {
  $('#undoBtn').disabled = hi <= 0;
  $('#redoBtn').disabled = hi >= hist.length - 1;
  updateSavedUi();
}
const dirty = () => !!hist[hi] && hist[hi].v !== savedV;
function updateSavedUi() {
  const d = dirty();
  $('#savedState').textContent = d ? 'Unsaved changes' : 'All changes saved';
  $('#savedState').classList.toggle('dirty', d);
  $('#saveBtn').disabled = !d;
}

// ---------- drawing ----------
const scratch = document.createElement('canvas').getContext('2d');
function measure(o) {
  scratch.font = `600 ${o.size}px ${FONT}`;
  const lines = o.text.split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, scratch.measureText(l).width);
  return { w: Math.max(w, 10), h: lines.length * o.size * 1.25 };
}

function drawPix(c, o) {
  const W = c.canvas.width, H = c.canvas.height;
  const x = Math.max(0, Math.floor(o.x)), y = Math.max(0, Math.floor(o.y));
  const x2 = Math.min(W, Math.ceil(o.x + o.w)), y2 = Math.min(H, Math.ceil(o.y + o.h));
  const w = x2 - x, h = y2 - y;
  if (w < 2 || h < 2) return;
  if (o.mode === 'blur') {
    const pad = Math.ceil(o.strength * 2);
    const sx = Math.max(0, x - pad), sy = Math.max(0, y - pad), ex = Math.min(W, x2 + pad), ey = Math.min(H, y2 + pad);
    const { c: tmp, x: tx } = createReadableCanvas(ex - sx, ey - sy);
    tx.drawImage(c.canvas, sx, sy, tmp.width, tmp.height, 0, 0, tmp.width, tmp.height);
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.filter = `blur(${o.strength}px)`;
    c.drawImage(tmp, sx, sy);
    c.restore();
    return;
  }
  // Pixelate: exact block averages, which cannot be reversed. Pixels are read from a scratch
  // canvas created for readback, not from the (GPU-backed) display canvas.
  const bs = Math.max(2, Math.round(o.strength));
  const { c: tmp, x: t } = createReadableCanvas(w, h);
  t.drawImage(c.canvas, x, y, w, h, 0, 0, w, h);
  const img = readPixels(tmp, 0, 0, w, h);
  const d = img.data;
  for (let by = 0; by < h; by += bs) {
    for (let bx = 0; bx < w; bx += bs) {
      const bw = Math.min(bs, w - bx), bh = Math.min(bs, h - by);
      let r = 0, g = 0, b = 0;
      for (let yy = 0; yy < bh; yy++) {
        let p = ((by + yy) * w + bx) * 4;
        for (let xx = 0; xx < bw; xx++, p += 4) { r += d[p]; g += d[p + 1]; b += d[p + 2]; }
      }
      const n = bw * bh;
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      for (let yy = 0; yy < bh; yy++) {
        let p = ((by + yy) * w + bx) * 4;
        for (let xx = 0; xx < bw; xx++, p += 4) { d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255; }
      }
    }
  }
  t.putImageData(img, 0, 0);
  c.drawImage(tmp, x, y);
}

function drawObj(c, o) {
  c.save();
  switch (o.type) {
    case 'pen': case 'hl': {
      c.lineCap = 'round'; c.lineJoin = 'round';
      c.strokeStyle = o.color; c.lineWidth = o.w;
      if (o.type === 'hl') c.globalAlpha = 0.38;
      const p = o.pts;
      c.beginPath();
      c.moveTo(p[0][0], p[0][1]);
      if (p.length === 1) c.lineTo(p[0][0] + 0.01, p[0][1]);
      for (let i = 1; i < p.length - 1; i++) {
        c.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
      }
      if (p.length > 1) c.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      c.stroke();
      break;
    }
    case 'line': case 'arrow': {
      c.lineCap = 'round'; c.strokeStyle = o.color; c.fillStyle = o.color; c.lineWidth = o.w;
      const a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
      const L = Math.max(12, o.w * 3.6);
      const len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
      const cut = o.type === 'arrow' && len > L * 0.8 ? L * 0.7 : 0;
      c.beginPath();
      c.moveTo(o.x1, o.y1);
      c.lineTo(o.x2 - Math.cos(a) * cut, o.y2 - Math.sin(a) * cut);
      c.stroke();
      if (o.type === 'arrow') {
        c.beginPath();
        c.moveTo(o.x2, o.y2);
        c.lineTo(o.x2 - L * Math.cos(a - 0.42), o.y2 - L * Math.sin(a - 0.42));
        c.lineTo(o.x2 - L * Math.cos(a + 0.42), o.y2 - L * Math.sin(a + 0.42));
        c.closePath();
        c.fill();
      }
      break;
    }
    case 'rect':
      if (o.fill) { c.fillStyle = o.color; c.fillRect(o.x, o.y, o.w, o.h); }
      else { c.strokeStyle = o.color; c.lineWidth = o.sw; c.lineJoin = 'round'; c.strokeRect(o.x, o.y, o.w, o.h); }
      break;
    case 'ellipse':
      c.beginPath();
      c.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.max(0.5, o.w / 2), Math.max(0.5, o.h / 2), 0, 0, Math.PI * 2);
      if (o.fill) { c.fillStyle = o.color; c.fill(); }
      else { c.strokeStyle = o.color; c.lineWidth = o.sw; c.stroke(); }
      break;
    case 'text': {
      c.font = `600 ${o.size}px ${FONT}`;
      c.textBaseline = 'top';
      c.fillStyle = o.color;
      o.text.split('\n').forEach((line, i) => c.fillText(line, o.x, o.y + i * o.size * 1.25));
      break;
    }
    case 'pix':
      drawPix(c, o);
      break;
    default:
  }
  c.restore();
}

// Blur/pixelate read back pixels. Reading them from the visible (GPU-backed) canvas triggers
// Chrome's "willReadFrequently" warning and is slow, so whenever such an annotation exists the
// picture is composed on a CPU-backed work canvas first and then copied to the screen.
let work = null, workCtx = null;
function getWork() {
  if (!work || work.width !== base.width || work.height !== base.height) {
    ({ c: work, x: workCtx } = createReadableCanvas(base.width, base.height));
  }
  workCtx.clearRect(0, 0, work.width, work.height);
  return workCtx;
}

function paint() {
  if (!base) return;
  const hidden = (i) => textEdit && textEdit.idx === i;
  const usesPix = objs.some((o, i) => o.type === 'pix' && !hidden(i));
  const t = usesPix ? getWork() : ctx;
  if (!usesPix) ctx.clearRect(0, 0, cv.width, cv.height);
  t.drawImage(base, 0, 0);
  objs.forEach((o, i) => { if (!hidden(i)) drawObj(t, o); });
  if (draft && draft.type !== 'pix') drawObj(t, draft);
  if (usesPix) { ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(work, 0, 0); }
  if (draft && draft.type === 'pix') {
    ctx.save(); ctx.setLineDash([6 / zoom, 4 / zoom]); ctx.lineWidth = 1.5 / zoom; ctx.strokeStyle = ACCENT;
    ctx.strokeRect(draft.x, draft.y, draft.w, draft.h); ctx.restore();
  }
  if (sel >= 0 && objs[sel] && !(textEdit && textEdit.idx === sel)) {
    const o = objs[sel], b = bboxOf(o, measure);
    ctx.save();
    ctx.setLineDash([6 / zoom, 4 / zoom]); ctx.lineWidth = 1.5 / zoom; ctx.strokeStyle = ACCENT;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    const s = 10 / zoom;
    for (const h of handlesOf(o)) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(h.x - s / 2, h.y - s / 2, s, s);
      ctx.strokeRect(h.x - s / 2, h.y - s / 2, s, s);
    }
    ctx.restore();
  }
  if (cropRect) {
    const { x, y, w, h } = cropRect, W = cv.width, H = cv.height;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(0, 0, W, y); ctx.fillRect(0, y + h, W, H - y - h);
    ctx.fillRect(0, y, x, h); ctx.fillRect(x + w, y, W - x - w, h);
    const u = 1 / zoom;
    // thirds guides
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1 * u;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(x + (w * i) / 3, y); ctx.lineTo(x + (w * i) / 3, y + h);
      ctx.moveTo(x, y + (h * i) / 3); ctx.lineTo(x + w, y + (h * i) / 3);
    }
    ctx.stroke();
    // frame
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * u;
    ctx.strokeRect(x, y, w, h);
    // handles: corners as brackets, edges as bars
    ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1 * u;
    const L = Math.min(22 * u, w / 3, h / 3), T = 5 * u;
    const bars = [
      [x - T / 2, y - T / 2, L, T], [x - T / 2, y - T / 2, T, L],
      [x + w - L + T / 2, y - T / 2, L, T], [x + w - T / 2, y - T / 2, T, L],
      [x - T / 2, y + h - T / 2, L, T], [x - T / 2, y + h - L + T / 2, T, L],
      [x + w - L + T / 2, y + h - T / 2, L, T], [x + w - T / 2, y + h - L + T / 2, T, L],
      [x + w / 2 - L / 2, y - T / 2, L, T], [x + w / 2 - L / 2, y + h - T / 2, L, T],
      [x - T / 2, y + h / 2 - L / 2, T, L], [x + w - T / 2, y + h / 2 - L / 2, T, L]
    ];
    for (const [bx, by, bw, bh] of bars) { ctx.fillRect(bx, by, bw, bh); ctx.strokeRect(bx, by, bw, bh); }
    ctx.restore();
  }
}
let raf = 0;
function render() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; paint(); });
}

function flatten() {
  const { c, x } = createReadableCanvas(base.width, base.height);
  x.drawImage(base, 0, 0);
  objs.forEach((o) => drawObj(x, o));
  return c;
}

// ---------- base / zoom ----------
function setBase(c) {
  base = c;
  cv.width = c.width; cv.height = c.height;
  applyZoom(zoom);
}
function applyZoom(z) {
  zoom = clamp(z, 0.03, 6);
  cv.style.width = Math.round(base.width * zoom) + 'px';
  cv.style.height = Math.round(base.height * zoom) + 'px';
  $('#zoomPct').textContent = Math.round(zoom * 100) + '%';
  render();
}
function fit() {
  fitZoom = Math.min(1, (wrap.clientWidth - 60) / base.width);
  applyZoom(fitZoom);
  wrap.scrollTop = 0;
}
function pt(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) };
}

// ---------- selection helpers ----------
function findObj(p) {
  const tol = 6 / zoom;
  for (let i = objs.length - 1; i >= 0; i--) if (hitTest(objs[i], p.x, p.y, tol, measure)) return i;
  return -1;
}
function hitHandle(o, p) {
  const r = 9 / zoom;
  for (const h of handlesOf(o)) if (Math.abs(p.x - h.x) <= r && Math.abs(p.y - h.y) <= r) return h.k;
  return null;
}

function getSize(o) {
  switch (o.type) {
    case 'hl': return Math.round(o.w / 4);
    case 'pen': case 'line': case 'arrow': return o.w;
    case 'rect': case 'ellipse': return o.sw;
    case 'text': return o.size;
    case 'pix': return o.strength;
    default: return 4;
  }
}
function setSize(o, v) {
  switch (o.type) {
    case 'hl': o.w = v * 4; break;
    case 'pen': case 'line': case 'arrow': o.w = v; break;
    case 'rect': case 'ellipse': o.sw = v; break;
    case 'text': o.size = v; break;
    case 'pix': o.strength = v; break;
    default:
  }
}

// ---------- tool panel ----------
const kindNow = () => (sel >= 0 && objs[sel] ? objs[sel].type : tool);
const COLOR_KINDS = ['pen', 'hl', 'line', 'arrow', 'rect', 'ellipse', 'text'];
const SIZE_KINDS = ['pen', 'hl', 'line', 'arrow', 'rect', 'ellipse', 'text', 'pix'];

function syncPanel() {
  const k = kindNow();
  const o = sel >= 0 ? objs[sel] : null;
  $('#propTitle').textContent = NAMES[k] || 'Select';
  $('#fColor').classList.toggle('hidden', !COLOR_KINDS.includes(k));
  $('#fSize').classList.toggle('hidden', !SIZE_KINDS.includes(k));
  $('#fFill').classList.toggle('hidden', !(k === 'rect' || k === 'ellipse'));
  $('#fPix').classList.toggle('hidden', k !== 'pix');
  $('#fDelete').classList.toggle('hidden', !o);
  $('#fCrop').classList.toggle('hidden', k !== 'crop');
  $('#toolHint').textContent = o ? 'Drag to move. Press Delete to remove.' : (HINTS[tool] || '');

  const range = $('#size');
  const [min, max, label] = k === 'text' ? [10, 120, 'Text size'] : k === 'pix' ? [4, 48, 'Strength'] : k === 'hl' ? [2, 14, 'Thickness'] : [1, 24, 'Thickness'];
  range.min = min; range.max = max;
  $('#sizeLabel').textContent = label;
  const cur = o ? getSize(o) : sizes[k] || 4;
  range.value = cur; $('#sizeOut').textContent = Math.round(cur);

  const color = o && o.color ? o.color : style.color;
  $$('#swatches button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.c.toLowerCase() === color.toLowerCase())));
  $('#colorInput').value = color;
  $('#fill').checked = o && 'fill' in o ? !!o.fill : style.fill;
  const mode = o && o.type === 'pix' ? o.mode : style.mode;
  $$('#fPix [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
}

function resetCrop() {
  cropRect = tool === 'crop' && base ? { x: 0, y: 0, w: base.width, h: base.height } : null;
  updateCropInfo();
}
function updateCropInfo() {
  if (!cropRect) return;
  $('#cropInfo').textContent = `${Math.round(cropRect.w)} × ${Math.round(cropRect.h)} px`;
  const full = cropRect.x === 0 && cropRect.y === 0 && Math.round(cropRect.w) === base.width && Math.round(cropRect.h) === base.height;
  $('#cropApply').disabled = full;
  $('#cropReset').disabled = full;
}

function setTool(t) {
  commitText();
  tool = t;
  sel = -1; draft = null;
  cv.style.cursor = '';
  resetCrop();
  $$('#tools button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  stage.classList.toggle('select', t === 'select');
  syncPanel(); render();
}

function applyProp(fn, final) {
  if (sel >= 0 && objs[sel]) fn(objs[sel]);
  render();
  if (final && sel >= 0) snapshot();
}

// swatches
const sw = $('#swatches');
SWATCHES.forEach((c) => sw.append(el('button', {
  type: 'button', dataset: { c }, style: `background:${c}`, 'aria-label': 'Colour ' + c,
  onclick: () => { style.color = c; applyProp((o) => { if (o.color) o.color = c; }, true); syncPanel(); }
})));
$('#colorInput').addEventListener('input', (e) => { style.color = e.target.value; applyProp((o) => { if (o.color) o.color = e.target.value; }, false); });
$('#colorInput').addEventListener('change', () => { applyProp(() => {}, true); syncPanel(); });
$('#size').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  $('#sizeOut').textContent = v;
  const k = kindNow();
  if (sizes[k] != null) sizes[k] = v;
  applyProp((o) => setSize(o, v), false);
});
$('#size').addEventListener('change', () => applyProp(() => {}, true));
$('#fill').addEventListener('change', (e) => { style.fill = e.target.checked; applyProp((o) => { if ('fill' in o) o.fill = style.fill; }, true); });
$$('#fPix [data-mode]').forEach((b) => b.addEventListener('click', () => {
  style.mode = b.dataset.mode;
  applyProp((o) => { if (o.type === 'pix') o.mode = style.mode; }, true);
  syncPanel();
}));
$('#deleteObj').addEventListener('click', deleteSelected);
$$('#tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

function deleteSelected() {
  if (sel < 0) return;
  objs.splice(sel, 1);
  sel = -1;
  snapshot(); syncPanel(); render();
}

// ---------- text editing ----------
function openText(p, idx) {
  const o = idx >= 0 ? objs[idx] : null;
  const size = o ? o.size : sizes.text;
  textEdit = { x: p.x, y: p.y, idx };
  ta.value = o ? o.text : '';
  ta.style.left = p.x * zoom + 'px';
  ta.style.top = p.y * zoom + 'px';
  ta.style.fontSize = size * zoom + 'px';
  ta.style.color = o ? o.color : style.color;
  ta.style.width = '140px';
  ta.style.height = size * 1.25 * zoom + 'px';
  ta.classList.remove('hidden');
  setTimeout(() => { ta.focus(); autosize(); }, 0);
  render();
}
function autosize() {
  ta.style.width = Math.max(140, ta.scrollWidth + 12) + 'px';
  ta.style.height = ta.scrollHeight + 'px';
}
function commitText() {
  if (!textEdit) return;
  const e = textEdit;
  const v = ta.value.replace(/\s+$/, '');
  textEdit = null;
  ta.classList.add('hidden');
  ta.value = '';
  if (e.idx >= 0) {
    if (!v) { objs.splice(e.idx, 1); sel = -1; snapshot(); }
    else if (objs[e.idx].text !== v) { objs[e.idx].text = v; snapshot(); }
  } else if (v) {
    objs.push({ type: 'text', x: e.x, y: e.y, text: v, color: style.color, size: sizes.text });
    snapshot();
  }
  syncPanel(); render();
}
ta.addEventListener('input', autosize);
ta.addEventListener('blur', commitText);
ta.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') { textEdit = null; ta.classList.add('hidden'); ta.value = ''; render(); }
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitText(); }
});

// ---------- pointer interaction ----------
function shapeFrom(t, x1, y1, x2, y2, shift) {
  if (shift) {
    if (t === 'line' || t === 'arrow') {
      const a = Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 4)) * (Math.PI / 4);
      const d = Math.hypot(x2 - x1, y2 - y1);
      x2 = x1 + Math.cos(a) * d; y2 = y1 + Math.sin(a) * d;
    } else {
      const s = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      x2 = x1 + Math.sign(x2 - x1 || 1) * s; y2 = y1 + Math.sign(y2 - y1 || 1) * s;
    }
  }
  if (t === 'line' || t === 'arrow') return { type: t, x1, y1, x2, y2, w: sizes[t], color: style.color };
  const b = normBox(x1, y1, x2, y2);
  if (t === 'rect' || t === 'ellipse') return { type: t, ...b, sw: sizes[t], fill: style.fill, color: style.color };
  return { type: 'pix', ...b, mode: style.mode, strength: sizes.pix };
}

cv.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const p = pt(e);
  if (tool === 'text') { commitText(); openText(p, -1); return; }
  e.preventDefault();
  commitText();
  cv.setPointerCapture(e.pointerId);

  if (tool === 'select') {
    if (sel >= 0 && objs[sel]) {
      const k = hitHandle(objs[sel], p);
      if (k) { drag = { kind: 'handle', k, orig: clone(objs[sel]), moved: false }; return; }
    }
    sel = findObj(p);
    if (sel >= 0) drag = { kind: 'move', start: p, orig: clone(objs[sel]), moved: false };
    syncPanel(); render();
  } else if (tool === 'crop') {
    const h = cropRect ? cropHit(cropRect, p.x, p.y, 12 / zoom) : null;
    if (h) drag = { kind: 'crop', h, orig: { ...cropRect }, start: p };
  } else if (tool === 'pen' || tool === 'hl') {
    draft = { type: tool, pts: [[p.x, p.y]], color: style.color, w: tool === 'hl' ? sizes.hl * 4 : sizes.pen };
    drag = { kind: 'draw' };
  } else {
    drag = { kind: 'shape', x: p.x, y: p.y };
    draft = shapeFrom(tool, p.x, p.y, p.x, p.y, false);
  }
});

cv.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (tool === 'crop' && cropRect) { const q = pt(e); cv.style.cursor = cropCursor(cropHit(cropRect, q.x, q.y, 12 / zoom)); }
    return;
  }
  const p = pt(e);
  if (drag.kind === 'draw') {
    const last = draft.pts[draft.pts.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) >= 1) draft.pts.push([p.x, p.y]);
  } else if (drag.kind === 'shape') {
    draft = shapeFrom(tool, drag.x, drag.y, p.x, p.y, e.shiftKey);
  } else if (drag.kind === 'move') {
    objs[sel] = clone(drag.orig);
    translate(objs[sel], p.x - drag.start.x, p.y - drag.start.y);
    drag.moved = true;
  } else if (drag.kind === 'handle') {
    objs[sel] = clone(drag.orig);
    applyHandle(objs[sel], drag.orig, drag.k, p.x, p.y);
    drag.moved = true;
  } else if (drag.kind === 'crop') {
    cropRect = cropDrag(drag.h, drag.orig, drag.start, p.x, p.y, base.width, base.height);
    updateCropInfo();
  }
  render();
});

function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  if (d.kind === 'draw') {
    if (draft && draft.pts.length) objs.push(draft);
    draft = null; snapshot();
  } else if (d.kind === 'shape') {
    const o = draft; draft = null;
    const tiny = o.type === 'line' || o.type === 'arrow' ? Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 4 : o.w < 4 || o.h < 4;
    if (!tiny) { objs.push(o); snapshot(); }
  } else if (d.kind === 'move' || d.kind === 'handle') {
    if (d.moved) snapshot();
  }
  syncPanel(); render();
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

cv.addEventListener('dblclick', (e) => {
  if (tool !== 'select') return;
  const i = findObj(pt(e));
  if (i >= 0 && objs[i].type === 'text') { sel = i; openText({ x: objs[i].x, y: objs[i].y }, i); }
});

// ---------- crop ----------
function cancelCrop() { setTool('select'); }
function applyCrop() {
  if (!cropRect || cropRect.w < 4 || cropRect.h < 4) return;
  const x = clamp(Math.round(cropRect.x), 0, base.width - 1), y = clamp(Math.round(cropRect.y), 0, base.height - 1);
  const w = clamp(Math.round(cropRect.w), 1, base.width - x), h = clamp(Math.round(cropRect.h), 1, base.height - y);
  if (x === 0 && y === 0 && w === base.width && h === base.height) { toast('Drag the edges inwards first.'); return; }
  const nb = document.createElement('canvas');
  nb.width = w; nb.height = h;
  nb.getContext('2d').drawImage(base, x, y, w, h, 0, 0, w, h);
  const off = base.__off || { x: 0, y: 0 };
  nb.__off = { x: off.x + x, y: off.y + y };
  objs.forEach((o) => translate(o, -x, -y));
  sel = -1;
  setBase(nb);
  snapshot();
  setTool('select');
  toast(`Cropped to ${w}×${h}`);
}
$('#cropApply').addEventListener('click', applyCrop);
$('#cropCancel').addEventListener('click', cancelCrop);
$('#cropReset').addEventListener('click', () => { resetCrop(); render(); });

// ---------- save / leave ----------
function confirmDialog(title, text, okLabel) {
  return new Promise((resolve) => {
    const done = (v) => { back.remove(); resolve(v); };
    const back = el('div', { class: 'dialog-back', onclick: (e) => { if (e.target === back) done(false); } },
      el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
        el('h3', {}, title), el('p', {}, text),
        el('div', { class: 'row' },
          el('button', { class: 'btn', onclick: () => done(false) }, 'Keep editing'),
          el('button', { class: 'btn primary', onclick: () => done(true) }, okLabel))));
    document.body.append(back);
    back.querySelector('.btn.primary').focus();
  });
}

const viewerUrl = () => chrome.runtime.getURL('viewer/viewer.html?id=' + id);
async function leave() {
  commitText();
  if (dirty() && !(await confirmDialog('Discard your changes?', 'Edits you haven’t saved will be lost.', 'Discard'))) return;
  window.removeEventListener('beforeunload', warn);
  location.href = viewerUrl();
}
function warn(e) { if (dirty()) { e.preventDefault(); e.returnValue = ''; } }
window.addEventListener('beforeunload', warn);

function makeThumb(canvas) {
  const sc = Math.min(1, 520 / canvas.width);
  const sh = Math.min(canvas.height, Math.round(360 / sc));
  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(canvas.width * sc));
  t.height = Math.max(1, Math.round(sh * sc));
  const x = t.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(canvas, 0, 0, canvas.width, sh, 0, 0, t.width, t.height);
  return new Promise((r) => t.toBlob(r, 'image/jpeg', 0.8));
}

let saving = false;
// Writes the flattened image back to the library and stays in the editor.
async function save() {
  commitText();
  if (!dirty() || saving) return !dirty();
  saving = true;
  $('#saveBtn').disabled = true;
  try {
    const v = hist[hi].v;
    const flat = flatten();
    const blob = await new Promise((r, j) => flat.toBlob((b) => (b ? r(b) : j(new Error('Could not encode the image.'))), 'image/png'));
    const thumb = await makeThumb(flat);
    const off = base.__off || { x: 0, y: 0 };
    const links = [];
    for (const l of origLinks) {
      let x = l.x - off.x, y = l.y - off.y, w = l.w, h = l.h;
      if (x < 0) { w += x; x = 0; }
      if (y < 0) { h += y; y = 0; }
      if (x + w > flat.width) w = flat.width - x;
      if (y + h > flat.height) h = flat.height - y;
      if (w >= 2 && h >= 2) links.push({ ...l, x, y, w, h });
    }
    rec = await db.replaceImage(id, blob, { width: flat.width, height: flat.height, thumb, links, edited: true });
    savedV = v;
    toast('Changes saved');
    return true;
  } catch (err) {
    toast(err && err.message ? err.message : 'Could not save your changes.', 'error', 6000);
    return false;
  } finally {
    saving = false;
    updateSavedUi();
  }
}

async function done() {
  if (await save()) {
    window.removeEventListener('beforeunload', warn);
    location.href = viewerUrl();
  }
}

// Ctrl+C copies the SAVED image, so it only works once changes are saved.
async function copySaved() {
  commitText();
  if (dirty()) { toast('Save your changes first, then copy.', 'error', 4000); return; }
  try {
    const blob = await db.getImage(id);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Copied to clipboard');
  } catch (err) {
    toast('Could not copy this image (it may be too large for the clipboard).', 'error', 5000);
  }
}

// ---------- events ----------
$('#backBtn').addEventListener('click', leave);
$('#saveBtn').addEventListener('click', save);
$('#doneBtn').addEventListener('click', done);
$('#undoBtn').addEventListener('click', () => { if (hi > 0) restore(hi - 1); });
$('#redoBtn').addEventListener('click', () => { if (hi < hist.length - 1) restore(hi + 1); });
$('#zoomIn').addEventListener('click', () => applyZoom(zoom * 1.25));
$('#zoomOut').addEventListener('click', () => applyZoom(zoom * 0.8));
$('#zoomFit').addEventListener('click', fit);
$('#zoomPct').addEventListener('click', () => applyZoom(1));
wrap.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9));
}, { passive: false });

let keys = null;
const TOOL_TITLES = { select: 'Select and move', pen: 'Pen', hl: 'Highlighter', line: 'Line', arrow: 'Arrow', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text', pix: 'Blur or pixelate', crop: 'Crop' };
function applyHints() {
  if (!keys) return;
  $$('#tools button[data-tool]').forEach((b) => { b.title = TOOL_TITLES[b.dataset.tool] + keys.hint('editor.tool.' + b.dataset.tool); });
  const set = (sel, text, id) => { const b = $(sel); if (b) b.title = text + keys.hint(id); };
  set('#undoBtn', 'Undo', 'editor.undo');
  set('#redoBtn', 'Redo', 'editor.redo');
  set('#saveBtn', 'Save changes', 'editor.save');
  set('#doneBtn', 'Save and go back', 'editor.done');
  set('#zoomIn', 'Zoom in', 'editor.zoomIn');
  set('#zoomOut', 'Zoom out', 'editor.zoomOut');
  set('#zoomFit', 'Fit to width', 'editor.zoomFit');
}

function runAction(a) {
  switch (a) {
    case 'editor.save': save(); break;
    case 'editor.done': done(); break;
    case 'editor.copy': copySaved(); break;
    case 'editor.undo': if (hi > 0) restore(hi - 1); break;
    case 'editor.redo': if (hi < hist.length - 1) restore(hi + 1); break;
    case 'editor.delete': if (sel >= 0) deleteSelected(); break;
    case 'editor.zoomIn': applyZoom(zoom * 1.25); break;
    case 'editor.zoomOut': applyZoom(zoom * 0.8); break;
    case 'editor.zoomFit': fit(); break;
    default:
      if (a.startsWith('editor.tool.')) setTool(a.slice('editor.tool.'.length));
  }
}

document.addEventListener('keydown', (e) => {
  if (!keys || e.target.closest('input,textarea,select') || document.querySelector('.dialog-back')) return;
  const mod = e.ctrlKey || e.metaKey;
  // Fixed keys (not configurable)
  if (e.key === 'Escape') { if (tool === 'crop') cancelCrop(); else if (sel >= 0) { sel = -1; syncPanel(); render(); } return; }
  if (e.key === 'Enter' && !mod && tool === 'crop') { applyCrop(); return; }
  if (!mod && sel >= 0 && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    translate(objs[sel], e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
    snapshot(); render();
    return;
  }
  const a = keys.match(e);
  if (!a) return;
  if (a === 'editor.delete' && sel < 0) return;
  e.preventDefault();
  runAction(a);
});
window.addEventListener('resize', () => { if (base && Math.abs(zoom - fitZoom) < 0.001) fit(); });

// ---------- boot ----------
async function init() {
  if (!id) { location.href = chrome.runtime.getURL('history/history.html'); return; }
  keys = await loadKeymap('editor', applyHints);
  applyHints();
  rec = await db.getCapture(id);
  const blob = rec ? await db.getImage(id) : null;
  if (!rec || !blob) { toast('This capture is no longer available.', 'error'); setTimeout(() => { location.href = chrome.runtime.getURL('history/history.html'); }, 1500); return; }
  $('#title').textContent = rec.title || rec.url;
  origLinks = rec.links || [];
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  setBase(c);
  hist = [{ objs: [], base, v: 0 }];
  hi = 0;
  savedV = 0;
  updateUndo();
  setTool('select');
  fit();
}
init();
