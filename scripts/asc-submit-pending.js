// BEKLEYEN GÖNDERİMİ İNCELEMEYE YOLLA
//
// Kullanım:  node scripts/asc-submit-pending.js <gönderimId>
//
// `asc-resubmit.js <build> --no-submit` ile kurulmuş (kalemleri eklenmiş ama
// gönderilmemiş) bir inceleme gönderimini gönderir. Ayrı script olmasının
// sebebi: IAP'lar gönderime bağlanınca sandbox'ta tekrar görünür oluyor, bu
// yüzden gönderimden ÖNCE satın alma testi yapılabiliyor.
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, json: j, text: t, status: r.status };
}
const detail = r => (r.json?.errors || []).map(e => `${e.code}: ${e.detail}`).join(' | ') || r.text?.slice(0, 200) || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SUB_ID = process.argv[2];
if (!SUB_ID) { console.error('Kullanım: node scripts/asc-submit-pending.js <gönderimId>'); process.exit(1); }

// Kalem kimliği base64'tür ve "<gönderimId>|<tip>|<kaynakId>" açılır.
// tip 6 = appStoreVersion, tip 17 = inAppPurchaseVersion.
function itemKind(item) {
  try {
    const parts = Buffer.from(item.id, 'base64').toString('utf8').split('|');
    return parts[1] || '?';
  } catch { return '?'; }
}

(async () => {
  // Neyin gönderileceğini önce yaz — yanlış gönderimi yollamamak için
  let items = (await api('GET', `/v1/reviewSubmissions/${SUB_ID}/items?limit=50`)).json?.data || [];
  console.log(`=== GÖNDERİM ${SUB_ID} — ${items.length} kalem ===`);
  for (const it of items) console.log(`  tip ${itemKind(it).padEnd(3)} ${it.attributes?.state || '?'}`);
  if (items.length === 0) { console.error('✗ Gönderimde hiç kalem yok, gönderilmeyecek.'); process.exit(1); }

  // App sürümü kalemi olmadan gönderilirse IAP'lar tek başına incelemeye girer
  // ve Apple "ilk IAP'lar yeni bir app sürümüyle gönderilmeli" der. Eksikse ekle.
  // İptal edilen eski gönderim CANCELING durumundayken sürümü tuttuğu için
  // ilk denemeler başarısız olabiliyor — tekrar dene.
  if (!items.some(it => itemKind(it) === '6')) {
    console.log('\n  ⚠ App sürümü kalemi yok — ekleniyor');
    const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
    let added = false;
    for (let i = 1; i <= 10 && !added; i++) {
      const r = await api('POST', '/v1/reviewSubmissionItems', {
        data: {
          type: 'reviewSubmissionItems',
          relationships: {
            reviewSubmission: { data: { type: 'reviewSubmissions', id: SUB_ID } },
            appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } }
          }
        }
      });
      if (r.ok) { added = true; console.log(`  + app sürümü ${ver.attributes.versionString} ✓ (deneme ${i})`); break; }
      console.log(`  deneme ${i}: ✗ ${detail(r)}`);
      if (i < 10) await sleep(20000);
    }
    if (!added) {
      console.error('\n✗ App sürümü kalemi eklenemedi — GÖNDERİLMEDİ.');
      console.error('  Eski gönderim hâlâ sürümü tutuyor olabilir; birkaç dakika sonra tekrar dene.');
      process.exit(1);
    }
    items = (await api('GET', `/v1/reviewSubmissions/${SUB_ID}/items?limit=50`)).json?.data || [];
    console.log(`  → gönderimde ${items.length} kalem var`);
  }

  const submit = await api('PATCH', `/v1/reviewSubmissions/${SUB_ID}`, {
    data: { type: 'reviewSubmissions', id: SUB_ID, attributes: { submitted: true } }
  });
  console.log(`\n  GÖNDERİM: ${submit.ok ? '✓ ' + submit.json?.data?.attributes?.state : '✗ ' + detail(submit)}`);
  if (!submit.ok) process.exit(1);

  await sleep(8000);
  console.log('\n=== SON DURUM ===');
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  console.log(`  App ${ver.attributes.versionString} → ${ver.attributes.appStoreState}`);
  for (const p of (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data) {
    console.log(`  ${p.attributes.productId.padEnd(26)} → ${p.attributes.state}`);
  }
})();
