// Light / Dark / System theme. Import this module on every page: it applies the saved choice,
// keeps pages in sync when it changes, and turns every [data-theme-toggle] element into a button.

import { icon } from './icons.js';

export const THEMES = ['system', 'light', 'dark'];
const LABEL = { system: 'System', light: 'Light', dark: 'Dark' };
const ICON = { system: 'monitor', light: 'sun', dark: 'moon' };
let current = 'system';
const listeners = new Set();

function apply(theme) {
  current = THEMES.includes(theme) ? theme : 'system';
  const root = document.documentElement;
  if (current === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', current);
  try { localStorage.setItem('opcTheme', current); } catch (e) { /* ignore */ }
  paintToggles();
  listeners.forEach((fn) => fn(current));
}

export const getTheme = () => current;
export const onThemeChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export async function setTheme(theme) {
  apply(theme);
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...(settings || {}), theme: current } });
}

export const nextTheme = (t = current) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];

function paintToggles() {
  document.querySelectorAll('[data-theme-toggle]').forEach((host) => {
    let b = host.querySelector('button');
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-btn';
      b.addEventListener('click', () => setTheme(nextTheme()));
      host.replaceChildren(b);
      host.style.display = 'contents';
    }
    const size = Number(host.dataset.size) || 19;
    b.innerHTML = icon(ICON[current], size);
    b.title = `Theme: ${LABEL[current]} (click for ${LABEL[nextTheme()]})`;
    b.setAttribute('aria-label', `Theme: ${LABEL[current]}. Switch to ${LABEL[nextTheme()]}`);
  });
}

async function init() {
  const { settings } = await chrome.storage.local.get('settings');
  apply((settings && settings.theme) || 'system');
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const t = (changes.settings.newValue && changes.settings.newValue.theme) || 'system';
    if (t !== current) apply(t);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
