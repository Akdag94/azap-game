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
  return u;
}

module.exports = {
  register(username, password) {
    const db = read(), key = username.toLowerCase().trim();
    if (key.length < 2 || key.length > 16) return { success: false, error: 'Kullanıcı adı 2-16 karakter.' };
    if (password.length < 3) return { success: false, error: 'Şifre en az 3 karakter.' };
    if (db[key]) return { success: false, error: 'Bu kullanıcı adı alınmış.' };
    db[key] = { username: username.trim(), hash: bcrypt.hashSync(password, 8), avatar: null, stats: { played: 0, won: 0, lost: 0, mvp: 0 }, created: Date.now() };
    write(db);
    return { success: true, user: { username: db[key].username, avatar: null, stats: db[key].stats } };
  },
  login(username, password, rememberMe) {
    const db = read(), key = username.toLowerCase().trim(), u = db[key];
    if (!u) return { success: false, error: 'Kullanıcı bulunamadı.' };
    if (!bcrypt.compareSync(password, u.hash)) return { success: false, error: 'Şifre yanlış.' };
    ensureStats(u);
    let token = null;
    if (rememberMe) {
      // Yeni token oluştur ve kullanıcıya bağla
      token = require('crypto').randomBytes(24).toString('hex');
      if (!u.tokens) u.tokens = [];
      u.tokens.push({ token, created: Date.now() });
      // En fazla 5 aktif token (cihaz) sakla
      if (u.tokens.length > 5) u.tokens = u.tokens.slice(-5);
    }
    write(db);
    return { success: true, user: { username: u.username, avatar: u.avatar || null, stats: u.stats, isAdmin: !!u.isAdmin }, token };
  },

  // Token ile otomatik giriş
  loginByToken(token) {
    if (!token) return { success: false };
    const db = read();
    for (const key in db) {
      const u = db[key];
      if (u.tokens?.some(t => t.token === token)) {
        ensureStats(u);
        return { success: true, user: { username: u.username, avatar: u.avatar || null, stats: u.stats, isAdmin: !!u.isAdmin } };
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
    return { username: u.username, avatar: u.avatar || null, stats: u.stats, isAdmin: !!u.isAdmin };
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