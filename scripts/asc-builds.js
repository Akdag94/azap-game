// App Store Connect'e ulaşmış build'leri listeler.
// Kullanım:  node scripts/asc-builds.js
// "eas submit" bittiğinde build'in Apple tarafında görünüp görünmediğini
// anlamak için. processingState=VALID olan build gönderime hazırdır.
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });

(async () => {
  const r = await fetch(`https://api.appstoreconnect.apple.com/v1/builds?filter[app]=${APP}&limit=8&sort=-uploadedDate`, {
    headers: { Authorization: 'Bearer ' + tok() }
  });
  const j = await r.json();
  if (!r.ok) {
    console.error('✗ ASC hatası:', (j.errors || []).map(e => e.detail).join(' | ') || r.status);
    process.exit(1);
  }
  const rows = j.data || [];
  if (!rows.length) return console.log('Hiç build yok.');
  console.log('build  durum      yüklenme');
  console.log('─────  ─────────  ────────────────────');
  rows.forEach(b => {
    const a = b.attributes;
    const mark = a.processingState === 'VALID' ? '✓' : a.processingState === 'INVALID' ? '✗' : '…';
    console.log(`${String(a.version).padEnd(5)}  ${String(a.processingState).padEnd(9)}  ${a.uploadedDate}  ${mark}`);
  });
  const b13 = rows.find(b => b.attributes.version === '13');
  console.log('');
  if (!b13) console.log('→ Build 13 HENÜZ GELMEDİ. Yükleme sürüyor ya da başarısız oldu.');
  else if (b13.attributes.processingState === 'VALID') console.log('→ Build 13 HAZIR. Gönderimi kurabilirsin: node scripts/asc-resubmit.js 13');
  else if (b13.attributes.processingState === 'INVALID') console.log('→ Build 13 GEÇERSİZ. Apple işleme sırasında reddetti; yeni build gerekir.');
  else console.log(`→ Build 13 Apple tarafında işleniyor (${b13.attributes.processingState}). Birkaç dakika bekle.`);
})();
