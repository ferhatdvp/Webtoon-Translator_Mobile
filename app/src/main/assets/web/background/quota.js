// background/quota.js — günlük istek sayacı ve "kota doldu" işareti.
// Gemini ücretsiz kotası Pasifik saatiyle gece yarısı sıfırlanır; sayaç da aynı güne göre tutulur.

import { AppError, ERR } from '../shared/errors.js';

const KEY = 'usage';
let lock = Promise.resolve();

function withLock(fn) {
  const p = lock.then(fn);
  lock = p.catch(() => {});
  return p;
}

export function pacificDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
}

async function load() {
  const { usage } = await chrome.storage.local.get(KEY);
  const day = pacificDay();
  if (!usage || usage.day !== day) return { day, counts: {}, blocked: {} };
  return { day, counts: usage.counts || {}, blocked: usage.blocked || {} };
}

export function getUsage() {
  return withLock(load);
}

/**
 * Bir API isteği harcamadan ÖNCE çağrılır.
 * - Model bugün "kota doldu" diye işaretlendiyse QUOTA_DAILY fırlatır.
 * - allowPaid kapalıyken kullanıcının koyduğu günlük sınır aşıldıysa LOCAL_CAP fırlatır.
 */
export function reserve(model, { dailyRequestCap, allowPaid }) {
  return withLock(async () => {
    const u = await load();
    if (u.blocked[model]) throw new AppError(ERR.QUOTA_DAILY);
    const n = u.counts[model] || 0;
    if (!allowPaid && n >= dailyRequestCap) {
      throw new AppError(ERR.LOCAL_CAP, `Günlük istek sınırına (${dailyRequestCap}) ulaşıldı. Ücretli kullanıma geçilmedi.`);
    }
    u.counts[model] = n + 1;
    await chrome.storage.local.set({ [KEY]: u });
    return u.counts[model];
  });
}

/** Sunucu isteği kota nedeniyle reddettiyse (429) sayaçtan geri al: reddedilen istek kota harcamaz. */
export function release(model) {
  return withLock(async () => {
    const u = await load();
    if (u.counts[model] > 0) u.counts[model] -= 1;
    await chrome.storage.local.set({ [KEY]: u });
  });
}

export function markBlocked(model) {
  return withLock(async () => {
    const u = await load();
    u.blocked[model] = true;
    await chrome.storage.local.set({ [KEY]: u });
  });
}

export function isBlocked(model) {
  return withLock(async () => Boolean((await load()).blocked[model]));
}

export function resetBlocks() {
  return withLock(async () => {
    const u = await load();
    u.blocked = {};
    await chrome.storage.local.set({ [KEY]: u });
  });
}
