// In-app keyboard shortcuts: every task has a default key that can be changed in Settings.
// Combos are stored as strings such as "Mod+S", "Mod+Shift+Z", "Delete", "F".
//   Mod   = Ctrl on Windows/Linux, Command on macOS
// The four browser-wide capture shortcuts live in the manifest ("commands") and are changed in
// chrome://extensions/shortcuts; they are listed here only so Settings can show them.

import { getSettings } from './settings.js';

const nav = typeof navigator !== 'undefined' ? navigator : {};
export const IS_MAC = /Mac|iPhone|iPad/i.test((nav.platform || '') + ' ' + (nav.userAgent || ''));

export const SCOPES = [
  { id: 'viewer', label: 'Viewer', desc: 'On a capture after you take it' },
  { id: 'editor', label: 'Editor', desc: 'While annotating a capture' },
  { id: 'history', label: 'Your captures', desc: 'On the captures page' }
];

export const GLOBAL_COMMANDS = [
  { name: 'capture-visible', label: 'Capture visible area', def: 'Alt+Shift+V' },
  { name: 'capture-full', label: 'Capture full page', def: 'Alt+Shift+F' },
  { name: 'capture-select', label: 'Capture selected area', def: 'Alt+Shift+S' },
  { name: 'open-history', label: 'Open Your captures', def: 'Alt+Shift+H' }
];

// `alt` are extra fixed keys for the same task (not shown, not editable).
export const ACTIONS = [
  // Viewer
  { id: 'viewer.save', scope: 'viewer', label: 'Save in the default format', def: 'Mod+S' },
  { id: 'viewer.savePng', scope: 'viewer', label: 'Save as PNG', def: 'Mod+Alt+1' },
  { id: 'viewer.saveJpeg', scope: 'viewer', label: 'Save as JPEG', def: 'Mod+Alt+2' },
  { id: 'viewer.saveGif', scope: 'viewer', label: 'Save as GIF', def: 'Mod+Alt+3' },
  { id: 'viewer.savePdf', scope: 'viewer', label: 'Save as PDF', def: 'Mod+Alt+4' },
  { id: 'viewer.copy', scope: 'viewer', label: 'Copy image', def: 'Mod+C' },
  { id: 'viewer.print', scope: 'viewer', label: 'Print', def: 'Mod+P' },
  { id: 'viewer.edit', scope: 'viewer', label: 'Edit', def: 'E' },
  { id: 'viewer.favourite', scope: 'viewer', label: 'Favourite / unfavourite', def: 'F' },
  { id: 'viewer.delete', scope: 'viewer', label: 'Delete capture', def: 'Delete', alt: ['Backspace'] },
  { id: 'viewer.history', scope: 'viewer', label: 'Open Your captures', def: 'H' },
  { id: 'viewer.zoomIn', scope: 'viewer', label: 'Zoom in', def: '+' },
  { id: 'viewer.zoomOut', scope: 'viewer', label: 'Zoom out', def: '-' },
  { id: 'viewer.zoomFit', scope: 'viewer', label: 'Fit to width', def: '0' },
  { id: 'viewer.zoom100', scope: 'viewer', label: 'Zoom to 100%', def: '1' },

  // Editor
  { id: 'editor.save', scope: 'editor', label: 'Save changes', def: 'Mod+S' },
  { id: 'editor.done', scope: 'editor', label: 'Save and finish', def: 'Mod+Enter' },
  { id: 'editor.copy', scope: 'editor', label: 'Copy saved image', def: 'Mod+C' },
  { id: 'editor.undo', scope: 'editor', label: 'Undo', def: 'Mod+Z' },
  { id: 'editor.redo', scope: 'editor', label: 'Redo', def: 'Mod+Y', alt: ['Mod+Shift+Z'] },
  { id: 'editor.delete', scope: 'editor', label: 'Delete selected annotation', def: 'Delete', alt: ['Backspace'] },
  { id: 'editor.zoomIn', scope: 'editor', label: 'Zoom in', def: '+' },
  { id: 'editor.zoomOut', scope: 'editor', label: 'Zoom out', def: '-' },
  { id: 'editor.zoomFit', scope: 'editor', label: 'Fit to width', def: '0' },
  { id: 'editor.tool.select', scope: 'editor', label: 'Tool: Select', def: 'V' },
  { id: 'editor.tool.pen', scope: 'editor', label: 'Tool: Pen', def: 'P' },
  { id: 'editor.tool.hl', scope: 'editor', label: 'Tool: Highlighter', def: 'H' },
  { id: 'editor.tool.line', scope: 'editor', label: 'Tool: Line', def: 'L' },
  { id: 'editor.tool.arrow', scope: 'editor', label: 'Tool: Arrow', def: 'A' },
  { id: 'editor.tool.rect', scope: 'editor', label: 'Tool: Rectangle', def: 'R' },
  { id: 'editor.tool.ellipse', scope: 'editor', label: 'Tool: Ellipse', def: 'O' },
  { id: 'editor.tool.text', scope: 'editor', label: 'Tool: Text', def: 'T' },
  { id: 'editor.tool.pix', scope: 'editor', label: 'Tool: Blur / pixelate', def: 'B' },
  { id: 'editor.tool.crop', scope: 'editor', label: 'Tool: Crop', def: 'C' },

  // Your captures
  { id: 'history.search', scope: 'history', label: 'Search', def: '/' },
  { id: 'history.toggleSelect', scope: 'history', label: 'Start / stop selecting', def: 'S' },
  { id: 'history.selectAll', scope: 'history', label: 'Select all', def: 'Mod+A' },
  { id: 'history.favourite', scope: 'history', label: 'Favourite selected', def: 'F' },
  { id: 'history.download', scope: 'history', label: 'Download selected', def: 'Mod+S' },
  { id: 'history.delete', scope: 'history', label: 'Delete selected', def: 'Delete', alt: ['Backspace'] }
];

