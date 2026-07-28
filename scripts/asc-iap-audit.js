// IAP denetimi: her ürün için versiyon durumu, inceleme ekran görüntüsü ve
// yerelleştirme eksiklerini listeler. Apple 2.1(b) reddi sonrası "hangi ürün
// neden gönderilemedi?" sorusunu cevaplamak için.
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, json: j, text: t, status: r.status };
}

// Uygulamanın gerçekten sattığı ürünler (server/index.js PAYMENT_PACKAGES anahtarları)
const LIVE = ['gold_100', 'gold_500', 'gold_1500', 'gold_5000', 'premium30', 'premium90', 'premium365']
  .map(k => 'online.azap.' + k);

(async () => {
  const iaps = (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data || [];
  console.log(`=== ${iaps.length} IAP bulundu ===\n`);
  for (const p of iaps) {
    const { productId, name, state, inAppPurchaseType } = p.attributes;
    const orphan = LIVE.includes(productId) ? '' : '  ⚠ UYGULAMADA SATILMIYOR (orphan)';
    console.log(`${productId}  [${inAppPurchaseType}]${orphan}`);
    console.log(`  id=${p.id}  name="${name}"  state=${state}`);

    const ver = (await api('GET', `/v2/inAppPurchases/${p.id}/iapPriceSchedule`)).ok ? 'var' : 'YOK';
    console.log(`  fiyat çizelgesi: ${ver}`);

    const loc = (await api('GET', `/v2/inAppPurchases/${p.id}/inAppPurchaseLocalizations?limit=10`)).json?.data || [];
    console.log(`  yerelleştirme: ${loc.length ? loc.map(l => l.attributes.locale).join(',') : 'YOK'}`);

    const shot = (await api('GET', `/v2/inAppPurchases/${p.id}/appStoreReviewScreenshot`)).json?.data;
    console.log(`  inceleme ekran görüntüsü: ${shot ? shot.attributes.assetDeliveryState?.state : 'YOK'}`);

    const av = (await api('GET', `/v2/inAppPurchases/${p.id}/iapAvailability`)).json?.data;
    console.log(`  availability: ${av ? (av.attributes.availableInNewTerritories ? 'yeni ülkelerde açık' : 'kayıtlı') : 'YOK'}`);
    console.log('');
  }

  console.log('=== EKSİK ÜRÜNLER (ASC\'de hiç yok) ===');
  const have = new Set(iaps.map(x => x.attributes.productId));
  const missing = LIVE.filter(x => !have.has(x));
  console.log(missing.length ? missing.join('\n') : '  yok — hepsi mevcut');
})();
