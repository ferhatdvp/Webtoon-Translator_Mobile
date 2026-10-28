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
import { dedupe, ownedByTile, planTiles, sortReadingOrder, tileToGlobal } from '../shared/geometry.js';
import { cacheGet, cachePut, hashKey, sha256Hex, tileKey, urlKey } from './cache.js';
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

export function assertProviderReady(settings) {
  if (settings.provider === 'gemini') {
    if (!settings.gemini.apiKey) throw new AppError(ERR.NO_API_KEY);
    if (!settings.gemini.confirmedFreeTier && !settings.limits.allowPaid) {
      throw new AppError(ERR.FREE_TIER_UNCONFIRMED);
    }
  }
}

/** Aynı görsel için eşzamanlı istekleri tek işe indirger. */
export function translateImage(req) {
  const id = req.url;
  if (!req.force && inflight.has(id)) return inflight.get(id);
  const p = doTranslate(req).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function doTranslate({ url, pageUrl, dataUrl, force = false }) {
  const settings = await getSettings();
  assertProviderReady(settings);

  const uKey = dataUrl ? null : await urlKey(url);
  if (!force && uKey) {
    const hit = await cacheGet(uKey);
    if (hit) return { boxes: hit.boxes, cached: true };
  }

  const { buf, mime } = dataUrl ? dataUrlToBuffer(dataUrl) : await fetchImageBuffer(url, pageUrl);
  const hash = await sha256Hex(buf);
  const hKey = hashKey(hash);

  if (!force) {
    const hit = await cacheGet(hKey);
    if (hit) {
      if (uKey) await cachePut(uKey, hit);
      return { boxes: hit.boxes, cached: true };
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
      const tKey = tileKey(hash, tile);
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
    const value = { boxes, meta: { provider: settings.provider, model: usedModel, at: Date.now() } };
    if (warnings.size === 0) {
      await cachePut(hKey, value);
      if (uKey) await cachePut(uKey, value);
    }
    return { boxes, cached: false, warning: [...warnings].join(' ') || undefined };
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
      }),
    );
    return { ...r, model };
  }
  return runGemini(img, settings);
}

const geminiPending = [];
let geminiBatchTimer = null;
let geminiBatchRunning = false;

export function runGemini(img, settings) {
  return new Promise((resolve, reject) => {
    geminiPending.push({ img, settings, resolve, reject });
    if (geminiPending.length >= 2) flushGeminiBatch();
    else if (geminiBatchTimer == null) geminiBatchTimer = setTimeout(flushGeminiBatch, 100);
  });
}

async function flushGeminiBatch() {
  if (geminiBatchRunning || !geminiPending.length) return;
  clearTimeout(geminiBatchTimer);
  geminiBatchTimer = null;
  const group = geminiPending.splice(0, 2);
  if (group.length === 1) {
    try { group[0].resolve(await runGeminiGroup([group[0].img], group[0].settings).then((r) => r[0])); }
    catch (e) { group[0].reject(e); }
  } else {
    geminiBatchRunning = true;
    try {
      const results = await runGeminiGroup(group.map((x) => x.img), group[0].settings);
      group.forEach((item, i) => item.resolve(results[i]));
    } catch (e) {
      group.forEach((item) => item.reject(e));
    } finally {
      geminiBatchRunning = false;
    }
  }
  if (geminiPending.length) flushGeminiBatch();
}

async function runGeminiGroup(images, settings) {
  const { model, fallbackModel } = settings.gemini;
  const models = [...new Set([model, fallbackModel].filter(Boolean))];
  let lastErr = null;

  for (const m of models) {
    if (await isBlocked(m)) {
      lastErr = new AppError(ERR.QUOTA_DAILY);
      continue;
    }
    try {
      const r = await geminiWithRetry(m, images, settings);
      const results = r.results || [r];
      return results.map((result) => ({ ...result, model: m }));
    } catch (e) {
      // Yalnızca "bu modelin kotası bitti" durumlarında yedeğe geç; diğer hatalar doğrudan yükselir.
      if (e instanceof AppError && (e.code === ERR.QUOTA_DAILY || e.code === ERR.LOCAL_CAP)) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new AppError(ERR.QUOTA_DAILY);
}

async function geminiWithRetry(model, images, settings) {
  const { apiKey } = settings.gemini;
  let attempt = 0;
  for (;;) {
    let reserved = false;
    const t0 = Date.now();
    try {
      // Sayaç, istek gerçekten gönderilmeden hemen önce (kuyruk sırası gelince) artar.
      const r = await schedule(settings.limits.minIntervalMs, async () => {
        await reserve(model, settings.limits); // LOCAL_CAP burada fırlar
        reserved = true;
        try {
          return await callGemini({ images, apiKey, model, glossary: settings.glossary });
        } catch (err) {
          // Soğuma, kuyruktaki SONRAKİ istek başlamadan önce ayarlanmalı (yarış durumunu önler).
          if (err?.code === ERR.QUOTA_MINUTE) noteRateLimited(err.retryAfterMs ?? 30000);
          else if (err?.code === ERR.SERVER) noteCooldown(3000);
          throw err;
        }
      });
      noteSuccess();
      logRequest({ model, ok: true, ms: Date.now() - t0, items: (r.results || [r]).reduce((n, result) => n + result.items.length, 0), note: r.warning });
      return r;
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      if (e.code !== ERR.LOCAL_CAP) {
        logRequest({ model, ok: false, code: e.code, status: e.status, ms: Date.now() - t0, retryAfterMs: e.retryAfterMs, note: e.detail || e.message });
      }

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

      if ((e.code === ERR.SERVER || e.code === ERR.BAD_RESPONSE) && attempt < 2) {
        attempt++;
        noteCooldown(2000 * attempt * attempt); // kısa ortak bekleme
        continue;
      }
      throw e;
    }
  }
}
