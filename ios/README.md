# AZAP Online — iOS Uygulaması

Web'deki oyunun **birebir aynısı** (aynı arayüz, aynı UI/UX, aynı animasyonlar) —
ama **ayrı bir yazılım**: uygulama web sitesini AÇMAZ. Web istemcisinin kopyası
(`WebAssets/` klasörü: index.html, app.js, style.css, a.png) uygulamanın içine
gömülüdür ve WKWebView bu yerel dosyaları yükler. Yalnızca oyun sunucusuna
(socket.io + API, `https://azap.online`) bağlanır.

**Web istemcisi her güncellendiğinde** gömülü kopyayı yenile:

```
node ios/sync-web-assets.js
```

Bu script `public/` içeriğini `ios/AzapOnline/WebAssets/` klasörüne kopyalar ve
gömülü moda uyarlar (`window.AZAP_SERVER` + `window.AZAP_PLATFORM='ios'` enjekte
eder, sunucu URL'lerini mutlaklaştırır). Sonra Xcode'da yeniden derle.

Gömülü istemci **iOS modunda** çalışır:

- Altın/Premium "Satın Al" butonları web ödemesi yerine **native StoreKit köprüsüne** gider
- Bağış sekmesi ve web ödeme onay kutuları gizlenir (Apple Kural 3.1.1)
- Altın Havuzu (bahis) paneli gizlenir (Apple Kural 5.3 riski)

Uygulama **ücretli** olarak satılacak; oyun içi tüm satın alımlar **Apple In-App
Purchase** ile yapılır. (Ücretli uygulama + IAP kombinasyonu Apple kurallarına uygundur.)

---

## 1. Xcode Projesi Kurulumu (macOS gerekir)

1. Xcode → **File > New > Project > iOS > App**
   - Product Name: `AzapOnline`
   - Organization Identifier: `online.azap` → Bundle ID: **`online.azap.app`**
   - Interface: SwiftUI, Language: Swift
   - Minimum iOS: **16.0**
2. Xcode'un oluşturduğu `AzapOnlineApp.swift` ve `ContentView.swift` dosyalarını
   bu klasördeki (`ios/AzapOnline/`) dosyalarla değiştir; `AzapWebView.swift` ve
   `IAPManager.swift` dosyalarını projeye ekle.
   - `node ios/sync-web-assets.js` çalıştır, oluşan **`WebAssets` klasörünü**
     Xcode'a sürükle → "Create folder references" (MAVİ klasör) seç. Bu klasör
     uygulamanın gömülü oyun istemcisidir.
3. **Signing & Capabilities**:
   - Team seç (Apple Developer hesabı — yıllık 99$)
   - **+ Capability → In-App Purchase** ekle
4. **Info.plist**'e ekle (Info sekmesi):
   | Key | Değer |
   |---|---|
   | `NSMicrophoneUsageDescription` | `AZAP, oyun içi sesli sohbet için mikrofonunuza erişir.` |
   | `UIViewControllerBasedStatusBarAppearance` | `NO` |
   | `UIUserInterfaceStyle` | `Dark` |
   - HTTPS kullanıldığı için ATS istisnası **gerekmez**.
5. **Uygulama ikonu**: `public/a.png` (2000×2000) dosyasını Assets'e AppIcon
   olarak ekle (Xcode 15+ tek 1024×1024 görsel kabul eder — a.png'yi 1024'e küçült).

## 2. App Store Connect Kurulumu

1. **Yeni uygulama oluştur**: Bundle ID `online.azap.app`, kategori: Games > Word/Social.
2. **Fiyatlandırma**: Ücretli (istediğin katman, örn. ₺39.99).
3. **In-App Purchase ürünleri oluştur** (Consumable / Non-Renewing):

   | Product ID | Tür | Karşılık (sunucu paketi) |
   |---|---|---|
   | `online.azap.gold_100` | Consumable | gold_100 (100 altın) |
   | `online.azap.gold_500` | Consumable | gold_500 (600 altın) |
   | `online.azap.gold_1500` | Consumable | gold_1500 (2000 altın) |
   | `online.azap.gold_5000` | Consumable | gold_5000 (7500 altın) |
   | `online.azap.premium_1m` | Non-Renewing Subscription | premium_1m (30 gün) |
   | `online.azap.premium_3m` | Non-Renewing Subscription | premium_3m (90 gün) |

   > Product ID'nin son bölümü (`gold_100` gibi) sunucudaki `PAYMENT_PACKAGES`
   > anahtarıyla otomatik eşleşir. Farklı ID kullanırsan sunucuda
   > `APPLE_IAP_PRODUCTS` env'iyle eşleme tanımla.

4. **App-Specific Shared Secret** oluştur: App Store Connect → Uygulama →
   In-App Purchases → App-Specific Shared Secret.

## 3. Sunucu Ortam Değişkenleri (.env)

```
APPLE_SHARED_SECRET=<app-specific shared secret>
APPLE_BUNDLE_ID=online.azap.app
# Opsiyonel özel ürün eşlemesi:
# APPLE_IAP_PRODUCTS={"com.baska.id":"gold_100"}

# ── PUSH BİLDİRİM (APNs) ──
# Apple Developer → Certificates, IDs & Profiles → Keys → (+) → "Apple Push
# Notifications service (APNs)" işaretle → .p8 dosyasını indir (TEK SEFERLİK!)
APNS_KEY_PATH=./data/apns-key.p8
APNS_KEY_ID=<10 haneli Key ID>
APNS_TEAM_ID=<Team ID — Membership sayfasında>
APNS_TOPIC=online.azap.app
APNS_PRODUCTION=true
```

## 3b. Push Bildirim Akışı

- Kullanıcı uygulamada giriş yapınca web istemcisi native'e "izin iste" der;
  izin verilirse APNs cihaz tokenı sunucuya authed socket ile kaydedilir
  (kullanıcı başına max 5 cihaz, geçersiz tokenlar otomatik temizlenir).
- **Otomatik bildirim**: aktif oyunda bağlantısı kopan oyuncuya
  "3 dakika içinde geri dön" push'u gider.
- **Admin duyurusu**: Admin Panel → İstatistikler → "📲 Push Duyuru" formundan
  tüm kayıtlı iOS cihazlara duyuru gönderilir.
- Apple Developer'da App ID'nin (online.azap.app) **Push Notifications**
  capability'si işaretli olmalı (Identifiers → App ID → Capabilities).

## 3c. Mac'siz Derleme — GitHub Actions ile TestFlight

Mac'in olmasa da uygulamayı derleyip TestFlight'a yükleyebilirsin:

1. App Store Connect → **Users and Access → Integrations → App Store Connect API**
   → (+) yeni anahtar, rol: **App Manager** → .p8 indir, Key ID + Issuer ID not al.
2. GitHub repo → Settings → Secrets and variables → Actions → şu secret'ları ekle:
   - `ASC_KEY_ID` — API Key ID
   - `ASC_ISSUER_ID` — Issuer ID
   - `ASC_KEY_P8` — .p8 dosyasının içeriği (metin olarak yapıştır)
   - `APPLE_TEAM_ID` — Developer Team ID
3. App Store Connect'te uygulamayı oluştur (Bundle ID `online.azap.app` —
   önce developer.apple.com → Identifiers'dan App ID kaydet; Push Notifications
   + In-App Purchase capability'lerini işaretle).
4. GitHub → **Actions → "iOS TestFlight" → Run workflow**. Derleme + imzalama +
   TestFlight yüklemesi tamamen bulutta yapılır (~15 dk).
5. TestFlight'tan telefonuna kur, test et; hazır olunca App Store'a gönder.

Sunucudaki `/api/iap/verify` endpoint'i:
- iOS uygulamasından `{ username, receiptData }` alır
- Apple `verifyReceipt` servisiyle doğrular (production → 21007 ise sandbox)
- Bundle ID kontrolü yapar, işlenmiş transaction'ları `data/iap_transactions.json`
  ile tekrar-tanımlamaya (replay) karşı korur
- Paketi hesaba tanımlar ve bağlı socket'lere `statsUpdate` yollar

## 4. Test

1. Sandbox test hesabı oluştur (App Store Connect → Users and Access → Sandbox).
2. Uygulamayı gerçek cihazda çalıştır, sandbox hesabıyla satın alma yap.
3. Sunucu loglarında `[IAP] <kullanıcı> → <paket> tanımlandı` satırını doğrula.
4. Uçuş modu/başarısız sunucu senaryosu: doğrulama başarısız olursa transaction
   `finish()` edilmez → uygulama yeniden açıldığında Restore ile tekrar denenir.

## 5. App Store İnceleme Kontrol Listesi

- ✅ **3.1.1** Dijital satın alımlar yalnızca IAP (web ödeme iOS modunda kapalı)
- ✅ **3.1.3** Uygulama içinde web ödemesine link YOK
- ✅ **5.1.1(v)** Uygulama içi hesap silme mevcut (Profil → Hesabı Kalıcı Olarak Sil)
- ✅ **5.3** Bahis paneli iOS'ta gizli
- ⚠️ **4.2 (minimum işlevsellik)**: Salt webview reddedilebilir. Öneri: push
  bildirim (oyun daveti), haptic feedback, native paylaşım ekle. İlk sürümde
  mikrofon (sesli sohbet) native izin akışı + IAP zaten native özellik sayılır,
  ancak reddedilirse bu maddeyi güçlendir.
- 📋 **Privacy Nutrition Label** (App Store Connect):
  - Hesap bilgisi: kullanıcı adı (hesapla ilişkili)
  - Kullanıcı içeriği: avatar fotoğrafı (hesapla ilişkili)
  - Satın alma geçmişi (hesapla ilişkili)
  - Ses verisi: sesli sohbet (yalnızca iletim, kaydedilmiyor → "veri toplanmıyor" işaretlenebilir)
  - Takip (ATT): YOK — reklam/izleme yapılmıyor, ATT izni gerekmez
- 📋 Yaş derecelendirmesi: 12+ önerilir (hafif şiddet teması: "öldürme" mekanikleri)
- 📋 EULA/Gizlilik: mevcut `https://azap.online/yasal/*` sayfalarını App Store
  Connect'teki Privacy Policy URL alanına ekle

## 6. Web Tarafı Köprü Sözleşmesi (referans)

- Web → Native: `window.webkit.messageHandlers.iap.postMessage({action:'purchase', packageId, productId, username})`
- Web → Native: `{action:'restore', username}` (restore butonu eklemek istersen)
- Native → Web: `window.azapIapResult({ok:true|false, error:null|'mesaj'})`
- iOS tespiti: URL `?platform=ios` **veya** User-Agent içinde `AzapiOS`
