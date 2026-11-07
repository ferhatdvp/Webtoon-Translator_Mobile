package com.webtoontr.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.TextUtils
import android.util.Rational
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.TextView
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
    private lateinit var browserBar: LinearLayout
    private lateinit var pipStatus: TextView
    private lateinit var bundle: String

    private var appliedRules: Set<String> = emptySet()
    private var startScript: ScriptHandler? = null
    private var pageProxy: JavaScriptReplyProxy? = null
    private var useDocStart = false
    private var pageStatus: JSONObject? = null
    private var pageLoadFailed = false
    private var enterPipAfterAfkStarts = false
    private var openingSettings = false
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
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(15, 23, 42))
        }

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#1e293b"))
            setPadding(dp(6), dp(4), dp(6), dp(4))
        }
        browserBar = bar
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
        web = WebView(this).apply { setBackgroundColor(Color.rgb(15, 23, 42)) }
        body.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // Arka plan (çeviri hattı) WebView'ı: 1x1 piksel, görünmez ama "görünür" sayılır (zamanlayıcılar kısılmasın).
        val worker = Worker.ensure(this)
        (worker.parent as? ViewGroup)?.removeView(worker)
        worker.alpha = 0.01f
        body.addView(worker, FrameLayout.LayoutParams(1, 1))
        pipStatus = TextView(this).apply {
            visibility = View.GONE
            setBackgroundColor(Color.rgb(15, 23, 42))
            setTextColor(Color.WHITE)
            setPadding(dp(8), dp(5), dp(8), dp(5))
            gravity = Gravity.CENTER
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
            textSize = 12f
        }
        body.addView(pipStatus, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM,
        ))

        root.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)))
        root.addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        updatePictureInPictureParams()

        // ---------------- WebView ayarları ----------------
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        // Bağlantıların target="_blank" isteklerini WebChromeClient'a yönlendir.
        s.setSupportMultipleWindows(true)
        s.javaScriptCanOpenWindowsAutomatically = !Store.isAdBlockEnabled()
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.progress = newProgress
                updateBrowserChrome()
            }

            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message): Boolean {
                if (Store.isAdBlockEnabled() && !isUserGesture) return false
                // Ayrı sekme açmak yerine hedef URL'yi mevcut tarayıcıda aç.
                val popup = WebView(this@MainActivity)
                popup.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: android.webkit.WebResourceRequest): Boolean {
                        val target = request.url.toString()
                        if (target.startsWith("http://") || target.startsWith("https://")) web.loadUrl(target)
                        view.destroy()
                        return true
                    }

                    @Suppress("DEPRECATION")
                    override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                        if (url.startsWith("http://") || url.startsWith("https://")) web.loadUrl(url)
                        view.destroy()
                        return true
                    }
                }
                val transport = resultMsg.obj as WebView.WebViewTransport
                transport.webView = popup
                resultMsg.sendToTarget()
                return true
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
                pageStatus = null
                pageLoadFailed = false
                enterPipAfterAfkStarts = false
                updatePipStatus()
                updatePictureInPictureParams()
                if (!urlBar.hasFocus() && url.startsWith("http")) urlBar.setText(url)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    pageLoadFailed = true
                    updatePipStatus()
                }
                super.onReceivedError(view, request, error)
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
        val host = sourceOrigin.host
        if (!isMainFrame || host == null || !Store.isAllowedHost(host)) return
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
        o.optJSONObject("status")?.let { status ->
            if (replyProxy == pageProxy) onTranslationStatus(status)
            return
        }
        val id = o.optInt("id", -1)
        val msg = o.optJSONObject("msg")
        val type = msg?.optString("type") ?: ""
        fun answer(json: String) {
            runOnUiThread {
                try {
                    replyProxy.postMessage("{\"id\":$id,\"res\":$json}")
                } catch (e: Exception) {
                    /* sayfa kapanmış olabilir */
                }
            }
        }
        if (msg == null || id < 0 || type !in allowedTypes) {
            answer("{\"ok\":false,\"error\":{\"code\":\"NOT_ALLOWED\",\"message\":\"İzin verilmeyen istek.\",\"fatal\":true}}")
            return
        }
        if (type == "OPEN_OPTIONS") {
            runOnUiThread { openSettings() }
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

    private fun pushToPage(type: String, extra: String = ""): Boolean {
        val proxy = pageProxy ?: return false
        return try {
            proxy.postMessage("{\"push\":{\"type\":\"$type\"$extra}}")
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun openSettings() {
        openingSettings = true
        updatePictureInPictureParams()
        SettingsActivity.launch(this)
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
        val afk = pageStatus?.optBoolean("afk") == true
        if (isAllowedUrl(url)) {
            pm.menu.add(0, 7, 6, if (afk) "AFK modunu durdur" else "AFK modunu başlat")
            if (pageStatus?.optBoolean("hasAfkStart") == true) {
                pm.menu.add(0, 8, 7, "AFK başlangıç bölümüne dön")
            }
        }
        pm.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> pushToPage("TOGGLE")
                2 -> if (host != null) toggleSite(host, saved)
                3 -> pushToPage("RESCAN", ",\"force\":true")
                4 -> web.reload()
                5 -> showStartPage()
                6 -> openSettings()
                7 -> setAfk(!afk)
                8 -> pushToPage("RETURN_AFK_START")
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
        openingSettings = false
        web.settings.javaScriptCanOpenWindowsAutomatically = !Store.isAdBlockEnabled()
        updatePictureInPictureParams()
        // Ayarlar'da site listesi / anahtar değişmiş olabilir.
        if (applyOriginRules()) web.reload() else pushToPage("CONFIG_CHANGED")
    }

    override fun onStop() {
        web.onPause()
        super.onStop()
    }

    private fun setAfk(enabled: Boolean) {
        enterPipAfterAfkStarts = enabled
        if (pageStatus == null || !pushToPage("SET_AFK", ",\"enabled\":$enabled")) {
            enterPipAfterAfkStarts = false
            Toast.makeText(this, "Sayfa henüz çeviriye hazır değil.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun onTranslationStatus(status: JSONObject) {
        val wasAfk = pageStatus?.optBoolean("afk") == true
        pageStatus = status
        val afk = status.optBoolean("afk")
        updatePipStatus()
        if (wasAfk != afk) updatePictureInPictureParams()
        if (enterPipAfterAfkStarts && afk) {
            enterPipAfterAfkStarts = false
            if (!enterAfkPictureInPicture()) {
                Toast.makeText(this, "Küçük pencere açılamadı. AFK bu ekranda çalışıyor.", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun updatePipStatus() {
        val status = pageStatus
        val note = status?.optString("note").orEmpty().take(120)
        val done = status?.optInt("done") ?: 0
        val total = status?.optInt("total") ?: 0
        pipStatus.text = when {
            pageLoadFailed -> "AFK · Bölüm yüklenemedi"
            status == null -> "AFK · Bölüm yükleniyor…"
            status.optBoolean("paused") -> note.ifBlank { "AFK · Çeviri duraklatıldı" }
            !status.optBoolean("afk") -> note.ifBlank { "AFK durdu" }
            status.optInt("active") > 0 -> "AFK · Çevriliyor… $done/$total"
            status.optInt("busy") > 0 -> "AFK · Sırada… $done/$total"
            status.optInt("failed") > 0 -> "AFK · ${status.optInt("failed")} görsel çevrilemedi"
            total > 0 -> "AFK · $done/$total çevrildi"
            else -> "AFK · Görseller bekleniyor…"
        }
    }

    private fun updateBrowserChrome() {
        val inPip = isInPictureInPictureMode
        browserBar.visibility = if (inPip) View.GONE else View.VISIBLE
        progress.visibility = if (!inPip && progress.progress in 1..99) View.VISIBLE else View.GONE
        pipStatus.visibility = if (inPip) View.VISIBLE else View.GONE
    }

    /** Android 8–11'de ana ekrana geçiş PiP'e elle yönlendirilir. */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && canAutoEnterPip()) enterAfkPictureInPicture()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (isInPictureInPictureMode) web.onResume()
        updatePipStatus()
        updateBrowserChrome()
    }

    private fun supportsPip() = packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private fun canAutoEnterPip() =
        !openingSettings && !isInPictureInPictureMode && pageStatus?.optBoolean("afk") == true

    private fun enterAfkPictureInPicture(): Boolean {
        if (!supportsPip() || isFinishing || isInPictureInPictureMode) return false
        return try {
            enterPictureInPictureMode(buildPictureInPictureParams())
        } catch (_: IllegalStateException) {
            false
        }
    }

    private fun buildPictureInPictureParams(): PictureInPictureParams {
        val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(9, 16))
        val sourceRect = Rect()
        if (web.getGlobalVisibleRect(sourceRect)) builder.setSourceRectHint(sourceRect)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(canAutoEnterPip())
            builder.setSeamlessResizeEnabled(false)
        }
        return builder.build()
    }

    private fun updatePictureInPictureParams() {
        if (supportsPip()) setPictureInPictureParams(buildPictureInPictureParams())
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
