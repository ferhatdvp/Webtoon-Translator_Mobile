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
  var CSS_TEXT = /*__CSS__*/ '';
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

  /*__CONTENT__*/
})();
