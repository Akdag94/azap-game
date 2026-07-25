// App Store Connect — metadata + kategori + review detail doldurur
const jwt = require('jsonwebtoken'), fs = require('fs');
const P = fs.readFileSync(process.env.ASC_P8_PATH, 'utf8');
const APP = process.env.ASC_APP_ID;
const tok = () => jwt.sign({}, P, { algorithm: 'ES256', expiresIn: '18m', issuer: process.env.ASC_ISSUER_ID, audience: 'appstoreconnect-v1', header: { alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' } });
const BASE = 'https://api.appstoreconnect.apple.com';
async function api(m, e, b) {
  const r = await fetch(BASE + e, { method: m, headers: { Authorization: 'Bearer ' + tok(), 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch {}
  return { status: r.status, ok: r.ok, json: j, text: t };
}
const err = r => (r.json?.errors?.[0]?.detail || r.text || '').slice(0, 160);

const DESC = `AZAP — arkadaşlarınla yüz yüze oynanan Türkçe sosyal dedüksiyon oyunu.

Telefonların masanın etrafına serptiği o sessizliği bitiriyoruz. AZAP'ta herkese gizli bir rol dağıtılır: kimi köyü canı pahasına savunan bir masum, kimi gece karanlığında plan kuran bir hain, kimi de kendi hikayesini yazan bir yalnız. Hamleni telefondan yap ama yalanı arkadaşının gözlerinin içine bakarak söyle.

ÖZELLİKLER
• 30+ farklı rol ve neredeyse sonsuz kombinasyon
• Sesli sohbetle gerçek zamanlı tartışma ve blöf
• Gece/gündüz döngüsü, oylama, suikast, strateji
• 4-20 kişiyle, aynı masada ya da uzaktan
• Modern, hızlı ve tamamen Türkçe arayüz

Blöf yeteneğini konuştur, arkadaşının ses tonundaki o ufak titremeyi yakala ve doğru oyla köyün kaderini çiz.

Çünkü AZAP'ta kimse göründüğü kişi değildir.`;

const KEYWORDS = 'mafya,sosyal,dedüksiyon,parti,hain,köylü,sesli sohbet,rol,strateji,blöf,arkadaş';
const PROMO = 'Arkadaşlarınla hain avına çık! 30+ rolle sesli, sosyal dedüksiyon oyunu.';

(async () => {
  // 1) Version localization (tr)
  const ver = (await api('GET', `/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  console.log('Version:', ver.attributes.versionString, ver.attributes.appStoreState);
  const locs = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations`)).json.data;
  let tr = locs.find(l => l.attributes.locale === 'tr' || l.attributes.locale === 'tr-TR') || locs[0];
  const attrs = { description: DESC, keywords: KEYWORDS, promotionalText: PROMO, supportUrl: 'https://azap.online', marketingUrl: 'https://azap.online' };
  if (tr) {
    const r = await api('PATCH', `/v1/appStoreVersionLocalizations/${tr.id}`, { data: { type: 'appStoreVersionLocalizations', id: tr.id, attributes: attrs } });
    console.log('Açıklama/keywords (' + tr.attributes.locale + '):', r.ok ? '✓' : '✗ ' + err(r));
  } else console.log('tr localization bulunamadı');

  // 2) Kategori (Games / primary)
  const info = (await api('GET', `/v1/apps/${APP}/appInfos`)).json.data[0];
  const catRel = await api('PATCH', `/v1/appInfos/${info.id}`, {
    data: { type: 'appInfos', id: info.id, relationships: { primaryCategory: { data: { type: 'appCategories', id: 'GAMES' } } } }
  });
  console.log('Kategori (Games):', catRel.ok ? '✓' : '✗ ' + err(catRel));

  // (Review detail / test hesabı ayrı adımda — gerçek hesap oluşturulduktan sonra)
  console.log('\nMetadata + kategori bitti.');
})();
