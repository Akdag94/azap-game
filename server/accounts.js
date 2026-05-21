const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const DB = path.join(__dirname, '..', 'data', 'users.json');
const AVATAR_DIR = path.join(__dirname, '..', 'data', 'avatars');
if (!fs.existsSync(path.dirname(DB))) fs.mkdirSync(path.dirname(DB), { recursive: true });
if (!fs.existsSync(DB)) fs.writeFileSync(DB, '{}');
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

// ── IN-MEMORY CACHE: disk I/O'yu minimize et ──
let _cache = null;
let _writeTimer = null;
const WRITE_DELAY = 2000; // 2 saniyede bir diske yaz (debounced)

function read() {
  if (!_cache) {
    try { _cache = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { _cache = {}; }
  }
  return _cache;
}
function write(d) {
  _cache = d;
  // Debounced disk yazma — sık ardışık write'ları tek yazıma indir
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    try { fs.writeFileSync(DB, JSON.stringify(_cache, null, 2)); } catch(e) { console.error('[DB] Yazma hatası:', e.message); }
  }, WRITE_DELAY);
}
// Sunucu kapanırken cache'i diske yaz
process.on('exit', () => { if (_cache) try { fs.writeFileSync(DB, JSON.stringify(_cache, null, 2)); } catch {} });
process.on('SIGINT', () => { if (_cache) try { fs.writeFileSync(DB, JSON.stringify(_cache, null, 2)); } catch {} process.exit(); });
process.on('SIGTERM', () => { if (_cache) try { fs.writeFileSync(DB, JSON.stringify(_cache, null, 2)); } catch {} process.exit(); });

