import { comboFromEvent, comboParts, formatCombo, Keymap, findConflict, ACTIONS, SCOPES, actionsOf, GLOBAL_COMMANDS } from '../lib/shortcuts.js';
let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };
const ev = (key, o = {}) => ({ key, code: o.code || '', ctrlKey: !!o.ctrl, metaKey: !!o.meta, altKey: !!o.alt, shiftKey: !!o.shift });

ok(comboFromEvent(ev('s', { ctrl: true })) === 'Mod+S', 'Ctrl+S');
ok(comboFromEvent(ev('s', { meta: true })) === 'Mod+S', 'Cmd+S is the same as Ctrl+S');
ok(comboFromEvent(ev('Z', { ctrl: true, shift: true })) === 'Mod+Shift+Z', 'Ctrl+Shift+Z');
ok(comboFromEvent(ev('Shift', { shift: true })) === '', 'a lone modifier is ignored');
ok(comboFromEvent(ev('=')) === '+' && comboFromEvent(ev('+', { shift: true })) === '+', '"=" and Shift+"=" both mean "+"');
ok(comboFromEvent(ev('/')) === '/' && comboFromEvent(ev('?', { shift: true })) === '?', 'symbols drop the implied Shift');
ok(comboFromEvent(ev('¡', { alt: true, ctrl: true, code: 'Digit1' })) === 'Mod+Alt+1', 'Alt+digit uses the physical key (macOS Option)');
ok(comboFromEvent(ev('Delete')) === 'Delete' && comboFromEvent(ev('Enter', { ctrl: true })) === 'Mod+Enter', 'named keys');
ok(comboFromEvent(ev('a')) === 'A', 'plain letters are upper-cased');

// every scope: defaults are unique and aliases do not collide with defaults
for (const s of SCOPES) {
  const defs = actionsOf(s.id).map((a) => a.def);
  const alts = actionsOf(s.id).flatMap((a) => a.alt || []);
  ok(new Set(defs).size === defs.length, `${s.id}: no duplicate default keys`);
  ok(alts.every((x) => !defs.includes(x)), `${s.id}: aliases do not collide with defaults`);
}
ok(ACTIONS.every((a) => a.def && a.label && a.scope), 'every task has a default key and a label');
ok(GLOBAL_COMMANDS.length === 4 && new Set(GLOBAL_COMMANDS.map((c) => c.def)).size === 4, 'four distinct browser-wide defaults');

const km = new Keymap('viewer', {});
ok(km.match(ev('Delete')) === 'viewer.delete' && km.match(ev('Backspace')) === 'viewer.delete', 'viewer delete has Delete + Backspace');
ok(km.match(ev('c', { ctrl: true })) === 'viewer.copy' && km.match(ev('e')) === 'viewer.edit', 'viewer defaults match');
const km2 = new Keymap('viewer', { 'viewer.edit': 'Mod+E', 'viewer.favourite': '', 'viewer.copy': null });
ok(km2.match(ev('e')) === null && km2.match(ev('e', { ctrl: true })) === 'viewer.edit', 'rebinding replaces the default');
ok(km2.match(ev('f')) === null && km2.combo('viewer.favourite') === '', 'an empty override unassigns');
ok(km2.match(ev('c', { ctrl: true })) === 'viewer.copy', 'null override falls back to the default');
const editor = new Keymap('editor', { 'editor.undo': 'Mod+Y' });
ok(editor.match(ev('y', { ctrl: true })) === 'editor.redo' || editor.match(ev('y', { ctrl: true })) === 'editor.undo', 'collision resolves to one action');
ok(findConflict('editor', 'Mod+S', 'editor.done')?.id === 'editor.save', 'conflict detection finds the other task');
ok(findConflict('editor', 'Mod+S', 'editor.save') === null, 'a task does not conflict with itself');
ok(findConflict('history', 'Mod+S', 'viewer.save') !== null && findConflict('viewer', 'Mod+Q', 'viewer.save') === null, 'conflicts are per scope');
ok(formatCombo('Mod+Shift+Z') === 'Ctrl+Shift+Z' && comboParts('Mod++').join('|') === 'Ctrl|+', 'formatting incl. the "+" key');
ok(formatCombo('') === 'Not set', 'unassigned label');
console.log(fails ? fails + ' FAILED' : 'shortcut checks passed');
process.exit(fails ? 1 : 0);
