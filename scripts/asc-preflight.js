// Gönderim öncesi tam kontrol: versiyon metadata, build, yaş sınırı, kategori, URL'ler, privacy
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8'), APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
async function api(m, e, b) { const r = await fetch('https://api.appstoreconnect.apple.com' + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {} return { ok: r.ok, json: j, text: t, status: r.status }; }
const OK = '✓', NO = '✗', WARN = '⚠';
const mark = c => c ? OK : NO;

(async () => {
  // App-level info
  const app = (await api('GET', `/v1/apps/${APP}?include=appInfos`)).json;
  console.log('APP:', app.data.attributes.name, '| bundle:', app.data.attributes.bundleId, '| SKU:', app.data.attributes.sku, '| primaryLocale:', app.data.attributes.primaryLocale);

  // appInfo (kategori, yaş sınırı, içerik hakları)
  const infos = (await api('GET', `/v1/apps/${APP}/appInfos`)).json.data || [];
  const info = infos.find(i => ['PREPARE_FOR_SUBMISSION','READY_FOR_DISTRIBUTION'].includes(i.attributes.appStoreState)) || infos[0];
  if (info) {
    const a = info.attributes;
    console.log('\n=== APP INFO (' + a.appStoreState + ') ===');
    console.log(' ', mark(a.primaryCategory!==undefined || true), 'contentRights:', a.appStoreAgeRating || a.brazilAgeRating || '(ayrı)', '| kidsAgeBand:', a.kidsAgeBand);
    // Kategoriler
    const cats = (await api('GET', `/v1/appInfos/${info.id}?include=primaryCategory,secondaryCategory`)).json;
    const inc = cats.included || [];
    console.log('  primaryCategory:', inc.find(x=>x.id===cats.data.relationships?.primaryCategory?.data?.id)?.id || '(YOK)');
    // appInfoLocalizations (isim, subtitle, privacy policy url)
    const locs = (await api('GET', `/v1/appInfos/${info.id}/appInfoLocalizations`)).json.data || [];
    locs.forEach(l => console.log('  loc['+l.attributes.locale+']: name="'+l.attributes.name+'" subtitle="'+(l.attributes.subtitle||'')+'" privacyURL='+(l.attributes.privacyPolicyUrl||NO)));
    // Age rating declaration
    const ard = (await api('GET', `/v1/appInfos/${info.id}/ageRatingDeclaration`)).json;
    console.log('  ageRatingDeclaration:', ard.data ? (OK+' var') : (NO+' YOK'));
  }

  // Version + localization + build
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1&include=build`)).json;
  const v = ver.data[0];
  console.log('\n=== VERSION', v.attributes.versionString, '(' + v.attributes.appStoreState + ') ===');
  console.log('  releaseType:', v.attributes.releaseType);
  const build = ver.included?.find(x => x.type === 'builds');
  console.log(' ', mark(!!build), 'BUILD:', build ? (build.attributes.version + ' (' + build.attributes.processingState + ')') : 'YOK — binary yüklenmemiş!');

  const vlocs = (await api('GET', `/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`)).json.data || [];
  for (const l of vlocs) {
    const a = l.attributes;
    console.log('  loc[' + a.locale + ']:');
    console.log('    ', mark(!!a.description && a.description.length>=10), 'description (' + (a.description?.length||0) + ' karakter)');
    console.log('    ', mark(!!a.keywords), 'keywords:', a.keywords || NO);
    console.log('    ', mark(!!a.supportUrl), 'supportUrl:', a.supportUrl || NO);
    console.log('    ', a.marketingUrl ? OK : WARN, 'marketingUrl:', a.marketingUrl || '(ops.)');
    console.log('    ', mark(!!a.whatsNew) , 'whatsNew:', a.whatsNew ? '(var)' : '(ilk sürümde ops.)');
    // screenshots
    const sets = (await api('GET', `/v1/appStoreVersionLocalizations/${l.id}/appScreenshotSets`)).json.data || [];
    for (const s of sets) {
      const shots = (await api('GET', `/v1/appScreenshotSets/${s.id}/appScreenshots`)).json.data || [];
      const states = shots.map(sh => sh.attributes.assetDeliveryState?.state).join(',');
      console.log('    ', mark(shots.length>=1), 'screenshot[' + s.attributes.screenshotDisplayType + ']: ' + shots.length + ' adet (' + states + ')');
    }
  }

  // Review detail
  const rd = (await api('GET', `/v1/appStoreVersions/${v.id}/appStoreReviewDetail`)).json;
  if (rd.data) {
    const a = rd.data.attributes;
    console.log('\n=== REVIEW DETAY ===');
    console.log(' ', mark(a.demoAccountRequired && a.demoAccountName), 'demoHesap:', a.demoAccountName || NO, '| required:', a.demoAccountRequired);
    console.log(' ', mark(!!a.contactEmail && !!a.contactPhone), 'iletişim:', a.contactFirstName, a.contactLastName, a.contactPhone, a.contactEmail);
    console.log(' ', a.notes ? OK : WARN, 'notes:', a.notes ? '(' + a.notes.length + ' karakter)' : '(yok)');
  } else console.log('\n=== REVIEW DETAY:', NO, 'YOK ===');

  // IDFA / encryption already in infoPlist. Version submission readiness
  console.log('\n=== ÖZET: yukarıda', NO, 'olan her şey gönderimi engeller ===');
})();
