// background/sites-sync.js — içerik betiğini YALNIZCA izin verilen sitelere kaydeder.
// Manifest'te statik content_scripts yoktur; böylece listede olmayan sitelerde eklenti hiçbir kod çalıştırmaz.

import { buildMatchPatterns } from '../shared/sites.js';

const SCRIPT_ID = 'wtt-content';
const FILES = { js: ['content/content.js'], css: ['content/content.css'] };

export async function syncContentScripts(settings) {
  const patterns = settings.enabled ? buildMatchPatterns(settings.sites) : [];
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  const current = existing[0]?.matches ? [...existing[0].matches].sort() : [];

  if (JSON.stringify(current) === JSON.stringify(patterns)) return; // değişiklik yok

  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (!patterns.length) return;

  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches: patterns,
      js: FILES.js,
      css: FILES.css,
      runAt: 'document_idle',
      allFrames: false,
      persistAcrossSessions: true,
    },
  ]);

  // Zaten açık olan sekmelere de hemen enjekte et (content.js çift yüklemeye karşı korumalıdır).
  try {
    const tabs = await chrome.tabs.query({ url: patterns });
    for (const tab of tabs) {
      if (!tab.id) continue;
      chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: FILES.css }).catch(() => {});
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: FILES.js }).catch(() => {});
    }
  } catch {
    /* izin yoksa yoksay */
  }
}
