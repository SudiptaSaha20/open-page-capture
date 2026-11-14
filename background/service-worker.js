// Open Page Capture - service worker.
// Owns the capture pipeline (scroll, screenshot, stitch), saving to IndexedDB, batch capture,
// expiry cleanup, and the bridge to the offscreen document used for PDF/OCR/GIF exports.

import { getSettings } from '../lib/settings.js';
import * as db from '../lib/db.js';
import { isCapturableUrl, sleep, hostOf, sanitizeFolder } from '../lib/util.js';
import { runStitch, CancelError, LIMITS } from '../lib/stitch.js';

const MIN_SHOT_GAP = 560;       // chrome limits captureVisibleTab to ~2 calls per second

const idleJob = () => ({ status: 'idle', mode: null, done: 0, total: 0, message: '', error: null, captureId: null });
let job = idleJob();
let ctl = { paused: false, cancelled: false };
let busy = false;
let lastShot = 0;
let pendingSelection = null;
let batch = null;

// ---------- keep-alive while a long job runs ----------
let keepCount = 0;
let keepTimer = null;
function keepAlive(on) {
  keepCount += on ? 1 : -1;
  if (keepCount > 0 && !keepTimer) keepTimer = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  if (keepCount <= 0) { keepCount = 0; clearInterval(keepTimer); keepTimer = null; }
}

// ---------- job state shared with the popup ----------
function setJob(patch) {
  job = { ...job, ...patch };
  chrome.storage.session.set({ job }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'jobState', job }).catch(() => {});
  updateBadge(job);
}

// Progress on the toolbar icon, so captures started with a keyboard shortcut give feedback
// even though no popup is open.
let badgeTimer = null;
function updateBadge(j) {
  const text = j.status === 'capturing' ? (j.total ? Math.min(99, Math.round((j.done / j.total) * 100)) + '%' : '…')
    : j.status === 'preparing' || j.status === 'saving' ? '…'
    : j.status === 'paused' ? '||'
    : j.status === 'error' ? '!' : '';
  chrome.action.setBadgeText({ text }).catch(() => {});
  if (text) chrome.action.setBadgeBackgroundColor({ color: j.status === 'error' ? '#d6342c' : '#2f5bff' }).catch(() => {});
  chrome.action.setTitle({ title: j.status === 'error' && j.error ? 'Open Page Capture: ' + j.error : 'Open Page Capture' }).catch(() => {});
  clearTimeout(badgeTimer);
  if (j.status === 'error') badgeTimer = setTimeout(() => { if (job.status === 'error') setJob(idleJob()); }, 8000);
}

function setBatch(patch) {
  batch = { ...batch, ...patch };
  chrome.storage.session.set({ batch }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'batchState', batch }).catch(() => {});
}

// ---------- page helper calls ----------
async function helper(tabId, method, args = []) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (m, a) => window.__opc[m](...a),
    args: [method, args]
  });
  return res ? res.result : undefined;
}

async function throttle() {
  const wait = lastShot + MIN_SHOT_GAP - Date.now();
  if (wait > 0) await sleep(wait);
}

async function shoot(windowId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle();
    try {
      const url = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      lastShot = Date.now();
      const blob = await (await fetch(url)).blob();
      return await createImageBitmap(blob);
    } catch (err) {
      lastShot = Date.now();
      if (/MAX_CAPTURE_VISIBLE_TAB_CALLS|quota|rate/i.test(String(err && err.message)) && attempt < 3) {
        await sleep(700);
        continue;
      }
      throw err;
    }
  }
}

async function gate(tabId) {
  while (ctl.paused && !ctl.cancelled) await sleep(200);
  if (ctl.cancelled) throw new CancelError();
  for (let i = 0; i < 120; i++) {
    const t = await chrome.tabs.get(tabId);
    if (t.active) { if (job.message) setJob({ message: '' }); return; }
    setJob({ message: 'Switch back to the tab to continue' });
    await sleep(500);
    if (ctl.cancelled) throw new CancelError();
  }
  throw new Error('The tab was not visible, so the capture was stopped.');
}

function newCanvas(w, h) {
  const c = new OffscreenCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, w, h);
  x.imageSmoothingQuality = 'high';
  return { c, x };
}

