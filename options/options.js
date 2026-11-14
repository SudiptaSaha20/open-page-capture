import '../lib/theme.js';
import { $, $$, el, toast, fmtBytes, debounce } from '../lib/util.js';
import { hydrateIcons, brandMark } from '../lib/icons.js';
import { getSettings, saveSettings, EXPIRY_OPTIONS } from '../lib/settings.js';
import * as db from '../lib/db.js';
import { onThemeChange } from '../lib/theme.js';
import { SCOPES, GLOBAL_COMMANDS, actionsOf, Keymap, comboFromEvent, comboParts, findConflict } from '../lib/shortcuts.js';

$('#brand').innerHTML = brandMark(22) + '<span>Open Page Capture</span>';

let S = await getSettings();

const getPath = (path) => path.split('.').reduce((o, k) => o[k], S);
async function setPath(path, value) {
  const patch = {};
  let cur = patch;
  const keys = path.split('.');
  keys.forEach((k, i) => { cur[k] = i === keys.length - 1 ? value : {}; cur = cur[k]; });
  S = await saveSettings(patch);
}

// ---- control builders ----
function toggle(path) {
  const input = el('input', { type: 'checkbox', role: 'switch' });
  input.checked = !!getPath(path);
  input.addEventListener('change', () => setPath(path, input.checked));
  return el('label', { class: 'switch' }, input, el('span'));
}

function select(path, options, parse = (v) => v) {
  const s = el('select', { class: 'select' },
    options.map(([value, label]) => el('option', { value: String(value) }, label)));
  s.value = String(getPath(path));
  s.addEventListener('change', () => setPath(path, parse(s.value)));
  return s;
}

function segmented(path, options) {
  const wrap = el('div', { class: 'segmented', role: 'group' });
  const paint = () => wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(getPath(path)))));
  for (const [value, label] of options) {
    wrap.append(el('button', { type: 'button', dataset: { v: String(value) }, onclick: async () => { await setPath(path, value); paint(); } }, label));
  }
  paint();
  return wrap;
}

function text(path, placeholder, cls = 'wide') {
  const i = el('input', { class: `input ${cls}`, type: 'text', placeholder, spellcheck: 'false', autocomplete: 'off' });
  i.value = getPath(path) || '';
  i.addEventListener('input', debounce(() => setPath(path, i.value.trim()), 400));
  return i;
}

const row = (title, desc, control, note) =>
  el('div', { class: 'setting' },
    el('div', { class: 'copy' }, el('b', {}, title), desc ? el('span', {}, desc) : null, note ? el('span', { class: 'note' }, note) : null),
    el('div', { class: 'ctl' }, control));

const sectionEl = (id, title, sub, ...children) =>
  el('section', { id }, el('h2', {}, title), el('p', { class: 'sub' }, sub), ...children);

// ---- sections ----
const themeSeg = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Theme' });
const paintTheme = () => themeSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === (S.theme || 'system'))));
for (const [v, label] of [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]) {
  themeSeg.append(el('button', { type: 'button', dataset: { v }, onclick: async () => { await setPath('theme', v); paintTheme(); } }, label));
}
paintTheme();
onThemeChange(async (t) => { S = await getSettings(); S.theme = t; paintTheme(); });
const appearance = sectionEl('appearance', 'Appearance', 'Pick a look for every Open Page Capture screen.',
  el('div', { class: 'group' },
    row('Theme', 'System follows your browser or operating system. You can also switch from the sun/moon button at the top of each screen.', themeSeg)));

const capturing = sectionEl('capturing', 'Capturing', 'How a page is captured and saved.',
  el('div', { class: 'group' },
    row('Default file type', 'Used by the Save button and auto-download.', segmented('fileType', [['png', 'PNG'], ['jpeg', 'JPEG'], ['gif', 'GIF'], ['pdf', 'PDF']])),
    row('JPEG quality', 'Higher is sharper and larger.', select('jpegQuality', [[0.7, '70%'], [0.8, '80%'], [0.92, '92% (default)'], [1, '100%']], Number)),
    row('Pause between scrolls', 'Extra wait after each scroll. Raise it for pages that load content slowly. Chrome already limits screenshots to about two per second.',
      select('pauseMs', [[0, 'None'], [150, '150 ms (default)'], [300, '300 ms'], [600, '600 ms'], [1000, '1 second'], [2000, '2 seconds']], Number)),
    row('Wait for images', 'Pause each frame until lazy-loading images finish. Turn on if screenshots show blurry or empty images.',
      select('waitImagesMs', [[0, 'Off'], [2000, 'Up to 2 seconds'], [5000, 'Up to 5 seconds'], [10000, 'Up to 10 seconds']], Number)),
    row('Hide sticky and fixed elements', 'After the first frame, headers and chat bubbles are hidden so they do not repeat down the page.', toggle('hideFixed')),
    row('Evidence mode', 'Every export gets a band with the page address, the exact time with its time zone, and a SHA-256 checksum of the pixels. The same facts are written into the file. Images are saved as lossless PNG so the checksum can be verified later on the Verify page.', toggle('evidence')),
    row('Batch capture', 'Capture a list of addresses in one go.', el('a', { class: 'btn', href: '../batch/batch.html' }, 'Open batch capture')),
    row('Verify evidence', 'Check an exported PNG against its checksum.', el('a', { class: 'btn', href: '../verify/verify.html' }, 'Open verify'))));

