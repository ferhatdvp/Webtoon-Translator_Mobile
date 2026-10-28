plugins {
    id("com.android.application")
}

android {
    namespace = "com.webtoontr.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.webtoontr.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 3
        versionName = "0.1.2-popup-block"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("io.github.mlm-games:adblock:0.1.3")
}
