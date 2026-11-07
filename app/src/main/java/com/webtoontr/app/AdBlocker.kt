package com.webtoontr.app

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.read
import kotlin.concurrent.write

/** Brave's adblock-rust engine, backed by EasyList, EasyPrivacy and AdGuard Turkish rules. */
object AdBlocker {
    private val updateExecutor = Executors.newSingleThreadExecutor()
    private val filterDownloadExecutor = Executors.newFixedThreadPool(4)
    private val cosmeticExecutor = Executors.newSingleThreadExecutor()
    private val engineLock = ReentrantReadWriteLock()
    @Volatile private var engine: AdBlockEngineBridge? = null
    @Volatile private var initialized = false

    private val fallbackDomains = setOf(
        "adform.net", "adnxs.com", "adsrvr.org", "advertising.com", "criteo.com", "criteo.net",
        "doubleclick.net", "googleadservices.com", "googlesyndication.com", "googletagservices.com",
        "media.net", "openx.net", "pubmatic.com", "rubiconproject.com", "sharethrough.com",
        "taboola.com", "outbrain.com", "zedo.com", "amazon-adsystem.com", "adcolony.com",
        "app-measurement.com", "branch.io", "chartbeat.com", "scorecardresearch.com",
        "hotjar.com", "clarity.ms", "facebook.net", "googletagmanager.com",
    )

    private val filterUrls = listOf(
        "https://easylist.to/easylist/easylist.txt",
        "https://easylist.to/easylist/easyprivacy.txt",
        "https://filters.adtidy.org/extension/chromium/filters/2.txt",
        "https://filters.adtidy.org/extension/chromium/filters/3.txt",
        "https://filters.adtidy.org/extension/chromium/filters/13.txt",
        "https://filters.adtidy.org/extension/chromium/filters/14.txt",
    )
    private const val RESOURCE_URL = "https://raw.githubusercontent.com/brave/adblock-resources/master/dist/resources.json"

    fun initialize(context: Context) {
        if (initialized) return
        synchronized(this) {
            if (initialized) return
            initialized = true
        }
        val app = context.applicationContext
        updateExecutor.execute { loadCachedEngine(app) }
    }

    private fun loadCachedEngine(context: Context) {
        val rulesFile = File(context.filesDir, "adblock-filters.txt")
        val binaryFile = File(context.filesDir, "adblock-engine.bin")
        val resourcesFile = File(context.filesDir, "adblock-resources.json")
        fun readResources(): String = try {
            context.assets.open("adblock/resources.json").bufferedReader().use { it.readText() }
        } catch (_: Exception) {
            try { resourcesFile.takeIf { it.exists() }?.readText() ?: "{}" } catch (_: Exception) { "{}" }
        }
        var resources = readResources()

        var active = false
        if (binaryFile.exists()) {
            val cached = try {
                AdBlockEngineBridge().also {
                    if (!it.deserializeFrom(binaryFile)) throw IllegalStateException("Cached filter engine is invalid")
                    if (!it.loadResources(resources)) throw IllegalStateException("Ad filter resources could not load")
                }
            } catch (_: Exception) {
                null
            }
            if (cached != null) {
                engineLock.write {
                    engine?.close()
                    engine = cached
                }
                active = true
            }
        }

        val fresh = active && filterUrls.indices.all { index ->
            val sourceCache = File(context.filesDir, "adblock-filter-$index.txt")
            sourceCache.exists() && System.currentTimeMillis() - sourceCache.lastModified() < UPDATE_INTERVAL_MS
        } && resourcesFile.exists() && System.currentTimeMillis() - resourcesFile.lastModified() < RESOURCE_UPDATE_INTERVAL_MS
        if (fresh) return

        updateExecutor.execute {
            // Her kaynağı ayrı sakla: tek bir sitenin kesintisi diğer filtreleri silmesin.
            val downloads = filterUrls.mapIndexed { index, address ->
                filterDownloadExecutor.submit<String?> {
                    val sourceCache = File(context.filesDir, "adblock-filter-$index.txt")
                    val downloaded = try { downloadFilter(address) } catch (_: Exception) { null }
                    if (downloaded != null) {
                        try { sourceCache.writeText(downloaded) } catch (_: Exception) { /* bellek içi kural kullanılabilir */ }
                    }
                    (downloaded ?: sourceCache.takeIf { it.exists() }?.let {
                        try { it.readText() } catch (_: Exception) { null }
                    })?.takeIf { it.isNotBlank() }
                }
            }
            val rulesBySource = downloads.mapNotNull { try { it.get() } catch (_: Exception) { null } }
            if (!resourcesFile.exists() || System.currentTimeMillis() - resourcesFile.lastModified() >= RESOURCE_UPDATE_INTERVAL_MS) {
                val downloadedResources = try { downloadResources() } catch (_: Exception) { null }
                if (downloadedResources != null) {
                    try { resourcesFile.writeText(downloadedResources) } catch (_: Exception) { /* keep using in-memory resources */ }
                    resources = downloadedResources
                } else {
                    resources = readResources()
                }
            }
            // Eski sürümün birleştirilmiş önbelleğini, yeni kaynak önbellekleri oluşana dek koru.
            val rules = rulesBySource.takeIf { it.isNotEmpty() }?.joinToString("\n") ?: rulesFile.takeIf { it.exists() }?.let {
                try { it.readText() } catch (_: Exception) { null }
            }
            if (rules.isNullOrBlank()) return@execute

            val replacement = try {
                AdBlockEngineBridge().also {
                    if (!it.loadFilterList(rules)) throw IllegalStateException("Filtre listeleri yüklenemedi")
                    it.loadResources(resources)
                }
            } catch (_: Exception) {
                return@execute
            }

            try {
                rulesFile.writeText(rules)
                replacement.serializeTo(binaryFile)
            } catch (_: Exception) {
                // The in-memory engine still works; it can be rebuilt next launch.
            }
            engineLock.write {
                engine?.close()
                engine = replacement
            }
        }
    }

