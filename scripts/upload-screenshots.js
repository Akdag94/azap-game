// App Store 6.7" ekran görüntülerini yükler (rezervasyon → S3 upload → commit)
const jwt = require('jsonwebtoken'), fs = require('fs'), crypto = require('crypto'), path = require('path');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) { const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {} return { ok: r.ok, json: j, text: t, status: r.status }; }
const err = r => (r.json?.errors?.[0]?.detail || r.text || '').slice(0, 200);

const DIR = path.join(__dirname, '..', 'appstore-shots');
const FILES = ['01-giris.png', '02-anamenu.png', '03-rehber.png', '04-magaza.png', '05-lobi.png'];
const DISPLAY_TYPE = 'APP_IPHONE_67';

(async () => {
  // tr localization
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  const locs = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations`)).json.data;
  const loc = locs.find(l => l.attributes.locale.startsWith('tr')) || locs[0];
  console.log('Localization:', loc.attributes.locale);

  // Screenshot set (6.7") — var mı, yoksa oluştur
  let sets = (await api('GET', `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).json.data;
  let set = sets.find(s => s.attributes.screenshotDisplayType === DISPLAY_TYPE);
  if (!set) {
    const c = await api('POST', '/v1/appScreenshotSets', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: DISPLAY_TYPE }, relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } } } });
    if (!c.ok) { console.log('Set oluşturulamadı:', err(c)); process.exit(1); }
    set = c.json.data;
  }
  console.log('Screenshot set:', set.id);

  // Mevcut screenshot'ları temizle (tekrar çalıştırmada çift olmasın)
  const existing = (await api('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots`)).json.data || [];
  for (const e of existing) { await api('DELETE', `/v1/appScreenshots/${e.id}`); }
  if (existing.length) console.log('Eski', existing.length, 'görüntü silindi');

  for (const fname of FILES) {
    const buf = fs.readFileSync(path.join(DIR, fname));
    // 1) Reservation
    const res = await api('POST', '/v1/appScreenshots', { data: { type: 'appScreenshots', attributes: { fileName: fname, fileSize: buf.length }, relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } } } });
    if (!res.ok) { console.log(fname, '✗ rezervasyon:', err(res)); continue; }
    const sid = res.json.data.id;
    const op = res.json.data.attributes.uploadOperations[0];
    // 2) Upload (S3 PUT)
    const headers = {}; (op.requestHeaders || []).forEach(h => headers[h.name] = h.value);
    const up = await fetch(op.url, { method: op.method, headers, body: buf });
    if (!up.ok) { console.log(fname, '✗ upload:', up.status); continue; }
    // 3) Commit
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    const commit = await api('PATCH', `/v1/appScreenshots/${sid}`, { data: { type: 'appScreenshots', id: sid, attributes: { uploaded: true, sourceFileChecksum: md5 } } });
    console.log(fname, commit.ok ? '✓ yüklendi' : '✗ commit: ' + err(commit));
  }
  console.log('\nEkran görüntüleri bitti.');
})();
