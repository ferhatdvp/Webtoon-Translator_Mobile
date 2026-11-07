# Webtoon Çevirmen — Android prototipi (EN → TR)

Telefonda çalışan mini tarayıcı. Listeye eklediğin webtoon sitelerinde görsellerdeki İngilizce yazıları
Gemini (ücretsiz katman) ile Türkçeye çevirip yazının üstüne yerleştirir. Chrome eklentisiyle **aynı JS kodunu** kullanır
(çeviri hattı, önbellek, kota koruması, kutu yerleştirme); Android'e özgü kısım yalnızca ince bir Kotlin kabuğudur.

> **Güncel durum:** APK, GitHub Actions üzerinden derleniyor. Reklam engelleme şu anda temel düzeyde çalışıyor; bazı reklamlar görüntülenebilir. Çeviri sistemi çalışıyor, ancak çeviri hızı şimdilik yavaş. Hız iyileştirmeleri ileriki güncellemelerde hedefleniyor.

## APK'yı indirip telefona kur

1. Android telefonundan [`webtoon-cevirmen-debug.apk` dosyasını indir](https://github.com/ferhatdvp/Webtoon-Translator_Mobile/raw/refs/heads/main/downloads/webtoon-cevirmen-debug.apk).
2. İndirilenler klasöründe APK'ya dokun ve **Yükle**'yi seç. Telefon izin isterse, indirme yaptığın uygulama için **Bilinmeyen uygulamaları yükle** iznini açıp kuruluma dön.
3. Uygulamayı aç ve aşağıdaki **İlk kullanım** adımlarını tamamla.

Bilgisayarda kendin derlemek istersen Android Studio'da **Build → Build Bundle(s) / APK(s) → Build APK(s)** seç. APK, `app/build/outputs/apk/debug/app-debug.apk` konumunda oluşur.

## İlk kullanım

1. Uygulamayı aç → ⋮ → **Ayarlar**: Gemini API anahtarını gir (<https://aistudio.google.com/apikey>), "ücretsiz katman" onayını işaretle, **Bağlantıyı test et**, **Kaydet**.
2. Adres çubuğuna webtoon sitesini yaz, aç → ⋮ → **Bu siteyi çeviri listesine ekle** (sayfa yenilenir).
3. Bölümü oku. Çevirilen görsellerin üstünde ⏳ rozeti çıkar, bitince Türkçe kutular yerleşir.
   Bir yazıya **dokununca** İngilizce orijinali ~4,5 sn görünür. Sağ alttaki **TR** düğmesi çeviriyi gizler/gösterir.

## Pil / ısı / veri için alınan önlemler

| Önlem | Nasıl |
|---|---|
| Reklam engeli | Temel düzeyde çalışır. Bilinen reklam sağlayıcılarının bazı isteklerini engeller; reklamların tamamını engellemez ve kullanıcılar sayfalarda reklam görebilir. |
| Arka planda çeviri yok | Uygulama arka plana gidince çeviri hattı durur. AFK küçük pencere açıkken çeviri devam edebilir. |
| Yalnızca Wi-Fi (varsayılan açık) | Mobil veride hiçbir istek (indirme dahil) başlamaz; Wi-Fi gelince 15 sn içinde kendiliğinden devam. "Ölçülü" işaretli Wi-Fi / telefon hotspot'u da mobil veri sayılır |
| Düşük pil | Pil < %15 ve şarjda değilse beklemeye alır (Ayarlar → 8 · Telefon'dan değişir) |
| Pil/Veri tasarrufu modu | Açıksa "tüm sayfayı önden çevir" yerine "yalnızca ekrana yakın görseller" moduna düşer |
| Düşük yük | İstekler seri ve aralıklı (aynı ücretsiz-kota zamanlayıcısı); görseller ≤1000 px JPEG'e küçültülür; sonuçlar IndexedDB'de önbelleklenir |

Ölçüm önerisi: aynı bölümü (önbelleği temizleyip) 15 dk oku; Ayarlar → Pil → Uygulama kullanımı ve ısıyı karşılaştır.
Bir kez "tüm sayfa önden", bir kez "yalnızca yakın görseller" dene.
