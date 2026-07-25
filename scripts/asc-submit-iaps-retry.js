// Kalan IAP'ları dayanıklı şekilde gönderir: her ürünün versiyonu READY_FOR_REVIEW
// olunca inAppPurchaseSubmissions ile gönderir; Apple backend gecikmesine karşı
// birkaç dakika boyunca 15sn aralıkla yeniden dener. App zaten WAITING_FOR_REVIEW olmalı.
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) { const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {} return { ok: r.ok, json: j, text: t, status: r.status }; }
const detail = r => (r.json?.errors?.[0]?.detail || r.text || '').slice(0, 100);
const sleep = ms => new Promise(res => setTimeout(res, ms));

(async () => {
  const MAX_ROUNDS = 16, DELAY = 15000;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const iaps = (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data;
    const pending = iaps.filter(x => x.attributes.state === 'READY_TO_SUBMIT');
    if (!pending.length) { console.log('\n🎉 Tüm IAP gönderildi!'); break; }
    console.log(`\n--- Tur ${round}/${MAX_ROUNDS} — kalan ${pending.length} IAP ---`);
    for (const iap of pending) {
      const pid = iap.attributes.productId;
      // Versiyon hazır mı?
      const v = await api('GET', `/v2/inAppPurchases/${iap.id}/versions`);
      const vstate = v.json?.data?.[0]?.attributes?.state;
      if (vstate !== 'READY_FOR_REVIEW') { console.log(`  ${pid}: versiyon ${vstate} — bekleniyor`); continue; }
      const r = await api('POST', '/v1/inAppPurchaseSubmissions', { data: { type: 'inAppPurchaseSubmissions', relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iap.id } } } } });
      console.log(`  ${pid}: ` + (r.ok ? '✓ GÖNDERİLDİ' : '✗ ' + detail(r)));
    }
    const left = (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data.filter(x => x.attributes.state === 'READY_TO_SUBMIT');
    if (!left.length) { console.log('\n🎉 Tüm IAP gönderildi!'); break; }
    if (round < MAX_ROUNDS) await sleep(DELAY);
  }
  // Son durum
  console.log('\n=== SON DURUM ===');
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  console.log('App 1.0 →', ver.attributes.appStoreState);
  (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data.forEach(d => console.log('  ' + d.attributes.productId, '→', d.attributes.state));
})();
