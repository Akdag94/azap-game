// TAKILI IAP'LARI KURTAR
//
// Sorun: 6 IAP versiyonu, gönderilmemiş ama iptal de edilemeyen eski bir
// reviewSubmission'a (288707c2) kilitli kalmış. Bu yüzden yeni gönderime
// eklenemiyorlar ("This resource cannot be reviewed").
//
// Çözüm: o gönderimdeki kalemleri TEK TEK SİL (reviewSubmissionItems DELETE'i
// destekliyor), böylece IAP versiyonları serbest kalır.
//
// Kullanım: node scripts/asc-free-stuck-iaps.js
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

(async () => {
  const subs = (await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&limit=20`)).json?.data || [];
  for (const s of subs) {
    // Gönderilmiş/tamamlanmış olanlara dokunma; yalnızca beklemede kalmış
    // (READY_FOR_REVIEW ama submitted olmayan) gönderimleri boşalt
    if (s.attributes.state !== 'READY_FOR_REVIEW') continue;
    const items = (await api('GET', `/v1/reviewSubmissions/${s.id}/items?limit=50`)).json?.data || [];
    if (!items.length) continue;
    console.log(`\n=== gönderim ${s.id} [${s.attributes.state}] — ${items.length} kalem ===`);
    for (const it of items) {
      const [, type, ref] = Buffer.from(it.id, 'base64').toString().split('|');
      const d = await api('DELETE', `/v1/reviewSubmissionItems/${it.id}`);
      console.log(`  sil (tip ${type} → ${ref.slice(0, 8)}…): ${d.ok ? '✓' : '✗ ' + detail(d)}`);
    }
    await sleep(3000);
    // Boşalan gönderimi iptal etmeyi dene
    const c = await api('PATCH', `/v1/reviewSubmissions/${s.id}`, {
      data: { type: 'reviewSubmissions', id: s.id, attributes: { canceled: true } }
    });
    console.log(`  gönderimi iptal: ${c.ok ? '✓' : '✗ ' + detail(c)}`);
  }

  await sleep(5000);
  console.log('\n=== SONRAKİ DURUM ===');
  const after = (await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&limit=20`)).json?.data || [];
  for (const s of after) {
    const items = (await api('GET', `/v1/reviewSubmissions/${s.id}/items?limit=50`)).json?.data || [];
    console.log(`  ${s.id} [${s.attributes.state}] platform=${s.attributes.platform} kalem=${items.length}`);
  }
  console.log('');
  for (const p of (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data) {
    const v = (await api('GET', `/v2/inAppPurchases/${p.id}/versions?limit=1`)).json?.data?.[0];
    console.log(`  ${p.attributes.productId.padEnd(26)} ${p.attributes.state.padEnd(20)} versiyon=${v?.attributes?.state || '-'}`);
  }
})();
