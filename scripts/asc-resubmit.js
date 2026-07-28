// YENİDEN GÖNDERİM (2026-07-28 reddi sonrası)
//
// Kullanım:  node scripts/asc-resubmit.js <buildNumber>
//   örn:     node scripts/asc-resubmit.js 7
//
// Yaptığı iş:
//   1. Verilen build'i (CFBundleVersion) bulup 1.0 sürümüne bağlar
//   2. Bekleyen/gönderilmemiş inceleme gönderimlerini iptal eder
//   3. TEK bir gönderim oluşturur: app sürümü + uygulamada satılan 7 IAP
//   4. Gönderir ve son durumu yazar
//
// Kritik bilgi: reviewSubmissionItems'ta IAP ilişkisinin adı `inAppPurchaseVersion`
// ve ilişkilendirilen tip `inAppPurchaseVersions` (IAP'ın kendisi DEĞİL, versiyonu).
// Eski scriptlerdeki `inAppPurchaseV2` adı geçersiz — bu yüzden geçen gönderimde
// yalnızca gold_100 incelemeye girmişti.
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

// Uygulamanın gerçekten sattığı ürünler — orphan premium_3m bilerek dışarıda
const LIVE = ['gold_100', 'gold_500', 'gold_1500', 'gold_5000', 'premium30', 'premium90', 'premium365']
  .map(k => 'online.azap.' + k);

const BUILD_NO = process.argv[2];
if (!BUILD_NO) { console.error('Kullanım: node scripts/asc-resubmit.js <buildNumber>'); process.exit(1); }

(async () => {
  // ── 1. Build'i sürüme bağla ─────────────────────────────────────────
  const builds = (await api('GET', `/v1/builds?filter[app]=${APP}&limit=20&sort=-version`)).json?.data || [];
  const build = builds.find(b => b.attributes.version === String(BUILD_NO));
  if (!build) {
    console.error(`✗ Build ${BUILD_NO} bulunamadı. Mevcut: ${builds.map(b => b.attributes.version + '(' + b.attributes.processingState + ')').join(', ')}`);
    process.exit(1);
  }
  if (build.attributes.processingState !== 'VALID') {
    console.error(`✗ Build ${BUILD_NO} henüz işleniyor (${build.attributes.processingState}). Birkaç dakika sonra tekrar dene.`);
    process.exit(1);
  }
  console.log(`✓ Build ${BUILD_NO} VALID (id=${build.id})`);

  let ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  console.log(`  sürüm ${ver.attributes.versionString} → ${ver.attributes.appStoreState}`);
  const attach = await api('PATCH', `/v1/appStoreVersions/${ver.id}`, {
    data: { type: 'appStoreVersions', id: ver.id, relationships: { build: { data: { type: 'builds', id: build.id } } } }
  });
  console.log(`  build bağlandı: ${attach.ok ? '✓' : '✗ ' + detail(attach)}`);

  // ── 2. Bekleyen gönderimleri iptal et ───────────────────────────────
  console.log('\n=== BEKLEYEN GÖNDERİMLER ===');
  const subs = (await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&limit=20`)).json?.data || [];
  for (const s of subs) {
    if (['COMPLETE', 'CANCELING'].includes(s.attributes.state)) continue;
    const c = await api('PATCH', `/v1/reviewSubmissions/${s.id}`, {
      data: { type: 'reviewSubmissions', id: s.id, attributes: { canceled: true } }
    });
    console.log(`  ${s.id} [${s.attributes.state}] iptal: ${c.ok ? '✓' : '✗ ' + detail(c)}`);
  }
  await sleep(5000);

  // ── 3. IAP versiyonlarını topla ─────────────────────────────────────
  console.log('\n=== IAP VERSİYONLARI ===');
  const iaps = (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data || [];
  const iapVersions = [];
  for (const p of iaps) {
    const pid = p.attributes.productId;
    if (!LIVE.includes(pid)) { console.log(`  ${pid.padEnd(26)} atlandı (uygulamada satılmıyor)`); continue; }
    const v = (await api('GET', `/v2/inAppPurchases/${p.id}/versions?limit=1`)).json?.data?.[0];
    if (!v) { console.log(`  ${pid.padEnd(26)} ✗ versiyon yok`); continue; }
    console.log(`  ${pid.padEnd(26)} versiyon ${v.id} [${v.attributes.state}]`);
    iapVersions.push({ pid, id: v.id, state: v.attributes.state });
  }

  // ── 4. Tek gönderim oluştur: app sürümü + tüm IAP'lar ──────────────
  console.log('\n=== YENİ GÖNDERİM ===');
  const create = await api('POST', '/v1/reviewSubmissions', {
    data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP } } } }
  });
  if (!create.ok) { console.error('✗ gönderim oluşturulamadı:', detail(create)); process.exit(1); }
  const rs = create.json.data;
  console.log(`  gönderim ${rs.id} oluşturuldu`);

  const addItem = async (label, relName, relType, relId) => {
    const r = await api('POST', '/v1/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: rs.id } },
          [relName]: { data: { type: relType, id: relId } }
        }
      }
    });
    console.log(`  + ${label.padEnd(30)} ${r.ok ? '✓' : '✗ ' + detail(r)}`);
    return r.ok;
  };

  ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  await addItem(`app sürümü ${ver.attributes.versionString}`, 'appStoreVersion', 'appStoreVersions', ver.id);
  let added = 0;
  for (const v of iapVersions) {
    if (await addItem(v.pid, 'inAppPurchaseVersion', 'inAppPurchaseVersions', v.id)) added++;
  }
  console.log(`  → ${added}/${iapVersions.length} IAP eklendi`);

  // ── 5. Gönder ───────────────────────────────────────────────────────
  const submit = await api('PATCH', `/v1/reviewSubmissions/${rs.id}`, {
    data: { type: 'reviewSubmissions', id: rs.id, attributes: { submitted: true } }
  });
  console.log(`\n  GÖNDERİM: ${submit.ok ? '✓ ' + submit.json?.data?.attributes?.state : '✗ ' + detail(submit)}`);

  // ── 6. Doğrula ──────────────────────────────────────────────────────
  await sleep(8000);
  console.log('\n=== SON DURUM ===');
  ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  console.log(`  App ${ver.attributes.versionString} → ${ver.attributes.appStoreState}`);
  for (const p of (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data) {
    console.log(`  ${p.attributes.productId.padEnd(26)} → ${p.attributes.state}`);
  }
})();
