const jwt=require('jsonwebtoken'),fs=require('fs');
const P=fs.readFileSync(process.env.ASC_P8_PATH,'utf8'),APP=process.env.ASC_APP_ID;
const tok=()=>jwt.sign({},P,{algorithm:'ES256',expiresIn:'18m',issuer:process.env.ASC_ISSUER_ID,audience:'appstoreconnect-v1',header:{alg:'ES256',kid:process.env.ASC_KEY_ID,typ:'JWT'}});
async function api(m,e){const r=await fetch('https://api.appstoreconnect.apple.com'+e,{method:m,headers:{Authorization:'Bearer '+tok()}});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{};return{ok:r.ok,json:j,status:r.status};}
(async()=>{
  const info=(await api('GET',`/v1/apps/${APP}/appInfos`)).json.data[0];
  // Age rating
  const ard=await api('GET',`/v1/appInfos/${info.id}/ageRatingDeclaration`);
  console.log('AGE RATING declaration var mı:', ard.ok && ard.json?.data ? 'EVET' : 'HAYIR/eksik');
  // Primary category kontrol
  const info2=(await api('GET',`/v1/apps/${APP}/appInfos?include=primaryCategory`)).json;
  const pc=info2.included?.find(x=>x.type==='appCategories');
  console.log('Kategori:', pc? pc.id : 'YOK');
  // IAP sayısı
  const iaps=await api('GET',`/v1/apps/${APP}/inAppPurchasesV2?limit=50`);
  console.log('IAP ürün sayısı:', iaps.json?.data?.length||0);
  (iaps.json?.data||[]).forEach(d=>console.log('  -',d.attributes.productId,'|',d.attributes.state));
  // Version localization doluluk
  const ver=(await api('GET',`/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  const loc=(await api('GET',`/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations`)).json.data[0];
  console.log('Açıklama dolu mu:', loc?.attributes?.description ? 'EVET ('+loc.attributes.description.length+' karakter)' : 'HAYIR');
  console.log('Screenshot seti var mı: (ayrı kontrol gerekir)');
}).call();