const paperOpts = [['full', 'Full image', 'One page, sized to the screenshot'], ['letter', 'US Letter', '8.5 × 11 in'], ['legal', 'US Legal', '8.5 × 14 in'], ['a4', 'A4', '210 × 297 mm']];
const paper = el('div', { class: 'paper', role: 'group', 'aria-label': 'Paper size' });
const paintPaper = () => paper.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === S.pdf.paper)));
for (const [v, name, sub] of paperOpts) {
  paper.append(el('button', { type: 'button', dataset: { v }, onclick: async () => { await setPath('pdf.paper', v); paintPaper(); } }, el('b', {}, name), el('span', {}, sub)));
}
paintPaper();

const pdf = sectionEl('pdf', 'PDF', 'Applies when you save a capture as a PDF.',
  el('div', { class: 'group' },
    paper,
    row('Orientation', 'Paper orientation for the page sizes above.', segmented('pdf.orientation', [['portrait', 'Portrait'], ['landscape', 'Landscape']])),
    row('Smart page splitting', 'Move each page break to a gap between lines so text is never cut in half.', toggle('pdf.smartSplit')),
    row('Clickable links', 'Links on the page stay clickable in the PDF.', toggle('pdf.links')),
    row('Searchable PDF (OCR)', 'Reads the words on the page with an on-device model and lays them invisibly over the picture, so the text can be selected, searched and copied. Nothing leaves your computer. Slower for long pages.', toggle('pdf.ocr')),
    row('OCR language', 'English is built in. For others, add the language file to vendor/tesseract/tessdata and enter its code, for example eng+deu.', text('pdf.ocrLang', 'eng', 'mid')),
    row('Stamp the page address and date on top', 'The URL and capture time on the first PDF page. Evidence mode replaces this with its own band.', toggle('pdf.stamp')),
    row('Date format', 'How the capture date appears in the stamp, or hide it.', select('pdf.dateFormat', [['datetime', 'Date & time'], ['date', 'Date only'], ['none', 'Hide']]))));

const downloads = sectionEl('downloads', 'Downloads', 'Where files go and what happens after a capture.',
  el('div', { class: 'group' },
    row('Save into a folder', 'A subfolder under Downloads. Leave empty to use Downloads itself.', text('downloads.folder', 'screenshots')),
    row('Ask where to save', 'A save-as dialog for single files. Skipped for batches.', toggle('downloads.askWhere')),
    row('Auto-download files', 'Download each capture straight away instead of opening the viewer. You can still find it in Your captures.', toggle('downloads.auto'))));

const usage = el('span', {}, '');
const storage = sectionEl('storage', 'Storage', 'Captures live only in this browser, on this device.',
  el('div', { class: 'group' },
    row('Delete captures after', 'Starred captures are never deleted. Un-starring one restarts its timer.',
      select('expiryMs', EXPIRY_OPTIONS.map((o) => [o.ms, o.label]), Number), 'Applies to new captures. Existing ones keep the time they were saved with.'),
    row('Used on this device', '', usage),
    row('Delete everything that isn’t a favourite', 'Removes all unstarred captures right now.',
      el('button', { class: 'btn danger', onclick: async () => {
        if (!confirm('Delete all captures that are not favourites? This can’t be undone.')) return;
        const n = await db.deleteNonFavourites();
        toast(`Deleted ${n} capture${n === 1 ? '' : 's'}`);
        refreshUsage();
      } }, 'Delete now'))));

const about = sectionEl('about', 'About', 'Open Page Capture 1.0.0',
  el('div', { class: 'group' },
    row('Privacy', 'No account, no analytics, no cloud. Screenshots, OCR and PDF export all happen inside your browser. The extension makes no network requests of its own.', null),
    row('Permissions', 'Batch capture asks for access to the sites you list, only when you start it.', null)));

// ---- keyboard shortcuts ----
const shortcutsHost = sectionEl('shortcuts', 'Keyboard shortcuts', 'Every task has a default key. Click a key to change it.');

