const fs = require('fs');
const path = require('path');
const DB = path.join(__dirname, '..', 'data', 'reports.json');
const SCREENSHOT_DIR = path.join(__dirname, '..', 'data', 'screenshots');

if (!fs.existsSync(path.dirname(DB))) fs.mkdirSync(path.dirname(DB), { recursive: true });
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
if (!fs.existsSync(DB)) fs.writeFileSync(DB, '[]');

function read() { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return []; } }
function write(d) { fs.writeFileSync(DB, JSON.stringify(d, null, 2)); }

module.exports = {
  // Yeni rapor oluştur. screenshot dataUrl ise dosyaya kaydedilir.
  create({ username, description, screenshot }) {
    if (!description || description.trim().length < 5) {
      return { success: false, error: 'Açıklama en az 5 karakter olmalı.' };
    }
    if (description.length > 5000) {
      return { success: false, error: 'Açıklama çok uzun (max 5000 karakter).' };
    }
    const reports = read();
    const id = 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    let screenshotPath = null;
    if (screenshot && typeof screenshot === 'string' && screenshot.startsWith('data:image/')) {
      try {
        // dataUrl'den binary'e çevir
        const m = screenshot.match(/^data:image\/(\w+);base64,(.+)$/);
        if (m) {
          const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
          if (['png', 'jpg', 'gif', 'webp'].includes(ext)) {
            const buf = Buffer.from(m[2], 'base64');
            // Boyut limiti 5MB
            if (buf.length > 5 * 1024 * 1024) {
              return { success: false, error: 'Ekran görüntüsü çok büyük (max 5MB).' };
            }
            screenshotPath = `${id}.${ext}`;
            fs.writeFileSync(path.join(SCREENSHOT_DIR, screenshotPath), buf);
          }
        }
      } catch (e) {
        console.error('Screenshot kaydetme hatası:', e.message);
      }
    }
    const report = {
      id,
      username: username || 'anonim',
      description: description.trim(),
      screenshot: screenshotPath,
      createdAt: Date.now(),
      status: 'open'
    };
    reports.push(report);
    write(reports);
    return { success: true, report };
  },

  list() { return read().sort((a, b) => b.createdAt - a.createdAt); },

  get(id) { return read().find(r => r.id === id); },

  delete(id) {
    const reports = read();
    const r = reports.find(x => x.id === id);
    if (r?.screenshot) {
      try { fs.unlinkSync(path.join(SCREENSHOT_DIR, r.screenshot)); } catch {}
    }
    write(reports.filter(x => x.id !== id));
    return { success: true };
  },

  setStatus(id, status) {
    const reports = read();
    const r = reports.find(x => x.id === id);
    if (!r) return { success: false };
    r.status = status;
    write(reports);
    return { success: true };
  },

  getScreenshotPath(filename) {
    if (!filename || filename.includes('..') || filename.includes('/')) return null;
    return path.join(SCREENSHOT_DIR, filename);
  },

  getScreenshotDir() { return SCREENSHOT_DIR; },

  // Tüm raporları zip olarak al — dışarıda yapılır, burada path'leri ver
  getAllReportsForExport() {
    return {
      reports: read(),
      screenshotDir: SCREENSHOT_DIR
    };
  }
};
