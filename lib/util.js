// Small shared helpers (DOM, formatting, downloads). Safe to import from any extension page.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

const pad = (n) => String(n).padStart(2, '0');

export function fmtDate(ts, mode = 'datetime') {
  if (mode === 'none') return '';
  const d = new Date(ts);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (mode === 'date') return date;
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

// 2026-11-13T15:04:05+05:30 (local time with explicit UTC offset)
export function isoWithOffset(ts) {
  const d = new Date(ts);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
  );
}

export function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
}

export function slugifyUrl(url, max = 80) {
  try {
    const u = new URL(url);
    const s = (u.host + u.pathname).replace(/^www\./, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s.slice(0, max) || 'page';
  } catch { return 'page'; }
}

export function fileStamp(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// "6d left", "5h left", "42m left"
export function timeLeft(expiresAt, now = Date.now()) {
  if (expiresAt == null) return '';
  const ms = expiresAt - now;
  if (ms <= 0) return 'Expiring';
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(ms / 3600000);
  if (h < 48) return `${Math.max(1, h)}h left`;
  return `${Math.floor(ms / 86400000)}d left`;
}

export function loadScript(src) {
  const url = src.startsWith('http') || src.startsWith('chrome-extension:') ? src : chrome.runtime.getURL(src);
  if (loadScript.cache[url]) return loadScript.cache[url];
  loadScript.cache[url] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => { delete loadScript.cache[url]; reject(new Error(`Could not load ${src}`)); };
    document.head.append(s);
  });
  return loadScript.cache[url];
}
loadScript.cache = {};

export function sanitizeFolder(folder) {
  return String(folder || '')
    .split(/[\\/]+/)
    .map((p) => p.replace(/[<>:"|?*\x00-\x1f]/g, '').replace(/^\.+$/, '').trim())
    .filter(Boolean)
    .join('/');
}

// Downloads a Blob through chrome.downloads (extension pages only).
export async function saveBlob(blob, filename, dl = {}) {
  const url = URL.createObjectURL(blob);
  const folder = sanitizeFolder(dl.folder);
  const path = (folder ? folder + '/' : '') + filename.replace(/[\\/:*?"<>|]/g, '_');
  try {
    await chrome.downloads.download({
      url,
      filename: path,
      saveAs: !!dl.askWhere && !dl.batch,
      conflictAction: 'uniquify'
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  }
}

let toastHost;
export function toast(message, kind = 'info', ms = 3200) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const t = el('div', { class: `toast ${kind}` }, message);
  toastHost.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 250);
  return t;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function isCapturableUrl(url) {
  if (!url) return false;
  if (!/^(https?|file|ftp):/i.test(url)) return false;
  if (/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url)) return false;
  return true;
}
