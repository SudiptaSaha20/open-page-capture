import '../lib/theme.js';
import { $, $$, el, toast, saveBlob, timeLeft, clamp } from '../lib/util.js';
import { hydrateIcons, brandMark } from '../lib/icons.js';
import * as db from '../lib/db.js';
import { getSettings } from '../lib/settings.js';
import { exportCapture, FORMATS } from '../lib/exporter.js';
import { loadKeymap } from '../lib/shortcuts.js';

$('#brand').innerHTML = brandMark(22) + '<span>Capture ready</span>';
hydrateIcons();

const id = new URLSearchParams(location.search).get('id');
const stage = $('#stage'), img = $('#img');
let rec = null;
let settings = null;
let zoom = 1;
let fitZoom = 1;
let objectUrl = null;
let busy = false;
let keys = null;

function showMissing() {
  img.classList.add('hidden');
  $('#missing').classList.remove('hidden');
  $('#zoom').classList.add('hidden');
  $$('.tools .btn, .tools .icon-btn, .tools .seg').forEach((b) => { if (b.id !== 'historyBtn' && b.id !== 'settingsBtn') b.disabled = true; });
}

function applyZoom(z, keepCenter = true) {
  const oldW = img.clientWidth || 1;
  const cx = (stage.scrollLeft + stage.clientWidth / 2) / oldW;
  const cy = (stage.scrollTop + stage.clientHeight / 2) / (img.clientHeight || 1);
  zoom = clamp(z, 0.03, 4);
  img.style.width = Math.round(rec.width * zoom) + 'px';
  img.style.height = Math.round(rec.height * zoom) + 'px';
  $('#zoomPct').textContent = Math.round(zoom * 100) + '%';
  if (keepCenter) {
    stage.scrollLeft = cx * img.clientWidth - stage.clientWidth / 2;
    stage.scrollTop = cy * img.clientHeight - stage.clientHeight / 2;
  }
}

function fit() {
  fitZoom = Math.min(1, (stage.clientWidth - 48) / rec.width);
  applyZoom(fitZoom, false);
  stage.scrollTop = 0;
}

function refreshMeta() {
  $('#title').textContent = rec.title || rec.url;
  $('#title').title = rec.url;
  let meta = `${rec.width}×${rec.height} px`;
  if (rec.scale && rec.scale < 1) meta += ` · scaled to ${Math.round(rec.scale * 100)}%`;
  if (rec.edited) meta += ' · edited';
  $('#meta').textContent = meta;
  const chip = $('#expiry');
  if (rec.favourite) {
    chip.className = 'chip fav';
    chip.textContent = 'Favourite · kept';
  } else {
    chip.className = 'chip' + (rec.expiresAt - Date.now() < 3600e3 ? ' warn' : '');
    chip.textContent = 'Deletes in ' + timeLeft(rec.expiresAt).replace(' left', '');
  }
  $('#starBtn').classList.toggle('on', rec.favourite);
  $('#starBtn').setAttribute('aria-pressed', String(rec.favourite));
  document.title = (rec.title || 'Capture') + ' · Open Page Capture';
}

function setSaveLabel() {
  $('#saveLabel').textContent = 'Save ' + FORMATS[settings.fileType].label;
  $('#evidenceChip').classList.toggle('hidden', !settings.evidence);
}

function pill(text) {
  $('#pill').classList.toggle('hidden', !text);
  $('#pillText').textContent = text || '';
}

async function save(format) {
  if (busy) return;
  busy = true;
  try {
    settings = await getSettings();
    const { blob, filename, notes } = await exportCapture(id, format, { settings, onProgress: pill });
    pill('Saving file…');
    await saveBlob(blob, filename, settings.downloads);
    toast(`Saved ${filename}`);
    notes.forEach((n) => toast(n, 'info', 6000));
  } catch (err) {
    toast(err && err.message ? err.message : 'Export failed', 'error', 6000);
  } finally {
    pill('');
    busy = false;
  }
}

async function copyImage() {
  try {
    const blob = await db.getImage(id);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Copied to clipboard');
  } catch (err) {
    toast('Could not copy this image (it may be too large for the clipboard).', 'error', 5000);
  }
}

function confirmDialog(title, text, okLabel) {
  return new Promise((resolve) => {
    const done = (v) => { back.remove(); resolve(v); };
    const back = el('div', { class: 'dialog-back', onclick: (e) => { if (e.target === back) done(false); } },
      el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' },
        el('h3', {}, title), el('p', {}, text),
        el('div', { class: 'row' },
          el('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'),
          el('button', { class: 'btn primary', onclick: () => done(true) }, okLabel))));
    document.body.append(back);
    back.querySelector('.btn.primary').focus();
  });
}

