require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const GameEngine = require('./gameEngine');
const Accounts = require('./accounts');
const Reports = require('./reports');
const { PHASES, TEAMS } = require('./gameConstants');
const registerLegalRoutes = require('./legalPages');

// Eski hali: const ADMIN_SECRET_KEY = 'azap-admin-2026-gizli-anahtar-degistir';
// Yeni hali:
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || '4794akd.';

// ── TURN sunucusu config (WebRTC relay — uzak bağlantılar için) ──
const TURN_CONFIG = [];
if (process.env.TURN_URL) {
  TURN_CONFIG.push(
    { urls: process.env.TURN_URL, username: process.env.TURN_USER || 'azap', credential: process.env.TURN_PASS || 'azap2026' }
  );
  if (process.env.TURN_URL_TCP) {
    TURN_CONFIG.push(
      { urls: process.env.TURN_URL_TCP, username: process.env.TURN_USER || 'azap', credential: process.env.TURN_PASS || 'azap2026' }
    );
  }
  console.log('[TURN] Yapılandırıldı:', TURN_CONFIG.map(t => t.urls));
} else {
  console.warn('[TURN] TURN_URL env yok — uzak bağlantılar çalışmayabilir. .env dosyasına TURN_URL, TURN_USER, TURN_PASS ekleyin.');
}

// ── GÜVENLİK: opsiyonel middleware'ler (npm install helmet express-rate-limit) ──
let helmet = null, rateLimit = null;
try { helmet = require('helmet'); } catch(e){ console.warn('[GÜVENLİK] helmet yok — npm install helmet öneriliyor'); }
try { rateLimit = require('express-rate-limit'); } catch(e){ console.warn('[GÜVENLİK] express-rate-limit yok — npm install express-rate-limit öneriliyor'); }

const app = express();
// Reverse proxy (nginx) arkasındaysa: client IP'yi doğru almak için
app.set('trust proxy', 1);
app.disable('x-powered-by'); // Express imzasını gizle

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ["https://azap.online", "http://localhost:3000", "https://www.azap.online", "http://127.0.0.1:3000", "http://localhost:5500", "http://127.0.0.1:5500" ] },
  maxHttpBufferSize: 8e6,
  pingTimeout: 20000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// ── HELMET (güvenlik header'ları) ──
if (helmet) {
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );
}

// ── RATE LIMITING ──
const apiLimiter = rateLimit ? rateLimit({
  windowMs: 60 * 1000, // 1 dakika
  max: 60,             // dakikada max 60 istek
  message: { ok: false, error: 'Çok fazla istek, lütfen bekleyin.' },
  standardHeaders: true,
  legacyHeaders: false
}) : (req, res, next) => next();

const paymentLimiter = rateLimit ? rateLimit({
  windowMs: 5 * 60 * 1000, // 5 dakika
  max: 10,                  // 5 dakikada max 10 ödeme isteği
  message: { ok: false, error: 'Ödeme istek limitine ulaştın, biraz bekle.' }
}) : (req, res, next) => next();

const adminLimiter = rateLimit ? rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { ok: false, error: 'Admin istek limiti.' }
}) : (req, res, next) => next();

// ── GÜVENLİK: Hassas dosya/dizin erişimini engelle (.env, .git, node_modules vb.) ──
const BLOCKED_PATHS = [
  /^\/\.[^/]/i,                // Tüm dotfile'lar: .env, .git, .htaccess, .DS_Store vb.
  /\/\.\./,                    // Path traversal: ../ içeren her şey
  /^\/(node_modules|server|\.git)(\/|$)/i,  // Hassas dizinler
  /^\/data\/(?!avatars\/)/i,               // data dizini (avatars hariç)
  /\.(env|key|pem|crt|p12|pfx|sql|db|sqlite|log|bak|backup|old|swp|swo)$/i, // Hassas uzantılar
  /^\/(package(-lock)?\.json|yarn\.lock|composer\.(json|lock)|Dockerfile|docker-compose\.ya?ml|\.gitignore|\.dockerignore|README\.md|CHANGELOG.*|LICENSE.*)$/i
];
app.use((req, res, next) => {
  const urlPath = req.path;
  for (const re of BLOCKED_PATHS) {
    if (re.test(urlPath)) {
      return res.status(404).send('Not Found');
    }
  }
  next();
});

// Avatar dosyalarını serve et (data/avatars → /avatars/)
app.use('/avatars', express.static(path.join(__dirname, '..', 'data', 'avatars'), {
  maxAge: '1h',
  dotfiles: 'deny'
}));

app.use(express.static(path.join(__dirname, '..', 'public'), {
  dotfiles: 'deny',
  setHeaders: (res, filePath) => {
    if (/\.(css|js)$/i.test(filePath)) {
      // CSS/JS sık güncellenir — tarayıcı her seferinde sunucuyu kontrol etsin
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.(html)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      // Görseller, fontlar vs. — 24 saat cache
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));
app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three'), {
  dotfiles: 'deny',
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=86400')
}));
app.use(express.json({ limit: '1mb' }));

// ── ÖDEME PAKETLERİ KATALOĞU ──
const PAYMENT_PACKAGES = {
  // Altın paketleri (TL → coin)
  'gold_100': { type: 'coins', amount: 100, price: 19.90, currency: 'TRY', label: '100 Altın', emoji: '💰' },
  'gold_500': { type: 'coins', amount: 600, price: 79.90, currency: 'TRY', label: '500 + 100 Bonus Altın', emoji: '💰', bonus: 100 },
  'gold_1500': { type: 'coins', amount: 2000, price: 199.90, currency: 'TRY', label: '1500 + 500 Bonus Altın', emoji: '💎', bonus: 500 },
  'gold_5000': { type: 'coins', amount: 7500, price: 499.90, currency: 'TRY', label: '5000 + 2500 Bonus Altın', emoji: '💎', bonus: 2500 },
  // Premium üyelik
  'premium_1m': { type: 'premium', days: 30, price: 49.90, currency: 'TRY', label: 'AZAP Premium - 1 Ay', emoji: '👑' },
  'premium_3m': { type: 'premium', days: 90, price: 129.90, currency: 'TRY', label: 'AZAP Premium - 3 Ay', emoji: '👑', bonus: 'İlk ay ücretsiz' },
  'premium_12m': { type: 'premium', days: 365, price: 449.90, currency: 'TRY', label: 'AZAP Premium - 1 Yıl', emoji: '👑', bonus: '%24 indirim' }
};

// Bağış (donate) önerilen miktarlar — kullanıcı kendi miktarını da girebilir
const DONATION_PRESETS = [10, 25, 50, 100, 250, 500];

// ── KOZMETİK EŞYA KATALOĞU (coin ile satın alınır) ──
const COSMETIC_CATALOG = {
  // Kartlıklar (isim kartı çerçeveleri)
  frame_gold:   { cat:'frame', name:'Altın Çerçeve',  emoji:'🖼️', price:500,  rarity:'rare',      desc:'İsminin etrafında parlak altın çerçeve.',      preview:{border:'2px solid #ffd700',shadow:'0 0 12px rgba(255,215,0,.5)',bg:'linear-gradient(135deg,rgba(255,215,0,.12),rgba(184,134,11,.08))',anim:'shimmer'} },
  frame_rgb:    { cat:'frame', name:'RGB Çerçeve',    emoji:'🎮', price:800,  rarity:'epic',      desc:'Renk değiştiren neon çerçeve.',                preview:{border:'2px solid #ff0000',shadow:'0 0 10px rgba(255,0,0,.4)',bg:'linear-gradient(135deg,rgba(255,0,0,.08),rgba(0,0,255,.08))',anim:'rgbShift'} },
  frame_fire:   { cat:'frame', name:'Alev Çerçeve',   emoji:'🔥', price:1500, rarity:'legendary', desc:'Gerçek ateş efektiyle yanan çerçeve.',          preview:{border:'2px solid #ff6600',shadow:'0 0 20px rgba(255,100,0,.6), inset 0 0 10px rgba(255,150,0,.3)',bg:'linear-gradient(180deg,rgba(255,100,0,.2),rgba(255,50,0,.1))',anim:'realFire'} },
  frame_lightning:{ cat:'frame', name:'Yıldırım Çerçeve',emoji:'⚡', price:900, rarity:'epic',      desc:'Gök gürültüsü gibi ani flaşlar çakan çerçeve.',  preview:{border:'2px solid #002288',shadow:'0 0 5px #0055ff, inset 0 0 5px #0055ff',bg:'linear-gradient(135deg,rgba(0,85,255,.08),rgba(0,34,136,.1))',anim:'lightningStrike'} },
  frame_ocean:  { cat:'frame', name:'Okyanus Çerçeve', emoji:'🌊', price:850,  rarity:'epic',      desc:'Dalga efektli mavi-cyan gradient çerçeve.',     preview:{border:'2px solid #0072ff',shadow:'0 0 12px rgba(0,114,255,.4)',bg:'linear-gradient(270deg,#00c6ff33,#0072ff33,#00c6ff33)',bgSize:'400% 400%',anim:'oceanWave'} },
  frame_void:   { cat:'frame', name:'Hiçlik Çerçeve',  emoji:'🕳️', price:1200, rarity:'epic',      desc:'Kara deliğ gibi içe çöken lanetli çerçeve.',    preview:{border:'2px solid #4b0082',shadow:'0 0 5px #4b0082, inset 0 0 10px #4b0082',bg:'linear-gradient(135deg,rgba(75,0,130,.15),rgba(0,0,0,.2))',anim:'voidCollapse',animDur:'5s',animEase:'ease-in-out'} },
  frame_glitch: { cat:'frame', name:'Neon Buz Çerçeve', emoji:'💻', price:1500, rarity:'legendary', desc:'Siber mavi-beyaz neon ışıltısı, sarsılma yok.', preview:{border:'2px solid #00ffff',shadow:'0 0 10px rgba(0,255,255,.5)',bg:'linear-gradient(135deg,rgba(0,255,255,.06),rgba(0,200,255,.04))',anim:'cyberGlitch',animDur:'2s',animEase:'ease-in-out'} },
  frame_nature: { cat:'frame', name:'Doğa Çerçeve',  emoji:'🌿', price:700,  rarity:'rare',      desc:'Yeşil enerjiyle nefes alan organik çerçeve.', preview:{border:'2px solid #228b22',shadow:'0 0 10px #228b22',bg:'linear-gradient(135deg,rgba(34,139,34,.1),rgba(50,205,50,.05))',anim:'natureBreath'} },
  frame_laser:  { cat:'frame', name:'Lazer Çerçeve',  emoji:'🔵', price:1200, rarity:'epic',      desc:'İnce siber çizgi çerçeve + kuyruklu yıldız gibi dönen ışık süzmesi.', preview:{border:'1.5px solid rgba(0,255,255,.3)',shadow:'0 0 6px rgba(0,255,255,.1)',bg:'transparent',cls:'fr-laser'} },
  frame_aurora: { cat:'frame', name:'Aurora Nabız',   emoji:'🌌', price:900,  rarity:'epic',      desc:'Derin mor mistik enerji, yavaş nefes alan glow.', preview:{border:'2px solid #4a0082',shadow:'0 0 10px rgba(75,0,130,.4)',bg:'linear-gradient(135deg,rgba(75,0,130,.12),rgba(50,0,90,.08))',anim:'auroraPulse',animDur:'4s',animEase:'ease-in-out'} },
  frame_matrix: { cat:'frame', name:'Matrix Çerçeve', emoji:'🖥️', price:1100, rarity:'epic',      desc:'Kenarlardan akan dijital kod akışı.', preview:{border:'1px solid rgba(57,255,20,.45)',shadow:'0 0 10px rgba(57,255,20,.3)',bg:'linear-gradient(135deg,rgba(0,25,0,.3),rgba(0,18,0,.2))',anim:'matrixGlow',animDur:'2.5s',cls:'fr-matrix'} },
  frame_ticker: { cat:'frame', name:'Ticker Çerçeve', emoji:'📡', price:1300, rarity:'epic',      desc:'Etrafında dönen canlı sistem mesajları.', preview:{border:'1px solid rgba(100,255,218,.45)',shadow:'0 0 8px rgba(100,255,218,.25)',bg:'linear-gradient(135deg,rgba(0,20,20,.25),transparent)',anim:'tickerPulse',animDur:'3s',cls:'fr-ticker'} },
  frame_steel:  { cat:'frame', name:'Kara Şövalye',   emoji:'⚔️', price:2200, rarity:'legendary', desc:'Karartılmış şövalye çeliği, nadiren parlayan metalik flaş.', preview:{border:'2px solid #3a3a48',shadow:'0 0 6px rgba(80,80,92,.4)',bg:'linear-gradient(135deg,rgba(30,30,42,.4),rgba(20,20,32,.3))',anim:'steelFlash',animDur:'5s',animEase:'ease-in-out'} },
  frame_templar:{ cat:'frame', name:'Kraliyet Tapınakçısı',emoji:'🛡️', price:2500, rarity:'legendary', desc:'Fırçalanmış platin + altın detaylar, dönen ışık süzmesi.', preview:{border:'2px solid #c8c8c8',shadow:'0 0 8px rgba(192,192,192,.28)',bg:'linear-gradient(135deg,rgba(192,192,192,.08),rgba(255,215,0,.05))',anim:'templarGlow',animDur:'3s',animEase:'ease-in-out'} },
  frame_emperor:{ cat:'frame', name:'İmparatorluk Çeliği',emoji:'💎', price:3000, rarity:'legendary', desc:'Koyu çelik gövde + köşelerde parıldayan yakut taşları.', preview:{border:'2px solid #3a3a4a',shadow:'0 0 5px rgba(70,70,82,.5),0 0 12px rgba(180,0,0,.38)',bg:'linear-gradient(135deg,rgba(25,25,38,.4),rgba(38,10,18,.3))',anim:'emperorRuby',animDur:'3.5s',animEase:'ease-in-out'} },
  frame_crusade:{ cat:'frame', name:'Altın Haçlı',    emoji:'🏅', price:2800, rarity:'legendary', desc:'Antik altın kaplama zırh + metalik yansıma şeridi.', preview:{border:'2px solid #8b6914',shadow:'0 0 12px rgba(139,105,20,.55)',bg:'linear-gradient(135deg,rgba(139,105,20,.14),rgba(100,70,0,.1))',anim:'crusadeShine',animDur:'4.5s',animEase:'linear'} },
  // ── ÖZEL ÇERÇEVELER (satın alınamaz, otomatik tanımlanır) ──
  frame_donor:  { cat:'frame', name:'Destekçi Çerçeve', emoji:'💝', price:0, rarity:'legendary', exclusive:true, desc:'AZAP destekçilerine özel zarif çerçeve, 💝 ile sarılı.', preview:{border:'2px solid #e91e63',shadow:'0 0 10px rgba(233,30,99,.3)',bg:'linear-gradient(135deg,rgba(233,30,99,.08),rgba(156,39,176,.06))',anim:'donorCalm',animDur:'4s',animEase:'ease-in-out',cls:'fr-donor-ring'} },
  frame_premium:{ cat:'frame', name:'Premium Çerçeve',  emoji:'👑', price:0, rarity:'legendary', exclusive:true, desc:'Premium üyelere özel taç çerçevesi + dönen PREMIUM yazısı.', preview:{border:'2px solid #bb8fce',shadow:'0 0 18px rgba(187,143,206,.5),0 0 40px rgba(94,58,135,.2)',bg:'linear-gradient(135deg,rgba(187,143,206,.15),rgba(94,58,135,.1))',anim:'crownGlow',cls:'fr-premium-txt'} },
  // ── Petler ──
  // 🐾 Evcil & Çiftlik (subcat: farm, anim: petFarmIdle)
  pet_cat:        { cat:'pet', subcat:'farm', name:'Kedi',            emoji:'🐱', price:800,  rarity:'rare',      desc:'Yanında oturan, ara sıra kıpırdayan kedi.',       preview:{sprite:'🐱',anim:'catIdle'} },
  pet_cat2:       { cat:'pet', subcat:'farm', name:'Tekir',           emoji:'🐈', price:700,  rarity:'rare',      desc:'Uysal tekir kedi, sakin salınım.',                 preview:{sprite:'🐈',anim:'petFarmIdle'} },
  pet_cat3:       { cat:'pet', subcat:'farm', name:'Siyah Kedi',      emoji:'🐈‍⬛', price:900,  rarity:'epic',      desc:'Gizemli siyah kedi, uğur mu getiriri, uğursuzluk mu?', preview:{sprite:'🐈‍⬛',anim:'petFarmIdle'} },
  pet_dog:        { cat:'pet', subcat:'farm', name:'Köpek',           emoji:'🐕', price:1200, rarity:'epic',      desc:'Mutlu sallanan kuyruklu köpek.',                   preview:{sprite:'🐕',anim:'dogHappy'} },
  pet_dog2:       { cat:'pet', subcat:'farm', name:'Shiba',           emoji:'🐶', price:1000, rarity:'epic',      desc:'Doge! Çok wow, çok komik.',                        preview:{sprite:'🐶',anim:'petFarmIdle'} },
  pet_guidedoc:   { cat:'pet', subcat:'farm', name:'Rehber Köpek',    emoji:'🦮', price:900,  rarity:'rare',      desc:'Sadık ve güvenilir rehber köpek.',                 preview:{sprite:'🦮',anim:'petFarmIdle'} },
  pet_poodle:     { cat:'pet', subcat:'farm', name:'Kaniş',           emoji:'🐩', price:900,  rarity:'rare',      desc:'Şımarık ama sevimli kaniş.',                       preview:{sprite:'🐩',anim:'petFarmIdle'} },
  pet_horse:      { cat:'pet', subcat:'farm', name:'At',              emoji:'🐴', price:800,  rarity:'rare',      desc:'Sakin duran at.',                                  preview:{sprite:'🐴',anim:'petFarmIdle'} },
  pet_racehorse:  { cat:'pet', subcat:'farm', name:'Yarış Atı',       emoji:'🐎', price:1100, rarity:'epic',      desc:'Hızlı ve zarif yarış atı.',                        preview:{sprite:'🐎',anim:'petFarmIdle'} },
  pet_donkey:     { cat:'pet', subcat:'farm', name:'Eşek',            emoji:'🫏', price:600,  rarity:'rare',      desc:'Inatçı ama dürüst eşek.',                          preview:{sprite:'🫏',anim:'petFarmIdle'} },
  pet_cow:        { cat:'pet', subcat:'farm', name:'İnek',            emoji:'🐮', price:600,  rarity:'rare',      desc:'Huzurlu, mışıl mışıl inekçik.',                    preview:{sprite:'🐮',anim:'petFarmIdle'} },
  pet_pig:        { cat:'pet', subcat:'farm', name:'Domuz',           emoji:'🐷', price:500,  rarity:'common',    desc:'Mutlu ve pembe domuz yavrusu.',                    preview:{sprite:'🐷',anim:'petFarmIdle'} },
  pet_sheep:      { cat:'pet', subcat:'farm', name:'Koyun',           emoji:'🐑', price:500,  rarity:'common',    desc:'Yumuşacık yünlü koyun.',                           preview:{sprite:'🐑',anim:'petFarmIdle'} },
  pet_goat:       { cat:'pet', subcat:'farm', name:'Keçi',            emoji:'🐐', price:500,  rarity:'common',    desc:'Meraklı ve şımarık keçi.',                         preview:{sprite:'🐐',anim:'petFarmIdle'} },
  pet_rabbit:     { cat:'pet', subcat:'farm', name:'Tavşan',          emoji:'🐇', price:700,  rarity:'rare',      desc:'Hızlı ve tatlı beyaz tavşan.',                     preview:{sprite:'🐇',anim:'petFarmIdle'} },
  pet_bunny:      { cat:'pet', subcat:'farm', name:'Sevimli Tavşan',  emoji:'🐰', price:700,  rarity:'rare',      desc:'Pembe kulaklı minik tavşan.',                      preview:{sprite:'🐰',anim:'petFarmIdle'} },
  pet_rooster:    { cat:'pet', subcat:'farm', name:'Horoz',           emoji:'🐓', price:500,  rarity:'common',    desc:'Şafakta ötecek ama şimdi sakin.',                  preview:{sprite:'🐓',anim:'petFarmIdle'} },
  // 🦁 Vahşi & Büyük (subcat: wild, anim: petWildSway)
  pet_lion:       { cat:'pet', subcat:'wild', name:'Aslan',           emoji:'🦁', price:1200, rarity:'epic',      desc:'Savannanın asil hükümdarı.',                       preview:{sprite:'🦁',anim:'petWildSway'} },
  pet_tiger:      { cat:'pet', subcat:'wild', name:'Kaplan',          emoji:'🐯', price:1200, rarity:'epic',      desc:'Çizgili ve güçlü Bengal kaplanı.',                 preview:{sprite:'🐯',anim:'petWildSway'} },
  pet_leopard:    { cat:'pet', subcat:'wild', name:'Leopar',          emoji:'🐆', price:1100, rarity:'epic',      desc:'Benekli ve süper hızlı leopar.',                   preview:{sprite:'🐆',anim:'petWildSway'} },
  pet_bear:       { cat:'pet', subcat:'wild', name:'Ayı',             emoji:'🐻', price:1000, rarity:'epic',      desc:'Büyük ve güçlü ama sevimli ayı.',                  preview:{sprite:'🐻',anim:'petWildSway'} },
  pet_koala:      { cat:'pet', subcat:'wild', name:'Koala',           emoji:'🐨', price:900,  rarity:'rare',      desc:'Ağaçta uyuklayan tatlı koala.',                    preview:{sprite:'🐨',anim:'petWildSway'} },
  pet_elephant:   { cat:'pet', subcat:'wild', name:'Fil',             emoji:'🐘', price:1100, rarity:'epic',      desc:'Hafızası güçlü asil fil.',                         preview:{sprite:'🐘',anim:'petWildSway'} },
  pet_giraffe:    { cat:'pet', subcat:'wild', name:'Zürafa',          emoji:'🦒', price:900,  rarity:'rare',      desc:'Uzun boyunlu zarif zürafa.',                       preview:{sprite:'🦒',anim:'petWildSway'} },
  pet_camel:      { cat:'pet', subcat:'wild', name:'Deve',            emoji:'🐪', price:800,  rarity:'rare',      desc:'Çöl kaşifi tek hörgüçlü deve.',                    preview:{sprite:'🐪',anim:'petWildSway'} },
  pet_wolf:       { cat:'pet', subcat:'wild', name:'Kurt',            emoji:'🐺', price:1000, rarity:'epic',      desc:'Ormanda uluyan gri kurt.',                         preview:{sprite:'🐺',anim:'petWildSway'} },
  pet_fox:        { cat:'pet', subcat:'wild', name:'Tilki',           emoji:'🦊', price:1000, rarity:'epic',      desc:'Kurnaz ve zarif orman tilkisi.',                   preview:{sprite:'🦊',anim:'petWildSway'} },
  pet_raccoon:    { cat:'pet', subcat:'wild', name:'Rakun',           emoji:'🦝', price:800,  rarity:'rare',      desc:'Meraklı ve elleri çabuk rakun.',                   preview:{sprite:'🦝',anim:'petWildSway'} },
  pet_monkey:     { cat:'pet', subcat:'wild', name:'Maymun',          emoji:'🐵', price:900,  rarity:'rare',      desc:'Şakacı ve neşeli maymun.',                         preview:{sprite:'🐵',anim:'petWildSway'} },
  pet_gorilla:    { cat:'pet', subcat:'wild', name:'Goril',           emoji:'🦍', price:1300, rarity:'legendary', desc:'Güçlü ve etkileyici goril.',                       preview:{sprite:'🦍',anim:'petWildSway'} },
  pet_mouse:      { cat:'pet', subcat:'wild', name:'Fare',            emoji:'🐭', price:500,  rarity:'common',    desc:'Küçük ama cesur fare.',                            preview:{sprite:'🐭',anim:'petWildSway'} },
  pet_hedgehog:   { cat:'pet', subcat:'wild', name:'Kirpi',           emoji:'🦔', price:700,  rarity:'rare',      desc:'Dikenli ama içi yumuşak kirpi.',                   preview:{sprite:'🦔',anim:'petWildSway'} },
  // 🦅 Kuşlar (subcat: bird, anim: petBirdFloat)
  pet_eagle:      { cat:'pet', subcat:'bird', name:'Kartal',          emoji:'🦅', price:1200, rarity:'epic',      desc:'Gökyüzünün hükümdarı kartal.',                     preview:{sprite:'🦅',anim:'petBirdFloat'} },
  pet_owl:        { cat:'pet', subcat:'bird', name:'Baykuş',          emoji:'🦉', price:1100, rarity:'epic',      desc:'Bilge ve gizemli baykuş.',                         preview:{sprite:'🦉',anim:'petBirdFloat'} },
  pet_dove:       { cat:'pet', subcat:'bird', name:'Güvercin',        emoji:'🕊️', price:800,  rarity:'rare',      desc:'Barışın sembolü beyaz güvercin.',                  preview:{sprite:'🕊️',anim:'petBirdFloat'} },
  pet_parrot:     { cat:'pet', subcat:'bird', name:'Papağan',         emoji:'🦜', price:1000, rarity:'epic',      desc:'Renkli ve konuşkan papağan.',                      preview:{sprite:'🦜',anim:'petBirdFloat'} },
  pet_duck:       { cat:'pet', subcat:'bird', name:'Ördek',           emoji:'🦆', price:600,  rarity:'rare',      desc:'Sevimli vak vak ördek.',                           preview:{sprite:'🦆',anim:'petBirdFloat'} },
  pet_swan:       { cat:'pet', subcat:'bird', name:'Kuğu',            emoji:'🦢', price:900,  rarity:'rare',      desc:'Zarif ve asil beyaz kuğu.',                        preview:{sprite:'🦢',anim:'petBirdFloat'} },
  pet_penguin:    { cat:'pet', subcat:'bird', name:'Penguen',         emoji:'🐧', price:900,  rarity:'rare',      desc:'Tüvit tüvit yürüyen antarktika pengueni.',         preview:{sprite:'🐧',anim:'petBirdFloat'} },
  pet_flamingo:   { cat:'pet', subcat:'bird', name:'Flamingo',        emoji:'🦩', price:1000, rarity:'epic',      desc:'Pembe zarif flamingo.',                            preview:{sprite:'🦩',anim:'petBirdFloat'} },
  // 🐬 Deniz & Su (subcat: sea, anim: petSeaFloat)
  pet_whale:      { cat:'pet', subcat:'sea',  name:'Balina',          emoji:'🐳', price:1500, rarity:'legendary', desc:'Okyanusun devasa ama nazik balinası.',              preview:{sprite:'🐳',anim:'petSeaFloat'} },
  pet_dolphin:    { cat:'pet', subcat:'sea',  name:'Yunus',           emoji:'🐬', price:1200, rarity:'epic',      desc:'Neşeli ve zeki yunus.',                            preview:{sprite:'🐬',anim:'petSeaFloat'} },
  pet_shark:      { cat:'pet', subcat:'sea',  name:'Köpek Balığı',    emoji:'🦈', price:1300, rarity:'epic',      desc:'Suların tehlikeli hükümdarı.',                     preview:{sprite:'🦈',anim:'petSeaFloat'} },
  pet_octopus:    { cat:'pet', subcat:'sea',  name:'Ahtapot',         emoji:'🐙', price:1000, rarity:'epic',      desc:'Sekiz kollu akıllı ahtapot.',                      preview:{sprite:'🐙',anim:'petSeaFloat'} },
  pet_fish:       { cat:'pet', subcat:'sea',  name:'Balık',           emoji:'🐟', price:500,  rarity:'common',    desc:'Sıradan ama huzurlu balık.',                       preview:{sprite:'🐟',anim:'petSeaFloat'} },
  pet_tropfish:   { cat:'pet', subcat:'sea',  name:'Tropikal Balık',  emoji:'🐠', price:700,  rarity:'rare',      desc:'Renkli tropikal balık.',                           preview:{sprite:'🐠',anim:'petSeaFloat'} },
  pet_blowfish:   { cat:'pet', subcat:'sea',  name:'Balon Balığı',    emoji:'🐡', price:700,  rarity:'rare',      desc:'Şişinip duran balon balığı.',                      preview:{sprite:'🐡',anim:'petSeaFloat'} },
  pet_seal:       { cat:'pet', subcat:'sea',  name:'Fok',             emoji:'🦭', price:900,  rarity:'rare',      desc:'Top oynayan sevimli fok.',                         preview:{sprite:'🦭',anim:'petSeaFloat'} },
  pet_crab:       { cat:'pet', subcat:'sea',  name:'Yengeç',          emoji:'🦀', price:700,  rarity:'rare',      desc:'Yan yürüyen komik yengeç.',                        preview:{sprite:'🦀',anim:'petSeaFloat'} },
  // 🐊 Sürüngenler & Amfibiler (subcat: reptile, anim: petReptileCreep)
  pet_croc:       { cat:'pet', subcat:'reptile', name:'Timsah',       emoji:'🐊', price:1000, rarity:'epic',      desc:'Sulak alanlarda pusuya yatan timsah.',             preview:{sprite:'🐊',anim:'petReptileCreep'} },
  pet_turtle:     { cat:'pet', subcat:'reptile', name:'Kaplumbağa',   emoji:'🐢', price:700,  rarity:'rare',      desc:'Yavaş ama kararlı kaplumbağa.',                    preview:{sprite:'🐢',anim:'petReptileCreep'} },
  pet_lizard:     { cat:'pet', subcat:'reptile', name:'Kertenkele',   emoji:'🦎', price:600,  rarity:'rare',      desc:'Güneşlenen renkli kertenkele.',                    preview:{sprite:'🦎',anim:'petReptileCreep'} },
  pet_snake:      { cat:'pet', subcat:'reptile', name:'Yılan',        emoji:'🐍', price:800,  rarity:'rare',      desc:'Sessizce kıvrılan yılan.',                         preview:{sprite:'🐍',anim:'petReptileCreep'} },
  pet_frog:       { cat:'pet', subcat:'reptile', name:'Kurbağa',      emoji:'🐸', price:600,  rarity:'rare',      desc:'Neşeyle zıplayan yeşil kurbağa.',                  preview:{sprite:'🐸',anim:'petReptileCreep'} },
  // 🐝 Böcekler & Küçük (subcat: insect, anim: petInsectFlutter)
  pet_bee:        { cat:'pet', subcat:'insect', name:'Arı',           emoji:'🐝', price:600,  rarity:'rare',      desc:'Çalışkan ve tatlı arı.',                           preview:{sprite:'🐝',anim:'petInsectFlutter'} },
  pet_butterfly:  { cat:'pet', subcat:'insect', name:'Kelebek',       emoji:'🦋', price:800,  rarity:'rare',      desc:'Renkli kanatlarıyla zarif kelebek.',               preview:{sprite:'🦋',anim:'petInsectFlutter'} },
  pet_beetle:     { cat:'pet', subcat:'insect', name:'Böcek',         emoji:'🪲', price:500,  rarity:'common',    desc:'Zırhlı küçük böcek.',                              preview:{sprite:'🪲',anim:'petInsectFlutter'} },
  pet_spider:     { cat:'pet', subcat:'insect', name:'Örümcek',       emoji:'🕷️', price:600,  rarity:'rare',      desc:'Ağ ören gizemli örümcek.',                         preview:{sprite:'🕷️',anim:'petInsectFlutter'} },
  pet_snail:      { cat:'pet', subcat:'insect', name:'Salyangoz',     emoji:'🐌', price:500,  rarity:'common',    desc:'Yavaş ama tutarlı salyangoz.',                     preview:{sprite:'🐌',anim:'petInsectFlutter'} },
  pet_caterpillar:{ cat:'pet', subcat:'insect', name:'Tırtıl',        emoji:'🐛', price:500,  rarity:'common',    desc:'Gelecekte kelebek olacak tırtıl.',                 preview:{sprite:'🐛',anim:'petInsectFlutter'} },
  pet_ant:        { cat:'pet', subcat:'insect', name:'Karınca',       emoji:'🐜', price:500,  rarity:'common',    desc:'Güçlü ve dayanışmacı karınca.',                    preview:{sprite:'🐜',anim:'petInsectFlutter'} },
  // 🌟 Özel (subcat: special)
  pet_ghost:      { cat:'pet', subcat:'special', name:'Hayalet',      emoji:'👻', price:1200, rarity:'epic',      desc:'Yavaş süzülen, gizemli hayalet.',                  preview:{sprite:'👻',anim:'ghostDrift'} },
  // ── Yazı Tipleri ──
  font_gothic:    { cat:'font', name:'Gotik Yazı',       emoji:'✒️', price:500,  rarity:'rare',      desc:'Ortaçağ tarzı dekoratif yazı tipi.',            preview:{family:'"Cinzel Decorative",serif',weight:'700'} },
  font_cursive:   { cat:'font', name:'El Yazısı',        emoji:'🖋️', price:600,  rarity:'rare',      desc:'Zarif el yazısı stili.',                        preview:{family:'"Segoe Script","Apple Chancery",cursive',weight:'400'} },
  font_pixel:     { cat:'font', name:'Piksel Yazı',      emoji:'👾', price:750,  rarity:'epic',      desc:'Retro 8-bit piksel yazı tipi.',                 preview:{family:'"Courier New",monospace',weight:'700',size:'.72rem'} },
  font_bebas:     { cat:'font', name:'Bebas Neue',       emoji:'🔠', price:600,  rarity:'rare',      desc:'Kalın, güçlü ve modern başlık fontu.',          preview:{family:'"Bebas Neue",sans-serif',weight:'400',size:'.95rem'} },
  font_smooch:    { cat:'font', name:'Smooch Sans',      emoji:'💫', price:700,  rarity:'rare',      desc:'Yumuşak ve akıcı modern yazı tipi.',            preview:{family:'"Smooch Sans",sans-serif',weight:'700'} },
  font_changa:    { cat:'font', name:'Changa One',       emoji:'🎯', price:800,  rarity:'epic',      desc:'Cesur ve dikkat çeken display fontu.',           preview:{family:'"Changa One",sans-serif',weight:'400',size:'.9rem'} },
  font_dancing:   { cat:'font', name:'Dancing Script',   emoji:'💃', price:650,  rarity:'rare',      desc:'Zarif ve akıcı dans eden kursif yazı.',         preview:{family:'"Dancing Script",cursive',weight:'700',size:'.85rem'} },
  font_greatvibes:{ cat:'font', name:'Kaligrafi',        emoji:'🪶', price:700,  rarity:'rare',      desc:'Resmi davet kartı kaligrafi stili.',            preview:{family:'"Great Vibes",cursive',weight:'400',size:'1rem'} },
  font_sacramento:{ cat:'font', name:'Sacramento',       emoji:'🌸', price:600,  rarity:'rare',      desc:'İnce ve narin el yazısı.',                      preview:{family:'"Sacramento",cursive',weight:'400',size:'1rem'} },
  font_caveat:    { cat:'font', name:'Karalama',         emoji:'✏️', price:550,  rarity:'rare',      desc:'Neşeli ve doğal el karalaması tarzı.',          preview:{family:'"Caveat",cursive',weight:'700',size:'.9rem'} },
  font_pacifico:  { cat:'font', name:'Pacifico',         emoji:'🌊', price:650,  rarity:'rare',      desc:'Yuvarlak ve samimi sörf kültürü fontu.',         preview:{family:'"Pacifico",cursive',weight:'400',size:'.82rem'} },
  font_kaushan:   { cat:'font', name:'Fırça Yazısı',     emoji:'🖌️', price:750,  rarity:'epic',      desc:'El yapımı fırça kaligrafi.',                    preview:{family:'"Kaushan Script",cursive',weight:'400',size:'.88rem'} }
};

