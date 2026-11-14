// Settings merge rules: shortcut overrides (set / unassign / reset), theme, expiry safety.
let store = {};
globalThis.chrome = { storage: { local: {
  get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : { ...store }),
  set: async (o) => { Object.assign(store, structuredClone(o)); }
} } };
const { getSettings, saveSettings, EXPIRY_OPTIONS } = await import('../lib/settings.js');
const { Keymap } = await import('../lib/shortcuts.js');
let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };

let s = await getSettings();
ok(s.theme === 'system' && Object.keys(s.shortcuts).length === 0, 'defaults: system theme, no shortcut overrides');
await saveSettings({ theme: 'dark' });
ok((await getSettings()).theme === 'dark', 'theme persists');
await saveSettings({ shortcuts: { 'viewer.edit': 'Mod+E' } });
await saveSettings({ shortcuts: { 'viewer.favourite': '' } });
s = await getSettings();
let km = new Keymap('viewer', s.shortcuts);
ok(km.combo('viewer.edit') === 'Mod+E' && km.combo('viewer.favourite') === '', 'overrides accumulate across saves');
await saveSettings({ shortcuts: { 'viewer.edit': null } });
s = await getSettings(); km = new Keymap('viewer', s.shortcuts);
ok(km.combo('viewer.edit') === 'E' && km.combo('viewer.favourite') === '', 'null resets one task, others keep their override');
await saveSettings({ theme: 'light', pdf: { ocr: false } });
s = await getSettings();
ok(s.theme === 'light' && s.shortcuts['viewer.favourite'] === '' && s.pdf.ocr === false && s.pdf.paper === 'a4', 'unrelated saves keep everything else');
store.settings.expiryMs = 0;
const after = await getSettings();
ok(EXPIRY_OPTIONS.some((o) => o.ms === after.expiryMs), 'an invalid expiry (e.g. "never") falls back to a timed option');
console.log(fails ? fails + ' FAILED' : 'settings checks passed');
process.exit(fails ? 1 : 0);
