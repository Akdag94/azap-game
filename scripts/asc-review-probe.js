// İnceleme gönderimi teşhisi: mevcut reviewSubmission'ları, içindeki item'ları ve
// app sürümünün IAP ilişkisini gösterir. "IAP'lar neden bağlanmadı?" sorusu için.
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, json: j, text: t, status: r.status };
}

(async () => {
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  console.log(`=== SÜRÜM ${ver.attributes.versionString} → ${ver.attributes.appStoreState} (id=${ver.id})`);

  console.log('\n=== REVIEW SUBMISSIONS ===');
  const subs = (await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&limit=20`)).json?.data || [];
  for (const s of subs) {
    const a = s.attributes;
    console.log(`\n  ${s.id}  state=${a.state} submitted=${a.submitted} canceled=${a.canceled} platform=${a.platform}`);
    const items = (await api('GET', `/v1/reviewSubmissions/${s.id}/items?limit=50`)).json?.data || [];
    if (!items.length) { console.log('    (item yok)'); continue; }
    for (const it of items) {
      const rel = Object.entries(it.relationships || {}).filter(([, v]) => v?.data).map(([k, v]) => `${k}:${v.data.id}`);
      console.log(`    item ${it.id}  state=${it.attributes.state}  →  ${rel.join(', ') || '?'}`);
    }
  }

  // reviewSubmissionItems'ın IAP kabul edip etmediğini boş bir denemeyle sınama
  console.log('\n=== IAP item DESTEĞİ TESTİ (gerçek gönderim yapmaz) ===');
  const probe = await api('POST', '/v1/reviewSubmissionItems', {
    data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: '0' } }, inAppPurchaseV2: { data: { type: 'inAppPurchases', id: '0' } } } }
  });
  console.log('  yanıt:', probe.status, (probe.json?.errors || []).map(e => `${e.code} ${e.detail}`).join(' | ').slice(0, 300));
})();