// Kozmetik eşya kataloğu endpoint'i (exclusive olanlar gösterilir ama satın alınamaz)
app.get('/api/shop/cosmetics', apiLimiter, (req, res) => {
  res.json({ items: COSMETIC_CATALOG });
});

// ── GIPHY PROXY (avatar olarak GIF seçimi için) ──
// API key .env GIPHY_API_KEY üzerinden ayarlanır; yoksa Giphy public dev key fallback
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || 'dc6zaTOxFJmzC';
app.get('/api/giphy/search', apiLimiter, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 64);
    const limit = Math.min(parseInt(req.query.limit) || 24, 50);
    const offset = Math.min(parseInt(req.query.offset) || 0, 1000);
    if (!q) {
      // Sorgu yoksa trending döndür
      const url = `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(GIPHY_API_KEY)}&limit=${limit}&offset=${offset}&rating=pg-13`;
      const r = await fetch(url);
      if (!r.ok) return res.status(502).json({ ok: false, error: 'Giphy hatası' });
      const data = await r.json();
      return res.json({ ok: true, gifs: (data.data || []).map(simplifyGif) });
    }
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(GIPHY_API_KEY)}&q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}&rating=pg-13&lang=tr`;
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ ok: false, error: 'Giphy hatası' });
    const data = await r.json();
    res.json({ ok: true, gifs: (data.data || []).map(simplifyGif) });
  } catch (err) {
    console.error('[Giphy] Hata:', err.message);
    res.status(500).json({ ok: false, error: 'Sunucu hatası' });
  }
});
function simplifyGif(g) {
  return {
    id: g.id,
    title: g.title,
    // Profil avatar için küçük sürüm yeterli (200w)
    url: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url || g.images?.original?.url,
    preview: g.images?.fixed_width_small_still?.url || g.images?.fixed_width_still?.url
  };
}

// ── ÖDEME SİSTEMİ (Provider-agnostic, SOLID/DIP) ──
// setupPayment() çağrısı authed Map tanımından sonra yapılır (aşağıda)

// Ödeme başarılı sonrası uygulama (PaymentService tarafından çağrılır)
function applyPayment(username, packageId, donationAmount) {
  if (packageId === 'donation') {
    Accounts.recordDonation(username, donationAmount);
    Accounts.recordPayment(username, {
      id: 'don_' + Date.now(),
      type: 'donation',
      amount: donationAmount,
      currency: 'TRY',
      status: 'success'
    });
    return { ok: true, type: 'donation', amount: donationAmount };
  }
  const pkg = PAYMENT_PACKAGES[packageId];
  if (!pkg) return { ok: false };

  if (pkg.type === 'coins') {
    Accounts.addCoins(username, pkg.amount);
  } else if (pkg.type === 'premium') {
    Accounts.activatePremium(username, pkg.days);
  }
  Accounts.recordPayment(username, {
    id: 'pay_' + Date.now(),
    type: pkg.type,
    packageId,
    amount: pkg.price,
    currency: pkg.currency,
    status: 'success'
  });

  // Stats güncelle (hem socket hem next request)
  for (const [sid, uname] of authed.entries()) {
    if (uname === username) {
      const stats = Accounts.getStats(uname);
      if (stats) io.sockets.sockets.get(sid)?.emit('statsUpdate', stats);
    }
  }
  return { ok: true, type: pkg.type };
}

// Report screenshot endpoint - sadece admin authentication ile bakılabilir
app.get('/admin/screenshot/:filename', adminLimiter, (req, res) => {
  const token = req.query.token;
  if (!token || typeof token !== 'string') return res.status(403).send('Forbidden');
  const u = Array.from(authed.entries()).find(([sid, uname]) => sid === token);
  if (!u || !Accounts.isAdmin(u[1])) return res.status(403).send('Forbidden');
  // Path traversal koruması - daha güvenli
  const filename = req.params.filename;
  if (typeof filename !== 'string' || 
      filename.length === 0 || 
      filename.length > 100 || 
      !/^[a-zA-Z0-9._-]+$/.test(filename) ||
      filename.includes('..') || 
      filename.includes('/') || 
      filename.includes('\\')) {
    return res.status(400).send('Invalid filename');
  }
  const fpath = Reports.getScreenshotPath(filename);
  // Ek güvenlik: dosya yolu screenshot dizini içinde mi kontrol et
  const screenshotDir = Reports.getScreenshotDir();
  if (!fpath || !path.resolve(fpath).startsWith(path.resolve(screenshotDir))) {
    return res.status(400).send('Invalid filename');
  }
  if (!fpath || !fs.existsSync(fpath)) return res.status(404).send('Not found');
  res.sendFile(fpath);
});

app.get('/admin/export-reports', adminLimiter, (req, res) => {
  const token = req.query.token;
  if (!token || typeof token !== 'string') return res.status(403).send('Forbidden');
  const u = Array.from(authed.entries()).find(([sid, uname]) => sid === token);
  if (!u || !Accounts.isAdmin(u[1])) return res.status(403).send('Forbidden');

  const reports = Reports.list();
  const screenshotDir = Reports.getScreenshotDir();
  // HTML olarak inline base64 görüntüler
  let html = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>AZAP — Tüm Bug Raporları</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#1a1a1a;color:#e0e0e0;padding:20px;line-height:1.5}
h1{color:#c0392b;border-bottom:2px solid #c0392b;padding-bottom:8px;margin-bottom:20px}
.summary{background:#2a2a2a;padding:12px;border-radius:6px;margin-bottom:20px;font-size:14px}
.report{background:#252525;border-left:4px solid #c0392b;padding:16px;margin-bottom:16px;border-radius:4px}
.report.closed{border-left-color:#27ae60;opacity:0.7}
.report-hdr{display:flex;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px}
.report-id{font-family:monospace;color:#888;font-size:12px}
.report-user{color:#3498db;font-weight:600}
.report-status{padding:2px 8px;border-radius:3px;font-size:11px;background:#c0392b;color:#fff}
.report-status.closed{background:#27ae60}
.report-date{color:#888;font-size:12px}
.report-desc{background:#1a1a1a;padding:12px;border-radius:4px;margin:10px 0;white-space:pre-wrap;word-wrap:break-word;font-size:13px}
.report-img{max-width:100%;border:1px solid #444;border-radius:4px;margin-top:8px}
</style></head><body>
<h1>⛧ AZAP — Bug Raporları</h1>
<div class="summary">
<strong>Toplam Rapor:</strong> ${reports.length} •
<strong>Açık:</strong> ${reports.filter(r => r.status === 'open').length} •
<strong>Kapalı:</strong> ${reports.filter(r => r.status === 'closed').length} •
<strong>Dışa aktarma:</strong> ${new Date().toLocaleString('tr-TR')}
</div>
`;

  reports.forEach(r => {
    const date = new Date(r.createdAt).toLocaleString('tr-TR');
    let imgHtml = '';
    if (r.screenshot) {
      try {
        const buf = fs.readFileSync(path.join(screenshotDir, r.screenshot));
        const ext = r.screenshot.split('.').pop();
        const mime = ext === 'jpg' ? 'jpeg' : ext;
        imgHtml = `<img class="report-img" src="data:image/${mime};base64,${buf.toString('base64')}" alt="Screenshot">`;
      } catch (e) {
        imgHtml = `<div style="color:#888;font-style:italic">[Ekran görüntüsü yüklenemedi: ${r.screenshot}]</div>`;
      }
    }
    html += `<div class="report ${r.status === 'closed' ? 'closed' : ''}">
<div class="report-hdr">
  <div><span class="report-user">${r.username}</span> <span class="report-id">${r.id}</span></div>
  <div><span class="report-status ${r.status}">${r.status === 'closed' ? 'KAPALI' : 'AÇIK'}</span> <span class="report-date">${date}</span></div>
</div>
<div class="report-desc">${r.description.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
${imgHtml}
</div>`;
  });

  html += '</body></html>';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="azap-reports-${Date.now()}.html"`);
  res.send(html);
});

// ── ADMIN ANALYTICS (sadece admin erişebilir) ──

// Admin auth helper — hem socket.id (geçici) hem de ADMIN_SECRET_KEY (sabit master key) kabul eder
function checkAdmin(req, res) {
  const token = req.query.token;
  if (!token || typeof token !== 'string') { res.status(403).send('Forbidden'); return null; }
  // 1) Sabit master key kontrolü (en güçlü, sadece senin bildiğin)
  if (token === ADMIN_SECRET_KEY) return '__MASTER_ADMIN__';
  // 2) Socket.id ile geçici token kontrolü (admin kullanıcı adı + socket.id eşleşmesi)
  const u = Array.from(authed.entries()).find(([sid, uname]) => sid === token);
  if (!u || !Accounts.isAdmin(u[1])) { res.status(403).send('Forbidden'); return null; }
  return u[1];
}

// JSON API: tam istatistik havuzu
app.get('/admin/analytics', adminLimiter, (req, res) => {
  if (!checkAdmin(req, res)) return;
  const now = Date.now();
  const users = Accounts.listAll();

  // ── SUNUCU ──
  const uptime = Math.floor((now - siteStats.startedAt) / 1000);
  const activeRooms = rooms.size;
  const playersInRooms = Array.from(rooms.values()).reduce((sum, g) => sum + g.players.size, 0);
  const liveRoomsData = [...rooms.entries()].map(([code, g]) => ({
    code, playerCount: g.players.size, spectatorCount: g.spectators?.size || 0,
    phase: g.phase, round: g.round || 0
  })).slice(0, 25);

  // ── KULLANICI ──
  const totalUsers = users.length;
  const totalAdmins = users.filter(u => u.isAdmin).length;
  const activePremium = users.filter(u => u.premium?.active).length;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const usersToday = users.filter(u => u.created >= todayStart.getTime()).length;
  const usersThisWeek = users.filter(u => u.created >= now - 7 * 86400000).length;
  const usersThisMonth = users.filter(u => u.created >= now - 30 * 86400000).length;
  const neverPlayed = users.filter(u => !(u.stats?.played)).length;
  const usersWithItems = users.filter(u => (u.inventory?.length || 0) > 0).length;

  // ── FİNANS ──
  const totalDonations = users.reduce((s, u) => s + (u.totalDonated || 0), 0);
  const totalCoinsHeld = users.reduce((s, u) => s + (u.coins || 0), 0);
  const avgCoins = totalUsers > 0 ? Math.round(totalCoinsHeld / totalUsers) : 0;

  // ── OYUN ──
  const totalGamesPlayed = users.reduce((s, u) => s + (u.stats?.played || 0), 0);
  const totalGamesWon = users.reduce((s, u) => s + (u.stats?.won || 0), 0);
  const totalGamesLost = users.reduce((s, u) => s + (u.stats?.lost || 0), 0);
  const totalMVPs = users.reduce((s, u) => s + (u.stats?.mvp || 0), 0);
  const avgWinRate = totalGamesPlayed > 0 ? Math.round((totalGamesWon / totalGamesPlayed) * 100) : 0;
  const avgGamesPerPlayer = totalUsers > 0 ? (totalGamesPlayed / totalUsers).toFixed(1) : '0';

  // ── ENVANTER ──
  const itemCounts = {};
  users.forEach(u => {
    (u.inventory || []).forEach(it => {
      const id = typeof it === 'string' ? it : it.id;
      if (id) itemCounts[id] = (itemCounts[id] || 0) + 1;
    });
  });
  const totalItemsOwned = users.reduce((s, u) => s + (u.inventory?.length || 0), 0);
  const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, count]) => ({ id, count }));

  // ── LEADERBOARDlar ──
  const topPlayers = users.filter(u => u.stats?.played > 0)
    .map(u => ({ username: u.username, played: u.stats.played, won: u.stats.won, mvp: u.stats.mvp || 0, coins: u.coins || 0, premium: u.premium?.active || false }))
    .sort((a, b) => b.played - a.played).slice(0, 10);

  const topWinners = users.filter(u => u.stats?.won > 0)
    .map(u => ({ username: u.username, won: u.stats.won, played: u.stats.played, winRate: u.stats.played > 0 ? Math.round((u.stats.won / u.stats.played) * 100) : 0 }))
    .sort((a, b) => b.won - a.won).slice(0, 10);

  const topWinRate = users.filter(u => (u.stats?.played || 0) >= 5)
    .map(u => ({ username: u.username, played: u.stats.played, won: u.stats.won, winRate: Math.round((u.stats.won / u.stats.played) * 100) }))
    .sort((a, b) => b.winRate - a.winRate).slice(0, 10);

  const topMvps = users.filter(u => (u.stats?.mvp || 0) > 0)
    .map(u => ({ username: u.username, mvp: u.stats.mvp, played: u.stats.played || 0 }))
    .sort((a, b) => b.mvp - a.mvp).slice(0, 10);

  const topLosers = users.filter(u => (u.stats?.lost || 0) > 0)
    .map(u => ({ username: u.username, lost: u.stats.lost || 0, played: u.stats.played || 0 }))
    .sort((a, b) => b.lost - a.lost).slice(0, 10);

  const topDonors = users.filter(u => u.totalDonated > 0)
    .map(u => ({ username: u.username, totalDonated: u.totalDonated }))
    .sort((a, b) => b.totalDonated - a.totalDonated).slice(0, 10);

  const topRichest = users.filter(u => u.coins > 0)
    .map(u => ({ username: u.username, coins: u.coins }))
    .sort((a, b) => b.coins - a.coins).slice(0, 10);

  const premiumUsers = users.filter(u => u.premium?.active)
    .map(u => ({ username: u.username, daysLeft: u.premium.daysLeft, totalDonated: u.totalDonated || 0 }))
    .sort((a, b) => b.daysLeft - a.daysLeft).slice(0, 30);

  // ── KAYIT GRAFİĞİ (son 30 gün) ──
  const dayBuckets = {};
  users.forEach(u => {
    if (!u.created || u.created < now - 30 * 86400000) return;
    const day = new Date(u.created).toISOString().split('T')[0];
    dayBuckets[day] = (dayBuckets[day] || 0) + 1;
  });
  const registrationsByDay = Object.entries(dayBuckets).sort((a, b) => a[0].localeCompare(b[0]));

  // ── RAPORLAR ──
  const reports = Reports.list();
  const openReports = reports.filter(r => r.status === 'open' || !r.status).length;
  const closedReports = reports.length - openReports;
  const reportResolutionRate = reports.length > 0 ? Math.round(closedReports / reports.length * 100) : 0;

  // ── EK İSTATİSTİKLER ──
  const donorCount = users.filter(u => u.totalDonated > 0).length;
  const playersEver = users.filter(u => (u.stats?.played || 0) > 0).length;
  const retainedPlayers = users.filter(u => (u.stats?.played || 0) > 1).length;
  const retentionRate = playersEver > 0 ? Math.round(retainedPlayers / playersEver * 100) : 0;
  const avgItemsPerUser = usersWithItems > 0 ? (totalItemsOwned / usersWithItems).toFixed(1) : '0';

  res.json({
    ok: true,
    stats: {
      server: { uptime, totalConnections: siteStats.totalConnections, currentActive: siteStats.currentActive, peakConcurrent: siteStats.peakConcurrent, history: siteStats.history },
      users: { total: totalUsers, admins: totalAdmins, premium: activePremium, today: usersToday, thisWeek: usersThisWeek, thisMonth: usersThisMonth, neverPlayed, withInventory: usersWithItems, donorCount, playersEver, retentionRate },
      finance: { totalDonations, totalCoins: totalCoinsHeld, avgCoins },
      games: { played: totalGamesPlayed, won: totalGamesWon, lost: totalGamesLost, mvps: totalMVPs, avgWinRate, avgGamesPerPlayer },
      inventory: { totalItemsOwned, topItems, avgItemsPerUser },
      live: { activeRooms, playersInRooms, rooms: liveRoomsData },
      reports: { open: openReports, closed: closedReports, total: reports.length, resolutionRate: reportResolutionRate },
      topPlayers, topWinners, topWinRate, topMvps, topLosers, topDonors, topRichest, premiumUsers, registrationsByDay
    }
  });
});

// Admin login: POST ile token al (URL'de gözükmez)
app.post('/admin/login', adminLimiter, express.json(), (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(403).json({ ok: false, error: 'Token gerekli' });
  }
  // Master key veya admin socket token kontrolü
  if (token === ADMIN_SECRET_KEY) return res.json({ ok: true, admin: true, type: 'master' });
  const u = Array.from(authed.entries()).find(([sid, uname]) => sid === token);
  if (!u || !Accounts.isAdmin(u[1])) {
    return res.status(403).json({ ok: false, error: 'Geçersiz token' });
  }
  res.json({ ok: true, admin: true, type: 'session' });
});

// Kullanıcı listesi (dashboard için)
app.get('/admin/users', adminLimiter, (req, res) => {
  if (!checkAdmin(req, res)) return;
  const users = Accounts.listAll();
  res.json({ ok: true, users });
});

// HTML Dashboard — modernize edilmiş admin paneli
app.get('/admin/dashboard', adminLimiter, (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AZAP Admin Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#080814;color:#e0e0ff;min-height:100vh}
a{color:inherit;text-decoration:none}
/* STICKY TOPBAR */
.topbar{position:sticky;top:0;z-index:100;background:rgba(8,8,20,.95);backdrop-filter:blur(10px);border-bottom:1px solid #1e1e30;display:flex;align-items:center;justify-content:space-between;padding:10px 20px;gap:12px}
.topbar-title{font-size:16px;font-weight:800;color:#ff6b6b;white-space:nowrap;letter-spacing:-0.5px}
.topbar-nav{display:flex;gap:4px;flex-wrap:wrap}
.topbar-nav a{font-size:11px;color:#555577;padding:5px 9px;border-radius:6px;transition:.15s;font-weight:500}
.topbar-nav a:hover{color:#e0e0ff;background:#1e1e30}
.topbar-right{display:flex;gap:8px;align-items:center}
.topbar-time{font-size:11px;color:#555577}
.topbar-time span{color:#64ffda}
/* LAYOUT */
.page{max-width:1400px;margin:0 auto;padding:20px 16px 40px}
/* BUTTONS */
.btn{border:none;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;transition:.15s}
.btn-r{background:#ff6b6b;color:#fff}.btn-r:hover{background:#ff5252}
.btn-g{background:#1e3a2a;color:#27ae60;border:1px solid #27ae60}.btn-g:hover{background:#27ae60;color:#fff}
.btn-d{background:#1a1a2e;color:#8892b0;border:1px solid #2d2d44}.btn-d:hover{background:#2d2d44;color:#e0e0ff}
/* PULSE ROW */
.pulse-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px}
@media(max-width:800px){.pulse-row{grid-template-columns:repeat(2,1fr)}}
.pulse-card{background:#12121f;border:1px solid #1e1e30;border-radius:14px;padding:22px 16px;text-align:center;position:relative;overflow:hidden;transition:.2s;cursor:default}
.pulse-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
.pulse-card.p-green::before{background:linear-gradient(90deg,#27ae60,#64ffda)}
.pulse-card.p-teal::before{background:linear-gradient(90deg,#64ffda,#00b4d8)}
.pulse-card.p-purple::before{background:linear-gradient(90deg,#bb8fce,#9b59b6)}
.pulse-card.p-blue::before{background:linear-gradient(90deg,#3498db,#64ffda)}
.pulse-card:hover{transform:translateY(-3px);box-shadow:0 10px 40px rgba(0,0,0,.5)}
.pulse-ico{font-size:28px;margin-bottom:8px}
.pulse-val{font-size:36px;font-weight:800;color:#fff;letter-spacing:-1.5px;line-height:1}
.pulse-lbl{font-size:10px;color:#555577;text-transform:uppercase;letter-spacing:1px;margin-top:6px}
/* SECTIONS */
.sec{margin-bottom:28px}
.sec-title{font-size:11px;font-weight:800;color:#64ffda;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;padding-left:10px;border-left:3px solid #64ffda;display:flex;align-items:center;gap:8px}
.sec-title.red{color:#ff6b6b;border-left-color:#ff6b6b}
.sec-title.purple{color:#bb8fce;border-left-color:#bb8fce}
.sec-title.gold{color:#ffd700;border-left-color:#ffd700}
.sec-title.pink{color:#e91e63;border-left-color:#e91e63}
.sec-title.green{color:#27ae60;border-left-color:#27ae60}
/* STAT CARDS */
.sg{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
.sc{background:#12121f;border:1px solid #1e1e30;border-radius:10px;padding:14px 12px;text-align:center;transition:.2s;cursor:default}
.sc:hover{transform:translateY(-2px);box-shadow:0 6px 24px rgba(0,0,0,.4)}
.sc .ico{font-size:22px;margin-bottom:5px}
.sc .val{font-size:24px;font-weight:800;color:#fff;line-height:1;letter-spacing:-0.5px}
.sc .lbl{font-size:10px;color:#555577;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
.sc.c-teal{border-color:rgba(100,255,218,.25);background:linear-gradient(135deg,rgba(100,255,218,.05),#12121f)}
.sc.c-red{border-color:rgba(255,107,107,.25);background:linear-gradient(135deg,rgba(255,107,107,.05),#12121f)}
.sc.c-purple{border-color:rgba(187,143,206,.25);background:linear-gradient(135deg,rgba(187,143,206,.05),#12121f)}
.sc.c-green{border-color:rgba(39,174,96,.25);background:linear-gradient(135deg,rgba(39,174,96,.05),#12121f)}
.sc.c-gold{border-color:rgba(255,215,0,.25);background:linear-gradient(135deg,rgba(255,215,0,.05),#12121f)}
.sc.c-pink{border-color:rgba(233,30,99,.25);background:linear-gradient(135deg,rgba(233,30,99,.05),#12121f)}
.sc.c-blue{border-color:rgba(52,152,219,.25);background:linear-gradient(135deg,rgba(52,152,219,.05),#12121f)}
/* 3-CHART GRID */
.cg3{display:grid;grid-template-columns:2fr 2fr 1.5fr;gap:14px}
@media(max-width:900px){.cg3{grid-template-columns:1fr 1fr}}
@media(max-width:600px){.cg3{grid-template-columns:1fr}}
.cbox{background:#12121f;border:1px solid #1e1e30;border-radius:10px;padding:16px}
.ct{font-size:11px;font-weight:700;color:#555577;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px}
/* TABLE */
.tbl-wrap{background:#12121f;border:1px solid #1e1e30;border-radius:10px;overflow:hidden}
.dtbl{width:100%;border-collapse:collapse;font-size:13px}
.dtbl th{padding:9px 14px;color:#555577;text-align:left;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #1e1e30;background:#0e0e1a}
.dtbl td{padding:9px 14px;border-bottom:1px solid #0f0f1e;vertical-align:middle}
.dtbl tbody tr:last-child td{border-bottom:none}
.dtbl tbody tr:hover td{background:rgba(100,255,218,.025)}
.phase{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:700;background:#1e1e30;color:#555577}
.ph-lobby{color:#64ffda;background:rgba(100,255,218,.12)}
.ph-night{color:#bb8fce;background:rgba(187,143,206,.12)}
.ph-day{color:#f39c12;background:rgba(243,156,18,.12)}
.ph-vote{color:#e91e63;background:rgba(233,30,99,.12)}
.ph-over{color:#ff6b6b;background:rgba(255,107,107,.12)}
/* LEADERBOARDS */
.lb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.lb-box{background:#12121f;border:1px solid #1e1e30;border-radius:10px;overflow:hidden}
.lb-hdr{padding:10px 14px;font-size:12px;font-weight:700;background:#0e0e1a;border-bottom:1px solid #1e1e30;display:flex;align-items:center;gap:6px;color:#ccd}
.lb-row{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #0f0f1e;font-size:13px}
.lb-row:last-child{border-bottom:none}
.lb-row:hover{background:rgba(255,255,255,.02)}
.lb-rk{width:22px;height:22px;border-radius:50%;background:#1a1a2e;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;color:#555577}
.lb-rk.r1{background:linear-gradient(135deg,#ffd700,#b8860b);color:#000}
.lb-rk.r2{background:linear-gradient(135deg,#c0c0c0,#808080);color:#000}
.lb-rk.r3{background:linear-gradient(135deg,#cd7f32,#8b4513);color:#fff}
.lb-name{flex:1;font-weight:600;color:#dde;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.lb-val{font-size:12px;color:#8892b0;white-space:nowrap;text-align:right}
.lb-bar{height:4px;width:50px;background:#1a1a2e;border-radius:2px;overflow:hidden;flex-shrink:0}
.lb-bf{height:100%;border-radius:2px}
.empty{color:#555577;text-align:center;padding:18px;font-size:13px;font-style:italic}
/* PREMIUM */
.prem-list{display:flex;flex-wrap:wrap;gap:8px}
.prem-tag{background:linear-gradient(135deg,rgba(187,143,206,.1),rgba(94,58,135,.08));border:1px solid rgba(187,143,206,.25);border-radius:8px;padding:7px 12px;font-size:12px;display:flex;align-items:center;gap:8px}
.pt-name{color:#bb8fce;font-weight:700}
.pt-days{color:#8892b0;font-size:11px}
.pt-don{color:#e91e63;font-size:11px}
/* ITEMS */
.item-row{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid #0f0f1e;font-size:13px}
.item-row:last-child{border-bottom:none}
.item-row:hover{background:rgba(100,255,218,.025)}
.item-rk{width:18px;font-size:11px;color:#555577;text-align:right;flex-shrink:0}
.item-id{font-family:monospace;color:#64ffda;flex:1;font-size:12px}
.item-bar{flex:1;height:5px;background:#1a1a2e;border-radius:3px;overflow:hidden;max-width:100px}
.item-bf{height:100%;border-radius:3px;background:linear-gradient(90deg,#64ffda,#00b4d8)}
.item-cnt{color:#e0e0ff;font-weight:700;width:45px;text-align:right;font-size:12px}
/* BADGE */
.bdg{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:800;margin-left:4px;vertical-align:middle}
.bdg-p{background:rgba(187,143,206,.2);color:#bb8fce}
.bdg-a{background:rgba(255,107,107,.2);color:#ff6b6b}
/* WIN RATE BAR */
.wr-cell{display:flex;align-items:center;gap:5px}
.wr-bar{width:44px;height:4px;background:#1a1a2e;border-radius:2px;overflow:hidden;flex-shrink:0}
.wr-bf{height:100%;border-radius:2px;background:linear-gradient(90deg,#27ae60,#64ffda)}
.wr-pct{font-size:10px;color:#555577;white-space:nowrap}
/* USER MANAGEMENT */
.usr-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
.usr-toolbar input{background:#0a0a14;border:1px solid #1e1e30;border-radius:8px;padding:7px 12px;color:#e0e0ff;font-size:13px;outline:none;min-width:200px;transition:.15s}
.usr-toolbar input:focus{border-color:#64ffda}
.usr-toolbar select{background:#0a0a14;border:1px solid #1e1e30;border-radius:8px;padding:7px 12px;color:#e0e0ff;font-size:13px;outline:none;cursor:pointer}
.usr-count{font-size:12px;color:#555577;margin-left:auto}
.usr-badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:800}
.ub-admin{background:rgba(255,107,107,.15);color:#ff6b6b}
.ub-prem{background:rgba(187,143,206,.15);color:#bb8fce}
.ub-don{background:rgba(233,30,99,.12);color:#e91e63}
/* LOGIN */
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#080814}
.login-box{background:#12121f;border:1px solid #1e1e30;border-radius:16px;padding:40px;width:100%;max-width:360px;text-align:center}
.login-box h2{color:#ff6b6b;font-size:22px;margin-bottom:6px;letter-spacing:-0.5px}
.login-box p{color:#555577;font-size:13px;margin-bottom:24px}
.login-box input{width:100%;padding:12px 14px;background:#0a0a14;border:1px solid #1e1e30;border-radius:8px;color:#e0e0ff;font-size:14px;margin-bottom:12px;outline:none;transition:.15s}
.login-box input:focus{border-color:#64ffda}
.login-box .btn-r{width:100%;padding:12px;font-size:15px}
.login-err{color:#ff6b6b;font-size:12px;margin-top:8px;min-height:18px}
.hidden{display:none!important}
</style>
</head>
<body>

<!-- GİRİŞ -->
<div id="loginWrap" class="login-wrap">
  <div class="login-box">
    <h2>⚡ AZAP Admin</h2>
    <p>İstatistik paneline erişmek için<br>admin token girin</p>
    <input type="password" id="tkInp" placeholder="Admin token..." autocomplete="off">
    <button class="btn btn-r" onclick="doLogin()">Giriş Yap</button>
    <div id="tkErr" class="login-err"></div>
  </div>
</div>

<!-- PANEL -->
<div id="dash" class="hidden">

<!-- STICKY TOPBAR -->
<div class="topbar">
  <div class="topbar-title">⚡ AZAP Admin</div>
  <nav class="topbar-nav">
    <a href="#pulse">📊 Özet</a>
    <a href="#srv">🖥️ Sunucu</a>
    <a href="#usr">👥 Kullanıcı</a>
    <a href="#game">🎮 Oyun</a>
    <a href="#charts">📈 Grafikler</a>
    <a href="#rooms">🟢 Odalar</a>
    <a href="#lb">🏆 Lider</a>
    <a href="#mgmt">⚙️ Yönetim</a>
  </nav>
  <div class="topbar-right">
    <div class="topbar-time">Güncellendi: <span id="lastUpd">—</span></div>
    <button class="btn btn-g" onclick="loadAll()">🔄</button>
    <button class="btn btn-d" onclick="doLogout()">🚪</button>
  </div>
</div>

<div class="page">

<!-- PULSE ROW -->
<div id="pulse" style="padding-top:20px">
  <div class="pulse-row" id="pulseRow"></div>
</div>

<!-- SUNUCU SAĞLIĞI -->
<div class="sec" id="srv">
  <div class="sec-title">🖥️ Sunucu Sağlığı</div>
  <div class="sg" id="srvCards"></div>
</div>

<!-- KULLANICI ANALİZİ -->
<div class="sec" id="usr">
  <div class="sec-title">👥 Kullanıcı Analizi</div>
  <div class="sg" id="usrCards"></div>
</div>

<!-- OYUN & FİNANS -->
<div class="sec" id="game">
  <div class="sec-title red">🎮 Oyun &amp; Finansal Özet</div>
  <div class="sg" id="gfCards"></div>
</div>

<!-- GRAFİKLER -->
<div class="sec" id="charts">
  <div class="sec-title green">📈 Grafikler</div>
  <div class="cg3">
    <div class="cbox"><div class="ct">Canlı Oyuncu (Son 5 Dakika)</div><canvas id="pChart" height="130"></canvas></div>
    <div class="cbox"><div class="ct">Son 30 Gün Kayıt</div><canvas id="rChart" height="130"></canvas></div>
    <div class="cbox"><div class="ct">Kazanma / Kaybetme</div><canvas id="wlChart" height="130"></canvas></div>
  </div>
</div>

<!-- CANLI ODALAR -->
<div class="sec" id="rooms">
  <div class="sec-title green">🟢 Canlı Odalar <span id="rmCnt" style="color:#555577;font-weight:400;letter-spacing:0"></span></div>
  <div class="tbl-wrap" id="rmWrap"><p class="empty">Şu an aktif oda yok</p></div>
</div>

<!-- LEADERBOARD HAVUZU -->
<div class="sec" id="lb">
  <div class="sec-title gold">🏆 Liderboard Havuzu</div>
  <div class="lb-grid" id="lbGrid"></div>
</div>

<!-- PREMİUM KULLANICILARI -->
<div class="sec" id="premSec">
  <div class="sec-title purple">👑 Aktif Premium Kullanıcılar</div>
  <div id="premList"></div>
</div>

<!-- EN POPÜLER EŞYALAR -->
<div class="sec" id="itmSec">
  <div class="sec-title">🛍️ En Popüler Eşyalar (Top 10)</div>
  <div class="tbl-wrap" id="itmWrap"></div>
</div>

<!-- TÜM KULLANICILAR -->
<div class="sec" id="mgmt">
  <div class="sec-title red">👥 Tüm Kullanıcılar <span id="usrLoadCnt" style="color:#555577;font-weight:400;letter-spacing:0;text-transform:none;font-size:11px"></span></div>
  <div class="usr-toolbar">
    <input type="text" id="usrSearch" placeholder="🔍 Kullanıcı ara..." oninput="filterUsers()">
    <select id="usrFilter" onchange="filterUsers()">
      <option value="all">Tümü</option>
      <option value="admin">Adminler</option>
      <option value="premium">Premium</option>
      <option value="donor">Bağış yapan</option>
      <option value="active">Oyun oynamış</option>
      <option value="never">Hiç oynamamış</option>
    </select>
    <select id="usrSort" onchange="filterUsers()">
      <option value="created_desc">En yeni kayıt</option>
      <option value="created_asc">En eski kayıt</option>
      <option value="played_desc">En çok oyun</option>
      <option value="won_desc">En çok galibiyet</option>
      <option value="coins_desc">En çok altın</option>
      <option value="donated_desc">En çok bağış</option>
    </select>
    <button class="btn btn-g" onclick="loadUsers()">🔄 Yenile</button>
    <span class="usr-count" id="usrFilterInfo"></span>
  </div>
  <div class="tbl-wrap">
    <table class="dtbl" id="usrTable">
      <thead><tr>
        <th>#</th><th>Kullanıcı</th><th>Rozetler</th>
        <th>Oyun</th><th>Kazanma Oranı</th><th>MVP</th>
        <th>Altın</th><th>Bağış</th><th>Kayıt</th>
      </tr></thead>
      <tbody id="usrTbody"><tr><td colspan="9" style="text-align:center;color:#555577;padding:24px">Yükleniyor...</td></tr></tbody>
    </table>
  </div>
</div>

</div><!-- /page -->
</div><!-- /dash -->

<script>
var tk = localStorage.getItem('azap_admin_token');
var pChart, rChart, wlChart;

function esc(s){ var d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function fmt(n){ return (n||0).toLocaleString('tr-TR'); }
function fmtUp(s){ var d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60); return d>0?d+'g '+h+'s':h+'s '+m+'dk'; }
function phaseName(p){ var m={'lobby':'Lobi','role_selection':'Rol Seç','role_reveal':'Rol Açıl','president_vote':'Başkan Oy','night':'Gece','morning_report':'Sabah','day_discussion':'Tartışma','voting':'Oylama','vote_result':'Oy Sonuç','mvp_vote':'MVP Oy','mvp_result':'MVP Sonuç','game_over':'Bitti','post_game':'Sonu'}; return m[p]||p; }
function phaseCls(p){ if(p==='lobby'||p==='role_selection'||p==='role_reveal'||p==='president_vote') return 'ph-lobby'; if(p==='night'||p==='morning_report') return 'ph-night'; if(p==='day_discussion') return 'ph-day'; if(p==='voting'||p==='vote_result') return 'ph-vote'; return 'ph-over'; }
function card(ico,val,lbl,cls){ return '<div class="sc '+(cls||'')+'"><div class="ico">'+ico+'</div><div class="val">'+val+'</div><div class="lbl">'+lbl+'</div></div>'; }
function pulseCard(ico,val,lbl,cls){ return '<div class="pulse-card '+(cls||'')+'"><div class="pulse-ico">'+ico+'</div><div class="pulse-val">'+val+'</div><div class="pulse-lbl">'+lbl+'</div></div>'; }
function makeLb(title,rows,emptyMsg,barColor){
  var h='<div class="lb-box"><div class="lb-hdr">'+title+'</div>';
  if(!rows||!rows.length){ h+='<p class="empty">'+(emptyMsg||'Veri yok')+'</p></div>'; return h; }
  var maxV=rows[0]._barV||1;
  rows.forEach(function(r,i){
    var rkCls=i===0?'r1':i===1?'r2':i===2?'r3':'';
    var pct=r._barV?Math.round(r._barV/maxV*100):0;
    h+='<div class="lb-row">';
    h+='<div class="lb-rk '+rkCls+'">'+(i+1)+'</div>';
    h+='<div class="lb-name">'+esc(r.username)+(r.premium?'<span class="bdg bdg-p">VIP</span>':'')+'</div>';
    h+='<div class="lb-val">'+r._stat+'</div>';
    if(r._barV){ h+='<div class="lb-bar"><div class="lb-bf" style="width:'+pct+'%;background:'+(barColor||'#64ffda')+'"></div></div>'; }
    h+='</div>';
  });
  h+='</div>'; return h;
}

function showDash(){ document.getElementById('loginWrap').classList.add('hidden'); document.getElementById('dash').classList.remove('hidden'); initCharts(); loadAll(); loadUsers(); }
function showLogin(){ localStorage.removeItem('azap_admin_token'); document.getElementById('loginWrap').classList.remove('hidden'); document.getElementById('dash').classList.add('hidden'); }

async function doLogin(){
  var t=document.getElementById('tkInp').value.trim();
  if(!t){ document.getElementById('tkErr').textContent='Token girin'; return; }
  try{
    var r=await fetch('/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t})});
    var d=await r.json();
    if(d.ok&&d.admin){ tk=t; localStorage.setItem('azap_admin_token',tk); showDash(); }
    else document.getElementById('tkErr').textContent=d.error||'Geçersiz token';
  }catch(e){ document.getElementById('tkErr').textContent='Hata: '+e.message; }
}
function doLogout(){ showLogin(); }
document.getElementById('tkInp').addEventListener('keypress',function(e){ if(e.key==='Enter') doLogin(); });

function initCharts(){
  pChart=new Chart(document.getElementById('pChart'),{type:'line',data:{labels:[],datasets:[{label:'Aktif',data:[],borderColor:'#64ffda',backgroundColor:'rgba(100,255,218,.07)',fill:true,tension:0.4,pointRadius:2,pointHoverRadius:4}]},options:{responsive:true,animation:false,interaction:{mode:'index',intersect:false},scales:{x:{display:false},y:{beginAtZero:true,grid:{color:'#1a1a2e'},ticks:{color:'#555577',font:{size:10}}}},plugins:{legend:{display:false}}}});
  rChart=new Chart(document.getElementById('rChart'),{type:'bar',data:{labels:[],datasets:[{label:'Kayıt',data:[],backgroundColor:'rgba(187,143,206,.55)',borderColor:'#bb8fce',borderWidth:1,borderRadius:3}]},options:{responsive:true,animation:false,scales:{x:{ticks:{color:'#555577',font:{size:10},maxRotation:45},grid:{display:false}},y:{beginAtZero:true,grid:{color:'#1a1a2e'},ticks:{color:'#555577',font:{size:10}}}},plugins:{legend:{display:false}}}});
  wlChart=new Chart(document.getElementById('wlChart'),{type:'doughnut',data:{labels:['Kazandı','Kaybetti'],datasets:[{data:[1,1],backgroundColor:['rgba(39,174,96,.75)','rgba(255,107,107,.75)'],borderColor:['#27ae60','#ff6b6b'],borderWidth:1,hoverOffset:6}]},options:{responsive:true,cutout:'65%',plugins:{legend:{position:'bottom',labels:{color:'#8892b0',font:{size:11},padding:10,boxWidth:12}}}}});
}

async function loadAll(){
  if(!tk){ showLogin(); return; }
  try{
    var res=await fetch('/admin/analytics?token='+encodeURIComponent(tk));
    var d=await res.json();
    if(!d.ok){ if(res.status===403){ showLogin(); } return; }
    var s=d.stats;
    document.getElementById('lastUpd').textContent=new Date().toLocaleTimeString('tr-TR');

    /* PULSE ROW */
    document.getElementById('pulseRow').innerHTML=
      pulseCard('👁️',fmt(s.server.currentActive),'Şu An Online','p-green')+
      pulseCard('🟢',s.live.activeRooms,'Aktif Oda','p-teal')+
      pulseCard('🎮',s.live.playersInRooms,'Odada Oyuncu','p-purple')+
      pulseCard('👥',fmt(s.users.total),'Toplam Kullanıcı','p-blue');

    /* SUNUCU */
    document.getElementById('srvCards').innerHTML=
      card('⏱️',fmtUp(s.server.uptime),'Uptime','c-teal')+
      card('🔗',fmt(s.server.totalConnections),'Toplam Bağlantı','c-teal')+
      card('🚀',s.server.peakConcurrent,'Rekor Anlık','c-blue')+
      card('📡',s.server.currentActive,'Şu An Aktif','c-green');

    /* KULLANICI */
    document.getElementById('usrCards').innerHTML=
      card('📅',s.users.today,'Bugün Kayıt','c-teal')+
      card('📆',s.users.thisWeek,'Bu Hafta','')+
      card('🗓️',s.users.thisMonth,'Bu Ay (30g)','')+
      card('👑',s.users.premium,'Aktif Premium','c-purple')+
      card('🛡️',s.users.admins,'Admin','c-red')+
      card('💝',(s.users.donorCount||0),'Bağışçı','c-pink')+
      card('🎯',(s.users.playersEver||0),'Oyun Oynadı','')+
      card('🔄',(s.users.retentionRate||0)+'%','Elde Tutma','c-green')+
      card('🛍️',s.users.withInventory,'Eşya Sahibi','')+
      card('🚫',s.users.neverPlayed,'Hiç Oynamamış','');

    /* OYUN & FİNANS */
    document.getElementById('gfCards').innerHTML=
      card('🎯',fmt(s.games.played),'Toplam Oyun','')+
      card('🏆',fmt(s.games.won),'Toplam Galibiyet','c-green')+
      card('💀',fmt(s.games.lost),'Toplam Mağlubiyet','c-red')+
      card('❤️',fmt(s.games.mvps),'Toplam MVP','c-pink')+
      card('📊','%'+s.games.avgWinRate,'Ort. Kazanma','c-green')+
      card('🎲',s.games.avgGamesPerPlayer,'Kişi Başı Oyun','')+
      card('💝','₺'+s.finance.totalDonations.toFixed(0),'Toplam Bağış','c-pink')+
      card('💰',fmt(s.finance.totalCoins),'Toplam Altın','c-gold')+
      card('📊',fmt(s.finance.avgCoins),'Kişi Başı Altın','c-gold')+
      card('📦',fmt(s.inventory.totalItemsOwned),'Toplam Eşya','')+
      card('🎁',(s.inventory.avgItemsPerUser||'0'),'Kişi Başı Eşya','')+
      card('🐛',s.reports.open,'Açık Bug','c-red')+
      card('✅',s.reports.closed,'Çözülen Bug','c-green')+
      card('📋',(s.reports.resolutionRate||0)+'%','Çözüm Oranı','c-teal')+
      card('📋',s.reports.total,'Toplam Rapor','');

    /* GRAFİKLER */
    if(s.server.history&&s.server.history.length&&pChart){
      pChart.data.labels=s.server.history.map(function(h){ return new Date(h.timestamp).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}); });
      pChart.data.datasets[0].data=s.server.history.map(function(h){ return h.currentActive; });
      pChart.update('none');
    }
    if(s.registrationsByDay&&s.registrationsByDay.length&&rChart){
      rChart.data.labels=s.registrationsByDay.map(function(r){ return new Date(r[0]).toLocaleDateString('tr-TR',{month:'short',day:'numeric'}); });
      rChart.data.datasets[0].data=s.registrationsByDay.map(function(r){ return r[1]; });
      rChart.update('none');
    }
    if(wlChart&&s.games){
      wlChart.data.datasets[0].data=[s.games.won||0,s.games.lost||0];
      wlChart.update();
    }

    /* CANLI ODALAR */
    document.getElementById('rmCnt').textContent='('+s.live.rooms.length+' oda)';
    if(s.live.rooms.length){
      var rh='<table class="dtbl"><thead><tr><th>Kod</th><th>Oyuncu</th><th>İzleyici</th><th>Faz</th><th>Tur</th></tr></thead><tbody>';
      s.live.rooms.forEach(function(rm){
        rh+='<tr><td><b style="color:#64ffda;font-family:monospace;letter-spacing:1px">'+esc(rm.code)+'</b></td>';
        rh+='<td><b>'+rm.playerCount+'</b></td><td>'+(rm.spectatorCount||0)+'</td>';
        rh+='<td><span class="phase '+phaseCls(rm.phase)+'">'+phaseName(rm.phase)+'</span></td>';
        rh+='<td>'+(rm.round>0?rm.round+'. tur':'—')+'</td></tr>';
      });
      rh+='</tbody></table>';
      document.getElementById('rmWrap').innerHTML=rh;
    } else {
      document.getElementById('rmWrap').innerHTML='<p class="empty">Şu an aktif oda yok</p>';
    }

    /* LEADERBOARDlar */
    var tp=s.topPlayers.map(function(p){ return Object.assign({},p,{_stat:'🎮 '+p.played+' / 🏆 '+p.won,_barV:p.played}); });
    var tw=s.topWinners.map(function(p){ return Object.assign({},p,{_stat:'🏆 '+p.won+' (%'+p.winRate+')',_barV:p.won}); });
    var twr=s.topWinRate.map(function(p){ return Object.assign({},p,{_stat:'%'+p.winRate+' ('+p.played+' oyun)',_barV:p.winRate}); });
    var tm=s.topMvps.map(function(p){ return Object.assign({},p,{_stat:'❤️ '+p.mvp+' MVP',_barV:p.mvp}); });
    var tl=s.topLosers.map(function(p){ return Object.assign({},p,{_stat:'💀 '+p.lost+' mağl.',_barV:p.lost}); });
    var tdl=s.topDonors.map(function(p){ return Object.assign({},p,{_stat:'₺'+p.totalDonated.toFixed(0),_barV:p.totalDonated}); });
    var tr2=s.topRichest.map(function(p){ return Object.assign({},p,{_stat:p.coins.toLocaleString('tr-TR')+' 💰',_barV:p.coins}); });

    document.getElementById('lbGrid').innerHTML=
      makeLb('🎮 En Aktif Oyuncular',tp,'','#64ffda')+
      makeLb('🏆 En Çok Kazananlar',tw,'','#27ae60')+
      makeLb('📊 En Yüksek Kazanma Oranı <small style="font-weight:400;color:#555577">(min 5 oyun)</small>',twr,'Henüz 5+ oyun oynayan yok','#27ae60')+
      makeLb('❤️ En Çok MVP Alanlar',tm,'','#e91e63')+
      makeLb('💀 En Çok Kaybeden',tl,'','#ff6b6b')+
      makeLb('💝 En Büyük Destekçiler',tdl,'Henüz bağış yapan yok','#e91e63')+
      makeLb('💰 En Zenginler',tr2,'','#ffd700');

    /* PREMİUM */
    if(s.premiumUsers&&s.premiumUsers.length){
      var ph='<div class="prem-list">';
      s.premiumUsers.forEach(function(p){
        ph+='<div class="prem-tag"><span class="pt-name">👑 '+esc(p.username)+'</span>';
        ph+='<span class="pt-days">'+p.daysLeft+' gün</span>';
        if(p.totalDonated>0) ph+='<span class="pt-don">₺'+p.totalDonated.toFixed(0)+'</span>';
        ph+='</div>';
      });
      ph+='</div>';
      document.getElementById('premList').innerHTML=ph;
      document.getElementById('premSec').style.display='block';
    } else {
      document.getElementById('premSec').style.display='none';
    }

    /* EŞYALAR */
    if(s.inventory.topItems&&s.inventory.topItems.length){
      var maxC=s.inventory.topItems[0].count;
      var ih='<div>';
      s.inventory.topItems.forEach(function(item,i){
        var pct=maxC>0?Math.round(item.count/maxC*100):0;
        ih+='<div class="item-row"><span class="item-rk">'+(i+1)+'</span>';
        ih+='<span class="item-id">'+esc(item.id)+'</span>';
        ih+='<div class="item-bar"><div class="item-bf" style="width:'+pct+'%"></div></div>';
        ih+='<span class="item-cnt">'+item.count+'</span></div>';
      });
      ih+='</div>';
      document.getElementById('itmWrap').innerHTML=ih;
      document.getElementById('itmSec').style.display='block';
    } else {
      document.getElementById('itmSec').style.display='none';
    }

  }catch(e){ console.error('loadAll hatası:',e); }
}

var allUsers=[];

async function loadUsers(){
  if(!tk){ showLogin(); return; }
  try{
    var res=await fetch('/admin/users?token='+encodeURIComponent(tk));
    var d=await res.json();
    if(!d.ok){ if(res.status===403){ showLogin(); } return; }
    allUsers=d.users;
    document.getElementById('usrLoadCnt').textContent='('+allUsers.length+' kullanıcı)';
    filterUsers();
  }catch(e){ console.error('loadUsers hatası:',e); }
}

function filterUsers(){
  var q=(document.getElementById('usrSearch').value||'').toLowerCase();
  var flt=document.getElementById('usrFilter').value;
  var srt=document.getElementById('usrSort').value;
  var list=allUsers.filter(function(u){
    if(q&&!u.username.toLowerCase().includes(q)) return false;
    if(flt==='admin'&&!u.isAdmin) return false;
    if(flt==='premium'&&!(u.premium&&u.premium.active)) return false;
    if(flt==='donor'&&!(u.totalDonated>0)) return false;
    if(flt==='active'&&!(u.stats&&u.stats.played>0)) return false;
    if(flt==='never'&&(u.stats&&u.stats.played>0)) return false;
    return true;
  });
  list.sort(function(a,b){
    if(srt==='created_asc') return (a.created||0)-(b.created||0);
    if(srt==='played_desc') return ((b.stats&&b.stats.played)||0)-((a.stats&&a.stats.played)||0);
    if(srt==='won_desc') return ((b.stats&&b.stats.won)||0)-((a.stats&&a.stats.won)||0);
    if(srt==='coins_desc') return (b.coins||0)-(a.coins||0);
    if(srt==='donated_desc') return (b.totalDonated||0)-(a.totalDonated||0);
    return (b.created||0)-(a.created||0);
  });
  document.getElementById('usrFilterInfo').textContent=list.length+' sonuç';
  var html='';
  if(!list.length){
    html='<tr><td colspan="9" style="text-align:center;color:#555577;padding:24px;font-style:italic">Sonuç bulunamadı</td></tr>';
  } else {
    list.forEach(function(u,i){
      var badges='';
      if(u.isAdmin) badges+='<span class="usr-badge ub-admin">ADMİN</span> ';
      if(u.premium&&u.premium.active) badges+='<span class="usr-badge ub-prem">👑 VIP '+(u.premium.daysLeft||0)+'g</span> ';
      if(u.totalDonated>0) badges+='<span class="usr-badge ub-don">💝</span>';
      var played=(u.stats&&u.stats.played)||0;
      var won=(u.stats&&u.stats.won)||0;
      var wr=played>0?Math.round(won/played*100):0;
      var created=u.created?new Date(u.created).toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
      html+='<tr>';
      html+='<td style="color:#555577;font-size:11px">'+(i+1)+'</td>';
      html+='<td><b style="color:#dde">'+esc(u.username)+'</b></td>';
      html+='<td>'+(badges||'<span style="color:#555577">—</span>')+'</td>';
      html+='<td><b>'+played+'</b></td>';
      html+='<td><div class="wr-cell"><span style="color:#27ae60;font-weight:700">'+won+'</span>'+(played>0?'<div class="wr-bar"><div class="wr-bf" style="width:'+wr+'%"></div></div><span class="wr-pct">%'+wr+'</span>':'')+'</div></td>';
      html+='<td><span style="color:#e91e63">'+((u.stats&&u.stats.mvp)||0)+'</span></td>';
      html+='<td style="color:#ffd700;font-weight:700">'+(u.coins||0).toLocaleString('tr-TR')+'</td>';
      html+='<td>'+(u.totalDonated>0?'<span style="color:#e91e63;font-weight:700">₺'+u.totalDonated.toFixed(0)+'</span>':'<span style="color:#555577">—</span>')+'</td>';
      html+='<td style="color:#555577;font-size:11px">'+created+'</td>';
      html+='</tr>';
    });
  }
  document.getElementById('usrTbody').innerHTML=html;
}

if(tk){ showDash(); }
setInterval(function(){ if(!document.getElementById('dash').classList.contains('hidden')) loadAll(); },30000);
<\/script>
</body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Yasal sayfalar ve iletişim
registerLegalRoutes(app);

// SPA fallback — sadece güvenli yolları index.html'e yönlendir
app.get('*', (req, res) => {
  // Bilinen statik uzantılar 404 döner (gerçek dosya bulunamadıysa)
  if (/\.(env|key|pem|crt|sql|db|log|bak|backup|old|swp|swo|json|yml|yaml|md|gitignore|htaccess|config|conf|ini|toml)$/i.test(req.path)) {
    return res.status(404).send('Not Found');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
const rooms = new Map(), prooms = new Map(), authed = new Map(), timers = new Map();
const disconnectTimers = new Map(); // socketId -> timeoutId (3dk sonra oyundan otomatik çıkar)
const mkStates = new Map(); // rc -> MK game state (Matrix Krallığı modu)
const MK = require('./matrixKingdom');

// ── ÖDEME SİSTEMİ BAŞLAT (authed tanımlandıktan sonra) ──
const { setupPayment } = require('./payment');
setupPayment(app, io, {
  packages: PAYMENT_PACKAGES,
  donationPresets: DONATION_PRESETS,
  getUser: (username) => Accounts.getStats(username),
  applyPayment,
  authed,
  paymentLimiter,
  apiLimiter
});

// ── ANLİK ZİYARETÇİ İSTATİSTİKLERİ (sadece sayaçlar, IP kaydetmiyoruz) ──
const siteStats = {
  totalConnections: 0,      // Başarılı socket bağlantısı sayısı
  peakConcurrent: 0,        // Aynı anda en fazla kaç kişi
  currentActive: 0,         // Şu an sitede olan
  startedAt: Date.now(),     // Sunucu başlangıç zamanı
  history: []               // Rolling window: son 5 dakika (max 60 kayıt)
};

// Her 5 saniyede bir snapshot al (Rolling Window)
const HISTORY_MAX = 60; // 5 dakika = 60 x 5 saniye
setInterval(() => {
  siteStats.history.push({
    timestamp: Date.now(),
    currentActive: siteStats.currentActive,
    activeRooms: rooms.size,
    playersInRooms: Array.from(rooms.values()).reduce((sum, g) => sum + g.players.size, 0)
  });
  // Sadece son 60 kaydı tut (5 dk)
  if (siteStats.history.length > HISTORY_MAX) {
    siteStats.history.shift();
  }
}, 5000);


function genCode() { let c; do { c = String(crypto.randomInt(1000, 10000)); } while (rooms.has(c)); return c; }

// ── BOT SİSTEMİ (test amaçlı, sadece adminler ekleyebilir) ──
const BOT_NAMES = ['Ali','Veli','Ayşe','Fatma','Mehmet','Zeynep','Can','Selin','Mert','Ece','Burak','Deniz','Cem','Elif','Onur','Sude','Kerem','Ela','Tolga','Naz'];
let _botCounter = 0;
function genBotId() { return `BOT_${++_botCounter}_${crypto.randomInt(1000, 9999)}`; }
function pickBotName(g) {
  const used = new Set([...g.players.values()].map(p => p.name));
  const avail = BOT_NAMES.filter(n => !used.has(n));
  if (avail.length > 0) return avail[crypto.randomInt(0, avail.length)];
  return `Bot${_botCounter}`;
}
function pickRandom(arr) { return arr.length ? arr[crypto.randomInt(0, arr.length)] : null; }

// Bir botun verilen fazda otomatik aksiyonunu uygular
function runBotForPhase(rc, botId) {
  const g = rooms.get(rc); if (!g) return;
  const p = g.players.get(botId); if (!p || !g.isBot(botId)) return;

  if (g.phase === PHASES.ROLE_SELECTION) {
    if (g.roleSelectionOrder[g.roleSelectionIndex] === botId) {
      g.submitRoleChoice(botId, 'random');
    }
  } else if (g.phase === PHASES.PRESIDENT_VOTE) {
    if (!p.isAlive) return;
    const candidates = g.alive().filter(x => x.id !== botId);
    const target = pickRandom(candidates);
    if (target) g.submitPresidentVote(botId, target.id);
  } else if (g.phase === PHASES.NIGHT) {
    if (!p.isAlive) return;
    botSubmitNightAction(g, botId);
  } else if (g.phase === PHASES.VOTING) {
    if (!p.isAlive || g.frozen?.has(botId)) return;
    // %20 ihtimalle pas geç, yoksa rastgele birine oy ver
    if (crypto.randomInt(0, 100) < 20) { g.submitVote(botId, 'skip'); return; }
    const candidates = g.alive().filter(x => x.id !== botId);
    const target = pickRandom(candidates);
    if (target) g.submitVote(botId, target.id);
    else g.submitVote(botId, 'skip');
  } else if (g.phase === 'mvp_vote') {
    const candidates = [...g.players.values()].filter(x => x.id !== botId);
    const target = pickRandom(candidates);
    if (target) g.submitMvpVote(botId, target.id);
  }
}

function botSubmitNightAction(g, botId) {
  const p = g.players.get(botId); if (!p) return;
  const role = p.role;
  const aliveOthers = g.alive().filter(x => x.id !== botId);
  const aliveAll = g.alive();
  const passive = ['muhtar','dodo','cellat','yamyam','kurban','koruyucu','engizitor','olumsuz'];
  if (passive.includes(role)) return;

  // Hain takım: rastgele kill ya da rol yeteneği
  if (p.actualTeam === TEAMS.HAIN) {
    if (role === 'bombaci') {
      // %50 bomba koy, %50 patlat (bombası varsa)
      const myBombs = [...(g.bombs?.keys?.() || [])].filter(bid => g.bombs.get(bid)?.ownerId === botId);
      if (myBombs.length > 0 && crypto.randomInt(0, 2) === 0) {
        g.submitAction(botId, { action: 'detonate' });
      } else {
        const target = pickRandom(aliveOthers);
        if (target) g.submitAction(botId, { action: 'place', targetId: target.id });
      }
      return;
    }
    if (role === 'suikastci') {
      // Gece sadece kill oyu (suikast gündüz)
      const target = pickRandom(aliveOthers);
      if (target) g.submitAction(botId, { action: 'kill', killTargetId: target.id });
      return;
    }
    // Diğer hainler: %60 kill, %40 ability
    const useKill = crypto.randomInt(0, 100) < 60;
    const target = pickRandom(aliveOthers);
    if (!target) return;
    if (useKill) g.submitAction(botId, { action: 'kill', killTargetId: target.id });
    else g.submitAction(botId, { action: 'ability', targetId: target.id });
    return;
  }

  // Seri katil
  if (role === 'seri_katil') {
    const target = pickRandom(aliveOthers);
    if (target) g.submitAction(botId, { action: 'kill', killTargetId: target.id });
    return;
  }

  // Masum / tarafsız roller
  if (role === 'dedikoducu') {
    // İki hedef
    if (aliveOthers.length >= 2) {
      const a = pickRandom(aliveOthers);
      const b = pickRandom(aliveOthers.filter(x => x.id !== a.id));
      if (a && b) g.submitAction(botId, { role, targetId: a.id, targetId2: b.id });
    }
    return;
  }
  if (role === 'gazi') {
    // Tek kullanım: %30 ihtimal aktive et
    if (!g.gaziUsed?.has(botId) && crypto.randomInt(0, 100) < 30) {
      g.submitAction(botId, { role, targetId: botId });
    }
    return;
  }
  if (role === 'gardiyan') {
    if (!g.gardiyanUsed?.has(botId) && crypto.randomInt(0, 100) < 20) {
      g.submitAction(botId, { role, targetId: botId });
    }
    return;
  }
  if (role === 'pusucu') {
    g.submitAction(botId, { role, targetId: botId });
    return;
  }
  if (role === 'serif') {
    if (g.serifUsed?.has(botId)) return;
    // %25 ihtimal vur
    if (crypto.randomInt(0, 100) < 25) {
      const target = pickRandom(aliveOthers);
      if (target) g.submitAction(botId, { role, targetId: target.id });
    }
    return;
  }
  if (role === 'savci' && g.savciUsed?.has(botId)) return;
  if (role === 'demirci') {
    // Kendine yapamaz
    const target = pickRandom(aliveOthers);
    if (target) g.submitAction(botId, { role, targetId: target.id });
    return;
  }
  if (role === 'infazci') {
    const target = pickRandom(aliveOthers);
    if (target) g.submitAction(botId, { role, targetId: target.id, execute: false });
    return;
  }
  // Genel: tek hedef seç
  const target = pickRandom(aliveOthers);
  if (target) g.submitAction(botId, { role, targetId: target.id });
}

// Belirli faza geçildiğinde tüm botları sıraya alıp aksiyonlarını uygular
function runAllBots(rc) {
  const g = rooms.get(rc); if (!g) return;
  if (g.bots.size === 0) return;
  // Rastgele 0.5-3sn gecikme ile her bot aksiyon yapar (gerçekçilik)
  [...g.bots].forEach(botId => {
    const delay = 500 + crypto.randomInt(0, 2500);
    setTimeout(() => {
      const g2 = rooms.get(rc); if (!g2) return;
      if (!g2.players.has(botId)) return;
      runBotForPhase(rc, botId);
      // Faz-spesifik post-emit
      if (g2.phase === PHASES.VOTING) {
        emitVoteTally(rc);
        maybeResolveVoteIfEveryoneOnlineVoted(rc, g2);
      } else if (g2.phase === PHASES.PRESIDENT_VOTE) {
        io.to(rc).emit('presidentVoteTally', g2.getPresidentVoteTally());
        const aliveCount = g2.alive().length;
        if (g2.presidentVotes.size >= aliveCount) {
          clearTimer(rc);
          g2.resolvePresidentVote(); emit(rc);
          setTimeout(() => toNight(rc), 2000);
        }
      } else if (g2.phase === 'mvp_vote') {
        io.to(rc).emit('mvpTally', g2.getMvpTally());
        if (g2.mvpVotes.size >= g2.players.size) {
          clearTimer(rc);
          resolveMvp(rc);
        }
      } else if (g2.phase === PHASES.ROLE_SELECTION) {
        emit(rc);
      }
    }, delay);
  });
}
function startTimer(rc, dur, cb) {
  clearTimer(rc);
  const end = Date.now() + dur * 1000;
  timers.set(rc, setInterval(() => {
    const rem = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    io.to(rc).emit('timer', { rem, total: dur });
    if (rem <= 0) { clearTimer(rc); cb(); }
  }, 1000));
}
// Aynı kullanıcının başka socket'lerini kapat (çift bağlantı sorununu engelle)
function kickOldSessions(username, currentSocketId) {
  if (!username) return;
  const uname = username.toLowerCase().trim();
  const toKick = [];
  authed.forEach((u, sid) => {
    if (sid !== currentSocketId && u && u.toLowerCase().trim() === uname) {
      toKick.push(sid);
    }
  });
  toKick.forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    // Önce odayı temizle (duplicate oyuncu sorununu engelle)
    const oldRc = prooms.get(sid);
    if (oldRc) {
      const oldG = rooms.get(oldRc);
      if (oldG) {
        // Lobide veya post-game'de ise tamamen çıkar, aktif oyunda ise sadece bağlantıyı kopar (rejoin ile dönebilir)
        if (oldG.phase === PHASES.LOBBY || oldG.phase === PHASES.POST_GAME) {
          oldG.removePlayer(sid);
          oldG.removeSpectator(sid);
          if (oldG.players.size === 0 && oldG.spectators.size === 0) { rooms.delete(oldRc); clearTimer(oldRc); }
          else if (oldG.leaderId === sid && oldG.players.size > 0) oldG.leaderId = [...oldG.players.keys()][0];
        }
      }
      prooms.delete(sid);
    }
    if (s) {
      s.emit('forceLogout', { reason: 'Başka bir cihazda giriş yapıldı.' });
      s.disconnect(true);
    }
    authed.delete(sid);
  });
}

function clearTimer(rc) {
  if (timers.has(rc)) { clearInterval(timers.get(rc)); timers.delete(rc); }
  // Emit throttle timer'ı da temizle (oda silinirken)
  if (_emitTimers.has(rc)) { clearTimeout(_emitTimers.get(rc)); _emitTimers.delete(rc); }
  _emitPending.delete(rc);
  mkStates.delete(rc); // MK state temizle
}
function eligibleVotingCount(g) {
  return g.alive().filter(p => !g.frozen.has(p.id) && io.sockets.sockets.has(p.id)).length;
}

function maybeResolveVoteIfEveryoneOnlineVoted(rc, g) {
  if (!g || g.phase !== PHASES.VOTING) return;
  const eligibleIds = g.alive().filter(p => !g.frozen.has(p.id) && io.sockets.sockets.has(p.id)).map(p => p.id);
  const votedEligible = eligibleIds.filter(id => g.votes.has(id)).length;
  if (eligibleIds.length > 0 && votedEligible >= eligibleIds.length) {
    if (g.sabotagePending && !g.hasActiveSabotage?.()) {
      triggerPendingSabotageNow(rc);
      return;
    }
    if (g.hasActiveSabotage?.()) return;
    clearTimer(rc);
    resolveVote(rc);
  }
}
// Faz akışı
function afterStart(rc) {
  const g = rooms.get(rc); if (!g) return;
  if (g.phase === PHASES.ROLE_SELECTION) {
    // Her oyuncuya max 25 saniye süre — otomatik geçişler
    startTimer(rc, g.config.ROLE_SELECTION_DURATION, () => autoPickIfNeeded(rc));
    emit(rc);
    runAllBots(rc);
  } else if (g.phase === PHASES.ROLE_REVEAL) {
    emit(rc);
    startTimer(rc, g.config.ROLE_REVEAL_DURATION, () => toPresidentVote(rc));
  }
}

function autoPickIfNeeded(rc) {
  const g = rooms.get(rc); if (!g) return;
  if (g.phase !== PHASES.ROLE_SELECTION) return;
  // Sıradaki oyuncu seçim yapmadıysa rastgeleye basılmış say
  const cur = g.roleSelectionOrder[g.roleSelectionIndex];
  if (!cur) return;
  const r = g.submitRoleChoice(cur, 'random');
  emit(rc);
  if (r?.done) {
    // Rol seçim bitti → Role reveal
    startTimer(rc, g.config.ROLE_REVEAL_DURATION, () => toPresidentVote(rc));
  } else {
    // Sıradakine geç
    startTimer(rc, g.config.ROLE_SELECTION_DURATION, () => autoPickIfNeeded(rc));
    runAllBots(rc);
  }
}

function toPresidentVote(rc) {
  const g = rooms.get(rc); if (!g) return;
  g.startPresidentVote(); emit(rc);
  runAllBots(rc);
  startTimer(rc, g.config.PRESIDENT_VOTE_DURATION, () => {
    g.resolvePresidentVote(); emit(rc);
    setTimeout(() => toNight(rc), 2000);
  });
}

function toNight(rc) { const g = rooms.get(rc); if (!g) return; g.startNight(); emit(rc); startTimer(rc, g.config.NIGHT_DURATION, () => resolveNight(rc)); runAllBots(rc); }
function resolveNight(rc) {
  const g = rooms.get(rc); if (!g) return;
  const reps = g.resolveNight(); emit(rc);
  g.players.forEach((_, pid) => io.sockets.sockets.get(pid)?.emit('report', { reports: reps.get(pid) || [], round: g.round }));
  // Bomba patladıysa tüm odaya bildir (efekt için)
  if (g.bombExplosions && g.bombExplosions.length > 0) {
    io.to(rc).emit('bombExplosion', { victims: g.bombExplosions });
  }
  // ÖNEMLİ: Gece bittikten sonra oyun bitti mi kontrol et
  const wc = g.checkWin();
  if (wc.over) {
    setTimeout(() => endGame(rc, wc, null), g.config.REPORT_DURATION * 1000);
    return;
  }
  startTimer(rc, g.config.REPORT_DURATION, () => toDay(rc));
}
function toDay(rc) {
  const g = rooms.get(rc); if (!g) return;
  g.startDiscussion();
  emit(rc);
  startTimer(rc, g.config.DISCUSSION_DURATION, () => toVote(rc));

  // ── HAIN/VAMPİR SABOTAJI ──
  // Gündüz veya oylama boyunca rastgele zamanda başlayabilir.
  if (g.sabotagePending) {
    const triggerAt = crypto.randomInt(0, (g.config.DISCUSSION_DURATION + g.config.VOTING_DURATION) * 1000 + 1);
    setTimeout(() => {
      if (!rooms.has(rc)) return;
      if (g.phase !== PHASES.DAY_DISCUSSION && g.phase !== PHASES.VOTING) return;
      if (g.sabotageActive) return;
      const ok = g.triggerSabotage(!!g.sabotagePendingFromSystem);
      if (ok) {
        io.to(rc).emit('sabotage:start', {
          targetIds: [...g.sabotageTargets.keys()],
          fromSystem: !!g.sabotagePendingFromSystem
        });
        watchSabotage(rc);
        emit(rc);
      }
    }, triggerAt);
  } else {
    // ── SİSTEM RANDOM SABOTAJI (~%20 ihtimal, hain sabotajı yoksa) ──
    if (crypto.randomInt(0, 100) < 20) {
      const triggerAt = crypto.randomInt(0, (g.config.DISCUSSION_DURATION + g.config.VOTING_DURATION) * 1000 + 1);
      setTimeout(() => {
        if (!rooms.has(rc)) return;
        if (g.phase !== PHASES.DAY_DISCUSSION && g.phase !== PHASES.VOTING) return;
        if (g.sabotageActive || g.sabotagePending) return;
        const ok = g.triggerSabotage(true);
        if (ok) {
          io.to(rc).emit('sabotage:start', {
            targetIds: [...g.sabotageTargets.keys()],
            fromSystem: true
          });
          watchSabotage(rc);
          emit(rc);
        }
      }, triggerAt);
    }
  }
}

function triggerPendingSabotageNow(rc) {
  const g = rooms.get(rc); if (!g) return false;
  if (!g.sabotagePending || g.hasActiveSabotage?.()) return false;
  if (g.phase !== PHASES.DAY_DISCUSSION && g.phase !== PHASES.VOTING) return false;
  const ok = g.triggerSabotage(!!g.sabotagePendingFromSystem, true);
  if (ok) {
    io.to(rc).emit('sabotage:start', {
      targetIds: [...g.sabotageTargets.keys()],
      fromSystem: !!g.sabotagePendingFromSystem,
      forced: true
    });
    watchSabotage(rc);
    emit(rc);
  }
  return ok;
}

function toVote(rc) {
  const g = rooms.get(rc); if (!g) return;
  g.startVoting();
  emit(rc);
  startTimer(rc, g.config.VOTING_DURATION, () => resolveVote(rc));
  runAllBots(rc);
}
function resolveVote(rc) {
  const g = rooms.get(rc); if (!g) return;
  if (g.phase !== PHASES.VOTING) return;
  if (g.sabotagePending && !g.hasActiveSabotage?.()) {
    triggerPendingSabotageNow(rc);
  }
  if (g.hasActiveSabotage?.()) {
    clearTimer(rc);
    emit(rc);
    setTimeout(() => resolveVote(rc), 1000);
    return;
  }
  const res = g.resolveVoting();
  io.to(rc).emit('voteResult', res); emit(rc);
  let wc = g.checkWin();
  // Dodo kendini astırırsa anında oyun biter, tek başına kazanır
  if (!wc.over && res.dodoWins) {
    wc = { over: true, winner: 'dodo', msg: '🦤 Dodo kazandı! Kendini astırdı!' };
  } else if (res.cellatWins) {
    // Cellat hedefini astırdı: oyunu bitirme, sadece bildirim ve kazanma kayıtı
    // (Cellat artık kazananlar listesinde olacak ama oyun devam eder)
    const cellat = g.players.get(res.cellatWins);
    const target = g.players.get(g.cellatTarget.get(res.cellatWins));
    // ÖNEMLİ: cellat ismi tüm odaya gönderilmez (gizlilik). Sadece hedefin adı + cellat kurbanı olduğu bildirimi.
    io.to(rc).emit('cellatVictory', {
      targetName: target?.name || '?'
    });
    // Cellata özel bildirim (sadece kendisi görür)
    io.sockets.sockets.get(res.cellatWins)?.emit('cellatPrivateWin', {
      targetName: target?.name || '?'
    });
    g.log(`⛓️ Cellat ${cellat?.name} hedefi ${target?.name}'i astırdı!`);
  }
  if (wc.over) {
    setTimeout(() => endGame(rc, wc, res), g.config.RESULT_DURATION * 1000);
  } else {
    startTimer(rc, g.config.RESULT_DURATION, () => toNextNightAfterVote(rc));
  }
}

