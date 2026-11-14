// IndexedDB storage for captures. Works in pages and in the service worker.
// "captures": metadata + small thumbnail, "images": the full-size PNG blob.

const DB_NAME = 'open-page-capture';
const DB_VERSION = 1;
let dbPromise;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('captures')) {
        db.createObjectStore('captures', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

async function run(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(tx)).then((r) => { result = r; }, (e) => { try { tx.abort(); } catch {} reject(e); });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

const reqP = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

export async function addCapture(meta, imageBlob) {
  await run(['captures', 'images'], 'readwrite', (tx) => {
    tx.objectStore('captures').put(meta);
    tx.objectStore('images').put({ id: meta.id, blob: imageBlob });
  });
  return meta;
}

export async function listCaptures() {
  const all = await run(['captures'], 'readonly', (tx) => reqP(tx.objectStore('captures').getAll()));
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getCapture(id) {
  return run(['captures'], 'readonly', (tx) => reqP(tx.objectStore('captures').get(id)));
}

export async function getImage(id) {
  const row = await run(['images'], 'readonly', (tx) => reqP(tx.objectStore('images').get(id)));
  return row ? row.blob : null;
}

export async function updateCapture(id, patch) {
  return run(['captures'], 'readwrite', async (tx) => {
    const store = tx.objectStore('captures');
    const cur = await reqP(store.get(id));
    if (!cur) return null;
    const next = { ...cur, ...patch };
    store.put(next);
    return next;
  });
}

// Replace the full-size image (used by the editor). `patch` updates metadata in the same transaction.
export async function replaceImage(id, blob, patch = {}) {
  return run(['captures', 'images'], 'readwrite', async (tx) => {
    const store = tx.objectStore('captures');
    const cur = await reqP(store.get(id));
    if (!cur) return null;
    const next = { ...cur, ...patch, size: blob.size };
    store.put(next);
    tx.objectStore('images').put({ id, blob });
    return next;
  });
}

// Starring removes the expiry. Un-starring restarts the timer from now.
export async function setFavourite(id, favourite, timeoutMs) {
  return updateCapture(id, {
    favourite: !!favourite,
    expiresAt: favourite ? null : Date.now() + timeoutMs
  });
}

export async function deleteCaptures(ids) {
  await run(['captures', 'images'], 'readwrite', (tx) => {
    for (const id of ids) {
      tx.objectStore('captures').delete(id);
      tx.objectStore('images').delete(id);
    }
  });
}

// Deletes every non-favourite capture whose expiry has passed. Returns the number removed.
export async function purgeExpired(now = Date.now()) {
  const all = await listCaptures();
  const dead = all.filter((c) => !c.favourite && c.expiresAt != null && c.expiresAt <= now).map((c) => c.id);
  if (dead.length) await deleteCaptures(dead);
  return dead.length;
}

export async function deleteNonFavourites() {
  const all = await listCaptures();
  const dead = all.filter((c) => !c.favourite).map((c) => c.id);
  if (dead.length) await deleteCaptures(dead);
  return dead.length;
}
