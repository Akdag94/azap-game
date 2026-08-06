#!/usr/bin/env node
// ============================================================
// AZAP — APNs anahtarı kurulumu
//
// Kullanım:
//   node scripts/push-setup.js <AuthKey_XXXXXXXXXX.p8 yolu> [TEAM_ID]
//   örnek: node scripts/push-setup.js ~/Downloads/AuthKey_ABC1234DEF.p8
//
// Ne yapar:
//   1. .p8 dosyasını doğrular (EC private key mi?)
//   2. Key ID'yi dosya adından çıkarır (AuthKey_<KEYID>.p8)
//   3. data/apns-key.p8 olarak kopyalar (server/push.js buraya bakar)
//   4. .env dosyasına APNS_* satırlarını yazar/günceller
//
// APNs anahtarı App Store Connect API ile OLUŞTURULAMAZ (endpoint yok).
// Apple Developer portalından alınmalıdır:
//   https://developer.apple.com/account/resources/authkeys/add
//   → "Apple Push Notifications service (APNs)" işaretle → Continue → Register
//   → Download (.p8 dosyası YALNIZCA BİR KEZ indirilebilir, sakla!)
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, 'data', 'apns-key.p8');
const ENV = path.join(ROOT, '.env');
const DEFAULT_TEAM = 'CNANRXP44Q';   // AZAP Apple Developer Team ID
const TOPIC = 'online.azap.app';     // bundle identifier

function die(msg) { console.error('❌ ' + msg); process.exit(1); }

const src = process.argv[2];
const teamId = process.argv[3] || DEFAULT_TEAM;

if (!src) {
  console.log('Kullanım: node scripts/push-setup.js <AuthKey_XXXXXXXXXX.p8 yolu> [TEAM_ID]');
  console.log('\nAnahtarın yoksa önce şuradan oluştur:');
  console.log('  https://developer.apple.com/account/resources/authkeys/add');
  console.log('  → "Apple Push Notifications service (APNs)" seç → Continue → Register → Download');
  process.exit(1);
}

const srcPath = path.resolve(src.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '~'));
if (!fs.existsSync(srcPath)) die(`Dosya bulunamadı: ${srcPath}`);

const content = fs.readFileSync(srcPath, 'utf8');
if (!/-----BEGIN PRIVATE KEY-----/.test(content)) {
  die('Bu bir .p8 özel anahtarı değil ("-----BEGIN PRIVATE KEY-----" satırı yok).');
}

// Key ID: AuthKey_ABC1234DEF.p8 → ABC1234DEF
const m = path.basename(srcPath).match(/AuthKey_([A-Z0-9]{10})\.p8$/i);
if (!m) die(`Key ID dosya adından okunamadı. Beklenen ad: AuthKey_<10 karakter>.p8 (bulunan: ${path.basename(srcPath)})`);
const keyId = m[1].toUpperCase();

// ASC API anahtarıyla karıştırılmasın — o farklı bir anahtar
if (keyId === 'Y856KM4BA7') {
  die('Bu App Store Connect API anahtarı (ASC), APNs anahtarı değil.\n' +
      '   APNs anahtarı ayrıca oluşturulmalı: https://developer.apple.com/account/resources/authkeys/add');
}

fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.copyFileSync(srcPath, DEST);
console.log(`✓ Anahtar kopyalandı → data/apns-key.p8`);

// .env güncelle (mevcut APNS_* satırları varsa değiştir, yoksa ekle)
const vars = {
  APNS_KEY_PATH: './data/apns-key.p8',
  APNS_KEY_ID: keyId,
  APNS_TEAM_ID: teamId,
  APNS_TOPIC: TOPIC,
  APNS_PRODUCTION: 'true'
};
let env = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
if (env && !env.endsWith('\n')) env += '\n';
if (!/# ── PUSH BİLDİRİMLERİ \(APNs\) ──/.test(env)) {
  env += '\n# ── PUSH BİLDİRİMLERİ (APNs) ──\n';
}
for (const [k, v] of Object.entries(vars)) {
  const re = new RegExp(`^${k}=.*$`, 'm');
  if (re.test(env)) env = env.replace(re, `${k}=${v}`);
  else env += `${k}=${v}\n`;
}
fs.writeFileSync(ENV, env);
console.log('✓ .env güncellendi:');
for (const [k, v] of Object.entries(vars)) console.log(`    ${k}=${v}`);

console.log('\nSonraki adımlar:');
console.log('  1. Test et:            node scripts/push-test.js');
console.log('  2. Sunucuya kopyala:   scp data/apns-key.p8 deploy@185.22.187.214:/var/www/azap/data/');
console.log('  3. Sunucudaki .env\'e yukarıdaki 5 satırı ekle, sonra: pm2 restart azap');
console.log('\n⚠️  data/apns-key.p8 gizli bir anahtardır — git\'e ASLA ekleme (.gitignore kontrol edildi).');
