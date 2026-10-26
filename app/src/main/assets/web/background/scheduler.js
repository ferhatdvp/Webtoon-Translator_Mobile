// background/scheduler.js — API isteklerini sıraya dizer (aynı anda 1 istek).
//
//  • İstekler arasına asgari bekleme koyar.
//  • Dakikalık kota hatası (429) alınınca TÜM kuyruk için ortak "soğuma" başlatır: sıradaki istekler
//    boşuna 429 yemek yerine bekler. (Eski sürümde yalnızca hata alan istek bekliyor, diğerleri
//    denemeye devam edip kotayı daha da boğuyordu.)
//  • Her 429'da aralığı otomatik büyütür; başarılı isteklerde yavaş yavaş eski haline döner.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** MV3 service worker uzun beklemelerde uyutulabilir; bekleme boyunca periyodik olarak uyandırır. */
export async function sleepAlive(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(Math.min(20000, Math.max(0, end - Date.now())));
    try {
      await chrome.runtime.getPlatformInfo();
    } catch {
      /* chrome yoksa (test) ya da hata: yoksay */
    }
  }
}

const MIN_PENALTY_MS = 12000; // ilk 429'dan sonra en az bu kadar aralık
const MAX_PENALTY_MS = 60000;

let chain = Promise.resolve();
let lastFinished = 0;
let cooldownUntil = 0;
let penaltyMs = 0;
let baseMs = 0;

export function schedule(minIntervalMs, fn) {
  baseMs = minIntervalMs;
  const p = chain.then(async () => {
    for (;;) {
      const interval = Math.max(minIntervalMs, penaltyMs);
      const wait = Math.max(lastFinished + interval - Date.now(), cooldownUntil - Date.now());
      if (wait <= 0) break;
      await sleepAlive(wait);
    }
    try {
      return await fn();
    } finally {
      lastFinished = Date.now();
    }
  });
  chain = p.catch(() => {});
  return p;
}

/** Dakikalık kota hatası alındı: herkes için soğuma + daha seyrek istek. */
export function noteRateLimited(retryAfterMs) {
  cooldownUntil = Math.max(cooldownUntil, Date.now() + (retryAfterMs ?? 30000) + 1000);
  penaltyMs = Math.min(MAX_PENALTY_MS, Math.max(MIN_PENALTY_MS, penaltyMs * 2));
}

/** Geçici sunucu hatası: yalnızca kısa bir ortak bekleme (aralığı büyütmez). */
export function noteCooldown(ms) {
  cooldownUntil = Math.max(cooldownUntil, Date.now() + ms);
}

/** Başarılı istek: aralığı yavaşça eski haline getir. */
export function noteSuccess() {
  if (!penaltyMs) return;
  penaltyMs = Math.floor(penaltyMs * 0.9);
  if (penaltyMs <= baseMs || penaltyMs < 1000) penaltyMs = 0;
}

export function getPacing() {
  return { cooldownUntil, intervalMs: Math.max(baseMs, penaltyMs), penalized: penaltyMs > 0 };
}

/** Yalnızca testler için. */
export function _resetPacing() {
  chain = Promise.resolve();
  lastFinished = 0;
  cooldownUntil = 0;
  penaltyMs = 0;
}
