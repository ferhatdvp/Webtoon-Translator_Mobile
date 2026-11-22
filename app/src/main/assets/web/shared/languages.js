export const SOURCE_LANGUAGES = {
  en: { name: 'English', label: 'İngilizce → Türkçe' },
  ko: { name: 'Korean', label: 'Korece → Türkçe' },
  ja: { name: 'Japanese', label: 'Japonca → Türkçe' },
};

export function normalizeSourceLanguage(value) {
  return Object.prototype.hasOwnProperty.call(SOURCE_LANGUAGES, value) ? value : 'en';
}