// Avatar DB değeri → URL dönüştürücü (cache-busting ile)
// External URL ise (Giphy CDN gibi) olduğu gibi döner
function avatarUrl(val) {
  if (!val) return null;
  if (typeof val === 'string' && /^https?:\/\//i.test(val)) return val;
  return '/avatars/' + val + '?v=' + Date.now();
}

function ensureStats(u) {
  if (!u.stats) u.stats = { played: 0, won: 0, lost: 0, mvp: 0 };
  if (typeof u.stats.mvp !== 'number') u.stats.mvp = 0;
  if (typeof u.coins !== 'number') u.coins = 100; // Yeni hesaplara 100 coin başlangıç
  if (!u.inventory) u.inventory = []; // Mağazadan satın alınan eşyalar
  // Premium üyelik
  if (!u.premium) u.premium = { active: false, expiresAt: 0, since: null };
  // Toplam bağış (TL)
  if (typeof u.totalDonated !== 'number') u.totalDonated = 0;
  // Ödeme geçmişi
  if (!u.payments) u.payments = []; // { id, type, amount, currency, status, date }
  return u;
}

// Coin işlemleri (ekleme her zaman OK; çıkarma 0'ın altına düşüremez)
function addCoins(u, amount) {
  ensureStats(u);
  u.coins = Math.max(0, (u.coins || 0) + amount);
  return u.coins;
}

// Premium aktif mi (süre kontrolü ile)
function isPremiumActive(u) {
  if (!u || !u.premium) return false;
  if (!u.premium.active) return false;
  if (u.premium.expiresAt && u.premium.expiresAt < Date.now()) {
    // Süresi dolmuş - pasifleştir
    u.premium.active = false;
    return false;
  }
  return true;
}

function getEquippedFromUser(u) {
  ensureStats(u);
  const equipped = {};
  u.inventory.forEach(it => {
    const item = typeof it === 'string' ? { id: it, equipped: false } : it;
    if (item.equipped) {
      const id = String(item.id || '');
      const parts = id.split('_');
      const category =
        parts[0] === 'frame' || id.includes('_frame') ? 'frame' :
        parts[0] === 'font' || id.includes('_font') ? 'font' :
        parts[0] === 'pet' || id.includes('_pet') ? 'pet' :
        parts[0];
      equipped[category] = item.id;
    }
  });
  return equipped;
}

module.exports = {
  register(username, password) {
    const db = read(), key = username.toLowerCase().trim();
    if (key.length < 2 || key.length > 16) return { success: false, error: 'Kullanıcı adı 2-16 karakter.' };
    if (password.length < 3) return { success: false, error: 'Şifre en az 3 karakter.' };
    if (db[key]) return { success: false, error: 'Bu kullanıcı adı alınmış.' };
    db[key] = { username: username.trim(), hash: bcrypt.hashSync(password, 8), avatar: null, stats: { played: 0, won: 0, lost: 0, mvp: 0 }, coins: 100, inventory: [], created: Date.now() };
    write(db);
    return { success: true, user: { username: db[key].username, avatar: null, stats: db[key].stats, coins: 100, inventory: [], equipped: {}, premium: { active: false, daysLeft: 0 } } };
  },
  login(username, password, rememberMe) {
    const db = read(), key = username.toLowerCase().trim(), u = db[key];
    if (!u) return { success: false, error: 'Kullanıcı bulunamadı.' };
    if (!bcrypt.compareSync(password, u.hash)) return { success: false, error: 'Şifre yanlış.' };
    ensureStats(u);
    let token = null;
    if (rememberMe) {
      token = require('crypto').randomBytes(24).toString('hex');
      if (!u.tokens) u.tokens = [];
      u.tokens.push({ token, created: Date.now() });
      if (u.tokens.length > 5) u.tokens = u.tokens.slice(-5);
    }
    write(db);
    return { success: true, user: { username: u.username, avatar: avatarUrl(u.avatar), stats: u.stats, coins: u.coins, inventory: u.inventory, equipped: getEquippedFromUser(u), premium: { active: isPremiumActive(u), expiresAt: u.premium.expiresAt, daysLeft: isPremiumActive(u) ? Math.ceil((u.premium.expiresAt - Date.now()) / 86400000) : 0 }, isAdmin: !!u.isAdmin }, token };
  },

  // Token ile otomatik giriş
  loginByToken(token) {
    if (!token) return { success: false };
    const db = read();
    for (const key in db) {
      const u = db[key];
      if (u.tokens?.some(t => t.token === token)) {
        ensureStats(u);
        return { success: true, user: { username: u.username, avatar: avatarUrl(u.avatar), stats: u.stats, coins: u.coins, inventory: u.inventory, equipped: getEquippedFromUser(u), premium: { active: isPremiumActive(u), expiresAt: u.premium.expiresAt, daysLeft: isPremiumActive(u) ? Math.ceil((u.premium.expiresAt - Date.now()) / 86400000) : 0 }, isAdmin: !!u.isAdmin } };
      }
    }
    return { success: false };
  },

  // Çıkış: token'ı sil
  logoutToken(token) {
    if (!token) return;
    const db = read();
    for (const key in db) {
      const u = db[key];
      if (u.tokens?.some(t => t.token === token)) {
        u.tokens = u.tokens.filter(t => t.token !== token);
        write(db);
        return;
      }
    }
  },
  changePassword(username, oldPass, newPass) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return { success: false, error: 'Kullanıcı yok.' };
    if (!bcrypt.compareSync(oldPass, db[key].hash)) return { success: false, error: 'Eski şifre yanlış.' };
    if (newPass.length < 3) return { success: false, error: 'Yeni şifre en az 3 karakter.' };
    db[key].hash = bcrypt.hashSync(newPass, 8);
    write(db);
    return { success: true };
  },
  setAvatar(username, dataUrl) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return { success: false };
    // GIF için 2MB, statik için 280KB sınırı
    const isGif = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/gif');
    const maxSize = isGif ? 2_100_000 : 280_000;
    if (dataUrl && dataUrl.length > maxSize) {
      return { success: false, error: isGif ? 'GIF çok büyük (max ~1.5MB).' : 'Fotoğraf çok büyük (max ~200KB).' };
    }
    if (dataUrl) {
      // dataURL → dosyaya yaz
      const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!match) return { success: false, error: 'Geçersiz görsel formatı.' };
      const allowed = ['jpeg', 'jpg', 'png', 'gif', 'webp'];
      if (!allowed.includes(match[1].toLowerCase())) return { success: false, error: 'Sadece JPG/PNG/GIF/WEBP destekleniyor.' };
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1].toLowerCase();
      const buf = Buffer.from(match[2], 'base64');
      // Önceki avatar harici URL ise dosya silmeye gerek yok
      const fname = key + '.' + ext;
      // Eski farklı uzantılı dosyaları temizle
      ['jpg','jpeg','png','gif','webp'].forEach(e => {
        if (e !== ext) {
          const old = path.join(AVATAR_DIR, key + '.' + e);
          if (fs.existsSync(old)) { try { fs.unlinkSync(old); } catch {} }
        }
      });
      fs.writeFileSync(path.join(AVATAR_DIR, fname), buf);
      // DB'de sadece dosya adını sakla
      db[key].avatar = fname;
    } else {
      // Avatar silme
      const cur = db[key].avatar;
      if (cur && !/^https?:\/\//i.test(cur)) {
        try { fs.unlinkSync(path.join(AVATAR_DIR, cur)); } catch {}
      }
      db[key].avatar = null;
    }
    write(db);
    return { success: true, avatar: avatarUrl(db[key].avatar) };
  },
  // Giphy / harici GIF URL'i avatar olarak ayarla (lokal disk kullanmaz)
  setAvatarUrl(username, url) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return { success: false };
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return { success: false, error: 'Geçersiz URL.' };
    // Güvenlik: sadece güvenilir Giphy / Tenor CDN domainlerine izin ver
    const allowedHosts = [
      'media.giphy.com', 'media0.giphy.com', 'media1.giphy.com', 'media2.giphy.com', 'media3.giphy.com', 'media4.giphy.com',
      'i.giphy.com', 'giphy.com',
      'media.tenor.com', 'c.tenor.com', 'tenor.com'
    ];
    let host = '';
    try { host = new URL(url).host.toLowerCase(); } catch { return { success: false, error: 'Geçersiz URL.' }; }
    if (!allowedHosts.includes(host)) return { success: false, error: 'Sadece Giphy/Tenor CDN URL\'leri kabul edilir.' };
    if (url.length > 500) return { success: false, error: 'URL çok uzun.' };
    // Önceki lokal dosya varsa sil (yer açmak için)
    const cur = db[key].avatar;
    if (cur && !/^https?:\/\//i.test(cur)) {
      try { fs.unlinkSync(path.join(AVATAR_DIR, cur)); } catch {}
    }
    db[key].avatar = url;
    write(db);
    return { success: true, avatar: avatarUrl(db[key].avatar) };
  },
  getStats(username) {
    const db = read(), u = db[username?.toLowerCase()?.trim()];
    if (!u) return null;
    ensureStats(u);
    const isActive = isPremiumActive(u);
    // Özel çerçeveleri otomatik tanı (bağışçı, premium, admin)
    let dirty = false;
    const hasItem = (id) => u.inventory.some(it => (typeof it === 'string' ? it : it.id) === id);
    if ((u.totalDonated > 0 || !!u.isAdmin) && !hasItem('frame_donor')) {
      u.inventory.push({ id: 'frame_donor', equipped: false });
      dirty = true;
    }
    if ((isActive || !!u.isAdmin) && !hasItem('frame_premium')) {
      u.inventory.push({ id: 'frame_premium', equipped: false });
      dirty = true;
    }
    // Premium süresi bittiyse frame'i kaldır (admin hariç)
    if (!isActive && !u.isAdmin && hasItem('frame_premium')) {
      u.inventory = u.inventory.filter(it => (typeof it === 'string' ? it : it.id) !== 'frame_premium');
      dirty = true;
    }
    if (dirty) write(db);
    const equipped = getEquippedFromUser(u);
    return {
      username: u.username, avatar: avatarUrl(u.avatar),
      stats: u.stats, coins: u.coins, inventory: u.inventory,
      equipped,
      premium: {
        active: isActive,
        expiresAt: u.premium.expiresAt,
        daysLeft: isActive ? Math.ceil((u.premium.expiresAt - Date.now()) / 86400000) : 0
      },
      totalDonated: u.totalDonated || 0,
      isAdmin: !!u.isAdmin
    };
  },
  // Coin işlemleri
  addCoins(username, amount) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return { success: false, error: 'Kullanıcı yok' };
    ensureStats(db[key]);
    const newAmount = addCoins(db[key], amount);
    write(db);
    return { success: true, coins: newAmount };
  },
  // Coin yeterli mi (mağaza için)
  hasCoins(username, amount) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return false;
    ensureStats(db[key]);
    return (db[key].coins || 0) >= amount;
  },
  // Coin çıkar (yetersizse hata)
  spendCoins(username, amount) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return { success: false, error: 'Kullanıcı yok' };
    ensureStats(db[key]);
    if ((db[key].coins || 0) < amount) return { success: false, error: 'Yetersiz coin' };
    db[key].coins -= amount;
    write(db);
    return { success: true, coins: db[key].coins };
  },
  // Envantere ekle
  addToInventory(username, itemId) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return { success: false };
    ensureStats(db[key]);
    // Eski format (string array) → yeni format (obj array) migration
    db[key].inventory = db[key].inventory.map(it =>
      typeof it === 'string' ? { id: it, equipped: false, acquiredAt: Date.now() } : it
    );
    if (!db[key].inventory.find(it => it.id === itemId)) {
      db[key].inventory.push({ id: itemId, equipped: false, acquiredAt: Date.now() });
    }
    write(db);
    return { success: true };
  },

  // Eşya aktif et / pasifle (kategori başına 1 eşya aktif olabilir)
  toggleEquip(username, itemId, equipped) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return { success: false, error: 'Kullanıcı yok' };
    ensureStats(db[key]);
    // Migration
    db[key].inventory = db[key].inventory.map(it =>
      typeof it === 'string' ? { id: it, equipped: false, acquiredAt: Date.now() } : it
    );
    const item = db[key].inventory.find(it => it.id === itemId);
    if (!item) return { success: false, error: 'Eşya envanterinde yok' };
    const parts = itemId.split('_');
    const category =
      parts[0] === 'frame' || itemId.includes('_frame') ? 'frame' :
      parts[0] === 'font' || itemId.includes('_font') ? 'font' :
      parts[0] === 'pet' || itemId.includes('_pet') ? 'pet' :
      parts[0];
    if (equipped) {
      // Aynı kategorideki diğer eşyaları pasifleştir
      db[key].inventory.forEach(it => {
        const itId = String(it.id || '');
        const itParts = itId.split('_');
        const itCategory =
          itParts[0] === 'frame' || itId.includes('_frame') ? 'frame' :
          itParts[0] === 'font' || itId.includes('_font') ? 'font' :
          itParts[0] === 'pet' || itId.includes('_pet') ? 'pet' :
          itParts[0];
        if (it.id !== itemId && itCategory === category) it.equipped = false;
      });
      item.equipped = true;
    } else {
      item.equipped = false;
    }
    write(db);
    return { success: true, inventory: db[key].inventory };
  },

  // Aktif eşyaları kategori bazında döndür (frame, font, color vb.)
  getEquipped(username) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return {};
    ensureStats(db[key]);
    return getEquippedFromUser(db[key]);
  },

  // ── PREMIUM ÜYELİK ──
  // 30 günlük premium ekle (yenileme ise mevcut süreye eklenir)
  activatePremium(username, days = 30) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return { success: false, error: 'Kullanıcı yok' };
    ensureStats(db[key]);
    const u = db[key];
    const now = Date.now();
    const ms = days * 24 * 60 * 60 * 1000;
    // Eğer hâlâ aktifse: mevcut süreye ekle
    const baseTime = (u.premium.expiresAt && u.premium.expiresAt > now) ? u.premium.expiresAt : now;
    u.premium.expiresAt = baseTime + ms;
    u.premium.active = true;
    if (!u.premium.since) u.premium.since = now;
    write(db);
    return { success: true, expiresAt: u.premium.expiresAt };
  },

  // Premium durumunu döndür (otomatik süresi dolmuş ise pasifleştirir)
  getPremium(username) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return null;
    ensureStats(db[key]);
    const u = db[key];
    const isActive = isPremiumActive(u);
    write(db);
    return {
      active: isActive,
      expiresAt: u.premium.expiresAt,
      since: u.premium.since,
      daysLeft: isActive ? Math.ceil((u.premium.expiresAt - Date.now()) / (24*60*60*1000)) : 0
    };
  },

  isPremium(username) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return false;
    ensureStats(db[key]);
    const r = isPremiumActive(db[key]);
    write(db);
    return r;
  },

  // ── BAĞIŞ ──
  recordDonation(username, amountTL) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return { success: false };
    ensureStats(db[key]);
    db[key].totalDonated += amountTL;
    write(db);
    return { success: true, total: db[key].totalDonated };
  },

  // ── ÖDEME GEÇMİŞİ ──
  recordPayment(username, payment) {
    // payment: { id, type, amount, currency, status, date, ...meta }
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return { success: false };
    ensureStats(db[key]);
    db[key].payments.push({ ...payment, date: payment.date || Date.now() });
    // Son 50 ödeme geçmişi tutulsun
    if (db[key].payments.length > 50) db[key].payments = db[key].payments.slice(-50);
    write(db);
    return { success: true };
  },

  isAdmin(username) {
    const db = read(), u = db[username?.toLowerCase()?.trim()];
    return !!(u && u.isAdmin);
  },
  getAvatar(username) {
    const db = read(), u = db[username?.toLowerCase()?.trim()];
    return avatarUrl(u?.avatar);
  },
  record(username, won) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return; ensureStats(db[key]);
    db[key].stats.played++; if (won) db[key].stats.won++; else db[key].stats.lost++; write(db);
  },
  recordMvp(username) {
    const db = read(), key = username?.toLowerCase()?.trim();
    if (!db[key]) return; ensureStats(db[key]);
    db[key].stats.mvp++; write(db);
  },
  leaderboard(n = 30) {
    return Object.values(read()).map(u => { ensureStats(u); return { username: u.username, avatar: avatarUrl(u.avatar), stats: u.stats }; }).sort((a, b) => b.stats.won - a.stats.won).slice(0, n);
  },

  // ── ADMIN METODLARI ──
  // Tüm kullanıcıları listele (admin için)
  listAll() {
    const db = read();
    return Object.entries(db).map(([key, u]) => {
      ensureStats(u);
      return {
        key,
        username: u.username,
        avatar: avatarUrl(u.avatar),
        stats: u.stats,
        coins: u.coins || 0,
        premium: { active: isPremiumActive(u), daysLeft: isPremiumActive(u) ? Math.ceil((u.premium.expiresAt - Date.now()) / 86400000) : 0 },
        totalDonated: u.totalDonated || 0,
        isAdmin: !!u.isAdmin,
        created: u.created || 0
      };
    }).sort((a, b) => (b.created || 0) - (a.created || 0));
  },

  // Admin tarafından yeni hesap oluştur (şifre hashlenir)
  adminCreate(username, password, isAdmin) {
    const db = read(), key = (username || '').toLowerCase().trim();
    if (key.length < 2 || key.length > 16) return { success: false, error: 'Kullanıcı adı 2-16 karakter.' };
    if (!password || password.length < 3) return { success: false, error: 'Şifre en az 3 karakter.' };
    if (db[key]) return { success: false, error: 'Bu kullanıcı adı alınmış.' };
    db[key] = {
      username: username.trim(),
      hash: bcrypt.hashSync(password, 8),
      avatar: null,
      stats: { played: 0, won: 0, lost: 0, mvp: 0 },
      created: Date.now(),
      isAdmin: !!isAdmin
    };
    write(db);
    return { success: true };
  },

  // Admin tarafından hesap sil
  adminDelete(username) {
    const db = read(), key = (username || '').toLowerCase().trim();
    if (!db[key]) return { success: false, error: 'Kullanıcı yok.' };
    delete db[key];
    write(db);
    return { success: true };
  },

  // Admin tarafından istatistik düzenleme
  adminSetStats(username, stats) {
    const db = read(), key = (username || '').toLowerCase().trim();
    if (!db[key]) return { success: false, error: 'Kullanıcı yok.' };
    ensureStats(db[key]);
    if (typeof stats.played === 'number') db[key].stats.played = Math.max(0, Math.floor(stats.played));
    if (typeof stats.won === 'number') db[key].stats.won = Math.max(0, Math.floor(stats.won));
    if (typeof stats.lost === 'number') db[key].stats.lost = Math.max(0, Math.floor(stats.lost));
    if (typeof stats.mvp === 'number') db[key].stats.mvp = Math.max(0, Math.floor(stats.mvp));
    write(db);
    return { success: true };
  },

  // Admin yetkisini değiştir
  adminToggle(username, isAdmin) {
    const db = read(), key = (username || '').toLowerCase().trim();
    if (!db[key]) return { success: false, error: 'Kullanıcı yok.' };
    db[key].isAdmin = !!isAdmin;
    write(db);
    return { success: true };
  },

  // Admin tarafından şifre sıfırlama (yeni şifre setle)
  adminResetPassword(username, newPass) {
    const db = read(), key = (username || '').toLowerCase().trim();
    if (!db[key]) return { success: false, error: 'Kullanıcı yok.' };
    if (!newPass || newPass.length < 3) return { success: false, error: 'Yeni şifre en az 3 karakter.' };
    db[key].hash = bcrypt.hashSync(newPass, 8);
    write(db);
    return { success: true };
  }
};