# ⛧ AZAP

**Sosyal dedüksiyon oyunu** — *Created by Azat Akdağ*

Mafya / Town of Salem benzeri çok oyunculu bir sosyal dedüksiyon oyunu. 4-20 kişi arasında, tarayıcı üzerinden gerçek zamanlı oynanır. Hain takımı masumları geceleyin teker teker öldürmeye çalışır; masumlar gündüz tartışıp oylama yaparak hainleri elemeye çalışır. Bağımsız tarafsız roller (Seri Katil, Dodo, Cellat, Yamyam) kendi başına kazanma koşullarına sahiptir.

## 🎮 Oyuna Nasıl Başlanır

### Hızlı Başlangıç
```bash
npm install
npm start
```

Sunucu `http://localhost:3000` adresinde açılır. Aynı ağdaki herkes IP üzerinden bağlanabilir.

### İlk Oyun
1. **Hesap aç** — kullanıcı adı + şifre. Kayıtlar `data/users.json`'a yazılır.
2. **Oda oluştur** — kod oluşturulur, arkadaşlarına kodu paylaş.
3. **Lobide bekle** — minimum 4 oyuncu lazım. Lider oyun ayarlarını yapar (rol açma/kapama, hain sayısı, kill modu).
4. **Oyunu başlat** — roller dağıtılır, oyun başlar. Her ekranda timer var, süre dolarsa otomatik geçilir.

### Genel Akış
```
Lobi → Rol Atama → Rol Gösterimi → Başkan Oylama
  → Gece (aksiyonlar) → Sabah Raporu → Tartışma → Oylama → Sonuç
  → (oyun bitmediyse) Gece'ye dön
  → Oyun Sonu → MVP Oylama → Yeni Oyun
```

## 📜 Roller (22 farklı rol)

Oyun içinde 📖 butonundan tüm rolleri detaylıca okuyabilirsin. Sol üstte her zaman kendi rolün gözükür, tıklayınca ayrıntısı açılır.

### 🌅 Masumlar (13)
Doktor, Polis, Savcı, Muhtar, Gazeteci, Psikolog, Gazi, Dedikocucu, Ajan, Şerif, Kurban, Çilingir, Takipçi.

Hedefleri: Tüm hainleri ve seri katili elemek.

### 🧛 Hainler (4)
Suikastçı, Hipnotizmacı, Bombacı, Gölge.

Geceleyin birlikte konuşup ortak kararla bir kişi öldürebilirler (Bombacı hariç — o kendi yöntemiyle çalışır). Hedefleri: Masumlardan sayıca üstün olmak.

### ⚖️ Tarafsızlar (4)
Dodo, Seri Katil, Cellat, Yamyam.

Her birinin kendi kazanma koşulu var. Dodo kendini astırırsa, Seri Katil son ikiye kalırsa, Cellat hedefini astırtırsa kazanır. Yamyam masumlarla kazanır ama gece ölenlerin yeteneklerini öğrenir.

### 🤡 Deli (sistem rolü)
Sistem rastgele bir masuma "deli" işaretini gizlice koyar. Deli oyuncu kendi rolüne (örn. Doktor) inanır ama tüm aksiyonları sahte sonuç verir. Deli olduğunu kendisi bilemez — sadece Psikolog tespit edebilir.

## 🎯 Önemli Mekanikler

**Pick Mode**: Lider isterse rol seçim modunu açar — herkes sırayla gelen 3 rol seçeneğinden birini seçer (veya rastgeleyi seçer). Sıra numaraları kimseye gözükmez, gizliliği korur.

**Hain Kill Modu**:
- *Tek* — hainler ortak oy verir, en çok oy alan ölür.
- *Çoklu* — her hain ayrı bir kişiyi öldürebilir.

**Skip oy**: Oylamada "Kimseye oy verme" butonu var. Skip oyları da sayılır ve gözükür.

**Suikastçı**: Gündüz birinin rolünü tahmin eder. Doğruysa anında öldürür, yanlışsa kendi ölür. Tur başına 1 hak.

**Bombacı**: Öldürme yetkisi yok. Bomba koyma ve patlatma iki ayrı buton. Üst üste birden çok kişiye bomba koyup tek seferde patlatabilir.

**Seri Katil**: Engellenemez (Polis bile çare değil). Gazeteci/Takipçi onu izlerse hep "rol kullanmadı" görür.

**MVP Oylama**: Oyun bitince herkes (ölü ve canlı) en iyi oyuncuya oy verir. MVP'nin hesabına +1 ❤️ puan.

