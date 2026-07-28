// KALAN 6 IAP'I İNCELEMEYE EKLE
//
// Durum: app 1.0 + build 8 + gold_100 gönderim 5b489df4 içinde WAITING_FOR_REVIEW.
// Diğer 6 IAP eski takılı gönderimden kurtarıldı, versiyonları PREPARE_FOR_SUBMISSION
// durumuna düştü; metadata tam olduğu için kendiliğinden READY_FOR_REVIEW'e dönüyorlar.
//
// Bu script:
//   1. 6 IAP versiyonu READY_FOR_REVIEW olana kadar bekler
//   2. Önce mevcut gönderime eklemeyi dener (ucuz yol)
//   3. Olmazsa gönderimi iptal edip app + 7 IAP ile TEK gönderim kurar ve yollar
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, json: j, text: t, status: r.status };
}
const detail = r => (r.json?.errors || []).map(e => `${e.code}: ${e.detail}`).join(' | ') || r.text?.slice(0, 150) || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const LIVE = ['gold_100', 'gold_500', 'gold_1500', 'gold_5000', 'premium30', 'premium90', 'premium365']
  .map(k => 'online.azap.' + k);

async function iapVersions() {
  const iaps = (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data || [];
  const out = [];
  for (const p of iaps) {
    const pid = p.attributes.productId;
    if (!LIVE.includes(pid)) continue;
    const v = (await api('GET', `/v2/inAppPurchases/${p.id}/versions?limit=1`)).json?.data?.[0];
    if (v) out.push({ pid, id: v.id, state: v.attributes.state });
  }
  return out;
}

async function addItem(subId, relName, relType, relId, label) {
  const r = await api('POST', '/v1/reviewSubmissionItems', {
    data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: subId } }, [relName]: { data: { type: relType, id: relId } } } }
  });
  console.log(`  + ${label.padEnd(28)} ${r.ok ? '✓' : '✗ ' + detail(r)}`);
  return r.ok;
}

(async () => {
  // ── 1. Versiyonlar hazır olana kadar bekle ──────────────────────────
  console.log('FAZ 1: IAP versiyonlarının READY_FOR_REVIEW olması bekleniyor...');
  let versions = [];
  for (let i = 0; i < 40; i++) {
    versions = await iapVersions();
    const notReady = versions.filter(v => !['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW'].includes(v.state));
    console.log(`  tur ${i + 1}: ` + versions.map(v => v.pid.split('.').pop() + '=' + v.state.replace('_FOR_REVIEW', '')).join(' '));
    if (notReady.length === 0) break;
    await sleep(30000);
  }
  const stillNot = versions.filter(v => !['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW'].includes(v.state));
  if (stillNot.length) {
    console.log('\n⚠ Hazır olmayanlar: ' + stillNot.map(v => v.pid).join(', '));
    console.log('  Devam edilmiyor — app’e dokunulmadı. Birkaç dakika sonra tekrar çalıştır.');
    return;
  }
  console.log('✓ Tüm IAP versiyonları hazır');

  // ── 2. Mevcut gönderime eklemeyi dene ───────────────────────────────
  const subs = (await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&limit=20`)).json?.data || [];
  const pending = subs.find(s => ['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(s.attributes.state));
  if (pending) {
    console.log(`\nFAZ 2: mevcut gönderime (${pending.id}) eklemeyi deniyorum...`);
    const missing = versions.filter(v => v.state === 'READY_FOR_REVIEW');
    let added = 0;
    for (const v of missing) if (await addItem(pending.id, 'inAppPurchaseVersion', 'inAppPurchaseVersions', v.id, v.pid)) added++;
    if (added === missing.length) {
      console.log(`✓ ${added} IAP mevcut gönderime eklendi — iptal/yeniden gönderim gerekmedi`);
      return void await rapor();
    }
    console.log(`  yalnızca ${added}/${missing.length} eklenebildi → gönderimi yeniden kurmak gerekiyor`);

    // ── 3. İptal et ve tek gönderimle baştan kur ──────────────────────
    console.log('\nFAZ 3: gönderim iptal ediliyor...');
    const c = await api('PATCH', `/v1/reviewSubmissions/${pending.id}`, { data: { type: 'reviewSubmissions', id: pending.id, attributes: { canceled: true } } });
    console.log(`  iptal: ${c.ok ? '✓' : '✗ ' + detail(c)}`);
    if (!c.ok) { console.log('  Durduruldu — mevcut gönderim bozulmadan duruyor.'); return void await rapor(); }
    for (let i = 0; i < 12; i++) {
      await sleep(5000);
      const v = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
      if (['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED'].includes(v.attributes.appStoreState)) break;
    }
  }

  // ── 4. Yeni tek gönderim ────────────────────────────────────────────
  console.log('\nFAZ 4: app + 7 IAP ile yeni gönderim...');
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  console.log(`  sürüm durumu: ${ver.attributes.appStoreState}`);
  const create = await api('POST', '/v1/reviewSubmissions', {
    data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP } } } }
  });
  if (!create.ok) { console.log('✗ gönderim oluşturulamadı: ' + detail(create)); return void await rapor(); }
  const rs = create.json.data;
  await addItem(rs.id, 'appStoreVersion', 'appStoreVersions', ver.id, `app sürümü ${ver.attributes.versionString}`);
  versions = await iapVersions();
  let ok = 0;
  for (const v of versions) if (await addItem(rs.id, 'inAppPurchaseVersion', 'inAppPurchaseVersions', v.id, v.pid)) ok++;
  console.log(`  → ${ok}/${versions.length} IAP eklendi`);
  const sub = await api('PATCH', `/v1/reviewSubmissions/${rs.id}`, { data: { type: 'reviewSubmissions', id: rs.id, attributes: { submitted: true } } });
  console.log(`  GÖNDERİM: ${sub.ok ? '✓ ' + sub.json?.data?.attributes?.state : '✗ ' + detail(sub)}`);
  await sleep(8000);
  await rapor();
})();

async function rapor() {
  console.log('\n=== SON DURUM ===');
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  const build = (await api('GET', `/v1/appStoreVersions/${ver.id}/build`)).json?.data;
  console.log(`  App ${ver.attributes.versionString} → ${ver.attributes.appStoreState}  (build ${build?.attributes?.version || '?'})`);
  for (const p of (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data) {
    const live = LIVE.includes(p.attributes.productId);
    console.log(`  ${live ? ' ' : '!'} ${p.attributes.productId.padEnd(26)} → ${p.attributes.state}`);
  }
}
