require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = null;
const GameEngine = require('./gameEngine');
const Accounts = require('./accounts');
const Reports = require('./reports');
const { PHASES, TEAMS } = require('./gameConstants');
const registerLegalRoutes = require('./legalPages');

// Eski hali: const ADMIN_SECRET_KEY = 'azap-admin-2026-gizli-anahtar-degistir';
// Yeni hali:
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || '4794akd.';

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
  pingTimeout: 60000,
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
  /^\/(node_modules|server|data|\.git)(\/|$)/i,  // Hassas dizinler
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

app.use(express.static(path.join(__dirname, '..', 'public'), {
  dotfiles: 'deny', // Dotfile'ları statik servis etme
  // Cache static assets (CSS, fonts) ama HTML cache'lenmesin
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
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

// Paket katalog endpoint'i (frontend mağazada gösterir)
app.get('/api/shop/packages', apiLimiter, (req, res) => {
  res.json({
    packages: PAYMENT_PACKAGES,
    donationPresets: DONATION_PRESETS,
    paymentEnabled: !!process.env.IYZICO_API_KEY
  });
});

// ── İYZİCO ÖDEME OLUŞTURMA ──
app.post('/api/payment/create', paymentLimiter, async (req, res) => {
  const { username, packageId, donationAmount } = req.body || {};

  // ── GÜVENLİK: username sanitize ve doğrulama ──
  if (typeof username !== 'string' || username.length < 2 || username.length > 16) {
    return res.status(400).json({ ok: false, error: 'Kullanıcı adı geçersiz' });
  }
  // Kullanıcı sistemde var mı kontrol et
  const userStats = Accounts.getStats(username);
  if (!userStats) return res.status(404).json({ ok: false, error: 'Kullanıcı bulunamadı' });

  // packageId whitelist kontrolü
  if (packageId !== 'donation' && !PAYMENT_PACKAGES[packageId]) {
    return res.status(400).json({ ok: false, error: 'Geçersiz paket' });
  }

  let amount, label, type, payload;
  if (packageId === 'donation') {
    const amt = parseFloat(donationAmount);
    if (!amt || amt < 5 || amt > 5000 || isNaN(amt)) {
      return res.status(400).json({ ok: false, error: 'Bağış 5-5000 TL arası olmalı' });
    }
    amount = amt;
    label = `${amount} TL Bağış`;
    type = 'donation';
    payload = { amount };
  } else {
    const pkg = PAYMENT_PACKAGES[packageId];
    amount = pkg.price;
    label = pkg.label;
    type = pkg.type;
    payload = pkg;
  }

  // İyzico bağlı değilse: dev modunda direkt simüle et
  if (!process.env.IYZICO_API_KEY) {
    return res.json({
      ok: true,
      devMode: true,
      message: 'İyzico bağlı değil — dev modunda simülasyon.',
      paymentInfo: { username, packageId, amount, label, type }
    });
  }

  // TODO: Gerçek İyzico Checkout Form
  return res.status(501).json({ ok: false, error: 'İyzico entegrasyonu henüz tamamlanmadı' });
});

// İyzico callback (ödeme tamamlandığında)
// TODO: gerçek webhook imzasını doğrula
app.post('/api/payment/callback', async (req, res) => {
  // TODO: req.body.token ile Iyzico'dan ödeme detayını doğrula
  // Sonra: applyPayment(username, packageId)
  res.json({ ok: true });
});

// DEV MODE: ödeme simülasyonu — production'da OTOMATİK ENGELLENİR
app.post('/api/payment/dev-complete', paymentLimiter, (req, res) => {
  // SADECE: İyzico bağlı değil (NODE_ENV development) ise çalışır
  if (process.env.IYZICO_API_KEY) {
    return res.status(403).json({ ok: false, error: 'Production modunda devre dışı' });
  }
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ ok: false, error: 'Production modunda devre dışı' });
  }
  const { username, packageId, donationAmount } = req.body || {};
  // Validation
  if (typeof username !== 'string' || username.length < 2 || username.length > 16) {
    return res.status(400).json({ ok: false, error: 'Kullanıcı geçersiz' });
  }
  if (!Accounts.getStats(username)) return res.status(404).json({ ok: false, error: 'Kullanıcı yok' });
  if (packageId !== 'donation' && !PAYMENT_PACKAGES[packageId]) {
    return res.status(400).json({ ok: false, error: 'Paket geçersiz' });
  }
  if (packageId === 'donation') {
    const amt = parseFloat(donationAmount);
    if (!amt || amt < 5 || amt > 5000 || isNaN(amt)) {
      return res.status(400).json({ ok: false, error: 'Bağış geçersiz' });
    }
  }
  applyPayment(username, packageId, donationAmount);
  res.json({ ok: true });
});