## 🛠 Teknik Yapı

### Klasör Yapısı
```
azap/
├── server/
│   ├── index.js           — Express + Socket.io sunucu, faz/timer yönetimi
│   ├── gameEngine.js      — Tüm oyun mantığı (GameEngine sınıfı)
│   ├── gameConstants.js   — Roller, takımlar, fazlar, default config
│   └── accounts.js        — Hesap kayıt/giriş, bcrypt şifreleme
├── public/
│   └── index.html         — Tüm frontend (HTML+CSS+JS tek dosya)
├── data/
│   └── users.json         — Kullanıcı veritabanı (JSON)
└── package.json
```

### Backend
- **Express** + **Socket.io** — gerçek zamanlı iletişim
- **bcryptjs** — şifre hashlemesi
- Tek `GameEngine` sınıfı tüm oda durumunu yönetir
- Her odanın kendine ait state'i var (multi-room support)
- Timer'lar `setTimeout` ile yönetiliyor, herkes oy verince erken atlanır

### Frontend
- Vanilla HTML/CSS/JS, framework yok
- Tek `index.html` dosyası, tüm UI ekranları içeride
- `Q(id)` ile element seçimi, vanilla DOM
- YouTube IFrame API müzik için (Waxy - Darlana)
- Phase-tracking ile gereksiz re-render'lar önleniyor

### Socket Olayları (Önemli)
| Event | Yön | Anlam |
|-------|-----|-------|
| `state` | server→client | Tüm oyun state'i (public) |
| `priv` | server→client | Oyuncuya özel state (rol, raporlar, history) |
| `spec` | server→client | İzleyici state'i (tüm rolleri görür) |
| `gameOver` | server→client | Oyun bitti — kazananlar |
| `bombExplosion` | server→broadcast | Patlama efekti |
| `suikastPublic` | server→broadcast | "X gündüz öldürüldü" anonim |
| `suikastPrivate` | server→suikastçı | Suikast detay sonucu |
| `nightAction` | client→server | Gece aksiyonu gönder |
| `vote` / `presidentVote` | client→server | Oy ver |

### Faz Akışı (PHASES)
`lobby` → `role_selection` → `role_reveal` → `president_vote` → `night` → `morning_report` → `day_discussion` → `voting` → `vote_result` → (`night` veya `mvp_vote`) → `mvp_result` → `post_game` → `lobby`

### Önemli Sınıf İçi Koleksiyonlar
- `players: Map<socketId, Player>` — odadaki oyuncular
- `nightActions: Map<pid, action>` — bu gece kim ne yaptı
- `bombs: Map<targetId, {placedRound, ownerId}>` — yerleştirilmiş bombalar
- `voteTally: Map<targetId, count>` — gündüz oy sayımı
- `hainKillVotesLive: Map<hainId, targetId>` — canlı hain kill oyları

## ⚙ Yapılandırma

`server/gameConstants.js` içindeki `DEFAULT_CONFIG`:
- `MIN_PLAYERS: 4` / `MAX_PLAYERS: 20`
- `NIGHT_DURATION: 20s`
- `DISCUSSION_DURATION: 20s` (oylama 20s sonra açılır)
- `VOTING_DURATION: 90s`
- `ROLE_SELECTION_DURATION: 20s`
- `MVP_VOTE_DURATION: 30s`

Lider lobide süre ayarlarını değiştirebilir.

Port değiştirmek: `PORT=8080 npm start`



**Bir kullanıcıyı admin yapmak**:

```bash
# Önce kullanıcı kayıt olsun (oyuna girip hesap açsın), sonra:
node make-admin.js <kullanıcı_adı>
```

Örnek:
```bash
node make-admin.js azad
```

Kullanıcı tekrar giriş yaptığında 👁️ butonu görünür hale gelir. Admin yetkisi `data/users.json` içinde `isAdmin: true` olarak saklanır — manuel olarak da düzenlenebilir.

## 🐛 Geliştirme Notları

**Yeni rol eklemek için**:
1. `server/gameConstants.js` → `ROLES` objesine ekle
2. `server/gameEngine.js` → `resolveNight()` içine aksiyon mantığını ekle
3. `public/index.html` → `RDEF` objesine ekle (rehber/modal için)
4. Gerekirse `renderTL()` ve `conf()` içine UI mantığı ekle

**State debug**: Sunucu konsolunda her oyun adımı loglanıyor (`g.log()`).

---

⛧ AZAP — sosyal dedüksiyon, ölüler, hayaletler ve ihanetler.
