// options/options.js — ayarlar sayfası.

import { getSettings, saveSettings } from '../shared/settings.js';
import { normalizeHost } from '../shared/sites.js';

const $ = (id) => document.getElementById(id);
let settings = null;

function msg(el, text, kind = '') {
  el.textContent = text;
  el.className = 'msg ' + kind;
}

// ---------------------------------------------------------------- siteler

function renderSites() {
  const tbody = $('siteTable').querySelector('tbody');
  tbody.innerHTML = '';
  if (!settings.sites.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="msg">Henüz site eklenmedi.</td>';
    tbody.appendChild(tr);
    return;
  }
  for (const site of settings.sites) {
    const tr = document.createElement('tr');

    const tdHost = document.createElement('td');
    tdHost.className = 'host';
    tdHost.textContent = site.host;

    const tdAct = document.createElement('td');
    tdAct.className = 'act';

    const lab = document.createElement('label');
    lab.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = site.enabled;
    cb.addEventListener('change', async () => {
      settings = await saveSettings({
        sites: settings.sites.map((s) => (s.host === site.host ? { ...s, enabled: cb.checked } : s)),
      });
    });
    lab.append(cb, ' Etkin');

    const del = document.createElement('button');
    del.textContent = 'Sil';
    del.className = 'danger';
    del.style.marginLeft = '10px';
    del.addEventListener('click', async () => {
      settings = await saveSettings({ sites: settings.sites.filter((s) => s.host !== site.host) });
      renderSites();
    });

    tdAct.append(lab, del);
    tr.append(tdHost, tdAct);
    tbody.appendChild(tr);
  }
}

$('addSite').addEventListener('click', async () => {
  // İzin isteği kullanıcı hareketinin içinde ve ilk await olmalı.
  const host = normalizeHost($('newSite').value);
  if (!host) return msg($('siteMsg'), 'Geçerli bir site adresi girin (örn. webtoons.com).', 'bad');
  const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
  if (!granted) return msg($('siteMsg'), 'Site erişim izni verilmedi; site eklenemedi.', 'bad');
  if (settings.sites.some((s) => s.host === host)) return msg($('siteMsg'), 'Bu site zaten listede.', 'bad');
  settings = await saveSettings({ sites: [...settings.sites, { host, enabled: true, addedAt: Date.now() }] });
  $('newSite').value = '';
  msg($('siteMsg'), `${host} eklendi. Açık sekmeyi yenilemeniz gerekebilir.`, 'ok');
  renderSites();
});

// ---------------------------------------------------------------- form <-> ayar

function fill() {
  const s = settings;
  document.querySelector(`input[name="provider"][value="${s.provider}"]`).checked = true;
  $('apiKey').value = s.gemini.apiKey;
  $('gModel').value = s.gemini.model;
  $('gFallback').value = s.gemini.fallbackModel;
  $('confirmedFree').checked = s.gemini.confirmedFreeTier;
  $('oEndpoint').value = s.ollama.endpoint;
  $('oModel').value = s.ollama.model;
  $('oCoord').value = s.ollama.coordMode;
  $('dailyCap').value = s.limits.dailyRequestCap;
  $('minInterval').value = s.limits.minIntervalMs;
  $('allowPaid').checked = s.limits.allowPaid;
  $('minW').value = s.render.minImageWidth;
  $('minH').value = s.render.minImageHeight;
  $('expand').value = Math.round(s.render.expand * 100);
  $('showSfx').checked = s.render.showSfx;
  $('prefetch').value = s.render.prefetch;
  $('glossary').value = s.glossary;
  $('wifiOnly').checked = s.mobile.wifiOnly;
  $('minBattery').value = s.mobile.minBatteryPct;
  $('mobileCard').hidden = !globalThis.__WTT_ANDROID__;
  toggleProviderBoxes();
}

function toggleProviderBoxes() {
  const p = document.querySelector('input[name="provider"]:checked').value;
  $('geminiBox').hidden = p !== 'gemini';
  $('ollamaBox').hidden = p !== 'ollama';
}
document.querySelectorAll('input[name="provider"]').forEach((r) => r.addEventListener('change', toggleProviderBoxes));

const num = (id, fallback, min, max) => {
  const v = Number($(id).value);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};