async function makeThumb(canvas) {
  const tw = 520, th = 360;
  const sc = Math.min(1, tw / canvas.width);
  const sh = Math.min(canvas.height, Math.round(th / sc));
  const oc = new OffscreenCanvas(Math.max(1, Math.round(canvas.width * sc)), Math.max(1, Math.round(sh * sc)));
  const x = oc.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(canvas, 0, 0, canvas.width, sh, 0, 0, oc.width, oc.height);
  return oc.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

function mapLinks(links, region, ratio, s, w, h) {
  const out = [];
  for (const l of links || []) {
    let x = (l.x - region.x) * ratio * s, y = (l.y - region.y) * ratio * s;
    let lw = l.w * ratio * s, lh = l.h * ratio * s;
    if (x < 0) { lw += x; x = 0; }
    if (y < 0) { lh += y; y = 0; }
    if (x + lw > w) lw = w - x;
    if (y + lh > h) lh = h - y;
    if (lw < 2 || lh < 2) continue;
    out.push({ x: +x.toFixed(1), y: +y.toFixed(1), w: +lw.toFixed(1), h: +lh.toFixed(1), href: l.href });
  }
  return out;
}

// ---------- the capture pipeline ----------
async function runCapture({ tabId, mode, region: selRegion, batch: inBatch = false }) {
  if (busy) throw new Error('A capture is already running.');
  busy = true;
  ctl = { paused: false, cancelled: false };
  keepAlive(true);
  let helperReady = false;
  try {
    const settings = await getSettings();
    const tab = await chrome.tabs.get(tabId);
    if (!isCapturableUrl(tab.url)) throw new Error("This page can't be captured (browser pages and the Chrome Web Store are protected).");
    setJob({ ...idleJob(), mode, tabId, status: 'preparing', title: tab.title || '', batch: inBatch });

    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content/capture-helper.js'] });
    } catch (err) {
      const isFile = /^file:/i.test(tab.url || '');
      throw new Error(isFile
        ? 'To capture local files, turn on "Allow access to file URLs" for this extension in chrome://extensions.'
        : "Couldn't access this page. Reload it and try again.");
    }
    helperReady = true;

    if (mode === 'select') await sleep(150); // let the selection overlay disappear
    const info = await helper(tabId, 'init', [{ forceWindow: mode !== 'full' }]);
    if (!info) throw new Error('Could not read the page.');
    const rect = info.rect;
    if (rect.width < 2 || rect.height < 2) throw new Error('The page has no visible area to capture.');

    let region;
    if (mode === 'visible') region = { x: info.scroll.x, y: info.scroll.y, w: rect.width, h: rect.height };
    else if (mode === 'select') region = { x: Math.floor(selRegion.x), y: Math.floor(selRegion.y), w: Math.ceil(selRegion.w), h: Math.ceil(selRegion.h) };
    else region = { x: 0, y: 0, w: rect.width, h: Math.min(info.contentH, LIMITS.maxCssH) };

    setJob({ status: 'capturing', total: Math.max(1, Math.ceil(region.w / rect.width) * Math.ceil(region.h / rect.height)), done: 0 });

    const { canvas, ratio, s } = await runStitch({
      mode, rect, region,
      scroll: info.scroll,
      innerW: info.innerW,
      // The very first frame at the top of the page keeps headers (they sit in their natural place).
      // Any other frame, including the first frame of a selection that starts lower down, hides
      // fixed/stuck elements so a sticky header cannot cover the content.
      scrollTo: (x, y, first) => helper(tabId, 'scrollTo', [x, y, { pauseMs: settings.pauseMs, waitImagesMs: settings.waitImagesMs, hideFixed: settings.hideFixed && !(first && x === 0 && y === 0) }]),
      shoot: () => shoot(tab.windowId),
      newCanvas,
      gate: () => gate(tabId),
      onProgress: (done, total) => setJob({ done, total })
    });

    setJob({ status: 'saving', message: '' });
    let links = [];
    if (settings.pdf.links && mode !== 'visible') {
      try { links = (await helper(tabId, 'collectLinks')) || []; } catch (e) { links = []; }
    }
    await helper(tabId, 'cleanup');
    helperReady = false;

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const thumb = await makeThumb(canvas);
    const createdAt = Date.now();
    const rec = {
      id: db.newId(),
      title: info.title || tab.title || hostOf(info.url),
      url: info.url,
      host: hostOf(info.url),
      createdAt,
      expiresAt: createdAt + settings.expiryMs,
      favourite: false,
      width: canvas.width,
      height: canvas.height,
      scale: s,
      ratio,
      size: blob.size,
      thumb,
      links: mapLinks(links, region, ratio, s, canvas.width, canvas.height),
      edited: false,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      mode
    };
    await db.addCapture(rec, blob);

    setJob({ status: 'done', captureId: rec.id, message: s < 1 ? `Scaled to ${Math.round(s * 100)}% to fit browser limits` : '' });

    if (!inBatch) {
      if (settings.downloads.auto) {
        try { await exportAndDownload(rec.id, settings.fileType, settings, false); } catch (e) { setJob({ message: 'Saved, but the download failed: ' + e.message }); }
      } else {
        await chrome.tabs.create({
          url: chrome.runtime.getURL('viewer/viewer.html?id=' + rec.id),
          index: (tab.index || 0) + 1,
          openerTabId: tabId
        });
      }
    }
    return rec.id;
  } catch (err) {
    if (err instanceof CancelError) setJob({ status: 'cancelled', message: '' });
    else setJob({ status: 'error', error: err && err.message ? err.message : String(err) });
    throw err;
  } finally {
    if (helperReady) { try { await helper(tabId, 'cleanup'); } catch (e) { /* tab may be gone */ } }
    keepAlive(false);
    busy = false;
  }
}