function toNextNightAfterVote(rc) {
  const g = rooms.get(rc); if (!g) return;
  if (g.sabotagePending && !g.hasActiveSabotage?.()) {
    triggerPendingSabotageNow(rc);
  }
  if (g.hasActiveSabotage?.()) {
    emit(rc);
    setTimeout(() => toNextNightAfterVote(rc), 1000);
    return;
  }
  g.nextRound();
  emit(rc);
  startTimer(rc, g.config.NIGHT_DURATION, () => resolveNight(rc));
  runAllBots(rc);
}
function endGame(rc, wc, res) {
  const g = rooms.get(rc); if (!g) return;
  g.phase = PHASES.GAME_OVER;
  g.gameEnded = true;

  // Kazananları wc.winner'a göre hesapla
  const winnerKey = wc.winner;
  const winnerPlayers = [...g.players.values()].filter(p => {
    // Cellat hedefini astırmışsa daima kazanır
    if (p.role === 'cellat' && g.cellatWon.has(p.id)) return true;
    // Yamyam: masum veya hain kazanırsa o da
    if (p.role === 'yamyam' && (winnerKey === TEAMS.MASUM || winnerKey === TEAMS.HAIN)) return true;
    // Koruyucu: koruduğu kişi hayattaysa
    if (p.role === 'koruyucu') {
      const targetId = g.koruyucuTargets.get(p.id);
      const target = targetId ? g.players.get(targetId) : null;
      return !!(target?.isAlive);
    }
    // Veba kazandıysa sadece veba
    if (winnerKey === 'veba') return p.role === 'veba';
    if (winnerKey === p.actualTeam) return true;
    if (winnerKey === 'seri_katil' && p.role === 'seri_katil') return true;
    if (winnerKey === 'dodo' && p.role === 'dodo') return true;
    return false;
  });
  const winnerUsernames = winnerPlayers.map(p => p.username).filter(Boolean);
  const winnerSet = new Set(winnerUsernames);
  winnerUsernames.forEach(u => Accounts.record(u, true));
  [...g.players.values()].map(p => p.username).filter(u => u && !winnerSet.has(u)).forEach(u => Accounts.record(u, false));

  // ── COIN DAĞITIMI ──
  // Kazanan: +20 coin (oyuna katılma + kazanma bonusu)
  // Kaybeden: +5 coin (oyuna katıldı)
  // Bahis havuzu: kazanan oyuncular arasında, koydukları orana göre dağıtılır + kazanma bonusu zaten eklendi
  const bets = g.bets || new Map(); // username -> betAmount
  const totalBetPool = [...bets.values()].reduce((a, b) => a + b, 0);
  // Kazanan kullanıcıların toplam bahis miktarı (pay hesabı için)
  const winnerBetTotal = [...bets.entries()]
    .filter(([uname, _]) => winnerSet.has(uname))
    .reduce((a, [_, amt]) => a + amt, 0);

  const coinUpdates = {}; // username -> { coinChange, totalCoins }
  const coinUpdatesById = {}; // socketId -> { coinChange, totalCoins } (login olmayanlar için fallback)

  // Tüm oyuncular için coin dağıtımı
  [...g.players.values()].forEach(p => {
    if (!p.username) return;
    let change = 0;
    if (winnerSet.has(p.username)) {
      change += 20; // Kazanma bonusu
      // Bahis payı: koyduğu oran kadar payını alır
      if (winnerBetTotal > 0 && bets.has(p.username)) {
        const myBet = bets.get(p.username);
        const myShare = Math.floor((myBet / winnerBetTotal) * totalBetPool);
        change += myShare;
      }
    } else {
      change += 5; // Katılım ödülü
      // Bahis kaybedildi (zaten lobide düşürüldü, geri verilmez)
    }
    if (change !== 0) {
      const r = Accounts.addCoins(p.username, change);
      coinUpdates[p.username] = { coinChange: change, totalCoins: r.coins };
      coinUpdatesById[p.id] = { coinChange: change, totalCoins: r.coins };
    }
  });

  // Stats güncellemesi
  g.players.forEach(p => {
    const stats = Accounts.getStats(p.username);
    if (stats) {
      p.wins = stats.stats.won;
      p.mvp = stats.stats.mvp || 0;
      io.sockets.sockets.get(p.id)?.emit('statsUpdate', stats);
    }
  });

  const data = {
    ...wc, dodoWins: res?.dodoWins, cellatWins: res?.cellatWins,
    coinUpdates, // username -> {coinChange, totalCoins}
    coinUpdatesById, // socketId -> {coinChange, totalCoins} fallback
    totalBetPool,
    players: [...g.players.values()].map(p => {
      const ro = g.ro(p.role);
      return {
        id: p.id, name: p.name, username: p.username, avatar: p.avatar,
        cosmetics: p.cosmetics || {},
        role: p.role, roleName: ro?.name, roleEmoji: ro?.emoji,
        team: p.actualTeam, isAlive: p.isAlive, isInsane: p.isInsane,
        isWinner: winnerSet.has(p.username),
        coinChange: coinUpdates[p.username]?.coinChange || 0
      };
    }),
    winners: winnerPlayers.map(p => ({
      id: p.id, name: p.name, username: p.username, avatar: p.avatar,
      cosmetics: p.cosmetics || {},
      roleName: g.ro(p.role)?.name, roleEmoji: g.ro(p.role)?.emoji,
      isInsane: p.isInsane,
      coinChange: coinUpdates[p.username]?.coinChange || 0
    }))
  };
  g.gameResult = data;
  io.to(rc).emit('gameOver', data); emit(rc);

  // 5 saniye sonra MVP oylama başlat
  setTimeout(() => {
    if (rooms.get(rc) && rooms.get(rc).phase === PHASES.GAME_OVER) {
      startMvpVote(rc);
    }
  }, 5000);
}

