// background/log.js — son API isteklerinin kısa günlüğü (tanılama). Ayarlar → Tanılama'da görünür.
// Görsel içeriği ya da API anahtarı KAYDEDİLMEZ; yalnızca zaman, model, sonuç ve süre.

const KEY = 'requestLog';
const MAX = 60;
let lock = Promise.resolve();

export function logRequest(entry) {
  const p = lock.then(async () => {
    const { [KEY]: cur = [] } = await chrome.storage.local.get(KEY);
    cur.push({ t: Date.now(), ...entry });
    await chrome.storage.local.set({ [KEY]: cur.slice(-MAX) });
  });
  lock = p.catch(() => {});
  return p.catch(() => {});
}

export async function getLog() {
  const { [KEY]: cur = [] } = await chrome.storage.local.get(KEY);
  return cur;
}

export async function clearLog() {
  await chrome.storage.local.set({ [KEY]: [] });
}
