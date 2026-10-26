package com.webtoontr.app

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream

/** A small offline blocklist for common third-party ad delivery hosts. */
object AdBlocker {
    private val blockedDomains = setOf(
        "adform.net",
        "adnxs.com",
        "adsrvr.org",
        "advertising.com",
        "criteo.com",
        "criteo.net",
        "doubleclick.net",
        "googleadservices.com",
        "googlesyndication.com",
        "googletagservices.com",
        "media.net",
        "openx.net",
        "pubmatic.com",
        "rubiconproject.com",
        "sharethrough.com",
        "taboola.com",
        "outbrain.com",
        "zedo.com",
    )

    fun shouldBlock(request: WebResourceRequest): Boolean {
        if (request.isForMainFrame) return false
        val host = request.url.host?.lowercase() ?: return false
        return blockedDomains.any { host == it || host.endsWith(".$it") }
    }

    fun emptyResponse() = WebResourceResponse(
        "text/plain",
        "utf-8",
        204,
        "No Content",
        emptyMap(),
        ByteArrayInputStream(byteArrayOf()),
    )
}
