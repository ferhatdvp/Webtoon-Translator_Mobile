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
        versionCode = 17
        versionName = "0.1.16"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            it.testLogging {
                events("passed", "failed")
                exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
            }
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
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.17")
}
