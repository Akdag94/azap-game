#!/usr/bin/env node
// ============================================================
// AZAP — APNs teşhis ve test aracı
//
// Kullanım:
//   node scripts/push-test.js                 → yalnızca yapılandırma teşhisi
//   node scripts/push-test.js <kullanıcıadı>  → o kullanıcının cihazlarına test bildirimi
//   node scripts/push-test.js --token <hex>   → belirli bir cihaz tokenına gönder
//
// APNs hata kodlarının anlamı çıktıda açıklanır.
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const Push = require('../server/push');
const Accounts = require('../server/accounts');

const REASONS = {
  BadDeviceToken: 'Token bu ortama ait değil. En sık sebep: sandbox tokenı production sunucusuna (ya da tersi) gönderiliyor. APNS_PRODUCTION değerini kontrol et (TestFlight/App Store = true, Xcode debug build = false).',
  Unregistered: 'Uygulama cihazdan silinmiş. Token otomatik temizlendi.',
  DeviceTokenNotForTopic: 'Token başka bir bundle ID\'ye ait. APNS_TOPIC "online.azap.app" olmalı.',
  TopicDisallowed: 'Bu anahtarın bu topic\'e gönderme yetkisi yok.',
  InvalidProviderToken: 'JWT reddedildi — APNS_KEY_ID veya APNS_TEAM_ID yanlış, ya da anahtar bu takıma ait değil.',
  ExpiredProviderToken: 'JWT süresi dolmuş (sunucu saati kaymış olabilir).',
  Forbidden: 'Anahtar bu uygulama için yetkili değil.',
  PayloadTooLarge: 'Bildirim gövdesi 4KB sınırını aştı.',
  TooManyRequests: 'Aynı cihaza çok sık gönderim — Apple hız sınırı.',
  disabled: 'APNs yapılandırılmamış. Önce: node scripts/push-setup.js <AuthKey_*.p8>',
  timeout: 'Apple 10 saniyede yanıt vermedi — ağ/firewall (443/HTTP2 çıkışı) engelleniyor olabilir.'
};

(async () => {
  const d = Push.diagnostics();
  console.log('── APNs YAPILANDIRMASI ─────────────────────────');
  console.log(`  jsonwebtoken kütüphanesi : ${d.jwtLib ? '✓ var' : '✗ YOK (npm install jsonwebtoken)'}`);
  console.log(`  Anahtar dosyası          : ${d.keyFound ? '✓ ' : '✗ BULUNAMADI: '}${d.keyPath}`);
  console.log(`  APNS_KEY_ID              : ${d.keyId}`);
  console.log(`  APNS_TEAM_ID             : ${d.teamId}`);
  console.log(`  APNS_TOPIC               : ${d.topic}`);
  console.log(`  Hedef                    : ${d.host} ${d.production ? '(production)' : '(SANDBOX)'}`);
  console.log(`  DURUM                    : ${d.enabled ? '✓ AKTİF' : '✗ DEVRE DIŞI'}`);
  console.log('────────────────────────────────────────────────');

  if (!d.enabled) {
    console.log('\nAPNs devre dışı. Kurulum:');
    console.log('  1. Anahtar oluştur: https://developer.apple.com/account/resources/authkeys/add');
    console.log('  2. node scripts/push-setup.js ~/Downloads/AuthKey_XXXXXXXXXX.p8');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const payload = {
    title: '🔔 AZAP test bildirimi',
    body: 'Push sistemi çalışıyor. Bu mesajı gördüysen kurulum tamam.',
    data: { type: 'test' }
  };

  if (args[0] === '--token') {
    const token = args[1];
    if (!token) { console.error('❌ --token için bir cihaz tokenı ver.'); process.exit(1); }
    const r = await Push.sendToToken(token, payload);
    report(r);
    process.exit(r.ok ? 0 : 1);
  }

  const username = args[0];
  if (!username) {
    const users = Accounts.listPushUsers();
    console.log(`\nKayıtlı push tokenı olan kullanıcı: ${users.length}`);
    if (users.length) console.log('  ' + users.join(', '));
    console.log('\nTest göndermek için: node scripts/push-test.js <kullanıcıadı>');
    process.exit(0);
  }

  const tokens = Accounts.getPushTokens(username);
  if (!tokens.length) {
    console.error(`\n❌ "${username}" için kayıtlı cihaz tokenı yok.`);
    console.error('   Kullanıcı iOS uygulamasından giriş yapıp bildirim iznini kabul etmeli.');
    process.exit(1);
  }
  console.log(`\n"${username}" → ${tokens.length} cihaz. Gönderiliyor...`);
  const r = await Push.sendToUser(Accounts, username, payload);
  if (r.sent > 0) console.log(`✅ ${r.sent}/${tokens.length} cihaza iletildi.`);
  else console.log('❌ Hiçbir cihaza iletilemedi. Ayrıntı için: node scripts/push-test.js --token <hex>');
  process.exit(r.ok ? 0 : 1);
})();

function report(r) {
  if (r.ok) { console.log('\n✅ Gönderildi (HTTP 200).'); return; }
  const key = r.reason || 'timeout';
  console.log(`\n❌ Başarısız — HTTP ${r.status || '—'} / ${key}`);
  if (REASONS[key]) console.log(`   ${REASONS[key]}`);
}
