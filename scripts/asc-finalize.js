// GÖNDERİMİ TAMAMLA
// Durum: 728293d8 gönderiminde 6 IAP var; app sürümü ve gold_100 eksik.
// Sürüm artık DEVELOPER_REJECTED (düzenlenebilir), build 8 bağlanabilir.
//
// Adımlar: build bağla → app sürümü kalemi ekle → gold_100 ekle → gönder
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
const LIVE = ['gold_100', 'gold_500', 'gold_1500', 'gold_5000', 'premium30', 'premium90', 'premium365'].map(k => 'online.azap.' + k);
const BUILD_NO = process.argv[2] || '8';

async function addItem(subId, relName, relType, relId, label) {
  const r = await api('POST', '/v1/reviewSubmissionItems', {
    data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: subId } }, [relName]: { data: { type: relType, id: relId } } } }
  });
  console.log(`  + ${label.padEnd(28)} ${r.ok ? '✓' : '✗ ' + detail(r)}`);
  return r.ok;
}

(async () => {
  // 0. İptal edilmekte olan gönderim varsa bitmesini bekle.
  //    CANCELING durumundaki gönderim app sürümünü ve IAP'ı tutmaya devam ediyor;
  //    serbest kalmadan başka gönderime eklenemiyorlar.
  console.log('FAZ 0: iptal edilen gönderimlerin serbest bırakılması bekleniyor...');
  for (let i = 0; i < 40; i++) {
    const subs = (await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&limit=20`)).json?.data || [];
    const canceling = subs.filter(s => s.attributes.state === 'CANCELING');
    if (!canceling.length) { console.log('  ✓ CANCELING durumunda gönderim kalmadı'); break; }
    console.log(`  tur ${i + 1}: ${canceling.map(s => s.id.slice(0, 8) + '=' + s.attributes.state).join(' ')}`);
    if (i === 39) { console.log('  ⚠ hâlâ CANCELING — yine de denenecek'); break; }
    await sleep(20000);
  }

  // 1. Build'i sürüme bağla
  const builds = (await api('GET', `/v1/builds?filter[app]=${APP}&limit=20&sort=-version`)).json?.data || [];
  const build = builds.find(b => b.attributes.version === String(BUILD_NO));
  let ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  console.log(`sürüm ${ver.attributes.versionString} [${ver.attributes.appStoreState}]`);
  const cur = (await api('GET', `/v1/appStoreVersions/${ver.id}/build`)).json?.data;
  console.log(`  mevcut build: ${cur?.attributes?.version || 'yok'}`);
  if (cur?.attributes?.version !== String(BUILD_NO)) {
    const at = await api('PATCH', `/v1/appStoreVersions/${ver.id}`, {
      data: { type: 'appStoreVersions', id: ver.id, relationships: { build: { data: { type: 'builds', id: build.id } } } }
    });
    console.log(`  build ${BUILD_NO} bağlandı: ${at.ok ? '✓' : '✗ ' + detail(at)}`);
    await sleep(4000);
  }

  // 2. Açık (gönderilmemiş) gönderimi bul — kalemleri olan, IOS platformlu
  const subs = (await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&limit=20`)).json?.data || [];
  let target = null;
  for (const s of subs) {
    if (s.attributes.state !== 'READY_FOR_REVIEW' || s.attributes.platform !== 'IOS') continue;
    const items = (await api('GET', `/v1/reviewSubmissions/${s.id}/items?limit=50`)).json?.data || [];
    if (items.length) { target = { s, items }; break; }
  }
  if (!target) { console.log('✗ Doldurulacak açık gönderim bulunamadı'); return; }
  console.log(`\ngönderim ${target.s.id} — mevcut ${target.items.length} kalem`);
  const have = new Set(target.items.map(it => Buffer.from(it.id, 'base64').toString().split('|')[2]));

  // 3. App sürümünü ekle
  ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  if (!have.has(ver.id)) await addItem(target.s.id, 'appStoreVersion', 'appStoreVersions', ver.id, `app sürümü ${ver.attributes.versionString}`);

  // 4. Eksik IAP'ları ekle
  for (const p of (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data) {
    const pid = p.attributes.productId;
    if (!LIVE.includes(pid)) continue;
    const v = (await api('GET', `/v2/inAppPurchases/${p.id}/versions?limit=1`)).json?.data?.[0];
    if (!v || have.has(v.id)) continue;
    await addItem(target.s.id, 'inAppPurchaseVersion', 'inAppPurchaseVersions', v.id, pid);
  }

  // 5. Gönder
  const items = (await api('GET', `/v1/reviewSubmissions/${target.s.id}/items?limit=50`)).json?.data || [];
  console.log(`\ngönderimdeki toplam kalem: ${items.length}`);
  const sub = await api('PATCH', `/v1/reviewSubmissions/${target.s.id}`, {
    data: { type: 'reviewSubmissions', id: target.s.id, attributes: { submitted: true } }
  });
  console.log(`GÖNDERİM: ${sub.ok ? '✓ ' + sub.json?.data?.attributes?.state : '✗ ' + detail(sub)}`);

  await sleep(8000);
  console.log('\n=== SON DURUM ===');
  ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  const b = (await api('GET', `/v1/appStoreVersions/${ver.id}/build`)).json?.data;
  console.log(`  App ${ver.attributes.versionString} → ${ver.attributes.appStoreState} (build ${b?.attributes?.version || '?'})`);
  for (const p of (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data) {
    console.log(`  ${LIVE.includes(p.attributes.productId) ? ' ' : '!'} ${p.attributes.productId.padEnd(26)} → ${p.attributes.state}`);
  }
})();
