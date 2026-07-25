// Her IAP ürününe review screenshot yükler (MISSING_METADATA → READY_TO_SUBMIT)
const jwt = require('jsonwebtoken'), fs = require('fs'), crypto = require('crypto'), path = require('path');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) { const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {} return { ok: r.ok, json: j, text: t, status: r.status }; }
const err = r => (r.json?.errors?.[0]?.detail || r.text || '').slice(0, 200);

const IMG = path.join(__dirname, '..', 'appstore-shots', '04-magaza.png');

(async () => {
  const buf = fs.readFileSync(IMG);
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  const iaps = (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data;
  for (const iap of iaps) {
    const pid = iap.attributes.productId;
    // Zaten screenshot var mı?
    const cur = await api('GET', `/v1/inAppPurchases/${iap.id}/appStoreReviewScreenshot`);
    if (cur.ok && cur.json?.data) { console.log(pid, '⏭️ screenshot zaten var'); continue; }
    // 1) Reservation
    const res = await api('POST', '/v1/inAppPurchaseAppStoreReviewScreenshots', { data: { type: 'inAppPurchaseAppStoreReviewScreenshots', attributes: { fileName: '04-magaza.png', fileSize: buf.length }, relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iap.id } } } } });
    if (!res.ok) { console.log(pid, '✗ rezervasyon:', err(res)); continue; }
    const sid = res.json.data.id;
    const op = res.json.data.attributes.uploadOperations[0];
    const headers = {}; (op.requestHeaders || []).forEach(h => headers[h.name] = h.value);
    const up = await fetch(op.url, { method: op.method, headers, body: buf });
    if (!up.ok) { console.log(pid, '✗ upload:', up.status); continue; }
    const commit = await api('PATCH', `/v1/inAppPurchaseAppStoreReviewScreenshots/${sid}`, { data: { type: 'inAppPurchaseAppStoreReviewScreenshots', id: sid, attributes: { uploaded: true, sourceFileChecksum: md5 } } });
    console.log(pid, commit.ok ? '✓ screenshot yüklendi' : '✗ commit: ' + err(commit));
  }
  console.log('\nIAP screenshot bitti.');
})();
