package com.webtoontr.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.Toast
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * Mini tarayıcı. İzinli sitelerde (Ayarlar'daki liste) sayfaya çeviri paketi enjekte edilir ve
 * sayfa ↔ arka plan (Worker) iletişimi window.__wttBridge (WebMessageListener) üzerinden kurulur.
 * Listede olmayan sitelerde köprü hiç tanımlanmaz ve hiçbir çeviri kodu çalışmaz.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var urlBar: EditText
    private lateinit var progress: ProgressBar
    private lateinit var bundle: String

    private var appliedRules: Set<String> = emptySet()
    private var startScript: ScriptHandler? = null
    private var pageProxy: JavaScriptReplyProxy? = null
    private var useDocStart = false
    @Volatile private var currentPageUrl: String? = null

    private val allowedTypes = setOf("GET_PAGE_CONFIG", "TRANSLATE_IMAGE", "OPEN_OPTIONS")

    private val listener =
        WebViewCompat.WebMessageListener { _, message, sourceOrigin, isMainFrame, replyProxy ->
            onPageMessage(message, sourceOrigin, isMainFrame, replyProxy)
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Store.init(this)
        bundle = assets.open("web/mobile/page-bundle.js").bufferedReader().use { it.readText() }

        // ---------------- arayüz (kod ile; XML yok) ----------------
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#1e293b"))
            setPadding(dp(6), dp(4), dp(6), dp(4))
        }
        val back = barButton("◀") { if (web.canGoBack()) web.goBack() }
        urlBar = EditText(this).apply {
            setSingleLine(true)
            hint = "Adres ya da arama"
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#94a3b8"))
            textSize = 14f
            imeOptions = EditorInfo.IME_ACTION_GO
            setOnEditorActionListener { _, actionId, event ->
                if (actionId == EditorInfo.IME_ACTION_GO || (event != null && event.keyCode == KeyEvent.KEYCODE_ENTER)) {
                    go(text.toString())
                    true
                } else {
                    false
                }
            }
        }
        val menu = barButton("⋮") { showMenu(it) }
        bar.addView(back)
        bar.addView(urlBar, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(menu)

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = android.view.View.GONE
        }

        val body = FrameLayout(this)
        web = WebView(this)
        body.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // Arka plan (çeviri hattı) WebView'ı: 1x1 piksel, görünmez ama "görünür" sayılır (zamanlayıcılar kısılmasın).
        val worker = Worker.ensure(this)
        (worker.parent as? ViewGroup)?.removeView(worker)
        worker.alpha = 0.01f
        body.addView(worker, FrameLayout.LayoutParams(1, 1))

        root.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)))
        root.addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        // ---------------- WebView ayarları ----------------
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        s.setSupportMultipleWindows(false)
        s.javaScriptCanOpenWindowsAutomatically = false
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.progress = newProgress
                progress.visibility = if (newProgress in 1..99) android.view.View.VISIBLE else android.view.View.GONE
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: android.webkit.WebResourceRequest): android.webkit.WebResourceResponse? {
                if (Store.isAdBlockEnabled() && AdBlocker.shouldBlock(request, currentPageUrl)) return AdBlocker.emptyResponse()
                return super.shouldInterceptRequest(view, request)
            }

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                currentPageUrl = url
                pageProxy = null
                if (!urlBar.hasFocus() && url.startsWith("http")) urlBar.setText(url)
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (Store.isAdBlockEnabled()) AdBlocker.injectCosmetics(view, url)
                // document-start betiği desteklenmiyorsa yedek: sayfa bitince enjekte et.
                if (!useDocStart && isAllowedUrl(url)) view.evaluateJavascript(bundle, null)
            }
        }

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            AlertDialog.Builder(this)
                .setTitle("WebView güncel değil")
                .setMessage("Çeviri için Android System WebView (veya Chrome) güncellenmeli. Play Store'dan güncelleyip uygulamayı yeniden açın.")
                .setPositiveButton("Tamam", null)
                .show()
        }
        useDocStart = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        applyOriginRules()

        showStartPage()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun barButton(label: String, onClick: (android.view.View) -> Unit): Button =
        Button(this).apply {
            text = label
            isAllCaps = false
            typeface = Typeface.DEFAULT_BOLD
            minWidth = dp(44)
            minimumWidth = dp(44)
            setOnClickListener { onClick(it) }
        }

    // ---------------------------------------------------------------- site listesi → köprü kuralları

    private fun isIp(h: String) = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$").matches(h) || h == "localhost"

    private fun isAllowedUrl(url: String): Boolean {
        val host = try {
            Uri.parse(url).host
        } catch (e: Exception) {
            null
        } ?: return false
        return Store.isAllowedHost(host)
    }

    /** Köprü ve (varsa) document-start betiği yalnızca izinli sitelerin kökenlerinde tanımlanır. @return kurallar değişti mi */
    private fun applyOriginRules(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        val rules = LinkedHashSet<String>()
        for (h in Store.enabledHosts()) {
            rules.add("https://$h")
            rules.add("http://$h")
            if (!isIp(h)) {
                rules.add("https://*.$h")
                rules.add("http://*.$h")
            }
        }
        if (rules.isEmpty()) rules.add("https://wtt-no-sites.invalid")
        if (rules == appliedRules) return false
        try {
            if (appliedRules.isNotEmpty()) WebViewCompat.removeWebMessageListener(web, "__wttBridge")
            startScript?.remove()
            startScript = null
            WebViewCompat.addWebMessageListener(web, "__wttBridge", rules, listener)
            if (useDocStart) {
                val script =
                    "(function(){var __run=function(){$bundle\n};" +
                        "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',__run,{once:true});}" +
                        "else{__run();}})();"
                startScript = WebViewCompat.addDocumentStartJavaScript(web, script, rules)
            }
            appliedRules = rules
        } catch (e: Exception) {
            Toast.makeText(this, "Site kuralları uygulanamadı: ${e.message}", Toast.LENGTH_LONG).show()
        }
        return true
    }

    // ---------------------------------------------------------------- sayfa → arka plan

    private fun onPageMessage(
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        if (!isMainFrame) return
        val data = message.data ?: return
        val o = try {
            JSONObject(data)
        } catch (e: Exception) {
            return
        }
        if (o.optBoolean("hello")) {
            pageProxy = replyProxy
            return
        }
        val id = o.optInt("id", -1)
        val msg = o.optJSONObject("msg")
        val type = msg?.optString("type") ?: ""
        val host = sourceOrigin.host
        fun answer(json: String) {
            runOnUiThread {
                try {
                    replyProxy.postMessage("{\"id\":$id,\"res\":$json}")
                } catch (e: Exception) {
                    /* sayfa kapanmış olabilir */
                }
            }
        }
        if (msg == null || id < 0 || type !in allowedTypes || host == null || !Store.isAllowedHost(host)) {
            answer("{\"ok\":false,\"error\":{\"code\":\"NOT_ALLOWED\",\"message\":\"İzin verilmeyen istek.\",\"fatal\":true}}")
            return
        }
        if (type == "OPEN_OPTIONS") {
            runOnUiThread { SettingsActivity.launch(this) }
            answer("{\"ok\":true}")
            return
        }
        val origin = sourceOrigin.toString()
        val msgJson = msg.toString()
        runOnUiThread {
            // Sayfa adresi: gerçek adres köken ile uyuşuyorsa onu, değilse kökeni kullan (Referer için yeterli).
            val current = web.url
            val pageUrl = if (current != null && Uri.parse(current).host == host) current else "$origin/"
            Worker.dispatch("page", pageUrl, msgJson) { json -> answer(json) }
        }
    }

    private fun pushToPage(type: String, extra: String = "") {
        val proxy = pageProxy ?: return
        try {
            proxy.postMessage("{\"push\":{\"type\":\"$type\"$extra}}")
        } catch (e: Exception) {
            /* yok say */
        }
    }

    // ---------------------------------------------------------------- gezinme / menü

    private fun go(input: String) {
        val t = input.trim()
        if (t.isEmpty()) return
        val url = when {
            Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://").containsMatchIn(t) -> t
            !t.contains(' ') && t.contains('.') -> "https://$t"
            else -> "https://www.google.com/search?q=" + Uri.encode(t)
        }
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(urlBar.windowToken, 0)
        urlBar.clearFocus()
        web.loadUrl(url)
    }

    private fun showStartPage() {
        val sites = Store.savedHosts()
        val list = if (sites.isEmpty()) {
            "<p>Henüz site eklemedin. Bir webtoon sitesini açıp <b>⋮ → Bu siteyi çeviri listesine ekle</b> de.</p>"
        } else {
            "<ul>" + sites.joinToString("") { "<li><a href=\"https://$it\">$it</a></li>" } + "</ul>"
        }
        val html = """
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;padding:20px;line-height:1.5}
            a{color:#7cb0ff;font-size:18px}h1{font-size:20px}li{margin:10px 0}code{background:#1e293b;padding:2px 6px;border-radius:4px}</style></head>
            <body><h1>Webtoon Çevirmen</h1>
            <p><b>1)</b> ⋮ → <b>Ayarlar</b>: Gemini API anahtarını gir, ücretsiz katman onayını işaretle, bağlantıyı test et.</p>
            <p><b>2)</b> Yukarıdaki adres çubuğuna webtoon sitesini yaz, aç, ⋮ → <b>Bu siteyi çeviri listesine ekle</b>.</p>
            <p><b>Çevirilen siteler</b></p>$list
            <p style="opacity:.7;font-size:13px">Bir yazının üstüne dokununca İngilizce orijinali birkaç saniye görünür.</p>
            </body></html>
        """.trimIndent()
        web.loadDataWithBaseURL("https://start.local/", html, "text/html", "utf-8", null)
    }

    private fun showMenu(anchor: android.view.View) {
        val url = web.url ?: ""
        val host = try {
            Uri.parse(url).host
        } catch (e: Exception) {
            null
        }
        val saved = host?.let { Store.findSavedHost(it) }
        val pm = PopupMenu(this, anchor)
        pm.menu.add(0, 1, 0, "Çeviriyi aç / kapat")
        if (host != null && url.startsWith("http")) {
            pm.menu.add(0, 2, 1, if (saved != null) "Bu siteyi listeden çıkar ($saved)" else "Bu siteyi çeviri listesine ekle")
        }
        pm.menu.add(0, 3, 2, "Sayfayı yeniden çevir (kota harcar)")
        pm.menu.add(0, 4, 3, "Yenile")
        pm.menu.add(0, 5, 4, "Başlangıç sayfası")
        pm.menu.add(0, 6, 5, "Ayarlar")
        pm.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> pushToPage("TOGGLE")
                2 -> if (host != null) toggleSite(host, saved)
                3 -> pushToPage("RESCAN", ",\"force\":true")
                4 -> web.reload()
                5 -> showStartPage()
                6 -> SettingsActivity.launch(this)
            }
            true
        }
        pm.show()
    }

    private fun toggleSite(host: String, saved: String?) {
        if (saved != null) {
            Store.removeSite(saved)
            Toast.makeText(this, "$saved listeden çıkarıldı", Toast.LENGTH_SHORT).show()
        } else {
            val h = Store.normalizeHost(host) ?: host
            Store.addSite(h)
            Toast.makeText(this, "$h eklendi; sayfa yenileniyor", Toast.LENGTH_SHORT).show()
        }
        applyOriginRules()
        web.reload()
    }

    // ---------------------------------------------------------------- yaşam döngüsü

    override fun onResume() {
        super.onResume()
        web.onResume()
        // Ayarlar'da site listesi / anahtar değişmiş olabilir.
        if (applyOriginRules()) web.reload() else pushToPage("CONFIG_CHANGED")
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        // Arka plan WebView'ı süreç boyunca yaşar; yalnızca bu ekrandan ayrılır.
        val worker = Worker.ensure(this)
        (worker.parent as? ViewGroup)?.removeView(worker)
        web.destroy()
        super.onDestroy()
    }
}
