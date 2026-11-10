// web-src/page-bundle.template.js
// Tarayıcı WebView'ındaki sayfaya (yalnızca izinli sitelere) enjekte edilen paket. tools/sync-web.mjs bunu
// content.css + content/content.js ile birleştirip assets/web/mobile/page-bundle.js üretir.
//
// Önemli: sayfanın `window.chrome` nesnesine DOKUNULMAZ (siteler tarayıcı tespiti için kullanır);
// content.js'e `chrome` yerel bir değişken olarak verilir. Köprü: window.__wttBridge (WebMessageListener;
// Kotlin yalnızca izinli sitelerin kökenlerinde tanımlar).
(function () {
  'use strict';
  var bridge = window.__wttBridge;
  if (!bridge || window.__WTT_BUNDLE__) return;
  window.__WTT_BUNDLE__ = true;

  var listeners = [];
  var pending = new Map();
  var seq = 1;
  var lastStatus = '';

  function reportMobileStatus(status) {
    var message = JSON.stringify({ status: status });
    if (message === lastStatus) return;
    try {
      bridge.postMessage(message);
      lastStatus = message;
    } catch (err) {
      // Sayfa kapanıyor olabilir.
    }
  }

  bridge.onmessage = function (e) {
    var m;
    try {
      m = JSON.parse(e.data);
    } catch (err) {
      return;
    }
    if (m.push) {
      // Native → sayfa komutu (TOGGLE, RESCAN, CONFIG_CHANGED...). Sayfa betikleri bunu taklit edemez:
      // dinleyiciler yalnızca bu kapanışın içindedir.
      listeners.forEach(function (f) {
        try {
          f(m.push, {}, function () {});
        } catch (err) {
          /* yok say */
        }
      });
      return;
    }
    var p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      p(m.res);
    }
  };

  var chrome = {
    runtime: {
      sendMessage: function (msg) {
        return new Promise(function (resolve) {
          var id = seq++;
          pending.set(id, resolve);
          bridge.postMessage(JSON.stringify({ id: id, msg: msg }));
        });
      },
      onMessage: {
        addListener: function (f) {
          listeners.push(f);
        },
      },
    },
  };

  // CSS: constructable stylesheet (sayfanın CSP'sinden etkilenmez); desteklenmezse <style> elemanı.
  var CSS_TEXT = "/* content/content.css — görsellerin üstüne binen çeviri kutularının stilleri.\n   Sayfanın kendi CSS'inden etkilenmemek için kritik özelliklerde !important kullanılır.\n   Eklenti arayüzü (düğme, bildirim, ipucu) ayrı bir Shadow DOM içindedir; stili content.js içindedir. */\n\n#wtt-layer {\n  position: absolute !important;\n  left: 0 !important;\n  top: 0 !important;\n  width: 0 !important;\n  height: 0 !important;\n  margin: 0 !important;\n  padding: 0 !important;\n  border: 0 !important;\n  overflow: visible !important;\n  z-index: 1 !important;\n  pointer-events: none !important;\n}\n\nhtml[data-wtt-hidden] #wtt-layer {\n  display: none !important;\n}\n\n.wtt-overlay {\n  position: absolute !important;\n  margin: 0 !important;\n  padding: 0 !important;\n  border: 0 !important;\n  pointer-events: none !important;\n  contain: layout style;\n}\n\n.wtt-box {\n  position: absolute !important;\n  box-sizing: border-box !important;\n  display: flex !important;\n  flex-direction: column !important;\n  justify-content: center !important;\n  align-items: center !important;\n  margin: 0 !important;\n  padding: 0 !important;\n  overflow: visible !important;\n  pointer-events: auto !important;\n  cursor: help !important;\n  border-radius: 0.45em !important;\n  text-align: center !important;\n  font-family: \"Comic Neue\", \"Segoe UI\", Roboto, \"Noto Sans\", Arial, sans-serif !important;\n  font-weight: 700 !important;\n  line-height: 1.16 !important;\n  letter-spacing: 0 !important;\n  text-transform: none !important;\n  white-space: normal !important;\n  word-break: normal !important;\n  overflow-wrap: normal !important;\n  hyphens: manual !important;\n  -webkit-text-size-adjust: none !important;\n  text-size-adjust: none !important;\n  user-select: text;\n}\n\n.wtt-box.wtt-break {\n  overflow-wrap: anywhere !important;\n}\n\n.wtt-txt {\n  position: static !important;\n  display: block !important;\n  flex: none !important;\n  width: 100% !important;\n  height: auto !important;\n  min-height: 0 !important;\n  max-height: none !important;\n  margin: 0 !important;\n  padding: 0.12em 0.28em !important;\n  border: 0 !important;\n  box-sizing: border-box !important;\n  font: inherit !important;\n  letter-spacing: inherit !important;\n  text-transform: inherit !important;\n  white-space: inherit !important;\n  word-break: inherit !important;\n  overflow-wrap: inherit !important;\n  hyphens: inherit !important;\n  -webkit-text-size-adjust: inherit !important;\n  text-size-adjust: inherit !important;\n}\n\n/* Konuşma/düşünce balonlarında köşeler daha yuvarlak: balon dışına taşan köşe yaması azalır */\n.wtt-box.wtt-speech,\n.wtt-box.wtt-thought {\n  border-radius: 0.9em !important;\n}\n\n/* Anlatı kutuları biraz daha kare köşeli görünür */\n.wtt-box.wtt-narration {\n  border-radius: 0.2em !important;\n}\n\n/* Yazı ses efekti: arka plan doldurma yok, yalnızca metin */\n.wtt-box.wtt-sfx {\n  background: transparent !important;\n}\n\n/* Durum rozeti: çevrilmekte olan görselin üst kenarında, ortada */\n.wtt-badge {\n  position: absolute !important;\n  display: none;\n  transform: translateX(-50%) !important;\n  padding: 6px 14px !important;\n  border-radius: 999px !important;\n  font: 600 13px/1.2 system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif !important;\n  color: #fff !important;\n  background: rgba(43, 108, 255, 0.92) !important;\n  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35) !important;\n  pointer-events: none !important;\n  white-space: nowrap !important;\n}\n\n.wtt-badge.wtt-bad {\n  background: rgba(217, 119, 6, 0.96) !important;\n  pointer-events: auto !important;\n  cursor: pointer !important;\n}\n";
  try {
    var sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS_TEXT);
    document.adoptedStyleSheets = Array.prototype.concat.call([], document.adoptedStyleSheets || [], [sheet]);
  } catch (err) {
    var style = document.createElement('style');
    style.setAttribute('data-wtt', '1');
    style.textContent = CSS_TEXT;
    (document.head || document.documentElement).appendChild(style);
  }

  // Native tarafa "bu sayfa hazır" de (yanıt kanalı için).
  bridge.postMessage(JSON.stringify({ id: 0, hello: true }));

  // content/content.js — izin verilen sitelerde çalışır (klasik betik, ES module değil).
