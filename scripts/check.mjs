// Static sanity check: every file the manifest, HTML pages and ES module imports point to must exist.
import fs from 'node:fs';
import path from 'node:path';
const root = new URL('../', import.meta.url).pathname;
let bad = 0;
const exists = (rel, from) => {
  const p = path.resolve(path.dirname(from), rel);
  if (!fs.existsSync(p)) { console.log('MISSING', path.relative(root, from), '->', rel); bad++; }
};
const m = JSON.parse(fs.readFileSync(root + 'manifest.json', 'utf8'));
const mf = root + 'manifest.json';
const rels = [m.background.service_worker, m.action.default_popup, m.options_ui.page, ...Object.values(m.icons), ...Object.values(m.action.default_icon)];
rels.forEach((r) => exists(r, mf));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (['node_modules', 'vendor', 'tests'].includes(e.name) ? [] : e.isDirectory() ? walk(d + e.name + '/') : [d + e.name]));
for (const f of walk(root)) {
  const src = fs.readFileSync(f, 'utf8');
  if (f.endsWith('.html')) for (const mm of src.matchAll(/(?:src|href)="([^"#]+)"/g)) if (!/^(https?:|chrome)/.test(mm[1])) exists(mm[1], f);
  if (f.endsWith('.js')) {
    for (const mm of src.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)) exists(mm[1], f);
    for (const mm of src.matchAll(/(?:files:\s*\[|loadScript\(|getURL\()\s*'([^']+)'/g)) {
      const rel = mm[1].split('?')[0];
      if (/\.(js|html)$/.test(rel)) { const p = path.resolve(root, rel); if (!fs.existsSync(p)) { console.log('MISSING', path.relative(root, f), '->', rel); bad++; } }
    }
  }
}
// pixels may only be read back through lib/canvas.js (keeps Chrome's willReadFrequently warning away)
for (const f of walk(root)) {
  if (!f.endsWith('.js') || f.endsWith('lib/canvas.js')) continue;
  const src = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
  if (/\.getImageData\s*\(/.test(src)) { console.log('DIRECT getImageData', path.relative(root, f), '(use readPixels from lib/canvas.js)'); bad++; }
}

// every $('#id') used by a page script must exist in that page's HTML
for (const dir of ['popup', 'viewer', 'editor', 'history', 'options', 'batch', 'verify']) {
  const html = fs.readFileSync(`${root}${dir}/${dir}.html`, 'utf8');
  const js = fs.readFileSync(`${root}${dir}/${dir}.js`, 'utf8');
  const dynamic = new Set(['content']); // created by the script itself
  for (const mm of js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)) {
    if (!html.includes(`id="${mm[1]}"`) && !dynamic.has(mm[1]) && !js.includes(`id: '${mm[1]}'`)) { console.log('NO ELEMENT', dir, '#' + mm[1]); bad++; }
  }
}
console.log(bad ? `${bad} problem(s)` : 'all references resolve');
process.exit(bad ? 1 : 0);
