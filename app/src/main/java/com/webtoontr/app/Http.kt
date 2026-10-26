package com.webtoontr.app

import android.webkit.CookieManager
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Tüm ağ trafiği (görsel indirme, Gemini, Ollama) buradan geçer. WebView'ın CORS / Origin / karışık içerik
 * kısıtlamalarına takılmaz ve görsel indirirken sayfanın Referer'ı + çerezleri gönderilir.
 */
object Http {
    private val pool = Executors.newCachedThreadPool()
    private val active = ConcurrentHashMap<Int, HttpURLConnection>()
    private val cancelled: MutableSet<Int> = ConcurrentHashMap.newKeySet()

    @Volatile
    var userAgent: String =
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

    private fun open(
        urlStr: String,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
        timeoutMs: Int,
        id: Int?,
    ): HttpURLConnection {
        var current = urlStr
        var m = method
        var payload = body
        for (hop in 0..5) {
            val conn = URL(current).openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 20000
            conn.readTimeout = timeoutMs
            conn.requestMethod = m
            for ((k, v) in headers) conn.setRequestProperty(k, v)
            if (id != null) active[id] = conn
            val toSend = payload
            if (toSend != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(toSend) }
            }
            val code = conn.responseCode
            if (code in 301..308 && code != 304) {
                val loc = conn.getHeaderField("Location") ?: return conn
                conn.disconnect()
                current = URL(URL(current), loc).toString()
                if (code == 301 || code == 302 || code == 303) {
                    m = "GET"
                    payload = null
                }
                continue
            }
            return conn
        }
        throw IOException("Çok fazla yönlendirme")
    }

    /** JS'ten gelen genel HTTP isteği (JSON yanıt). Sonuç `done` ile bir kez bildirilir; iptal edilirse bildirilmez. */
    fun request(id: Int, spec: String, done: (String) -> Unit) {
        pool.execute {
            var result: String? = null
            try {
                val o = JSONObject(spec)
                val headers = HashMap<String, String>()
                val ho = o.optJSONObject("headers")
                if (ho != null) {
                    val keys = ho.keys()
                    while (keys.hasNext()) {
                        val k = keys.next()
                        headers[k] = ho.getString(k)
                    }
                }
                if (headers.keys.none { it.equals("user-agent", ignoreCase = true) }) headers["User-Agent"] = userAgent
                val body = if (o.isNull("body")) null else o.getString("body").toByteArray(Charsets.UTF_8)
                val conn = open(o.getString("url"), o.optString("method", "GET"), headers, body, o.optInt("timeoutMs", 120000), id)
                val code = conn.responseCode
                val stream = if (code >= 400) conn.errorStream else conn.inputStream
                val text = stream?.use { String(it.readBytes(), Charsets.UTF_8) } ?: ""
                val hs = JSONObject()
                for ((k, v) in conn.headerFields) {
                    if (k != null && v.isNotEmpty()) hs.put(k.lowercase(), v.joinToString(", "))
                }
                result = JSONObject().put("status", code).put("body", text).put("headers", hs).toString()
            } catch (e: Exception) {
                if (!cancelled.remove(id)) {
                    result = JSONObject().put("error", e.message ?: e.javaClass.simpleName).toString()
                }
            } finally {
                active.remove(id)?.disconnect()
            }
            val r = result
            if (r != null) done(r)
        }
    }

    fun cancel(id: Int) {
        cancelled.add(id)
        active[id]?.disconnect()
    }

    private fun originOf(pageUrl: String?): String? =
        try {
            if (pageUrl.isNullOrEmpty()) null else {
                val u = URL(pageUrl)
                val port = if (u.port > 0) ":${u.port}" else ""
                "${u.protocol}://${u.host}$port"
            }
        } catch (e: Exception) {
            null
        }

    private fun err(status: Int, msg: String): WebResourceResponse =
        WebResourceResponse(
            "text/plain",
            "utf-8",
            status,
            "Error",
            mapOf("Access-Control-Allow-Origin" to "*"),
            ByteArrayInputStream(msg.toByteArray()),
        )

    /** worker sayfasının /native/image?u=...&r=... isteği: görseli Referer + çerezle indirip akıtır. */
    fun image(url: String?, pageUrl: String?): WebResourceResponse {
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) return err(400, "Bad URL")
        return try {
            val headers = HashMap<String, String>()
            headers["User-Agent"] = userAgent
            headers["Accept"] = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
            val origin = originOf(pageUrl)
            if (origin != null) headers["Referer"] = "$origin/"
            val cookie = CookieManager.getInstance().getCookie(url)
            if (!cookie.isNullOrEmpty()) headers["Cookie"] = cookie
            val conn = open(url, "GET", headers, null, 60000, null)
            val code = conn.responseCode
            if (code !in 200..299) {
                conn.disconnect()
                err(if (code in 400..599) code else 502, "HTTP $code")
            } else {
                val mime = (conn.contentType ?: "image/jpeg").substringBefore(';').trim()
                WebResourceResponse(mime, null, 200, "OK", mapOf("Access-Control-Allow-Origin" to "*"), conn.inputStream)
            }
        } catch (e: Exception) {
            err(502, e.message ?: "fetch error")
        }
    }
}