// Ödeme başarılı sonrası uygulama
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

  res.json({
    ok: true,
    stats: {
      server: { uptime, totalConnections: siteStats.totalConnections, currentActive: siteStats.currentActive, peakConcurrent: siteStats.peakConcurrent, history: siteStats.history },
      users: { total: totalUsers, admins: totalAdmins, premium: activePremium, today: usersToday, thisWeek: usersThisWeek, thisMonth: usersThisMonth, neverPlayed, withInventory: usersWithItems },
      finance: { totalDonations, totalCoins: totalCoinsHeld, avgCoins },
      games: { played: totalGamesPlayed, won: totalGamesWon, lost: totalGamesLost, mvps: totalMVPs, avgWinRate, avgGamesPerPlayer },
      inventory: { totalItemsOwned, topItems },
      live: { activeRooms, playersInRooms, rooms: liveRoomsData },
      reports: { open: openReports, closed: closedReports, total: reports.length },
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

// HTML Dashboard: kapsamlı admin istatistik paneli
app.get('/admin/dashboard', adminLimiter, (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AZAP Admin Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a14;color:#e0e0ff;min-height:100vh}
a{color:inherit;text-decoration:none}
/* LAYOUT */
.page{max-width:1400px;margin:0 auto;padding:20px 16px}
/* HEADER */
.hdr{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:16px 0 20px;border-bottom:1px solid #1e1e30;margin-bottom:24px}
.hdr-title{font-size:22px;font-weight:800;color:#ff6b6b;letter-spacing:-0.5px}
.hdr-sub{font-size:12px;color:#555577;margin-top:2px}
.hdr-right{display:flex;gap:8px;align-items:center}
.upd-txt{font-size:11px;color:#555577}
.upd-txt span{color:#64ffda}
.btn{border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;transition:.15s}
.btn-r{background:#ff6b6b;color:#fff}.btn-r:hover{background:#ff5252}
.btn-g{background:#1e3a2a;color:#27ae60;border:1px solid #27ae60}.btn-g:hover{background:#27ae60;color:#fff}
.btn-d{background:#1a1a2e;color:#8892b0;border:1px solid #2d2d44}.btn-d:hover{background:#2d2d44;color:#e0e0ff}
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
/* CHARTS */
.cg{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:680px){.cg{grid-template-columns:1fr}}
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
/* KULLANICI YÖNETİMİ */
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
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a14}
.login-box{background:#12121f;border:1px solid #1e1e30;border-radius:16px;padding:40px;width:100%;max-width:360px;text-align:center}
.login-box h2{color:#ff6b6b;font-size:20px;margin-bottom:6px}
.login-box p{color:#555577;font-size:13px;margin-bottom:24px}
.login-box input{width:100%;padding:12px 14px;background:#0a0a14;border:1px solid #1e1e30;border-radius:8px;color:#e0e0ff;font-size:14px;margin-bottom:12px;outline:none;transition:.15s}
.login-box input:focus{border-color:#64ffda}
.login-box .btn-r{width:100%;padding:12px;font-size:15px}
.login-err{color:#ff6b6b;font-size:12px;margin-top:8px;min-height:18px}
.hidden{display:none!important}
.divider{height:1px;background:#1e1e30;margin:4px 0}
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
<div class="page">

<!-- HEADER -->
<div class="hdr">
  <div>
    <div class="hdr-title">⚡ AZAP İstatistik Paneli</div>
    <div class="hdr-sub">Son güncelleme: <span id="lastUpd" style="color:#64ffda">—</span> &nbsp;·&nbsp; Her 30 saniyede otomatik yenilenir</div>
  </div>
  <div class="hdr-right">
    <button class="btn btn-g" onclick="loadAll()">🔄 Yenile</button>
    <button class="btn btn-d" onclick="doLogout()">🚪 Çıkış</button>
  </div>
</div>

<!-- SUNUCU SAĞLIĞI -->
<div class="sec">
  <div class="sec-title">🖥️ Sunucu Sağlığı</div>
  <div class="sg" id="srvCards"></div>
</div>

<!-- KULLANICI ANALİZİ -->
<div class="sec">
  <div class="sec-title">👥 Kullanıcı Analizi</div>
  <div class="sg" id="usrCards"></div>
</div>

<!-- OYUN & FİNANS -->
<div class="sec">
  <div class="sec-title red">🎮 Oyun &amp; Finansal Özet</div>
  <div class="sg" id="gfCards"></div>
</div>

<!-- GRAFİKLER -->
<div class="sec">
  <div class="sec-title green">📈 Grafikler</div>
  <div class="cg">
    <div class="cbox"><div class="ct">Canlı Oyuncu (Son 5 Dakika)</div><canvas id="pChart" height="110"></canvas></div>
    <div class="cbox"><div class="ct">Son 30 Gün Kayıt</div><canvas id="rChart" height="110"></canvas></div>
  </div>
</div>

<!-- CANLI ODALAR -->
<div class="sec">
  <div class="sec-title green">🟢 Canlı Odalar <span id="rmCnt" style="color:#555577;font-weight:400;letter-spacing:0"></span></div>
  <div class="tbl-wrap" id="rmWrap"><p class="empty">Şu an aktif oda yok</p></div>
</div>

<!-- LEADERBOARD HAVUZU -->
<div class="sec">
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
<div class="sec">
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
        <th>Oyun</th><th>Galibiyet</th><th>MVP</th>
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
var pChart, rChart;

function esc(s){ var d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function fmtUp(s){ var d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60); return d>0 ? d+'g '+h+'s '+m+'dk' : h+'s '+m+'dk '+(s%60)+'sn'; }
function phaseName(p){ var m={'lobby':'Lobi','role_selection':'Rol Seç','role_reveal':'Rol Açıl','president_vote':'Başkan Oy','night':'Gece','morning_report':'Sabah','day_discussion':'Tartışma','voting':'Oylama','vote_result':'Oy Sonuç','mvp_vote':'MVP Oy','mvp_result':'MVP Sonuç','game_over':'Oyun Bitti','post_game':'Oyun Sonu'}; return m[p]||p; }
function phaseCls(p){ if(p==='lobby'||p==='role_selection'||p==='role_reveal'||p==='president_vote') return 'ph-lobby'; if(p==='night'||p==='morning_report') return 'ph-night'; if(p==='day_discussion') return 'ph-day'; if(p==='voting'||p==='vote_result') return 'ph-vote'; return 'ph-over'; }
function card(ico,val,lbl,cls){ return '<div class="sc '+(cls||'')+'"><div class="ico">'+ico+'</div><div class="val">'+val+'</div><div class="lbl">'+lbl+'</div></div>'; }
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
  pChart=new Chart(document.getElementById('pChart'),{type:'line',data:{labels:[],datasets:[{label:'Aktif',data:[],borderColor:'#64ffda',backgroundColor:'rgba(100,255,218,.07)',fill:true,tension:0.4,pointRadius:2,pointHoverRadius:4}]},options:{responsive:true,animation:false,interaction:{mode:'index',intersect:false},scales:{x:{display:false},y:{beginAtZero:true,grid:{color:'#1a1a2e'},ticks:{color:'#555577',font:{size:10}}}},plugins:{legend:{display:false},tooltip:{callbacks:{title:function(items){return items[0].label;}}}}}});
  rChart=new Chart(document.getElementById('rChart'),{type:'bar',data:{labels:[],datasets:[{label:'Kayıt',data:[],backgroundColor:'rgba(187,143,206,.55)',borderColor:'#bb8fce',borderWidth:1,borderRadius:3}]},options:{responsive:true,animation:false,scales:{x:{ticks:{color:'#555577',font:{size:10},maxRotation:45},grid:{display:false}},y:{beginAtZero:true,grid:{color:'#1a1a2e'},ticks:{color:'#555577',font:{size:10}}}},plugins:{legend:{display:false}}}});
}

async function loadAll(){
  if(!tk){ showLogin(); return; }
  try{
    var res=await fetch('/admin/analytics?token='+encodeURIComponent(tk));
    var d=await res.json();
    if(!d.ok){ if(res.status===403){ showLogin(); } return; }
    var s=d.stats;
    document.getElementById('lastUpd').textContent=new Date().toLocaleTimeString('tr-TR');

    /* SUNUCU KARTLARI */
    document.getElementById('srvCards').innerHTML=
      card('⏱️',fmtUp(s.server.uptime),'Uptime','c-teal')+
      card('🔗',s.server.totalConnections.toLocaleString('tr-TR'),'Toplam Bağlantı','c-teal')+
      card('👁️',s.server.currentActive,'Şu An Sitede','c-green')+
      card('🚀',s.server.peakConcurrent,'Rekor Anlık','c-blue')+
      card('🟢',s.live.activeRooms,'Aktif Oda','c-green')+
      card('🎮',s.live.playersInRooms,'Odada Oyuncu','c-green');

    /* KULLANICI KARTLARI */
    document.getElementById('usrCards').innerHTML=
      card('👥',s.users.total.toLocaleString('tr-TR'),'Toplam Kullanıcı','')+
      card('📅',s.users.today,'Bugün Kayıt','c-teal')+
      card('📆',s.users.thisWeek,'Bu Hafta','')+
      card('🗓️',s.users.thisMonth,'Bu Ay (30g)','')+
      card('👑',s.users.premium,'Aktif Premium','c-purple')+
      card('🛡️',s.users.admins,'Admin','c-red')+
      card('🛍️',s.users.withInventory,'Eşya Sahibi','')+
      card('🚫',s.users.neverPlayed,'Hiç Oynamamış','');

    /* OYUN & FİNANS KARTLARI */
    document.getElementById('gfCards').innerHTML=
      card('🎯',s.games.played.toLocaleString('tr-TR'),'Toplam Oyun','')+
      card('🏆',s.games.won.toLocaleString('tr-TR'),'Toplam Galibiyet','c-green')+
      card('💀',s.games.lost.toLocaleString('tr-TR'),'Toplam Mağlubiyet','c-red')+
      card('❤️',s.games.mvps.toLocaleString('tr-TR'),'Toplam MVP','c-pink')+
      card('📊','%'+s.games.avgWinRate,'Ort. Kazanma Oranı','c-green')+
      card('🎲',s.games.avgGamesPerPlayer,'Kişi Başı Oyun','')+
      card('💝','₺'+s.finance.totalDonations.toFixed(0),'Toplam Bağış','c-pink')+
      card('💰',s.finance.totalCoins.toLocaleString('tr-TR'),'Toplam Altın','c-gold')+
      card('📊',s.finance.avgCoins.toLocaleString('tr-TR'),'Kişi Başı Altın','c-gold')+
      card('📦',s.inventory.totalItemsOwned.toLocaleString('tr-TR'),'Toplam Eşya','')+
      card('🐛',s.reports.open,'Açık Bug','c-red')+
      card('✅',s.reports.closed,'Çözülen Bug','c-green')+
      card('📋',s.reports.total,'Toplam Rapor','');

    /* OYUNCU GRAFİĞİ */
    if(s.server.history&&s.server.history.length&&pChart){
      var hist=s.server.history;
      pChart.data.labels=hist.map(function(h){ return new Date(h.timestamp).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}); });
      pChart.data.datasets[0].data=hist.map(function(h){ return h.currentActive; });
      pChart.update('none');
    }

    /* KAYIT GRAFİĞİ */
    if(s.registrationsByDay&&s.registrationsByDay.length&&rChart){
      rChart.data.labels=s.registrationsByDay.map(function(d){ return new Date(d[0]).toLocaleDateString('tr-TR',{month:'short',day:'numeric'}); });
      rChart.data.datasets[0].data=s.registrationsByDay.map(function(d){ return d[1]; });
      rChart.update('none');
    }

    /* CANLI ODALAR */
    document.getElementById('rmCnt').textContent='('+s.live.rooms.length+' oda)';
    if(s.live.rooms.length){
      var rh='<table class="dtbl"><thead><tr><th>Kod</th><th>Oyuncu</th><th>İzleyici</th><th>Faz</th><th>Tur</th></tr></thead><tbody>';
      s.live.rooms.forEach(function(rm){
        rh+='<tr><td><b style="color:#64ffda;font-family:monospace;letter-spacing:1px">'+esc(rm.code)+'</b></td>';
        rh+='<td><b>'+rm.playerCount+'</b></td>';
        rh+='<td>'+(rm.spectatorCount||0)+'</td>';
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
    var twr=s.topWinRate.map(function(p){ return Object.assign({},p,{_stat:'%'+p.winRate+' — '+p.played+' oyun',_barV:p.winRate}); });
    var tm=s.topMvps.map(function(p){ return Object.assign({},p,{_stat:'❤️ '+p.mvp+' MVP',_barV:p.mvp}); });
    var tl=s.topLosers.map(function(p){ return Object.assign({},p,{_stat:'💀 '+p.lost+' mağl.',_barV:p.lost}); });
    var td=s.topDonors.map(function(p){ return Object.assign({},p,{_stat:'₺'+p.totalDonated.toFixed(0),_barV:p.totalDonated}); });
    var tr2=s.topRichest.map(function(p){ return Object.assign({},p,{_stat:p.coins.toLocaleString('tr-TR')+' 💰',_barV:p.coins}); });

    document.getElementById('lbGrid').innerHTML=
      makeLb('🎮 En Aktif Oyuncular',tp,'','#64ffda')+
      makeLb('🏆 En Çok Kazananlar',tw,'','#27ae60')+
      makeLb('📊 En Yüksek Kazanma Oranı <small style="font-weight:400;color:#555577">(min 5 oyun)</small>',twr,'Henüz 5+ oyun oynayan yok','#27ae60')+
      makeLb('❤️ En Çok MVP Alanlar',tm,'','#e91e63')+
      makeLb('💀 En Çok Kaybeden',tl,'','#ff6b6b')+
      makeLb('💝 En Büyük Destekçiler',td,'Henüz bağış yapan yok','#e91e63')+
      makeLb('💰 En Zenginler',tr2,'','#ffd700');

    /* PREMİUM KULLANICILARI */
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

    /* EN POPÜLER EŞYALAR */
    if(s.inventory.topItems&&s.inventory.topItems.length){
      var maxC=s.inventory.topItems[0].count;
      var ih='<div>';
      s.inventory.topItems.forEach(function(item,i){
        var pct=maxC>0?Math.round(item.count/maxC*100):0;
        ih+='<div class="item-row">';
        ih+='<span class="item-rk">'+(i+1)+'</span>';
        ih+='<span class="item-id">'+esc(item.id)+'</span>';
        ih+='<div class="item-bar"><div class="item-bf" style="width:'+pct+'%"></div></div>';
        ih+='<span class="item-cnt">'+item.count+'</span>';
        ih+='</div>';
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
    if(q && !u.username.toLowerCase().includes(q)) return false;
    if(flt==='admin' && !u.isAdmin) return false;
    if(flt==='premium' && !u.premium?.active) return false;
    if(flt==='donor' && !(u.totalDonated>0)) return false;
    if(flt==='active' && !(u.stats?.played>0)) return false;
    if(flt==='never' && (u.stats?.played>0)) return false;
    return true;
  });
  list.sort(function(a,b){
    if(srt==='created_asc') return (a.created||0)-(b.created||0);
    if(srt==='played_desc') return (b.stats?.played||0)-(a.stats?.played||0);
    if(srt==='won_desc') return (b.stats?.won||0)-(a.stats?.won||0);
    if(srt==='coins_desc') return (b.coins||0)-(a.coins||0);
    if(srt==='donated_desc') return (b.totalDonated||0)-(a.totalDonated||0);
    return (b.created||0)-(a.created||0); // created_desc default
  });
  document.getElementById('usrFilterInfo').textContent=list.length+' sonuç';
  var html='';
  if(!list.length){
    html='<tr><td colspan="9" style="text-align:center;color:#555577;padding:24px;font-style:italic">Sonuç bulunamadı</td></tr>';
  } else {
    list.forEach(function(u,i){
      var badges='';
      if(u.isAdmin) badges+='<span class="usr-badge ub-admin">ADMİN</span> ';
      if(u.premium?.active) badges+='<span class="usr-badge ub-prem">👑 VIP '+(u.premium.daysLeft||0)+'g</span> ';
      if(u.totalDonated>0) badges+='<span class="usr-badge ub-don">💝</span>';
      var wr=u.stats?.played>0?Math.round(u.stats.won/u.stats.played*100):0;
      var created=u.created?new Date(u.created).toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
      html+='<tr>';
      html+='<td style="color:#555577;font-size:11px">'+(i+1)+'</td>';
      html+='<td><b style="color:#dde">'+esc(u.username)+'</b></td>';
      html+='<td>'+(badges||'<span style="color:#555577">—</span>')+'</td>';
      html+='<td><b>'+(u.stats?.played||0)+'</b></td>';
      html+='<td><span style="color:#27ae60">'+(u.stats?.won||0)+'</span>'+(u.stats?.played>0?' <span style="color:#555577;font-size:10px">%'+wr+'</span>':'')+'</td>';
      html+='<td><span style="color:#e91e63">'+(u.stats?.mvp||0)+'</span></td>';
      html+='<td style="color:#ffd700;font-weight:700">'+(u.coins||0).toLocaleString('tr-TR')+'</td>';
      html+='<td>'+(u.totalDonated>0?'<span style="color:#e91e63;font-weight:700">₺'+u.totalDonated.toFixed(0)+'</span>':'<span style="color:#555577">—</span>')+'</td>';
      html+='<td style="color:#555577;font-size:11px">'+created+'</td>';
      html+='</tr>';
    });
  }
  document.getElementById('usrTbody').innerHTML=html;
}

if(tk){ showDash(); }
setInterval(function(){ if(!document.getElementById('dash').classList.contains('hidden')) loadAll(); }, 30000);
</script>
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
  }
}

function toPresidentVote(rc) {
  const g = rooms.get(rc); if (!g) return;
  g.startPresidentVote(); emit(rc);
  startTimer(rc, g.config.PRESIDENT_VOTE_DURATION, () => {
    g.resolvePresidentVote(); emit(rc);
    setTimeout(() => toNight(rc), 2000);
  });
}

function toNight(rc) { const g = rooms.get(rc); if (!g) return; g.startNight(); emit(rc); startTimer(rc, g.config.NIGHT_DURATION, () => resolveNight(rc)); }
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
}
function resolveVote(rc) {
  const g = rooms.get(rc); if (!g) return;
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
        role: p.role, roleName: ro?.name, roleEmoji: ro?.emoji,
        team: p.actualTeam, isAlive: p.isAlive, isInsane: p.isInsane,
        isWinner: winnerSet.has(p.username),
        coinChange: coinUpdates[p.username]?.coinChange || 0
      };
    }),
    winners: winnerPlayers.map(p => ({
      id: p.id, name: p.name, username: p.username, avatar: p.avatar,
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
    }
  }, 1000);
  sabotageWatchers.set(rc, int);
}

function _emitImmediate(rc) {
  const g = rooms.get(rc); if (!g) return;
  const pub = g.publicState();
  io.to(rc).emit('state', pub);
  // Sadece odadaki canlı/ölü oyunculara priv gönder (not: spec data sadece ölülere gönderiliyor)
  let spec = null;
  g.players.forEach((p, pid) => {
    const sock = io.sockets.sockets.get(pid);
    if (!sock) return;
    sock.emit('priv', g.privateState(pid));
    if (!p.isAlive) {
      if (!spec) spec = g.spectatorState(); // lazy compute
      sock.emit('spec', spec);
    }
  });
  if (g.spectators.size > 0) {
    if (!spec) spec = g.spectatorState();
    g.spectators.forEach((_, sid) => io.sockets.sockets.get(sid)?.emit('spec', spec));
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

io.on('connection', (socket) => {
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
      socket.emit('statsUpdate', stats);
    }
    cb?.(r.success ? { ok: true } : { ok: false, err: r.error });
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
    const code = genCode(), g = new GameEngine(code, socket.id);
    g.addPlayer(socket.id, cleanName, u, stats?.stats?.won || 0, stats?.avatar, stats?.stats?.mvp || 0, !!stats?.isAdmin);
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
    if (!g.addPlayer(socket.id, cleanName, u, stats?.stats?.won || 0, stats?.avatar, stats?.stats?.mvp || 0, !!stats?.isAdmin)) return cb?.({ ok: false, err: 'Oda dolu!' });
    prooms.set(socket.id, code.toUpperCase()); socket.join(code.toUpperCase());
    cb?.({ ok: true, code: code.toUpperCase() }); emit(code.toUpperCase());
  });

  socket.on('room:spectate', ({ code }, cb) => {
    const u = authed.get(socket.id);
    if (!u) return cb({ ok: false, err: 'Giriş yap!' });
    const g = rooms.get(code);
    if (!g) return cb({ ok: false, err: 'Oda yok!' });
    const stats = Accounts.getStats(u);
    g.addSpectator(socket.id, u, u, stats?.avatar);
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
      prooms.set(socket.id, rc); socket.join(rc);
      cb?.({ ok: true, code: rc, active: true });
      // Yeni sokete mevcut state + priv gönder
      emit(rc);
      const priv = g.privateState(socket.id);
      if (priv) socket.emit('priv', priv);
    } else {
      // Lobi / post_game: normal addPlayer
      const cleanName = sanitizePlayerName(playerName);
      if (!cleanName) return cb?.({ ok: false, err: 'İsim gerekli' });
      const stats = Accounts.getStats(u);
      if (!g.addPlayer(socket.id, cleanName, u, stats?.stats?.won || 0, stats?.avatar, stats?.stats?.mvp || 0, !!stats?.isAdmin)) return cb?.({ ok: false, err: 'Oda dolu!' });
      prooms.set(socket.id, rc); socket.join(rc);
      cb?.({ ok: true, code: rc, active: false }); emit(rc);
    }
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
          g.removePlayer(socket.id); g.removeSpectator(socket.id);
          if (g.players.size === 0 && g.spectators.size === 0) { rooms.delete(rc); clearTimer(rc); }
          else {
            if (g.leaderId === socket.id && g.players.size > 0) {
              g.leaderId = [...g.players.keys()][0];
            }
            emit(rc);
          }
        } else {
          // Aktif oyunda oyuncuyu silme, sadece bağlantıyı izole et
          g.players.get(socket.id).isDisconnected = true;
          emit(rc); // Oyuncu offline olarak görünecek
        }
      }
      prooms.delete(socket.id);
    }
  });

  // Yeni oyun (post-game'den lobiye) — herkes başlatabilir
  socket.on('room:newGame', () => {
    const rc = prooms.get(socket.id);
    const g = rooms.get(rc);
    if (!g) return;
    if (g.phase !== PHASES.GAME_OVER && g.phase !== PHASES.POST_GAME && g.phase !== 'mvp_result') return;
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
    const u = authed.get(socket.id);
    if (!u) return cb?.({ ok: false, err: 'Giriş yap!' });
    const amt = parseInt(amount);
    if (!amt || amt < 5 || amt > 1000) return cb?.({ ok: false, err: 'Bahis 5-1000 arası olmalı!' });
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
    Accounts.addCoins(u, amt);
    g.bets.delete(u);
    cb?.({ ok: true });
    io.to(rc).emit('betUpdate', {
      bets: Object.fromEntries(g.bets || new Map()),
      total: [...(g.bets?.values() || [])].reduce((a, b) => a + b, 0)
    });
  });

  socket.on('start', (_, cb) => {
    const rc = prooms.get(socket.id), g = rooms.get(rc);
    if (!g || g.leaderId !== socket.id) return cb?.({ ok: false, err: 'Yetki yok!' });
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
    g.players.forEach((pp, pid) => {
      if (pp.actualTeam === 'hain')
        io.sockets.sockets.get(pid)?.emit('hainMsg', { from: p.name, msg });
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
          g.removePlayer(socket.id); g.removeSpectator(socket.id);
          if (g.players.size === 0 && g.spectators.size === 0) { rooms.delete(rc); clearTimer(rc); }
          else {
            if (g.leaderId === socket.id && g.players.size > 0) g.leaderId = [...g.players.keys()][0];
            emit(rc);
          }
        } else {
          // Aktif oyunda oyuncuyu silme, sadece bağlantıyı izole et
          const p = g.players.get(socket.id);
          if (p) {
            p.isDisconnected = true;
            emit(rc); // Oyuncu offline olarak görünecek
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`\n  ⛧ AZAP v4 aktif: http://localhost:${PORT}\n  Created by Azad Akdağ\n`));
