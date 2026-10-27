# Webtoon Çevirmen — Android prototipi (EN → TR)

Telefonda çalışan mini tarayıcı. Listeye eklediğin webtoon sitelerinde görsellerdeki İngilizce yazıları Gemini (ücretsiz katman) ile Türkçeye çevirip yazının üstüne yerleştirir.

> **Durum:** APK GitHub Actions ile derleniyor. Kullanıcı, gelişmiş reklam motorunu içeren sürümde arama sırasında çökme bildirdi. Çökme riskini azaltmak için bu düzeltme sürümünde yerel reklam motoru geçici olarak kapalı; bilinen reklam sağlayıcı alan adları engelleniyor. Gerçek cihazda yeniden doğrulanması gerekiyor.

## APK'yı indirip telefona kur

1. Android telefonundan [webtoon-cevirmen-debug.apk dosyasını indir](https://github.com/ferhatdvp/Webtoon-Translator_Mobile/raw/refs/heads/main/downloads/webtoon-cevirmen-debug.apk).
2. İndirilenler klasöründe APK'ya dokun ve **Yükle**'yi seç. Telefon izin isterse, indirme yaptığın uygulama için **Bilinmeyen uygulamaları yükle** iznini açıp kuruluma dön.
3. Uygulamayı aç ve aşağıdaki **İlk kullanım** adımlarını tamamla.

GitHub Actions, main dalındaki güncellemelerde APK'yı yeniden derleyip bu depoya koyar.

## İlk kullanım
1. Uygulamayı aç → ⋮ → **Ayarlar**: Gemini API anahtarını gir (<https://aistudio.google.com/apikey>), ücretsiz katman onayını işaretle, bağlantıyı test et ve kaydet.
2. Adres çubuğuna webtoon sitesini yaz, aç → ⋮ → **Bu siteyi çeviri listesine ekle**.
3. Bölümü oku. Çevirilen görsellerin üstünde ⏳ rozeti çıkar; bir yazıya dokununca İngilizce orijinali kısa süre görünür.

## Reklam engeli
Bu düzeltme sürümünde reklam engeli kararlılık için temel sağlayıcı alan adlarıyla sınırlı. EasyList / EasyPrivacy / AdGuard filtre motoru geçici olarak devre dışı; bu nedenle bazı reklamlar görünebilir.

## Doğrulama durumu
APK derlemesi GitHub Actions'ta başarılı olmalı. Gerçek Android WebView, web araması ve çeviri davranışı telefonda doğrulanmalıdır.
