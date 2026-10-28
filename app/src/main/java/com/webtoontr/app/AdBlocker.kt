package com.webtoontr.app

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import java.io.ByteArrayInputStream

/**
 * Crash-safe, domain-based ad blocking for Android WebView.
 *
 * The native filter engine is intentionally not initialized or called until its
 * Android WebView runtime issue is diagnosed. This keeps navigation and search
 * usable while the known ad-provider block rules remain active.
 */
object AdBlocker {
    private val blockedDomains = setOf(
        "adform.net", "adnxs.com", "adsrvr.org", "advertising.com", "criteo.com", "criteo.net",
        "doubleclick.net", "googleadservices.com", "googlesyndication.com", "googletagservices.com",
        "media.net", "openx.net", "pubmatic.com", "rubiconproject.com", "sharethrough.com",
        "taboola.com", "outbrain.com", "zedo.com",
        "popads.net", "popcash.net", "exoclick.com", "propellerads.com", "trafficjunky.net",
        "adsterra.com", "clickadu.com", "hilltopads.net", "onclicka.com", "adf.ly", "shorte.st",
    )

    fun initialize(context: Context) {
        // Kept as an application startup hook; intentionally does not load native code.
    }

    /** Blocks known ad destinations and unsolicited cross-site top-level redirects. */
    fun shouldBlockNavigation(targetUrl: String, currentPageUrl: String?, hasUserGesture: Boolean): Boolean {
        val target = Uri.parse(targetUrl)
        if (target.scheme != "http" && target.scheme != "https") return false
        val host = target.host?.lowercase() ?: return false
        if (blockedDomains.any { host == it || host.endsWith(".$it") }) return true
        if (hasUserGesture) return false

        val sourceHost = try { Uri.parse(currentPageUrl.orEmpty()).host?.lowercase() } catch (_: Exception) { null }
            ?: return false
        if (host == sourceHost || host.endsWith(".$sourceHost") || sourceHost.endsWith(".$host")) return false
        // Google may redirect between regional search domains without a fresh gesture.
        if (host.startsWith("www.google.") || host.startsWith("google.")) {
            if (sourceHost.startsWith("www.google.") || sourceHost.startsWith("google.")) return false
        }
        return true
    }

    fun shouldBlock(request: WebResourceRequest, currentPageUrl: String?): Boolean {
        if (request.isForMainFrame) return false
        val uri = request.url
        if (uri.scheme != "http" && uri.scheme != "https") return false
        val host = uri.host?.lowercase() ?: return false
        val sourceUrl = request.requestHeaders.entries
            .firstOrNull { it.key.equals("referer", ignoreCase = true) }?.value
            ?: currentPageUrl.orEmpty()
        val sourceHost = Uri.parse(sourceUrl).host?.lowercase() ?: return false
        if (host == sourceHost) return false
        return blockedDomains.any { host == it || host.endsWith(".$it") }
    }

    fun injectCosmetics(view: WebView, pageUrl: String) {
        // Cosmetic rules are part of the disabled native engine; no page script injection here.
    }

    fun emptyResponse() = WebResourceResponse(
        "text/plain", "utf-8", 204, "No Content", emptyMap(), ByteArrayInputStream(byteArrayOf()),
    )
}
