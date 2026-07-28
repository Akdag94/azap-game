// IAP versiyon UUID'lerini productId'lere eşler — reviewSubmissionItems içindeki
// "type 17" kalemlerinin hangi ürün olduğunu çözmek için.
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + e, { headers: { Authorization: 'Bearer ' + tok() } });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { ok: r.ok, json: j, status: r.status };
}

(async () => {
  const iaps = (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data || [];
  const map = {};
  for (const p of iaps) {
    const v = await api('GET', `/v2/inAppPurchases/${p.id}/versions?limit=5`);
    const versions = v.json?.data || [];
    for (const ver of versions) map[ver.id] = `${p.attributes.productId} (ver state=${ver.attributes?.state})`;
    console.log(`${p.attributes.productId.padEnd(26)} state=${p.attributes.state.padEnd(16)} versions=${versions.map(x => x.id + ':' + x.attributes?.state).join(', ') || '(' + v.status + ')'}`);
  }

  console.log('\n=== BEKLEYEN GÖNDERİMDEKİ KALEMLER ===');
  const subs = (await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&limit=20`)).json?.data || [];
  for (const s of subs) {
    if (s.attributes.state === 'COMPLETE') continue;
    console.log(`\n  gönderim ${s.id}  [${s.attributes.state}]  platform=${s.attributes.platform}`);
    const items = (await api('GET', `/v1/reviewSubmissions/${s.id}/items?limit=50`)).json?.data || [];
    for (const it of items) {
      const [, type, ref] = Buffer.from(it.id, 'base64').toString().split('|');
      const label = type === '17' ? (map[ref] || `IAP versiyonu ${ref} (eşleşmedi)`) : `tip ${type} → ${ref}`;
      console.log(`    ${it.attributes.state.padEnd(18)} ${label}`);
    }
  }
})();
