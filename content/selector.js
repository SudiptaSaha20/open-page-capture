// Area selection overlay. Selection is stored in document coordinates, so the page can be
// scrolled (wheel, keyboard, or by dragging near an edge) while the selection grows.
(() => {
  if (window.__opcSelector) { window.__opcSelector.start(); return; }

  const ACCENT = '#2f5bff';
  const css = (node, text) => { node.style.cssText = text; return node; };
  const mk = (tag, style, text) => {
    const n = document.createElement(tag);
    css(n, style);
    if (text) n.textContent = text;
    return n;
  };

  const host = mk('div', 'all:initial;position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;');
  host.id = '__opc-selector-host';
  const root = host.attachShadow({ mode: 'closed' });

  const FONT = 'font:13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;';
  const overlay = mk('div', 'position:absolute;inset:0;cursor:crosshair;background:rgba(0,0,0,.22);touch-action:none;');
  const box = mk('div', 'position:absolute;display:none;box-sizing:border-box;border:2px solid ' + ACCENT + ';box-shadow:0 0 0 100vmax rgba(0,0,0,.5);pointer-events:none;');
  const label = mk('div', 'position:absolute;display:none;pointer-events:none;background:#15181e;color:#fff;padding:3px 8px;border-radius:5px;' + FONT);
  const hint = mk('div', 'position:absolute;left:50%;top:14px;transform:translateX(-50%);background:#15181e;color:#fff;padding:8px 14px;border-radius:9px;pointer-events:none;' + FONT,
    'Drag to select. Scroll or drag near an edge to extend. Esc to cancel.');
  const bar = mk('div', 'position:absolute;display:none;gap:6px;padding:6px;background:#fff;border:1px solid #cdd2db;border-radius:10px;');
  const btnCss = 'height:30px;padding:0 14px;border-radius:7px;cursor:pointer;' + FONT + 'font-weight:600;';
  const okBtn = mk('button', btnCss + 'border:1px solid ' + ACCENT + ';background:' + ACCENT + ';color:#fff;', 'Capture');
  const noBtn = mk('button', btnCss + 'border:1px solid #cdd2db;background:#fff;color:#15181e;', 'Cancel');
  bar.append(okBtn, noBtn);
  root.append(overlay, box, label, hint, bar);

  let anchor = null;   // {x,y} document coordinates
  let cur = null;      // {x,y} document coordinates
  let last = { x: 0, y: 0 }; // last pointer position in client coordinates
  let dragging = false;
  let hasSel = false;
  let raf = 0;

  const docSize = () => {
    const d = document.documentElement;
    return { w: Math.max(d.scrollWidth, innerWidth), h: Math.max(d.scrollHeight, innerHeight) };
  };

  function normRect() {
    const { w, h } = docSize();
    const x1 = Math.max(0, Math.min(anchor.x, cur.x)), y1 = Math.max(0, Math.min(anchor.y, cur.y));
    const x2 = Math.min(w, Math.max(anchor.x, cur.x)), y2 = Math.min(h, Math.max(anchor.y, cur.y));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function render() {
    if (!anchor || !cur) return;
    const r = normRect();
    const left = r.x - scrollX, top = r.y - scrollY;
    box.style.display = 'block';
    box.style.left = left + 'px'; box.style.top = top + 'px';
    box.style.width = r.w + 'px'; box.style.height = r.h + 'px';
    label.style.display = 'block';
    label.textContent = Math.round(r.w) + ' \u00d7 ' + Math.round(r.h);
    label.style.left = Math.max(4, left) + 'px';
    label.style.top = Math.max(4, top - 28) + 'px';
    if (hasSel && !dragging) {
      bar.style.display = 'flex';
      const bw = 170;
      bar.style.left = Math.min(Math.max(4, left + r.w - bw), innerWidth - bw - 4) + 'px';
      const below = top + r.h + 10;
      bar.style.top = (below + 50 < innerHeight ? below : Math.max(8, Math.min(top + r.h - 50, innerHeight - 52))) + 'px';
    } else {
      bar.style.display = 'none';
    }
  }

  const pointerDoc = (e) => ({ x: e.clientX + scrollX, y: e.clientY + scrollY });

  function tick() {
    raf = 0;
    if (!dragging) return;
    const edge = 56, max = 28;
    let dx = 0, dy = 0;
    if (last.y < edge) dy = -Math.ceil(max * (1 - last.y / edge));
    else if (last.y > innerHeight - edge) dy = Math.ceil(max * (1 - (innerHeight - last.y) / edge));
    if (last.x < edge) dx = -Math.ceil(max * (1 - last.x / edge));
    else if (last.x > innerWidth - edge) dx = Math.ceil(max * (1 - (innerWidth - last.x) / edge));
    if (dx || dy) {
      window.scrollBy(dx, dy);
      cur = { x: last.x + scrollX, y: last.y + scrollY };
      render();
    }
    raf = requestAnimationFrame(tick);
  }

  overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    overlay.setPointerCapture(e.pointerId);
    anchor = pointerDoc(e); cur = anchor; last = { x: e.clientX, y: e.clientY };
    dragging = true; hasSel = false;
    overlay.style.background = 'transparent';
    hint.style.display = 'none';
    bar.style.display = 'none';
    render();
    if (!raf) raf = requestAnimationFrame(tick);
  });
  overlay.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    last = { x: e.clientX, y: e.clientY };
    cur = pointerDoc(e);
    render();
  });
  overlay.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    try { overlay.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const r = normRect();
    if (r.w < 8 || r.h < 8) {
      anchor = cur = null; hasSel = false;
      box.style.display = 'none'; label.style.display = 'none'; bar.style.display = 'none';
      overlay.style.background = 'rgba(0,0,0,.22)'; hint.style.display = 'block';
    } else {
      hasSel = true; render();
    }
  });
  // Wheel events fall through to the page (the overlay is not scrollable), which scrolls the window.
  window.addEventListener('scroll', () => {
    if (!anchor) return;
    if (dragging) cur = { x: last.x + scrollX, y: last.y + scrollY };
    render();
  }, { passive: true });

  function cleanup() {
    dragging = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener('keydown', onKey, true);
    host.remove();
  }
  function confirm() {
    if (!hasSel) return;
    const rect = normRect();
    cleanup();
    chrome.runtime.sendMessage({ type: 'selection', rect });
  }
  function cancel() {
    cleanup();
    chrome.runtime.sendMessage({ type: 'selectionCancel' });
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
    else if (e.key === 'Enter' && hasSel) { e.preventDefault(); e.stopPropagation(); confirm(); }
  }
  okBtn.addEventListener('click', confirm);
  noBtn.addEventListener('click', cancel);

  function start() {
    anchor = cur = null; hasSel = false; dragging = false;
    box.style.display = 'none'; label.style.display = 'none'; bar.style.display = 'none';
    overlay.style.background = 'rgba(0,0,0,.22)'; hint.style.display = 'block';
    (document.documentElement || document.body).append(host);
    window.addEventListener('keydown', onKey, true);
  }

  window.__opcSelector = { start, cancel };
  start();
})();
