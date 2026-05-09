const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const DB = path.join(__dirname, '..', 'data', 'users.json');
if (!fs.existsSync(path.dirname(DB))) fs.mkdirSync(path.dirname(DB), { recursive: true });
if (!fs.existsSync(DB)) fs.writeFileSync(DB, '{}');
function read() { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return {}; } }
function write(d) { fs.writeFileSync(DB, JSON.stringify(d, null, 2)); }

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

module.exports = {
  register(username, password) {
    const db = read(), key = username.toLowerCase().trim();
    if (key.length < 2 || key.length > 16) return { success: false, error: 'Kullanıcı adı 2-16 karakter.' };
    if (password.length < 3) return { success: false, error: 'Şifre en az 3 karakter.' };
    if (db[key]) return { success: false, error: 'Bu kullanıcı adı alınmış.' };
    db[key] = { username: username.trim(), hash: bcrypt.hashSync(password, 8), avatar: null, stats: { played: 0, won: 0, lost: 0, mvp: 0 }, coins: 100, inventory: [], created: Date.now() };
    write(db);
    return { success: true, user: { username: db[key].username, avatar: null, stats: db[key].stats, coins: 100, inventory: [], premium: { active: false, daysLeft: 0 } } };
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
    return { success: true, user: { username: u.username, avatar: u.avatar || null, stats: u.stats, coins: u.coins, inventory: u.inventory, premium: { active: isPremiumActive(u), expiresAt: u.premium.expiresAt, daysLeft: isPremiumActive(u) ? Math.ceil((u.premium.expiresAt - Date.now()) / 86400000) : 0 }, isAdmin: !!u.isAdmin }, token };
  },

  // Token ile otomatik giriş
  loginByToken(token) {
    if (!token) return { success: false };
    const db = read();
    for (const key in db) {
      const u = db[key];
      if (u.tokens?.some(t => t.token === token)) {
        ensureStats(u);
        return { success: true, user: { username: u.username, avatar: u.avatar || null, stats: u.stats, coins: u.coins, inventory: u.inventory, premium: { active: isPremiumActive(u), expiresAt: u.premium.expiresAt, daysLeft: isPremiumActive(u) ? Math.ceil((u.premium.expiresAt - Date.now()) / 86400000) : 0 }, isAdmin: !!u.isAdmin } };
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
    if (dataUrl && dataUrl.length > 280000) return { success: false, error: 'Fotoğraf çok büyük (max ~200KB).' };
    db[key].avatar = dataUrl || null;
    write(db);
    return { success: true, avatar: db[key].avatar };
  },
  getStats(username) {
    const db = read(), u = db[username?.toLowerCase()?.trim()];
    if (!u) return null;
    ensureStats(u);
    const isActive = isPremiumActive(u);
    return {
      username: u.username, avatar: u.avatar || null,
      stats: u.stats, coins: u.coins, inventory: u.inventory,
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
    if (!db[key].inventory.includes(itemId)) db[key].inventory.push(itemId);
    write(db);
    return { success: true };
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
    return u?.avatar || null;
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
    return Object.values(read()).map(u => { ensureStats(u); return { username: u.username, avatar: u.avatar || null, stats: u.stats }; }).sort((a, b) => b.stats.won - a.stats.won).slice(0, n);
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
        avatar: u.avatar || null,
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