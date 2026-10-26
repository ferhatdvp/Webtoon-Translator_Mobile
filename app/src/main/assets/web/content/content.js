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
    updateStatus();
  }

  function loadVisible() {
    try {
      return localStorage.getItem(VIS_KEY) !== '0';
    } catch {
      return true;
    }
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
      needsFit: false,
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
    rec.needsFit = true;
    positionOverlay(rec, true);
  }

  /** Overlay'i görselin ekran konumuna/boyutuna eşitler. Sayfa kayması için periyodik olarak da çağrılır. */
  function positionOverlay(rec, force = false) {
    const ov = rec.overlay;
    if (!ov) return;
    const r = rec.img.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || !rec.img.isConnected) {
      ov.style.display = 'none';
      return;
    }
    const o = S.layer.getBoundingClientRect();
    const left = r.left - o.left;
    const top = r.top - o.top;
    const geom = `${left.toFixed(1)}|${top.toFixed(1)}|${r.width.toFixed(1)}|${r.height.toFixed(1)}`;
    if (!force && geom === rec.geom) return;
    rec.geom = geom;
    ov.style.cssText =
      `display:block;left:${left}px;top:${top}px;width:${r.width}px;height:${r.height}px;` +
      `--wtt-w:${r.width}px;`;
    if (rec.needsFit && S.visible) fitOverlay(rec);
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

  /**
   * Her kutu için kutuya sığan en büyük punto bulunur (ikili arama). Punto, görsel genişliğine oranlanıp
   * calc(var(--wtt-w) * oran) olarak yazılır; böylece görsel yeniden boyutlanınca yazı ölçekle birlikte değişir.
   */
  function fitOverlay(rec) {
    const ov = rec.overlay;
    if (!ov || ov.offsetWidth === 0) return;
    const imgW = ov.offsetWidth;
    rec.needsFit = false;
    for (const box of ov.children) {
      const txt = box.firstElementChild;
      const maxH = box.clientHeight;
      if (maxH <= 0) continue;
      const fits = () => txt.offsetHeight <= box.clientHeight + 0.5 && txt.scrollWidth <= box.clientWidth + 0.5;
      let lo = 6;
      let hi = Math.max(lo, Math.min(40, Math.floor(maxH)));
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        box.style.fontSize = mid + 'px';
        if (fits()) lo = mid;
        else hi = mid - 1;
      }
      box.style.fontSize = lo + 'px';
      if (!fits()) box.classList.add('wtt-break'); // en küçük puntoda bile sığmıyorsa uzun kelimeyi böl
      const ratio = (lo * 0.97) / imgW;
      box.style.fontSize = `calc(var(--wtt-w) * ${ratio.toFixed(5)})`;
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
    let label = '';
    let tone = 'idle';
    if (S.paused) {
      label = '⚠ Duraklatıldı — tıkla: devam';
      tone = 'warn';
    } else if (st.busy > 0) {
      label = ''; // çeviri sürerken ekranda ek bilgi tutma; durum görsellerin üstündeki rozette
    } else if (st.failed > 0) {
      label = `${st.done} çevrildi, ${st.failed} başarısız — tıkla: tekrar dene`;
      tone = 'warn';
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
      case 'GET_STATUS':
        sendResponse({
          ok: true,
          visible: S.visible,
          paused: S.paused,
          pauseInfo: S.pauseInfo,
          stats: stats(),
        });
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
    root.innerHTML = `
      <div class="dock"><div class="chip"></div><button class="fab" title="Çeviriyi göster/gizle (Alt+T)">TR</button></div>
      <div class="toasts"></div>
      <div class="tip"></div>`;
    adoptCss(root, UI_CSS); // innerHTML'den SONRA (yedek <style> yolu silinmesin)
    document.documentElement.appendChild(host);

    const fab = root.querySelector('.fab');
    const chip = root.querySelector('.chip');
    const toasts = root.querySelector('.toasts');
    const tip = root.querySelector('.tip');
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
        tip.innerHTML = '<small>ORİJİNAL (EN)</small>';
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