//
// Görevler:
//  1) Sayfadaki webtoon görsellerini bul (lazy-load dahil) ve görünür olunca sıraya al.
//  2) Arka plana çevirtir; dönen kutuları görselin üstüne yerleştirir.
//  3) Kutuları yüzde konumlandırma + CSS değişkeniyle ölçekler (görsel boyutu değişince yazı da orantılı değişir).
//  4) Üstüne gelince orijinal İngilizce metni gösterir; Aç/Kapat düğmesi; hata/kota bildirimleri.

(() => {
  'use strict';
  if (window.__WTT_LOADED__ || window.top !== window) return;
  window.__WTT_LOADED__ = true;

  const MAX_PARALLEL = 2;
  const MAX_TRANSIENT_RETRIES = 2;
  const GEOMETRY_POLL_MS = 250;
  const VIS_KEY = 'wtt-visible';

  const AFK_KEY = 'wtt-afk';
  const AFK_CHAPTERS_KEY = 'wtt-afk-chapters';
  const AFK_START_KEY = 'wtt-afk-start';
  const AFK_MAX_CHAPTERS = 20;

  const S = {
    tipTimer: null,
    config: null,
    visible: true,
    paused: false,
    pauseInfo: null,
    dead: false,
    recs: new Map(), // img -> rec
    queue: [],
    active: 0,
    layer: null,
    ui: null,
    io: null,
    mo: null,
    ro: null,
    resumeTimer: null,
    lastFailToast: 0,
    afk: false,
    afkTimer: null,
    afkBottomSince: 0,
    afkNote: '',
  };

  // ------------------------------------------------------------------ mesajlaşma

  async function send(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      if (/context invalidated/i.test(e?.message || '')) {
        S.dead = true;
        S.ui?.toast({
          key: 'dead',
          kind: 'error',
          sticky: true,
          text: 'Eklenti güncellendi. Çeviriye devam etmek için sayfayı yenileyin.',
        });
        return { ok: false, error: { code: 'DEAD', fatal: false } };
      }
      return {
        ok: false,
        error: { code: 'NETWORK', message: 'Eklenti arka planına ulaşılamadı.', fatal: false, transient: true },
      };
    }
  }

  // ------------------------------------------------------------------ başlangıç

  async function init() {
    const r = await send({ type: 'GET_PAGE_CONFIG' });
    if (!r?.ok || !r.allowed || !r.enabled) return;
    S.config = r;
    S.visible = loadVisible();
    S.afk = loadAfk();

    S.ui = buildUI();
    S.layer = buildLayer();
    applyVisible();

    S.io = new IntersectionObserver(onIntersect, { rootMargin: '1500px 0px' });
    S.ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        const rec = S.recs.get(en.target);
        if (rec?.overlay) positionOverlay(rec);
      }
    });
    S.mo = new MutationObserver(onMutations);
    S.mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'data-src'],
    });

    document.querySelectorAll('img').forEach(track);
    setInterval(syncGeometry, GEOMETRY_POLL_MS);

    window.addEventListener('offline', () => {
      pause({ code: 'NETWORK', message: 'İnternet bağlantısı kesildi. Bağlantı gelince devam edilecek.' }, { auto: 'online' });
    });
    window.addEventListener('online', () => {
      if (S.paused && S.pauseInfo?.code === 'NETWORK') resume();
    });

    chrome.runtime.onMessage.addListener(onExtensionMessage);
    if (S.afk) startAfk();
    updateStatus();
  }

  function loadVisible() {
    try {
      return localStorage.getItem(VIS_KEY) !== '0';
    } catch {
      return true;
    }
  }

  function loadAfk() {
    try { return localStorage.getItem(AFK_KEY) === '1'; } catch { return false; }
  }

  function setAfk(enabled, note = '') {
    if (enabled && !S.afk) {
      try { localStorage.setItem(AFK_START_KEY, location.href); } catch { /* storage unavailable */ }
    }
    S.afk = enabled;
    S.afkNote = note;
    try {
      localStorage.setItem(AFK_KEY, enabled ? '1' : '0');
      if (!enabled) localStorage.removeItem(AFK_CHAPTERS_KEY);
    } catch { /* storage unavailable */ }
    clearInterval(S.afkTimer);
    S.afkTimer = null;
    S.afkBottomSince = 0;
    if (enabled) startAfk();
    updateStatus();
  }

  function getAfkStart() {
    try {
      const startUrl = localStorage.getItem(AFK_START_KEY);
      if (!startUrl) return null;
      const url = new URL(startUrl);
      return url.origin === location.origin && /^https?:$/.test(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  function returnToAfkStart() {
    const startUrl = getAfkStart();
    if (!startUrl) return false;
    setAfk(false);
    if (startUrl === location.href) window.scrollTo(0, 0);
    else location.href = startUrl;
    return true;
  }

  function startAfk() {
    if (S.afkTimer) return;
    S.ui.toast({ key: 'afk', kind: 'info', text: 'AFK açık: sayfa görselleri çevrildikçe aşağı kaydırılacak.' });
    S.afkTimer = setInterval(afkStep, 1200);
    afkStep();
  }

  function findNextChapter() {
    const candidates = [...document.querySelectorAll('a[href], area[href]')]
      .map((el) => {
        const label = [el.innerText, el.textContent, el.getAttribute('aria-label'), el.title,
          el.getAttribute('data-original-title'), el.getAttribute('rel'), el.className, el.id]
          .filter((v) => typeof v === 'string').join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
        if (/\b(prev|previous|back)\b|önceki/.test(label)) return null;
        let score = 0;
        if (el.rel?.split(/\s+/).some((v) => v.toLowerCase() === 'next')) score += 100;
        if (/\b(next|sonraki)\b/.test(label)) score += 30;
        if (/\b(next|sonraki)[-_ ]?(chapter|page|episode|bölüm|sayfa|bolum)\b/.test(label)) score += 20;
        if (/^(›|»|❯|❯❯|→)$/.test(label)) score += 10;
        if (!score) return null;
        try {
          const url = new URL(el.href, location.href);
          if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin) return null;
          if (url.pathname === location.pathname && url.search === location.search) return null;
          return { url: url.href, score };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.url || null;
  }

  function afkStep() {
    if (!S.afk || S.dead || S.paused) return;
    const viewBottom = window.innerHeight;
    let visiblePending = false;
    for (const rec of S.recs.values()) {
      const rect = rec.img.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= viewBottom) continue;
      if (rec.state === 'idle') enqueue(rec);
      if (['queued', 'working', 'idle', 'failed'].includes(rec.state)) visiblePending = true;
    }
    // AFK ekranı ilerletmeden önce o ekrandaki görsellerin çevirisinin tamamlanmasını bekler.
    if (visiblePending) return;
    const nearBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 80;
    if (!nearBottom) {
      S.afkBottomSince = 0;
      window.scrollBy({ top: Math.max(1, Math.floor(viewBottom * 0.75)), behavior: 'smooth' });
      return;
    }
    // 'near' ön çeviri ayarında observer dışında kalmış bilinen görselleri de son kontrolde sıraya al.
    for (const rec of S.recs.values()) if (rec.state === 'idle') enqueue(rec);
    const st = stats();
    if (st.busy || S.paused || st.failed) {
      S.afkBottomSince = 0;
      return;
    }
    if (!S.afkBottomSince) {
      S.afkBottomSince = Date.now();
      return;
    }
    // Sayfa sonundaki gecikmeli lazy-load ve DOM eklemeleri için kısa sakinleşme aralığı.
    if (Date.now() - S.afkBottomSince < 5000) return;
    let chapters;
    try { chapters = Number(localStorage.getItem(AFK_CHAPTERS_KEY) || 0); } catch {
      setAfk(false, 'Bölüm sayacı kullanılamıyor.');
      return;
    }
    if (!Number.isInteger(chapters) || chapters < 0 || chapters >= AFK_MAX_CHAPTERS) {
      setAfk(false, 'Bölüm sınırına ulaşıldı.');
      S.ui.toast({ key: 'afk', kind: 'info', text: `AFK güvenlik sınırı: ${AFK_MAX_CHAPTERS} bölüm tamamlandı. Yeniden başlatmak için AFK’yi açın.` });
      return;
    }
    const nextUrl = findNextChapter();
    if (!nextUrl) {
      setAfk(false, 'Sonraki bölüm bulunamadı.');
      S.ui.toast({ key: 'afk', kind: 'info', text: 'Sonraki bölüm bağlantısı bulunamadı; AFK durduruldu.' });
      return;
    }
    try { localStorage.setItem(AFK_CHAPTERS_KEY, String(chapters + 1)); } catch {
      setAfk(false, 'Bölüm sayacı kaydedilemedi.');
      return;
    }
    location.href = nextUrl;
  }

  // ------------------------------------------------------------------ görsel takibi

  function track(img) {
    if (!(img instanceof HTMLImageElement) || S.recs.has(img)) return;
    const rec = {
      img,
      state: 'new', // new | idle | queued | working | done | failed | ignored
      url: '',
      overlay: null,
      badge: null,
      boxes: null,
      tries: 0,
      force: false,
      loadHook: false,
      geom: '',
      fitSize: '',
    };
    S.recs.set(img, rec);
    S.ro.observe(img);
    evaluate(rec);
  }

  const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url'];

  /** Henüz yüklenmemiş (lazy-load) görselin gerçek adresi, sayfa kaydırılmadan önce de bilinebilir. */
  function lazyCandidate(img) {
    for (const a of LAZY_ATTRS) {
      const v = img.getAttribute(a);
      if (v && !/^data:/i.test(v.trim())) {
        try {
          return new URL(v.trim(), location.href).href;
        } catch {
          /* geçersiz adres */
        }
      }
    }
    return null;
  }

  /** Görsel sıraya girer: 'near' modunda ekrana yaklaşınca, 'all' modunda hemen. */
  function release(rec) {
    if (S.config.render.prefetch === 'near') S.io.observe(rec.img);
    else enqueue(rec);
  }

  function evaluate(rec) {
    const img = rec.img;
    const { minImageWidth, minImageHeight } = S.config.render;
    const loaded = img.complete && img.naturalWidth > 0;
    let url = loaded ? img.currentSrc || img.src : null;
    let sizeKnown = loaded;

    // Yüklü ama küçük (yer tutucu) ya da henüz yüklenmemiş: gerçek adres data-src gibi bir özellikte olabilir.
    if (!loaded || img.naturalWidth < minImageWidth || img.naturalHeight < minImageHeight) {
      const alt = lazyCandidate(img);
      if (alt) {
        url = alt;
        sizeKnown = false; // boyut yüklenince/arka planda doğrulanır
      }
    }

    if (!url) {
      if (!loaded && !rec.loadHook) {
        rec.loadHook = true;
        img.addEventListener(
          'load',
          () => {
            rec.loadHook = false;
            evaluate(rec);
          },
          { once: true },
        );
      }
      return;
    }
    if (rec.url === url && rec.state !== 'new') return;
    if (rec.url && rec.url !== url) resetRec(rec);

    rec.url = url;
    if (sizeKnown && (img.naturalWidth < minImageWidth || img.naturalHeight < minImageHeight)) {
      rec.state = 'ignored';
      updateStatus();
      return;
    }
    rec.state = 'idle';
    release(rec);
  }

  function resetRec(rec) {
    removeOverlay(rec);
    removeBadge(rec);
    S.queue = S.queue.filter((r) => r !== rec);
    rec.state = 'new';
    rec.boxes = null;
    rec.tries = 0;
    S.io?.unobserve(rec.img);
  }

  function untrack(rec) {
    resetRec(rec);
    S.ro.unobserve(rec.img);
    S.recs.delete(rec.img);
  }

  function onIntersect(entries) {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const rec = S.recs.get(en.target);
      if (rec && rec.state === 'idle') {
        S.io.unobserve(en.target);
        enqueue(rec);
      }
    }
  }

  function onMutations(muts) {
    for (const m of muts) {
      const target = m.target;
      if (target.nodeType === 1 && target.closest?.('#wtt-layer, #wtt-ui-host')) continue;
      if (m.type === 'attributes') {
        if (target.tagName === 'IMG') {
          const rec = S.recs.get(target);
          if (rec) evaluate(rec);
          else track(target);
        }
      } else {
        m.addedNodes.forEach(scanNode);
        m.removedNodes.forEach(cleanupNode);
      }
    }
  }

  function scanNode(n) {
    if (n.nodeType !== 1) return;
    if (n.id === 'wtt-layer' || n.id === 'wtt-ui-host') return;
    if (n.tagName === 'IMG') track(n);
    else n.querySelectorAll?.('img').forEach(track);
  }

  function cleanupNode(n) {
    if (n.nodeType !== 1) return;
    const imgs = n.tagName === 'IMG' ? [n] : [...(n.querySelectorAll?.('img') || [])];
    for (const img of imgs) {
      // Sayfa düğümü başka yere taşıdıysa (hâlâ bağlıysa) dokunma.
      if (img.isConnected) continue;
      const rec = S.recs.get(img);
      if (rec) untrack(rec);
    }
  }

  // ------------------------------------------------------------------ kuyruk

  function enqueue(rec) {
    if (rec.state === 'queued' || rec.state === 'working') return;
    rec.state = 'queued';
    S.queue.push(rec);
    pump();
  }

  /**
   * Sıradaki görseli seçer: önce ekranda görünenler (yukarıdan aşağı), sonra ekranın ALTINDAKİLER
   * sayfa sırasıyla, en son ekranın üstünde kalanlar (en yakından başlayarak).
   * Böylece sistem sürekli bir sonraki görsele geçer; kullanıcı aşağı indiğinde çeviri hazır olur.
   */
  function priority(rec) {
    const r = rec.img.getBoundingClientRect();
    const vh = window.innerHeight;
    if (r.bottom > 0 && r.top < vh) return -1e9 + r.top; // ekranda
    if (r.top >= vh) return r.top; // aşağıda
    return 1e9 - r.bottom; // yukarıda kalmış
  }

  function takeNearest() {
    let best = -1;
    let bestScore = Infinity;
    S.queue.forEach((rec, i) => {
      if (!rec.img.isConnected) return;
      const score = priority(rec);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) {
      S.queue = S.queue.filter((r) => r.img.isConnected);
      return null;
    }
    return S.queue.splice(best, 1)[0];
  }

  function pump() {
    while (!S.paused && !S.dead && S.active < MAX_PARALLEL && S.queue.length) {
      const rec = takeNearest();
      if (!rec) break;
      if (rec.state !== 'queued') continue;
      rec.state = 'working';
      S.active++;
      processRec(rec).finally(() => {
        S.active--;
        pump();
      });
    }
    updateStatus();
  }

  async function toDataUrl(url) {
    if (url.startsWith('data:')) return url;
    const blob = await (await fetch(url)).blob();
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function processRec(rec) {
    const urlAtStart = rec.url;
    let dataUrl;
    if (/^(blob:|data:)/.test(urlAtStart)) {
      try {
        dataUrl = await toDataUrl(urlAtStart);
      } catch {
        rec.state = 'failed';
        return;
      }
    }
    const force = rec.force;
    rec.force = false;
    const r = await send({ type: 'TRANSLATE_IMAGE', url: urlAtStart, dataUrl, force });
    if (S.dead) return;

    if (rec.url !== urlAtStart || !S.recs.has(rec.img)) return; // bu arada görsel değişti/silindi

    if (r?.ok) {
      rec.boxes = r.result.boxes || [];
      rec.state = 'done';
      rec.tries = 0;
      removeBadge(rec);
      renderOverlay(rec);
      if (r.result.warning) S.ui.toast({ key: 'warn', kind: 'info', text: r.result.warning });
      return;
    }
    handleError(rec, r?.error || { code: 'UNKNOWN', message: 'Bilinmeyen hata.' });
  }

  function handleError(rec, e) {
    if (e.fatal) {
      rec.state = 'queued';
      S.queue.unshift(rec);
      const autoMs =
        e.code === 'QUOTA_MINUTE' ? Math.max(30000, e.retryAfterMs || 0) : e.code === 'MOBILE_HOLD' ? 15000 : 0;
      pause(e, { autoMs });
      return;
    }
    if (e.transient && rec.tries < MAX_TRANSIENT_RETRIES) {
      rec.tries++;
      rec.state = 'queued';
      setTimeout(() => {
        S.queue.push(rec);
        pump();
      }, 2500 * rec.tries);
      return;
    }
    rec.state = 'failed';
    const now = Date.now();
    if (now - S.lastFailToast > 8000) {
      S.lastFailToast = now;
      S.ui.toast({
        key: 'fail',
        kind: 'error',
        text: `Bir görsel çevrilemedi: ${e.message || e.code}`,
        actions: [{ label: 'Başarısızları yeniden dene', onClick: retryFailed }],
      });
    }
  }

  function retryFailed() {
    for (const rec of S.recs.values()) {
      if (rec.state === 'failed') {
        rec.tries = 0;
        enqueue(rec);
      }
    }
  }

  // ------------------------------------------------------------------ duraklat / devam

  function pause(info, { auto, autoMs } = {}) {
    S.paused = true;
    S.pauseInfo = info;
    clearTimeout(S.resumeTimer);
    if (autoMs) S.resumeTimer = setTimeout(() => resume(), autoMs);
    const actions = [{ label: 'Tekrar dene', onClick: () => resume() }];
    if (['NO_API_KEY', 'FREE_TIER_UNCONFIRMED', 'AUTH', 'MODEL_NOT_FOUND', 'QUOTA_DAILY', 'LOCAL_CAP', 'OLLAMA_DOWN', 'OLLAMA_ORIGIN', 'OLLAMA_MODEL'].includes(info.code)) {
      actions.push({ label: 'Ayarlar', onClick: () => send({ type: 'OPEN_OPTIONS' }) });
    }
    S.ui.toast({ key: 'pause', kind: 'error', sticky: true, text: info.message || info.code, actions });
    updateStatus();
  }

  async function resume() {
    clearTimeout(S.resumeTimer);
    S.ui.dismiss('pause');
    // Kullanıcı ayarları değiştirmiş olabilir.
    const r = await send({ type: 'GET_PAGE_CONFIG' });
    if (r?.ok) S.config = r;
    S.paused = false;
    S.pauseInfo = null;
    pump();
  }

  // ------------------------------------------------------------------ çizim

  function buildLayer() {
    const layer = document.createElement('div');
    layer.id = 'wtt-layer';
    document.documentElement.appendChild(layer);
    layer.addEventListener('mouseover', (e) => {
      const box = e.target.closest?.('.wtt-box');
      if (box) {
        S.ui.showTip(box.dataset.o || '', box.getBoundingClientRect());
        // Dokunmatik ekranda "üstünden ayrılma" olmaz: ipucu birkaç saniye sonra kendiliğinden kapanır.
        clearTimeout(S.tipTimer);
        if (window.matchMedia?.('(hover: none)').matches) S.tipTimer = setTimeout(() => S.ui.hideTip(), 4500);
      }
    });
    layer.addEventListener('mouseout', (e) => {
      if (e.target.closest?.('.wtt-box')) S.ui.hideTip();
    });
    return layer;
  }

  function lum(hex) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  }

  function contrast(a, b) {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  }

  function colorsFor(item) {
    const bg = item.bg || '#ffffff';
    let fg = item.fg || (lum(bg) > 0.4 ? '#111111' : '#ffffff');
    if (contrast(bg, fg) < 3) fg = lum(bg) > 0.4 ? '#111111' : '#ffffff';
    return { bg, fg };
  }

  // ------------------------------------------------------------------ rozet ("Çevriliyor…")

  const BADGE_TEXT = {
    queued: '⏳ Sırada…',
    working: '⏳ Çevriliyor…',
    failed: '⚠ Çevrilemedi — tıkla: tekrar dene',
  };

  function removeBadge(rec) {
    rec.badge?.remove();
    rec.badge = null;
  }

  /** Görselin ÜST kenarına durum rozeti koyar/günceller (yalnızca çevrilmekte olan görsellerde). */
  function syncBadge(rec) {
    let text = BADGE_TEXT[rec.state];
    if (!text || !rec.img.isConnected) return removeBadge(rec);
    if (rec.state === 'queued' && S.paused) text = '⏸ Duraklatıldı';

    const r = rec.img.getBoundingClientRect();
    const offscreen = r.width < 2 || r.bottom < 0 || r.top > window.innerHeight;
    if (offscreen) {
      if (rec.badge) rec.badge.style.display = 'none';
      return;
    }
    if (!rec.badge) {
      const b = document.createElement('div');
      b.className = 'wtt-badge';
      b.addEventListener('click', () => {
        if (rec.state === 'failed') {
          rec.tries = 0;
          enqueue(rec);
        }
      });
      S.layer.appendChild(b);
      rec.badge = b;
    }
    const b = rec.badge;
    if (b.textContent !== text) b.textContent = text;
    b.classList.toggle('wtt-bad', rec.state === 'failed');
    const o = S.layer.getBoundingClientRect();
    const top = r.top + 10; // görselin kendi üstüne sabit: sayfayla birlikte kayar, ekrana yapışmaz
    b.style.cssText = `display:block;left:${r.left + r.width / 2 - o.left}px;top:${top - o.top}px;`;
  }

  function syncBadges() {
    for (const rec of S.recs.values()) syncBadge(rec);
  }

  function removeOverlay(rec) {
    rec.overlay?.remove();
    rec.overlay = null;
    rec.geom = '';
    rec.fitSize = '';
  }

  function renderOverlay(rec) {
    removeOverlay(rec);
    const { showSfx, expand } = S.config.render;
    // SFX ve çizimin içindeki yazılar (el yazısı, tabela…) yalnızca ayar açıksa gösterilir.
    const items = (rec.boxes || []).filter((b) => showSfx || (b.kind !== 'sfx' && b.kind !== 'art'));
    if (!items.length) return;

    const ov = document.createElement('div');
    ov.className = 'wtt-overlay';
    for (const it of items) {
      const [x0, y0, x1, y1] = it.box;
      const bw = x1 - x0;
      const bh = y1 - y0;
      const ex = bw * expand;
      const ey = bh * expand * 0.8;
      const left = Math.max(0, x0 - ex);
      const top = Math.max(0, y0 - ey);
      const right = Math.min(1, x1 + ex);
      const bottom = Math.min(1, y1 + ey);

      const { bg, fg } = colorsFor(it);
      const box = document.createElement('div');
      box.className = `wtt-box wtt-${it.kind}`;
      box.lang = 'tr';
      box.dataset.o = it.original || '';
      box.style.cssText =
        `left:${(left * 100).toFixed(3)}%;top:${(top * 100).toFixed(3)}%;` +
        `width:${((right - left) * 100).toFixed(3)}%;height:${((bottom - top) * 100).toFixed(3)}%;` +
        `background:${bg};color:${fg};`;
      const txt = document.createElement('span');
      txt.className = 'wtt-txt';
      txt.textContent = it.translation;
      box.appendChild(txt);
      ov.appendChild(box);
    }
    S.layer.appendChild(ov);
    rec.overlay = ov;
    positionOverlay(rec, true);
  }

  /** Overlay'i görselin ekran konumuna/boyutuna eşitler. Sayfa kayması için periyodik olarak da çağrılır. */
  function positionOverlay(rec, force = false) {
    const ov = rec.overlay;
    if (!ov) return;
    const r = rec.img.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || !rec.img.isConnected) {
      ov.style.display = 'none';
      rec.geom = '';
      rec.fitSize = '';
      return;
    }
    const o = S.layer.getBoundingClientRect();
    const left = r.left - o.left;
    const top = r.top - o.top;
    const size = `${r.width.toFixed(1)}|${r.height.toFixed(1)}`;
    const geom = `${left.toFixed(1)}|${top.toFixed(1)}|${size}`;
    if (!force && geom === rec.geom) return;
    rec.geom = geom;
    ov.style.cssText =
      `display:block;left:${left}px;top:${top}px;width:${r.width}px;height:${r.height}px;`;
    if (S.visible && size !== rec.fitSize && ov.offsetWidth > 0 && ov.offsetHeight > 0) {
      fitOverlay(ov);
      rec.fitSize = size;
    }
  }

  function syncGeometry() {
    if (S.dead || document.hidden) return;
    for (const rec of S.recs.values()) {
      if (!rec.img.isConnected) {
        untrack(rec);
        continue;
      }
      if (rec.overlay) positionOverlay(rec);
      syncBadge(rec);
    }
  }

  /** Satırlar küçülmeyen metin öğesinde ölçülür. Ekran boyutu değişirse ölçüm yeniden yapılır. */
  function fitOverlay(ov) {
    const minReadablePx = 8;
    const stepsPerPx = 4;
    for (const box of ov.children) {
      const txt = box.firstElementChild;
      const { width, height } = box.getBoundingClientRect();
      const maxSteps = Math.floor(Math.min(40, height) * stepsPerPx);
      const setSize = (steps) => box.style.setProperty('font-size', `${steps / stepsPerPx}px`, 'important');
      const fits = () =>
        width >= 1 && txt.getBoundingClientRect().height + 0.5 <= height && txt.scrollWidth <= txt.clientWidth;

      function largestFit(breakWords) {
        box.classList.toggle('wtt-break', breakWords);
        let best = 0;
        let lo = stepsPerPx;
        let hi = maxSteps;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          setSize(mid);
          if (fits()) {
            best = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        return best;
      }

      const wholeWords = largestFit(false);
      const wrapped = wholeWords < minReadablePx * stepsPerPx ? largestFit(true) : 0;
      box.classList.toggle('wtt-break', wrapped > wholeWords);
      const best = Math.max(wholeWords, wrapped);
      // Ölçülemeyecek kadar küçük kutu özgün metnin üzerini kapatmasın.
      box.style.visibility = best ? '' : 'hidden';
      if (best) setSize(best);
    }
  }

  // ------------------------------------------------------------------ görünürlük

  function applyVisible() {
    document.documentElement.toggleAttribute('data-wtt-hidden', !S.visible);
    S.ui.setVisible(S.visible);
    if (S.visible) {
      for (const rec of S.recs.values()) if (rec.overlay) positionOverlay(rec, true);
    }
  }

  function setVisible(v) {
    S.visible = v;
    try {
      localStorage.setItem(VIS_KEY, v ? '1' : '0');
    } catch {
      /* yoksay */
    }
    applyVisible();
  }

  // ------------------------------------------------------------------ durum

  function stats() {
    let total = 0;
    let done = 0;
    let failed = 0;
    let busy = 0;
    for (const rec of S.recs.values()) {
      if (rec.state === 'ignored' || rec.state === 'new') continue;
      total++;
      if (rec.state === 'done') done++;
      else if (rec.state === 'failed') failed++;
      else if (rec.state === 'working' || rec.state === 'queued') busy++;
    }
    return { total, done, failed, busy };
  }

  function updateStatus() {
    if (!S.ui) return;
    syncBadges();
    const st = stats();
    if (typeof reportMobileStatus === 'function') {
      reportMobileStatus({
        ...st, active: S.active, afk: S.afk, paused: S.paused,
        hasAfkStart: getAfkStart() !== null, note: S.pauseInfo?.message || S.afkNote,
      });
    }
    let label = '';
    let tone = 'idle';
    if (S.paused) {
      label = '⚠ Duraklatıldı — tıkla: devam';
      tone = 'warn';
    } else if (st.busy > 0) {
      label = S.active > 0 ? `Çevriliyor… ${st.done}/${st.total}` : `Sırada… ${st.busy}`;
      tone = 'busy';
    } else if (st.failed > 0) {
      label = `${st.done} çevrildi, ${st.failed} başarısız — tıkla: tekrar dene`;
      tone = 'warn';
    } else if (S.afk) {
      label = 'AFK açık';
    }
    S.ui.setStatus(label, tone, () => {
      if (S.paused) resume();
      else if (st.failed > 0) retryFailed();
    });
  }

  // ------------------------------------------------------------------ popup / arka plan mesajları

  function onExtensionMessage(msg, _sender, sendResponse) {
    switch (msg?.type) {
      case 'TOGGLE':
        setVisible(!S.visible);
        S.ui.toast({ key: 'vis', kind: 'info', text: S.visible ? 'Çeviri açık' : 'Çeviri gizlendi (orijinal görünüyor)' });
        sendResponse({ ok: true, visible: S.visible });
        break;
      case 'SET_VISIBLE':
        setVisible(Boolean(msg.visible));
        sendResponse({ ok: true, visible: S.visible });
        break;
      case 'GET_STATUS': {
        sendResponse({
          ok: true,
          visible: S.visible,
          paused: S.paused,
          pauseInfo: S.pauseInfo,
          afk: S.afk,
          hasAfkStart: getAfkStart() !== null,
          stats: stats(),
        });
        break;
      }
      case 'SET_AFK':
        setAfk(Boolean(msg.enabled));
        sendResponse({ ok: true, afk: S.afk });
        break;
      case 'RETURN_AFK_START':
        sendResponse({ ok: returnToAfkStart() });
        break;
      case 'RESCAN': {
        // Önbelleği yok sayarak sayfadaki tüm görselleri yeniden çevir.
        for (const rec of S.recs.values()) {
          if (rec.state === 'ignored' || rec.state === 'new') continue;
          removeOverlay(rec);
          rec.force = Boolean(msg.force);
          rec.tries = 0;
          rec.state = 'idle';
          release(rec);
        }
        sendResponse({ ok: true });
        break;
      }
      case 'RESUME':
        resume();
        sendResponse({ ok: true });
        break;
      case 'CONFIG_CHANGED':
        send({ type: 'GET_PAGE_CONFIG' }).then((r) => {
          if (r?.ok) S.config = r;
        });
        sendResponse({ ok: true });
        break;
      default:
        return false;
    }
    return false;
  }

  // ------------------------------------------------------------------ arayüz (Shadow DOM)

  /** CSS'i CSP'den etkilenmeyen yolla ekler (constructable stylesheet); olmazsa <style> elemanı. */
  function adoptCss(root, css) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [...(root.adoptedStyleSheets || []), sheet];
      return;
    } catch {
      /* eski WebView: <style> ile dene */
    }
    const st = document.createElement('style');
    st.textContent = css;
    (root.head || root).appendChild(st);
  }

  function buildUI() {
    const host = document.createElement('div');
    host.id = 'wtt-ui-host';
    host.style.cssText = 'all:initial;position:fixed;right:0;bottom:0;width:0;height:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    // Stil, CSSOM ile (constructable stylesheet) uygulanır: sayfanın katı CSP'si (style-src) satır içi <style>'ı engelleyebilir.
    const UI_CSS = `
        *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
        .dock{position:fixed;right:16px;bottom:16px;display:flex;align-items:center;gap:8px}
        .fab{width:44px;height:44px;border-radius:50%;border:0;cursor:pointer;font-weight:800;font-size:15px;
          color:#fff;background:#2b6cff;box-shadow:0 2px 10px rgba(0,0,0,.35);opacity:.9}
        .fab:hover{opacity:1}
        .fab.off{background:#6b7280}
        .chip{display:none;max-width:320px;padding:6px 10px;border-radius:999px;font-size:12px;cursor:default;
          color:#fff;background:rgba(17,24,39,.92);box-shadow:0 2px 8px rgba(0,0,0,.3)}
        .chip.show{display:block}
        .chip.busy{background:rgba(43,108,255,.95)}
        .chip.ok{background:rgba(22,163,74,.95)}
        .chip.warn{background:rgba(217,119,6,.97);cursor:pointer}
        .toasts{position:fixed;right:16px;bottom:72px;display:flex;flex-direction:column;gap:8px;max-width:340px}
        .toast{padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.35;color:#fff;
          background:rgba(17,24,39,.96);box-shadow:0 4px 14px rgba(0,0,0,.35)}
        .toast.error{background:rgba(153,27,27,.97)}
        .toast .row{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
        .toast button{border:0;border-radius:6px;padding:4px 9px;font-size:12px;cursor:pointer;background:#fff;color:#111}
        .tip{position:fixed;display:none;max-width:320px;padding:7px 10px;border-radius:8px;font-size:13px;
          line-height:1.35;color:#fff;background:rgba(17,24,39,.97);box-shadow:0 4px 14px rgba(0,0,0,.4);
          pointer-events:none;white-space:pre-wrap}
        .tip small{display:block;opacity:.65;font-size:10px;letter-spacing:.06em;margin-bottom:2px}
    `;
    function make(tag, className, parent) {
      const element = document.createElement(tag);
      element.className = className;
      parent.appendChild(element);
      return element;
    }
    const dock = make('div', 'dock', root);
    const chip = make('div', 'chip', dock);
    const fab = make('button', 'fab', dock);
    fab.type = 'button';
    fab.textContent = 'TR';
    fab.title = 'Çeviriyi göster/gizle (Alt+T)';
    const toasts = make('div', 'toasts', root);
    const tip = make('div', 'tip', root);
    adoptCss(root, UI_CSS);
    document.documentElement.appendChild(host);

    let chipHandler = null;

    fab.addEventListener('click', () => setVisible(!S.visible));
    chip.addEventListener('click', () => chipHandler?.());

    const live = new Map(); // key -> {el, timer}

    function dismiss(key) {
      const t = live.get(key);
      if (!t) return;
      clearTimeout(t.timer);
      t.el.remove();
      live.delete(key);
    }

    return {
      setVisible(v) {
        fab.classList.toggle('off', !v);
        fab.title = v ? 'Çeviriyi gizle (Alt+T)' : 'Çeviriyi göster (Alt+T)';
      },
      setStatus(label, tone, onClick) {
        chip.textContent = label;
        chip.className = 'chip' + (label ? ' show ' + tone : '');
        chipHandler = onClick;
      },
      toast({ key, text, kind = 'info', sticky = false, actions = [] }) {
        if (key) dismiss(key);
        const el = document.createElement('div');
        el.className = 'toast ' + kind;
        const p = document.createElement('div');
        p.textContent = text;
        el.appendChild(p);
        if (actions.length || sticky) {
          const row = document.createElement('div');
          row.className = 'row';
          for (const a of actions) {
            const b = document.createElement('button');
            b.textContent = a.label;
            b.addEventListener('click', () => {
              a.onClick();
              if (key) dismiss(key);
              else el.remove();
            });
            row.appendChild(b);
          }
          if (sticky) {
            const close = document.createElement('button');
            close.textContent = 'Kapat';
            close.addEventListener('click', () => (key ? dismiss(key) : el.remove()));
            row.appendChild(close);
          }
          el.appendChild(row);
        }
        toasts.appendChild(el);
        const k = key || Symbol('t');
        const timer = sticky ? null : setTimeout(() => dismiss(k), 6000);
        live.set(k, { el, timer });
      },
      dismiss,
      showTip(text, rect) {
        if (!text) return;
        const heading = document.createElement('small');
        heading.textContent = 'ORİJİNAL (EN)';
        tip.replaceChildren(heading);
        tip.appendChild(document.createTextNode(text));
        tip.style.display = 'block';
        const th = tip.offsetHeight;
        const tw = tip.offsetWidth;
        let top = rect.top - th - 8;
        if (top < 8) top = rect.bottom + 8;
        const left = Math.min(Math.max(8, rect.left + rect.width / 2 - tw / 2), window.innerWidth - tw - 8);
        tip.style.top = top + 'px';
        tip.style.left = left + 'px';
      },
      hideTip() {
        tip.style.display = 'none';
      },
    };
  }

  function shutdown() {
    S.io?.disconnect();
    S.mo?.disconnect();
    S.ro?.disconnect();
  }

  init();
})();

})();
