# 🚀 AZAP — VDS Sunucu Kurulum Rehberi

**Ubuntu 20.04 / 22.04 / 24.04 LTS için tam adım adım rehber.**
Domain: `azap.online` (örnek), Sunucu: 4vCPU/12GB RAM/300GB SSD VDS.

> ⚠️ Bu rehber **production** ortamı içindir. Adımları sırayla yap, atla.

---

## 📋 ÖZET — Yapılacak adımlar

1. Sunucuya SSH bağlan
2. Sistem güncelle + güvenlik (firewall, fail2ban, SSH hardening)
3. Node.js 20 LTS kur
4. Nginx kur ve reverse proxy yap
5. SSL sertifikası al (Let's Encrypt)
6. AZAP kodunu sunucuya yükle
7. Bağımlılıkları kur + .env doldur
8. PM2 ile başlat (otomatik restart)
9. Test ve monitoring

Tahmini toplam süre: **30-45 dakika**.

---

## 🔧 ADIM 1 — SSH bağlantı ve ilk hazırlık

```bash
# Yerel makinenden:
ssh root@SUNUCU_IP

# Eğer ilk kez giriyorsan: SSH key kopyala (parola sormaması için)
ssh-copy-id root@SUNUCU_IP
```

### Sistem güncelle:
```bash
apt update && apt upgrade -y
apt install -y curl wget git build-essential ufw fail2ban htop nano
```

### Yeni kullanıcı oluştur (root yerine):
```bash
adduser azap
usermod -aG sudo azap
# Şifresiz sudo (opsiyonel ama PM2 startup için kolaylık):
# echo "azap ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/azap

# SSH key'i kopyala
rsync --archive --chown=azap:azap ~/.ssh /home/azap

# Bundan sonra azap kullanıcısı olarak çalış
su - azap
```

---

## 🔥 ADIM 2 — GÜVENLİK

### 2.1 Firewall (UFW)
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP
sudo ufw allow 443/tcp    # HTTPS
sudo ufw enable
sudo ufw status
```

### 2.2 SSH güvenlik (PASSWORD AUTH KAPAT)
```bash
sudo nano /etc/ssh/sshd_config
```

Şu satırları bul, değiştir:
```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

```bash
sudo systemctl restart sshd
```

> ⚠️ Çıkmadan önce **yeni terminal** aç ve `ssh azap@SUNUCU_IP` ile giriş yapabildiğine emin ol!

### 2.3 fail2ban (brute force koruması)
```bash
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
sudo fail2ban-client status sshd
```

---

## 📦 ADIM 3 — Node.js 20 LTS

```bash
# NodeSource resmi reposundan
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Sürüm kontrolü
node -v   # v20.x.x
npm -v    # 10.x.x
```

### PM2 (process manager)
```bash
sudo npm install -g pm2
```

---

## 🌐 ADIM 4 — Nginx kurulum + reverse proxy

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
```

### AZAP için nginx config:
```bash
sudo nano /etc/nginx/sites-available/azap
```

Bu içeriği yapıştır (`azap.online` yerine kendi domain'ini yaz):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name azap.online www.azap.online;

    # Let's Encrypt için
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # HTTP → HTTPS yönlendir (SSL alındıktan sonra aktif)
    # return 301 https://$server_name$request_uri;

    # SSL alana kadar geçici proxy:
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

```bash
# Etkinleştir
sudo ln -s /etc/nginx/sites-available/azap /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # default config'i kaldır
sudo nginx -t                              # syntax check
sudo systemctl reload nginx

# Let's Encrypt için klasör
sudo mkdir -p /var/www/certbot
```

---

## 🔒 ADIM 5 — SSL Sertifikası (Let's Encrypt)

### Domain DNS ayarı
**ÖNCELİKLE:** Domain sağlayıcından `azap.online` ve `www.azap.online` için
**A Record**'ları sunucu IP'ye yönlendir. Yayılması 5-30 dakika sürebilir.

```bash
# Test:
nslookup azap.online
# IP eşleşiyor mu kontrol et
```

### Certbot kur ve sertifika al:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d azap.online -d www.azap.online --agree-tos --email senin@email.com
```

Certbot nginx config'ini otomatik günceller. Test:
```bash
sudo certbot renew --dry-run
```

### Final nginx config (HTTPS aktif, HTTP redirect):
Certbot otomatik yapar ama kontrol edelim:
```bash
sudo nano /etc/nginx/sites-available/azap
```

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name azap.online www.azap.online;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name azap.online www.azap.online;

    ssl_certificate /etc/letsencrypt/live/azap.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/azap.online/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Güvenlik header'ları (helmet zaten ekliyor ama nginx'te de olsun)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "same-origin" always;

    # AZAP'a yönlendir
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;

        # Body limit (screenshot upload için)
        client_max_body_size 10M;
    }

    # Socket.io websocket için
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Otomatik yenileme (Let's Encrypt 90 gün dayanır):
```bash
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
sudo systemctl status certbot.timer
```

---

## 📁 ADIM 6 — AZAP kodunu sunucuya yükle

### Yöntem A: Git (önerilen, GitHub'a push ettiysen)
```bash
cd ~
git clone https://github.com/KULLANICI_ADI/azap.git
cd azap
```

### Yöntem B: SCP (yerel makineden)
```bash
# YEREL bilgisayarında:
scp -r azap.zip azap@SUNUCU_IP:~/
# Sunucuda:
cd ~ && unzip azap.zip && cd azap
```

### Yöntem C: rsync
```bash
# YEREL:
rsync -avz --exclude node_modules --exclude data ./azap/ azap@SUNUCU_IP:~/azap/
```

---

## ⚙️ ADIM 7 — Bağımlılıkları kur ve .env

```bash
cd ~/azap
npm install
```

### .env dosyası oluştur:
```bash
cp .env.example .env
nano .env
```

Doldur:
```bash
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://azap.online

# İyzico (https://merchant.iyzipay.com'dan al)
IYZICO_API_KEY=YOUR_REAL_API_KEY
IYZICO_SECRET_KEY=YOUR_REAL_SECRET_KEY
IYZICO_BASE_URI=https://api.iyzipay.com
```

### .env güvenliği:
```bash
chmod 600 .env  # Sadece sahibi okuyabilir
```

### data/ dizini oluştur:
```bash
mkdir -p data/screenshots
echo '{}' > data/users.json
echo '[]' > data/reports.json
chmod 600 data/users.json data/reports.json
```

### İlk admin oluştur:
```bash
# Önce normal kullanıcı kaydı yap (siteden kayıt ol)
# Sonra terminal'de:
node make-admin.js KULLANICI_ADIN
```

---

## 🚀 ADIM 8 — PM2 ile başlat

```bash
cd ~/azap
pm2 start server/index.js --name azap

# Loglar
pm2 logs azap

# Otomatik restart için sistem servisi yap
pm2 startup systemd
# Komutu kopyala ve sudo ile çalıştır (PM2 sana söyleyecek)

# Mevcut process listesini kaydet
pm2 save
```

### Test:
```bash
curl http://localhost:3000  # OK mu?
```

Tarayıcıda: `https://azap.online` ✨

---

## 📊 ADIM 9 — Monitoring & maintenance

### PM2 komutları:
```bash
pm2 status              # Çalışıyor mu
pm2 logs azap           # Canlı log
pm2 logs azap --lines 100   # Son 100 satır
pm2 restart azap        # Yeniden başlat
pm2 stop azap           # Durdur
pm2 monit               # Canlı monitor (CPU, RAM)
```

### Disk kullanımı:
```bash
df -h
du -sh ~/azap/data/
```

### Nginx logları:
```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Sistem monitoring:
```bash
htop           # CPU/RAM canlı
free -h        # RAM kullanımı
uptime         # Yük ortalaması
```

### Yedekleme (haftada 1 cron):
```bash
sudo nano /etc/cron.weekly/azap-backup
```

```bash
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/home/azap/backups"
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/azap_$TIMESTAMP.tar.gz" -C /home/azap/azap data/
# 30 günden eski yedekleri sil
find "$BACKUP_DIR" -type f -mtime +30 -delete
```

```bash
sudo chmod +x /etc/cron.weekly/azap-backup
```

---

## 🔄 GÜNCELLEME (kod değişiklikleri)

```bash
cd ~/azap

# Yöntem A: Git
git pull
npm install      # yeni paket varsa
pm2 restart azap

# Yöntem B: rsync (yerel makinenden)
# YEREL: rsync -avz --exclude node_modules --exclude data --exclude .env ./azap/ azap@SUNUCU_IP:~/azap/
# SUNUCU: cd ~/azap && npm install && pm2 restart azap
```

---

## 🚨 SORUN GİDERME

### Site açılmıyor
```bash
pm2 status                            # AZAP çalışıyor mu
sudo systemctl status nginx           # Nginx çalışıyor mu
curl http://localhost:3000            # Backend yanıt veriyor mu
sudo nginx -t                         # Nginx config syntax
sudo journalctl -u nginx --since "10 min ago"  # Nginx hatları
```

### SSL hatası
```bash
sudo certbot certificates             # Sertifika durumu
sudo certbot renew                    # Manuel yenileme
```

### Yüksek CPU/RAM
```bash
pm2 monit                             # Hangi process hangi kaynak
pm2 logs azap --err                   # Error log
# Memory leak şüphesi → restart
pm2 restart azap
```

### 502 Bad Gateway
- Backend (port 3000) çalışmıyor → `pm2 restart azap`
- Backend port'u farklı → nginx config'inde `proxy_pass` kontrol et

### Socket.io bağlanmıyor
- Nginx config'inde `/socket.io/` location bloğu var mı kontrol et
- Browser console'da `Connection failed` mesajı varsa proxy timeout artır

---

## 🎯 KONTROL LİSTESİ (production öncesi)

- [ ] Domain DNS A record'ları doğru
- [ ] HTTPS çalışıyor (https://azap.online ✓)
- [ ] HTTP → HTTPS redirect ✓
- [ ] `.env` dolduruldu (NODE_ENV=production, IYZICO_API_KEY)
- [ ] `data/users.json` chmod 600
- [ ] PM2 startup ile otomatik başlama ayarlı
- [ ] UFW firewall aktif (sadece 22/80/443)
- [ ] SSH password auth kapalı, sadece key
- [ ] fail2ban aktif
- [ ] İlk admin oluşturuldu (`make-admin.js`)
- [ ] Yedekleme cron kuruldu
- [ ] SSL otomatik yenileme test edildi (`certbot renew --dry-run`)
- [ ] Test: kayıt ol, oda kur, oyun oyna, mağazaya git, bahis koy

---

## 📞 İLERİ SEVİYE OPSİYONLAR

### Çoklu Node.js instance (cluster, ileride)
PM2 ile cluster modu açılabilir ama şu an **tek instance** öneriyorum çünkü:
- Game state Map'lerde tutuluyor (memory)
- Bahis/coin race condition önleme sadece tek instance'da güvenli

İleride büyürsen Redis ile session paylaşımı eklenir.

### Otomatik scaling
- Cloudflare CDN (ücretsiz, DDoS koruması + cache)
- Cloudflare Tunnel (sunucu IP'ni gizler)

### Uptime monitoring
- UptimeRobot (ücretsiz, 5 dakikada 1 kontrol)
- Slack/Telegram bildirim entegrasyonu

---

## 💡 NOTLAR

- **Mobil uygulama tarzı kullanım:** Kullanıcılar iOS/Android'de "Ana ekrana ekle" yapabilir, PWA olarak çalışır.
- **WebSocket:** Socket.io otomatik fallback yapar (websocket → polling).
- **CDN:** Public/static dosyalar Cloudflare'in cache'lerine düşer (manifest, favicon, fontlar).
- **Domain'i değiştirmek:** nginx config + certbot tekrar çalıştır.

---

**Sorularınız?** README.md ve SECURITY.md dosyalarına da göz atın.

**Created by Azad Akdağ** ⛧
