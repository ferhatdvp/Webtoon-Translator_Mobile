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

    /** Blocks known ad destinations without suppressing legitimate cross-site redirects. */
    fun shouldBlockNavigation(targetUrl: String, currentPageUrl: String?, hasUserGesture: Boolean): Boolean {
        val target = Uri.parse(targetUrl)
        if (target.scheme != "http" && target.scheme != "https") return false
        val host = target.host?.lowercase() ?: return false
        if (blockedDomains.any { host == it || host.endsWith(".$it") }) return true
        // Search engines may redirect through a tracking URL after a tap. WebView drops
        // the original gesture on that redirect, so cross-site heuristics suppress real links.
        return false
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
        // Conservative fallback for sticky/floating banners injected by the site itself.
        val script = """(function(){
          if(window.__wttCosmeticFallback) return;
          window.__wttCosmeticFallback=true;
          var adWords=/\\b(ad|ads|advert|advertisement|banner|sponsor|promotion|promo)\\b/i;
          function scan(){
            if(!document.body) return;
            var vw=window.innerWidth, vh=window.innerHeight;
            document.querySelectorAll('body *').forEach(function(el){
              if(el.hasAttribute('data-wtt-ad-hidden')) return;
              var s=getComputedStyle(el), r=el.getBoundingClientRect();
              if((s.position!=='fixed' && s.position!=='sticky') || r.width<vw*.68 || r.height<55 || r.height>360) return;
              if(r.bottom<vh-45 || r.top>vh-45) return;
              var meta=[el.id,el.className,el.getAttribute('aria-label'),el.getAttribute('title')].join(' ');
              var media=el.querySelector('iframe, img, video');
              var close=el.querySelector('button,[role=button],[aria-label*=close i],[title*=close i]');
              var adFrame=el.querySelector('iframe[src*="ad"],iframe[src*="banner"],iframe[src*="promo"]');
              if(adWords.test(meta) || adFrame || (media && close && r.width>vw*.82)){
                el.setAttribute('data-wtt-ad-hidden','1');
                el.style.setProperty('display','none','important');
              }
            });
          }
          scan();
          var queued=false, obs=new MutationObserver(function(){
            if(queued) return; queued=true;
            requestAnimationFrame(function(){queued=false;scan();});
          });
          obs.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
          setInterval(scan,1800);
        })();""".trimIndent()
        view.post { if (view.url == pageUrl) view.evaluateJavascript(script, null) }
    }

    fun emptyResponse() = WebResourceResponse(
        "text/plain", "utf-8", 204, "No Content", emptyMap(), ByteArrayInputStream(byteArrayOf()),
    )
}
