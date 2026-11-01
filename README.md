# Webtoon Çevirmen — Android prototipi (EN → TR)

Telefonda çalışan mini tarayıcı. Listeye eklediğin webtoon sitelerinde görsellerdeki İngilizce yazıları Gemini (ücretsiz katman) ile Türkçeye çevirip yazının üstüne yerleştirir.

> **Güncel durum:** APK, GitHub Actions ile derleniyor. Reklam engelleme şu anda temel düzeyde çalışıyor; kullanıcılar bazı reklamları görmeye devam edebilir. Çeviri sistemi çalışıyor, ancak çeviri hızı şu an biraz yavaş. Hızın ileriki güncellemelerde iyileştirilmesi hedefleniyor.

## APK'yı indirip telefona kur

1. Android telefonundan [webtoon-cevirmen-debug.apk dosyasını indir](https://github.com/ferhatdvp/Webtoon-Translator_Mobile/raw/refs/heads/main/downloads/webtoon-cevirmen-debug.apk).
2. İndirilenler klasöründe APK'ya dokun ve **Yükle**'yi seç. Telefon izin isterse, indirme yaptığın uygulama için **Bilinmeyen uygulamaları yükle** iznini açıp kuruluma dön.
3. Uygulamayı aç ve aşağıdaki **İlk kullanım** adımlarını tamamla.

GitHub Actions, main dalındaki güncellemelerde APK'yı yeniden derleyip bu depoya koyar.

## İlk kullanım
1. Uygulamayı aç → ⋮ → **Ayarlar**: Gemini API anahtarını gir (<https://aistudio.google.com/apikey>), ücretsiz katman onayını işaretle, bağlantıyı test et ve kaydet.
2. Adres çubuğuna webtoon sitesini yaz, aç → ⋮ → **Bu siteyi çeviri listesine ekle**.
3. Bölümü oku. Çevirilen görsellerin üstünde ⏳ rozeti çıkar; bir yazıya dokununca İngilizce orijinali kısa süre görünür.

## Reklam engeli ve çeviri hızı
Reklam engeli şu anda temel düzeyde çalışıyor; tüm reklamları engellemez ve bazı reklamlar sayfalarda görüntülenebilir. Çeviri sistemi çalışıyor, ancak şu an yavaş ilerleyebilir. Çeviri hızının ileriki güncellemelerde iyileştirilmesi hedefleniyor.

## Doğrulama
APK, GitHub Actions üzerinden derleniyor. Gerçek Android WebView, web araması ve çeviri davranışlarının telefonda doğrulanması gerekiyor.
