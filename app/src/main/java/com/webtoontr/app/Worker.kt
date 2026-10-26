package com.webtoontr.app

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * "Arka plan": ekranda görünmeyen bir WebView, eklentinin service-worker.js + pipeline kodunu aynen çalıştırır
 * (önbellek IndexedDB'de, kota/zamanlayıcı/sağlayıcılar aynı). Ağ çağrıları Http.kt üzerinden gider.
 */
object Worker {
    const val HOST = "appassets.androidplatform.net"
    const val BASE = "https://$HOST/assets/web/"

    private val main = Handler(Looper.getMainLooper())
    private val seq = AtomicInteger(1)
    private val pending = ConcurrentHashMap<Int, (String) -> Unit>()
    private val queue = ArrayList<String>()
    private var ready = false
    private var view: WebView? = null

    fun assetLoader(ctx: Context): WebViewAssetLoader =
        WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx.applicationContext))
            .build()

    @SuppressLint("SetJavaScriptEnabled")
    fun ensure(ctx: Context): WebView {
        view?.let { return it }
        val app = ctx.applicationContext
        Store.init(app)
        val wv = WebView(app)
        val s = wv.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true // IndexedDB (önbellek) için
        s.allowFileAccess = false
        s.allowContentAccess = false
        val loader = assetLoader(app)
        wv.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val u = request.url
                if (u.host == HOST && u.path == "/native/image") {
                    return Http.image(u.getQueryParameter("u"), u.getQueryParameter("r"))
                }
                return loader.shouldInterceptRequest(u)
            }

            // Arka plan sayfası hiçbir yere gitmez.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
        }
        wv.addJavascriptInterface(HostJs(app, true, null), "__wttHost")
        wv.loadUrl(BASE + "mobile/worker.html")
        view = wv
        return wv
    }

    // ------------------------------------------------------------------ mesajlaşma

    /** source: "page" (sitedeki içerik betiği) | "ext" (ayarlar sayfası). Yanıt JSON metni `cb` ile döner. */
    fun dispatch(source: String, pageUrl: String, msgJson: String, cb: (String) -> Unit) {
        val id = seq.getAndIncrement()
        pending[id] = cb
        eval(
            "__wttDispatch($id, ${JSONObject.quote(source)}, ${JSONObject.quote(pageUrl)}, ${JSONObject.quote(msgJson)})",
        )
    }

    fun onReply(id: Int, json: String) {
        pending.remove(id)?.invoke(json)
    }

    fun httpDone(id: Int, json: String) {
        main.post { view?.evaluateJavascript("__wttHttpDone($id, ${JSONObject.quote(json)})", null) }
    }

    private fun eval(js: String) {
        main.post {
            if (!ready) queue.add(js) else view?.evaluateJavascript(js, null)
        }
    }

    fun onReady() {
        main.post {
            ready = true
            for (js in queue) view?.evaluateJavascript(js, null)
            queue.clear()
        }
    }

    /** Uygulama arka plana gidince (ya da ekran kapanınca) çeviri tamamen durur; geri gelince devam eder. */
    fun setActive(active: Boolean) {
        main.post {
            val v = view ?: return@post
            if (active) {
                v.onResume()
                v.resumeTimers()
            } else {
                v.onPause()
                v.pauseTimers()
            }
        }
    }
}

/** JS tarafındaki `window.__wttHost`. Worker ve ayarlar sayfası kullanır; sayfa (site) tarafına ASLA verilmez. */
class HostJs(
    private val ctx: Context,
    private val isWorker: Boolean,
    private val settingsReply: ((Int, String) -> Unit)?,
) {
    @JavascriptInterface
    fun storageGet(key: String): String? = Store.get(key)

    @JavascriptInterface
    fun storageSet(key: String, json: String) {
        Store.set(key, json)
    }

    @JavascriptInterface
    fun storageRemove(key: String) {
        Store.remove(key)
    }

    @JavascriptInterface
    fun storageKeys(): String = Store.keys()

    @JavascriptInterface
    fun device(): String = Device.json(ctx)

    // ---- yalnızca worker ----
    @JavascriptInterface
    fun ready() {
        if (isWorker) Worker.onReady()
    }

    @JavascriptInterface
    fun reply(id: Int, json: String) {
        if (isWorker) Worker.onReply(id, json)
    }

    @JavascriptInterface
    fun httpRequest(id: Int, spec: String) {
        if (isWorker) Http.request(id, spec) { r -> Worker.httpDone(id, r) }
    }

    @JavascriptInterface
    fun httpCancel(id: Int) {
        if (isWorker) Http.cancel(id)
    }

    // ---- yalnızca ayarlar sayfası ----
    @JavascriptInterface
    fun sendToWorker(id: Int, msgJson: String) {
        val cb = settingsReply
        if (!isWorker && cb != null) Worker.dispatch("ext", "", msgJson) { json -> cb(id, json) }
    }
}
