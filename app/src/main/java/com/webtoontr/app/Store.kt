package com.webtoontr.app

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/**
 * chrome.storage.local yerine: uygulamaya özel SharedPreferences (anahtar -> JSON metni).
 * API anahtarı da "settings" içindedir; dosya yalnızca bu uygulamanın erişebildiği alandadır
 * (allowBackup kapalı, yani yedeğe girmez). Ayrıca site listesi yardımcıları burada durur.
 */
object Store {
    private lateinit var prefs: SharedPreferences

    fun init(ctx: Context) {
        if (!::prefs.isInitialized) {
            prefs = ctx.applicationContext.getSharedPreferences("wtt_storage", Context.MODE_PRIVATE)
        }
    }

    fun get(key: String): String? = prefs.getString(key, null)

    fun set(key: String, json: String) {
        prefs.edit().putString(key, json).apply()
    }

    fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }

    fun keys(): String = JSONArray(prefs.all.keys.toList()).toString()

    // ------------------------------------------------------------------ site listesi

    private fun settings(): JSONObject =
        try {
            JSONObject(get("settings") ?: "{}")
        } catch (e: Exception) {
            JSONObject()
        }

    /** Mobil WebView'daki reklam engeli açık (varsayılan) mı? */
    fun isAdBlockEnabled(): Boolean = settings().optJSONObject("mobile")?.optBoolean("adBlock", true) ?: true

    /** "https://www.Webtoons.com/en/x" -> "webtoons.com" (shared/sites.js normalizeHost ile aynı kural). */
    fun normalizeHost(input: String): String? {
        var s = input.trim().lowercase()
        if (s.isEmpty()) return null
        if (!Regex("^[a-z][a-z0-9+.-]*://").containsMatchIn(s)) s = "https://$s"
        val host = try {
            URI(s).host
        } catch (e: Exception) {
            null
        } ?: return null
        val h = host.removePrefix("www.")
        if (h.isEmpty()) return null
        if (!h.contains('.') && h != "localhost") return null
        return h
    }

    fun hostMatches(hostname: String, siteHost: String): Boolean {
        val h = hostname.lowercase().removePrefix("www.")
        return h == siteHost || h.endsWith(".$siteHost")
    }

    /** Genel şalter açık ve site etkinse o sitenin kayıtlı adresi, değilse null. */
    fun enabledHosts(): List<String> {
        val s = settings()
        if (!s.optBoolean("enabled", true)) return emptyList()
        val arr = s.optJSONArray("sites") ?: return emptyList()
        val out = ArrayList<String>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optBoolean("enabled", true)) out.add(o.optString("host"))
        }
        return out.filter { it.isNotEmpty() }
    }

    fun savedHosts(): List<String> {
        val arr = settings().optJSONArray("sites") ?: return emptyList()
        val out = ArrayList<String>()
        for (i in 0 until arr.length()) arr.optJSONObject(i)?.optString("host")?.let { if (it.isNotEmpty()) out.add(it) }
        return out
    }

    fun findSavedHost(hostname: String): String? = savedHosts().firstOrNull { hostMatches(hostname, it) }

    fun isAllowedHost(hostname: String): Boolean = enabledHosts().any { hostMatches(hostname, it) }

    fun addSite(host: String) {
        val s = settings()
        val arr = s.optJSONArray("sites") ?: JSONArray()
        val site = JSONObject().put("host", host).put("enabled", true).put("addedAt", System.currentTimeMillis())
        arr.put(site)
        s.put("sites", arr)
        set("settings", s.toString())
    }

    fun removeSite(host: String) {
        val s = settings()
        val arr = s.optJSONArray("sites") ?: return
        val next = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("host") != host) next.put(o)
        }
        s.put("sites", next)
        set("settings", s.toString())
    }
}
