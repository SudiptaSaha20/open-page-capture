// Settings live in chrome.storage.local under the "settings" key.

export const EXPIRY_OPTIONS = [
  { ms: 60 * 60 * 1000, label: '1 hour' },
  { ms: 24 * 60 * 60 * 1000, label: '1 day' },
  { ms: 7 * 24 * 60 * 60 * 1000, label: '7 days' },
  { ms: 30 * 24 * 60 * 60 * 1000, label: '30 days' }
];

export const DEFAULTS = {
  fileType: 'png', // png | jpeg | gif | pdf
  jpegQuality: 0.92,
  pauseMs: 150, // extra wait after each scroll (the browser also enforces ~0.5 s between frames)
  waitImagesMs: 0, // 0 = off
  hideFixed: true, // hide sticky/fixed elements after the first frame
  evidence: false,
  theme: 'system', // system | light | dark
  shortcuts: {},   // overrides for in-app shortcuts: { actionId: 'Mod+S' | '' (none) | null (default) }
  expiryMs: 7 * 24 * 60 * 60 * 1000,
  pdf: {
    paper: 'a4', // full | letter | legal | a4
    orientation: 'portrait',
    smartSplit: true,
    links: true,
    ocr: true,
    ocrLang: 'eng',
    stamp: true,
    dateFormat: 'datetime' // datetime | date | none
  },
  downloads: {
    folder: '',
    askWhere: false,
    auto: false
  }
};

function merge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object') {
      out[k] = merge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = merge(DEFAULTS, settings || {});
  // Expiry must always be one of the timed options (there is intentionally no "never").
  if (!EXPIRY_OPTIONS.some((o) => o.ms === s.expiryMs)) s.expiryMs = DEFAULTS.expiryMs;
  return s;
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = merge(current, patch);
  await chrome.storage.local.set({ settings: next });
  return next;
}
