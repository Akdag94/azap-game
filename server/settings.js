// ============================================================
// AZAP — Çalışma zamanı site ayarları (data/settings.json)
//
// Deploy gerektirmeden admin panelinden değiştirilebilen ayarlar burada durur.
//
// webAccessMode — tarayıcıdan oynamayı kimin yapabileceğini belirler:
//   'off'   → kapı yok, herkes her yerden oynar (eski davranış)
//   'phone' → telefon tarayıcıları kapıya çarpar, masaüstü serbest (varsayılan)
//   'all'   → masaüstü dahil tüm tarayıcılar kapıya çarpar
// Her modda, hesabında `webAccess` izni olan (ve tüm adminler) kapıyı geçer.
// iOS uygulamasının kendisi hiçbir modda etkilenmez.
// ============================================================
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'settings.json');
const VALID_MODES = ['off', 'phone', 'all'];
const DEFAULTS = { webAccessMode: 'phone' };

let _cache = null;

function read() {
  if (_cache) return _cache;
  let disk = {};
  try { disk = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  _cache = { ...DEFAULTS, ...(disk && typeof disk === 'object' ? disk : {}) };
  if (!VALID_MODES.includes(_cache.webAccessMode)) _cache.webAccessMode = DEFAULTS.webAccessMode;
  return _cache;
}

function write(next) {
  _cache = next;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(_cache, null, 2));
  } catch (e) {
    console.error('[Ayarlar] Yazma hatası:', e.message);
  }
}

module.exports = {
  VALID_MODES,
  all() { return { ...read() }; },
  getWebAccessMode() { return read().webAccessMode; },
  setWebAccessMode(mode) {
    if (!VALID_MODES.includes(mode)) return { success: false, error: 'Geçersiz mod.' };
    write({ ...read(), webAccessMode: mode });
    console.log(`[Ayarlar] webAccessMode → ${mode}`);
    return { success: true, mode };
  }
};
