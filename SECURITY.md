# AZAP Güvenlik

## Production Kurulumu

### Gerekli adımlar:
1. **Bağımlılıkları kur:**
   ```bash
   npm install
   ```
   `helmet` ve `express-rate-limit` paketleri güvenlik için kurulmalı.

2. **`.env` dosyasını hazırla:**
   ```bash
   cp .env.example .env
   ```
   Sonra `.env` dosyasını düzenle:
   - `NODE_ENV=production` yap
   - `IYZICO_API_KEY` ve `IYZICO_SECRET_KEY` doldur
   - `CORS_ORIGIN=https://azap.online` (kendi domain'in)

3. **Reverse proxy (nginx) ayarla** (örnek aşağıda)

4. **HTTPS zorunlu** — Let's Encrypt SSL kullan

5. **PM2 ile çalıştır:**
   ```bash
   npm install -g pm2
   pm2 start server/index.js --name azap
   pm2 save
   pm2 startup
   ```

## Güvenlik Önlemleri

### Sunucu tarafı:
- ✅ **Helmet middleware** — güvenlik header'ları (CSP, X-Frame-Options, X-XSS, vs.)
- ✅ **Rate limiting** — API/payment/admin endpoint'leri için ayrı limitler
- ✅ **CORS kontrolü** — production'da spesifik origin
- ✅ **express.json limit** — 1MB max body
- ✅ **Input validation** — username, password, playerName regex + uzunluk kontrolleri
- ✅ **HTML escape** — `<>&"'` karakterleri oyun içi isimde otomatik silinir
- ✅ **Path traversal koruması** — screenshot endpoint'inde dosya adı sanitize
- ✅ **Bcrypt şifre hash'i** — düz metin saklanmaz
- ✅ **Token doğrulama** — auto-login token'ları kullanıcıya bağlı (max 5 cihaz)
- ✅ **Admin yetki kontrolü** — her admin endpoint'inde `requireAdmin()`
- ✅ **Trust proxy** — reverse proxy arkasında doğru IP

### Ödeme güvenliği:
- ✅ **İyzico Checkout Form** — kart bilgileri AZAP sunucusuna ASLA gelmez
- ✅ **Server-side validation** — paket ID whitelist, miktar sınırları
- ✅ **dev-complete endpoint** — production'da otomatik kapanır
- ✅ **Webhook imza doğrulaması** (TODO: gerçek İyzico entegrasyonu yapılırken)

### Coin/ekonomi güvenliği:
- ✅ Tüm coin işlemleri **server-side** yapılır
- ✅ **Negatif coin yok** — `Math.max(0, ...)` clamp
- ✅ **Bahis sınırları** (5-1000 coin)
- ✅ **Yetersiz coin** kontrolü
- ✅ **Atomic operations** — single Node.js instance (cluster modunda race condition olabilir)

### Frontend:
- ✅ **CSP header** — script-src/style-src kısıtlı
- ✅ **localStorage'da token** — XSS riski olmayan strict origin
- ✅ **HTML escape helper** (`esc()`) - kullanıcı girdileri için

## Production'da YAPMAK ZORUNDA OLDUKLARIN

1. ❗ **`NODE_ENV=production`** ayarla
2. ❗ **HTTPS kullan** (HTTP üzerinden token gönderme)
3. ❗ **`data/` dizinini düzenli yedekle** (users.json, reports.json)
4. ❗ **Firewall** kur (UFW): sadece 80/443/22 portları açık
5. ❗ **fail2ban** kur — SSH brute force koruması
6. ❗ **SSH password disable** — sadece key auth
7. ❗ **Düzenli güncelleme** — `apt update && apt upgrade`
8. ❗ **Log monitoring** — PM2 logs `/var/log/azap/`

## YAPMAYACAĞIN ŞEYLER

- ❌ **API key'leri kodda saklama** — sadece `.env`
- ❌ **`.env`'i git'e push etme** — `.gitignore`'da var
- ❌ **`data/users.json`'u public yayma** — bcrypt hash'leri leak olur
- ❌ **Admin yetkisini API üzerinden ver** — sadece `make-admin.js` veya admin paneli
- ❌ **CORS origin'i `*` bırak** — production'da spesifik domain
- ❌ **HTTP'de çalıştır** — token sniff edilir

## Güvenlik açığı buldun mu?
Beni doğrudan iletişime geç: **azapdev@protonmail.com** (örnek)
Public issue açma — özel bildir.