function applyHints() {
  const set = (sel, text, id) => { const b = $(sel); if (b) b.title = text + keys.hint(id); };
  set('#editBtn', 'Edit', 'viewer.edit');
  set('#copyBtn', 'Copy image', 'viewer.copy');
  set('#printBtn', 'Print', 'viewer.print');
  set('#saveBtn', 'Save', 'viewer.save');
  set('#starBtn', 'Favourite (keeps it permanently)', 'viewer.favourite');
  set('#historyBtn', 'Your captures', 'viewer.history');
  set('#deleteBtn', 'Delete', 'viewer.delete');
  set('#zoomIn', 'Zoom in', 'viewer.zoomIn');
  set('#zoomOut', 'Zoom out', 'viewer.zoomOut');
  set('#zoomFit', 'Fit to width', 'viewer.zoomFit');
  set('#zoomPct', 'Reset to 100%', 'viewer.zoom100');
  document.querySelectorAll('#saveMenu [data-fmt]').forEach((b) => {
    const id = { png: 'viewer.savePng', jpeg: 'viewer.saveJpeg', gif: 'viewer.saveGif', pdf: 'viewer.savePdf' }[b.dataset.fmt];
    const c = keys.keymap.combo(id);
    b.querySelector('kbd')?.remove();
    if (c) { const k = document.createElement('kbd'); k.textContent = keys.hint(id).replace(/^ \(|\)$/g, ''); k.style.marginLeft = 'auto'; b.append(k); }
  });
}

async function init() {
  settings = await getSettings();
  keys = await loadKeymap('viewer', applyHints);
  applyHints();
  setSaveLabel();
  if (!id) return showMissing();
  db.purgeExpired().catch(() => {});
  rec = await db.getCapture(id);
  const blob = rec ? await db.getImage(id) : null;
  if (!rec || !blob) return showMissing();
  objectUrl = URL.createObjectURL(blob);
  $('#printImg').src = objectUrl;
  img.onload = () => fit();
  img.src = objectUrl;
  refreshMeta();
  setInterval(refreshMeta, 30000);
}

// ---- events ----
$('#saveBtn').addEventListener('click', () => save(settings.fileType));
const menu = $('#saveMenu');
$('#saveMenuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = menu.classList.toggle('hidden') === false;
  $('#saveMenuBtn').setAttribute('aria-expanded', String(open));
});
menu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fmt]');
  if (!b) return;
  menu.classList.add('hidden');
  save(b.dataset.fmt);
});
document.addEventListener('click', () => menu.classList.add('hidden'));
function runAction(a) {
  switch (a) {
    case 'viewer.save': return save(settings.fileType);
    case 'viewer.savePng': return save('png');
    case 'viewer.saveJpeg': return save('jpeg');
    case 'viewer.saveGif': return save('gif');
    case 'viewer.savePdf': return save('pdf');
    case 'viewer.copy': return copyImage();
    case 'viewer.print': return window.print();
    case 'viewer.edit': return $('#editBtn').click();
    case 'viewer.favourite': return $('#starBtn').click();
    case 'viewer.delete': return $('#deleteBtn').click();
    case 'viewer.history': return $('#historyBtn').click();
    case 'viewer.zoomIn': return applyZoom(zoom * 1.25);
    case 'viewer.zoomOut': return applyZoom(zoom * 0.8);
    case 'viewer.zoomFit': return fit();
    case 'viewer.zoom100': return applyZoom(1);
    default:
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') menu.classList.add('hidden');
  if (!rec || !keys || e.target.closest('input,textarea,select') || document.querySelector('.dialog-back')) return;
  const a = keys.match(e);
  if (!a) return;
  if (a === 'viewer.copy' && String(window.getSelection()).trim()) return; // normal text copy
  e.preventDefault();
  runAction(a);
});

$('#copyBtn').addEventListener('click', copyImage);
$('#printBtn').addEventListener('click', () => window.print());
$('#editBtn').addEventListener('click', () => { location.href = chrome.runtime.getURL('editor/editor.html?id=' + id); });
$('#historyBtn').addEventListener('click', () => { location.href = chrome.runtime.getURL('history/history.html'); });
$('#settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#starBtn').addEventListener('click', async () => {
  settings = await getSettings();
  rec = await db.setFavourite(id, !rec.favourite, settings.expiryMs);
  refreshMeta();
  toast(rec.favourite ? 'Favourited. This capture will be kept.' : 'Removed from favourites. It will auto-delete after the set time.');
});
$('#deleteBtn').addEventListener('click', async () => {
  const ok = await confirmDialog('Delete this capture?', 'It will be removed from this device. This can’t be undone.', 'Delete');
  if (!ok) return;
  await db.deleteCaptures([id]);
  location.href = chrome.runtime.getURL('history/history.html');
});

$('#zoomIn').addEventListener('click', () => applyZoom(zoom * 1.25));
$('#zoomOut').addEventListener('click', () => applyZoom(zoom * 0.8));
$('#zoomFit').addEventListener('click', fit);
$('#zoomPct').addEventListener('click', () => applyZoom(1));
stage.addEventListener('wheel', (e) => {
  if (!e.ctrlKey || !rec) return;
  e.preventDefault();
  applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9));
}, { passive: false });
window.addEventListener('resize', () => { if (rec && Math.abs(zoom - fitZoom) < 0.001) fit(); });

init();
