import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><span data-theme-toggle></span><span data-theme-toggle data-size="18"></span></body></html>', { url: 'https://x.test/' });
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
let store = { settings: { theme: 'dark' } };
let onChanged = null;
globalThis.chrome = { storage: {
  local: { get: async () => structuredClone(store), set: async (o) => { Object.assign(store, structuredClone(o)); } },
  onChanged: { addListener: (fn) => { onChanged = fn; } }
} };
let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };
const root = document.documentElement;
const theme = await import('../lib/theme.js');
await new Promise((r) => setTimeout(r, 20));
ok(root.getAttribute('data-theme') === 'dark', 'saved Dark theme is applied on load');
ok(localStorage.getItem('opcTheme') === 'dark', 'mirrored to localStorage for the early script');
const btns = document.querySelectorAll('[data-theme-toggle] button');
ok(btns.length === 2 && /Theme: Dark/.test(btns[0].title), 'every toggle placeholder became a button showing the current theme');
btns[0].click(); await new Promise((r) => setTimeout(r, 20));
ok(theme.getTheme() === 'system' && !root.hasAttribute('data-theme') && store.settings.theme === 'system', 'Dark -> System: attribute removed, setting saved');
btns[0].click(); await new Promise((r) => setTimeout(r, 20));
ok(root.getAttribute('data-theme') === 'light' && store.settings.theme === 'light', 'System -> Light');
btns[1].click(); await new Promise((r) => setTimeout(r, 20));
ok(root.getAttribute('data-theme') === 'dark', 'Light -> Dark (second toggle works too)');
onChanged({ settings: { newValue: { theme: 'light' } } }, 'local');
ok(root.getAttribute('data-theme') === 'light', 'a change made on another page is applied live');
// early script
root.removeAttribute('data-theme'); localStorage.setItem('opcTheme', 'dark');
dom.window.eval(await (await import('node:fs/promises')).readFile(new URL('../lib/theme-init.js', import.meta.url), 'utf8'));
ok(root.getAttribute('data-theme') === 'dark', 'theme-init.js applies the saved theme before first paint');
console.log(fails ? fails + ' FAILED' : 'theme checks passed');
process.exit(fails ? 1 : 0);
