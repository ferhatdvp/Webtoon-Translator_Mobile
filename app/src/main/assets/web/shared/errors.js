// shared/errors.js
// Tüm hatalar tek bir sınıfta toplanır; içerik betiği (content script) yalnızca
// toJSON() çıktısını görür: { code, message, fatal, transient, retryAfterMs }.

export const ERR = {
  NO_API_KEY: 'NO_API_KEY',
  FREE_TIER_UNCONFIRMED: 'FREE_TIER_UNCONFIRMED',
  AUTH: 'AUTH',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  QUOTA_MINUTE: 'QUOTA_MINUTE',
  QUOTA_DAILY: 'QUOTA_DAILY',
  LOCAL_CAP: 'LOCAL_CAP',
  SERVER: 'SERVER',
  NETWORK: 'NETWORK',
  OLLAMA_DOWN: 'OLLAMA_DOWN',
  OLLAMA_ORIGIN: 'OLLAMA_ORIGIN',
  OLLAMA_MODEL: 'OLLAMA_MODEL',
  IMAGE_FETCH: 'IMAGE_FETCH',
  BAD_RESPONSE: 'BAD_RESPONSE',
  NOT_ALLOWED: 'NOT_ALLOWED',
  MOBILE_HOLD: 'MOBILE_HOLD',
  UNKNOWN: 'UNKNOWN',
};

// Kuyruğu durdurup kullanıcıya bildirim gösterilmesi gereken hatalar.
const FATAL = new Set([
  ERR.NO_API_KEY,
  ERR.FREE_TIER_UNCONFIRMED,
  ERR.AUTH,
  ERR.MODEL_NOT_FOUND,
  ERR.QUOTA_MINUTE,
  ERR.QUOTA_DAILY,
  ERR.LOCAL_CAP,
  ERR.NETWORK,
  ERR.OLLAMA_DOWN,
  ERR.OLLAMA_ORIGIN,
  ERR.OLLAMA_MODEL,
  ERR.NOT_ALLOWED,
  ERR.MOBILE_HOLD,
]);

// Kısa süre sonra otomatik yeniden denenebilecek hatalar.
const TRANSIENT = new Set([ERR.SERVER, ERR.BAD_RESPONSE]);

export const DEFAULT_MESSAGES = {
  NO_API_KEY: 'Gemini API anahtarı girilmemiş. Ayarlar sayfasından ekleyin.',
  FREE_TIER_UNCONFIRMED:
    'Ücretli kullanıma karşı koruma: Ayarlar’dan anahtarınızın ücretsiz katmanda (faturalandırması kapalı bir projede) olduğunu onaylayın.',
  AUTH: 'API anahtarı geçersiz ya da yetkisiz. Ayarlardan kontrol edin.',
  MODEL_NOT_FOUND: 'Seçilen model bulunamadı. Ayarlardan model adını kontrol edin.',
  QUOTA_MINUTE: 'Dakikalık istek sınırı aşıldı. Biraz bekleyip otomatik devam edilecek.',
  QUOTA_DAILY:
    'Günlük ücretsiz kota doldu. Ücretli kullanıma otomatik geçilmedi. Kota Pasifik saatiyle gece yarısı (TR ≈ 10:00) sıfırlanır; ya da Ollama’ya geçebilirsiniz.',
  LOCAL_CAP: 'Kendi koyduğunuz günlük istek sınırına ulaşıldı.',
  SERVER: 'Çeviri servisi geçici olarak yanıt vermiyor.',
  NETWORK: 'Bağlantı kesildi ya da servise ulaşılamıyor.',
  OLLAMA_DOWN: 'Ollama’ya ulaşılamıyor. Ollama’nın çalıştığından emin olun.',
  OLLAMA_ORIGIN:
    'Ollama bu eklentinin isteğini reddetti (403). Ollama’yı OLLAMA_ORIGINS="chrome-extension://*" ile yeniden başlatın.',
  OLLAMA_MODEL: 'Ollama’da seçili model yüklü değil. `ollama pull <model>` ile indirin.',
  IMAGE_FETCH: 'Görsel indirilemedi (site görseli engelliyor olabilir).',
  BAD_RESPONSE: 'Model beklenen biçimde yanıt vermedi.',
  NOT_ALLOWED: 'Bu site izin verilen siteler listesinde değil.',
  MOBILE_HOLD: 'Çeviri beklemede (mobil veri / düşük pil koruması).',
  UNKNOWN: 'Bilinmeyen bir hata oluştu.',
};

export class AppError extends Error {
  constructor(code, message, extra = {}) {
    super(message || DEFAULT_MESSAGES[code] || code);
    this.name = 'AppError';
    this.code = code;
    Object.assign(this, extra);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      fatal: FATAL.has(this.code),
      transient: TRANSIENT.has(this.code),
      retryAfterMs: this.retryAfterMs ?? null,
    };
  }
}

export function toErrorJSON(e) {
  if (e instanceof AppError) return e.toJSON();
  return new AppError(ERR.UNKNOWN, e?.message || DEFAULT_MESSAGES.UNKNOWN).toJSON();
}