export const actionsOf = (scope) => ACTIONS.filter((a) => a.scope === scope);

// Turns a keydown event into a combo string, or '' for a lone modifier key.
export function comboFromEvent(e) {
  let key = e.key;
  if (!key || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'Dead', 'CapsLock'].includes(key)) return '';
  // With Alt held some layouts type another character, so fall back to the physical key.
  if (e.altKey && e.code) {
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  }
  if (key === ' ') key = 'Space';
  if (key === '=') key = '+';   // "=" and "+" share a key, so both mean zoom in
  if (key === '_') key = '-';
  if (key.length === 1) key = key.toUpperCase();
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  const symbol = key.length === 1 && !/[A-Z0-9]/.test(key); // Shift is implied by "+", "?", "/"...
  if (e.shiftKey && !symbol) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

// Parts for drawing key caps: "Mod+Shift+Z" -> ["Ctrl","Shift","Z"] (or ["⌘","⇧","Z"] on a Mac).
export function comboParts(combo) {
  if (!combo) return [];
  const m = /^((?:Mod\+|Alt\+|Shift\+)*)(.+)$/.exec(combo);
  if (!m) return [combo];
  const mods = m[1].split('+').filter(Boolean).map((x) => (x === 'Mod' ? (IS_MAC ? '⌘' : 'Ctrl') : x === 'Alt' ? (IS_MAC ? '⌥' : 'Alt') : IS_MAC ? '⇧' : 'Shift'));
  const names = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Delete: 'Del' };
  return [...mods, names[m[2]] || m[2]];
}

export const formatCombo = (combo) => (combo ? comboParts(combo).join(IS_MAC ? '' : '+') : 'Not set');

export class Keymap {
  constructor(scope, overrides = {}) {
    this.scope = scope;
    this.combos = {};          // action id -> combo currently assigned ('' = none)
    this.byCombo = new Map();  // combo -> action id
    for (const a of actionsOf(scope)) {
      const o = overrides ? overrides[a.id] : undefined;
      const combo = o === undefined || o === null ? a.def : o;
      this.combos[a.id] = combo;
      if (combo) this.byCombo.set(combo, a.id);
    }
    // fixed aliases never override a combo the user has assigned to something else
    for (const a of actionsOf(scope)) for (const alt of a.alt || []) if (!this.byCombo.has(alt)) this.byCombo.set(alt, a.id);
  }
  match(e) { return this.byCombo.get(comboFromEvent(e)) || null; }
  combo(id) { return this.combos[id] || ''; }
  hint(id) { const c = this.combo(id); return c ? ` (${formatCombo(c)})` : ''; }
}

// Another action in the same scope that already uses `combo`, if any.
export function findConflict(scope, combo, exceptId, overrides = {}) {
  const km = new Keymap(scope, overrides);
  for (const a of actionsOf(scope)) {
    if (a.id !== exceptId && (km.combo(a.id) === combo || (a.alt || []).includes(combo))) return a;
  }
  return null;
}

// Loads the user's keymap for a page and keeps it current when Settings change.
export async function loadKeymap(scope, onChange) {
  let km = new Keymap(scope, (await getSettings()).shortcuts);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    getSettings().then((s) => { km = new Keymap(scope, s.shortcuts); if (onChange) onChange(km); });
  });
  return { match: (e) => km.match(e), combo: (id) => km.combo(id), hint: (id) => km.hint(id), get keymap() { return km; } };
}
