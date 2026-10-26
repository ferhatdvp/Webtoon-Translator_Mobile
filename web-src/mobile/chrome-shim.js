// web-src/mobile/chrome-shim.js
// Android uygulamasında "arka plan" (worker.html) ve ayarlar sayfası (options-mobile.html) için
// minimal bir `chrome.*` katmanı. Gerçek iş native taraftadır (window.__wttHost = Kotlin köprüsü).
// Sayfa (tarayıcı) tarafında BU DOSYA KULLANILMAZ; orada page-shim kullanılır (window.chrome'a dokunmaz).
(() => {
  'use strict';
  const H = globalThis.__wttHost;
  if (!H) throw new Error('Native köprü (__wttHost) yok.');
  const IS_WORKER = Boolean(globalThis.__WTT_WORKER__);
  const EXT_BASE = location.origin + '/assets/web/';
  globalThis.__WTT_ANDROID__ = true;

  const makeEvent = () => {
    const ls = [];
    return {
      _ls: ls,
      addListener: (f) => ls.push(f),
      removeListener: (f) => {
        const i = ls.indexOf(f);
        if (i >= 0) ls.splice(i, 1);
      },
      hasListener: (f) => ls.includes(f),
    };
  };

  // ------------------------------------------------------------ storage.local (native SharedPreferences)
  const onChanged = makeEvent();
  const readKey = (k) => {
    const raw = H.storageGet(String(k));
    if (raw == null || raw === '') return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  };
  const storage = {
    local: {
      async get(keys) {
        const out = {};
        if (keys == null) {
          for (const k of JSON.parse(H.storageKeys() || '[]')) out[k] = readKey(k);
          return out;
        }
        if (typeof keys === 'string') keys = [keys];
        if (Array.isArray(keys)) {
          for (const k of keys) {
            const v = readKey(k);
            if (v !== undefined) out[k] = v;
          }
          return out;
        }
        for (const [k, def] of Object.entries(keys)) {
          const v = readKey(k);
          out[k] = v === undefined ? def : v;
        }
        return out;
      },
      async set(obj) {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          const oldValue = readKey(k);
          H.storageSet(k, JSON.stringify(v));
          changes[k] = { oldValue, newValue: v };
        }
        for (const f of onChanged._ls) {
          try {
            f(changes, 'local');
          } catch {
            /* dinleyici hatası yok sayılır */
          }
        }
      },
      async remove(keys) {
        for (const k of Array.isArray(keys) ? keys : [keys]) H.storageRemove(String(k));
      },
      async setAccessLevel() {},
    },
    onChanged,
  };

  // ------------------------------------------------------------ runtime
  const onMessage = makeEvent();
  const pending = new Map();
  let seq = 1;

  // Native → bu sayfa (ayarlar sayfasının istek yanıtları)
  globalThis.__wttReply = (id, json) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    try {
      p(JSON.parse(json));
    } catch {
      p(undefined);
    }
  };

  function viaNative(msg) {
    return new Promise((resolve) => {
      const id = seq++;
      pending.set(id, resolve);
      H.sendToWorker(id, JSON.stringify(msg));
    });
  }

  // Worker içinde: Kotlin → __wttDispatch → eklentinin onMessage dinleyicisi (service-worker.js)
  function dispatchLocal(msg, sender) {
    return new Promise((resolve) => {
      let answered = false;
      const respond = (r) => {
        if (!answered) {
          answered = true;
          resolve(r);
        }
      };
      let asyncAnswer = false;
      for (const f of onMessage._ls) {
        try {
          if (f(msg, sender, respond) === true) asyncAnswer = true;
        } catch (e) {
          respond({ ok: false, error: { code: 'UNKNOWN', message: String(e?.message || e) } });
        }
      }
      if (!asyncAnswer) respond(undefined);
    });
  }

  if (IS_WORKER) {
    globalThis.__wttDispatch = (reqId, source, pageUrl, msgJson) => {
      let msg;
      try {
        msg = JSON.parse(msgJson);
      } catch {
        H.reply(reqId, JSON.stringify({ ok: false, error: { code: 'UNKNOWN', message: 'Geçersiz mesaj.' } }));
        return;
      }
      const sender =
        source === 'ext'
          ? { url: EXT_BASE + 'options/options-mobile.html' }
          : { url: pageUrl, tab: { url: pageUrl } };
      dispatchLocal(msg, sender).then((res) => H.reply(reqId, JSON.stringify(res === undefined ? null : res)));
    };
  }

  const runtime = {
    id: 'android-app',
    getURL: (p = '') => EXT_BASE + p,
    onMessage,
    onInstalled: makeEvent(),
    onStartup: makeEvent(),
    sendMessage: (msg) => (IS_WORKER ? dispatchLocal(msg, { url: EXT_BASE + 'options/options-mobile.html' }) : viaNative(msg)),
    openOptionsPage: async () => {}, // ayarlar zaten bu sayfa
  };

  globalThis.chrome = {
    runtime,
    storage,
    commands: { onCommand: makeEvent() },
    tabs: {
      query: async () => [],
      sendMessage: async () => undefined,
    },
    permissions: {
      request: async () => true, // Android'de site izni diye bir kavram yok; liste uygulama içinde uygulanır
      contains: async () => true,
    },
    // declarativeNetRequest / scripting bilerek yok: kodun geri kalanı bunların yokluğunu bekler.
  };
})();
