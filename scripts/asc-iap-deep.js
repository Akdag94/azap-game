// Derin IAP teşhisi — her ürün için loc/fiyat/screenshot ham durumu + asset state
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) { const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {} return { ok: r.ok, json: j, text: t, status: r.status }; }

(async () => {
  const iaps = (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data;
  for (const iap of iaps) {
    const id = iap.id;
    console.log('\n### ' + iap.attributes.productId + '  [' + iap.attributes.state + ']');
    // Localizations (state dahil)
    const loc = await api('GET', `/v2/inAppPurchases/${id}/inAppPurchaseLocalizations`);
    const locs = loc.json?.data || [];
    console.log('  loc(' + locs.length + '):', locs.map(l => `${l.attributes.locale}/${l.attributes.state}/"${l.attributes.name}"`).join(' | ') || 'YOK  ' + (loc.text || '').slice(0, 100));
    // Price schedule
    const pr = await api('GET', `/v2/inAppPurchases/${id}/iapPriceSchedule?include=manualPrices`);
    const mp = pr.json?.included?.filter(x => x.type === 'inAppPurchasePrices') || [];
    console.log('  price:', pr.json?.data ? ('VAR (' + mp.length + ' manualPrice)') : 'YOK  ' + (pr.text || '').slice(0, 100));
    // Review screenshot
    const sc = await api('GET', `/v2/inAppPurchases/${id}/appStoreReviewScreenshot`);
    if (sc.json?.data) {
      const a = sc.json.data.attributes;
      console.log('  screenshot: id=' + sc.json.data.id, 'uploaded=' + a.uploaded, 'state=' + JSON.stringify(a.assetDeliveryState));
    } else {
      console.log('  screenshot: YOK  ' + (sc.text || '').slice(0, 120));
    }
    // Availability (yeni zorunlu alan)
    const av = await api('GET', `/v2/inAppPurchases/${id}/inAppPurchaseAvailability?include=availableTerritories&limit[availableTerritories]=5`);
    if (av.json?.data) {
      const terrCount = av.json.data.relationships?.availableTerritories?.meta?.paging?.total ?? (av.json.included?.length || '?');
      console.log('  availability: VAR  allTerritories=' + av.json.data.attributes?.availableInNewTerritories + ' ülkeSayısı=' + terrCount);
    } else {
      console.log('  availability: YOK  ' + (av.text || '').slice(0, 120));
    }
  }
})();
