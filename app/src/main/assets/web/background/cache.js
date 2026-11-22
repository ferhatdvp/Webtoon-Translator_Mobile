// background/cache.js — IndexedDB önbelleği.
// Üç tür anahtar kullanılır:  u:<url-hash>  (aynı URL, indirmeye bile gerek yok)
//                             h:<içerik-hash> (farklı URL'de aynı görsel)
//                             t:<içerik-hash>:<parça>  (yarım kalan uzun görselin parçaları)
import { normalizeSourceLanguage } from '../shared/languages.js';

const DB_NAME = 'wtt-cache';
const STORE = 'results';
const PAGES = 'pages';
const MAX_ENTRIES = 3000;

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('lastUsed', 'lastUsed');
        }
        if (!req.result.objectStoreNames.contains(PAGES)) {
          req.result.createObjectStore(PAGES, { keyPath: 'url' });
        }
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
  const tx = db.transaction([STORE, PAGES], 'readwrite');
  const done = txDone(tx);
  tx.objectStore(STORE).clear();
  tx.objectStore(PAGES).clear();
  await done;
}

/** Sayfa kaydı yalnızca gerçekten saklanan çeviri anahtarlarına bağlanır. */
export async function rememberCachedPage(pageUrl, imageKey, title = '') {
  let url;
  try { url = new URL(pageUrl); } catch { return; }
  if (!/^https?:$/.test(url.protocol)) return;
  url.hash = '';
  const db = await open();
  const tx = db.transaction(PAGES, 'readwrite');
  const done = txDone(tx);
  const pages = tx.objectStore(PAGES);
  const request = pages.get(url.href);
  request.onsuccess = () => {
    const previous = request.result;
    const keys = new Set(previous?.keys || []);
    keys.add(imageKey);
    pages.put({
      url: url.href, title: title.slice(0, 200) || previous?.title || url.hostname,
      updatedAt: Date.now(), keys: [...keys],
    });
  };
  await done;
}

/** Silinmiş veya tahliye edilmiş sonuçlar listede önbellekteymiş gibi gösterilmez. */
export async function cachedPages(sourceLanguage = 'en') {
  const db = await open();
  const tx = db.transaction([STORE, PAGES]);
  const done = txDone(tx);
  const [keys, pages] = await Promise.all([
    wrap(tx.objectStore(STORE).getAllKeys()),
    wrap(tx.objectStore(PAGES).getAll()),
  ]);
  await done;
  const language = normalizeSourceLanguage(sourceLanguage);
  const available = new Set(keys.filter((key) => {
    const parts = key.split(':');
    return (parts[0] === 'u' || parts[0] === 'h') && parts[1] === String(PIPELINE_VERSION) &&
      (language === 'en' ? parts.length === 3 : parts[2] === language);
  }));
  return pages.map((page) => ({
    url: page.url, title: page.title, updatedAt: page.updatedAt,
    imageCount: page.keys.filter((key) => available.has(key)).length,
  })).filter((page) => page.imageCount > 0).sort((a, b) => b.updatedAt - a.updatedAt);
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

function languagePrefix(sourceLanguage) {
  const language = normalizeSourceLanguage(sourceLanguage);
  // Önceki İngilizce çevirilerin anahtarlarını koru.
  return language === 'en' ? '' : language + ':';
}

export async function urlKey(url, sourceLanguage = 'en') {
  const bytes = new TextEncoder().encode(normalizeUrlForCache(url));
  return `u:${PIPELINE_VERSION}:${languagePrefix(sourceLanguage)}${await sha256Hex(bytes)}`;
}

export const hashKey = (hash, language = 'en') => `h:${PIPELINE_VERSION}:${languagePrefix(language)}${hash}`;
export const tileKey = (hash, tile, language = 'en') => `t:${PIPELINE_VERSION}:${languagePrefix(language)}${hash}:${tile.index}/${tile.count}`;
