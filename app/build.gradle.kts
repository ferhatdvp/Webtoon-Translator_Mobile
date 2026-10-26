plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.webtoontr.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.webtoontr.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0-prototype"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
