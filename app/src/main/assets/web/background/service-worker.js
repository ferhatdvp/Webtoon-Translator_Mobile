// background/service-worker.js — eklentinin beyni (MV3 service worker, ES module).
//
//  İçerik betiği ──mesaj──▶ buradaki işleyiciler ──▶ pipeline ──▶ Gemini / Ollama
//  Popup / Ayarlar ─mesaj─▶ durum, test, önbellek, kota işlemleri

import { AppError, ERR, toErrorJSON } from '../shared/errors.js';
import { getSettings, publicSettings } from '../shared/settings.js';
import { isUrlAllowed } from '../shared/sites.js';
import { cacheClear, cacheCount } from './cache.js';
import { applyOllamaOriginRule } from './net.js';
import { assertProviderReady, translateImage } from './pipeline.js';
import { testGemini } from './providers/gemini.js';
import { testOllama } from './providers/ollama.js';
import { clearLog, getLog } from './log.js';
import { getUsage, resetBlocks } from './quota.js';
import { getPacing } from './scheduler.js';
import { syncContentScripts } from './sites-sync.js';

const EXT_PREFIX = chrome.runtime.getURL('');
const isExtensionPage = (sender) => typeof sender.url === 'string' && sender.url.startsWith(EXT_PREFIX);

// ------------------------------------------------------------------ başlangıç

async function init() {
  try {
    // API anahtarı sayfa betiklerinin (content script) eline geçmesin.
    await chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {
    /* eski Chrome */
  }
  const settings = await getSettings();
  // (Android uygulamasında chrome.scripting yoktur; içerik paketini Kotlin enjekte eder.)
  if (chrome.scripting) await syncContentScripts(settings).catch((e) => console.warn('[WTT] script kaydı:', e?.message));
  await applyOllamaOriginRule(settings.ollama.endpoint);
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
init();

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  await init();
  // Açık sekmelerdeki içerik betiklerine "ayar değişti" bildir.
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const t of tabs) {
    if (t.id) chrome.tabs.sendMessage(t.id, { type: 'CONFIG_CHANGED' }).catch(() => {});
  }
});

// ------------------------------------------------------------------ kısayol (Alt+T)

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-translation') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE' }).catch(() => {});
});

// ------------------------------------------------------------------ mesajlar

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: toErrorJSON(e) }));
  return true; // asenkron yanıt
});

async function handle(msg, sender) {
  switch (msg?.type) {
    // ---- içerik betiği ----
    case 'GET_PAGE_CONFIG': {
      const s = await getSettings();
      const allowed = isUrlAllowed(sender.tab?.url || '', s);
      const render = globalThis.WTT_MOBILE?.adjustRender ? await globalThis.WTT_MOBILE.adjustRender(s) : s.render;
      return {
        ok: true,
        allowed,
        enabled: s.enabled,
        render,
        provider: s.provider,
      };
    }

    case 'TRANSLATE_IMAGE': {
      const s = await getSettings();
      // Güvenlik: yalnızca izin verilen sitelerin sekmeleri API'yi kullanabilir.
      if (!isUrlAllowed(sender.tab?.url || '', s)) throw new AppError(ERR.NOT_ALLOWED);
      if (typeof msg.url !== 'string') throw new AppError(ERR.UNKNOWN, 'Geçersiz istek.');
      // Android: mobil veride / düşük pilde / Wi-Fi koşulu sağlanmıyorsa istek hiç başlatılmaz.
      if (globalThis.WTT_MOBILE?.beforeTranslate) await globalThis.WTT_MOBILE.beforeTranslate(s);
      const result = await translateImage({
        url: msg.url,
        pageUrl: sender.tab.url,
        dataUrl: msg.dataUrl,
        force: Boolean(msg.force),
      });
      return { ok: true, result };
    }

    case 'OPEN_OPTIONS':
      await chrome.runtime.openOptionsPage();
      return { ok: true };
  }

  // ---- buradan sonrası yalnızca eklentinin kendi sayfalarına (popup / ayarlar) açık ----
  if (!isExtensionPage(sender)) throw new AppError(ERR.NOT_ALLOWED);

  switch (msg?.type) {
    case 'GET_STATE': {
      const s = await getSettings();
      let ready = true;
      let readyError = null;
      try {
        assertProviderReady(s);
      } catch (e) {
        ready = false;
        readyError = toErrorJSON(e);
      }
      return {
        ok: true,
        settings: publicSettings(s),
        usage: await getUsage(),
        cacheCount: await cacheCount().catch(() => 0),
        pacing: getPacing(),
        lastLog: (await getLog()).slice(-8),
        ready,
        readyError,
      };
    }

    case 'TEST_PROVIDER': {
      const s = await getSettings();
      return {
        ok: true,
        result:
          s.provider === 'ollama'
            ? await testOllama(s.ollama)
            : await testGemini({ apiKey: s.gemini.apiKey, model: s.gemini.model }),
      };
    }

    case 'GET_LOG':
      return { ok: true, log: await getLog(), pacing: getPacing() };

    case 'CLEAR_LOG':
      await clearLog();
      return { ok: true };

    case 'CLEAR_CACHE':
      await cacheClear();
      return { ok: true };

    case 'RESET_BLOCKS':
      await resetBlocks();
      return { ok: true };
  }

  throw new AppError(ERR.UNKNOWN, 'Bilinmeyen mesaj türü.');
}