    private fun downloadFilter(address: String): String {
        val text = downloadText(address)
        require(text.length > 500 && !text.trimStart().startsWith("<")) { "Filtre listesi geçersiz: $address" }
        return text
    }

    private fun downloadResources(): String {
        val text = downloadText(RESOURCE_URL)
        require(text.length > 1_000 && text.trimStart().startsWith("[")) { "Ad filtre kaynakları geçersiz" }
        return text
    }

    private fun downloadText(address: String): String {
        val connection = (URL(address).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 20_000
            setRequestProperty("User-Agent", "WebtoonCevirmen/0.1 (Android; adblock filter update)")
        }
        return try {
            connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                reader.readText()
            }
        } finally {
            connection.disconnect()
        }
    }

    fun shouldBlock(request: WebResourceRequest, currentPageUrl: String?): Boolean {
        if (request.isForMainFrame) return false
        val url = request.url.toString()
        if (request.url.scheme !in setOf("http", "https")) return false
        val sourceUrl = request.requestHeaders.entries
            .firstOrNull { it.key.equals("referer", ignoreCase = true) }?.value
            ?: currentPageUrl.orEmpty()
        val host = request.url.host?.lowercase() ?: return false
        val sourceHost = try { Uri.parse(sourceUrl).host?.lowercase() } catch (_: Exception) { null }
        if (sourceHost != null && fallbackDomains.any { hostMatches(host, it) } && host != sourceHost) return true

        return engineLock.read {
            try {
                engine?.shouldBlock(url, sourceUrl, request.requestHeaders.entries
                    .firstOrNull { it.key.equals("accept", ignoreCase = true) }?.value)
                    ?: false
            } catch (_: Exception) {
                false
            }
        }
    }

    private fun hostMatches(host: String, domain: String) = host == domain || host.endsWith(".$domain")

    fun injectCosmetics(view: WebView, pageUrl: String) {
        cosmeticExecutor.execute {
            // İlk uygulama açılışında motor filtreleri ağdan indiriyor olabilir.
            for (attempt in 0 until 12) {
                if (engine != null) break
                Thread.sleep(500)
            }
            val readyPayload = engineLock.read {
                try { engine?.cosmetics(pageUrl) } catch (_: Exception) { null }
            } ?: return@execute
            val data = try { JSONObject(readyPayload) } catch (_: Exception) { return@execute }
            val css = JSONObject.quote(data.optString("css"))
            val js = JSONObject.quote(data.optString("js"))
            val script = """(function(){
                var css=$css, extra=$js;
                function apply(){
                  if(!document.documentElement){document.addEventListener('DOMContentLoaded',apply,{once:true});return;}
                  if(css){var s=document.createElement('style');s.textContent=css;(document.head||document.documentElement).appendChild(s);}
                  if(extra){try{(0,eval)(extra);}catch(e){console.warn('Ad filter scriptlet failed',e);}}
                }
                apply();
              })();""".trimIndent()
            view.post { if (view.url == pageUrl) view.evaluateJavascript(script, null) }
        }
    }

    fun emptyResponse() = WebResourceResponse(
        "text/plain", "utf-8", 204, "No Content", emptyMap(), ByteArrayInputStream(byteArrayOf()),
    )

    private const val UPDATE_INTERVAL_MS = 7L * 24 * 60 * 60 * 1000
    private const val RESOURCE_UPDATE_INTERVAL_MS = 30L * 24 * 60 * 60 * 1000
}
