// background/providers/gemini.js — Google AI Studio (Gemini API) sağlayıcısı.
// Tek istekte: metin tespiti + koordinat + Türkçe çeviri.

import { AppError, ERR } from '../../shared/errors.js';
import { extractItems, normalizeItem } from '../../shared/items.js';
import { buildPrompt } from '../prompts.js';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    texts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
          original: { type: 'STRING' },
          translation: { type: 'STRING' },
          kind: { type: 'STRING' },
          bg: { type: 'STRING' },
          fg: { type: 'STRING' },
        },
        required: ['box_2d', 'original', 'translation'],
      },
    },
  },
  required: ['texts'],
};

const BATCH_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    images: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          index: { type: 'INTEGER' },
          texts: RESPONSE_SCHEMA.properties.texts,
        },
        required: ['index', 'texts'],
      },
    },
  },
  required: ['images'],
};

// Metin tespiti için uzun "düşünme" gerekmez; düşük seviye hem hızı artırır hem token harcamasını azaltır.
// Model bu alanı reddederse (400 + "thinking") bir kez kapatılıp istek yeniden gönderilir.
let useThinkingConfig = true;
export const disableThinkingConfig = () => {
  useThinkingConfig = false;
};
export const _resetThinkingConfig = () => {
  useThinkingConfig = true;
};

export const GEMINI_TIMEOUT_MS = 90_000;

export function buildGeminiRequest({ base64, mime, images, glossary }) {
  const batch = Array.isArray(images) && images.length > 1;
  const prompt = buildPrompt({ provider: 'gemini', glossary }) + (batch
    ? `\nThere are ${images.length} separate images, in order. Analyze each image independently. Return JSON exactly as {"images":[{"index":0,"texts":[...]},{"index":1,"texts":[...]}]}. Each box_2d must be relative only to its own image. Include an entry for every image, even if texts is empty.`
    : '');
  const generationConfig = {
    temperature: 0.2,
    responseMimeType: 'application/json',
    responseSchema: batch ? BATCH_RESPONSE_SCHEMA : RESPONSE_SCHEMA,
    maxOutputTokens: 8192,
  };
  if (useThinkingConfig) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  return {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }, ...(batch ? images : [{ base64, mime }]).map((image) => ({
          inline_data: { mime_type: image.mime, data: image.base64 },
        }))],
      },
    ],
    generationConfig,
  };
}

/** HTTP hatasını AppError'a çevirir. Kota hatalarında dakikalık/günlük ayrımı yapar. */
export function classifyGeminiError(status, json, rawText = '') {
  const err = json?.error || {};
  const msg = err.message || rawText.slice(0, 200) || `HTTP ${status}`;
  const details = Array.isArray(err.details) ? err.details : [];

  if (status === 429) {
    const quotaInfo = details
      .filter((d) => /QuotaFailure/i.test(d['@type'] || ''))
      .flatMap((d) => (d.violations || []).map((v) => `${v.quotaId || ''} ${v.quotaMetric || ''}`))
      .join(' ');
    const retry = details.find((d) => /RetryInfo/i.test(d['@type'] || ''))?.retryDelay;
    const retryAfterMs = retry ? Math.ceil(parseFloat(retry) * 1000) : undefined;
    const daily = /PerDay/i.test(quotaInfo) || /per day|daily/i.test(msg);
    return new AppError(daily ? ERR.QUOTA_DAILY : ERR.QUOTA_MINUTE, undefined, { status, retryAfterMs, detail: msg });
  }
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg + JSON.stringify(details))) {
    return new AppError(ERR.AUTH, undefined, { status, detail: msg });
  }
  if (status === 401 || status === 403) return new AppError(ERR.AUTH, undefined, { status, detail: msg });
  if (status === 404) return new AppError(ERR.MODEL_NOT_FOUND, undefined, { status, detail: msg });
  if (status >= 500) return new AppError(ERR.SERVER, undefined, { status, detail: msg });
  return new AppError(ERR.BAD_RESPONSE, `Gemini isteği reddetti (${status}): ${msg}`, { status });
}

/** @returns {{items:object[], warning?:string}} */
export function parseGeminiResponse(json, imageCount = 1) {
  if (json?.promptFeedback?.blockReason) {
    return { items: [], warning: `Güvenlik filtresi bir bölümü engelledi (${json.promptFeedback.blockReason}).` };
  }
  const cand = json?.candidates?.[0];
  if (!cand) return { items: [], warning: 'Model yanıt üretmedi.' };

  const text = (cand.content?.parts || []).map((p) => p.text || '').join('');
  if (!text.trim()) {
    const fr = cand.finishReason;
    const warning = fr && fr !== 'STOP' ? `Yanıt boş döndü (${fr}).` : undefined;
    return { items: [], warning };
  }
  if (imageCount > 1) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new AppError(ERR.BAD_RESPONSE); }
    if (!Array.isArray(parsed.images)) throw new AppError(ERR.BAD_RESPONSE);
    return { results: Array.from({ length: imageCount }, (_, index) => {
      const entry = parsed.images.find((item) => Number(item.index) === index);
      const rawItems = Array.isArray(entry?.texts) ? entry.texts : [];
      return { items: rawItems.map((item) => normalizeItem(item, { order: 'yxyx', w: 1000, h: 1000 })).filter(Boolean) };
    }) };
  }
  const raw = extractItems(text);
  if (raw === null) throw new AppError(ERR.BAD_RESPONSE);
  const items = raw.map((r) => normalizeItem(r, { order: 'yxyx', w: 1000, h: 1000 })).filter(Boolean);
  return { items };
}

export async function callGemini({ base64, mime, images, apiKey, model, glossary }) {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;
  let res;
  let text;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(buildGeminiRequest({ base64, mime, images, glossary })),
      signal: ctrl.signal,
    });
    text = await res.text();
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new AppError(ERR.SERVER, `Gemini ${GEMINI_TIMEOUT_MS / 1000} sn içinde yanıt vermedi.`, { timeout: true });
    }
    throw new AppError(ERR.NETWORK, undefined, { cause: e?.message });
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* json olmayan gövde */
  }
  if (!res.ok) throw classifyGeminiError(res.status, json, text);
  if (!json) throw new AppError(ERR.BAD_RESPONSE);
  return parseGeminiResponse(json, images?.length || 1);
}

/** Kota harcamayan bağlantı testi: model meta verisini okur. */
export async function testGemini({ apiKey, model }) {
  if (!apiKey) return { ok: false, message: 'API anahtarı girilmemiş.' };
  try {
    const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}`, {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (res.ok) return { ok: true, message: `Bağlantı başarılı (${model}).` };
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* yoksay */
    }
    const e = classifyGeminiError(res.status, json, text);
    return { ok: false, message: `${e.message}${e.detail ? ' — ' + e.detail : ''}` };
  } catch {
    return { ok: false, message: new AppError(ERR.NETWORK).message };
  }
}
