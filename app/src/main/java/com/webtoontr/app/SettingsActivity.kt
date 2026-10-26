package com.webtoontr.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/** Eklentinin ayarlar sayfasının (options.html) aynısı; yalnızca uygulama içi yerel dosyaları yükler. */
class SettingsActivity : Activity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        Worker.ensure(this) // ayarlar sayfası mesajlarını işleyecek arka plan hazır olsun
        val loader = Worker.assetLoader(this)

        web = WebView(this)
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.allowContentAccess = false

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == Worker.HOST) return false
                // Dış bağlantılar (API anahtarı sayfası vb.) telefonun tarayıcısında açılır.
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (e: Exception) {
                    /* açacak uygulama yok */
                }
                return true
            }
        }
        // options.js confirm()/alert() kullanır; WebView bunları kendiliğinden göstermez.
        web.webChromeClient = object : WebChromeClient() {
            override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
                AlertDialog.Builder(this@SettingsActivity)
                    .setMessage(message)
                    .setPositiveButton("Tamam") { _, _ -> result.confirm() }
                    .setNegativeButton("İptal") { _, _ -> result.cancel() }
                    .setOnCancelListener { result.cancel() }
                    .show()
                return true
            }

            override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
                AlertDialog.Builder(this@SettingsActivity)
                    .setMessage(message)
                    .setPositiveButton("Tamam") { _, _ -> result.confirm() }
                    .setOnCancelListener { result.confirm() }
                    .show()
                return true
            }
        }
        web.addJavascriptInterface(
            HostJs(applicationContext, false) { id, json ->
                runOnUiThread { web.evaluateJavascript("__wttReply($id, ${JSONObject.quote(json)})", null) }
            },
            "__wttHost",
        )
        setContentView(web)
        web.loadUrl(Worker.BASE + "options/options-mobile.html")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    companion object {
        fun launch(ctx: Context) {
            ctx.startActivity(Intent(ctx, SettingsActivity::class.java))
        }
    }
}