// ---------- offscreen export bridge ----------
async function ensureOffscreen() {
  const has = chrome.offscreen.hasDocument ? await chrome.offscreen.hasDocument() : false;
  if (!has) {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['BLOBS', 'WORKERS'],
      justification: 'Render screenshots to PNG, JPEG, GIF and OCR-searchable PDF files.'
    });
  }
}

const pendingDownloads = new Set();
async function closeOffscreenIfIdle() {
  if (pendingDownloads.size) return;
  try { await chrome.offscreen.closeDocument(); } catch (e) { /* not open */ }
}
chrome.downloads.onChanged.addListener((d) => {
  if (!pendingDownloads.has(d.id) || !d.state) return;
  if (d.state.current === 'complete' || d.state.current === 'interrupted') {
    pendingDownloads.delete(d.id);
    if (!busy) closeOffscreenIfIdle();
  }
});

async function exportAndDownload(id, format, settings, inBatch) {
  keepAlive(true);
  try {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'export', id, format, settings });
    if (!res || !res.ok) throw new Error((res && res.error) || 'Export failed');
    const folder = sanitizeFolder(settings.downloads.folder);
    const downloadId = await chrome.downloads.download({
      url: res.url,
      filename: (folder ? folder + '/' : '') + res.filename,
      saveAs: !!settings.downloads.askWhere && !inBatch,
      conflictAction: 'uniquify'
    });
    pendingDownloads.add(downloadId);
  } finally {
    keepAlive(false);
  }
}

