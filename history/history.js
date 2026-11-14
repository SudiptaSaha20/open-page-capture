import '../lib/theme.js';
import { $, el, toast, saveBlob, timeLeft, fmtDate, fmtBytes, debounce } from '../lib/util.js';
import { hydrateIcons, icon } from '../lib/icons.js';
import * as db from '../lib/db.js';
import { getSettings, EXPIRY_OPTIONS } from '../lib/settings.js';
import { exportCapture, FORMATS } from '../lib/exporter.js';
import { loadKeymap } from '../lib/shortcuts.js';

hydrateIcons();

let all = [];
let settings = null;
let query = '';
let selecting = false;
let autoSelect = false; // select mode was entered by ticking a card, so it ends when nothing is ticked
const selected = new Set();
let thumbUrls = [];
let favOpen = true;

const matches = (c) => {
  if (!query) return true;
  const q = query.toLowerCase();
  return (c.title || '').toLowerCase().includes(q) || (c.url || '').toLowerCase().includes(q);
};

function pill(text) {
  $('#pill').classList.toggle('hidden', !text);
  $('#pillText').textContent = text || '';
}

function card(c) {
  const url = URL.createObjectURL(c.thumb);
  thumbUrls.push(url);
  const left = c.favourite ? '' : timeLeft(c.expiresAt);
  const warn = !c.favourite && c.expiresAt - Date.now() < 3600e3;

  const star = el('button', {
    type: 'button',
    class: 'act star' + (c.favourite ? ' on' : ''),
    title: c.favourite ? 'Remove from favourites' : 'Favourite (keeps it permanently)',
    'aria-label': c.favourite ? 'Remove from favourites' : 'Add to favourites',
    'aria-pressed': String(c.favourite),
    html: icon('star', 17),
    onclick: async (e) => {
      e.stopPropagation();
      await db.setFavourite(c.id, !c.favourite, settings.expiryMs);
      await load();
    }
  });
  const trash = el('button', {
    type: 'button',
    class: 'act del',
    title: 'Delete',
    'aria-label': 'Delete this capture',
    html: icon('trash', 17),
    onclick: async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog('Delete this capture?', 'It will be removed from this device. This can’t be undone.', 'Delete');
      if (!ok) return;
      await db.deleteCaptures([c.id]);
      selected.delete(c.id);
      toast('Capture deleted');
      await load();
    }
  });
  const check = el('button', {
    type: 'button',
    class: 'check',
    title: 'Select',
    'aria-label': 'Select this capture',
    'aria-pressed': String(selected.has(c.id)),
    html: icon('check', 15),
    onclick: (e) => {
      e.stopPropagation();
      if (!selecting) { selecting = true; autoSelect = true; }
      toggle(c.id, node);
    }
  });

  const node = el('article', { class: 'card' + (selected.has(c.id) ? ' sel' : ''), tabindex: '0', dataset: { id: c.id } },
    el('div', { class: 'thumb' },
      el('img', { src: url, alt: '', loading: 'lazy', draggable: 'false' }),
      left ? el('span', { class: 'badge' + (warn ? ' warn' : '') }, left) : null,
      check,
      el('div', { class: 'actions' }, star, trash)),
    el('div', { class: 'info' },
      el('span', { class: 't', title: c.title }, c.title || c.url),
      el('span', { class: 'm' }, `${c.host} · ${c.width}×${c.height} · ${fmtDate(c.createdAt)}`)));
  const activate = () => {
    if (selecting) toggle(c.id, node);
    else location.href = chrome.runtime.getURL('viewer/viewer.html?id=' + c.id);
  };
  node.addEventListener('click', activate);
  node.addEventListener('keydown', (e) => {
    if (e.target !== node) return; // keys pressed on the inner buttons belong to them
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
  });
  return node;
}

function toggle(id, node) {
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  node.classList.toggle('sel', selected.has(id));
  const cb = node.querySelector('.check');
  if (cb) cb.setAttribute('aria-pressed', String(selected.has(id)));
  if (autoSelect && selected.size === 0) { selecting = false; autoSelect = false; }
  updateBulk();
}

function updateBulk() {
  $('#bulk').classList.toggle('hidden', !selecting);
  $('#bulkCount').textContent = `${selected.size} selected`;
  const visible = all.filter(matches);
  $('#bulkAll').textContent = selected.size && selected.size >= visible.length ? 'Clear' : 'Select all';
  $('#selectLabel').textContent = selecting ? 'Done' : 'Select';
  document.body.classList.toggle('selecting', selecting);
  const none = selected.size === 0;
  ['bulkFav', 'bulkDl', 'bulkDel'].forEach((id) => { $('#' + id).disabled = none; });
  $('#bulkDlLabel').textContent = 'Download ' + FORMATS[settings.fileType].label;
}

