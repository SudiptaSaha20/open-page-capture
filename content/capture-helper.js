// Injected on demand into the page being captured. Exposes window.__opc with the few
// operations the service worker needs: measure, scroll, hide fixed elements, restore.
(() => {
  if (window.__opc) return;

  const st = { scroller: null, mode: 'window', hidden: [], hiddenSet: new Set(), style: null, origin: { x: 0, y: 0 }, rect: null };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // The page normally scrolls the window. Some apps scroll one big inner container instead.
  function findInnerScroller() {
    const vw = innerWidth, vh = innerHeight;
    let best = null, bestScore = 0;
    for (const e of document.querySelectorAll('body *')) {
      if (e.scrollHeight <= e.clientHeight + 40) continue;
      const cs = getComputedStyle(e);
      if (!/(auto|scroll)/.test(cs.overflowY)) continue;
      const r = e.getBoundingClientRect();
      const w = Math.min(r.right, vw) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (w < vw * 0.5 || h < vh * 0.5) continue;
      const score = e.scrollHeight * w;
      if (score > bestScore) { best = e; bestScore = score; }
    }
    return best;
  }

  function scrollPos() {
    return st.mode === 'window'
      ? { x: Math.round(window.scrollX), y: Math.round(window.scrollY) }
      : { x: Math.round(st.scroller.scrollLeft), y: Math.round(st.scroller.scrollTop) };
  }

  function contentSize() {
    if (st.mode === 'window') {
      const d = document.documentElement, b = document.body;
      return {
        w: Math.max(d.scrollWidth, b ? b.scrollWidth : 0),
        h: Math.max(d.scrollHeight, b ? b.scrollHeight : 0)
      };
    }
    return { w: st.scroller.scrollWidth, h: st.scroller.scrollHeight };
  }

  async function waitImages(maxMs) {
    const vw = innerWidth, vh = innerHeight;
    const pending = [];
    for (const img of document.images) {
      const r = img.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
      if (img.loading === 'lazy') img.loading = 'eager';
      if (!(img.complete && img.naturalWidth > 0)) {
        pending.push(new Promise((res) => {
          img.addEventListener('load', res, { once: true });
          img.addEventListener('error', res, { once: true });
        }));
      }
    }
    if (pending.length) await Promise.race([Promise.all(pending), sleep(maxMs)]);
    await Promise.race([
      Promise.all([...document.images].filter((i) => i.complete && i.decode).slice(0, 60).map((i) => i.decode().catch(() => {}))),
      sleep(Math.min(600, maxMs))
    ]);
  }


  // Hides elements that would repeat in every frame. It runs before each frame (not once),
  // because many sites only turn a header fixed/sticky after the page has scrolled.
  //  - position:fixed elements are always hidden.
  //  - position:sticky elements are hidden only while they are stuck to an edge, so sticky
  //    things that are in their natural place (like a table header) stay in the capture.
  // visibility:hidden keeps the layout exactly as the page has it.
  function hideStuck() {
    const root = document.body;
    if (!root) return 0;
    const top0 = st.rect.top, bottom0 = st.rect.top + st.rect.height;
    let n = 0;
    for (const e of root.querySelectorAll('*')) {
      if (st.hiddenSet.has(e)) continue;
      const cs = getComputedStyle(e);
      let hide = false;
      if (cs.position === 'fixed') {
        hide = true;
      } else if (cs.position === 'sticky') {
        const r = e.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const top = parseFloat(cs.top), bottom = parseFloat(cs.bottom);
        hide = (!isNaN(top) && Math.abs(r.top - top0 - top) < 1.5) ||
               (!isNaN(bottom) && Math.abs(bottom0 - r.bottom - bottom) < 1.5);
      }
      if (!hide) continue;
      st.hiddenSet.add(e);
      st.hidden.push([e, e.style.getPropertyValue('visibility'), e.style.getPropertyPriority('visibility')]);
      e.style.setProperty('visibility', 'hidden', 'important');
      n++;
    }
    return n;
  }

  window.__opc = {
    // opts: { forceWindow }
    init(opts = {}) {
      st.hidden = [];
      st.hiddenSet = new Set();
      st.style = document.createElement('style');
      st.style.textContent = 'html,body{scroll-behavior:auto !important;}';
      (document.head || document.documentElement).append(st.style);

      const d = document.documentElement;
      st.mode = 'window';
      st.scroller = null;
      if (!opts.forceWindow && d.scrollHeight <= innerHeight + 2) {
        const s = findInnerScroller();
        if (s) { st.scroller = s; st.mode = 'element'; }
      }

      let rect;
      if (st.mode === 'window') {
        rect = { left: 0, top: 0, width: d.clientWidth, height: d.clientHeight };
      } else {
        const r = st.scroller.getBoundingClientRect();
        const left = Math.max(0, r.left + st.scroller.clientLeft);
        const top = Math.max(0, r.top + st.scroller.clientTop);
        rect = {
          left, top,
          width: Math.min(st.scroller.clientWidth, innerWidth - left),
          height: Math.min(st.scroller.clientHeight, innerHeight - top)
        };
      }
      st.rect = rect;
      st.origin = scrollPos();
      const size = contentSize();
      return {
        mode: st.mode,
        rect,
        contentW: size.w,
        contentH: size.h,
        scroll: st.origin,
        innerW: innerWidth,
        innerH: innerHeight,
        dpr: devicePixelRatio,
        title: document.title,
        url: location.href
      };
    },

    async scrollTo(x, y, opts = {}) {
      if (st.mode === 'window') window.scrollTo(x, y);
      else { st.scroller.scrollLeft = x; st.scroller.scrollTop = y; }
      await raf2();
      if (opts.pauseMs) await sleep(opts.pauseMs);
      if (opts.waitImagesMs) await waitImages(opts.waitImagesMs);
      if (opts.hideFixed && hideStuck()) await raf2();
      const size = contentSize();
      return { scroll: scrollPos(), contentW: size.w, contentH: size.h };
    },

    // Link rectangles in content coordinates (same space as scroll offsets).
    collectLinks() {
      const out = [];
      const sp = scrollPos();
      const ox = st.mode === 'window' ? 0 : st.rect.left;
      const oy = st.mode === 'window' ? 0 : st.rect.top;
      const scope = st.mode === 'window' ? document : st.scroller;
      for (const a of scope.querySelectorAll('a[href]')) {
        const href = a.href;
        if (!/^(https?:|mailto:|tel:)/i.test(href)) continue;
        const r = a.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        out.push({ x: r.left - ox + sp.x, y: r.top - oy + sp.y, w: r.width, h: r.height, href });
        if (out.length >= 4000) break;
      }
      return out;
    },

    cleanup() {
      for (const [e, v, p] of st.hidden) {
        if (v) e.style.setProperty('visibility', v, p);
        else e.style.removeProperty('visibility');
      }
      st.hidden = [];
      st.hiddenSet = new Set();
      if (st.style) { st.style.remove(); st.style = null; }
      if (st.mode === 'window') window.scrollTo(st.origin.x, st.origin.y);
      else if (st.scroller) { st.scroller.scrollLeft = st.origin.x; st.scroller.scrollTop = st.origin.y; }
      return true;
    }
  };
})();
