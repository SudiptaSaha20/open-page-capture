import '../lib/theme.js';
import { $, el } from '../lib/util.js';
import { hydrateIcons, brandMark } from '../lib/icons.js';

$('#brand').innerHTML = brandMark(22) + '<span>Open Page Capture</span>';
hydrateIcons();

const LABEL = {
  queued: 'Queued', loading: 'Loading page', capturing: 'Capturing', exporting: 'Exporting',
  done: 'Done', failed: 'Failed', skipped: 'Skipped'
};
const WORKING = ['loading', 'capturing', 'exporting'];

function render(batch) {
  if (!batch || !batch.items) return;
  $('#results').classList.remove('hidden');
  const running = !!batch.running;
  $('#startBtn').disabled = running;
  $('#stopBtn').hidden = !running;
  const done = batch.items.filter((i) => i.status === 'done').length;
  const failed = batch.items.filter((i) => i.status === 'failed').length;
  $('#summary').textContent = `${done} of ${batch.items.length} done${failed ? `, ${failed} failed` : ''}`;
  $('#list').replaceChildren(...batch.items.map((it) => {
    const cls = it.status === 'done' ? 'done' : it.status === 'failed' ? 'failed' : WORKING.includes(it.status) ? 'work' : '';
    return el('li', { class: cls },
      el('span', { class: 'url', title: it.url }, it.url),
      it.error ? el('span', { class: 'err-text' }, it.error) : null,
      it.captureId ? el('a', { class: 'btn sm', href: '../viewer/viewer.html?id=' + it.captureId }, 'Open') : null,
      el('span', { class: 'status' }, el('i', { class: 'dot' }), LABEL[it.status] || it.status));
  }));
}

function showError(t) {
  $('#err').textContent = t || '';
  $('#err').classList.toggle('hidden', !t);
}

$('#startBtn').addEventListener('click', async () => {
  showError('');
  const urls = $('#urls').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!urls.length) return showError('Add at least one address.');
  // Must be requested straight from the click so the browser accepts the user gesture.
  let granted = false;
  try { granted = await chrome.permissions.request({ origins: ['<all_urls>'] }); } catch (e) { granted = false; }
  if (!granted) return showError('Batch capture needs access to the sites you list. Allow it and try again.');
  const res = await chrome.runtime.sendMessage({ type: 'batchStart', urls, outFormat: $('#out').value });
  if (!res || !res.ok) showError((res && res.error) || 'Could not start the batch.');
});
$('#stopBtn').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'stop' }));

chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === 'batchState') render(msg.batch); });
chrome.runtime.sendMessage({ type: 'getBatch' }).then((r) => render(r && r.batch));
