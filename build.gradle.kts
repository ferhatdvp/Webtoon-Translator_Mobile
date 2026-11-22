buildscript {
    repositories {
        google()
        maven { url = uri("https://maven-central.storage-download.googleapis.com/maven2/") }
        mavenCentral()
    }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.10")
    }
}

plugins {
    id("com.android.application") version "9.4.0" apply false
}