function keycapContent(combo) {
  const parts = comboParts(combo);
  return parts.length ? parts.map((p) => el('kbd', {}, p)) : [el('span', {}, 'Not set')];
}

// Action ids contain dots, so they can't go through the dotted-path setter above.
async function setShortcut(id, value) {
  S = await saveSettings({ shortcuts: { [id]: value } });
}
async function resetAllShortcuts() {
  const patch = {};
  for (const sc of SCOPES) for (const a of actionsOf(sc.id)) patch[a.id] = null;
  S = await saveSettings({ shortcuts: patch });
}

function startRecording(btn, action) {
  btn.classList.add('rec');
  btn.replaceChildren('Press keys…');
  const stop = () => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onAway, true);
    btn.classList.remove('rec');
    renderShortcuts();
  };
  const onAway = (e) => { if (e.target !== btn && !btn.contains(e.target)) stop(); };
  const onKey = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') return stop();
    const combo = comboFromEvent(e);
    if (!combo) return; // a modifier on its own, keep waiting
    const clash = findConflict(action.scope, combo, action.id, S.shortcuts);
    if (clash) { toast(`Already used for “${clash.label}”. Change that one first.`, 'error', 4500); return; }
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onAway, true);
    await setShortcut(action.id, combo);
    renderShortcuts();
  };
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => document.addEventListener('click', onAway, true), 0);
}

async function renderShortcuts() {
  S = await getSettings();
  const body = [];
  body.push(el('h3', { class: 'sc-head' }, 'Anywhere in the browser', el('small', {}, 'Works without opening the popup')));
  let live = [];
  try { live = await chrome.commands.getAll(); } catch (e) { live = []; }
  const grp = el('div', { class: 'group' });
  for (const c of GLOBAL_COMMANDS) {
    const assigned = live.find((l) => l.name === c.name);
    const shortcut = assigned ? assigned.shortcut : c.def;
    const parts = shortcut ? (shortcut.includes('+') ? shortcut.split('+') : [...shortcut]) : [];
    grp.append(row(c.label, '', el('span', { class: 'ctl' },
      ...(parts.length ? parts.map((p) => el('kbd', {}, p)) : [el('span', { class: 'muted' }, 'Not set')]),
      el('button', { class: 'btn sm', type: 'button', onclick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) }, 'Change'))));
  }
  body.push(grp, el('p', { class: 'sc-note' }, 'These four are set by the browser. “Change” opens the browser’s shortcut page, where you can also add shortcuts for the other actions.'));

  for (const scope of SCOPES) {
    body.push(el('h3', { class: 'sc-head' }, scope.label, el('small', {}, scope.desc)));
    const g = el('div', { class: 'group' });
    const map = new Keymap(scope.id, S.shortcuts);
    for (const a of actionsOf(scope.id)) {
      const combo = map.combo(a.id);
      const custom = combo !== a.def;
      const cap = el('button', { class: 'keycap', type: 'button', title: 'Click, then press the new keys', onclick: (e) => startRecording(e.currentTarget, a) }, ...keycapContent(combo));
      const reset = custom ? el('button', { class: 'linkbtn', type: 'button', onclick: async () => { await setShortcut(a.id, null); renderShortcuts(); } }, 'Reset') : null;
      const clear = combo ? el('button', { class: 'linkbtn', type: 'button', onclick: async () => { await setShortcut(a.id, ''); renderShortcuts(); } }, 'Clear') : null;
      const r = row(a.label, '', el('span', { class: 'ctl' }, reset, clear, cap));
      r.classList.add('slim');
      g.append(r);
    }
    body.push(g);
  }
  body.push(el('p', { class: 'sc-note', style: 'margin-top:16px' },
    el('button', { class: 'btn', type: 'button', onclick: async () => { await resetAllShortcuts(); renderShortcuts(); toast('Shortcuts reset to defaults'); } }, 'Reset all to defaults')));
  shortcutsHost.replaceChildren(shortcutsHost.querySelector('h2'), shortcutsHost.querySelector('p.sub'), ...body);
}
renderShortcuts();

$('#content').append(appearance, capturing, pdf, downloads, storage, shortcutsHost, about);
hydrateIcons();

async function refreshUsage() {
  try {
    const e = await navigator.storage.estimate();
    usage.textContent = fmtBytes(e.usage || 0);
  } catch (err) { usage.textContent = 'Unavailable'; }
}
refreshUsage();

// highlight the section in view
const links = $$('#nav a');
function mark() {
  let current = links[0];
  for (const a of links) {
    const s = document.getElementById(a.getAttribute('href').slice(1));
    if (s && s.getBoundingClientRect().top < 140) current = a;
  }
  links.forEach((a) => a.classList.toggle('on', a === current));
}
window.addEventListener('scroll', mark, { passive: true });
mark();
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
