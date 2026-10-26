// web-src/mobile/native-fetch.js
// Worker sayfasında fetch(): aynı kökene giden istekler normal gider (yerel dosyalar, /native/image),
// diğerleri (Gemini, Ollama) native HTTP katmanından geçer. Böylece CORS/karışık içerik/Origin sorunları olmaz
// ve provider kodu (gemini.js / ollama.js) değişmeden çalışır.
(() => {
  'use strict';
  const H = globalThis.__wttHost;
  const origFetch = globalThis.fetch.bind(globalThis);
  const pending = new Map();
  let seq = 1;

  globalThis.__wttHttpDone = (id, json) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    try {
      p.done(JSON.parse(json));
    } catch (e) {
      p.fail(e);
    }
  };

  const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

  function nativeFetch(url, init) {
    const id = seq++;
    const method = String(init.method || 'GET').toUpperCase();
    const headers = {};
    new Headers(init.headers || {}).forEach((v, k) => {
      headers[k] = v;
    });
    const body = init.body == null ? null : String(init.body);
    const signal = init.signal;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const onAbort = () => {
        if (pending.delete(id)) H.httpCancel(id);
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      pending.set(id, {
        done: (r) => {
          signal?.removeEventListener('abort', onAbort);
          if (r.error) return reject(new TypeError(r.error));
          // 204/205/304 yanıtlarında Response gövdesi null olmalıdır.
          const nullBody = [101, 204, 205, 304].includes(r.status);
          resolve(new Response(nullBody ? null : r.body, { status: r.status, headers: r.headers || {} }));
        },
        fail: (e) => {
          signal?.removeEventListener('abort', onAbort);
          reject(e);
        },
      });
      H.httpRequest(id, JSON.stringify({ method, url, headers, body, timeoutMs: 120000 }));
    });
  }

  globalThis.fetch = function (input, init = {}) {
    const raw = typeof input === 'string' ? input : input?.url;
    const abs = new URL(raw, location.href);
    if (abs.origin === location.origin) return origFetch(input, init);
    return nativeFetch(abs.href, init);
  };
})();
