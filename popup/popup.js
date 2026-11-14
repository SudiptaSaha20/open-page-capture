import '../lib/theme.js';
import { $, $$ } from '../lib/util.js';
import { hydrateIcons, brandMark } from '../lib/icons.js';
import { listCaptures } from '../lib/db.js';

$('#brand').innerHTML = brandMark(22) + '<span>Open Page Capture</span>';
hydrateIcons();

const ACTIVE = ['preparing', 'capturing', 'paused', 'saving'];
const idleView = $('#idle'), runView = $('#running'), errBox = $('#err');
let tabId = null;

const open = (path) => { chrome.tabs.create({ url: chrome.runtime.getURL(path) }); window.close(); };

function showError(text) {
  errBox.textContent = text;
  errBox.classList.toggle('hidden', !text);
}

function render(job) {
  const running = job && ACTIVE.includes(job.status);
  idleView.classList.toggle('hidden', running);
  runView.classList.toggle('hidden', !running);
  if (!running) {
    if (job && job.status === 'error' && job.error) showError(job.error);
    return;
  }
  const bar = $('.bar');
  const label = { visible: 'Visible area', full: 'Full page', select: 'Selected area' }[job.mode] || 'Capture';
  $('#stateTitle').textContent = job.status === 'saving' ? 'Saving…' : job.status === 'paused' ? 'Paused' : label;
  const pct = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  $('#barFill').style.width = pct + '%';
  bar.classList.toggle('indeterminate', job.status === 'preparing' || job.status === 'saving');
  $('#stateCount').textContent = job.status === 'capturing' || job.status === 'paused' ? `${job.done} of ${job.total}` : '';
  $('#stateMsg').textContent = job.message || (job.status === 'preparing' ? 'Warming up…' : job.status === 'saving' ? 'Stitching and saving…' : '');
  $('#pauseLabel').textContent = job.status === 'paused' ? 'Resume' : 'Pause';
  $('#pauseBtn').disabled = job.status === 'saving' || job.status === 'preparing';
}

// Show each browser-wide shortcut next to its action (as assigned in chrome://extensions/shortcuts).
async function showShortcuts() {
  try {
    const cmds = await chrome.commands.getAll();
    for (const c of cmds) {
      const host = document.querySelector(`.keys[data-cmd="${c.name}"]`);
      if (!host || !c.shortcut) continue;
      const parts = c.shortcut.includes('+') ? c.shortcut.split('+') : [...c.shortcut];
      host.replaceChildren(...parts.map((p) => { const k = document.createElement('kbd'); k.textContent = p; return k; }));
    }
  } catch (e) { /* shortcuts are optional */ }
}

async function init() {
  showShortcuts();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab ? tab.id : null;
  const { job } = await chrome.runtime.sendMessage({ type: 'getJob' });
  render(job);
  try {
    const all = await listCaptures();
    $('#histCount').textContent = all.length ? `${all.length} saved on this device` : 'Your saved captures';
  } catch (e) { /* ignore */ }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'jobState') render(msg.job);
});

$$('.row[data-mode]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    showError('');
    if (tabId == null) return showError('No active tab found.');
    const mode = btn.dataset.mode;
    const res = await chrome.runtime.sendMessage({ type: 'start', mode, tabId });
    if (!res || !res.ok) return showError((res && res.error) || 'Could not start the capture.');
    if (mode === 'select') window.close();
    else render({ status: 'preparing', mode, done: 0, total: 0 });
  });
});

$('#pauseBtn').addEventListener('click', async () => {
  const paused = $('#pauseLabel').textContent === 'Resume';
  await chrome.runtime.sendMessage({ type: paused ? 'resume' : 'pause' });
});
$('#stopBtn').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'stop' }));
$('#openHistory').addEventListener('click', () => open('history/history.html'));
$('#openBatch').addEventListener('click', () => open('batch/batch.html'));
$('#openVerify').addEventListener('click', () => open('verify/verify.html'));
$('#openSettings').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });

init();
