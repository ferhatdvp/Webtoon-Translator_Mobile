// shared/settings.js
// Ayarlar chrome.storage.local içinde TEK nesne olarak tutulur (API anahtarı senkronize edilmez).
// Arka plan, popup ve ayarlar sayfası bu modülü kullanır. İçerik betiği kullanmaz
// (anahtar sayfaya sızmasın diye storage erişimi TRUSTED_CONTEXTS'e kısıtlanır).

export const DEFAULTS = {
  enabled: true, // genel ana şalter
  sites: [], // [{ host: 'webtoons.com', enabled: true, addedAt: 0 }]
  provider: 'gemini', // 'gemini' | 'ollama'
  gemini: {
    apiKey: '',
    model: 'gemini-3.6-flash',
    fallbackModel: 'gemini-3.5-flash-lite', // ücretsiz katmanda ayrı kota; '' = kapalı
    confirmedFreeTier: false, // "anahtarım faturalandırmasız projeden" onayı
  },
  ollama: {
    endpoint: 'http://localhost:11434',
    model: 'qwen3-vl:8b',
    coordMode: 'relative1000', // qwen3-vl: 'relative1000' | qwen2.5-vl: 'absolute'
  },
  limits: {
    dailyRequestCap: 150, // model başına, Pasifik saatiyle günlük
    minIntervalMs: 5000, // iki Gemini isteği arası asgari süre
    allowPaid: false, // true ise yerel limit uygulanmaz (kullanıcı bilerek açar)
  },
  render: {
    minImageWidth: 300,
    minImageHeight: 200,
    prefetch: 'all', // 'all': sayfadaki tüm görselleri sırayla önceden çevir | 'near': yalnızca ekrana yakın olanları
    showSfx: false, // ses efektlerini (SFX) göster
    expand: 0.1, // çeviri kutusunu orijinal metin kutusundan % kaç büyüt
  },
  mobile: {
    // Yalnızca Android uygulamasında kullanılır (eklentide yok sayılır).
    wifiOnly: true, // mobil veride istek gönderme
    minBatteryPct: 15, // pil bu yüzdenin altındaysa (şarjda değilse) beklet; 0 = kapalı
  },
  glossary: '', // satır başına: English = Türkçe
};

export function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch === undefined ? base : patch;
  if (typeof base !== 'object' || base === null) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const k of Object.keys(patch || {})) {
    out[k] = k in base ? deepMerge(base[k], patch[k]) : patch[k];
  }
  return out;
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return deepMerge(DEFAULTS, settings || {});
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = deepMerge(current, patch);
  await chrome.storage.local.set({ settings: next });
  return next;
}

// Popup'a gönderilirken API anahtarı çıkarılır.
export function publicSettings(s) {
  const copy = JSON.parse(JSON.stringify(s));
  copy.gemini.apiKeySet = Boolean(copy.gemini.apiKey);
  delete copy.gemini.apiKey;
  return copy;
}
