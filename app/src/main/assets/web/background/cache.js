// background/cache.js — IndexedDB önbelleği.
// Üç tür anahtar kullanılır:  u:<url-hash>  (aynı URL, indirmeye bile gerek yok)
//                             h:<içerik-hash> (farklı URL'de aynı görsel)
//                             t:<içerik-hash>:<parça>  (yarım kalan uzun görselin parçaları)

const DB_NAME = 'wtt-cache';
const STORE = 'results';
const MAX_ENTRIES = 3000;

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('lastUsed', 'lastUsed');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const txDone = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export async function cacheGet(key) {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const rec = await wrap(store.get(key));
  if (rec) {
    rec.lastUsed = Date.now();
    store.put(rec);
  }
  await txDone(tx);
  return rec ? rec.value : null;
}

export async function cachePut(key, value) {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  const now = Date.now();
  tx.objectStore(STORE).put({ key, value, created: now, lastUsed: now });
  await txDone(tx);
  await prune();
}

async function prune() {
  const db = await open();
  const count = await wrap(db.transaction(STORE).objectStore(STORE).count());
  if (count <= MAX_ENTRIES) return;
  let toDelete = count - MAX_ENTRIES + 200; // biraz pay bırak
  const tx = db.transaction(STORE, 'readwrite');
  const cursorReq = tx.objectStore(STORE).index('lastUsed').openCursor();
  cursorReq.onsuccess = () => {
    const cur = cursorReq.result;
    if (cur && toDelete-- > 0) {
      cur.delete();
      cur.continue();
    }
  };
  await txDone(tx);
}

export async function cacheCount() {
  const db = await open();
  return wrap(db.transaction(STORE).objectStore(STORE).count());
}

export async function cacheClear() {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await txDone(tx);
}

// ---- anahtar yardımcıları ----

export const PIPELINE_VERSION = 1; // istem/ayrıştırma mantığı değişirse artırın: eski önbellek geçersiz olur

export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Görsel uzantılı URL'lerde sorgu dizesini (süreli token vb.) atar; böylece aynı görsel aynı anahtarı üretir. */
export function normalizeUrlForCache(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    if (/\.(jpe?g|png|webp|gif|avif)$/i.test(u.pathname)) u.search = '';
    return u.toString();
  } catch {
    return url;
  }
}

export async function urlKey(url) {
  const bytes = new TextEncoder().encode(normalizeUrlForCache(url));
  return `u:${PIPELINE_VERSION}:${await sha256Hex(bytes)}`;
}

export const hashKey = (hash) => `h:${PIPELINE_VERSION}:${hash}`;
export const tileKey = (hash, tile) => `t:${PIPELINE_VERSION}:${hash}:${tile.index}/${tile.count}`;
