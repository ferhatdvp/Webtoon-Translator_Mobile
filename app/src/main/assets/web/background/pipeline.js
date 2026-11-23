// background/pipeline.js — bir görseli uçtan uca işler:
//   önbellek → indir → içerik hash'i → parçalara böl → sağlayıcı (Gemini / Ollama) → birleştir → önbelleğe yaz
//
// Ücretli kullanıma karşı korumalar burada uygulanır:
//   • Gemini için "ücretsiz katman onayı" yoksa istek hiç gönderilmez.
//   • Günlük yerel sınır (allowPaid kapalıyken) aşılırsa istek gönderilmez.
//   • 429 / kota hatasında dur: başka bir sağlayıcıya ya da ücretli plana kendiliğinden geçilmez.
//   • Tek istisna: kullanıcının kendi tanımladığı yedek Gemini modeli (ücretsiz katmanda ayrı kota).

import { AppError, ERR } from '../shared/errors.js';
import { getSettings } from '../shared/settings.js';
import { normalizeSourceLanguage } from '../shared/languages.js';
import { dedupe, ownedByTile, planTiles, sortReadingOrder, tileToGlobal } from '../shared/geometry.js';
import { cacheGet, cachePut, hashKey, rememberCachedPage, sha256Hex, tileKey, urlKey } from './cache.js';
import { dataUrlToBuffer, fetchImageBuffer } from './net.js';
import { decode, renderTile } from './image.js';
import { callGemini, disableThinkingConfig } from './providers/gemini.js';
import { logRequest } from './log.js';
import { callOllama } from './providers/ollama.js';
import { isBlocked, markBlocked, release, reserve } from './quota.js';
import { noteCooldown, noteRateLimited, noteSuccess, schedule } from './scheduler.js';

const GEMINI_TILE_WIDTH = 1000;
const OLLAMA_TILE_WIDTH = 896;
const inflight = new Map();
const unavailableUntil = new Map();
const MODEL_COOLDOWN_MS = 30000;

export function assertProviderReady(settings) {
  if (settings.provider === 'gemini') {
    if (!settings.gemini.apiKey) throw new AppError(ERR.NO_API_KEY);
    if (!settings.gemini.confirmedFreeTier && !settings.limits.allowPaid) {
      throw new AppError(ERR.FREE_TIER_UNCONFIRMED);
    }
  }
}

/** Aynı görsel için eşzamanlı istekleri tek işe indirger. */
export async function translateImage(req) {
  const current = await getSettings();
  const settings = { ...current, sourceLanguage: normalizeSourceLanguage(req.sourceLanguage ?? current.sourceLanguage) };
  const id = settings.sourceLanguage + ':' + req.url;
  let p = !req.force && inflight.get(id);
  if (!p) {
    p = doTranslate(req, settings).finally(() => {
      if (inflight.get(id) === p) inflight.delete(id);
    });
    inflight.set(id, p);
  }
  return p.then(async ({ cacheKey, ...result }) => {
    if (cacheKey) {
      await rememberCachedPage(req.pageUrl, cacheKey, req.pageTitle).catch((error) => {
        console.warn('[WTT] Sayfa önbellek kaydı:', error);
      });
    }
    return result;
  });
}

async function doTranslate({ url, pageUrl, dataUrl, force = false }, settings) {
  assertProviderReady(settings);

  const uKey = dataUrl ? null : await urlKey(url, settings.sourceLanguage);
  if (!force && uKey) {
    const hit = await cacheGet(uKey);
    if (hit) return { boxes: hit.boxes, cached: true, cacheKey: uKey };
  }

  const { buf, mime } = dataUrl ? dataUrlToBuffer(dataUrl) : await fetchImageBuffer(url, pageUrl);
  const hash = await sha256Hex(buf);
  const hKey = hashKey(hash, settings.sourceLanguage);

  if (!force) {
    const hit = await cacheGet(hKey);
    if (hit) {
      if (uKey) await cachePut(uKey, hit);
      return { boxes: hit.boxes, cached: true, cacheKey: uKey || hKey };
    }
  }

  let bitmap;
  try {
    bitmap = await decode(buf, mime);
  } catch {
    throw new AppError(ERR.IMAGE_FETCH, 'Görsel çözümlenemedi (desteklenmeyen biçim).');
  }

  try {
    const { minImageWidth, minImageHeight } = settings.render;
    if (bitmap.width < minImageWidth || bitmap.height < minImageHeight) {
      return { boxes: [], skipped: true, cached: false };
    }

    const tiles = planTiles(bitmap.width, bitmap.height);
    const maxWidth = settings.provider === 'ollama' ? OLLAMA_TILE_WIDTH : GEMINI_TILE_WIDTH;
    const collected = [];
    const warnings = new Set();
    let usedModel = settings.provider === 'gemini' ? settings.gemini.model : settings.ollama.model;

    for (const tile of tiles) {
      const tKey = tileKey(hash, tile, settings.sourceLanguage);
      let items = null;
      if (!force) items = (await cacheGet(tKey))?.items ?? null;

      if (!items) {
        const img = await renderTile(bitmap, tile, maxWidth);
        const r = await runProvider(img, settings);
        items = r.items;
        if (r.warning) warnings.add(r.warning);
        if (r.model) usedModel = r.model;
        // Uyarılı (ör. güvenlik filtresi) parçalar önbelleğe alınmaz; sonra yeniden denenebilsin.
        if (!r.warning) await cachePut(tKey, { items });
      }

      for (const it of items) {
        const box = tileToGlobal(it.box, tile, bitmap.height);
        if (ownedByTile(box, tile, bitmap.height)) collected.push({ ...it, box });
      }
    }

    const boxes = sortReadingOrder(dedupe(collected));
    const value = { boxes, meta: { provider: settings.provider, model: usedModel, sourceLanguage: settings.sourceLanguage, at: Date.now() } };
    if (warnings.size === 0) {
      await cachePut(hKey, value);
      if (uKey) await cachePut(uKey, value);
    }
    return {
      boxes, cached: false, cacheKey: warnings.size === 0 ? uKey || hKey : null,
      warning: [...warnings].join(' ') || undefined,
    };
  } finally {
    bitmap.close?.();
  }
}

