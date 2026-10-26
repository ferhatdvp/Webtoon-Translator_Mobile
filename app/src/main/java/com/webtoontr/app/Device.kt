package com.webtoontr.app

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.PowerManager
import org.json.JSONObject

/** Ağ ve pil durumu (worker'daki "çeviri yapılsın mı?" kararı için). */
object Device {
    fun json(ctx: Context): String {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
        val onWifiTransport = caps != null &&
            (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
        val metered = cm.isActiveNetworkMetered
        // Kullanıcı Wi-Fi ağını "ölçülü" işaretlediyse (ya da telefon hotspot'una bağlıysa) mobil veri gibi say.
        val wifi = onWifiTransport && !metered
        val dataSaver = cm.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED

        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        val bi: Intent? = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = bi?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = bi?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val pct = if (level >= 0 && scale > 0) level * 100 / scale else -1
        val status = bi?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL

        return JSONObject()
            .put("wifi", wifi)
            .put("metered", metered)
            .put("dataSaver", dataSaver)
            .put("batteryPct", pct)
            .put("charging", charging)
            .put("powerSave", pm.isPowerSaveMode)
            .toString()
    }
}