// ---------- batch capture ----------
function waitForTab(tabId, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let sawLoading = false;
    const finish = () => { chrome.tabs.onUpdated.removeListener(onUpdated); clearTimeout(timer); clearTimeout(fallback); resolve(); };
    const onUpdated = (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'loading') sawLoading = true;
      if (info.status === 'complete' && sawLoading) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    const fallback = setTimeout(() => { if (!sawLoading) finish(); }, 4000);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function runBatch({ urls, outFormat }) {
  if (busy || (batch && batch.running)) return { ok: false, error: 'A capture is already running.' };
  const clean = urls.map((u) => u.trim()).filter(Boolean).map((u) => (/^[a-z]+:/i.test(u) ? u : 'https://' + u));
  const items = clean.map((url) => ({ url, status: 'queued', captureId: null, error: '' }));
  if (!items.length) return { ok: false, error: 'Add at least one URL.' };
  batch = { id: db.newId(), running: true, stop: false, items, outFormat, index: 0 };
  setBatch({});
  (async () => {
    keepAlive(true);
    const settings = await getSettings();
    let win = null, tabId = null;
    try {
      win = await chrome.windows.create({ url: 'about:blank', focused: true, type: 'normal', width: 1366, height: 900 });
      tabId = win.tabs[0].id;
      for (let i = 0; i < items.length; i++) {
        if (batch.stop) { items[i].status = 'skipped'; continue; }
        items[i].status = 'loading';
        setBatch({ index: i, items });
        try {
          if (!/^https?:/i.test(items[i].url)) throw new Error('Only http(s) addresses can be captured.');
          const loaded = waitForTab(tabId);
          await chrome.tabs.update(tabId, { url: items[i].url, active: true });
          await loaded;
          await sleep(1200);
          items[i].status = 'capturing';
          setBatch({ items });
          const id = await runCapture({ tabId, mode: 'full', batch: true });
          items[i].captureId = id;
          if (outFormat && outFormat !== 'none') {
            items[i].status = 'exporting';
            setBatch({ items });
            await exportAndDownload(id, outFormat, settings, true);
          }
          items[i].status = 'done';
        } catch (err) {
          if (err instanceof CancelError) { items[i].status = 'skipped'; batch.stop = true; }
          else { items[i].status = 'failed'; items[i].error = err && err.message ? err.message : String(err); }
        }
        setBatch({ items });
      }
    } catch (err) {
      for (const it of items) if (it.status === 'queued') { it.status = 'failed'; it.error = err.message; }
    } finally {
      if (win) { try { await chrome.windows.remove(win.id); } catch (e) { /* already closed */ } }
      setJob(idleJob());
      setBatch({ running: false, items });
      keepAlive(false);
      closeOffscreenIfIdle();
    }
  })();
  return { ok: true };
}

// ---------- messages ----------
async function startFromPopup({ mode, tabId }) {
  if (busy) return { ok: false, error: 'A capture is already running.' };
  const tab = await chrome.tabs.get(tabId);
  if (!isCapturableUrl(tab.url)) return { ok: false, error: "This page can't be captured (browser pages and the Chrome Web Store are protected)." };
  if (mode === 'select') {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content/selector.js'] });
    } catch (err) {
      return { ok: false, error: "Couldn't start selection on this page. Reload it and try again." };
    }
    pendingSelection = { tabId };
    return { ok: true };
  }
  runCapture({ tabId, mode }).catch(() => {});
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target) return; // messages for the offscreen document
  switch (msg.type) {
    case 'getJob':
      sendResponse({ job });
      return;
    case 'start':
      startFromPopup(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'pause':
      ctl.paused = true; setJob({ status: 'paused' }); sendResponse({ ok: true });
      return;
    case 'resume':
      ctl.paused = false; setJob({ status: 'capturing' }); sendResponse({ ok: true });
      return;
    case 'stop':
      ctl.cancelled = true; ctl.paused = false;
      if (batch && batch.running) batch.stop = true;
      sendResponse({ ok: true });
      return;
    case 'selection':
      if (pendingSelection && sender.tab && sender.tab.id === pendingSelection.tabId) {
        const tabId = pendingSelection.tabId;
        pendingSelection = null;
        runCapture({ tabId, mode: 'select', region: msg.rect }).catch(() => {});
      }
      return;
    case 'selectionCancel':
      pendingSelection = null;
      return;
    case 'batchStart':
      runBatch(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
      return true;
    case 'getBatch':
      sendResponse({ batch });
      return;
    case 'purge':
      db.purgeExpired().then((n) => sendResponse({ removed: n }), () => sendResponse({ removed: 0 }));
      return true;
    default:
  }
});

// ---------- browser-wide keyboard shortcuts (manifest "commands") ----------
chrome.commands.onCommand.addListener(async (command, tab) => {
  try {
    if (command === 'open-history') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('history/history.html') });
      return;
    }
    const mode = { 'capture-visible': 'visible', 'capture-full': 'full', 'capture-select': 'select' }[command];
    if (!mode) return;
    if (!tab || tab.id == null) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found.');
    const res = await startFromPopup({ mode, tabId: tab.id });
    if (!res.ok) setJob({ ...idleJob(), mode, status: 'error', error: res.error });
  } catch (err) {
    setJob({ ...idleJob(), status: 'error', error: err && err.message ? err.message : String(err) });
  }
});

// ---------- housekeeping ----------
async function housekeeping() {
  try { await db.purgeExpired(); } catch (e) { /* db unavailable */ }
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'opc-purge') housekeeping(); });
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('opc-purge', { periodInMinutes: 5 });
  housekeeping();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('opc-purge', { periodInMinutes: 5 });
  housekeeping();
});
housekeeping();
