const jwt=require('jsonwebtoken'),fs=require('fs');
const P=fs.readFileSync(process.env.ASC_P8_PATH,'utf8'),APP=process.env.ASC_APP_ID;
const tok=()=>jwt.sign({},P,{algorithm:'ES256',expiresIn:'18m',issuer:process.env.ASC_ISSUER_ID,audience:'appstoreconnect-v1',header:{alg:'ES256',kid:process.env.ASC_KEY_ID,typ:'JWT'}});
async function api(m,e){const r=await fetch('https://api.appstoreconnect.apple.com'+e,{method:m,headers:{Authorization:'Bearer '+tok()}});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch{};return{ok:r.ok,json:j};}
(async()=>{
  const iaps=(await api('GET',`/v1/apps/${APP}/inAppPurchasesV2?limit=50`)).json.data;
  console.log('=== IAP DURUMLARI ===');
  iaps.forEach(d=>console.log('  '+d.attributes.productId+' → '+d.attributes.state));
  // App privacy publish state
  const du=await api('GET',`/v1/apps/${APP}/appDataUsages?limit=5`);
  console.log('=== APP PRIVACY: kayıtlı veri tipi sayısı:', du.json?.data?.length ?? 'erişilemedi');
  const ps=await api('GET',`/v1/apps/${APP}/appDataUsagesPublishState`);
  console.log('   publish state:', ps.json?.data?.attributes?.published);
  // Version state
  const ver=(await api('GET',`/v1/apps/${APP}/appStoreVersions?limit=1`)).json.data[0];
  console.log('=== VERSION:', ver.attributes.versionString, ver.attributes.appStoreState);
}).call();