function startMvpVote(rc) {
  const g = rooms.get(rc); if (!g) return;
  g.startMvpVote();
  emit(rc);
  startTimer(rc, g.config.MVP_VOTE_DURATION, () => resolveMvp(rc));
  runAllBots(rc);
}

function resolveMvp(rc) {
  const g = rooms.get(rc); if (!g) return;
  const result = g.resolveMvpVote();
  // MVP'ye 1 puan kaydet + 5 coin
  if (result.mvp?.username) {
    Accounts.recordMvp(result.mvp.username);
    Accounts.addCoins(result.mvp.username, 5);
    // Stats güncellemesi: TÜM oyuncuları senkronla
    g.players.forEach(p => {
      const stats = Accounts.getStats(p.username);
      if (stats) {
        p.wins = stats.stats.won;
        p.mvp = stats.stats.mvp || 0;
        const s = io.sockets.sockets.get(p.id);
        if (s) s.emit('statsUpdate', stats);
      }
    });
  }
  io.to(rc).emit('mvpResult', result);
  emit(rc);
  startTimer(rc, g.config.MVP_RESULT_DURATION, () => {
    g.phase = PHASES.POST_GAME;
    emit(rc);
  });
}

// Emit throttling - aynı odaya kısa süre içinde birden fazla emit gelirse birleştir
const _emitTimers = new Map(); // rc -> timeout id
const _emitPending = new Set(); // rc set
const sabotageWatchers = new Map(); // rc -> interval id

