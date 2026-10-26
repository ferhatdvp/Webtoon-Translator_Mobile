// web-src/mobile/worker-main.js — Android "arka plan" sayfasının giriş noktası.
// Eklentinin service-worker.js'i (mesaj işleyicileri + pipeline) burada aynen çalışır.
// Yalnızca üç mobil kanca eklenir: görsel indirme, "çevirmeden önce koşul kontrolü", sayfa ayarı düzeltmesi.

import { AppError, ERR } from '../shared/errors.js';

const H = globalThis.__wttHost;
const MAX_BYTES = 40 * 1024 * 1024;

function device() {
  try {
    return JSON.parse(H.device());
  } catch {
    return { wifi: true, metered: false, batteryPct: 100, charging: true, powerSave: false, dataSaver: false };
  }
}

globalThis.WTT_MOBILE = {
  /** Görsel native katmandan iner (Referer + çerez), aynı kökenli /native/image yolundan akıtılır. */
  async fetchImage(url, pageUrl) {
    const u = `${location.origin}/native/image?u=${encodeURIComponent(url)}&r=${encodeURIComponent(pageUrl || '')}`;
    let res;
    try {
      res = await fetch(u);
    } catch (e) {
      throw new AppError(ERR.IMAGE_FETCH, `Görsel indirilemedi: ${e?.message || 'ağ hatası'}`);
    }
    if (!res.ok) throw new AppError(ERR.IMAGE_FETCH, `Görsel indirilemedi (HTTP ${res.status}).`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new AppError(ERR.IMAGE_FETCH, 'Görsel çok büyük.');
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    return { buf, mime: mime.startsWith('image/') ? mime : 'image/jpeg' };
  },

  /** Pil / Wi-Fi koşulu sağlanmıyorsa HİÇBİR istek (indirme dahil) başlatılmaz. */
  async beforeTranslate(settings) {
    const d = device();
    const m = settings.mobile || {};
    // Ollama yerel ağdaki bilgisayarda çalışır: mobil veri harcamaz ama Wi-Fi gerekir; yine de aynı kural.
    if (m.wifiOnly && !d.wifi) {
      throw new AppError(ERR.MOBILE_HOLD, 'Wi-Fi yok: "Yalnızca Wi-Fi\'de çevir" açık olduğu için çeviri beklemede. Wi-Fi\'ye bağlanınca devam edilecek.');
    }
    if (m.minBatteryPct > 0 && !d.charging && d.batteryPct >= 0 && d.batteryPct < m.minBatteryPct) {
      throw new AppError(ERR.MOBILE_HOLD, `Pil %${d.batteryPct} (sınır %${m.minBatteryPct}): çeviri beklemede. Şarja takınca devam edilecek.`);
    }
  },

  /** Pil tasarrufu / veri tasarrufu açıksa önden çeviri yerine yalnızca ekrana yakın görseller çevrilir. */
  async adjustRender(settings) {
    const d = device();
    if (d.powerSave || d.dataSaver) return { ...settings.render, prefetch: 'near' };
    return settings.render;
  },
};

await import('../background/service-worker.js');
H.ready();
