package com.webtoontr.app

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.webkit.WebSettings

class WttApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Store.init(this)
        AdBlocker.initialize(this)
        Http.userAgent = WebSettings.getDefaultUserAgent(this)
        registerActivityLifecycleCallbacks(
            object : ActivityLifecycleCallbacks {
                private var started = 0

                override fun onActivityStarted(activity: Activity) {
                    if (started++ == 0) Worker.setActive(true)
                }

                override fun onActivityStopped(activity: Activity) {
                    if (--started == 0) Worker.setActive(false) // uygulama arka planda: çeviri durur
                }

                override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
                override fun onActivityResumed(activity: Activity) {}
                override fun onActivityPaused(activity: Activity) {}
                override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
                override fun onActivityDestroyed(activity: Activity) {}
            },
        )
    }
}
