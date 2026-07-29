// Mevcut (henüz gönderilmemiş) bir inceleme gönderimine app sürümünü ekler ve gönderir.
//
// Kullanım:  node scripts/asc-attach-version.js <gonderimId> [--no-submit]
//
// Neden ayrı bir script: asc-resubmit.js eski gönderimi iptal ettikten hemen
// sonra sürümü eklemeye çalışıyor. Ama iptal edilen gönderim `CANCELING`
// durumundayken app sürümünü HÂLÂ tutuyor; bu yüzden ekleme
// "STATE_ERROR.ENTITY_STATE_INVALID: This resource cannot be reviewed" ile
// düşüyor — IAP'lar eklenmiş, sürüm eklenmemiş yarım bir gönderim kalıyor.
// Bu script serbest kalmayı bekleyip eksik parçayı tamamlar.
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const RS_ID = process.argv[2];
const NO_SUBMIT = process.argv.includes('--no-submit');
if (!RS_ID) { console.error('Kullanım: node scripts/asc-attach-version.js <gonderimId> [--no-submit]'); process.exit(1); }

const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, json: j, text: t, status: r.status };
}
const detail = r => (r.json?.errors || []).map(e => `${e.code}: ${e.detail}`).join(' | ') || r.text?.slice(0, 200) || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  console.log(`sürüm ${ver.attributes.versionString} [${ver.attributes.appStoreState}]`);

  const build = (await api('GET', `/v1/appStoreVersions/${ver.id}/build`)).json?.data;
  if (!build) { console.error('✗ sürüme bağlı build yok'); process.exit(1); }
  const bNum = (await api('GET', `/v1/builds/${build.id}`)).json?.data?.attributes?.version;
  console.log(`bağlı build: ${bNum}`);

  // Sürüm serbest kalana kadar dene (iptal edilen gönderim CANCELING'de tutuyor olabilir)
  let added = false;
  for (let i = 1; i <= 12; i++) {
    const r = await api('POST', '/v1/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: RS_ID } },
          appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } }
        }
      }
    });
    if (r.ok) { console.log(`✓ app sürümü gönderime eklendi (deneme ${i})`); added = true; break; }
    console.log(`  deneme ${i}/12 → ${detail(r)}`);
    if (i < 12) await sleep(30000);
  }
  if (!added) { console.error('\n✗ sürüm eklenemedi. Eski gönderim hâlâ kaynağı tutuyor olabilir.'); process.exit(1); }

  // Gönderimin içeriğini yaz
  const items = (await api('GET', `/v1/reviewSubmissions/${RS_ID}/items`)).json?.data || [];
  console.log(`\ngönderimdeki kalem sayısı: ${items.length}`);

  if (NO_SUBMIT) {
    console.log(`\n⏸ GÖNDERİLMEDİ (--no-submit). Göndermek için:`);
    console.log(`   node scripts/asc-submit-pending.js ${RS_ID}`);
    return;
  }

  const submit = await api('PATCH', `/v1/reviewSubmissions/${RS_ID}`, {
    data: { type: 'reviewSubmissions', id: RS_ID, attributes: { submitted: true } }
  });
  console.log(`\nGÖNDERİM: ${submit.ok ? '✓ ' + submit.json?.data?.attributes?.state : '✗ ' + detail(submit)}`);
  if (!submit.ok) process.exitCode = 1;

  await sleep(8000);
  const v2 = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  console.log(`\nSON DURUM: sürüm ${v2.attributes.versionString} → ${v2.attributes.appStoreState}`);
})();
