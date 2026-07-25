// ============================================================
// AZAP — App Store Connect IAP ürünlerini otomatik oluşturur
// Çalıştırma: node scripts/create-iap.js
//
// ASC API (JWT ES256) ile 6 ürün: 4 Consumable altın + 2 Non-Renewing premium.
// Her ürün: create + Türkçe localization + (varsa) fiyat.
// Fiyatı price point üzerinden ayarlar; bulunamazsa ürünü fiyatsız bırakır
// (fiyatı panelden tek tıkla eklersin — kritik değil, ürün oluşur).
// ============================================================
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const ISSUER_ID = process.env.ASC_ISSUER_ID;
const KEY_ID = process.env.ASC_KEY_ID;
const P8_PATH = process.env.ASC_P8_PATH;
const APP_ID = process.env.ASC_APP_ID || '6792583659';

if (!ISSUER_ID || !KEY_ID || !P8_PATH) {
  console.error('ASC_ISSUER_ID / ASC_KEY_ID / ASC_P8_PATH env gerekli'); process.exit(1);
}
const PRIVATE_KEY = fs.readFileSync(P8_PATH, 'utf8');
const BASE = 'https://api.appstoreconnect.apple.com';

function token() {
  return jwt.sign({}, PRIVATE_KEY, {
    algorithm: 'ES256',
    expiresIn: '18m',
    issuer: ISSUER_ID,
    audience: 'appstoreconnect-v1',
    header: { alg: 'ES256', kid: KEY_ID, typ: 'JWT' }
  });
}

async function api(method, endpoint, body) {
  const res = await fetch(BASE + endpoint, {
    method,
    headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, ok: res.ok, json, text };
}

const PRODUCTS = [
  { pid: 'online.azap.gold_100',  type: 'CONSUMABLE', name: '100 Altın',  desc: 'Oyun içi 100 altın. Eşya ve premium için kullanılır.', tlPrice: 19.99 },
  { pid: 'online.azap.gold_500',  type: 'CONSUMABLE', name: '600 Altın',  desc: 'Oyun içi 600 altın (500 + 100 bonus).', tlPrice: 79.99 },
  { pid: 'online.azap.gold_1500', type: 'CONSUMABLE', name: '2000 Altın', desc: 'Oyun içi 2000 altın (1500 + 500 bonus).', tlPrice: 199.99 },
  { pid: 'online.azap.gold_5000', type: 'CONSUMABLE', name: '7500 Altın', desc: 'Oyun içi 7500 altın (5000 + 2500 bonus).', tlPrice: 499.99 },
  { pid: 'online.azap.premium_1m', type: 'NON_RENEWING_SUBSCRIPTION', name: 'Premium 1 Ay', desc: '30 gün premium: +%50 altın, özel çerçeve, mor isim.', tlPrice: 49.99 },
  { pid: 'online.azap.premium_3m', type: 'NON_RENEWING_SUBSCRIPTION', name: 'Premium 3 Ay', desc: '90 gün premium: +%50 altın, özel çerçeve, mor isim.', tlPrice: 129.99 },
];

async function existingIaps() {
  const r = await api('GET', `/v1/apps/${APP_ID}/inAppPurchasesV2?limit=200`);
  if (!r.ok) return {};
  const map = {};
  (r.json.data || []).forEach(d => { map[d.attributes.productId] = d.id; });
  return map;
}

async function createIap(p) {
  const body = {
    data: {
      type: 'inAppPurchases',
      attributes: { name: p.name, productId: p.pid, inAppPurchaseType: p.type, reviewNote: 'Oyun içi satın alma. StoreKit ile alınır, sunucu Apple receipt ile doğrular.' },
      relationships: { app: { data: { type: 'apps', id: APP_ID } } }
    }
  };
  return api('POST', '/v2/inAppPurchases', body);
}

async function addLocalization(iapId, p) {
  const body = {
    data: {
      type: 'inAppPurchaseLocalizations',
      attributes: { locale: 'tr', name: p.name, description: p.desc },
      relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } } }
    }
  };
  return api('POST', '/v1/inAppPurchaseLocalizations', body);
}

// Türkiye price point'ini bul (verilen TL fiyatına en yakın)
async function findTrPricePoint(iapId, tlPrice) {
  const r = await api('GET', `/v2/inAppPurchases/${iapId}/pricePoints?filter[territory]=TUR&limit=8000&include=territory`);
  if (!r.ok || !r.json.data?.length) return null;
  let best = null, bestDiff = Infinity;
  for (const pp of r.json.data) {
    const price = parseFloat(pp.attributes.customerPrice);
    const diff = Math.abs(price - tlPrice);
    if (diff < bestDiff) { bestDiff = diff; best = pp; }
  }
  return best?.id || null;
}

async function setPrice(iapId, pricePointId) {
  const body = {
    data: {
      type: 'inAppPurchasePriceSchedules',
      relationships: {
        inAppPurchase: { data: { type: 'inAppPurchases', id: iapId } },
        manualPrices: { data: [{ type: 'inAppPurchasePrices', id: '${price1}' }] },
        baseTerritory: { data: { type: 'territories', id: 'TUR' } }
      }
    },
    included: [{
      type: 'inAppPurchasePrices',
      id: '${price1}',
      attributes: { startDate: null },
      relationships: {
        inAppPurchasePricePoint: { data: { type: 'inAppPurchasePricePoints', id: pricePointId } }
      }
    }]
  };
  return api('POST', '/v1/inAppPurchasePriceSchedules', body);
}

(async () => {
  console.log('App Store Connect API bağlantısı test ediliyor...');
  const test = await api('GET', `/v1/apps/${APP_ID}`);
  if (!test.ok) {
    console.error('❌ API bağlantısı başarısız:', test.status, test.text?.slice(0, 300));
    process.exit(1);
  }
  console.log('✓ Bağlandı:', test.json.data?.attributes?.name, '(' + APP_ID + ')\n');

  const existing = await existingIaps();
  for (const p of PRODUCTS) {
    if (existing[p.pid]) { console.log(`⏭️  ${p.pid} zaten var, atlandı`); continue; }
    process.stdout.write(`→ ${p.pid} oluşturuluyor... `);
    const c = await createIap(p);
    if (!c.ok) { console.log('❌', c.status, (c.json?.errors?.[0]?.detail || c.text)?.slice(0, 200)); continue; }
    const iapId = c.json.data.id;
    // Localization
    const loc = await addLocalization(iapId, p);
    // Price
    let priceMsg = '';
    try {
      const pp = await findTrPricePoint(iapId, p.tlPrice);
      if (pp) {
        const sp = await setPrice(iapId, pp);
        priceMsg = sp.ok ? `₺~${p.tlPrice} ✓` : `fiyat elle (${(sp.json?.errors?.[0]?.detail||'').slice(0,60)})`;
      } else priceMsg = 'fiyat elle';
    } catch (e) { priceMsg = 'fiyat elle'; }
    console.log(`✓ oluştu | loc:${loc.ok?'✓':'✗'} | ${priceMsg}`);
  }
  console.log('\nBitti. App Store Connect → In-App Purchases sayfasını yenile.');
  console.log('Not: Her ürüne bir review screenshot eklemen gerekir (panelden, aynı görsel).');
})();
