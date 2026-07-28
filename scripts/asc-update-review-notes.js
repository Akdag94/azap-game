// İnceleme notlarını günceller — 2026-07-28 reddine (2.1(a) crash + 2.1(b) IAP)
// neyin nasıl düzeltildiğini ve IAP'ın sandbox'ta nasıl test edileceğini anlatır.
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, json: j, text: t, status: r.status };
}

// Apple incelemecisi İngilizce okur; Türkçe karşılığı da eklendi.
const NOTES = [
  'Thank you for the detailed feedback on submission 6f4f951e. Both issues are fixed in this build.',
  '',
  '1) Guideline 2.1(a) - crash when capturing a photo',
  'Root cause: NSCameraUsageDescription was missing from Info.plist. The profile',
  'photo and player-report screens use a standard HTML file input, so choosing',
  '"Take Photo" triggered a TCC termination. Both NSCameraUsageDescription and',
  'NSPhotoLibraryUsageDescription are now declared. Taking a photo from Profile ->',
  'avatar and from the player report dialog no longer crashes.',
  '',
  '2) Guideline 2.1(b) - In-App Purchases',
  'All 7 In-App Purchases are submitted together with this build:',
  'gold_100, gold_500, gold_1500, gold_5000, premium30, premium90, premium365.',
  'The purchase flow was also hardened: the App Store receipt is now re-checked',
  'with a backoff (the receipt can lag a few seconds after purchase), unfinished',
  'transactions are settled on launch and before a new purchase, and a',
  '"Restore Purchases" button was added to the Store screen.',
  '',
  'How to test a purchase:',
  'Log in with the demo account -> Store (shop icon) -> "Altin" (Gold) tab ->',
  'tap "Satin Al" on any package. Gold is added to the account balance shown at',
  'the top of the Store. The "Premium" tab works the same way.',
  '',
  '--- Turkce ---',
  'Uygulama acilinca giris/kayit ekrani gelir. Verilen demo hesapla giris yapip',
  'oda kurabilir (Oda Kur) veya 4 haneli kod ile katilabilirsiniz. Sesli sohbet',
  'icin mikrofon izni istenir (opsiyonel). Tum satin alimlar StoreKit (Apple IAP)',
  'ile yapilir; uygulamada web odemesi yoktur. Oyuncu sikayet ve susturma',
  'ozelligi oyun ici menudedir.'
].join('\n');

(async () => {
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  const d = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreReviewDetail`)).json.data;
  console.log(`sürüm ${ver.attributes.versionString} [${ver.attributes.appStoreState}]  detail=${d.id}`);
  console.log(`not uzunluğu: ${NOTES.length} karakter`);

  const r = await api('PATCH', `/v1/appStoreReviewDetails/${d.id}`, {
    data: { type: 'appStoreReviewDetails', id: d.id, attributes: { notes: NOTES } }
  });
  if (!r.ok) { console.error('✗', (r.json?.errors || []).map(e => e.detail).join(' | ') || r.text); process.exit(1); }
  console.log('✓ inceleme notları güncellendi');

  const check = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreReviewDetail`)).json.data;
  console.log(`✓ demo hesap: ${check.attributes.demoAccountName} (required=${check.attributes.demoAccountRequired})`);
})();
