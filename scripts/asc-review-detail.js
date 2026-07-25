// App Store Review Detail — GERÇEK, doğrulanmış bilgiler
// Demo hesap canlıda test edildi (applereview/123456. → giriş başarılı)
// Telefon kullanıcı tarafından onaylandı.
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) { const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {} return { ok: r.ok, json: j, text: t, status: r.status }; }
const err = r => (r.json?.errors?.[0]?.detail || r.text || '').slice(0, 200);

(async () => {
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  const attrs = {
    contactFirstName: 'Azat', contactLastName: 'Akdağ',
    contactPhone: '+905324461104', contactEmail: 'destek@azap.online',
    demoAccountName: 'applereview', demoAccountPassword: '123456.', demoAccountRequired: true,
    notes: 'Uygulama açılınca giris/kayit ekrani gelir. Verilen demo hesapla giris yapip oda kurabilir (Oda Kur) veya 4 haneli kod ile katilabilirsiniz. Sesli sohbet icin mikrofon izni istenir (opsiyonel). Satin alimlar StoreKit (Apple IAP) ile yapilir; web odemesi yoktur. Oyuncu sikayet ve susturma ozelligi oyun ici Ayarlar menusundedir.'
  };
  const ex = await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreReviewDetail`);
  let rd;
  if (ex.ok && ex.json?.data) rd = await api('PATCH', `/v1/appStoreReviewDetails/${ex.json.data.id}`, { data: { type: 'appStoreReviewDetails', id: ex.json.data.id, attributes: attrs } });
  else rd = await api('POST', `/v1/appStoreReviewDetails`, { data: { type: 'appStoreReviewDetails', attributes: attrs, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } } } } });
  console.log('Review detail:', rd.ok ? '✓ kaydedildi (test hesabı + iletişim)' : '✗ ' + err(rd));
})();
