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

// ── ADMIN PANEL GÜVENLİĞİ: Sabit gizli anahtar (.env'den alınabilir) ──
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'azap-admin-2026-gizli-anahtar-degistir';

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

app.use(express.static(path.join(__dirname, '..', 'public'), {
  // Cache static assets (CSS, fonts) ama HTML cache'lenmesin
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
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

// JSON API: anlık istatistikler + geçmiş
app.get('/admin/analytics', adminLimiter, (req, res) => {
  if (!checkAdmin(req, res)) return;
  const activeRooms = rooms.size;
  const playersInRooms = Array.from(rooms.values()).reduce((sum, g) => sum + g.players.size, 0);
  const uptime = Math.floor((Date.now() - siteStats.startedAt) / 1000);
  res.json({
    ok: true,
    stats: {
      totalConnections: siteStats.totalConnections,
      currentActive: siteStats.currentActive,
      peakConcurrent: siteStats.peakConcurrent,
      uptimeSeconds: uptime,
      activeRooms: activeRooms,
      playersInRooms: playersInRooms,
      history: siteStats.history // Sunucu tarafında tutulan rolling window
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

// HTML Dashboard: görsel admin paneli
app.get('/admin/dashboard', adminLimiter, (req, res) => {
  if (!checkAdmin(req, res)) return;
  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AZAP Admin Panel</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f1a;color:#e0e0ff;padding:20px;min-height:100vh}
.container{max-width:1200px;margin:0 auto}
h1{color:#ff6b6b;margin-bottom:8px;font-size:28px}
.sub{color:#8892b0;font-size:14px;margin-bottom:30px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:30px}
.card{background:#1a1a2e;border-radius:12px;padding:20px;border:1px solid #2d2d44}
.card h3{color:#8892b0;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
.card .value{color:#fff;font-size:36px;font-weight:700}
.refresh{background:#ff6b6b;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:14px;margin-bottom:20px}
.refresh:hover{background:#ff5252}
.logout{background:#2d2d44;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:14px;margin-bottom:20px;margin-left:10px}
.logout:hover{background:#ff6b6b}
.error{color:#ff6b6b;text-align:center;padding:40px}
.time{color:#64ffda;font-weight:600}
.chart-container{background:#1a1a2e;border-radius:12px;padding:20px;border:1px solid #2d2d44;margin-bottom:20px}
.chart-title{color:#8892b0;font-size:14px;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px}
.login-box{max-width:400px;margin:100px auto;background:#1a1a2e;border-radius:16px;padding:40px;border:1px solid #2d2d44}
.login-box h2{color:#ff6b6b;margin-bottom:20px;text-align:center}
.login-box input{width:100%;padding:12px;border-radius:8px;border:1px solid #2d2d44;background:#0f0f1a;color:#fff;margin-bottom:16px;font-size:14px}
.login-box button{width:100%;padding:12px;background:#ff6b6b;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:16px}
.login-box button:hover{background:#ff5252}
.login-error{color:#ff6b6b;margin-top:12px;text-align:center;font-size:14px}
.hidden{display:none}
</style>
</head>
<body>
<!-- LOGIN SAYFASI -->
<div id="loginPage" class="login-box">
<h2>AZAP Admin Girişi</h2>
<input type="password" id="tokenInput" placeholder="Admin token girin..." autocomplete="off">
<button onclick="doLogin()">Giriş Yap</button>
<div id="loginError" class="login-error"></div>
</div>

<!-- DASHBOARD -->
<div id="dashboard" class="hidden">
<div class="container">
<h1>AZAP Admin Panel</h1>
<p class="sub">Canlı Site İstatistikleri</p>
<button class="refresh" onclick="loadStats()">Yenile</button>
<button class="logout" onclick="doLogout()">Çıkış Yap</button>
<div id="stats" class="grid">
<div class="card"><h3>Şu An Sitede</h3><div class="value" id="current">-</div></div>
<div class="card"><h3>Toplam Bağlantı</h3><div class="value" id="total">-</div></div>
<div class="card"><h3>Rekor Anlık</h3><div class="value" id="peak">-</div></div>
<div class="card"><h3>Aktif Oda</h3><div class="value" id="rooms">-</div></div>
<div class="card"><h3>Odada Oyuncu</h3><div class="value" id="players">-</div></div>
<div class="card"><h3>Uptime</h3><div class="value" id="uptime">-</div></div>
</div>
<div class="chart-container">
<div class="chart-title">Canlı Oyuncu Grafiği (Son 5 Dakika)</div>
<canvas id="playerChart" height="80"></canvas>
</div>
<div class="chart-container">
<div class="chart-title">Oda & Oyuncu Dağılımı</div>
<canvas id="roomChart" height="80"></canvas>
</div>
<p class="sub">Son güncelleme: <span class="time" id="lastUpdate">-</span></p>
</div>
</div>

<script>
let token = localStorage.getItem('azap_admin_token');
const loginPage = document.getElementById('loginPage');
const dashboard = document.getElementById('dashboard');

function showDashboard(){
  loginPage.classList.add('hidden');
  dashboard.classList.remove('hidden');
  initCharts();
  loadStats();
}
function showLogin(){
  localStorage.removeItem('azap_admin_token');
  loginPage.classList.remove('hidden');
  dashboard.classList.add('hidden');
}

async function doLogin(){
  const input = document.getElementById('tokenInput');
  const t = input.value.trim();
  if(!t){document.getElementById('loginError').textContent='Token girin';return;}
  try{
    const r = await fetch('/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t})});
    const d = await r.json();
    if(d.ok && d.admin){
      token = t;
      localStorage.setItem('azap_admin_token', token);
      showDashboard();
    } else {
      document.getElementById('loginError').textContent = d.error || 'Geçersiz token';
    }
  }catch(e){document.getElementById('loginError').textContent='Hata: '+e.message;}
}
function doLogout(){showLogin();}

// Enter tuşu
 document.getElementById('tokenInput').addEventListener('keypress', e => {if(e.key==='Enter')doLogin();});

let playerChart, roomChart;
function initCharts(){
  playerChart = new Chart(document.getElementById('playerChart'),{
    type:'line',
    data:{labels:[],datasets:[{label:'Aktif Oyuncu',data:[],borderColor:'#64ffda',backgroundColor:'rgba(100,255,218,0.1)',fill:true,tension:0.4}]},
    options:{responsive:true,scales:{x:{display:false},y:{beginAtZero:true,grid:{color:'#2d2d44'}}},plugins:{legend:{display:false}}}
  });
  roomChart = new Chart(document.getElementById('roomChart'),{
    type:'bar',
    data:{labels:['Aktif Oda','Odadaki Oyuncu'],datasets:[{data:[0,0],backgroundColor:['#ff6b6b','#4ecdc4']}]},
    options:{responsive:true,scales:{y:{beginAtZero:true,grid:{color:'#2d2d44'}}},plugins:{legend:{display:false}}}
  });
}

function fmt(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h+'s '+m+'d '+(s%60)+'sn';}

async function loadStats(){
  if(!token){showLogin();return;}
  try{
    const r = await fetch('/admin/analytics?token='+encodeURIComponent(token));
    const d = await r.json();
    if(!d.ok){
      if(d.error && (d.error.includes('Forbidden')||d.error.includes('token'))){showLogin();return;}
      document.getElementById('stats').innerHTML='<div class="error">'+d.error+'</div>';return;
    }

    document.getElementById('current').textContent=d.stats.currentActive;
    document.getElementById('total').textContent=d.stats.totalConnections;
    document.getElementById('peak').textContent=d.stats.peakConcurrent;
    document.getElementById('rooms').textContent=d.stats.activeRooms;
    document.getElementById('players').textContent=d.stats.playersInRooms;
    document.getElementById('uptime').textContent=fmt(d.stats.uptimeSeconds);
    document.getElementById('lastUpdate').textContent=new Date().toLocaleTimeString('tr-TR');

    // Sunucudan gelen history verisi ile grafikleri güncelle
    if(d.stats.history && d.stats.history.length>0 && playerChart && roomChart){
      const hist = d.stats.history;
      playerChart.data.labels = hist.map(h => new Date(h.timestamp).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}));
      playerChart.data.datasets[0].data = hist.map(h => h.currentActive);
      playerChart.update('none');

      roomChart.data.datasets[0].data = [d.stats.activeRooms, d.stats.playersInRooms];
      roomChart.update('none');
    }
  }catch(e){document.getElementById('stats').innerHTML='<div class="error">Hata: '+e.message+'</div>';}
}

// Sayfa yüklenince token varsa direkt dashboard
if(token){showDashboard();}
setInterval(()=>{if(!dashboard.classList.contains('hidden'))loadStats();},5000);
</script>
</body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('*', (_, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
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

  // ── HAIN SABOTAJI (pending varsa SABAH OLUNCA DİREKT başlat) ──
  // Frontend her hedef için kendi rastgele delay'ini uygulayacak
  if (g.sabotagePending) {
    setTimeout(() => {
      if (!rooms.has(rc)) return;
      if (g.phase !== PHASES.DAY_DISCUSSION && g.phase !== PHASES.VOTING) return;
      if (g.sabotageActive) return;
      const ok = g.triggerSabotage(false);
      if (ok) {
        io.to(rc).emit('sabotage:start', {
          targetIds: [...g.sabotageTargets.keys()],
          fromSystem: false
        });
        emit(rc);
      }
    }, 500); // 0.5sn — neredeyse anında başlasın
  } else {
    // ── SİSTEM RANDOM SABOTAJI (~%20 ihtimal, hain sabotajı yoksa) ──
    if (crypto.randomInt(0, 100) < 20) {
      // Sistem sabotajı için biraz daha bekleme makul (anında olmasın, oyun akışı için)
      const triggerAt = crypto.randomInt(5000, 35001); // 5-35sn arası rastgele
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
          emit(rc);
        }
      }, triggerAt);
    }
  }
}
function toVote(rc) {
  const g = rooms.get(rc); if (!g) return;
  // Sabotaj aktifse oylama başlamaz, 5 saniyede bir kontrol et
  if (g.sabotageActive) {
    setTimeout(() => toVote(rc), 5000);
    return;
  }
  g.startVoting();
  emit(rc);
  startTimer(rc, g.config.VOTING_DURATION, () => resolveVote(rc));
}
function resolveVote(rc) {
  const g = rooms.get(rc); if (!g) return;
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
    startTimer(rc, g.config.RESULT_DURATION, () => { g.nextRound(); emit(rc); startTimer(rc, g.config.NIGHT_DURATION, () => resolveNight(rc)); });
  }
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

  socket.on('room:leave', () => {
    const rc = prooms.get(socket.id);
    if (rc) {
      const g = rooms.get(rc);
      if (g) {
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
      }
      socket.leave(rc);
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
        // Oylayabilecek (canlı VE karantinada/donmuş olmayan) oyuncu sayısı
        const eligibleVoters = g.alive().filter(p => !g.frozen.has(p.id)).length;
        if (g.votes.size >= eligibleVoters) {
          clearTimer(rc);
          resolveVote(rc);
        }
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
    const totalUsers = users.length;
    const totalAdmins = users.filter(u => u.isAdmin).length;
    const activePremium = users.filter(u => u.premium?.active).length;
    const totalDonations = users.reduce((s, u) => s + (u.totalDonated || 0), 0);
    const totalCoinsSold = users.reduce((s, u) => s + (u.coins || 0), 0);

    // Oyun istatistikleri
    const totalGamesPlayed = users.reduce((s, u) => s + (u.stats?.played || 0), 0);
    const totalGamesWon = users.reduce((s, u) => s + (u.stats?.won || 0), 0);
    const totalMVPs = users.reduce((s, u) => s + (u.stats?.mvp || 0), 0);

    // Aktif odalar (live)
    const activeRooms = rooms.size;
    const playersInRooms = [...rooms.values()].reduce((s, g) => s + g.players.size, 0);

    // En aktif oyuncular (top 10)
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

    // Top kazananlar
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

    // Top destekçiler (bağışçılar)
    const topDonors = users
      .filter(u => u.totalDonated > 0)
      .map(u => ({ username: u.username, totalDonated: u.totalDonated }))
      .sort((a, b) => b.totalDonated - a.totalDonated)
      .slice(0, 10);

    // En zenginler (coin)
    const topRichest = users
      .filter(u => u.coins > 0)
      .map(u => ({ username: u.username, coins: u.coins }))
      .sort((a, b) => b.coins - a.coins)
      .slice(0, 10);

    // Kayıt zaman serisi (son 30 gün)
    const now = Date.now();
    const days30Ago = now - 30 * 24 * 60 * 60 * 1000;
    const dayBuckets = {};
    users.forEach(u => {
      if (!u.created || u.created < days30Ago) return;
      const day = new Date(u.created).toISOString().split('T')[0];
      dayBuckets[day] = (dayBuckets[day] || 0) + 1;
    });
    const registrationsByDay = Object.entries(dayBuckets)
      .sort((a, b) => a[0].localeCompare(b[0]));

    // Bug raporları
    const reports = Reports.list();
    const openReports = reports.filter(r => r.status === 'open' || !r.status).length;
    const closedReports = reports.length - openReports;

    cb?.({
      ok: true,
      stats: {
        users: { total: totalUsers, admins: totalAdmins, premium: activePremium },
        finance: { totalDonations: totalDonations, totalCoins: totalCoinsSold },
        games: { played: totalGamesPlayed, won: totalGamesWon, mvps: totalMVPs },
        live: { activeRooms, playersInRooms },
        reports: { open: openReports, closed: closedReports, total: reports.length },
        topPlayers, topWinners, topDonors, topRichest,
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
          g.removePlayer(socket.id); g.removeSpectator(socket.id);
          if (g.players.size === 0 && g.spectators.size === 0) { rooms.delete(rc); clearTimer(rc); }
          else {
            if (g.leaderId === socket.id && g.players.size > 0) g.leaderId = [...g.players.keys()][0];
            emit(rc);
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