function emit(rc) {
  // Aynı oda için 50ms içinde tekrarlanan emit'leri tek bir gerçek emit'e indir
  if (_emitTimers.has(rc)) {
    _emitPending.add(rc);
    return;
  }
  _emitImmediate(rc);
  _emitTimers.set(rc, setTimeout(() => {
    _emitTimers.delete(rc);
    if (_emitPending.has(rc)) {
      _emitPending.delete(rc);
      _emitImmediate(rc);
    }
  }, 50));
}

function watchSabotage(rc) {
  if (sabotageWatchers.has(rc)) return;
  const int = setInterval(() => {
    const g = rooms.get(rc);
    if (!g) {
      clearInterval(int);
      sabotageWatchers.delete(rc);
      return;
    }
    emit(rc);
    if (!g.hasActiveSabotage?.()) {
      clearInterval(int);
      sabotageWatchers.delete(rc);
      emit(rc);
      // Sabotaj bitti — tüm oylar geldiyse hemen çöz
      maybeResolveVoteIfEveryoneOnlineVoted(rc, g);
    }
  }, 1000);
  sabotageWatchers.set(rc, int);
}

function _emitImmediate(rc) {
  const g = rooms.get(rc); if (!g) return;
  const mk = mkStates.get(rc);
  try {
    // ── MATRIX KRALLIĞI MODU ──
    if (mk) {
      const pub = { phase: 'mk_active', mkState: MK.getPublicState(mk, g.players), leaderId: g.leaderId };
      io.to(rc).emit('state', pub);
      mk.players.forEach((_, pid) => {
        const sock = io.sockets.sockets.get(pid);
        if (!sock) return;
        try { sock.emit('priv', MK.getPrivateState(mk, pid)); } catch(e) {}
      });
      return;
    }

    const pub = g.publicState();
    if (g.mkMode) pub.mkMode = true; // lobiyi bilgilendir
    io.to(rc).emit('state', pub);
    // Sadece odadaki canlı/ölü oyunculara priv gönder (not: spec data sadece ölülere gönderiliyor)
    let spec = null;
    g.players.forEach((p, pid) => {
      const sock = io.sockets.sockets.get(pid);
      if (!sock) return;
      try { sock.emit('priv', g.privateState(pid)); } catch(e) { console.error('[emit] priv hatası:', pid, e.message); }
      if (!p.isAlive) {
        if (!spec) spec = g.spectatorState(); // lazy compute
        sock.emit('spec', spec);
      }
      // Sesli sohbet: bu oyuncunun bağlanması gereken peer listesi
      try {
        const peers = g.getVoicePeers(pid);
        const canSpeak = g.canSpeak(pid);
        sock.emit('voice:peers', { peers, canSpeak, turnServers: TURN_CONFIG });
      } catch(e) { /* voice opsiyonel — hata oyunu durdurmasın */ }
    });
    if (g.spectators.size > 0) {
      if (!spec) spec = g.spectatorState();
      g.spectators.forEach((_, sid) => io.sockets.sockets.get(sid)?.emit('spec', spec));
    }
  } catch(err) {
    console.error('[emit] Kritik hata, oda:', rc, err.message, err.stack?.split('\n')[1]);
  }
}

// ── MATRIX KRALLIĞI YARDIMCI FONKSİYONLARI ──
function resolveMKVote(rc) {
  const g = rooms.get(rc), mk = mkStates.get(rc);
  if (!g || !mk || mk.phase !== 'vote') return;
  let ja = 0, nein = 0;
  mk.votes.forEach(v => { if (v === 'ja') ja++; else nein++; });
  const approved = ja > nein;
  const leaderName = mk.players.get(mk.currentLeaderId)?.name || '?';
  const partnerName = mk.players.get(mk.nominatedPartnerId)?.name || '?';
  mk.eventLog.push(`Oylama: ${leaderName}+${partnerName} → ${approved ? 'ONAYLANDI' : 'REDDEDİLDİ'} (${ja}JA/${nein}NEIN)`);
  io.to(rc).emit('mk:vote_result', { approved, ja, nein, leaderName, partnerName });

  if (approved) {
    // Kral+Yaver kazanma koşulu kontrol
    const kingWin = MK.checkKingPartnerApproved(mk);
    if (kingWin.over) { endMKGame(rc, kingWin); return; }
    mk.chaosCounter = 0;
    MK.reshuffleIfNeeded(mk, 3);
    mk.phase = 'card_leader';
    mk.pendingCards = mk.deck.splice(0, 3);
    if (mk.pendingCards.length === 0) {
      // Deste tamamen bitti ve discard pile da boş → oyun beraberliğiyle biter
      endMKGame(rc, { winner: 'draw', reason: 'Deste ve discard pile tükendi!' });
      return;
    }
  } else {
    mk.chaosCounter++;
    mk.nominatedPartnerId = null;
    if (mk.chaosCounter >= 3) {
      // Kaos: destenin üstünden otomatik kart çek
      MK.reshuffleIfNeeded(mk, 1);
      const card = mk.deck.shift();
      mk.chaosCounter = 0; // her durumda sıfırla
      if (card) {
        mk.board[card]++;
        mk.lastCard = card;
        mk.eventLog.push(`KAOS: Kart otomatik çekildi → ${card === 'matrix' ? 'MATRIX' : 'ASİ'}`);
        io.to(rc).emit('mk:card_played', { card, board: { ...mk.board }, chaos: true });
        const wc = MK.checkWin(mk);
        if (wc.over) { endMKGame(rc, wc); return; }
        if (card === 'rebel') {
          const power = MK.powerForRebel(mk.board.rebel, mk.smallGame);
          if (power) { mk.pendingPower = { type: power }; mk.phase = 'power'; emit(rc); setTimeout(() => runMKBots(rc), 800); return; }
        }
      } else {
        mk.eventLog.push('Kaos: Deste boş, kart çekilemedi');
      }
    }
    MK.advanceLeader(mk);
    mk.phase = 'nomination';
  }
  emit(rc);
  setTimeout(() => runMKBots(rc), 800);
}

function endMKGame(rc, result) {
  const g = rooms.get(rc), mk = mkStates.get(rc);
  if (!g || !mk) return;
  mk.winner = result.winner;
  mk.winReason = result.reason;
  mk.phase = 'game_over';
  mk.rolesRevealed = [...mk.players.values()].map(p => ({ id: p.id, name: p.name, role: p.role, isAlive: p.isAlive }));
  // MK modunda istatistik ve coin değişikliği yok — lider yeni oyun başlatana kadar bekle
  emit(rc);
  io.to(rc).emit('mk:game_over', { winner: result.winner, reason: result.reason, roles: mk.rolesRevealed });
}

