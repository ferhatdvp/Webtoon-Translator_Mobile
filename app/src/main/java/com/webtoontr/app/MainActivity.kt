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
import org.json.JSONArray

/**
 * Mini tarayıcı. İzinli sitelerde (Ayarlar'daki liste) sayfaya çeviri paketi enjekte edilir ve
 * sayfa ↔ arka plan (Worker) iletişimi window.__wttBridge (WebMessageListener) üzerinden kurulur.
 * Listede olmayan sitelerde köprü hiç tanımlanmaz ve hiçbir çeviri kodu çalışmaz.
 */
class MainActivity : Activity() {
    private val homeUrl = Worker.BASE + "mobile/home.html"
    private lateinit var web: WebView
    private lateinit var urlBar: EditText
    private lateinit var progress: ProgressBar
    private lateinit var browserBar: LinearLayout
    private lateinit var minimizeButton: FloatingButton
    private lateinit var translationButton: FloatingButton
    private lateinit var pipStatus: TextView
    private lateinit var bundle: String

    private var appliedRules: Set<String> = emptySet()
    private var startScript: ScriptHandler? = null
    private var pageProxy: JavaScriptReplyProxy? = null
    private var useDocStart = false
    private var pageStatus: JSONObject? = null
    private var pageLoadFailed = false
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
        minimizeButton = FloatingButton(
            this, body, "minimize", "", "Küçük pencereye geç", Color.rgb(30, 97, 128), 64,
        ) {
            if (!enterSmallWindow()) {
                Toast.makeText(this, "Küçük pencere açılamadı. Telefonun küçük pencere ayarını kontrol edin.", Toast.LENGTH_LONG).show()
            }
        }.apply {
            foreground = getDrawable(R.drawable.ic_picture_in_picture)
            foregroundGravity = Gravity.CENTER
        }
        translationButton = FloatingButton(
            this, body, "translation", "TR", "Çeviriyi gizle", Color.rgb(43, 108, 255), 0,
        ) { pushToPage("TOGGLE") }.apply { visibility = View.GONE }

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
                updatePipStatus()
                updateBrowserChrome()
            }

            override fun onReceivedTitle(view: WebView, title: String) {
                if (!pageLoadFailed) view.url?.let { Store.rememberVisitedPage(it, title) }
                updatePipStatus()
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
        val assetLoader = Worker.assetLoader(this)
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: android.webkit.WebResourceRequest): android.webkit.WebResourceResponse? {
                if (request.url.host == Worker.HOST) return assetLoader.shouldInterceptRequest(request.url)
                if (Store.isAdBlockEnabled() && AdBlocker.shouldBlock(request, currentPageUrl)) return AdBlocker.emptyResponse()
                return super.shouldInterceptRequest(view, request)
            }

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                currentPageUrl = url
                pageProxy = null
                pageStatus = null
                pageLoadFailed = false
                updatePipStatus()
                updateBrowserChrome()
                updatePictureInPictureParams()
                if (!urlBar.hasFocus()) urlBar.setText(if (url == homeUrl) "" else url)
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    pageLoadFailed = true
                    updatePipStatus()
                }
                super.onReceivedError(view, request, error)
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (url != homeUrl && !pageLoadFailed && view.url == url) {
                    Store.rememberVisitedPage(url, view.title)
                }
                if (url != homeUrl && Store.isAdBlockEnabled()) AdBlocker.injectCosmetics(view, url)
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
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "__wttHome", setOf("https://${Worker.HOST}")) {
                    _, message, origin, mainFrame, reply ->
                if (mainFrame && origin.host == Worker.HOST && web.url == homeUrl) {
                    val request = try { JSONObject(message.data ?: "{}") } catch (_: Exception) { JSONObject() }
                    if (request.optString("type") == "GET_HOME_DATA") sendHomeData(request.optInt("id"), reply)
                }
            }
        }
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
        runOnUiThread {
            // Sayfa adresi: gerçek adres köken ile uyuşuyorsa onu, değilse kökeni kullan (Referer için yeterli).
            val current = web.url
            val pageUrl = if (current != null && Uri.parse(current).host == host) current else "$origin/"
            if (type == "TRANSLATE_IMAGE") msg.put("pageTitle", web.title.orEmpty().take(200))
            Worker.dispatch("page", pageUrl, msg.toString()) { json -> answer(json) }
        }
    }

    private fun sendHomeData(id: Int, reply: JavaScriptReplyProxy) {
        fun respond(data: JSONObject) {
            if (isDestroyed || web.url != homeUrl) return
            try { reply.postMessage(data.put("id", id).toString()) } catch (_: Exception) { /* sayfa kapanmış olabilir */ }
        }
        respond(JSONObject().put("lastPage", Store.lastVisitedPage() ?: JSONObject.NULL)
            .put("sites", JSONArray(Store.savedHosts())).put("cachePending", true))
        Worker.dispatch("ext", "", "{\"type\":\"GET_CACHED_PAGES\"}") { json ->
            runOnUiThread {
                val result = try { JSONObject(json) } catch (_: Exception) { JSONObject() }
                respond(JSONObject().put("cachePending", false)
                    .put("pages", result.optJSONArray("pages") ?: JSONArray())
                    .put("sourceLanguage", result.optString("sourceLanguage", "en"))
                    .put("cacheError", !result.optBoolean("ok")))
            }
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
        web.loadUrl(homeUrl)
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
        if (host != null && host != Worker.HOST && url.startsWith("http")) {
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
        if (web.url == homeUrl) web.evaluateJavascript("window.refreshHome && window.refreshHome()", null)
    }

    override fun onStop() {
        minimizeButton.finishMotion()
        translationButton.finishMotion()
        web.onPause()
        super.onStop()
    }

    private fun setAfk(enabled: Boolean) {
        if (pageStatus == null || !pushToPage("SET_AFK", ",\"enabled\":$enabled")) {
            Toast.makeText(this, "Sayfa henüz çeviriye hazır değil.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun onTranslationStatus(status: JSONObject) {
        val wasAfk = pageStatus?.optBoolean("afk") == true
        pageStatus = status
        val afk = status.optBoolean("afk")
        updatePipStatus()
        updateBrowserChrome()
        if (wasAfk != afk) updatePictureInPictureParams()
    }

    private fun updatePipStatus() {
        val status = pageStatus
        val note = status?.optString("note").orEmpty().take(120)
        val done = status?.optInt("done") ?: 0
        val total = status?.optInt("total") ?: 0
        val prefix = if (status?.optBoolean("afk") == true) "AFK · " else ""
        pipStatus.text = when {
            pageLoadFailed -> prefix + "Sayfa yüklenemedi"
            status == null && web.progress < 100 -> "Sayfa yükleniyor…"
            status == null -> web.title.orEmpty().ifBlank { "Webtoon Çevirmen" }
            status.optBoolean("paused") -> prefix + note.ifBlank { "Çeviri duraklatıldı" }
            status.optInt("active") > 0 -> prefix + "Çevriliyor… $done/$total"
            status.optInt("busy") > 0 -> prefix + "Sırada… $done/$total"
            status.optInt("failed") > 0 -> prefix + "${status.optInt("failed")} görsel çevrilemedi"
            note.isNotBlank() -> note
            total > 0 -> prefix + "$done/$total çevrildi"
            else -> prefix + "Görseller bekleniyor…"
        }
    }

    private fun updateBrowserChrome() {
        val inPip = isInPictureInPictureMode
        if (inPip) minimizeButton.finishMotion()
        if (inPip || pageStatus == null) translationButton.finishMotion()
        browserBar.visibility = if (inPip) View.GONE else View.VISIBLE
        minimizeButton.visibility = if (!inPip && supportsPip()) {
            View.VISIBLE
        } else {
            View.GONE
        }
        progress.visibility = if (!inPip && progress.progress in 1..99) View.VISIBLE else View.GONE
        pipStatus.visibility = if (inPip) View.VISIBLE else View.GONE
        translationButton.visibility = if (!inPip && pageStatus != null) View.VISIBLE else View.GONE
        val translationVisible = pageStatus?.optBoolean("visible", true) ?: true
        translationButton.isSelected = !translationVisible
        translationButton.contentDescription = if (translationVisible) "Çeviriyi gizle" else "Çeviriyi göster"
    }

    /** Android 8–11'de ana ekrana geçiş PiP'e elle yönlendirilir. */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && canAutoEnterPip()) enterSmallWindow()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (isInPictureInPictureMode) web.onResume()
        updatePipStatus()
        updateBrowserChrome()
        updatePictureInPictureParams()
    }

    private fun supportsPip() = packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private fun canAutoEnterPip() =
        !openingSettings && !isInPictureInPictureMode && pageStatus?.optBoolean("afk") == true

    private fun enterSmallWindow(): Boolean {
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