async function save() {
  const provider = document.querySelector('input[name="provider"]:checked').value;
  const allowPaid = $('allowPaid').checked;

  if (allowPaid && !settings.limits.allowPaid) {
    const ok = confirm(
      'Dikkat: ücretli kullanıma izin vermek, Google Cloud projenizde faturalandırma açıksa ücret doğurabilir.\n\n' +
        'Yerel günlük sınır devre dışı kalacak. Yine de devam edilsin mi?',
    );
    if (!ok) {
      $('allowPaid').checked = false;
      return;
    }
  }

  const endpoint = $('oEndpoint').value.trim() || 'http://localhost:11434';
  // Varsayılan dışı bir Ollama adresi için ayrıca izin iste.
  try {
    const origin = new URL(endpoint).origin;
    if (!/^http:\/\/(localhost|127\.0\.0\.1):11434$/.test(origin)) {
      await chrome.permissions.request({ origins: [origin + '/*'] });
    }
  } catch {
    return msg($('saveMsg'), 'Ollama adresi geçersiz.', 'bad');
  }

  settings = await saveSettings({
    provider,
    gemini: {
      apiKey: $('apiKey').value.trim(),
      model: $('gModel').value.trim() || 'gemini-3.6-flash',
      fallbackModel: $('gFallback').value.trim(),
      confirmedFreeTier: $('confirmedFree').checked,
    },
    ollama: {
      endpoint,
      model: $('oModel').value.trim() || 'qwen3-vl:8b',
      coordMode: $('oCoord').value,
    },
    limits: {
      dailyRequestCap: num('dailyCap', 150, 1, 100000),
      minIntervalMs: num('minInterval', 5000, 0, 60000),
      allowPaid,
    },
    render: {
      minImageWidth: num('minW', 300, 50, 4000),
      minImageHeight: num('minH', 200, 50, 4000),
      expand: num('expand', 10, 0, 40) / 100,
      showSfx: $('showSfx').checked,
      prefetch: $('prefetch').value,
    },
    mobile: {
      wifiOnly: $('wifiOnly').checked,
      minBatteryPct: num('minBattery', 15, 0, 90),
    },
    glossary: $('glossary').value,
  });
  msg($('saveMsg'), 'Kaydedildi ✓', 'ok');
  setTimeout(() => msg($('saveMsg'), ''), 2500);
  refreshInfo();
}

$('save').addEventListener('click', save);

// ---------------------------------------------------------------- test / bilgi

$('testProvider').addEventListener('click', async () => {
  await save(); // test, kaydedilmiş ayarlarla çalışır
  msg($('testMsg'), 'Test ediliyor…');
  const r = await chrome.runtime.sendMessage({ type: 'TEST_PROVIDER' });
  if (r?.ok) msg($('testMsg'), r.result.message, r.result.ok ? 'ok' : 'bad');
  else msg($('testMsg'), r?.error?.message || 'Test başarısız.', 'bad');
});

$('resetBlocks').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'RESET_BLOCKS' });
  refreshInfo();
});

$('clearCache').addEventListener('click', async () => {
  if (!confirm('Tüm önbelleğe alınmış çeviriler silinecek; görseller yeniden çevrilirken API isteği harcanır. Devam?')) return;
  await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
  refreshInfo();
});

async function refreshInfo() {
  const r = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (!r?.ok) return;
  $('cacheInfo').textContent = `${r.cacheCount} görsel/parça önbellekte.`;
  const counts = r.usage?.counts || {};
  const blocked = Object.keys(r.usage?.blocked || {});
  const parts = Object.entries(counts).map(([m, n]) => `${m}: ${n}`);
  $('usageInfo').textContent =
    (parts.length ? `Bugünkü istekler → ${parts.join(', ')}` : 'Bugün henüz istek yok.') +
    (blocked.length ? ` · Kotası dolan: ${blocked.join(', ')}` : '');
}

// ---------------------------------------------------------------- tanılama günlüğü

let lastLog = [];

function fmtLog(e) {
  const t = new Date(e.t).toLocaleTimeString('tr-TR');
  const res = e.ok ? `✓ ${e.items ?? 0} kutu` : `✗ ${e.code || 'hata'}${e.status ? ' (' + e.status + ')' : ''}`;
  const extra = [e.retryAfterMs ? `bekleme ${Math.round(e.retryAfterMs / 1000)}sn` : '', e.note || ''].filter(Boolean).join(' · ');
  return { t, model: e.model || '—', res, ms: e.ms != null ? (e.ms / 1000).toFixed(1) + ' sn' : '', extra, ok: e.ok };
}

async function refreshLog() {
  const r = await chrome.runtime.sendMessage({ type: 'GET_LOG' });
  if (!r?.ok) return;
  lastLog = r.log;
  const now = Date.now();
  const p = r.pacing;
  $('pacingInfo').textContent =
    p.cooldownUntil > now
      ? `⏳ Dakikalık sınır nedeniyle ~${Math.ceil((p.cooldownUntil - now) / 1000)} sn bekleniyor.`
      : p.penalized
        ? `İstekler ${Math.round(p.intervalMs / 1000)} sn aralıkla yavaşlatıldı.`
        : 'Hız sınırı sorunu yok.';
  const tbody = $('logTable').querySelector('tbody');
  tbody.innerHTML = '';
  if (!lastLog.length) {
    tbody.innerHTML = '<tr><td class="msg">Henüz istek günlüğü yok.</td></tr>';
    return;
  }
  for (const e of [...lastLog].reverse()) {
    const f = fmtLog(e);
    const tr = document.createElement('tr');
    for (const v of [f.t, f.model, f.res, f.ms, f.extra]) {
      const td = document.createElement('td');
      td.textContent = v;
      if (v === f.res) td.style.color = f.ok ? 'var(--ok)' : 'var(--bad)';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

$('logRefresh').addEventListener('click', refreshLog);
$('logCopy').addEventListener('click', async () => {
  const text = lastLog.map((e) => Object.values(fmtLog(e)).slice(0, 5).join(' | ')).join('\n');
  await navigator.clipboard.writeText(text);
});
$('logClear').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_LOG' });
  refreshLog();
});

(async () => {
  settings = await getSettings();
  fill();
  renderSites();
  refreshInfo();
  refreshLog();
})();
