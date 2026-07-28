// SON ADIM: premium versiyonları hazır olunca app'i iptal edip yeniden gönderir;
// tüm READY_FOR_REVIEW IAP'lar (gold + premium) app sürümüne otomatik bağlanır.
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) { const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {} return { ok: r.ok, json: j, text: t, status: r.status }; }
const detail = r => (r.json?.errors?.[0]?.detail || r.text || '').slice(0, 160);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PREMIUMS = ['online.azap.premium30', 'online.azap.premium90', 'online.azap.premium365'];

async function iapList() { return (await api('GET', `/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data; }
async function verState(id) { const v = await api('GET', `/v2/inAppPurchases/${id}/versions?limit=1`); return v.json?.data?.[0]?.attributes?.state; }
async function appVer() { return (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0]; }

(async () => {
  // ── FAZ 1: premium versiyonları READY_FOR_REVIEW olsun ──
  console.log('FAZ 1: premium versiyonları bekleniyor...');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const iaps = await iapList();
    const prem = iaps.filter(x => PREMIUMS.includes(x.attributes.productId));
    const states = {};
    for (const p of prem) states[p.attributes.productId] = await verState(p.id);
    const allReady = PREMIUMS.every(pid => states[pid] === 'READY_FOR_REVIEW');
    console.log(`  tur ${i + 1}/60: ` + PREMIUMS.map(p => p.split('.').pop() + '=' + (states[p] || '?')).join(' '));
    if (allReady) { ready = true; break; }
    await sleep(30000);
  }
  if (!ready) { console.log('\n⚠ Premium versiyonları zamanında hazır olmadı. Durduruldu — app’e dokunulmadı.'); return; }
  console.log('✓ Tüm premium versiyonları READY_FOR_REVIEW');

  // ── FAZ 2: app gönderimini iptal et ──
  let ver = await appVer();
  console.log('\nFAZ 2: app durumu', ver.attributes.appStoreState);
  if (['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_DEVELOPER_RELEASE'].includes(ver.attributes.appStoreState)) {
    const rss = (await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&limit=10`)).json.data || [];
    for (const rs of rss) {
      if (rs.attributes.submitted && !rs.attributes.canceled && rs.attributes.state !== 'COMPLETE') {
        const c = await api('PATCH', `/v1/reviewSubmissions/${rs.id}`, { data: { type: 'reviewSubmissions', id: rs.id, attributes: { canceled: true } } });
        console.log('  iptal', rs.id, c.ok ? '✓' : detail(c));
      }
    }
    // editable state bekle
    for (let i = 0; i < 12; i++) { await sleep(5000); ver = await appVer(); if (['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED'].includes(ver.attributes.appStoreState)) break; }
    console.log('  app yeni durum:', ver.attributes.appStoreState);
  }

  // ── FAZ 3: app’i yeniden gönder (IAP’lar otomatik bağlanır) ──
  console.log('\nFAZ 3: app yeniden gönderiliyor...');
  const c = await api('POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP } } } } });
  if (!c.ok) { console.log('  ✗ reviewSubmission:', detail(c)); return; }
  const rs = c.json.data;
  const it = await api('POST', '/v1/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: rs.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } } } } });
  if (!it.ok) { console.log('  ✗ versiyon eklenemedi:', detail(it)); return; }
  const sub = await api('PATCH', `/v1/reviewSubmissions/${rs.id}`, { data: { type: 'reviewSubmissions', id: rs.id, attributes: { submitted: true } } });
  console.log('  gönderim:', sub.ok ? '✓ ' + sub.json?.data?.attributes?.state : '✗ ' + detail(sub));

  // ── FAZ 4: doğrula ──
  await sleep(8000);
  console.log('\n=== SON DURUM ===');
  ver = await appVer();
  console.log('App 1.0 →', ver.attributes.appStoreState);
  (await iapList()).forEach(d => console.log('  ' + d.attributes.productId.padEnd(24), '→', d.attributes.state));
})();