// ---------------------------------------------------------------- sağlayıcılar

async function runProvider(img, settings) {
  if (settings.provider === 'ollama') {
    const { endpoint, model, coordMode } = settings.ollama;
    // Yerel model: kota yok, ama GPU'yu boğmamak için yine tek tek çalışır.
    const r = await schedule(0, () =>
      callOllama({
        base64: img.base64,
        width: img.width,
        height: img.height,
        endpoint,
        model,
        coordMode,
        glossary: settings.glossary,
        sourceLanguage: settings.sourceLanguage,
      }),
    );
    return { ...r, model };
  }
  return runGemini(img, settings);
}

export async function runGemini(img, settings) {
  const { model, fallbackModel } = settings.gemini;
  const models = [...new Set([model, fallbackModel].filter(Boolean))];
  let lastErr = null;
  let retryAt = Infinity;

  for (const m of models) {
    const unavailable = unavailableUntil.get(m) || 0;
    if (unavailable > Date.now()) {
      retryAt = Math.min(retryAt, unavailable);
      continue;
    }
    if (await isBlocked(m)) {
      lastErr = new AppError(ERR.QUOTA_DAILY);
      continue;
    }
    try {
      const r = await geminiWithRetry(m, img, settings);
      unavailableUntil.delete(m);
      return { ...r, model: m };
    } catch (e) {
      if (e instanceof AppError && (e.code === ERR.SERVER || e.code === ERR.SERVICE_BUSY)) {
        const until = Date.now() + (e.retryAfterMs || MODEL_COOLDOWN_MS);
        unavailableUntil.set(m, until);
        retryAt = Math.min(retryAt, until);
        continue;
      }
      // Kalıcı kota sınırında da yalnızca kullanıcının seçtiği yedek model denenir.
      if (e instanceof AppError && (e.code === ERR.QUOTA_DAILY || e.code === ERR.LOCAL_CAP)) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  if (Number.isFinite(retryAt)) {
    throw new AppError(ERR.SERVICE_BUSY, undefined, { retryAfterMs: Math.max(5000, retryAt - Date.now()) });
  }
  throw lastErr || new AppError(ERR.QUOTA_DAILY);
}

async function geminiWithRetry(model, img, settings) {
  const { apiKey } = settings.gemini;
  let attempt = 0;
  for (;;) {
    let reserved = false;
    const t0 = Date.now();
    try {
      // Sayaç, istek gerçekten gönderilmeden hemen önce (kuyruk sırası gelince) artar.
      const r = await schedule(settings.limits.minIntervalMs, async () => {
        const wait = (unavailableUntil.get(model) || 0) - Date.now();
        if (wait > 0) throw new AppError(ERR.SERVICE_BUSY, undefined, { retryAfterMs: wait });
        await reserve(model, settings.limits); // LOCAL_CAP burada fırlar
        reserved = true;
        try {
          return await callGemini({
            base64: img.base64, mime: img.mime, apiKey, model, glossary: settings.glossary,
            sourceLanguage: settings.sourceLanguage,
          });
        } catch (err) {
          // Soğuma, kuyruktaki SONRAKİ istek başlamadan önce ayarlanmalı (yarış durumunu önler).
          if (err?.code === ERR.QUOTA_MINUTE) noteRateLimited(err.retryAfterMs ?? 30000);
          else if (err?.code === ERR.SERVER) noteCooldown(3000);
          throw err;
        }
      });
      noteSuccess();
      logRequest({ model, ok: true, ms: Date.now() - t0, items: r.items.length, note: r.warning });
      return r;
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      if (e.code !== ERR.LOCAL_CAP && e.code !== ERR.SERVICE_BUSY) {
        logRequest({ model, ok: false, code: e.code, status: e.status, ms: Date.now() - t0, retryAfterMs: e.retryAfterMs, note: e.detail || e.message });
      }

      // Aynı yoğun modeli art arda tüketmek yerine runGemini yedeğe geçsin veya bekletsin.
      if (e.code === ERR.SERVER || e.code === ERR.SERVICE_BUSY) throw e;

      if (e.code === ERR.QUOTA_DAILY) {
        if (reserved) await release(model);
        await markBlocked(model);
        throw e;
      }

      if (e.code === ERR.QUOTA_MINUTE) {
        if (reserved) await release(model); // reddedilen istek kota harcamaz
        const wait = e.retryAfterMs ?? 30000; // soğuma schedule() içinde zaten ayarlandı
        if (attempt < 3 && wait <= 70000) {
          attempt++;
          continue; // bekleme schedule() içinde ortak yapılır
        }
        e.retryAfterMs = wait;
        throw e;
      }

      // Model "thinkingConfig" alanını tanımıyorsa alanı kapatıp bir kez daha dene.
      if (e.code === ERR.BAD_RESPONSE && e.status === 400 && /thinking/i.test(e.message) && attempt < 3) {
        disableThinkingConfig();
        attempt++;
        continue;
      }

      if (e.code === ERR.BAD_RESPONSE && attempt < 2) {
        attempt++;
        noteCooldown(2000 * attempt * attempt); // kısa ortak bekleme
        continue;
      }
      throw e;
    }
  }
}
