import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../content/capture-helper.js', import.meta.url), 'utf8');
const dom = new JSDOM(`<!doctype html><body>
  <header id="hdr" style="position:static">H</header>
  <aside id="side" style="position:sticky; top:64px">S</aside>
  <table><thead id="th" style="position:sticky; top:0">T</thead></table>
  <div id="fixed" style="position:fixed; bottom:0">F</div>
  <p id="p">content</p></body>`, { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
Object.defineProperty(w.document.documentElement, 'clientWidth', { value: 1000 });
Object.defineProperty(w.document.documentElement, 'clientHeight', { value: 700 });
Object.defineProperty(w.document.documentElement, 'scrollHeight', { value: 3000 });
w.scrollTo = () => {};
w.eval(src);
const $ = (id) => w.document.getElementById(id);
// pretend layout: side is stuck at top:64, thead is NOT stuck (natural position y=500), header is at y=0 (static)
const rect = (top, h = 40) => () => ({ top, bottom: top + h, left: 0, right: 100, width: 100, height: h });
$('side').getBoundingClientRect = rect(64);
$('th').getBoundingClientRect = rect(500);
let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };

const info = w.__opc.init({ forceWindow: false });
ok(info.mode === 'window', 'window mode');
await w.__opc.scrollTo(0, 0, { hideFixed: false });
ok($('fixed').style.visibility === '', 'first frame keeps fixed elements visible');
await w.__opc.scrollTo(0, 700, { hideFixed: true });
ok($('fixed').style.visibility === 'hidden', 'fixed element hidden on later frames');
ok($('side').style.visibility === 'hidden', 'stuck sticky sidebar hidden');
ok($('th').style.visibility === '', 'sticky element at its natural position stays visible');
// the site turns its header fixed only after scrolling
$('hdr').style.position = 'fixed';
await w.__opc.scrollTo(0, 1400, { hideFixed: true });
ok($('hdr').style.visibility === 'hidden', 'header that becomes fixed after scrolling is hidden');
// the table header becomes stuck further down
$('th').getBoundingClientRect = rect(0);
await w.__opc.scrollTo(0, 2100, { hideFixed: true });
ok($('th').style.visibility === 'hidden', 'table header hidden once it is stuck');
w.__opc.cleanup();
ok(['hdr', 'side', 'th', 'fixed'].every((i) => $(i).style.visibility === ''), 'cleanup restores everything');
console.log(fails ? fails + ' FAILED' : 'helper checks passed');
process.exit(fails ? 1 : 0);
