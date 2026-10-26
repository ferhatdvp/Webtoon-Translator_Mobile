// background/net.js — görsel indirme ve declarativeNetRequest (DNR) başlık kuralları.
//
// Neden DNR?
//  1) Birçok webtoon CDN'i görseli yalnızca doğru Referer ile verir. Service worker'ın fetch'i
//     sayfanın Referer'ını taşımaz; istek başına geçici bir kuralla Referer/Origin'i sayfa kökenine ayarlarız.
//  2) Ollama, "chrome-extension://" kökenli istekleri 403 ile reddeder. Yerel Ollama adresine giden
//     isteklerden Origin başlığını kaldırarak OLLAMA_ORIGINS ayarı yapmadan çalışmasını sağlarız.

import { AppError, ERR } from '../shared/errors.js';

const MAX_BYTES = 40 * 1024 * 1024;
let ruleCounter = 0;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function fetchImageBuffer(url, pageUrl) {
  // Android uygulaması: indirme native katmanda yapılır (Referer + çerez), DNR yoktur.
  if (globalThis.WTT_MOBILE?.fetchImage) return globalThis.WTT_MOBILE.fetchImage(url, pageUrl);

  let origin = null;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    /* sayfa adresi yoksa başlık kuralı eklenmez */
  }

  const ruleId = 1000 + (ruleCounter++ % 9000);
  let added = false;
  if (origin && url.length < 1500) {
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
        addRules: [
          {
            id: ruleId,
            priority: 2,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                { header: 'referer', operation: 'set', value: origin + '/' },
                { header: 'origin', operation: 'set', value: origin },
              ],
            },
            condition: {
              regexFilter: '^' + escapeRegex(url) + '$',
              initiatorDomains: [chrome.runtime.id],
              resourceTypes: ['xmlhttprequest', 'other'],
            },
          },
        ],
      });
      added = true;
    } catch {
      /* kural eklenemezse yine de düz fetch denenir */
    }
  }

  try {
    let res;
    try {
      res = await fetch(url, { credentials: 'include' });
    } catch (e) {
      throw new AppError(ERR.IMAGE_FETCH, `Görsel indirilemedi: ${e?.message || 'ağ hatası'}`);
    }
    if (!res.ok) throw new AppError(ERR.IMAGE_FETCH, `Görsel indirilemedi (HTTP ${res.status}).`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new AppError(ERR.IMAGE_FETCH, 'Görsel çok büyük.');
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    return { buf, mime: mime.startsWith('image/') ? mime : 'image/jpeg' };
  } finally {
    if (added) {
      chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {});
    }
  }
}

export function dataUrlToBuffer(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new AppError(ERR.IMAGE_FETCH, 'Geçersiz data URL.');
  const mime = m[1] || 'image/jpeg';
  const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { buf: bytes.buffer, mime };
}

/** Ollama uç noktasına giden isteklerden Origin başlığını kaldırır. */
export async function applyOllamaOriginRule(endpoint) {
  if (!chrome.declarativeNetRequest) return; // mobil: native HTTP katmanı Origin göndermez
  try {
    const u = new URL(endpoint);
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          priority: 1,
          action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'remove' }] },
          condition: {
            urlFilter: `|${u.origin}/`,
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: ['xmlhttprequest'],
          },
        },
      ],
    });
  } catch (e) {
    console.warn('[WTT] Ollama Origin kuralı eklenemedi:', e?.message);
  }
}
