// App sürümü + 6 IAP'ı BİRLİKTE incelemeye gönderir.
// 1) App sürümü reviewSubmissions ile → WAITING_FOR_REVIEW
// 2) Her IAP inAppPurchaseSubmissions ile → bekleyen app sürümüne iliştirilir
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) { const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {} return { ok: r.ok, json: j, text: t, status: r.status }; }
const detail = r => (r.json?.errors?.[0]?.detail || r.text || '').slice(0, 200);

(async () => {
  // ── 1) APP SÜRÜMÜ ──
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  console.log('App sürümü:', ver.attributes.versionString, '(' + ver.attributes.appStoreState + ')');
  if (ver.attributes.appStoreState !== 'WAITING_FOR_REVIEW' && ver.attributes.appStoreState !== 'IN_REVIEW') {
    // Açık reviewSubmission bul / oluştur
    let rss = (await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&limit=10`)).json.data || [];
    let rs = rss.find(s => ['READY_FOR_REVIEW'].includes(s.attributes.state) && !s.attributes.submitted && !s.attributes.canceled);
    if (!rs) {
      const c = await api('POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP } } } } });
      if (!c.ok) { console.log('✗ reviewSubmission:', detail(c)); process.exit(1); }
      rs = c.json.data;
    }
    // Versiyonu ekle
    const items = (await api('GET', `/v1/reviewSubmissions/${rs.id}/items`)).json.data || [];
    if (!items.some(i => i.relationships?.appStoreVersion?.data?.id === ver.id)) {
      const it = await api('POST', '/v1/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: rs.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } } } } });
      if (!it.ok) { console.log('✗ versiyon eklenemedi:', detail(it)); process.exit(1); }
    }
    // Gönder
    const sub = await api('PATCH', `/v1/reviewSubmissions/${rs.id}`, { data: { type: 'reviewSubmissions', id: rs.id, attributes: { submitted: true } } });
    console.log('  App gönderimi:', sub.ok ? '✓ ' + (sub.json?.data?.attributes?.state) : '✗ ' + detail(sub));
    if (!sub.ok) process.exit(1);
  } else console.log('  App zaten incelemede ✓');

  // ── 2) IAP'LAR ──
  console.log('\nIAP gönderimleri (inAppPurchaseSubmissions):');
  const iaps = (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data;
  for (const iap of iaps) {
    const pid = iap.attributes.productId;
    if (iap.attributes.state !== 'READY_TO_SUBMIT') { console.log('  ' + pid, '→', iap.attributes.state, '(atlandı)'); continue; }
    const r = await api('POST', '/v1/inAppPurchaseSubmissions', { data: { type: 'inAppPurchaseSubmissions', relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iap.id } } } } });
    console.log('  ' + pid, '→', r.ok ? '✓ gönderildi' : '✗ ' + detail(r));
  }

  // ── 3) DURUM ──
  console.log('\n=== SON DURUM ===');
  const ver2 = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  console.log('App', ver2.attributes.versionString, '→', ver2.attributes.appStoreState);
  (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data.forEach(d => console.log(' ', d.attributes.productId, '→', d.attributes.state));
})();