function runMKBots(rc) {
  const g = rooms.get(rc), mk = mkStates.get(rc);
  if (!g || !mk || mk.winner) return;

  const isBotId = id => g.isBot(id);
  const alive = MK.getAlive(mk);
  const rebelSide = new Set(['traitor', 'king']);

  if (mk.phase === 'intro') {
    mk.players.forEach((_, id) => { if (isBotId(id)) mk.readySet.add(id); });
    if (mk.readySet.size >= mk.players.size) {
      mk.phase = 'nomination';
      emit(rc);
      setTimeout(() => runMKBots(rc), 800);
    } else {
      emit(rc);
    }
    return;
  }

  if (mk.phase === 'nomination') {
    if (!isBotId(mk.currentLeaderId)) return;
    const eligible = MK.getEligiblePartners(mk);
    if (!eligible.length) return;
    const partner = eligible[crypto.randomInt(0, eligible.length)];
    mk.nominatedPartnerId = partner.id;
    mk.phase = 'vote';
    mk.votes = new Map();
    const leaderName = mk.players.get(mk.currentLeaderId)?.name || '?';
    mk.eventLog.push(`${leaderName} yaverini ${partner.name} olarak seçti`);
    emit(rc);
    setTimeout(() => runMKBots(rc), 600);
    return;
  }

  if (mk.phase === 'vote') {
    const leaderId = mk.currentLeaderId;
    const partnerId = mk.nominatedPartnerId;
    const leaderRole = mk.players.get(leaderId)?.role;
    const partnerRole = mk.players.get(partnerId)?.role;
    let anyVoted = false;
    alive.forEach(p => {
      if (!isBotId(p.id) || mk.votes.has(p.id)) return;
      let vote;
      if (rebelSide.has(p.role)) {
        vote = (rebelSide.has(leaderRole) || rebelSide.has(partnerRole)) ? 'ja' : 'nein';
      } else {
        vote = mk.board.rebel >= 3 ? (crypto.randomInt(0, 2) === 0 ? 'nein' : 'ja') : 'ja';
      }
      mk.votes.set(p.id, vote);
      anyVoted = true;
    });
    if (anyVoted) {
      emit(rc);
      if (mk.votes.size >= alive.length) setTimeout(() => resolveMKVote(rc), 600);
    }
    return;
  }

  if (mk.phase === 'card_leader') {
    if (!isBotId(mk.currentLeaderId)) return;
    if (!mk.pendingCards.length) return; // boş deste güvencesi
    const leaderRole = mk.players.get(mk.currentLeaderId)?.role;
    let discardIndex = rebelSide.has(leaderRole)
      ? mk.pendingCards.findIndex(c => c === 'matrix')
      : mk.pendingCards.findIndex(c => c === 'rebel');
    if (discardIndex === -1) discardIndex = 0;
    const botDiscarded = mk.pendingCards.splice(discardIndex, 1)[0];
    MK.discardCard(mk, botDiscarded);
    mk.phase = 'card_partner';
    emit(rc);
    setTimeout(() => runMKBots(rc), 600);
    return;
  }

  if (mk.phase === 'card_partner') {
    if (!isBotId(mk.nominatedPartnerId)) return;
    if (!mk.pendingCards.length) return; // boş deste güvencesi
    const partnerRole = mk.players.get(mk.nominatedPartnerId)?.role;
    let deployIndex = rebelSide.has(partnerRole)
      ? mk.pendingCards.findIndex(c => c === 'rebel')
      : mk.pendingCards.findIndex(c => c === 'matrix');
    if (deployIndex === -1) deployIndex = 0;
    const card = mk.pendingCards[deployIndex];
    mk.termLock = { leaderId: mk.currentLeaderId, partnerId: mk.nominatedPartnerId };
    mk.board[card]++;
    mk.lastCard = card;
    mk.pendingCards = [];
    const leaderName = mk.players.get(mk.currentLeaderId)?.name || '?';
    const partnerName = mk.players.get(mk.nominatedPartnerId)?.name || '?';
    mk.eventLog.push(`${leaderName} + ${partnerName} → ${card === 'matrix' ? 'MATRIX' : 'ASİ'} kartı`);
    io.to(rc).emit('mk:card_played', { card, board: { ...mk.board } });
    const wc = MK.checkWin(mk);
    if (wc.over) { endMKGame(rc, wc); return; }
    const power = MK.powerForRebel(mk.board.rebel, mk.smallGame);
    if (card === 'rebel' && power) {
      mk.pendingPower = { type: power };
      mk.phase = 'power';
      mk.powerResult = null;
    } else {
      MK.advanceLeader(mk);
      mk.nominatedPartnerId = null;
      mk.phase = 'nomination';
    }
    emit(rc);
    setTimeout(() => runMKBots(rc), 600);
    return;
  }

  if (mk.phase === 'power') {
    if (!isBotId(mk.currentLeaderId)) return;
    const leader = mk.players.get(mk.currentLeaderId);
    const power = mk.pendingPower?.type;
    const leaderName = leader?.name || '?';

    if (power === 'role_spy') {
      const targets = alive.filter(p => p.id !== mk.currentLeaderId);
      if (targets.length) {
        const target = targets[crypto.randomInt(0, targets.length)];
        const team = rebelSide.has(target.role) ? 'ASİ' : 'ŞÖVALYE';
        mk.powerResult = { type: 'role_spy', targetId: target.id, targetName: target.name, team };
        // Bot leader — no human to notify, result discarded
      }
    } else if (power === 'deck_spy') {
      mk.powerResult = { type: 'deck_spy', cards: mk.deck.slice(0, Math.min(3, mk.deck.length)) };
      // Bot leader — no human to notify, result discarded
    } else if (power === 'execute') {
      let targets = rebelSide.has(leader?.role)
        ? alive.filter(p => p.id !== mk.currentLeaderId && !rebelSide.has(p.role))
        : alive.filter(p => p.id !== mk.currentLeaderId);
      if (!targets.length) targets = alive.filter(p => p.id !== mk.currentLeaderId);
      if (targets.length) {
        const target = targets[crypto.randomInt(0, targets.length)];
        target.isAlive = false;
        mk.eventLog.push(`${leaderName} ${target.name}'i sistemden eledi`);
        io.to(rc).emit('mk:executed', { targetName: target.name });
        const kingWin = MK.checkKingExecuted(mk, target.id);
        if (kingWin.over) {
          mk.pendingPower = null;
          mk.powerResult = null;
          emit(rc);
          setTimeout(() => endMKGame(rc, kingWin), 1500);
          return;
        }
      }
    }

    mk.pendingPower = null;
    mk.powerResult = null;
    MK.advanceLeader(mk);
    mk.nominatedPartnerId = null;
    mk.phase = 'nomination';
    emit(rc);
    setTimeout(() => runMKBots(rc), 600);
  }
}

function emitVoteTally(rc) {
  const g = rooms.get(rc); if (!g || g.phase !== PHASES.VOTING) return;
  io.to(rc).emit('voteTally', g.getVoteTally());
}

function emitHainKillVotes(rc) {
  const g = rooms.get(rc); if (!g) return;
  const votes = g.getHainKillVotes();
  // Sadece hainlere gönder
  g.players.forEach(p => {
    if (p.actualTeam === 'hain') {
      io.sockets.sockets.get(p.id)?.emit('hainKillVotes', votes);
    }
  });
}

// ── MÜZİK RADYO SİSTEMİ (MP3, tam senkronize) ──
const radioDir = path.join(__dirname, '..', 'public', 'radio');
let radioFiles = [];
try {
  radioFiles = fs.readdirSync(radioDir).filter(f => f.endsWith('.mp3'));
} catch(e) { console.log('[Radio] /public/radio/ klasörü okunamadı'); }

// Shuffle with seed (sunucu her restart'ta yeni sıra)
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Radio state
const radio = {
  playlist: shuffleArray(radioFiles),
  currentIndex: 0,
  trackStartTime: Date.now(), // bu şarkı ne zaman başladı
  trackDuration: 210000, // default 3.5dk (client gerçek süreyi bildirir)
  durations: {} // dosya adı -> ms cinsinden süre (client bildirir)
};

function radioGetNow() {
  const elapsed = Date.now() - radio.trackStartTime;
  const track = radio.playlist[radio.currentIndex] || '';
  // Dosya adından şarkı ismini çıkar (bracket'ları ve uzantıyı temizle)
  const name = track.replace(/\s*\[.*?\]/g, '').replace(/\s*\(Official.*?\)/gi, '').replace(/\.mp3$/i, '').trim();
  return { file: track ? '/radio/' + encodeURIComponent(track) : '', name, position: elapsed, trackStartTime: radio.trackStartTime, index: radio.currentIndex, total: radio.playlist.length };
}

function radioSkip() {
  radio.currentIndex = (radio.currentIndex + 1) % radio.playlist.length;
  radio.trackStartTime = Date.now();
  // Playlist bitince yeniden karıştır
  if (radio.currentIndex === 0) radio.playlist = shuffleArray(radioFiles);
  io.emit('radio:track', radioGetNow());
}

// Client şarkı bittiğini bildirdiğinde (ilk bildiren tetikler)
let _radioSkipLock = false;
function radioTrackEnded() {
  if (_radioSkipLock) return;
  _radioSkipLock = true;
  radioSkip();
  setTimeout(() => { _radioSkipLock = false; }, 2000);
}

console.log(`[Radio] ${radioFiles.length} şarkı yüklendi`);

