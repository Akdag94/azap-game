// İnceleme notlarını 2026-07-30 reddine (submission 4bbb1c0d) göre günceller.
// İki gerekçe vardı: 3.1.1 (tüketilebilir ürünlerin Apple ID ile geri yüklenmesi)
// ve 2.1(a) (mevcut bir odaya katılamama). Not ikisinin de kök nedenini, yapılan
// düzeltmeyi ve nasıl doğrulanacağını anlatır.
// ASC sınırı: notlar en fazla 4000 karakter olabilir (script kontrol eder).
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, json: j, text: t, status: r.status };
}

const NOTES = [
  'Response to submission 4bbb1c0d (version 1.0, build 13). Both issues are',
  'fixed in this build. Demo account: applereview / 123456. Registering your own',
  'account works equally well; nothing is gated behind the demo account.',
  '',
  '=== 3.1.1 RESTORING CONSUMABLE PRODUCTS ===',
  '',
  'You were right. The store had a "Restore Purchases" button that used StoreKit',
  'restore, which asks for the Apple Account password. Every product this app',
  'sells is a CONSUMABLE (4 coin packs and 3 fixed-length premium packs, 7 in',
  'total), so that button was wrong and it is now REMOVED. This build has no',
  'user-facing restore feature at all and never calls AppStore.sync() or',
  'getAvailablePurchases(). The user is never asked for an Apple Account',
  'password outside the normal StoreKit payment sheet.',
  '',
  'Our own restore mechanism is account based: a purchase is verified against',
  'Apple on our server and written to the AZAP account, de-duplicated by',
  'transaction id. The balance lives on the account, not on the device, so',
  'signing in to the same AZAP account on any device is what restores the',
  'purchased coins and premium days. The store says this in plain text where',
  'the button used to be.',
  '',
  'One silent safety net remains and has no user interface: if a payment is',
  'taken but our server cannot be reached to credit it, the transaction is left',
  'unfinished and is completed in the background on the next launch, by reading',
  "StoreKit's local unfinished-transaction queue only. It never prompts for a",
  'password and the user cannot trigger it.',
  '',
  'To verify: Store icon -> "Altin" tab. There is no restore button anywhere in',
  'the store. Purchases still work normally through StoreKit.',
  '',
  '=== 2.1(a) UNABLE TO JOIN AN EXISTING ROOM ===',
  '',
  'We reproduced this. It was not a network or server problem: your iPad',
  'screenshot shows a successful login ("Hos geldin, Eeast") and a coin balance',
  'loaded from our server, so the connection was working. The blocker was our',
  'own client-side validation.',
  '',
  'The join form has two fields, an in-game display name and the 4-digit room',
  'code. The name field was empty, so our code refused to join and showed only',
  'a small "Isim gir!" (Enter a name) message that was easy to miss.',
  '',
  'Fixed: the name field is now filled automatically from the signed-in account,',
  'so joining needs nothing extra. If it is cleared the account name is used as',
  'a fallback, and if no name exists at all the field is focused and scrolled',
  'into view instead of only showing a message.',
  '',
  'HOW TO JOIN A ROOM',
  '1. Sign in. The "Oyun ici isim" (in-game name) field is already filled.',
  '2. On the first device tap "ODA KUR" (Create room). A 4-digit code appears',
  '   at the top of the lobby.',
  '3. On the second device type that code into the code box and tap "KATIL"',
  '   (Join). A confirmation screen lists who is already in the room, then tap',
  '   "Katil" to enter.',
  '',
  'Please note that AZAP is a party game for friends sitting together, so',
  'starting a round needs a full table of players and the lobby will tell you',
  'the minimum if you tap start with fewer. Joining a room, which is what this',
  'issue was about, is fully testable with the two devices you used.',
  '',
  '=== UNCHANGED ===',
  'The Guideline 1.2 measures from the previous review still apply: no random or',
  'anonymous matching, joining only with a 4-digit code shared by the host, the',
  'pre-join confirmation screen, no voice chat, plus content filtering,',
  'blocking, reporting and our 24-hour response commitment.',
  '',
  '--- Turkce ozet ---',
  '3.1.1: Tum urunler tuketilebilir oldugundan "Satin Almalari Geri Yukle"',
  'butonu ve parola soran StoreKit restore cagrilari tamamen kaldirildi. Satin',
  'alma sunucuda AZAP hesabina yazilir; hesaba giris yapilan her cihazda gelir.',
  '2.1(a): Odaya katilamama, "Oyun ici isim" alani bos kaldiginda istemci',
  'tarafi dogrulamanin katilmayi engellemesinden kaynaklaniyordu. Alan artik',
  'giriste hesap adiyla otomatik doluyor.'
].join('\n');

(async () => {
  if (NOTES.length > 4000) {
    console.error(`✗ not ${NOTES.length} karakter — ASC sınırı 4000. Kısalt.`);
    process.exit(1);
  }
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  const d = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreReviewDetail`)).json.data;
  console.log(`sürüm ${ver.attributes.versionString} [${ver.attributes.appStoreState}]  detail=${d.id}`);
  console.log(`not uzunluğu: ${NOTES.length} / 4000 karakter`);

  const r = await api('PATCH', `/v1/appStoreReviewDetails/${d.id}`, {
    data: { type: 'appStoreReviewDetails', id: d.id, attributes: { notes: NOTES } }
  });
  if (!r.ok) { console.error('✗', (r.json?.errors || []).map(e => e.detail).join(' | ') || r.text); process.exit(1); }
  console.log('✓ inceleme notları güncellendi');

  const check = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreReviewDetail`)).json.data;
  console.log(`✓ demo hesap: ${check.attributes.demoAccountName} (required=${check.attributes.demoAccountRequired})`);
})();
