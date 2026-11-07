# Webtoon Çevirmen — Android prototipi (EN → TR)

Telefonda çalışan mini tarayıcı. Listeye eklediğin webtoon sitelerinde görsellerdeki İngilizce yazıları
Gemini (ücretsiz katman) ile Türkçeye çevirip yazının üstüne yerleştirir. Chrome eklentisiyle **aynı JS kodunu** kullanır
(çeviri hattı, önbellek, kota koruması, kutu yerleştirme); Android'e özgü kısım yalnızca ince bir Kotlin kabuğudur.

> **Güncel durum:** APK, GitHub Actions üzerinden derleniyor. Reklam engelleme şu anda temel düzeyde çalışıyor; bazı reklamlar görüntülenebilir. Çeviri sistemi çalışıyor, ancak çeviri hızı şimdilik yavaş. Hız iyileştirmeleri ileriki güncellemelerde hedefleniyor.

## APK'yı indirip telefona kur

1. Android telefonundan [`webtoon-cevirmen-debug.apk` dosyasını indir](https://github.com/ferhatdvp/Webtoon-Translator_Mobile/raw/refs/heads/local-project-2026-11-08/downloads/webtoon-cevirmen-debug.apk).
2. İndirilenler klasöründe APK'ya dokun ve **Yükle**'yi seç. Telefon izin isterse, indirme yaptığın uygulama için **Bilinmeyen uygulamaları yükle** iznini açıp kuruluma dön.
3. Uygulamayı aç ve aşağıdaki **İlk kullanım** adımlarını tamamla.

Bilgisayarda kendin derlemek istersen Android Studio'da **Build → Build Bundle(s) / APK(s) → Build APK(s)** seç; çıktı `app/build/outputs/apk/debug/app-debug.apk` konumunda olur. GitHub Actions da `local-project-2026-11-08` dalına her güncellemede APK'yı yeniden derleyip bu depoya koyar.

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

## Mimari
```
 Tarayıcı WebView (site)               Arka plan WebView (1x1, görünmez)              Kotlin
┌──────────────────────────┐ köprü   ┌────────────────────────────────────┐   ┌──────────────────┐
│ page-bundle.js           │◀──────▶│ worker.html                         │   │ MainActivity     │
│  = content.js + CSS      │ window. │  chrome-shim.js (chrome.* taklidi)  │   │  adres çubuğu,   │
│ (yalnızca izinli sitede) │__wttBridge│  native-fetch.js (fetch → native)  │◀─▶│  menü, site kuralı│
└──────────────────────────┘         │  service-worker.js + pipeline.js    │   │ Worker.kt (yönl.)│
                                     │  cache (IndexedDB), kota, sağlayıcı │   │ Http.kt (ağ)     │
 Ayarlar = options.html (aynısı)     └────────────────────────────────────┘   │ Store.kt (depo)  │
                                                                              │ Device.kt (pil/ağ)│
```
* Köprü (`window.__wttBridge`, WebMessageListener) yalnızca **izinli sitelerin kökenlerinde** tanımlanır; listede olmayan sitede
  köprü de, çeviri kodu da yoktur. Kotlin yalnızca 3 mesaj türünü iletir (`GET_PAGE_CONFIG`, `TRANSLATE_IMAGE`, `OPEN_OPTIONS`).
* API anahtarı yalnızca Kotlin/arka plan tarafındadır; sayfaya verilmez. Uygulamaya özel depoda tutulur, yedeğe girmez (`allowBackup=false`).
* Görsel indirme native yapılır: sayfanın Referer'ı ve çerezleri gönderilir (CORS/hotlink sorunu yok).
* `usesCleartextTraffic=true`: yerel ağdaki Ollama (`http://192.168...`) ve http siteler için.

## Dosyalar
| Dosya | Görev |
|---|---|
| `app/src/main/java/com/webtoontr/app/MainActivity.kt` | Mini tarayıcı, menü, site listesi → köprü kuralları, sayfa↔arka plan yönlendirme |
| `.../Worker.kt` | Arka plan WebView'ı, mesaj yönlendirici, `HostJs` (JS↔Kotlin arayüzü) |
| `.../Http.kt` | Gemini/Ollama istekleri ve Referer+çerezli görsel indirme |
| `.../Store.kt` | Depolama (SharedPreferences) ve site listesi yardımcıları |
| `.../Device.kt` | Wi-Fi / ölçülü ağ / pil / tasarruf modu |
| `.../SettingsActivity.kt` | Ayarlar ekranı (eklentinin options sayfası) |
| `.../WttApp.kt` | Uygulama arka plana geçince hattı durdurur |
| `web-src/mobile/*` | `chrome-shim.js`, `native-fetch.js`, `worker.html`, `worker-main.js` (mobil kancalar) |
| `web-src/page-bundle.template.js` | Siteye enjekte edilen paketin şablonu |
| `tools/sync-web.mjs` | Eklenti kodunu `assets/web/` altına kopyalar (zaten yapılmış; eklentiyi değiştirirsen `node tools/sync-web.mjs`) |
| `.github/workflows/build-apk.yml` | GitHub'da APK derleme iş akışı |

## Güncel durum ve bilinen sınırlamalar
- APK, GitHub Actions iş akışıyla derleniyor.
- Reklam engelleme temel düzeydedir; bazı reklamlar engellenmeyebilir ve kullanıcılar reklam görmeye devam edebilir.
- Çeviri sistemi çalışıyor. Çeviri işlemleri şu anda yavaş ilerleyebilir; hızın gelecek güncellemelerde iyileştirilmesi hedefleniyor.
- Gerçek Android WebView, web arama ve çeviri davranışları telefonda doğrulanmalıdır.

## Bilinen sınırlar
* Sayfa-dünyasında çalıştığı için sitenin kendi (veya reklam) betikleri köprüyü çağırabilir; en kötü ihtimalle ücretsiz kotanı harcatır
  (günlük yerel sınır ve ücretli kullanım koruması burada da geçerli). Eklentide bu risk yoktu (izole dünya).
* Çok uzun sayfalarda "tüm sayfayı önden çevir" kotayı hızlı harcar; pil tasarrufunda otomatik "yakın" moduna düşer.
* Alt-alan adları: ⋮ menüsünden eklenen ad `m.site.com` gibi kalabilir; Ayarlar'dan `site.com` olarak da ekleyebilirsin.
* iOS desteklenmiyor.