io.on('connection', (socket) => {
  // ── MÜZİK RADYO ──
  socket.emit('radio:track', radioGetNow());
  socket.on('radio:now', (_, cb) => { cb?.(radioGetNow()); });
  socket.on('time:ping', (_, cb) => { cb?.({ t: Date.now() }); });
  socket.on('radio:ended', () => { radioTrackEnded(); });
  socket.on('radio:skip', (_, cb) => {
    const u = authed.get(socket.id);
    if (!u || !Accounts.isAdmin(u)) return cb?.({ ok: false, err: 'Yetkin yok' });
    radioSkip();
    cb?.({ ok: true });
  });

  // ── ZİYARETÇİ İSTATİSTİKLERİ (güvenli sayaçlar) ──
  siteStats.totalConnections++;
  siteStats.currentActive++;
  if (siteStats.currentActive > siteStats.peakConcurrent) {
    siteStats.peakConcurrent = siteStats.currentActive;
  }
  socket.on('disconnect', () => {
    siteStats.currentActive = Math.max(0, siteStats.currentActive - 1);
  });

  // ── AUTH (input validation güçlendirilmiş) ──
  // Username sanitization helper
  function sanitizeUsername(u) {
    if (typeof u !== 'string') return null;
    const trimmed = u.trim();
    if (trimmed.length < 2 || trimmed.length > 16) return null;
    // Sadece harf/rakam/altçizgi/tire/boşluk
    if (!/^[\p{L}\p{N}_\- ]+$/u.test(trimmed)) return null;
    return trimmed;
  }

  socket.on('auth:register', (d, cb) => {
    if (!d || typeof d !== 'object') return cb?.({ success: false, error: 'Geçersiz veri' });
    const cleanUser = sanitizeUsername(d.username);
    if (!cleanUser) return cb?.({ success: false, error: 'Kullanıcı adı 2-16 karakter, sadece harf/rakam/_/- olmalı' });
    if (typeof d.password !== 'string' || d.password.length < 3 || d.password.length > 100) {
      return cb?.({ success: false, error: 'Şifre 3-100 karakter olmalı' });
    }
    const r = Accounts.register(cleanUser, d.password);
    if (r.success) {
      kickOldSessions(cleanUser, socket.id);
      authed.set(socket.id, cleanUser);
    }
    cb(r);
  });
  socket.on('auth:login', (d, cb) => {
    if (!d || typeof d !== 'object') return cb?.({ success: false, error: 'Geçersiz veri' });
    const cleanUser = sanitizeUsername(d.username);
    if (!cleanUser) return cb?.({ success: false, error: 'Kullanıcı adı geçersiz' });
    if (typeof d.password !== 'string' || d.password.length === 0) {
      return cb?.({ success: false, error: 'Şifre gerekli' });
    }
    const r = Accounts.login(cleanUser, d.password, !!d.rememberMe);
    if (r.success) {
      kickOldSessions(cleanUser, socket.id);
      authed.set(socket.id, cleanUser);
    }
    cb(r);
  });
  // Token ile otomatik giriş
  socket.on('auth:loginByToken', ({ token } = {}, cb) => {
    if (typeof token !== 'string' || token.length < 8 || token.length > 200) {
      return cb?.({ success: false, error: 'Token geçersiz' });
    }
    const r = Accounts.loginByToken(token);
    if (r.success) {
      kickOldSessions(r.user.username, socket.id);
      authed.set(socket.id, r.user.username);
    }
    cb(r);
  });
  // Çıkış yap
  socket.on('auth:logout', ({ token } = {}, cb) => {
    if (token && typeof token === 'string') Accounts.logoutToken(token);
    authed.delete(socket.id);
    cb?.({ success: true });
  });
  socket.on('auth:stats', (_, cb) => { const u = authed.get(socket.id); cb(u ? Accounts.getStats(u) : null); });

  // Yenile butonu için: anlık state ve priv state isteyebilir
  socket.on('state:request', (_, cb) => {
    const rc = prooms.get(socket.id);
    if (rc) emit(rc);
    cb?.({ ok: true });
  });
  socket.on('priv:request', (_, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (g && g.players.has(socket.id)) {
      socket.emit('priv', g.privateState(socket.id));
    }
    cb?.({ ok: true });
  });

  // Eşya aktif et/pasifle
  socket.on('inventory:equip', ({ itemId, equipped } = {}, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb?.({ ok: false, err: 'Giriş yap!' });
    if (typeof itemId !== 'string' || itemId.length > 50) return cb?.({ ok: false, err: 'Eşya ID geçersiz' });
    const r = Accounts.toggleEquip(u, itemId, !!equipped);
    if (r.success) {
      // Kullanıcıya güncel stats gönder
      const stats = Accounts.getStats(u);
      const rc = prooms.get(socket.id);
      const g = rc ? rooms.get(rc) : null;
      if (g) {
        const player = g.players.get(socket.id);
        if (player) player.cosmetics = stats?.equipped || {};
        const spectator = g.spectators?.get(socket.id);
        if (spectator) spectator.cosmetics = stats?.equipped || {};
        emit(rc);
      }
      socket.emit('statsUpdate', stats);
      cb?.({ ok: true, inventory: r.inventory, equipped: stats?.equipped || {} });
    } else {
      cb?.({ ok: false, err: r.error });
    }
  });
  // Kozmetik eşya satın alma (coin ile)
  socket.on('shop:buyCosmetic', ({ itemId } = {}, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb?.({ ok: false, err: 'Giriş yap!' });
    if (typeof itemId !== 'string' || !COSMETIC_CATALOG[itemId]) return cb?.({ ok: false, err: 'Eşya bulunamadı' });
    const item = COSMETIC_CATALOG[itemId];
    if (item.exclusive) return cb?.({ ok: false, err: 'Bu eşya satın alınamaz, özel olarak tanımlanır.' });
    const stats = Accounts.getStats(u);
    if (!stats) return cb?.({ ok: false, err: 'Kullanıcı yok' });
    if (stats.inventory?.some(it => (typeof it === 'string' ? it : it.id) === itemId)) {
      return cb?.({ ok: false, err: 'Bu eşya zaten envanterinde' });
    }
    const spend = Accounts.spendCoins(u, item.price);
    if (!spend.success) return cb?.({ ok: false, err: spend.error || 'Yetersiz altın' });
    Accounts.addToInventory(u, itemId);
    const newStats = Accounts.getStats(u);
    socket.emit('statsUpdate', newStats);
    cb?.({ ok: true, coins: newStats.coins, inventory: newStats.inventory });
  });
  socket.on('auth:leaderboard', (_, cb) => cb(Accounts.leaderboard()));
  socket.on('auth:changePassword', ({ oldPass, newPass } = {}, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb({ success: false, error: 'Giriş yap!' });
    if (typeof oldPass !== 'string' || typeof newPass !== 'string') {
      return cb({ success: false, error: 'Geçersiz veri' });
    }
    if (newPass.length < 3 || newPass.length > 100) {
      return cb({ success: false, error: 'Yeni şifre 3-100 karakter olmalı' });
    }
    cb(Accounts.changePassword(u, oldPass, newPass));
  });
  socket.on('auth:setAvatar', ({ avatar }, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb({ success: false, error: 'Giriş yap!' });
    const r = Accounts.setAvatar(u, avatar);
    cb(r);
    // Aktif odadaki oyuncuların avatarını güncelle
    const rc = prooms.get(socket.id);
    if (rc && r.success) {
      const g = rooms.get(rc);
      if (g) {
        const p = g.players.get(socket.id);
        if (p) { p.avatar = r.avatar; emit(rc); }
        const s = g.spectators.get(socket.id);
        if (s) { s.avatar = r.avatar; emit(rc); }
      }
    }
  });

  // Giphy / Tenor URL'i ile avatar ayarla (lokal disk kullanmaz)
  socket.on('auth:setAvatarUrl', ({ url }, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb?.({ success: false, error: 'Giriş yap!' });
    const r = Accounts.setAvatarUrl(u, url);
    cb?.(r);
    if (!r.success) return;
    const rc = prooms.get(socket.id);
    if (rc) {
      const g = rooms.get(rc);
      if (g) {
        const p = g.players.get(socket.id);
        if (p) { p.avatar = r.avatar; emit(rc); }
        const s = g.spectators.get(socket.id);
        if (s) { s.avatar = r.avatar; emit(rc); }
      }
    }
  });

  // Helper: oyun içi isim sanitize (harf/rakam/_/-/boşluk, max 12)
  function sanitizePlayerName(name) {
    if (typeof name !== 'string') return null;
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 12) return null;
    // HTML kaçışı: < > & " ' karakterleri yok edilir
    return trimmed.replace(/[<>&"']/g, '');
  }

  socket.on('room:create', ({ playerName } = {}, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb?.({ ok: false, err: 'Giriş yap!' });
    const cleanName = sanitizePlayerName(playerName);
    if (!cleanName) return cb?.({ ok: false, err: 'İsim 1-12 karakter olmalı' });
    const stats = Accounts.getStats(u);
    const cosm = Accounts.getEquipped(u);
    const code = genCode(), g = new GameEngine(code, socket.id);
    g.addPlayer(socket.id, cleanName, u, stats?.stats?.won || 0, stats?.avatar, stats?.stats?.mvp || 0, !!stats?.isAdmin, cosm);
    rooms.set(code, g); prooms.set(socket.id, code); socket.join(code);
    cb?.({ ok: true, code }); emit(code);
  });

  socket.on('room:join', ({ code, playerName } = {}, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb?.({ ok: false, err: 'Giriş yap!' });
    if (typeof code !== 'string' || code.length !== 4) return cb?.({ ok: false, err: 'Kod geçersiz' });
    const cleanName = sanitizePlayerName(playerName);
    if (!cleanName) return cb?.({ ok: false, err: 'İsim 1-12 karakter olmalı' });
    const g = rooms.get(code.toUpperCase());
    if (!g) return cb?.({ ok: false, err: 'Oda yok!' });
    if (g.phase !== PHASES.LOBBY && g.phase !== PHASES.POST_GAME) return cb?.({ ok: false, err: 'Oyun başlamış!' });
    const stats = Accounts.getStats(u);
    const cosm = Accounts.getEquipped(u);
    if (!g.addPlayer(socket.id, cleanName, u, stats?.stats?.won || 0, stats?.avatar, stats?.stats?.mvp || 0, !!stats?.isAdmin, cosm)) return cb?.({ ok: false, err: 'Oda dolu!' });
    prooms.set(socket.id, code.toUpperCase()); socket.join(code.toUpperCase());
    cb?.({ ok: true, code: code.toUpperCase() }); emit(code.toUpperCase());
  });

  socket.on('room:spectate', ({ code }, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb({ ok: false, err: 'Giriş yap!' });
    const g = rooms.get(code);
    if (!g) return cb({ ok: false, err: 'Oda yok!' });
    const stats = Accounts.getStats(u);
    const cosm = Accounts.getEquipped(u);
    g.addSpectator(socket.id, u, u, stats?.avatar, cosm);
    prooms.set(socket.id, code); socket.join(code);
    cb({ ok: true, code, spectator: true }); emit(code);
  });

  // Son odaya geri dönme kontrolü
  socket.on('room:checkRejoin', ({ code } = {}, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb?.({ ok: false });
    if (typeof code !== 'string' || code.length !== 4) return cb?.({ ok: false });
    const g = rooms.get(code.toUpperCase());
    if (!g) return cb?.({ ok: false, reason: 'expired' });
    // Lobide veya aktif oyunda — oyun game_over/post_game sonrası hâlâ varsa da kabul et
    const isFinished = g.phase === PHASES.GAME_OVER;
    if (isFinished) return cb?.({ ok: false, reason: 'finished' });
    // Aktif oyunda bu kullanıcı daha önce bu odadaydı mı?
    const isActive = g.phase !== PHASES.LOBBY && g.phase !== PHASES.POST_GAME;
    if (isActive) {
      const wasPlayer = [...g.players.values()].some(p => p.username === u);
      if (!wasPlayer) return cb?.({ ok: false, reason: 'not_player' });
    }
    cb?.({ ok: true, code: code.toUpperCase(), phase: g.phase, canJoin: true, isActive });
  });

  // Odaya yeniden katıl
  socket.on('room:rejoin', ({ code, playerName } = {}, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb?.({ ok: false, err: 'Giriş yap!' });
    if (typeof code !== 'string' || code.length !== 4) return cb?.({ ok: false, err: 'Kod geçersiz' });
    const g = rooms.get(code.toUpperCase());
    if (!g) return cb?.({ ok: false, err: 'Oda artık yok!' });
    const rc = code.toUpperCase();
    const isActive = g.phase !== PHASES.LOBBY && g.phase !== PHASES.POST_GAME;
    if (isActive) {
      // Aktif oyun: eski kaydı yeni socket ID ile güncelle
      const res = g.rejoinPlayer(socket.id, u);
      if (!res.ok) return cb?.({ ok: false, err: 'Bu odada kayıtlı oyuncu bulunamadı.' });
      if (res.player) res.player.cosmetics = Accounts.getEquipped(u);
      // Disconnect timer'ı iptal et (oyuncu geri döndü)
      if (res.oldId && disconnectTimers.has(res.oldId)) {
        clearTimeout(disconnectTimers.get(res.oldId));
        disconnectTimers.delete(res.oldId);
      }
      prooms.set(socket.id, rc); socket.join(rc);
      cb?.({ ok: true, code: rc, active: true });
      // Yeni sokete mevcut state + priv gönder
      emit(rc);
      const priv = g.privateState(socket.id);
      if (priv) socket.emit('priv', priv);
    } else {
      // Lobi / post_game: önce username ile grace-period oyuncusunu bul (sayfa yenileme)
      const existing = [...g.players.entries()].find(([_, p]) => p.username === u);
      if (existing) {
        const [oldId, player] = existing;
        if (disconnectTimers.has(oldId)) {
          clearTimeout(disconnectTimers.get(oldId));
          disconnectTimers.delete(oldId);
        }
        g.players.delete(oldId);
        player.id = socket.id;
        player.isDisconnected = false;
        g.players.set(socket.id, player);
        if (g.leaderId === oldId) g.leaderId = socket.id;
        prooms.set(socket.id, rc); socket.join(rc);
        cb?.({ ok: true, code: rc, active: false });
        emit(rc);
        return;
      }
      // Yeni oyuncu olarak ekle
      const cleanName = sanitizePlayerName(playerName);
      if (!cleanName) return cb?.({ ok: false, err: 'İsim gerekli' });
      const stats = Accounts.getStats(u);
      const cosm = Accounts.getEquipped(u);
      if (!g.addPlayer(socket.id, cleanName, u, stats?.stats?.won || 0, stats?.avatar, stats?.stats?.mvp || 0, !!stats?.isAdmin, cosm)) return cb?.({ ok: false, err: 'Oda dolu!' });
      prooms.set(socket.id, rc); socket.join(rc);
      cb?.({ ok: true, code: rc, active: false }); emit(rc);
    }
  });

  // ── SESLİ SOHBET SIGNALING (WebRTC mesh) ──
  // Tüm voice event'leri sadece odadaki ve canHear() koşulunu sağlayan eşler için relay edilir.
  socket.on('voice:offer', ({ to, sdp }) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g) return;
    if (!g.canHear(to, socket.id) && !g.canHear(socket.id, to)) return; // kanal yetkisi yok
    io.to(to).emit('voice:offer', { from: socket.id, sdp });
  });
  socket.on('voice:answer', ({ to, sdp }) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g) return;
    if (!g.canHear(to, socket.id) && !g.canHear(socket.id, to)) return;
    io.to(to).emit('voice:answer', { from: socket.id, sdp });
  });
  socket.on('voice:ice', ({ to, candidate }) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g) return;
    if (!g.canHear(to, socket.id) && !g.canHear(socket.id, to)) return;
    io.to(to).emit('voice:ice', { from: socket.id, candidate });
  });
  // Konuşuyor mu? (VAD) — sadece duyabilenlere broadcast
  socket.on('voice:speaking', ({ speaking }) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g) return;
    if (!g.canSpeak(socket.id)) return; // Susturulmuş → indikatör de yok
    g.players.forEach((_, pid) => {
      if (pid === socket.id) return;
      if (!g.canHear(pid, socket.id)) return; // duymuyor → indikatör yok (gece sızıntısı önleme)
      io.to(pid).emit('voice:speaking', { from: socket.id, speaking: !!speaking });
    });
  });

  // ── BOT EKLEME (sadece admin + lider) ──
  socket.on('bot:add', ({ count } = {}, cb) => {
    const u = authed.get(socket.id);
    if (!u || !Accounts.isAdmin(u)) return cb?.({ ok: false, err: 'Admin yetkin yok!' });
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g) return cb?.({ ok: false, err: 'Oda yok!' });
    if (g.leaderId !== socket.id) return cb?.({ ok: false, err: 'Sadece oda lideri ekleyebilir!' });
    if (g.phase !== PHASES.LOBBY && g.phase !== PHASES.POST_GAME) return cb?.({ ok: false, err: 'Lobide değil!' });
    const n = Math.max(1, Math.min(20, parseInt(count) || 1));
    let added = 0;
    for (let i = 0; i < n; i++) {
      if (g.players.size >= g.config.MAX_PLAYERS) break;
      const botId = genBotId();
      const botName = pickBotName(g);
      if (g.addBot(botId, botName)) added++;
    }
    emit(rc);
    cb?.({ ok: true, added, total: g.bots.size });
  });

  socket.on('bot:removeAll', (_, cb) => {
    const u = authed.get(socket.id);
    if (!u || !Accounts.isAdmin(u)) return cb?.({ ok: false, err: 'Admin yetkin yok!' });
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g) return cb?.({ ok: false, err: 'Oda yok!' });
    if (g.leaderId !== socket.id) return cb?.({ ok: false, err: 'Sadece oda lideri kaldırabilir!' });
    if (g.phase !== PHASES.LOBBY && g.phase !== PHASES.POST_GAME) return cb?.({ ok: false, err: 'Lobide değil!' });
    g.removeAllBots();
    emit(rc);
    cb?.({ ok: true });
  });

  socket.on('room:kick', ({ targetId }, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g) return cb?.({ ok: false, err: 'Oda yok!' });
    // Sadece lobi kurucusu atabilir
    if (g.leaderId !== socket.id) return cb?.({ ok: false, err: 'Sadece oda kurucusu atabilir!' });
    // Sadece lobide atma yapılabilir
    if (g.phase !== PHASES.LOBBY && g.phase !== PHASES.POST_GAME) return cb?.({ ok: false, err: 'Oyun başladıktan sonra atılamaz!' });
    // Hedef oyuncu var mı
    const target = g.players.get(targetId);
    if (!target) return cb?.({ ok: false, err: 'Oyuncu bulunamadı!' });
    // Kendini atamaz
    if (targetId === socket.id) return cb?.({ ok: false, err: 'Kendini atamazsın!' });
    // Bahis varsa geri ver
    if (target.username && g.bets?.has(target.username)) {
      Accounts.addCoins(target.username, g.bets.get(target.username));
      g.bets.delete(target.username);
      io.to(rc).emit('betUpdate', {
        bets: Object.fromEntries(g.bets || new Map()),
        total: [...(g.bets?.values() || [])].reduce((a, b) => a + b, 0)
      });
    }
    // Hedefi at
    g.removePlayer(targetId); g.removeSpectator(targetId);
    prooms.delete(targetId);
    const sock = io.sockets.sockets.get(targetId);
    if (sock) {
      sock.leave(rc);
      sock.emit('kicked', { reason: 'Oda kurucusu tarafından atıldın.' });
    }
    emit(rc);
    cb?.({ ok: true, kickedName: target.name });
  });

  socket.on('room:leave', () => {
    const rc = prooms.get(socket.id);
    if (rc) {
      const g = rooms.get(rc);
      if (g) {
        if (g.phase === PHASES.LOBBY || g.phase === PHASES.POST_GAME) {
          // Lobide bahis varsa geri ver
          const u = authed.get(socket.id);
          if (u && g.bets?.has(u) && g.phase === PHASES.LOBBY) {
            Accounts.addCoins(u, g.bets.get(u));
            g.bets.delete(u);
            io.to(rc).emit('betUpdate', {
              bets: Object.fromEntries(g.bets || new Map()),
              total: [...(g.bets?.values() || [])].reduce((a, b) => a + b, 0)
            });
          }
          const wasLeader = g.leaderId === socket.id;
          g.removePlayer(socket.id); g.removeSpectator(socket.id);
          // Lider çıktıysa ve botlar varsa: botları at + odayı kapat
          if (wasLeader && g.bots.size > 0) {
            const realPlayers = [...g.players.values()].filter(p => !g.isBot(p.id));
            if (realPlayers.length === 0) {
              // Sadece botlar kaldı — odayı tamamen kapat
              g.removeAllBots();
              rooms.delete(rc); clearTimer(rc);
              prooms.delete(socket.id);
              return;
            }
          }
          if (g.players.size === 0 && g.spectators.size === 0) { rooms.delete(rc); clearTimer(rc); }
          else {
            if (g.leaderId === socket.id && g.players.size > 0) {
              // Yeni lider: ilk insan oyuncu (bot olmayan)
              const newLeader = [...g.players.values()].find(p => !g.isBot(p.id));
              g.leaderId = newLeader ? newLeader.id : [...g.players.keys()][0];
            }
            emit(rc);
          }
        } else {
          // Aktif oyunda lider kasıtlı çıkarsa ve odada başka insan yoksa: odayı kapat
          const wasLeader = g.leaderId === socket.id;
          if (wasLeader && g.bots.size > 0) {
            const realPlayers = [...g.players.values()].filter(p => !g.isBot(p.id) && p.id !== socket.id && !p.isDisconnected);
            const realSpectators = g.spectators.size;
            if (realPlayers.length === 0 && realSpectators === 0) {
              console.log(`[room:leave] Lider ${socket.id} aktif oyundan çıktı, sadece botlar kaldı — oda ${rc} kapatılıyor`);
              g.removeAllBots();
              g.removePlayer(socket.id);
              rooms.delete(rc); clearTimer(rc);
              prooms.delete(socket.id);
              return;
            }
          }
          // Aktif oyunda oyuncuyu silme, sadece bağlantıyı izole et
          g.players.get(socket.id).isDisconnected = true;
          emit(rc); // Oyuncu offline olarak görünecek
        }
      }
      prooms.delete(socket.id);
    }
  });

  // Yeni oyun (post-game'den lobiye) — sadece lider başlatabilir
  socket.on('room:newGame', () => {
    const rc = prooms.get(socket.id);
    const g = rooms.get(rc);
    if (!g) return;
    if (g.leaderId !== socket.id) return;
    const mk = mkStates.get(rc);
    const mkDone = mk && mk.winner;
    if (!mkDone && g.phase !== PHASES.GAME_OVER && g.phase !== PHASES.POST_GAME && g.phase !== 'mvp_result') return;
    if (mk) mkStates.delete(rc);
    g.resetForNewGame();
    clearTimer(rc);
    emit(rc);
  });

  socket.on('settings', (d) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g || g.leaderId !== socket.id) return;
    if (g.phase !== PHASES.LOBBY) return;
    if (d.enabledRoles) {
      // implemented:false rolleri filtrele - default açık olamazlar
      const ROLES = require('./gameConstants').ROLES;
      g.enabledRoles = new Set(d.enabledRoles.filter(k => ROLES[k] && ROLES[k].implemented !== false));
    }
    if (d.insanityRate !== undefined) g.insanityRate = Math.max(0, Math.min(100, d.insanityRate));
    if (d.config) g.setConfig(d.config);
    if (d.hainKillMode) g.setHainKillMode(d.hainKillMode);
    if (d.roleSelectionMode) g.setRoleSelectionMode(d.roleSelectionMode);
    if (d.manualCounts !== undefined) {
      g.manualCounts = d.manualCounts;
      if (d.manualCounts && d.hainCount !== undefined && d.tarafsizCount !== undefined) {
        g.setTeamCounts(d.hainCount, d.tarafsizCount);
      }
    }
    // Throttle ile emit (lider slider'ı çok hızlı değiştirirse her değişimde state göndermesin)
    emit(rc);
  });

  // ── BAHİS SİSTEMİ ──
  // Lobide oyun başlamadan önce coin yatırma
  socket.on('bet:place', ({ amount }, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g) return cb?.({ ok: false, err: 'Oda yok!' });
    if (g.phase !== PHASES.LOBBY) return cb?.({ ok: false, err: 'Oyun başladı, bahis yapılamaz!' });
    if (g.mkMode) return cb?.({ ok: false, err: 'Matrix Krallığı modunda bahis yapılamaz!' });
    const u = authed.get(socket.id);
    if (!u) return cb?.({ ok: false, err: 'Giriş yap!' });
    const amt = parseInt(amount);
    if (!amt || amt < 5) return cb?.({ ok: false, err: 'Bahis en az 5 olmalı!' });
    // Önce eski bahsi geri ver (varsa)
    if (!g.bets) g.bets = new Map();
    const oldBet = g.bets.get(u) || 0;
    if (oldBet > 0) Accounts.addCoins(u, oldBet);
    // Yeni bahsi al
    const r = Accounts.spendCoins(u, amt);
    if (!r.success) return cb?.({ ok: false, err: r.error || 'Yetersiz coin' });
    g.bets.set(u, amt);
    cb?.({ ok: true, coins: r.coins, bet: amt });
    // Tüm odaya bahis durumunu yayınla
    io.to(rc).emit('betUpdate', {
      bets: Object.fromEntries(g.bets),
      total: [...g.bets.values()].reduce((a, b) => a + b, 0)
    });
  });

  // Bahsi geri çek (lobide hâlâ)
  socket.on('bet:cancel', (_, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g) return cb?.({ ok: false });
    if (g.phase !== PHASES.LOBBY) return cb?.({ ok: false, err: 'Oyun başladı!' });
    const u = authed.get(socket.id);
    if (!u || !g.bets?.has(u)) return cb?.({ ok: false });
    const amt = g.bets.get(u);
    const r = Accounts.addCoins(u, amt);
    g.bets.delete(u);
    cb?.({ ok: true, coins: r?.coins ?? null });
    io.to(rc).emit('betUpdate', {
      bets: Object.fromEntries(g.bets || new Map()),
      total: [...(g.bets?.values() || [])].reduce((a, b) => a + b, 0)
    });
  });

  socket.on('room:setMode', ({ mode } = {}, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g || g.leaderId !== socket.id) return cb?.({ ok: false, err: 'Yetki yok!' });
    if (g.phase !== PHASES.LOBBY) return cb?.({ ok: false, err: 'Lobi dışında mod değiştirilemez!' });
    g.mkMode = (mode === 'matrix_kingdom');
    cb?.({ ok: true, mode: g.mkMode ? 'matrix_kingdom' : 'standard' });
    emit(rc);
  });

  socket.on('start', (_, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g || g.leaderId !== socket.id) return cb?.({ ok: false, err: 'Yetki yok!' });

    // ── MATRIX KRALLIĞI BAŞLANGIÇ ──
    if (g.mkMode) {
      const n = g.players.size;
      if (n < 5 || n > 10) return cb?.({ ok: false, err: 'Matrix Krallığı: 5-10 oyuncu gerekli!' });
      const playersArr = [...g.players.values()].map(p => ({ id: p.id, name: p.name, username: p.username, avatar: p.avatar }));
      const mk = MK.createMKState(playersArr);
      if (!mk) return cb?.({ ok: false, err: 'Rol dağıtımı başarısız!' });
      mkStates.set(rc, mk);
      g.phase = 'mk_active';
      cb?.({ ok: true });
      emit(rc);
      setTimeout(() => runMKBots(rc), 1000);
      return;
    }

    if (g.players.size < g.config.MIN_PLAYERS) return cb?.({ ok: false, err: `En az ${g.config.MIN_PLAYERS} oyuncu!` });
    if (!g.startGame()) return cb?.({ ok: false, err: 'Dağıtım başarısız!' });
    cb?.({ ok: true });
    afterStart(rc);
  });

  // Rol seçimi (pick mode)
  socket.on('roleChoice', ({ choice }, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const r = g.submitRoleChoice(socket.id, choice);
    if (r === false) return cb?.({ ok: false, err: 'Sıran değil!' });
    cb?.({ ok: true });
    emit(rc);
    if (r.done) {
      clearTimer(rc);
      startTimer(rc, g.config.ROLE_REVEAL_DURATION, () => toPresidentVote(rc));
    } else {
      // Süreyi sıfırla
      clearTimer(rc);
      startTimer(rc, g.config.ROLE_SELECTION_DURATION, () => autoPickIfNeeded(rc));
    }
  });

  // Başkan oylama
  socket.on('presidentVote', ({ targetId }, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const ok = g.submitPresidentVote(socket.id, targetId);
    cb?.({ ok });
    if (ok) {
      // Sadece tally event'i (tüm state değil)
      io.to(rc).emit('presidentVoteTally', g.getPresidentVoteTally());
      // Tüm canlı oyuncular oy verdiyse süreyi atla
      if (g.phase === PHASES.PRESIDENT_VOTE) {
        const aliveCount = g.alive().length;
        if (g.presidentVotes.size >= aliveCount) {
          clearTimer(rc);
          g.resolvePresidentVote(); emit(rc);
          setTimeout(() => toNight(rc), 2000);
        }
      }
    }
  });

  socket.on('nightAction', (a, cb) => {
    try {
      const rc = prooms.get(socket.id), g = rooms.get(rc);
      if (!g) { cb?.({ ok: false, err: 'Oda bulunamadı' }); return; }
      const ok = g.submitAction(socket.id, a);
      cb?.({ ok });
      const p = g.players.get(socket.id);
      if (ok && p?.actualTeam === 'hain') {
        emitHainKillVotes(rc);
        g.players.forEach((pp, pid) => {
          if (pid !== socket.id && pp.actualTeam === 'hain')
            io.sockets.sockets.get(pid)?.emit('hainAction', { from: p.name, action: a.action || 'seçim' });
        });
      }
    } catch (e) {
      console.error('nightAction error:', e);
      cb?.({ ok: false, err: 'Sunucu hatası' });
    }
  });

  socket.on('hainChat', ({ msg }) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const p = g.players.get(socket.id);
    if (p?.actualTeam !== 'hain') return;
    if (typeof msg !== 'string' || msg.length === 0 || msg.length > 200) return;
    const safeMsg = msg.replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
    g.players.forEach((pp, pid) => {
      if (pp.actualTeam === 'hain')
        io.sockets.sockets.get(pid)?.emit('hainMsg', { from: p.name, msg: safeMsg });
    });
  });

  // Suikastçı gündüz suikast girişimi
  socket.on('suikast', ({ targetId, guessedRole }, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const res = g.submitSuikast(socket.id, targetId, guessedRole);
    cb?.({ ok: res.ok, err: res.err });
    if (res.ok) {
      // Suikastçıya özel sonuç (kim öldürdü/öldü detayı)
      socket.emit('suikastPrivate', res.privateResult);
      // Tüm odaya anonim mesaj (sadece kim öldü, kim/neden öldürdü gizli)
      io.to(rc).emit('suikastPublic', res.publicResult);
      emit(rc);
      // Suikast sonrası oyun sonu kontrolü
      const wc = g.checkWin();
      if (wc.over) {
        setTimeout(() => endGame(rc, wc, null), 3000);
      }
    }
  });

  socket.on('engizitor', ({ targetId }, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const res = g.submitEngizitor(socket.id, targetId);
    cb?.({ ok: res.ok, err: res.err });
    if (res.ok) {
      io.to(rc).emit('engizitorResult', { msg: res.msg, killedName: res.killedName });
      emit(rc);
      const wc = g.checkWin();
      if (wc.over) setTimeout(() => endGame(rc, wc, null), 3000);
    }
  });

  // ── SABOTAJ ──
  socket.on('sabotage:vote', (_, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const res = g.submitSabotage(socket.id);
    cb?.(res);
    if (res.ok) {
      // Sadece hain takım üyelerine sabotaj oy durumunu yayınla
      const aliveHainSocketIds = [...g.players.values()]
        .filter(p => p.isAlive && p.actualTeam === TEAMS.HAIN)
        .map(p => p.id);
      aliveHainSocketIds.forEach(sid => {
        io.sockets.sockets.get(sid)?.emit('sabotage:update', {
          totalVotes: res.totalVotes,
          neededVotes: Math.floor(aliveHainSocketIds.length / 2) + 1,
          voted: res.voted
        });
      });
    }
  });

  socket.on('sabotage:begin', (_, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const ok = g.recordSabotageClick(socket.id);
    cb?.({ ok });
    if (ok) emit(rc);
  });

  // Sabotaj mini oyun sonucu
  socket.on('sabotage:result', ({ won, isFake }, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    // isFake: hainler eğlence amaçlı oynadığında — coin yok, oyun mantığı yok
    if (isFake) { cb?.({ ok: true, fake: true }); return; }

    // Hedefin gerçekten sabotaj target'ı olup olmadığını kontrol et (server side validation)
    const target = g.sabotageTargets.get(socket.id);
    if (!target) return cb?.({ ok: false, err: 'Sabotaj hedefin değilsin' });
    if (target.completed) return cb?.({ ok: false, err: 'Zaten tamamlandı' });
    if (target.opponentType !== 'ai') return cb?.({ ok: false, err: 'AI moduda değilsin' });

    const ok = g.recordSabotageResult(socket.id, !!won);
    if (ok && won) {
      // Kazanan +5 coin (hain bile olsa fromSystem ise alır)
      const u = authed.get(socket.id);
      const player = g.players.get(socket.id);
      // Hain takımı: sadece sistem sabotajından coin alır (kendi sabotajından alamaz)
      const canEarnCoin = player?.actualTeam !== 'hain' || target.fromSystem;
      if (u && canEarnCoin) {
        const r = Accounts.addCoins(u, 5);
        const stats = Accounts.getStats(u);
        if (stats) socket.emit('statsUpdate', stats);
        socket.emit('toast', { msg: '🎉 Mini oyun kazandın! +5 altın', type: 'success' });
      } else if (u) {
        socket.emit('toast', { msg: 'Mini oyunu kazandın (kendi sabotajın, coin yok).', type: 'info' });
      }
    }
    cb?.({ ok });
  });

  // PvP sabotaj hamlesi
  socket.on('sabotage:move', (moveData, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const res = g.submitSabotageMove(socket.id, moveData || {});
    cb?.(res);
    if (res.ok && res.completed) {
      // Pair'deki tüm oyunculara durum güncelle + coin
      const target = g.sabotageTargets.get(socket.id);
      if (target?.gameId) {
        const pair = g.sabotagePairs.get(target.gameId);
        pair?.players.forEach(pid => {
          const t = g.sabotageTargets.get(pid);
          if (!t || !t.completed) return;
          const u = authed.get(pid);
          const player = g.players.get(pid);
          const canEarnCoin = player?.actualTeam !== 'hain' || target.fromSystem;
          if (t.won && u && canEarnCoin) {
            Accounts.addCoins(u, 5);
            const stats = Accounts.getStats(u);
            const sock = io.sockets.sockets.get(pid);
            if (stats && sock) sock.emit('statsUpdate', stats);
            sock?.emit('toast', { msg: '🎉 Rakibini yendin! +5 altın', type: 'success' });
          } else if (u) {
            const sock = io.sockets.sockets.get(pid);
            sock?.emit('toast', { msg: t.won ? '🎉 Kazandın!' : '💀 Kaybettin!', type: t.won ? 'success' : 'info' });
          }
        });
        emit(rc); // privateState yenile
      }
    } else if (res.ok) {
      // Devam ediyor — diğer oyuncuya state'i bildir
      const target = g.sabotageTargets.get(socket.id);
      if (target?.gameId) {
        const pair = g.sabotagePairs.get(target.gameId);
        pair?.players.forEach(pid => {
          const sock = io.sockets.sockets.get(pid);
          if (sock) sock.emit('priv', g.privateState(pid));
        });
      }
    }
  });

  socket.on('vote', ({ targetId }, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const ok = g.submitVote(socket.id, targetId);
    cb?.({ ok });
    if (ok) {
      emitVoteTally(rc);
      if (g.phase === PHASES.VOTING) {
        maybeResolveVoteIfEveryoneOnlineVoted(rc, g);
      }
    }
  });

  socket.on('mvpVote', ({ targetId }, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc); if (!g) return;
    const ok = g.submitMvpVote(socket.id, targetId);
    cb?.({ ok });
    if (ok) {
      // Anlık tally yayınla
      io.to(rc).emit('mvpTally', g.getMvpTally());
      // Tüm oyuncular oy verdiyse süreyi atla (MVP'de ölü oyuncular da oy verir)
      if (g.phase === 'mvp_vote') {
        const totalVoters = g.players.size;
        if (g.mvpVotes.size >= totalVoters) {
          clearTimer(rc);
          resolveMvp(rc);
        }
      }
    }
  });

  // ── MATRIX KRALLIĞI SOCKET EVENTLARI ──
  function getMK() {
    const rc = prooms.get(socket.id); if (!rc) return null;
    return mkStates.get(rc);
  }

  socket.on('mk:ready', (_, cb) => {
    const rc = prooms.get(socket.id), mk = mkStates.get(rc);
    if (!mk) return cb?.({ ok: false, err: 'MK oyunu yok' });
    if (mk.phase !== 'intro') return cb?.({ ok: true });
    mk.readySet.add(socket.id);
    cb?.({ ok: true });
    emit(rc);
    if (mk.readySet.size >= mk.players.size) {
      mk.phase = 'nomination';
      emit(rc);
      setTimeout(() => runMKBots(rc), 800);
    }
  });

  socket.on('mk:nominate', ({ partnerId } = {}, cb) => {
    const rc = prooms.get(socket.id), mk = mkStates.get(rc);
    if (!mk) return cb?.({ ok: false, err: 'MK oyunu yok' });
    if (mk.phase !== 'nomination') return cb?.({ ok: false, err: 'Yanlış faz' });
    if (socket.id !== mk.currentLeaderId) return cb?.({ ok: false, err: 'Sen lider değilsin' });
    const partner = mk.players.get(partnerId);
    if (!partner || !partner.isAlive) return cb?.({ ok: false, err: 'Geçersiz hedef' });
    if (partnerId === socket.id) return cb?.({ ok: false, err: 'Kendini seçemezsin' });
    if (MK.isTermLocked(mk, partnerId) && MK.getEligiblePartners(mk).length > 0) {
      return cb?.({ ok: false, err: 'Bu oyuncu geçen tur görevdeydi' });
    }
    mk.nominatedPartnerId = partnerId;
    mk.phase = 'vote';
    mk.votes = new Map();
    const leaderName = mk.players.get(socket.id)?.name || '?';
    mk.eventLog.push(`${leaderName} yaverini ${partner.name} olarak seçti`);
    cb?.({ ok: true });
    emit(rc);
    setTimeout(() => runMKBots(rc), 800);
  });

  socket.on('mk:vote', ({ vote } = {}, cb) => {
    const rc = prooms.get(socket.id), mk = mkStates.get(rc);
    if (!mk) return cb?.({ ok: false, err: 'MK oyunu yok' });
    if (mk.phase !== 'vote') return cb?.({ ok: false, err: 'Yanlış faz' });
    const p = mk.players.get(socket.id);
    if (!p || !p.isAlive) return cb?.({ ok: false, err: 'Oy kullanamazsın' });
    if (mk.votes.has(socket.id)) return cb?.({ ok: false, err: 'Zaten oy kullandın' });
    if (vote !== 'ja' && vote !== 'nein') return cb?.({ ok: false, err: 'Geçersiz oy' });
    mk.votes.set(socket.id, vote);
    cb?.({ ok: true });
    emit(rc);
    setTimeout(() => runMKBots(rc), 800);
    // Tüm canlı oyuncular oy verdiyse çöz
    const aliveCnt = MK.getAlive(mk).length;
    if (mk.votes.size >= aliveCnt) setTimeout(() => resolveMKVote(rc), 600);
  });

  socket.on('mk:discard_leader', ({ discardIndex } = {}, cb) => {
    const rc = prooms.get(socket.id), mk = mkStates.get(rc);
    if (!mk) return cb?.({ ok: false, err: 'MK oyunu yok' });
    if (mk.phase !== 'card_leader') return cb?.({ ok: false, err: 'Yanlış faz' });
    if (socket.id !== mk.currentLeaderId) return cb?.({ ok: false, err: 'Sen lider değilsin' });
    if (discardIndex < 0 || discardIndex >= mk.pendingCards.length) return cb?.({ ok: false, err: 'Geçersiz index' });
    const discarded = mk.pendingCards.splice(discardIndex, 1)[0];
    MK.discardCard(mk, discarded);
    mk.phase = 'card_partner';
    cb?.({ ok: true });
    emit(rc);
    setTimeout(() => runMKBots(rc), 800);
  });

  socket.on('mk:deploy', ({ deployIndex } = {}, cb) => {
    const rc = prooms.get(socket.id), mk = mkStates.get(rc);
    if (!mk) return cb?.({ ok: false, err: 'MK oyunu yok' });
    if (mk.phase !== 'card_partner') return cb?.({ ok: false, err: 'Yanlış faz' });
    if (socket.id !== mk.nominatedPartnerId) return cb?.({ ok: false, err: 'Sen yaver değilsin' });
    if (deployIndex < 0 || deployIndex >= mk.pendingCards.length) return cb?.({ ok: false, err: 'Geçersiz index' });
    const card = mk.pendingCards[deployIndex];
    mk.termLock = { leaderId: mk.currentLeaderId, partnerId: mk.nominatedPartnerId };
    mk.board[card]++;
    mk.lastCard = card;
    mk.pendingCards = [];
    const leaderName = mk.players.get(mk.currentLeaderId)?.name || '?';
    const partnerName = mk.players.get(mk.nominatedPartnerId)?.name || '?';
    mk.eventLog.push(`${leaderName} + ${partnerName} → ${card === 'matrix' ? 'MATRIX' : 'ASİ'} kartı`);
    cb?.({ ok: true });
    io.to(rc).emit('mk:card_played', { card, board: { ...mk.board } });
    const wc = MK.checkWin(mk);
    if (wc.over) { endMKGame(rc, wc); return; }
    const power = MK.powerForRebel(mk.board.rebel, mk.smallGame);
    if (card === 'rebel' && power) {
      mk.pendingPower = { type: power };
      mk.phase = 'power';
      mk.powerResult = null;
    } else {
      MK.advanceLeader(mk);
      mk.nominatedPartnerId = null;
      mk.phase = 'nomination';
    }
    emit(rc);
    setTimeout(() => runMKBots(rc), 800);
  });

  socket.on('mk:use_power', ({ targetId } = {}, cb) => {
    const rc = prooms.get(socket.id), mk = mkStates.get(rc);
    if (!mk) return cb?.({ ok: false, err: 'MK oyunu yok' });
    if (mk.phase !== 'power') return cb?.({ ok: false, err: 'Yanlış faz' });
    if (socket.id !== mk.currentLeaderId) return cb?.({ ok: false, err: 'Sen lider değilsin' });
    if (!mk.pendingPower) return cb?.({ ok: false, err: 'Güç yok' });
    const power = mk.pendingPower.type;
    const oldLeaderId = socket.id;
    const leaderName = mk.players.get(oldLeaderId)?.name || '?';
    const partnerName = mk.players.get(mk.nominatedPartnerId)?.name || null;
    const round = mk.board.matrix + mk.board.rebel + 1;

    if (power === 'role_spy') {
      const target = mk.players.get(targetId);
      if (!target || !target.isAlive) return cb?.({ ok: false, err: 'Geçersiz hedef' });
      const team = (target.role === 'knight') ? 'ŞÖVALYE' : 'ASİ';
      mk.powerResult = { type: 'role_spy', targetId, targetName: target.name, team, leaderName, partnerName, round };
    } else if (power === 'deck_spy') {
      mk.powerResult = { type: 'deck_spy', cards: mk.deck.slice(0, Math.min(3, mk.deck.length)), leaderName, partnerName, round };
    } else if (power === 'execute') {
      const target = mk.players.get(targetId);
      if (!target || !target.isAlive) return cb?.({ ok: false, err: 'Geçersiz hedef' });
      target.isAlive = false;
      mk.powerResult = { type: 'execute', targetName: target.name, leaderName, partnerName, round };
      mk.eventLog.push(`${leaderName} ${target.name}'i sistemden eledi`);
      io.to(rc).emit('mk:executed', { targetName: target.name });
      const kingWin = MK.checkKingExecuted(mk, targetId);
      if (kingWin.over) {
        // oldLeaderId is still currentLeaderId here (no advanceLeader yet) — leader sees result
        mk.pendingPower = null;
        cb?.({ ok: true });
        emit(rc);
        mk.powerResult = null;
        setTimeout(() => endMKGame(rc, kingWin), 1500);
        return;
      }
    }
    const savedResult = mk.powerResult;
    mk.pendingPower = null;
    mk.powerResult = null;
    MK.advanceLeader(mk);
    mk.nominatedPartnerId = null;
    mk.phase = 'nomination';
    cb?.({ ok: true });
    emit(rc);
    // Send result only to the leader who used the power
    if (savedResult) {
      const leaderSock = io.sockets.sockets.get(oldLeaderId);
      if (leaderSock) {
        const priv = MK.getPrivateState(mk, oldLeaderId);
        priv.powerResult = savedResult;
        leaderSock.emit('priv', priv);
      }
    }
    setTimeout(() => runMKBots(rc), 800);
  });

  socket.on('mk:skip_power', (_, cb) => {
    const rc = prooms.get(socket.id), mk = mkStates.get(rc);
    if (!mk) return cb?.({ ok: false, err: 'MK oyunu yok' });
    if (mk.phase !== 'power') return cb?.({ ok: false, err: 'Yanlış faz' });
    if (socket.id !== mk.currentLeaderId) return cb?.({ ok: false, err: 'Sen lider değilsin' });
    mk.pendingPower = null;
    mk.powerResult = null;
    MK.advanceLeader(mk);
    mk.nominatedPartnerId = null;
    mk.phase = 'nomination';
    cb?.({ ok: true });
    emit(rc);
    setTimeout(() => runMKBots(rc), 800);
  });

  // ── BUG RAPOR (tüm kullanıcılar) ──
  socket.on('report:create', ({ description, screenshot } = {}, cb) => {
    const u = authed.get(socket.id);
    // Spam koruması: anonim olamaz, sadece login olanlar bug rapor edebilir
    if (!u) return cb?.({ success: false, error: 'Önce giriş yap!' });
    if (typeof description !== 'string' || description.length < 5 || description.length > 2000) {
      return cb?.({ success: false, error: 'Açıklama 5-2000 karakter olmalı' });
    }
    // Screenshot opsiyonel ama varsa data URL doğrula + boyut kontrolü
    if (screenshot) {
      if (typeof screenshot !== 'string' || !screenshot.startsWith('data:image/')) {
        return cb?.({ success: false, error: 'Geçersiz görsel' });
      }
      // Base64 size limit (~5MB)
      if (screenshot.length > 7 * 1024 * 1024) {
        return cb?.({ success: false, error: 'Görsel çok büyük (max 5MB)' });
      }
    }
    const result = Reports.create({
      username: u,
      description,
      screenshot
    });
    cb?.(result);
  });

  // ── ADMIN HANDLERLARI ──
  // Tüm admin işlemleri admin kontrolünden geçer
  function requireAdmin(cb) {
    const u = authed.get(socket.id);
    if (!u || !Accounts.isAdmin(u)) {
      cb?.({ ok: false, err: 'Admin yetkin yok!' });
      return false;
    }
    return true;
  }

  // Kullanıcı listesi
  socket.on('admin:listUsers', (_, cb) => {
    if (!requireAdmin(cb)) return;
    cb?.({ ok: true, users: Accounts.listAll() });
  });

  // Site istatistikleri (dashboard için)
  socket.on('admin:siteStats', (_, cb) => {
    if (!requireAdmin(cb)) return;
    const users = Accounts.listAll();
    const now = Date.now();

    // ── KULLANICI SAYILARI ──
    const totalUsers = users.length;
    const totalAdmins = users.filter(u => u.isAdmin).length;
    const activePremium = users.filter(u => u.premium?.active).length;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
    const usersToday = users.filter(u => u.created >= todayStart.getTime()).length;
    const usersThisWeek = users.filter(u => u.created >= weekAgo).length;
    const usersThisMonth = users.filter(u => u.created >= monthAgo).length;
    const neverPlayed = users.filter(u => !(u.stats?.played)).length;
    const usersWithItems = users.filter(u => (u.inventory?.length || 0) > 0).length;

    // ── FİNANS ──
    const totalDonations = users.reduce((s, u) => s + (u.totalDonated || 0), 0);
    const totalCoinsHeld = users.reduce((s, u) => s + (u.coins || 0), 0);
    const avgCoins = totalUsers > 0 ? Math.round(totalCoinsHeld / totalUsers) : 0;

    // ── OYUN İSTATİSTİKLERİ ──
    const totalGamesPlayed = users.reduce((s, u) => s + (u.stats?.played || 0), 0);
    const totalGamesWon = users.reduce((s, u) => s + (u.stats?.won || 0), 0);
    const totalGamesLost = users.reduce((s, u) => s + (u.stats?.lost || 0), 0);
    const totalMVPs = users.reduce((s, u) => s + (u.stats?.mvp || 0), 0);
    const avgWinRate = totalGamesPlayed > 0 ? Math.round((totalGamesWon / totalGamesPlayed) * 100) : 0;
    const avgGamesPerPlayer = totalUsers > 0 ? (totalGamesPlayed / totalUsers).toFixed(1) : '0';

    // ── ENVANTER ──
    const itemCounts = {};
    users.forEach(u => {
      (u.inventory || []).forEach(it => {
        const id = typeof it === 'string' ? it : it.id;
        if (id) itemCounts[id] = (itemCounts[id] || 0) + 1;
      });
    });
    const totalItemsOwned = users.reduce((s, u) => s + (u.inventory?.length || 0), 0);
    const topItems = Object.entries(itemCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => ({ id, count }));

    // ── CANLI ODALAR ──
    const activeRooms = rooms.size;
    const playersInRooms = [...rooms.values()].reduce((s, g) => s + g.players.size, 0);
    const liveRoomsData = [...rooms.entries()].map(([code, g]) => ({
      code,
      playerCount: g.players.size,
      spectatorCount: g.spectators?.size || 0,
      phase: g.phase,
      round: g.round || 0
    })).slice(0, 25);

    // ── SUNUCU SAĞLIĞI ──
    const serverUptime = Math.floor((Date.now() - siteStats.startedAt) / 1000);
    const serverStats = {
      uptime: serverUptime,
      totalConnections: siteStats.totalConnections,
      currentActive: siteStats.currentActive,
      peakConcurrent: siteStats.peakConcurrent
    };

    // ── EN AKTİF OYUNCULAR (top 10) ──
    const topPlayers = users
      .filter(u => u.stats?.played > 0)
      .map(u => ({
        username: u.username,
        played: u.stats.played,
        won: u.stats.won,
        mvp: u.stats.mvp || 0,
        coins: u.coins || 0,
        premium: u.premium?.active || false
      }))
      .sort((a, b) => b.played - a.played)
      .slice(0, 10);

    // ── TOP KAZANANLAR (top 10) ──
    const topWinners = users
      .filter(u => u.stats?.won > 0)
      .map(u => ({
        username: u.username,
        won: u.stats.won,
        played: u.stats.played,
        winRate: u.stats.played > 0 ? Math.round((u.stats.won / u.stats.played) * 100) : 0
      }))
      .sort((a, b) => b.won - a.won)
      .slice(0, 10);

    // ── EN YÜKSEK KAZANMA ORANI (min 5 oyun) ──
    const topWinRate = users
      .filter(u => (u.stats?.played || 0) >= 5)
      .map(u => ({
        username: u.username,
        played: u.stats.played,
        won: u.stats.won,
        winRate: Math.round((u.stats.won / u.stats.played) * 100)
      }))
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 10);

    // ── TOP MVP (top 10) ──
    const topMvps = users
      .filter(u => (u.stats?.mvp || 0) > 0)
      .map(u => ({ username: u.username, mvp: u.stats.mvp, played: u.stats.played || 0 }))
      .sort((a, b) => b.mvp - a.mvp)
      .slice(0, 10);

    // ── EN ÇOK KAYBEDEN (top 10) ──
    const topLosers = users
      .filter(u => (u.stats?.lost || 0) > 0)
      .map(u => ({ username: u.username, lost: u.stats.lost || 0, played: u.stats.played || 0 }))
      .sort((a, b) => b.lost - a.lost)
      .slice(0, 10);

    // ── TOP BAĞIŞÇILAR (top 10) ──
    const topDonors = users
      .filter(u => u.totalDonated > 0)
      .map(u => ({ username: u.username, totalDonated: u.totalDonated }))
      .sort((a, b) => b.totalDonated - a.totalDonated)
      .slice(0, 10);

    // ── EN ZENGİNLER (top 10) ──
    const topRichest = users
      .filter(u => u.coins > 0)
      .map(u => ({ username: u.username, coins: u.coins }))
      .sort((a, b) => b.coins - a.coins)
      .slice(0, 10);

    // ── PREMİUM KULLANICILARI LİSTESİ ──
    const premiumUsers = users
      .filter(u => u.premium?.active)
      .map(u => ({ username: u.username, daysLeft: u.premium.daysLeft, totalDonated: u.totalDonated || 0 }))
      .sort((a, b) => b.daysLeft - a.daysLeft)
      .slice(0, 20);

    // ── KAYIT ZAMAN SERİSİ (son 30 gün) ──
    const days30Ago = now - 30 * 24 * 60 * 60 * 1000;
    const dayBuckets = {};
    users.forEach(u => {
      if (!u.created || u.created < days30Ago) return;
      const day = new Date(u.created).toISOString().split('T')[0];
      dayBuckets[day] = (dayBuckets[day] || 0) + 1;
    });
    const registrationsByDay = Object.entries(dayBuckets)
      .sort((a, b) => a[0].localeCompare(b[0]));

    // ── BUG RAPORLARI ──
    const reports = Reports.list();
    const openReports = reports.filter(r => r.status === 'open' || !r.status).length;
    const closedReports = reports.length - openReports;

    cb?.({
      ok: true,
      stats: {
        users: {
          total: totalUsers, admins: totalAdmins, premium: activePremium,
          today: usersToday, thisWeek: usersThisWeek, thisMonth: usersThisMonth,
          neverPlayed, withInventory: usersWithItems
        },
        finance: { totalDonations, totalCoins: totalCoinsHeld, avgCoins },
        games: { played: totalGamesPlayed, won: totalGamesWon, lost: totalGamesLost, mvps: totalMVPs, avgWinRate, avgGamesPerPlayer },
        inventory: { totalItemsOwned, topItems },
        live: { activeRooms, playersInRooms, rooms: liveRoomsData },
        server: serverStats,
        reports: { open: openReports, closed: closedReports, total: reports.length },
        topPlayers, topWinners, topWinRate, topMvps, topLosers,
        topDonors, topRichest, premiumUsers,
        registrationsByDay
      }
    });
  });

  // Yeni hesap oluştur
  socket.on('admin:createUser', ({ username, password, isAdmin }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Accounts.adminCreate(username, password, isAdmin);
    cb?.(r.success ? { ok: true } : { ok: false, err: r.error });
  });

  // Hesap sil
  socket.on('admin:deleteUser', ({ username }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Accounts.adminDelete(username);
    cb?.(r.success ? { ok: true } : { ok: false, err: r.error });
  });

  // İstatistik düzenleme
  socket.on('admin:setStats', ({ username, stats }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Accounts.adminSetStats(username, stats);
    cb?.(r.success ? { ok: true } : { ok: false, err: r.error });
  });

  // Admin: kullanıcının coin'ini değiştir (delta verilebilir, set edilebilir)
  socket.on('admin:setCoins', ({ username, coins, delta }, cb) => {
    if (!requireAdmin(cb)) return;
    if (!username) return cb?.({ ok: false, err: 'Kullanıcı yok' });
    if (typeof delta === 'number') {
      // Coin değişikliği (eklenir/çıkarılır)
      const r = Accounts.addCoins(username, delta);
      if (!r.success) return cb?.({ ok: false, err: r.error });
      // Kullanıcı online'sa stats yenile
      for (const [sid, uname] of authed.entries()) {
        if (uname === username) {
          const stats = Accounts.getStats(uname);
          if (stats) io.sockets.sockets.get(sid)?.emit('statsUpdate', stats);
        }
      }
      return cb?.({ ok: true, coins: r.coins });
    }
    if (typeof coins === 'number') {
      // Tam set - mevcut coin'i farktan ayar (clamp 0)
      const stats = Accounts.getStats(username);
      if (!stats) return cb?.({ ok: false, err: 'Kullanıcı yok' });
      const target = Math.max(0, parseInt(coins) || 0);
      const diff = target - (stats.coins || 0);
      const r = Accounts.addCoins(username, diff);
      // Online stats yenile
      for (const [sid, uname] of authed.entries()) {
        if (uname === username) {
          const s = Accounts.getStats(uname);
          if (s) io.sockets.sockets.get(sid)?.emit('statsUpdate', s);
        }
      }
      return cb?.({ ok: true, coins: r.coins });
    }
    cb?.({ ok: false, err: 'coins veya delta gerekli' });
  });

  // Admin yetkisi değiştir
  socket.on('admin:toggleAdmin', ({ username, isAdmin }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Accounts.adminToggle(username, isAdmin);
    cb?.(r.success ? { ok: true } : { ok: false, err: r.error });
  });

  // Şifre sıfırla
  socket.on('admin:resetPassword', ({ username, newPassword }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Accounts.adminResetPassword(username, newPassword);
    cb?.(r.success ? { ok: true } : { ok: false, err: r.error });
  });

  // Premium ver / kaldır
  socket.on('admin:setPremium', ({ username, days }, cb) => {
    if (!requireAdmin(cb)) return;
    const d = parseInt(days);
    if (isNaN(d) || d < 0) return cb?.({ ok: false, err: 'Geçersiz gün sayısı.' });
    const r = Accounts.adminSetPremium(username, d);
    cb?.(r.success ? { ok: true } : { ok: false, err: r.error });
  });

  // Bağışçı permi ver / kaldır
  socket.on('admin:setDonor', ({ username, isDonor }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Accounts.adminSetDonor(username, !!isDonor);
    cb?.(r.success ? { ok: true } : { ok: false, err: r.error });
  });

  // Bug raporlarını listele
  socket.on('admin:listReports', (_, cb) => {
    if (!requireAdmin(cb)) return;
    cb?.({ ok: true, reports: Reports.list() });
  });

  // Rapor sil
  socket.on('admin:deleteReport', ({ id }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Reports.delete(id);
    cb?.(r.success ? { ok: true } : { ok: false });
  });

  // Rapor durumunu değiştir (open/closed)
  socket.on('admin:setReportStatus', ({ id, status }, cb) => {
    if (!requireAdmin(cb)) return;
    const r = Reports.setStatus(id, status);
    cb?.(r.success ? { ok: true } : { ok: false });
  });

  // Admin token al (screenshot URL'leri için)
  socket.on('admin:getToken', (_, cb) => {
    if (!requireAdmin(cb)) return;
    cb?.({ ok: true, token: socket.id });
  });

  socket.on('disconnect', () => {
    const rc = prooms.get(socket.id);
    if (rc) {
      const g = rooms.get(rc);
      if (g) {
        if (g.phase === PHASES.LOBBY || g.phase === PHASES.POST_GAME) {
          const p = g.players.get(socket.id);
          const u = authed.get(socket.id);
          if (p) {
            // Oyuncuyu hemen silme — 15sn grace period (sayfa yenileme için)
            p.isDisconnected = true;
            emit(rc);
            const _sid = socket.id, _rc = rc, _u = u;
            if (disconnectTimers.has(_sid)) clearTimeout(disconnectTimers.get(_sid));
            disconnectTimers.set(_sid, setTimeout(() => {
              disconnectTimers.delete(_sid);
              const g2 = rooms.get(_rc);
              if (!g2 || (g2.phase !== PHASES.LOBBY && g2.phase !== PHASES.POST_GAME)) return;
              // Bet'i geri ver (gerçekten çıkıyor)
              if (_u && g2.bets?.has(_u) && g2.phase === PHASES.LOBBY) {
                Accounts.addCoins(_u, g2.bets.get(_u));
                g2.bets.delete(_u);
                io.to(_rc).emit('betUpdate', {
                  bets: Object.fromEntries(g2.bets || new Map()),
                  total: [...(g2.bets?.values() || [])].reduce((a, b) => a + b, 0)
                });
              }
              const wasLeader2 = g2.leaderId === _sid;
              g2.removePlayer(_sid); g2.removeSpectator(_sid);
              // Lider tamamen çıktıysa ve sadece botlar kaldıysa: odayı kapat
              if (wasLeader2 && g2.bots.size > 0) {
                const realPlayers = [...g2.players.values()].filter(p => !g2.isBot(p.id));
                if (realPlayers.length === 0) {
                  g2.removeAllBots();
                  rooms.delete(_rc); clearTimer(_rc);
                  return;
                }
              }
              if (g2.players.size === 0 && g2.spectators.size === 0) { rooms.delete(_rc); clearTimer(_rc); }
              else {
                if (g2.leaderId === _sid && g2.players.size > 0) {
                  const newLeader = [...g2.players.values()].find(p => !g2.isBot(p.id));
                  g2.leaderId = newLeader ? newLeader.id : [...g2.players.keys()][0];
                }
                emit(_rc);
              }
            }, 15 * 1000));
          } else {
            // Spectator → hemen çıkar
            g.removeSpectator(socket.id);
            if (g.players.size === 0 && g.spectators.size === 0) { rooms.delete(rc); clearTimer(rc); }
            else emit(rc);
          }
        } else {
          // Aktif oyunda oyuncuyu silme, sadece bağlantıyı izole et
          const p = g.players.get(socket.id);
          if (p) {
            // Lider disconnect + odada başka insan/spec yoksa: odayı hemen kapat (botları da)
            if (g.leaderId === socket.id && g.bots.size > 0) {
              const realPlayers = [...g.players.values()].filter(pp => !g.isBot(pp.id) && pp.id !== socket.id && !pp.isDisconnected);
              if (realPlayers.length === 0 && g.spectators.size === 0) {
                console.log(`[disconnect] Lider ${socket.id} aktif oyundan disconnect oldu, sadece botlar kaldı — oda ${rc} kapatılıyor`);
                g.removeAllBots();
                g.removePlayer(socket.id);
                rooms.delete(rc); clearTimer(rc);
                prooms.delete(socket.id);
                authed.delete(socket.id);
                return;
              }
            }
            p.isDisconnected = true;
            emit(rc);
            // 3 dakika sonra hâlâ offline ise oyundan çıkar (oyunun devam edebilmesi için)
            if (disconnectTimers.has(socket.id)) clearTimeout(disconnectTimers.get(socket.id));
            const _sid = socket.id, _rc = rc;
            disconnectTimers.set(_sid, setTimeout(() => {
              disconnectTimers.delete(_sid);
              const g2 = rooms.get(_rc); if (!g2) return;
              const p2 = g2.players.get(_sid); if (!p2 || !p2.isDisconnected) return;
              console.log(`[disconnectTimer] ${p2.name} 3dk sonra hâlâ offline — oyundan çıkarılıyor`);
              g2.removePlayer(_sid);
              if (g2.players.size === 0 && g2.spectators.size === 0) { rooms.delete(_rc); clearTimer(_rc); return; }
              emit(_rc);
              const wc = g2.checkWin();
              if (wc.over) setTimeout(() => endGame(_rc, wc, null), 2000);
            }, 3 * 60 * 1000));
          }
        }
      }
      prooms.delete(socket.id);
    }
    authed.delete(socket.id);
  });
});