function render() {
  thumbUrls.forEach((u) => URL.revokeObjectURL(u));
  thumbUrls = [];
  const list = all.filter(matches);
  const favs = list.filter((c) => c.favourite);
  $('#count').textContent = all.length ? `${all.length} saved on this device` : '';
  $('#empty').classList.toggle('hidden', all.length > 0);
  $('#allSec').classList.toggle('hidden', all.length === 0);
  $('#favSec').classList.toggle('hidden', favs.length === 0);
  $('#favCount').textContent = favs.length;
  $('#allCount').textContent = list.length;
  $('#favGrid').replaceChildren(...favs.map(card));
  $('#allGrid').replaceChildren(...list.map(card));
  $('#favGrid').classList.toggle('collapsed', !favOpen);
  $('#favHead').setAttribute('aria-expanded', String(favOpen));
  if (all.length && !list.length) {
    $('#allGrid').replaceChildren(el('p', { class: 'muted' }, 'No captures match your search.'));
  }
  updateBulk();
}

async function footer() {
  const days = EXPIRY_OPTIONS.find((o) => o.ms === settings.expiryMs);
  let usage = '';
  try {
    const e = await navigator.storage.estimate();
    usage = `Using ${fmtBytes(e.usage || 0)} on this device. `;
  } catch (err) { /* estimate unsupported */ }
  const foot = $('#foot');
  foot.replaceChildren(
    document.createTextNode(`${usage}Captures auto-delete after ${days ? days.label : 'the set time'}. Favourites are kept. `),
    el('a', { href: '../options/options.html#storage' }, 'Change in settings'));
}

async function load() {
  await db.purgeExpired().catch(() => {});
  settings = await getSettings();
  all = await db.listCaptures();
  for (const id of [...selected]) if (!all.some((c) => c.id === id)) selected.delete(id);
  render();
  footer();
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

// ---- events ----
$('#q').addEventListener('input', debounce((e) => { query = e.target.value.trim(); render(); }, 120));
$('#settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#favHead').addEventListener('click', () => { favOpen = !favOpen; render(); });
$('#selectBtn').addEventListener('click', () => {
  selecting = !selecting;
  autoSelect = false;
  if (!selecting) selected.clear();
  render();
});
$('#bulkDone').addEventListener('click', () => { selecting = false; autoSelect = false; selected.clear(); render(); });
$('#bulkAll').addEventListener('click', () => {
  const visible = all.filter(matches);
  if (selected.size >= visible.length) selected.clear();
  else visible.forEach((c) => selected.add(c.id));
  render();
});
$('#bulkFav').addEventListener('click', async () => {
  const picked = all.filter((c) => selected.has(c.id));
  const makeFav = picked.some((c) => !c.favourite);
  for (const c of picked) await db.setFavourite(c.id, makeFav, settings.expiryMs);
  toast(makeFav ? 'Added to favourites' : 'Removed from favourites');
  await load();
});
$('#bulkDel').addEventListener('click', async () => {
  const n = selected.size;
  const ok = await confirmDialog(`Delete ${n} capture${n === 1 ? '' : 's'}?`, 'They will be removed from this device. This can’t be undone.', 'Delete');
  if (!ok) return;
  await db.deleteCaptures([...selected]);
  selected.clear();
  toast(`Deleted ${n}`);
  await load();
});
$('#bulkDl').addEventListener('click', async () => {
  const ids = [...selected];
  let ok = 0;
  for (let i = 0; i < ids.length; i++) {
    try {
      const { blob, filename } = await exportCapture(ids[i], settings.fileType, {
        settings,
        onProgress: (t) => pill(`File ${i + 1} of ${ids.length}: ${t}`)
      });
      await saveBlob(blob, filename, { ...settings.downloads, batch: true });
      ok++;
    } catch (err) {
      toast(err && err.message ? err.message : 'Export failed', 'error', 5000);
    }
  }
  pill('');
  if (ok) toast(`Saved ${ok} file${ok === 1 ? '' : 's'}`);
});

// ---- keyboard shortcuts (defaults can be changed in Settings > Shortcuts) ----
let keys = null;
function applyHints() {
  $('#q').placeholder = 'Search title or address';
  $('#q').title = 'Search' + keys.hint('history.search');
  $('#selectBtn').title = 'Select captures' + keys.hint('history.toggleSelect');
  $('#bulkAll').title = 'Select all' + keys.hint('history.selectAll');
  $('#bulkFav').title = 'Favourite selected' + keys.hint('history.favourite');
  $('#bulkDl').title = 'Download selected' + keys.hint('history.download');
  $('#bulkDel').title = 'Delete selected' + keys.hint('history.delete');
}
keys = await loadKeymap('history', applyHints);
applyHints();

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input,textarea,select')) {
    if (e.key === 'Escape' && e.target.id === 'q') e.target.blur();
    return;
  }
  if (document.querySelector('.dialog-back')) return;
  const a = keys.match(e);
  if (!a) return;
  const some = selected.size > 0;
  switch (a) {
    case 'history.search': e.preventDefault(); $('#q').focus(); $('#q').select(); break;
    case 'history.toggleSelect': e.preventDefault(); $('#selectBtn').click(); break;
    case 'history.selectAll':
      e.preventDefault();
      if (!selecting) { selecting = true; autoSelect = false; }
      all.filter(matches).forEach((c) => selected.add(c.id));
      render();
      break;
    case 'history.favourite': if (some) { e.preventDefault(); $('#bulkFav').click(); } break;
    case 'history.download': if (some) { e.preventDefault(); $('#bulkDl').click(); } break;
    case 'history.delete': if (some) { e.preventDefault(); $('#bulkDel').click(); } break;
    default:
  }
});

setInterval(load, 60000);
load();
