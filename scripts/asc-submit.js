// İncelemeye gönder — modern reviewSubmissions akışı (versiyon + IAP'lar).
// Eksik bir şey varsa Apple API tam listeyi döndürür; hiçbir şey Apple'a
// GİTMEDEN önce doğrulama yapılır (submit PATCH'i son adımdır).
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) { const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {} return { ok: r.ok, json: j, text: t, status: r.status }; }
const errs = r => (r.json?.errors || []).map(e => '  • ' + (e.title || '') + (e.detail ? ' — ' + e.detail : '')).join('\n') || r.text;

(async () => {
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  console.log('Versiyon:', ver.attributes.versionString, '(' + ver.attributes.appStoreState + ')');
  if (ver.attributes.appStoreState !== 'PREPARE_FOR_SUBMISSION') {
    console.log('⚠ Versiyon zaten', ver.attributes.appStoreState, '— gönderim gerekmiyor olabilir.');
  }

  // 1) Var olan açık reviewSubmission var mı?
  let rs = (await api('GET', `/v1/reviewSubmissions?filter[app]=${APP}&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES&limit=1`)).json.data?.[0];
  if (!rs) {
    const c = await api('POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP } } } } });
    if (!c.ok) { console.log('✗ reviewSubmission oluşturulamadı:\n' + errs(c)); process.exit(1); }
    rs = c.json.data;
    console.log('✓ reviewSubmission oluşturuldu:', rs.id);
  } else {
    console.log('ℹ Mevcut reviewSubmission kullanılıyor:', rs.id, '(' + rs.attributes.state + ')');
  }

  // 2) Versiyonu item olarak ekle (zaten ekli değilse)
  const items = (await api('GET', `/v1/reviewSubmissions/${rs.id}/items`)).json.data || [];
  const hasVer = items.some(i => i.relationships?.appStoreVersion?.data?.id === ver.id);
  if (!hasVer) {
    const it = await api('POST', '/v1/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: rs.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } } } } });
    console.log(it.ok ? '✓ Versiyon gönderime eklendi' : '✗ Versiyon eklenemedi:\n' + errs(it));
    if (!it.ok) process.exit(1);
  } else console.log('ℹ Versiyon zaten gönderim öğesinde');

  // 3) GÖNDER
  const sub = await api('PATCH', `/v1/reviewSubmissions/${rs.id}`, { data: { type: 'reviewSubmissions', id: rs.id, attributes: { submitted: true } } });
  if (sub.ok) {
    console.log('\n🚀 GÖNDERİLDİ! State:', sub.json?.data?.attributes?.state);
    console.log('Apple incelemesi başladı. Sonuç e-posta ile bildirilir (genelde 24-48 saat).');
  } else {
    console.log('\n✗ GÖNDERİM ENGELLENDİ — Apple şunları eksik/hatalı buldu:\n' + errs(sub));
    console.log('\n(Not: Uygulama Apple\'a GİTMEDİ. Yukarıdaki eksikleri düzeltip tekrar çalıştır.)');
  }
})();
