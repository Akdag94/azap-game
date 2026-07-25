// Her IAP için inAppPurchaseAvailability oluşturur (tüm territory'lerde satış) → MISSING_METADATA çözülür
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) { const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {} return { ok: r.ok, json: j, text: t, status: r.status }; }
const err = r => (r.json?.errors?.[0]?.detail || r.json?.errors?.[0]?.title || r.text || '').slice(0, 200);

(async () => {
  // 1) Tüm territory'leri çek (sayfalı)
  let terrs = [], next = `/v1/territories?limit=200`;
  while (next) {
    const r = await api('GET', next.replace('https://api.appstoreconnect.apple.com', ''));
    (r.json?.data || []).forEach(t => terrs.push(t.id));
    next = r.json?.links?.next || null;
  }
  console.log('Territory sayısı:', terrs.length);
  const terrData = terrs.map(id => ({ type: 'territories', id }));

  const iaps = (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data;
  for (const iap of iaps) {
    const pid = iap.attributes.productId;
    process.stdout.write(pid + ': ');
    // Zaten var mı?
    const cur = await api('GET', `/v2/inAppPurchases/${iap.id}/inAppPurchaseAvailability`);
    if (cur.ok && cur.json?.data) { console.log('zaten var ⏭️'); continue; }
    // Oluştur
    const body = {
      data: {
        type: 'inAppPurchaseAvailabilities',
        attributes: { availableInNewTerritories: true },
        relationships: {
          inAppPurchase: { data: { type: 'inAppPurchases', id: iap.id } },
          availableTerritories: { data: terrData }
        }
      }
    };
    const r = await api('POST', '/v1/inAppPurchaseAvailabilities', body);
    console.log(r.ok ? '✓ oluşturuldu (' + terrs.length + ' ülke)' : '✗ ' + err(r));
  }
})();