// Beklenmedik hatalar sunucuyu çökertmesin (donma yerine devam etsin)
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});

// Her 5 dakikada bir tüm oyuncuları offline olan aktif odaları temizle
setInterval(() => {
  for (const [rc, g] of rooms) {
    const isActive = g.phase !== PHASES.LOBBY && g.phase !== PHASES.POST_GAME && g.phase !== PHASES.GAME_OVER;
    if (!isActive) continue;
    const alive = [...g.players.values()].filter(p => p.isAlive);
    if (alive.length === 0) continue;
    // Botları sayma: gercek insan oyuncu yoksa veya hepsi offline ise odayı sil
    const realAlive = alive.filter(p => !g.isBot(p.id));
    if (realAlive.length === 0 && g.bots.size > 0 && g.spectators.size === 0) {
      console.log(`[deadRoom] Oda ${rc}: sadece botlar kaldı — oda siliniyor`);
      g.removeAllBots();
      rooms.delete(rc); clearTimer(rc);
      continue;
    }
    const allOffline = realAlive.length > 0 && realAlive.every(p => p.isDisconnected);
    if (allOffline && g.spectators.size === 0) {
      console.log(`[deadRoom] Oda ${rc}: tüm oyuncular offline — oda siliniyor`);
      rooms.delete(rc); clearTimer(rc);
    }
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`\n  ⛧ AZAP v4 aktif: http://localhost:${PORT}\n  Created by Azat Akdağ\n`));
