# ⛧ AZAP

**Çok oyunculu sosyal dedüksiyon oyunu** — by Azad Akdağ

## Kurulum

```bash
npm install
npm start
```

Sunucu `http://localhost:3000` adresinde başlar.

## v5 Yenilikleri

### 📸 Avatar (Telefon Uyumlu)
- Boyut sınırı yok — büyük telefon fotoğrafları otomatik 128x128 jpeg'e küçültülüyor
- Kalite dinamik: 0.7'den başlar, 200KB altına ininceye kadar düşürülür
- Tüm cihazlardan yüklenebilir

### 🎲 Pick Mode Gizliliği
- Sıra numaraları HİÇ kimseye görünmez (kim 1., kim 5. asla bilinmez)
- Tamamlanan seçimler rastgele sıralanmış halde gösterilir
- "Rastgele" seçen kendi rolünü öğrenir, diğerleri sadece "🎲 Rastgele" yazısı görür
- Şu an sırada olan kişi avatar+isim ile gösterilir (sıra # değil)

### 🏆 Kazanan Vurgusu
- Game over ekranında ayrı "🏆 Kazananlar" kutusu — altın çerçeveli
- Tüm rol listesinde kazananlar altın renkle vurgulanır
- "🏆 KAZANDI" rozeti

### ❤️ MVP Sistemi
- Oyun bitince otomatik MVP oylama fazı (30sn)
- Kendine oy veremezsin
- Anlık oy sayıları görünür
- En çok oy alan oyuncu MVP olur, hesabına +1 puan
- MVP sonuç ekranında oyuncunun fotoğrafı, oy sayısı ve tüm oylar görünür

### 📊 Lobi İstatistikleri
- Her oyuncunun ismi yanında 🏆(galibiyet) ❤️(MVP) sayıları
- Profil ekranında ayrıntılı stats: Oyunlar, Kazanılan, Kaybedilen, MVP

### 🎵 Müzik
- Login sonrası otomatik **Waxy - Darlana** çalmaya başlar
- Sadece Auth/Entry/Lobby ekranlarında çalar — oyun başlayınca durur
- 🎵/🔇 butonu ile her zaman aç/kapat
- Sağ alt köşede mini player

### 🤡 Deli Gizliliği (Düzeltildi)
- Geçmiş aksiyonlarda DELİ etiketi YOK — kendi deli olduğunu bilemez
- Game over ekranında DELİ rozeti GİZLİ — sadece izleyici görür
- Sadece **izleyici modu** ekranında oyuncuların yanında DELİ etiketi gösterilir

## Roller (18 + Deli)

### 🌅 Masumlar (10)
Doktor, Polis, Savcı, Gözcü, Muhtar, Gazeteci, Psikolog, Gazi, Dedikocucu, Ajan
> Doktor, Muhtar HARİÇ tüm masumlar hain de olabilir.

### 🧛 Kesin Hainler (4)
Suikastçı, Hipnotizmacı, Bombacı, Gölge

### ⚖️ Tarafsızlar (4)
Dodo, Seri Katil, Cellat, Yamyam

### 🤡 Deli
Bir masum rol gibi görünür, sahte sonuç alır. Sistem otomatik atar — oyuncular seçemez.

## Akış

1. Auth → 2. Lobi (ayarlar) → 3. Rol Atama (otomatik veya seçim) → 4. Rol Gösterimi (20s) → 5. Başkan Oylaması (25s) → 6. Gece (20s) → 7. Sabah Raporu (10s) → 8. Tartışma (3dk) → 9. Oylama (30s) → ... → Oyun Sonu → **MVP Oylama (30s)** → MVP Sonucu → Lobiye dön

## Teknik

- **Backend**: Node.js + Express + Socket.io + bcrypt
- **Frontend**: Vanilla HTML/CSS/JS + YouTube IFrame API
- **Hesaplar**: JSON dosya tabanlı (data/users.json)
- **Avatar**: Otomatik 128x128 JPEG, 200KB altı garantili
- **Müzik**: YouTube embed (Waxy - Darlana, video ID: 73t-wQGijqU)

Port değiştirmek: `PORT=8080 npm start`

---

**⛧ Created by Azad Akdağ ⛧**